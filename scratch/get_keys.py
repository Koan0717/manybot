import asyncio, asyncpg, os
from dotenv import load_dotenv
load_dotenv()

async def main():
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("No DATABASE_URL found.")
        return
    conn = await asyncpg.connect(db_url)
    rows = await conn.fetch("SELECT DISTINCT setting_key FROM bot_settings")
    print([r[0] for r in rows])
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
