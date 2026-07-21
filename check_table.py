import asyncio
import database

async def main():
    try:
        pool = await database.get_pool(1526517033125023764)
        async with pool.acquire() as conn:
            val = await conn.fetchval("SELECT to_regclass('panel_requests')")
            print("panel_requests exists:", val is not None)
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
