import asyncio
import database

async def main():
    try:
        pool = await database.get_pool(1526517033125023764)
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'custom_ticket_panels'")
            columns = [r['column_name'] for r in rows]
            print("Sakekasu Columns:", columns)
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
