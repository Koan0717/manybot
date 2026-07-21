import asyncio
import os
import aiohttp
from dotenv import load_dotenv

async def main():
    load_dotenv()
    token = os.getenv('DISCORD_BOT_TOKEN') or os.getenv('TOKEN')
    guild_id = '1505398772828471357'
    headers = {'Authorization': f'Bot {token}'}
    async with aiohttp.ClientSession() as session:
        async with session.get(f'https://discord.com/api/v10/guilds/{guild_id}/members?limit=1000', headers=headers) as resp:
            if resp.status == 200:
                members = await resp.json()
                for member in members:
                    username = member['user']['username']
                    if username in ['sora_tyu._.', 'enll_0', 're_se__t', 'vvvlloz']:
                        print(f"User {username} roles: {member['roles']}")
            else:
                print(f"Failed to fetch members: {resp.status}")

asyncio.run(main())
