import datetime
import json

import discord
from discord.ext import commands

import database
from helpers import JST, get_new_member_roles, has_evaluator_role

# 評価シート記入パネル: 評価員がパネルのボタンから仮メンを選び、総評とダッシュボードで設定した
# 各項目（声・コミュニケーションなど）の内容を書いて、指定チャンネルに送信する。
# シート（項目・送信先・パネルの文言など）は eval_report_sheets に1サーバー複数件保存し、パネルはシートごとに設置する。
# 以前の1サーバー1件の eval_report_settings は、最初のシートとして移し替える。

VERDICTS = [
    ("あり", "🟢", discord.Color.green()),
    ("保留", "🟡", discord.Color.gold()),
    ("なし", "🔴", discord.Color.red()),
]
# 各項目の段階は「保留」と 1〜N（N が最高）。N は項目ごとにダッシュボードで決め、0 なら段階なし。
# 項目に scale が無い古い設定は、シートの rating_scale を使う
DEFAULT_RATING_SCALE = 5
MIN_RATING_SCALE = 2
MAX_RATING_SCALE = 10
MAX_ITEMS = 20
DEFAULT_SHEET_NAME = "評価シート"
DEFAULT_PANEL_TITLE = "📋 評価シート"
DEFAULT_PANEL_DESCRIPTION = "評価員は下のボタンから仮メンの評価シートを記入できます。"
DEFAULT_BUTTON_LABEL = "評価シートを書く"

_ensured_pools = set()


async def ensure_eval_report_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS eval_report_settings (
                guild_id BIGINT PRIMARY KEY,
                items JSONB NOT NULL DEFAULT '[]'::jsonb,
                output_channel_id BIGINT,
                panel_title TEXT NOT NULL DEFAULT '',
                panel_description TEXT NOT NULL DEFAULT '',
                button_label TEXT NOT NULL DEFAULT ''
            )
        ''')
        await conn.execute('ALTER TABLE eval_report_settings ADD COLUMN IF NOT EXISTS rating_scale INT NOT NULL DEFAULT 5')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS eval_report_sheets (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                items JSONB NOT NULL DEFAULT '[]'::jsonb,
                output_channel_id BIGINT,
                panel_title TEXT NOT NULL DEFAULT '',
                panel_description TEXT NOT NULL DEFAULT '',
                button_label TEXT NOT NULL DEFAULT '',
                rating_scale INT NOT NULL DEFAULT 5,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        ''')
        # 旧設定を最初のシートとして移す。DELETE ... RETURNING で取り出すので、ダッシュボードと同時に動いても二重にならない
        await conn.execute('''
            WITH moved AS (DELETE FROM eval_report_settings RETURNING *)
            INSERT INTO eval_report_sheets (guild_id, name, items, output_channel_id, panel_title, panel_description, button_label, rating_scale)
            SELECT guild_id, '評価シート', items, output_channel_id, panel_title, panel_description, button_label, rating_scale FROM moved
        ''')
    _ensured_pools.add(id(p))
    return p


def _clamp_scale(scale) -> int:
    try:
        n = int(scale)
    except (TypeError, ValueError):
        return DEFAULT_RATING_SCALE
    return 0 if n <= 0 else min(MAX_RATING_SCALE, max(MIN_RATING_SCALE, n))


def _normalize_sheet(row) -> dict:
    s = dict(row)
    items = s["items"]
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            items = []
    scale = s.get("rating_scale")
    s["rating_scale"] = _clamp_scale(DEFAULT_RATING_SCALE if scale is None else scale)
    s["items"] = [
        # required が無い古い設定は必須として扱う。scale が無ければシートの段階数を使う
        {
            **i,
            "required": i.get("required") is not False,
            "scale": _clamp_scale(s["rating_scale"] if i.get("scale") is None else i.get("scale")),
        }
        for i in (items or []) if isinstance(i, dict) and i.get("id") and i.get("label")
    ][:MAX_ITEMS]
    s["name"] = s.get("name") or DEFAULT_SHEET_NAME
    s["panel_title"] = s.get("panel_title") or DEFAULT_PANEL_TITLE
    s["panel_description"] = s.get("panel_description") or DEFAULT_PANEL_DESCRIPTION
    s["button_label"] = s.get("button_label") or DEFAULT_BUTTON_LABEL
    return s


