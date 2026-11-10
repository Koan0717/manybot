import io
import json

import discord
from discord.ext import commands

import database

# 大学サークル用ダッシュボード（/circle/[guild_id]）の「サークル進捗状況」レポート送信。
# ダッシュボードが panel_requests に 'circle_report_send'（channel_id = 0, panel_id = レポートID）を入れると、
# ipc.py から send_circle_report() が呼ばれ、circle_settings の送信先の人へ DM でレポート（題名・内容・PDF）を送る。
# 送信結果は circle_reports.send_status / send_results に書き戻し、ダッシュボードに表示する。

_ensured_pools = set()

# Discord の埋め込み本文の上限
_EMBED_DESC_LIMIT = 4096


async def ensure_circle_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS circle_settings (
                guild_id BIGINT PRIMARY KEY,
                circle_name TEXT NOT NULL DEFAULT '',
                recipient_user_ids BIGINT[] NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS circle_reports (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                pdf_name TEXT,
                pdf_size INT,
                pdf_data BYTEA,
                send_status TEXT NOT NULL DEFAULT 'none',
                send_results JSONB NOT NULL DEFAULT '[]'::jsonb,
                last_sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        ''')
        for sql in (
            # 報告書パネル（Discord のチャンネルに置く「報告書を書く」ボタン）の表示内容
            "ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_title TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_description TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE circle_settings ADD COLUMN IF NOT EXISTS panel_button_label TEXT NOT NULL DEFAULT ''",
            # パネルから書かれた報告書の作成者（ダッシュボードで作ったものは NULL）
            "ALTER TABLE circle_reports ADD COLUMN IF NOT EXISTS author_id BIGINT",
            "ALTER TABLE circle_reports ADD COLUMN IF NOT EXISTS author_name TEXT",
        ):
            await conn.execute(sql)
    _ensured_pools.add(id(p))
    return p


def _build_embed(guild: discord.Guild, circle_name: str, report) -> discord.Embed:
    content = report["content"] or ""
    if len(content) > _EMBED_DESC_LIMIT:
        content = content[: _EMBED_DESC_LIMIT - 1] + "…"
    embed = discord.Embed(
        title=f"📝 {report['title']}"[:256],
        description=content or None,
        color=discord.Color.from_rgb(14, 165, 233),
    )
    author = circle_name or guild.name
    embed.set_author(name=f"{author} ｜ サークル進捗状況"[:256], icon_url=guild.icon.url if guild.icon else None)
    if report.get("author_name"):
        embed.add_field(name="作成者", value=report["author_name"][:1024], inline=True)
    if report["pdf_name"]:
        embed.add_field(name="添付", value=f"📎 {report['pdf_name']}"[:1024], inline=True)
    embed.set_footer(text=f"{guild.name} から送信")
    embed.timestamp = discord.utils.utcnow()
    return embed


async def send_circle_report(bot: commands.Bot, guild: discord.Guild, report_id: int):
    """レポートを送信先の全員に DM で送り、結果を DB に保存する。"""
    p = await ensure_circle_schema(guild.id)
    async with p.acquire() as conn:
        report = await conn.fetchrow(
            "SELECT id, title, content, pdf_name, pdf_data, author_name FROM circle_reports WHERE id = $1 AND guild_id = $2",
            report_id, guild.id,
        )
        settings = await conn.fetchrow(
            "SELECT circle_name, recipient_user_ids FROM circle_settings WHERE guild_id = $1",
            guild.id,
        )
    if not report:
        return None
    report = dict(report)

    circle_name = (settings["circle_name"] if settings else "") or ""
    recipient_ids = list(settings["recipient_user_ids"] or []) if settings else []
    embed = _build_embed(guild, circle_name, report)
    pdf_bytes = bytes(report["pdf_data"]) if report["pdf_data"] is not None else None

    results = []
    for uid in recipient_ids:
        uid = int(uid)
        entry = {"user_id": str(uid), "ok": False}
        try:
            user = guild.get_member(uid) or await bot.fetch_user(uid)
            entry["name"] = getattr(user, "display_name", None) or user.name
            files = [discord.File(io.BytesIO(pdf_bytes), filename=report["pdf_name"] or "report.pdf")] if pdf_bytes else []
            await user.send(embed=embed, files=files)
            entry["ok"] = True
        except discord.Forbidden:
            entry["error"] = "DMを受け取れない設定です"
        except discord.NotFound:
            entry["error"] = "ユーザーが見つかりません"
        except discord.HTTPException as e:
            if e.code == 40005 or e.status == 413:
                entry["error"] = "PDFが大きすぎて送れません"
            else:
                entry["error"] = f"送信エラー ({e.status})"
        except Exception as e:
            entry["error"] = f"送信エラー: {type(e).__name__}"
        results.append(entry)

    ok = sum(1 for r in results if r["ok"])
    if results and ok == len(results):
        status = "sent"
    elif ok > 0:
        status = "partial"
    else:
        status = "failed"

    async with p.acquire() as conn:
        await conn.execute(
            """UPDATE circle_reports
                  SET send_status = $3, send_results = $4::jsonb, last_sent_at = NOW()
                WHERE id = $1 AND guild_id = $2""",
            report_id, guild.id, status, json.dumps(results, ensure_ascii=False),
        )
    print(f"[CircleReport] guild {guild.id} report {report_id}: {ok}/{len(results)} sent")
    return results


async def mark_circle_report_failed(guild_id: int, report_id: int, message: str):
    """送信処理そのものが落ちたとき、ダッシュボードが「送信中」のままにならないようにする。"""
    try:
        p = await ensure_circle_schema(guild_id)
        async with p.acquire() as conn:
            await conn.execute(
                """UPDATE circle_reports SET send_status = 'failed', send_results = $3::jsonb
                    WHERE id = $1 AND guild_id = $2""",
                report_id, guild_id, json.dumps([{"user_id": "-", "name": "Bot", "ok": False, "error": message}], ensure_ascii=False),
            )
    except Exception as e:
        print(f"[CircleReport] Failed to mark report {report_id} as failed: {e}")


# ============================================================
# 報告書パネル: チャンネルに置いた「報告書を書く」ボタンから、題名・内容・PDF を入力して保存する。
# 保存すると本人にだけ見えるメッセージで「送信する」「終了」のボタンを出す。
# ============================================================

PANEL_CUSTOM_ID = "circle_report:write"
DEFAULT_PANEL_TITLE = "📝 サークル進捗報告"
DEFAULT_PANEL_DESCRIPTION = "下のボタンから、サークルの進捗状況の報告書（題名・内容・PDF）を書いて提出できます。"
DEFAULT_BUTTON_LABEL = "報告書を書く"

# ダッシュボードから PDF をダウンロードできる大きさ（Vercel の上限）に合わせる
MAX_PDF_BYTES = 4 * 1024 * 1024
MAX_TITLE = 200
MAX_CONTENT = 4000


async def _get_panel_settings(guild_id: int) -> dict:
    p = await ensure_circle_schema(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT circle_name, panel_title, panel_description, panel_button_label FROM circle_settings WHERE guild_id = $1",
            guild_id,
        )
    row = dict(row) if row else {}
    return {
        "circle_name": row.get("circle_name") or "",
        "title": row.get("panel_title") or DEFAULT_PANEL_TITLE,
        "description": row.get("panel_description") or DEFAULT_PANEL_DESCRIPTION,
        "button_label": (row.get("panel_button_label") or DEFAULT_BUTTON_LABEL)[:80],
    }


async def post_circle_report_panel(guild: discord.Guild, channel):
    """IPC から呼ばれる: 報告書パネルを投稿する。"""
    s = await _get_panel_settings(guild.id)
    embed = discord.Embed(title=s["title"][:256], description=s["description"][:4096], color=discord.Color.from_rgb(14, 165, 233))
    if s["circle_name"]:
        embed.set_author(name=s["circle_name"][:256], icon_url=guild.icon.url if guild.icon else None)
    embed.set_footer(text="入力した内容は、送るまで本人と運営にだけ見えます")
    await channel.send(embed=embed, view=CircleReportPanelView(label=s["button_label"]))


class CircleReportPanelView(discord.ui.View):
    """チャンネルに置くパネル。Bot が再起動してもボタンが動くよう custom_id を固定する。"""

    def __init__(self, label: str = DEFAULT_BUTTON_LABEL):
        super().__init__(timeout=None)
        button = discord.ui.Button(label=label, emoji="📝", style=discord.ButtonStyle.primary, custom_id=PANEL_CUSTOM_ID)
        button.callback = self.open_form
        self.add_item(button)

    async def open_form(self, interaction: discord.Interaction):
        if not interaction.guild:
            return
        await interaction.response.send_modal(CircleReportModal())

    async def on_error(self, interaction: discord.Interaction, error: Exception, item):
        # 入力画面を開けなかったときも、押した本人にだけ知らせる
        print(f"[CircleReport] failed to open form: {error}")
        try:
            if not interaction.response.is_done():
                await interaction.response.send_message("❌ 入力画面を開けませんでした。時間をおいてもう一度お試しください。", ephemeral=True)
        except Exception:
            pass


class CircleReportModal(discord.ui.Modal, title="サークル進捗報告"):
    def __init__(self):
        super().__init__(timeout=None)
        self.report_title = discord.ui.TextInput(
            style=discord.TextStyle.short, max_length=MAX_TITLE, placeholder="例: 11月の活動報告",
        )
        self.content = discord.ui.TextInput(
            style=discord.TextStyle.paragraph, required=False, max_length=MAX_CONTENT,
            placeholder="活動内容、参加人数、今後の予定など",
        )
        self.pdf = discord.ui.FileUpload(required=False, min_values=0, max_values=1)
        self.add_item(discord.ui.Label(text="題名", component=self.report_title))
        self.add_item(discord.ui.Label(text="内容", component=self.content))
        self.add_item(discord.ui.Label(text="PDF（任意）", description="4MBまでのPDFを1つ添付できます", component=self.pdf))

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        guild = interaction.guild
        title = str(self.report_title.value or "").strip()[:MAX_TITLE]
        content = str(self.content.value or "").replace("\r\n", "\n")[:MAX_CONTENT]
        if not title:
            await interaction.followup.send("❌ 題名を入力してください。", ephemeral=True)
            return

        pdf_name = pdf_size = pdf_data = None
        files = list(self.pdf.values or [])
        if files:
            att = files[0]
            if att.size > MAX_PDF_BYTES:
                await interaction.followup.send(f"❌ PDFは{MAX_PDF_BYTES // 1024 // 1024}MBまでです。もう一度ボタンから書き直してください。", ephemeral=True)
                return
            data = await att.read()
            if not data.startswith(b"%PDF-"):
                await interaction.followup.send("❌ PDFファイルを添付してください。もう一度ボタンから書き直してください。", ephemeral=True)
                return
            name = (att.filename or "report.pdf").replace("/", "_").replace("\\", "_")[:120]
            pdf_name = name if name.lower().endswith(".pdf") else f"{name}.pdf"
            pdf_size = len(data)
            pdf_data = data

        author_name = getattr(interaction.user, "display_name", None) or interaction.user.name
        p = await ensure_circle_schema(guild.id)
        async with p.acquire() as conn:
            report_id = await conn.fetchval(
                """INSERT INTO circle_reports (guild_id, title, content, pdf_name, pdf_size, pdf_data, author_id, author_name)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id""",
                guild.id, title, content, pdf_name, pdf_size, pdf_data, interaction.user.id, author_name,
            )

        settings = await _get_panel_settings(guild.id)
        preview = _build_embed(guild, settings["circle_name"], {
            "title": title, "content": content, "pdf_name": pdf_name, "author_name": author_name,
        })
        await interaction.followup.send(
            content="✅ 報告書を保存しました。送信先の人へ送る場合は「送信する」、送らずに終わる場合は「終了」を押してください。",
            embed=preview,
            view=CircleReportAfterSaveView(report_id, interaction.user.id),
            ephemeral=True,
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception):
        print(f"[CircleReport] modal error: {error}")
        msg = "❌ 報告書を保存できませんでした。時間をおいてもう一度お試しください。"
        try:
            if interaction.response.is_done():
                await interaction.followup.send(msg, ephemeral=True)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
        except Exception:
            pass


class CircleReportAfterSaveView(discord.ui.View):
    """保存後に本人にだけ出す「送信する」「終了」ボタン。"""

    def __init__(self, report_id: int, author_id: int):
        super().__init__(timeout=900)
        self.report_id = report_id
        self.author_id = author_id

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.author_id

    @discord.ui.button(label="送信する", emoji="📨", style=discord.ButtonStyle.success)
    async def send_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        p = await ensure_circle_schema(guild.id)
        async with p.acquire() as conn:
            n = await conn.fetchval(
                "SELECT COALESCE(array_length(recipient_user_ids, 1), 0) FROM circle_settings WHERE guild_id = $1",
                guild.id,
            )
            if not n:
                await interaction.response.send_message(
                    "❌ 送信先がまだ設定されていません。運営に「送信先設定」をお願いしてください。報告書は保存されています。",
                    ephemeral=True,
                )
                return
            updated = await conn.fetchval(
                """UPDATE circle_reports SET send_status = 'pending', send_results = '[]'::jsonb, updated_at = NOW()
                    WHERE id = $1 AND guild_id = $2 AND send_status <> 'pending' RETURNING id""",
                self.report_id, guild.id,
            )
        if not updated:
            await interaction.response.send_message("❌ この報告書は削除されたか、すでに送信中です。", ephemeral=True)
            return

        for item in self.children:
            item.disabled = True
        await interaction.response.edit_message(content="📨 送信しています…", view=self)
        try:
            results = await send_circle_report(interaction.client, guild, self.report_id) or []
        except Exception as e:
            print(f"[CircleReport] send from panel failed: {e}")
            await mark_circle_report_failed(guild.id, self.report_id, "Botの送信処理でエラーが起きました")
            await interaction.edit_original_response(content="❌ 送信中にエラーが起きました。報告書は保存されています。", view=None)
            self.stop()
            return

        ok = sum(1 for r in results if r["ok"])
        lines = [f"✅ 送信しました（{ok}/{len(results)}人に届きました）。"]
        failed = [r for r in results if not r["ok"]]
        if failed:
            lines.append("届かなかった人: " + "、".join(f"{r.get('name') or r['user_id']}（{r.get('error', '')}）" for r in failed[:10]))
        await interaction.edit_original_response(content="\n".join(lines)[:2000], view=None)
        self.stop()

    @discord.ui.button(label="終了", emoji="✖️", style=discord.ButtonStyle.secondary)
    async def finish_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(
            content="📁 報告書を保存して終了しました（送信はしていません）。運営がダッシュボードから送ることもできます。",
            view=None,
        )
        self.stop()


class CircleReport(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        # ボタンの文言はサーバーごとに違うが、custom_id が同じなので1つ登録すればどのパネルも動く
        self.bot.add_view(CircleReportPanelView())


async def setup(bot):
    await bot.add_cog(CircleReport(bot))
