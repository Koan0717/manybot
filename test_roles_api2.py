import asyncio
import os
import aiohttp
from dotenv import load_dotenv

async def main():
    load_dotenv()
    token = os.getenv('DISCORD_BOT_TOKEN') or os.getenv('TOKEN')
    guild_id = '1502700570396590100'
    headers = {'Authorization': f'Bot {token}'}
    async with aiohttp.ClientSession() as session:
        async with session.get(f'https://discord.com/api/v10/guilds/{guild_id}/roles', headers=headers) as resp:
            if resp.status == 200:
                roles = await resp.json()
                for role in roles:
                    if role['id'] in ['1503670929287282798', '1503670816879935528']:
                        print(f"Role: {role['name']} (ID: {role['id']})")
            else:
                print(f"Failed to fetch roles: {resp.status}")

asyncio.run(main())
