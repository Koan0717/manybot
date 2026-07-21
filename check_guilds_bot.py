import asyncio
import discord
from discord.ext import commands
import config

intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    for g in bot.guilds:
        print(f"Guild: {g.name} ({g.id})")
    await bot.close()

bot.run(config.DISCORD_TOKEN)