async def get_sheet(guild_id: int, sheet_id: int | None = None) -> dict | None:
    """シートを1件取得する。sheet_id が無ければ（シート番号の無い以前のパネル用）最初に作ったシート。"""
    p = await ensure_eval_report_schema(guild_id)
    async with p.acquire() as conn:
        if sheet_id is None:
            row = await conn.fetchrow('SELECT * FROM eval_report_sheets WHERE guild_id = $1 ORDER BY id LIMIT 1', guild_id)
        else:
            row = await conn.fetchrow('SELECT * FROM eval_report_sheets WHERE id = $1 AND guild_id = $2', sheet_id, guild_id)
    return _normalize_sheet(row) if row else None


async def post_eval_report_panel(guild: discord.Guild, channel, sheet_id: int | None = None):
    """IPC から呼ばれる: シートの記入パネルを投稿する。"""
    s = await get_sheet(guild.id, sheet_id)
    if not s:
        print(f"[EvalReport] sheet {sheet_id} not found in guild {guild.id}")
        return
    embed = discord.Embed(title=s["panel_title"], description=s["panel_description"], color=discord.Color.blue())
    embed.add_field(name="記入する項目", value="総評、" + "、".join(i["label"] for i in s["items"]) if s["items"] else "総評", inline=False)
    view = discord.ui.View(timeout=None)
    view.add_item(EvalReportOpenButton(s["id"], label=s["button_label"]))
    await channel.send(embed=embed, view=view)


def _verdict_meta(verdict: str):
    return next((v for v in VERDICTS if v[0] == verdict), (verdict, "⚪", discord.Color.light_grey()))


def rating_values(scale: int) -> list[str]:
    return ["保留"] + [str(n) for n in range(1, scale + 1)]


def format_rating(rating: str | None, scale: int) -> str:
    if not rating:
        return "（未選択）"
    if rating == "保留":
        return "⏸️ 保留"
    n = int(rating)
    return f"{'★' * n}{'☆' * max(0, scale - n)} {n} / {scale}"


MAX_MODAL_COMPONENTS = 5


def chunk_items(items: list[dict]) -> list[list[dict]]:
    """Discord のモーダルに置ける部品は5つまで。段階ありの項目は「段階」と「内容」の2つ、段階なしは1つ使うので、
    順番を保ったまま5つに収まるだけ詰めて画面を分ける。"""
    chunks: list[list[dict]] = []
    used = MAX_MODAL_COMPONENTS
    for item in items:
        cost = 2 if item.get("scale") else 1
        if used + cost > MAX_MODAL_COMPONENTS:
            chunks.append([])
            used = 0
        chunks[-1].append(item)
        used += cost
    return chunks


def format_item_value(item: dict, text: str | None, rating: str | None) -> str:
    """項目の表示。段階なしの項目なら段階の行は出さない。"""
    body = text or ("（未記入）" if item.get("required", True) else "（記入なし）")
    scale = item.get("scale", 0)
    if not scale:
        return body[:1024]
    return f"**段階:** {format_rating(rating, scale)}\n{body}"[:1024]


def build_report_embeds(target: discord.Member, evaluator: discord.Member, verdict: str, items: list[dict], answers: dict, ratings: dict, sheet_name: str = DEFAULT_SHEET_NAME) -> list[discord.Embed]:
    """提出内容の Embed。1メッセージの合計 6000 文字制限を超えないよう、必要に応じて複数に分ける。"""
    _, emoji, color = _verdict_meta(verdict)
    first = discord.Embed(
        title=f"📋 {sheet_name}"[:256],
        description=f"**対象者:** {target.mention}（{target.display_name}）\n**送信者:** {evaluator.mention}（{evaluator.display_name}）",
        color=color,
        timestamp=datetime.datetime.now(JST),
    )
    # 送信者を左上に、相手のアイコンを右上に表示する
    first.set_author(name=f"送信者: {evaluator.display_name}", icon_url=evaluator.display_avatar.url)
    first.set_thumbnail(url=target.display_avatar.url)
    first.add_field(name="総評", value=f"{emoji} **{verdict}**", inline=False)
    first.set_footer(text=f"送信者: {evaluator.display_name}（{evaluator.name}）")

    embeds = [first]
    for item in items:
        name = item["label"][:256]
        value = format_item_value(item, answers.get(item["id"]), ratings.get(item["id"]))
        current = embeds[-1]
        if len(current) + len(name) + len(value) > 5800 or len(current.fields) >= 25:
            current = discord.Embed(title=f"📋 {sheet_name}（続き）"[:256], color=color)
            current.set_author(name=f"送信者: {evaluator.display_name}", icon_url=evaluator.display_avatar.url)
            embeds.append(current)
        current.add_field(name=name, value=value, inline=False)
    return embeds


