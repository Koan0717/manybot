"""
cogs/leveling.py - レベリング Cog
"""
import discord
from discord.ext import commands


class Leveling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # TCメッセージでのXP付与は cogs/ranking.py の on_message が担当します。


async def setup(bot):
    await bot.add_cog(Leveling(bot))

