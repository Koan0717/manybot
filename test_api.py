import asyncio
from database import get_pool

async def main():
    pool = await get_pool(1505398772828471357)
    async with pool.acquire() as client:
        try:
            await client.execute('''
                INSERT INTO panel_requests (guild_id, channel_id, panel_type)
                VALUES (, 0, 'reload_bot_settings')
            ''', 1505398772828471357)
            print("panel_requests insert SUCCESS")
        except Exception as e:
            print(f"panel_requests insert ERROR: {e}")

        try:
            await client.execute('''
                SELECT * FROM shop_settings WHERE guild_id = 
            ''', 1505398772828471357)
            print("shop_settings select SUCCESS")
        except Exception as e:
            print(f"shop_settings select ERROR: {e}")

asyncio.run(main())
