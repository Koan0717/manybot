import asyncio
from database import get_pool

async def run():
    p = await get_pool()
    async with p.acquire() as c:
        rows = await c.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'panel_requests'")
        print([r[0] for r in rows])

asyncio.run(run())
