"""
cogs/leveling.py - XP・レベリング・デイリー報酬
"""
import discord
from discord.ext import commands
from discord import app_commands
import datetime
import database
from helpers import (
    get_setting, send_log, is_rank_eligible,
    check_and_assign_level_roles, check_and_assign_level_coins
)
from config import JST, TC_XP_REWARD, TC_XP_COOLDOWN, MSG_COOLDOWN
import time


class Leveling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """TCメッセージでXP付与"""
        if message.author.bot or not message.guild:
            return

        guild_id = message.guild.id
        user_id  = message.author.id
        now_ts   = time.time()

        # XP有効チェック
        if not get_setting(self.bot, guild_id, "ENABLE_TC_RANK"):
            return
        if not is_rank_eligible(self.bot, message.channel):
            return

        # クールダウンチェック
        key = (guild_id, user_id)
        last_xp = self.bot.tc_xp_cooldowns.get(key, 0)
        if now_ts - last_xp < TC_XP_COOLDOWN:
            return
        self.bot.tc_xp_cooldowns[key] = now_ts

        # XP付与
        new_lv = await database.add_xp(guild_id, user_id, TC_XP_REWARD, "tc")
        if new_lv:
            lv_ch_id = get_setting(self.bot, guild_id, "LEVEL_UP_CHANNEL_ID")
            if lv_ch_id:
                lv_ch = message.guild.get_channel(int(lv_ch_id))
                if lv_ch:
                    await lv_ch.send(
                        f"🎊 {message.author.mention} が **TCレベルアップ！** "
                        f"(Lv.{new_lv-1} → **{new_lv}**)"
                    )
            await check_and_assign_level_roles(self.bot, message.author, "tc", new_lv)
            await check_and_assign_level_coins(self.bot, message.author, "tc", new_lv)

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

        daily_amount = get_setting(self.bot, guild_id, "DAILY_COINS") or 1000
        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"

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
