import asyncio
from database import get_pool

async def run():
    p = await get_pool()
    async with p.acquire() as c:
        rows = await c.fetch('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN (\'panel_requests\', \'custom_ticket_panels\')')
        for r in rows:
            print(r['table_name'], r['column_name'], r['data_type'])

asyncio.run(run())
