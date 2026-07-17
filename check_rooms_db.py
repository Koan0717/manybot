import asyncio
import asyncpg
import os
from dotenv import load_dotenv
import json

load_dotenv()

async def main():
    pool = await asyncpg.create_pool(os.getenv("DATABASE_URL"))
    urls = await pool.fetch("SELECT DISTINCT database_url FROM guild_databases")
    for r in urls:
        url = r['database_url']
        p2 = await asyncpg.create_pool(url)
        try:
            settings = await p2.fetch("SELECT guild_id, setting_key, setting_value FROM bot_settings WHERE setting_key = 'ROOM_PRICES'")
            for s in settings:
                print("Guild", s['guild_id'])
                print(s['setting_value'])
                # simulate parse
                db_settings = json.loads(s['setting_value'])
                parsed = {}
                for rt, durs in db_settings.items():
                    parsed[rt] = {}
                    for dur, data in durs.items():
                        parsed[rt][int(dur)] = data
                print("ゲームVC 12:", parsed.get("ゲームVC", {}).get(12, {}).get("price"))
            
            # also check role_room_prices
            role_prices = await p2.fetch("SELECT * FROM role_room_prices")
            if role_prices:
                print("Role Prices:")
                for rp in role_prices:
                    print(dict(rp))
        except Exception as e:
            print("Error on", url, e)
        await p2.close()
    await pool.close()

asyncio.run(main())
