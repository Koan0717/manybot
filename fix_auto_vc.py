
import asyncio
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    import asyncpg
    import database
    
    pools = await database.get_all_configured_pools()
    
    for i, p in enumerate(pools):
        print(f'Fixing DB pool {i}')
        try:
            async with p.acquire() as conn:
                # Fix auto_vc_config
                try:
                    await conn.execute('ALTER TABLE auto_vc_config DROP CONSTRAINT IF EXISTS auto_vc_config_pkey CASCADE')
                    await conn.execute('ALTER TABLE auto_vc_config ADD PRIMARY KEY (channel_id)')
                    print(f'  auto_vc_config PK fixed')
                except Exception as e:
                    print(f'  auto_vc_config PK error: {e}')
                
                try:
                    await conn.execute('ALTER TABLE auto_vc_config DROP COLUMN IF EXISTS guild_id')
                    print(f'  auto_vc_config guild_id dropped')
                except Exception as e:
                    print(f'  auto_vc_config drop column error: {e}')
                
                # Fix auto_vc_triggers
                try:
                    await conn.execute('ALTER TABLE auto_vc_triggers DROP CONSTRAINT IF EXISTS auto_vc_triggers_pkey CASCADE')
                    await conn.execute('ALTER TABLE auto_vc_triggers ADD PRIMARY KEY (channel_id)')
                    print(f'  auto_vc_triggers PK fixed')
                except Exception as e:
                    print(f'  auto_vc_triggers PK error: {e}')
                
                try:
                    await conn.execute('ALTER TABLE auto_vc_triggers DROP COLUMN IF EXISTS guild_id')
                    print(f'  auto_vc_triggers guild_id dropped')
                except Exception as e:
                    print(f'  auto_vc_triggers drop column error: {e}')
                
        except Exception as e:
            print(f'Error on pool {i}:', e)

asyncio.run(main())

