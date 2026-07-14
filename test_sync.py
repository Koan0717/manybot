import asyncio
import discord
import os
from discord.ext import commands
from dotenv import load_dotenv

async def main():
    load_dotenv()
    bot = commands.Bot(command_prefix='!', intents=discord.Intents.default())
    
    cogs_to_load = [
        "cogs.admin",
        "cogs.economy",
        "cogs.leveling",
        "cogs.rooms",
        "cogs.gambling",
        "cogs.interview",
        "cogs.evaluation",
        "cogs.utility",
        "cogs.points",
        "cogs.reaction_roles",
        "cogs.shop",
        "cogs.tickets"
    ]
    for cog in cogs_to_load:
        try:
            await bot.load_extension(cog)
        except Exception as e:
            pass

    token = os.getenv('DISCORD_BOT_TOKEN')
    await bot.login(token)
    try:
        print('Starting sync...')
        guild_ids = [1502700570396590100, 1505398772828471357]
        for gid in guild_ids:
            try:
                guild = discord.Object(id=gid)
                bot.tree.copy_global_to(guild=guild)
                res = await bot.tree.sync(guild=guild)
                print(f'Synced local {gid}: {len(res)} commands')
            except Exception as inner_e:
                print(f"Failed to sync {gid}: {inner_e}")
                
        # Also sync globally
        res_g = await bot.tree.sync()
        print(f'Synced global: {len(res_g)} commands')
    except Exception as e:
        print('Sync Error:', e)
    finally:
        await bot.close()

asyncio.run(main())