class EvalReportModal(discord.ui.Modal):
    def __init__(self, form: "EvalReportFormView", chunk: list[dict]):
        super().__init__(title="評価内容の記入", timeout=900)
        self.form = form
        self.inputs: list[tuple[dict, discord.ui.Select | None, discord.ui.TextInput]] = []
        for item in chunk:
            scale = item.get("scale", 0)
            required = item.get("required", True)
            rating_select = None
            if scale:
                current = form.ratings.get(item["id"])
                rating_select = discord.ui.Select(
                    placeholder="段階を選択",
                    options=[
                        discord.SelectOption(label=f"{r}（最高）" if r == str(scale) else r, value=r, default=r == current)
                        for r in rating_values(scale)
                    ],
                    required=True,
                )
                # 内容を書く欄の上に、段階を選ぶ欄を置く
                self.add_item(discord.ui.Label(
                    text=f"{item['label']}（{scale}段階）"[:45],
                    description=f"1〜{scale}で選択（{scale}が最高）。決めかねる場合は保留",
                    component=rating_select,
                ))
            text_input = discord.ui.TextInput(
                placeholder=(item.get("placeholder") or "")[:100] or None,
                style=discord.TextStyle.paragraph,
                required=required,
                max_length=950,
                default=form.answers.get(item["id"]),
            )
            self.add_item(discord.ui.Label(
                text=item["label"][:45],
                description=None if required else "任意（空欄のままでも送信できます）",
                component=text_input,
            ))
            self.inputs.append((item, rating_select, text_input))

    async def on_submit(self, interaction: discord.Interaction):
        for item, rating_select, text_input in self.inputs:
            if rating_select is not None and rating_select.values:
                self.form.ratings[item["id"]] = rating_select.values[0]
            text = text_input.value.strip()
            if text:
                self.form.answers[item["id"]] = text
            else:
                self.form.answers.pop(item["id"], None)
        await self.form.render(interaction)


class EvalReportTargetSelect(discord.ui.UserSelect):
    def __init__(self, form: "EvalReportFormView"):
        super().__init__(
            placeholder="評価する仮メンを選択",
            min_values=1,
            max_values=1,
            default_values=[form.target] if form.target else [],
            row=0,
        )
        self.form = form

    async def callback(self, interaction: discord.Interaction):
        picked = self.values[0]
        member = picked if isinstance(picked, discord.Member) else interaction.guild.get_member(picked.id)
        if member is None or member.bot:
            await self.form.render(interaction, notice="⚠️ そのユーザーは評価対象にできません。")
            return
        temp_roles = get_new_member_roles(self.form.bot, interaction.guild)
        if temp_roles and not any(r in member.roles for r in temp_roles):
            await self.form.render(interaction, notice=f"⚠️ {member.display_name} は仮メンではありません。")
            return
        self.form.target = member
        await self.form.render(interaction)


class EvalReportVerdictSelect(discord.ui.Select):
    def __init__(self, form: "EvalReportFormView"):
        super().__init__(
            placeholder="総評を選択",
            min_values=1,
            max_values=1,
            options=[
                discord.SelectOption(label=label, emoji=emoji, value=label, default=label == form.verdict)
                for label, emoji, _ in VERDICTS
            ],
            row=1,
        )
        self.form = form

    async def callback(self, interaction: discord.Interaction):
        self.form.verdict = self.values[0]
        await self.form.render(interaction)


