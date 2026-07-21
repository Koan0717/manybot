import asyncio
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    import database
    pools = await database.get_all_configured_pools()
    
    for i, p in enumerate(pools):
        print(f'Checking DB pool {i} for panel_requests...')
        try:
            async with p.acquire() as conn:
                has_request_id = await conn.fetchval("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'panel_requests' AND column_name = 'request_id'
                    )
                """)
                if has_request_id:
                    print(f'  -> Found old request_id column! Renaming to id...')
                    await conn.execute("ALTER TABLE panel_requests RENAME COLUMN request_id TO id")
                    print(f'  -> Fixed!')
                else:
                    print(f'  -> OK.')
        except Exception as e:
            print(f'Error on pool {i}: {e}')

if __name__ == '__main__':
    asyncio.run(main())
