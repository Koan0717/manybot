import asyncio
from database import get_pool

async def run():
    p = await get_pool()
    async with p.acquire() as c:
        await c.execute("INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES (1502700570396590100, 1503031654711558185, 'custom_ticket')")
        print('Done')

asyncio.run(run())
