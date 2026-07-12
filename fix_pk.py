import asyncio
import database
import os
from dotenv import load_dotenv
import asyncpg

load_dotenv('.env')

async def main():
    p = await database.get_master_pool()
    guild_dbs = await p.fetch('SELECT guild_id, database_url FROM guild_databases')
    
    for r in guild_dbs:
        guild_id = r['guild_id']
        url = r['database_url']
        print(f'Fixing DB for guild {guild_id}')
        
        try:
            custom_pool = await asyncpg.create_pool(url, min_size=1, max_size=1)
            async with custom_pool.acquire() as conn:
                await conn.execute('UPDATE users SET guild_id = $1 WHERE guild_id IS NULL', guild_id)
                await conn.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey CASCADE')
                await conn.execute('ALTER TABLE users ADD PRIMARY KEY (guild_id, user_id)')
                print(f'Successfully fixed users PK for {guild_id}')
            await custom_pool.close()
        except Exception as e:
            print(f'Error on {guild_id}:', e)

asyncio.run(main())
