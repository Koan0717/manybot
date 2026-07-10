"""
cogs/ranking.py - ランク確認・ランキング表示
"""
import discord
from discord.ext import commands
from discord import app_commands
import datetime
import database
from helpers import get_setting, format_jst_datetime
from config import JST


class RankingGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="rank", description="ランク・XP関連コマンド")
        self.bot = bot

    @app_commands.command(name="status", description="自分または指定ユーザーのランクカードを表示します")
    @app_commands.describe(user="確認するユーザー（省略時は自分）")
    async def rank_status(self, interaction: discord.Interaction, user: discord.Member = None):
        if not interaction.guild:
            return
        await interaction.response.defer()

        target = user or interaction.user
        guild_id = interaction.guild.id
        user_id  = target.id

        await database.ensure_user(guild_id, user_id)
        user_data = await database.get_user(guild_id, user_id)
        if not user_data:
            return await interaction.followup.send("データが見つかりません。", ephemeral=True)

        tc_xp  = user_data.get("tc_xp", 0)
        tc_lv  = user_data.get("tc_level", 1)
        vc_xp  = user_data.get("vc_xp", 0)
        vc_lv  = user_data.get("vc_level", 1)

        # 次のレベルに必要なXP計算
        def xp_to_next(current_lv: int) -> int:
            req = 100
            for _ in range(current_lv - 1):
                req = int(req * 1.15)
            return req

        def xp_in_level(total_xp: int, lv: int) -> int:
            used = 0
            req = 100
            for _ in range(lv - 1):
                used += req
                req = int(req * 1.15)
            return total_xp - used

        tc_next = xp_to_next(tc_lv)
        tc_cur  = xp_in_level(tc_xp, tc_lv)
        vc_next = xp_to_next(vc_lv)
        vc_cur  = xp_in_level(vc_xp, vc_lv)

        # 評価浮上時間
        eval_cat_id = get_setting(self.bot, guild_id, "EVALUATION_CATEGORY_ID")
        eval_time_str = "0時間0分"
        if eval_cat_id:
            stay_sec = await database.get_vc_duration_for_categories(guild_id, user_id, [int(eval_cat_id)])
            # リアルタイム追加
            session = self.bot.vc_sessions.get(user_id)
            if session and session.get("guild_id") == guild_id:
                if target.voice and target.voice.channel and target.voice.channel.category:
                    if target.voice.channel.category.id == int(eval_cat_id):
                        extra = int((datetime.datetime.now(JST) - session["join_time"]).total_seconds())
                        stay_sec += extra
            h, rem = divmod(stay_sec, 3600)
            m = rem // 60
            eval_time_str = f"{h}時間{m}分"

        # ランキング順位
        tc_top = await database.get_top_users(guild_id, "tc", limit=9999)
        vc_top = await database.get_top_users(guild_id, "vc", limit=9999)
        tc_rank = next((i+1 for i, u in enumerate(tc_top) if u["user_id"] == user_id), "?")
        vc_rank = next((i+1 for i, u in enumerate(vc_top) if u["user_id"] == user_id), "?")

        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        balance = await database.get_balance(guild_id, user_id)

        embed = discord.Embed(
            title=f"📊 {target.display_name} のランクカード",
            color=discord.Color.from_str("#7289da")
        )
        embed.set_thumbnail(url=target.display_avatar.url)
        embed.add_field(
            name="💬 TCランク",
            value=(
                f"Lv.**{tc_lv}** (#{tc_rank})\n"
                f"XP: {tc_cur:,} / {tc_next:,}\n"
                f"累計: {tc_xp:,} XP"
            ),
            inline=True
        )
        embed.add_field(
            name="🎙️ VCランク",
            value=(
                f"Lv.**{vc_lv}** (#{vc_rank})\n"
                f"XP: {vc_cur:,} / {vc_next:,}\n"
                f"累計: {vc_xp:,} XP"
            ),
            inline=True
        )
        embed.add_field(
            name="⏱️ 評価浮上時間",
            value=eval_time_str,
            inline=False
        )
        embed.add_field(
            name=f"💰 {currency_name}",
            value=f"{balance:,} {currency_name}",
            inline=False
        )
        await interaction.followup.send(embed=embed)

    @app_commands.command(name="top", description="TCまたはVCのランキング上位10名を表示します")
    @app_commands.describe(type="ランキング種別（tc または vc）")
    @app_commands.choices(type=[
        app_commands.Choice(name="TC（テキスト）", value="tc"),
        app_commands.Choice(name="VC（ボイス）",   value="vc"),
    ])
    async def rank_top(self, interaction: discord.Interaction, type: str = "tc"):
        if not interaction.guild:
            return
        await interaction.response.defer()

        guild_id = interaction.guild.id
        top = await database.get_top_users(guild_id, type, limit=10)

        emoji = "💬" if type == "tc" else "🎙️"
        embed = discord.Embed(
            title=f"{emoji} {type.upper()} ランキング TOP 10",
            color=discord.Color.gold()
        )

        medals = ["🥇", "🥈", "🥉"]
        for i, entry in enumerate(top):
            member = interaction.guild.get_member(entry["user_id"])
            name = member.display_name if member else f"ID:{entry['user_id']}"
            prefix = medals[i] if i < 3 else f"**#{i+1}**"
            embed.add_field(
                name=f"{prefix} {name}",
                value=f"Lv.**{entry['level']}** | {entry['xp']:,} XP",
                inline=False
            )

        if not top:
            embed.description = "まだランキングデータがありません。"

        await interaction.followup.send(embed=embed)


class Ranking(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(RankingGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("rank")


async def setup(bot):
    await bot.add_cog(Ranking(bot))