class EvalReportFormView(discord.ui.View):
    """評価員だけに見えるメッセージで、仮メン・総評・各項目を記入してもらう。"""

    def __init__(self, bot, settings: dict, evaluator_id: int):
        super().__init__(timeout=1800)
        self.bot = bot
        self.settings = settings
        self.items: list[dict] = settings["items"]
        self.evaluator_id = evaluator_id
        self.target: discord.Member | None = None
        self.verdict: str | None = None
        self.answers: dict[str, str] = {}
        self.ratings: dict[str, str] = {}

    def _chunks(self) -> list[list[dict]]:
        return chunk_items(self.items)

    def _is_item_done(self, item: dict) -> bool:
        rating_ok = not item.get("scale") or bool(self.ratings.get(item["id"]))
        text_ok = bool(self.answers.get(item["id"])) or not item.get("required", True)
        return rating_ok and text_ok

    def _is_chunk_filled(self, chunk: list[dict]) -> bool:
        # 任意の項目だけの画面は、一度も書いていなければ「記入済み」にしない
        touched = any(i["id"] in self.answers or i["id"] in self.ratings for i in chunk)
        return touched and all(self._is_item_done(i) for i in chunk)

    def _is_complete(self) -> bool:
        return bool(self.target and self.verdict and all(self._is_item_done(i) for i in self.items))

    def _build(self) -> discord.Embed:
        self.clear_items()
        self.add_item(EvalReportTargetSelect(self))
        self.add_item(EvalReportVerdictSelect(self))

        chunks = self._chunks()
        for n, chunk in enumerate(chunks):
            filled = self._is_chunk_filled(chunk)
            if len(chunks) == 1:
                label = "内容を書く"
            else:
                names = "・".join(i["label"] for i in chunk)
                label = f"内容を書く（{names}）"[:80]
            btn = discord.ui.Button(
                label=label,
                emoji="✅" if filled else "✏️",
                style=discord.ButtonStyle.secondary if filled else discord.ButtonStyle.primary,
                row=2 + n // 5,  # 1行に置けるボタンは5つまで
            )
            btn.callback = self._make_write_handler(chunk)
            self.add_item(btn)

        submit = discord.ui.Button(label="送信する", emoji="📨", style=discord.ButtonStyle.success, disabled=not self._is_complete(), row=4)
        submit.callback = self.on_submit
        self.add_item(submit)
        cancel = discord.ui.Button(label="やめる", style=discord.ButtonStyle.danger, row=4)
        cancel.callback = self.on_cancel
        self.add_item(cancel)

        embed = discord.Embed(
            title=f"📋 {self.settings['name']}の記入"[:256],
            description=(
                "仮メンを選び、総評と各項目の段階・内容を書いてから「送信する」を押してください。"
                if any(i.get("scale") for i in self.items) else
                "仮メンを選び、総評と各項目の内容を書いてから「送信する」を押してください。"
            ),
            color=_verdict_meta(self.verdict)[2] if self.verdict else discord.Color.blue(),
        )
        if self.target:
            embed.set_thumbnail(url=self.target.display_avatar.url)
        embed.add_field(name="対象者", value=self.target.mention if self.target else "（未選択）", inline=True)
        embed.add_field(
            name="総評",
            value=f"{_verdict_meta(self.verdict)[1]} {self.verdict}" if self.verdict else "（未選択）",
            inline=True,
        )
        for item in self.items:
            name = item["label"] if item.get("required", True) else f"{item['label']}（任意）"
            value = format_item_value(item, self.answers.get(item["id"]), self.ratings.get(item["id"]))
            embed.add_field(name=name[:256], value=value, inline=False)
        return embed

    def _make_write_handler(self, chunk: list[dict]):
        async def handler(interaction: discord.Interaction):
            await interaction.response.send_modal(EvalReportModal(self, chunk))
        return handler

    async def render(self, interaction: discord.Interaction, notice: str | None = None):
        embed = self._build()
        await interaction.response.edit_message(content=notice, embed=embed, view=self)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.evaluator_id

    async def on_cancel(self, interaction: discord.Interaction):
        self.stop()
        await interaction.response.edit_message(content="評価シートの記入を中止しました。", embed=None, view=None)

    async def on_submit(self, interaction: discord.Interaction):
        if not self._is_complete():
            await self.render(interaction, notice="⚠️ 未入力の項目があります。")
            return
        # 記入中に送信先が変わっていても最新の送信先に送る
        sheet = await get_sheet(interaction.guild_id, self.settings["id"])
        if sheet is None:
            self.stop()
            await interaction.response.edit_message(content="このシートは削除されました。", embed=None, view=None)
            return
        channel_id = sheet.get("output_channel_id")
        channel = interaction.guild.get_channel(channel_id) if channel_id else None
        if channel is None:
            await self.render(interaction, notice="⚠️ 送信先チャンネルが設定されていません。管理者にダッシュボードでの設定を依頼してください。")
            return

        await interaction.response.defer()
        name = self.settings["name"]
        embeds = build_report_embeds(self.target, interaction.user, self.verdict, self.items, self.answers, self.ratings, name)
        try:
            if isinstance(channel, discord.ForumChannel):
                tags = [channel.available_tags[0]] if channel.flags.require_tag and channel.available_tags else []
                created = await channel.create_thread(
                    name=f"{self.target.display_name} の{name}"[:100], embed=embeds[0], applied_tags=tags
                )
                dest, first_msg = created.thread, created.message
            else:
                dest = channel
                first_msg = await channel.send(embed=embeds[0])
            for extra in embeds[1:]:
                await dest.send(embed=extra)
        except discord.Forbidden:
            await interaction.edit_original_response(
                content=f"❌ {channel.mention} に送信する権限がBotにありません。", embed=self._build(), view=self
            )
            return
        except Exception as e:
            print(f"[EvalReport Error] Failed to send report: {e}")
            await interaction.edit_original_response(content=f"❌ 送信に失敗しました: {e}", embed=self._build(), view=self)
            return

        self.stop()
        await interaction.edit_original_response(
            content=f"✅ {self.target.mention} の{name}を送信しました。\n{first_msg.jump_url}", embed=None, view=None
        )


