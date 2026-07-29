"""
cogs/leveling.py - XP・レベリング・デイリー報酬
"""
import discord
from discord.ext import commands
from discord import app_commands
import datetime
import database
from helpers import (
    get_setting, send_log, is_rank_eligible
)
import config
from config import JST
import time


class Leveling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # TCメッセージでのXP付与は cogs/ranking.py の on_message が担当する。
    # （以前ここにも on_message リスナーがあったが、TC XP を二重に付与する重複実装だったため削除）

    # ============================================================
    # /デイリー コマンド
    # ============================================================
    @app_commands.command(name="デイリー", description="デイリー報酬を受け取ります（24時間に1回）")
    async def daily(self, interaction: discord.Interaction):
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        user_id  = interaction.user.id

        await database.ensure_user(guild_id, user_id)
        user_data = await database.get_user(guild_id, user_id)
        now_naive = datetime.datetime.now(JST).replace(tzinfo=None)

        last_daily = user_data.get("last_daily") if user_data else None
        if last_daily:
            diff = now_naive - last_daily
            if diff.total_seconds() < 86400:
                remaining = 86400 - diff.total_seconds()
                h, rem = divmod(int(remaining), 3600)
                m, s = divmod(rem, 60)
                return await interaction.response.send_message(
                    f"⏳ デイリーは **{h}時間{m}分{s}秒** 後に受け取れます。",
                    ephemeral=True
                )

        daily_amount = get_setting(self.bot, "DAILY_COINS", guild_id) or 1000
        currency_name = get_setting(self.bot, "CURRENCY_NAME", guild_id) or "コイン"

        p = await database.get_pool()
        async with p.acquire() as conn:
            await conn.execute(
                "UPDATE users SET balance = balance + $3, last_daily = $4 WHERE guild_id=$1 AND user_id=$2",
                guild_id, user_id, int(daily_amount), now_naive
            )

        new_balance = await database.get_balance(guild_id, user_id)
        embed = discord.Embed(
            title="🎁 デイリー報酬",
            description=f"**+{int(daily_amount):,} {currency_name}** を受け取りました！",
            color=discord.Color.gold()
        )
        embed.add_field(name="現在の残高", value=f"{new_balance:,} {currency_name}", inline=False)
        await interaction.response.send_message(embed=embed)


async def setup(bot):
    await bot.add_cog(Leveling(bot))
