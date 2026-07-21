import asyncio
from database import get_pool

async def main():
    pool = await get_pool(1505398772828471357)
    async with pool.acquire() as client:
        try:
            val = await client.fetchval("SELECT setting_value FROM bot_settings WHERE setting_key = 'EMBLEM_MASTER_ROLE_IDS'")
            print(f"EMBLEM_MASTER_ROLE_IDS is {val}")
        except Exception as e:
            print(f"ERROR: {e}")

asyncio.run(main())