async def open_report_form(interaction: discord.Interaction, sheet_id: int | None):
    """パネルのボタンから、そのシートの記入画面を本人にだけ見える形で開く。"""
    try:
        bot = interaction.client
        if not has_evaluator_role(bot, interaction.user):
            await interaction.response.send_message("評価シートを記入する権限がありません（評価員ロールが必要です）。", ephemeral=True)
            return
        sheet = await get_sheet(interaction.guild_id, sheet_id)
        if sheet is None:
            await interaction.response.send_message("このパネルのシートは削除されました。", ephemeral=True)
            return
        if not sheet["items"]:
            await interaction.response.send_message("評価項目が設定されていません。管理者にダッシュボードでの設定を依頼してください。", ephemeral=True)
            return
        view = EvalReportFormView(bot, sheet, interaction.user.id)
        await interaction.response.send_message(embed=view._build(), view=view, ephemeral=True)
    except Exception as e:
        print(f"[EvalReport Error] {e}")
        if not interaction.response.is_done():
            await interaction.response.send_message(f"❌ エラーが発生しました: {e}", ephemeral=True)


class EvalReportOpenButton(discord.ui.DynamicItem[discord.ui.Button], template=r"eval_report:(?P<sheet_id>[0-9]+)"):
    """シートごとに固有の custom_id を持つ記入ボタン。"""

    def __init__(self, sheet_id: int, label: str = DEFAULT_BUTTON_LABEL):
        super().__init__(discord.ui.Button(
            label=label[:80],
            emoji="📝",
            style=discord.ButtonStyle.primary,
            custom_id=f"eval_report:{sheet_id}",
        ))
        self.sheet_id = sheet_id

    @classmethod
    async def from_custom_id(cls, interaction: discord.Interaction, item: discord.ui.Button, match, /):
        return cls(int(match["sheet_id"]))

    async def callback(self, interaction: discord.Interaction):
        await open_report_form(interaction, self.sheet_id)


class LegacyEvalReportPanelView(discord.ui.View):
    """シート番号の無い、複数シート対応前に設置したパネル。最初に作ったシートを開く。"""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label=DEFAULT_BUTTON_LABEL, emoji="📝", style=discord.ButtonStyle.primary, custom_id="eval_report:open")
    async def open_form(self, interaction: discord.Interaction, button: discord.ui.Button):
        await open_report_form(interaction, None)


class EvalReport(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(LegacyEvalReportPanelView())
        self.bot.add_dynamic_items(EvalReportOpenButton)

    async def cog_unload(self):
        self.bot.remove_dynamic_items(EvalReportOpenButton)


async def setup(bot):
    await bot.add_cog(EvalReport(bot))
