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
    if report["pdf_name"]:
        embed.add_field(name="添付", value=f"📎 {report['pdf_name']}"[:1024], inline=False)
    embed.set_footer(text=f"{guild.name} から送信")
    embed.timestamp = discord.utils.utcnow()
    return embed


async def send_circle_report(bot: commands.Bot, guild: discord.Guild, report_id: int):
    """レポートを送信先の全員に DM で送り、結果を DB に保存する。"""
    p = await ensure_circle_schema(guild.id)
    async with p.acquire() as conn:
        report = await conn.fetchrow(
            "SELECT id, title, content, pdf_name, pdf_data FROM circle_reports WHERE id = $1 AND guild_id = $2",
            report_id, guild.id,
        )
        settings = await conn.fetchrow(
            "SELECT circle_name, recipient_user_ids FROM circle_settings WHERE guild_id = $1",
            guild.id,
        )
    if not report:
        return

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


class CircleReport(commands.Cog):
    def __init__(self, bot):
        self.bot = bot


async def setup(bot):
    await bot.add_cog(CircleReport(bot))
