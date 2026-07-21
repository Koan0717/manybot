import asyncio, database
import sys

class FakeGuild:
    def __init__(self, id):
        self.id = id

class FakeInteraction:
    def __init__(self, guild_id):
        self.guild = FakeGuild(guild_id)

async def test():
    interaction = FakeInteraction(1502700570396590100) # Or whatever guild ID, 0 is fine if we just want to test SQL schema
    try:
        await database.save_custom_ticket_panel(
            channel_id=12345,
            panel_title="test",
            panel_description="desc",
            button_label="btn",
            button_emoji=None,
            mention_role_ids=[],
            target_role_ids=[],
            ticket_prefix="ticket"
        )
        print("Success")
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
