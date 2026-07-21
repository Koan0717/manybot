import asyncio
from database import get_all_configured_pools

async def main():
    pools = await get_all_configured_pools()
    for p in pools:
        rows = await p.fetch("SELECT guild_id, setting_key, setting_value FROM bot_settings WHERE setting_key LIKE '%EMBLEM%'")
        for r in rows:
            print(dict(r))

asyncio.run(main())
