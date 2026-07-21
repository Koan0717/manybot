import asyncio
import discord
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    token = os.getenv('DISCORD_BOT_TOKEN') or os.getenv('TOKEN')
    intents = discord.Intents.default()
    bot = discord.Client(intents=intents)
    
    @bot.event
    async def on_ready():
        print("Logged in!")
        for guild in bot.guilds:
            r1 = discord.utils.get(guild.roles, name="【仮】スタンプ統括ロール名")
            r2 = discord.utils.get(guild.roles, name="【仮】スタンプ制作ロール名")
            if r1: print(f"Guild {guild.name}: Found {r1.name} with {len(r1.members)} members")
            if r2: print(f"Guild {guild.name}: Found {r2.name} with {len(r2.members)} members")
        await bot.close()

    await bot.start(token)

asyncio.run(main())
