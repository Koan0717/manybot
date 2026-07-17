import asyncio
import discord
import os
from discord.ext import commands
from dotenv import load_dotenv

async def main():
    load_dotenv()
    bot = commands.Bot(command_prefix='!', intents=discord.Intents.default())
    await bot.load_extension('cogs.admin')
    await bot.load_extension('cogs.economy')
    token = os.getenv('DISCORD_BOT_TOKEN')
    if not token:
        print('No token')
        return
    await bot.login(token)
    try:
        print('Syncing...')
        res = await bot.tree.sync()
        print('Synced commands:', [c.name for c in res])
    except Exception as e:
        print('Sync Error:', e)
    finally:
        await bot.close()

asyncio.run(main())
