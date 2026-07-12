import discord
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("DISCORD_BOT_TOKEN")

class TestBot(discord.Client):
    async def on_ready(self):
        print(f'Logged in as {self.user}')
        for guild in self.guilds:
            print(f"Testing in guild: {guild.name}")
            try:
                # Try to edit the bot's member object in the guild
                await guild.me.edit(nick="Test Nick")
                print("Nickname change successful.")
                
                # Check if we can edit avatar
                try:
                    with open("test_vc_only.png", "rb") as f:
                        avatar_bytes = f.read()
                    await guild.me.edit(avatar=avatar_bytes)
                    print("Guild avatar change successful!")
                except Exception as e:
                    print(f"Guild avatar change failed: {e}")
            except Exception as e:
                print(f"Error: {e}")
            break
        await self.close()

intents = discord.Intents.default()
client = TestBot(intents=intents)
client.run(TOKEN)
