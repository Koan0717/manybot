import asyncio
from database import get_pool

async def run():
    p = await get_pool()
    async with p.acquire() as c:
        rows = await c.fetch('SELECT * FROM custom_ticket_panels')
        for r in rows:
            print(dict(r))

asyncio.run(run())
