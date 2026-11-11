"""
スラッシュコマンドの同期（どう森BOTと同じアプリで共存するためのもの）

どう森BOT（discord.js）は ManyBot と同じトークンで動き、どう森サーバーにだけ
自分のスラッシュコマンドを登録する。discord.py の tree.sync(guild=...) は
「そのサーバーのコマンドを丸ごと上書き」するので、そのままだとどう森のコマンドが消えてしまう。

そこで、どう森サーバー（環境変数 DOUMORI_GUILD_ID、カンマ区切りで複数可）では、
ManyBot のコマンドに加えて、既に登録されている ManyBot 以外のコマンドをそのまま残して上書きする。
それ以外のサーバーは従来どおり tree.sync で同期する。
"""
import os

import discord
from discord import app_commands


def doumori_guild_ids() -> set:
    # .env の読み込み（load_dotenv）より前に import されても良いように、呼ばれたときに読む
    raw = os.getenv("DOUMORI_GUILD_ID", "1526696870724894780")
    return {int(x) for x in raw.split(",") if x.strip().isdigit()}

# 既存コマンドを送り直すときに使うキー（id・version などのサーバー側の値は送らない）
_PAYLOAD_KEYS = (
    "type", "name", "name_localizations", "description", "description_localizations",
    "options", "default_member_permissions", "nsfw", "contexts", "integration_types",
)


async def sync_guild_commands(bot: discord.Client, guild: discord.abc.Snowflake) -> list:
    """グローバルのコマンドをこのサーバーにコピーして同期する。同期したコマンドの一覧を返す"""
    tree = bot.tree
    tree.copy_global_to(guild=guild)

    if guild.id not in doumori_guild_ids():
        return await tree.sync(guild=guild)

    commands = tree._get_all_commands(guild=guild)
    if tree.translator:
        payload = [await c.get_translated_payload(tree, tree.translator) for c in commands]
    else:
        payload = [c.to_dict(tree) for c in commands]

    ours = {(p["name"], p.get("type", 1)) for p in payload}
    existing = await bot.http.get_guild_commands(bot.application_id, guild.id)
    kept = []
    for c in existing:
        if (c["name"], c.get("type", 1)) in ours:
            continue
        payload.append({k: c[k] for k in _PAYLOAD_KEYS if c.get(k) is not None})
        kept.append(c["name"])
    if kept:
        print(f"[OK] Guild {guild.id}: kept {len(kept)} commands of the other bot (どう森BOT).")

    data = await bot.http.bulk_upsert_guild_commands(bot.application_id, guild.id, payload=payload)
    return [app_commands.AppCommand(data=d, state=tree._state) for d in data]
