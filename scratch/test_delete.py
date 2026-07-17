import asyncio
from database import get_pool, delete_panel_request

async def run():
    try:
        await delete_panel_request(1, 1502700570396590100)
        print("Success")
    except Exception as e:
        print("Error:", e)

asyncio.run(run())
