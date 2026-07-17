import asyncio
from database import get_pool, get_custom_ticket_panel
import discord

class MockGuild:
    def __init__(self, id):
        self.id = id

async def run():
    guild = MockGuild(1502700570396590100)
    channel_id = 1503031654711558185
    print("Fetching panel...")
    try:
        panel = await get_custom_ticket_panel(channel_id)
        print("Panel:", panel)
    except Exception as e:
        print("Error:", e)

asyncio.run(run())
