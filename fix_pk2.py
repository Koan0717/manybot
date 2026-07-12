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
        print(f'Fixing other DB tables for guild {guild_id}')
        
        try:
            custom_pool = await asyncpg.create_pool(url, min_size=1, max_size=1)
            async with custom_pool.acquire() as conn:
                tables_with_pk_guild = [
                    'antigrief_settings', 'evaluation_settings', 'rank_settings', 
                    'vc_coins_settings', 'shop_settings'
                ]
                for t in tables_with_pk_guild:
                    try:
                        await conn.execute(f'UPDATE {t} SET guild_id = $1 WHERE guild_id IS NULL', guild_id)
                        await conn.execute(f'ALTER TABLE {t} DROP CONSTRAINT IF EXISTS {t}_pkey CASCADE')
                        await conn.execute(f'ALTER TABLE {t} ADD PRIMARY KEY (guild_id)')
                    except Exception as e:
                        pass
                        
                try:
                    await conn.execute('UPDATE level_role_rewards SET guild_id = $1 WHERE guild_id IS NULL', guild_id)
                    await conn.execute('ALTER TABLE level_role_rewards DROP CONSTRAINT IF EXISTS level_role_rewards_pkey CASCADE')
                    await conn.execute('ALTER TABLE level_role_rewards ADD PRIMARY KEY (guild_id, level_type, level, role_id)')
                except Exception as e:
                    pass

                try:
                    await conn.execute('UPDATE level_coin_rewards SET guild_id = $1 WHERE guild_id IS NULL', guild_id)
                    await conn.execute('ALTER TABLE level_coin_rewards DROP CONSTRAINT IF EXISTS level_coin_rewards_pkey CASCADE')
                    await conn.execute('ALTER TABLE level_coin_rewards ADD PRIMARY KEY (guild_id, level_type, level)')
                except Exception as e:
                    pass
                
                print(f'Successfully fixed all PKs for {guild_id}')
            await custom_pool.close()
        except Exception as e:
            print(f'Error on {guild_id}:', e)

asyncio.run(main())
