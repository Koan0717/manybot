import discord
from discord.ext import commands
import asyncio

async def main():
    bot = commands.Bot(command_prefix='!', intents=discord.Intents.default())
    await bot.load_extension('cogs.economy')
    print([cmd.name for cmd in bot.tree.walk_commands()])

asyncio.run(main())
