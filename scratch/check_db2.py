import asyncio
import asyncpg
import json

DATABASE_URL = "postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch("SELECT guild_id, setting_value FROM bot_settings WHERE setting_key = 'ROOM_PANEL_CONFIGS'")
        for row in rows:
            print(f"Guild {row['guild_id']}: {row['setting_value']}")
    finally:
        await conn.close()

asyncio.run(main())
