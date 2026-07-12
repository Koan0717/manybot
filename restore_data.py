
import asyncio
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    import database
    import asyncpg
    url = 'postgresql://postgres.nxvdvrebqjrzxcxfrpun:Kakijun06100717@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require'
    old_guild_id = 1502700570396590000
    new_guild_id = 1502700570396590100
    
    try:
        custom_pool = await asyncpg.create_pool(url, min_size=1, max_size=1, statement_cache_size=0)
        async with custom_pool.acquire() as conn:
            old_users = await conn.fetch('SELECT user_id FROM users WHERE guild_id = ' + chr(36) + '1', old_guild_id)
            new_users = await conn.fetch('SELECT user_id FROM users WHERE guild_id = ' + chr(36) + '1', new_guild_id)
            
            old_ids = {r['user_id'] for r in old_users}
            new_ids = {r['user_id'] for r in new_users}
            
            overlap = old_ids.intersection(new_ids)
            print('Overlapping user IDs:', overlap)
            
            if overlap:
                await conn.execute('DELETE FROM users WHERE guild_id = ' + chr(36) + '1 AND user_id = ANY(' + chr(36) + '2::bigint[])', new_guild_id, list(overlap))
                print(f'Deleted {len(overlap)} overlapping new rows.')
            
            await conn.execute('UPDATE users SET guild_id = ' + chr(36) + '1 WHERE guild_id = ' + chr(36) + '2', new_guild_id, old_guild_id)
            print(f'Updated old rows to guild_id {new_guild_id}')
            
            p = await database.get_master_pool()
            await p.execute('DELETE FROM guild_databases WHERE guild_id = ' + chr(36) + '1', old_guild_id)
            print(f'Deleted incorrect guild_id {old_guild_id} from master pool')
            
        await custom_pool.close()
    except Exception as e:
        print(f'Error:', e)

asyncio.run(main())

