import asyncio
import discord
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    token = os.getenv('DISCORD_BOT_TOKEN') or os.getenv('TOKEN')
    intents = discord.Intents.default()
    intents.members = True
    bot = discord.Client(intents=intents)
    
    @bot.event
    async def on_ready():
        guild = bot.get_guild(1502700570396590100)
        if not guild:
            print("Guild not found")
            await bot.close()
            return
        
        roles = []
        for rid in [1503670929287282798, 1503670816879935528]:
            role = guild.get_role(rid)
            if role:
                roles.append(f"{role.name} ({role.id}) - {len(role.members)} members")
            else:
                roles.append(f"Role {rid} not found")
        print("\n".join(roles))
        await bot.close()

    await bot.start(token)

asyncio.run(main())
