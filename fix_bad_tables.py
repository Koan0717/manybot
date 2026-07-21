import asyncio
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    import database
    pools = await database.get_all_configured_pools()
    
    for i, p in enumerate(pools):
        print(f'Checking DB pool {i}...')
        try:
            async with p.acquire() as conn:
                # Check if auto_vc_triggers has channel_id
                has_col = await conn.fetchval("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'auto_vc_triggers' AND column_name = 'channel_id'
                    )
                """)
                
                if not has_col:
                    print(f'  -> auto_vc_triggers is missing channel_id! Dropping bad tables...')
                    await conn.execute("DROP TABLE IF EXISTS auto_vc_triggers CASCADE")
                    await conn.execute("DROP TABLE IF EXISTS auto_vc_config CASCADE")
                    await conn.execute("DROP TABLE IF EXISTS rooms CASCADE")
                    await conn.execute("DROP TABLE IF EXISTS custom_ticket_panels CASCADE")
                    
                    print(f'  -> Recreating with correct schema from database.py...')
                    await database.setup_db_schema(p)
                    print(f'  -> Fixed!')
                else:
                    print(f'  -> Table is fine.')
        except Exception as e:
            print(f'Error on pool {i}: {e}')

if __name__ == '__main__':
    asyncio.run(main())
