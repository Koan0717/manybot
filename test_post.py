import asyncio
import aiohttp

async def main():
    async with aiohttp.ClientSession() as session:
        try:
            payload = {"BOT_NICKNAME": "TestBot", "EMBLEM_MASTER_ROLE_IDS": ["1", "2"]}
            async with session.post('http://localhost:3000/api/guilds/1505398772828471357/settings', json=payload) as resp:
                print(f"Status: {resp.status}")
                text = await resp.text()
                print(f"Response: {text}")
        except Exception as e:
            print(f"Error: {e}")

asyncio.run(main())
