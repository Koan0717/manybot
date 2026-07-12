import asyncio
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    import database
    import asyncpg
    p = await database.get_master_pool()
    guild_dbs = await p.fetch('SELECT guild_id, database_url FROM guild_databases')
    
    for r in guild_dbs:
        guild_id = r['guild_id']
        url = r['database_url']
        print(f'\nChecking DB for guild {guild_id}')
        
        try:
            custom_pool = await asyncpg.create_pool(url, min_size=1, max_size=1)
            async with custom_pool.acquire() as conn:
                res = await conn.fetch('SELECT guild_id, COUNT(*) FROM users GROUP BY guild_id')
                for row in res:
                    print(f'guild_id: {row["guild_id"]}, count: {row["count"]}')
            await custom_pool.close()
        except Exception as e:
            print(f'Error on {guild_id}:', e)

asyncio.run(main())
