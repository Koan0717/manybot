import asyncio
import database

async def main():
    p = await database.get_master_pool()
    try:
        rows = await p.fetch('SELECT guild_id, database_url FROM guild_databases')
        for r in rows:
            print(r['guild_id'], '->', r['database_url'])
    except Exception as e:
        print(f"Error fetching from master DB: {e}")

asyncio.run(main())
