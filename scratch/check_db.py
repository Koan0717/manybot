import asyncio
import asyncpg
import json

async def main():
    conn = await asyncpg.connect(user='postgres', password='password', database='manybot', host='127.0.0.1')
    try:
        rows = await conn.fetch("SELECT guild_id, setting_value FROM bot_settings WHERE setting_key = 'ROOM_PANEL_CONFIGS'")
        for row in rows:
            print(f"Guild {row['guild_id']}: {row['setting_value']}")
    finally:
        await conn.close()

asyncio.run(main())
