"""
cogs/utility.py - 便利な汎用コマンド群
"""
import discord
from discord.ext import commands
from discord import app_commands
import datetime
from config import JST


class Utility(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ping", description="Botの応答速度（Ping）を確認します")
    async def ping(self, interaction: discord.Interaction):
        latency = round(self.bot.latency * 1000)
        embed = discord.Embed(
            title="🏓 Pong!",
            description=f"応答速度: `{latency}ms`",
            color=discord.Color.green()
        )
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="userinfo", description="指定したユーザーの情報を表示します")
    @app_commands.describe(member="情報を確認したいメンバー（省略時は自分）")
    async def userinfo(self, interaction: discord.Interaction, member: discord.Member = None):
        target = member or interaction.user
        
        # JST変換
        created_at = target.created_at.astimezone(JST).strftime("%Y/%m/%d %H:%M:%S")
        joined_at = target.joined_at.astimezone(JST).strftime("%Y/%m/%d %H:%M:%S") if target.joined_at else "不明"
        
        # ロールリスト（@everyoneを除外）
        roles = [role.mention for role in reversed(target.roles) if role.id != interaction.guild.id]
        role_str = " ".join(roles) if roles else "なし"
        
        embed = discord.Embed(
            title=f"👤 ユーザー情報: {target.display_name}",
            color=target.color if target.color != discord.Color.default() else discord.Color.blue()
        )
        embed.set_thumbnail(url=target.display_avatar.url)
        embed.add_field(name="ユーザー名", value=target.name, inline=True)
        embed.add_field(name="ID", value=target.id, inline=True)
        embed.add_field(name="アカウント作成日", value=created_at, inline=False)
        embed.add_field(name="サーバー参加日", value=joined_at, inline=False)
        embed.add_field(name=f"ロール ({len(roles)}個)", value=role_str, inline=False)
        
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="serverinfo", description="このサーバーの情報を表示します")
    async def serverinfo(self, interaction: discord.Interaction):
        guild = interaction.guild
        created_at = guild.created_at.astimezone(JST).strftime("%Y/%m/%d %H:%M:%S")
        
        # メンバーのオンライン状態（大まか）
        humans = len([m for m in guild.members if not m.bot])
        bots = len([m for m in guild.members if m.bot])
        
        embed = discord.Embed(
            title=f"📊 サーバー情報: {guild.name}",
            color=discord.Color.blurple()
        )
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
            
        embed.add_field(name="オーナー", value=guild.owner.mention if guild.owner else "不明", inline=True)
        embed.add_field(name="サーバーID", value=guild.id, inline=True)
        embed.add_field(name="作成日", value=created_at, inline=False)
        
        embed.add_field(
            name="メンバー数", 
            value=f"総数: {guild.member_count}\n👤人間: {humans}\n🤖Bot: {bots}", 
            inline=True
        )
        
        embed.add_field(
            name="チャンネル数", 
            value=f"総数: {len(guild.channels)}\n📝テキスト: {len(guild.text_channels)}\n🔊ボイス: {len(guild.voice_channels)}", 
            inline=True
        )
        
        embed.add_field(
            name="その他",
            value=f"ロール数: {len(guild.roles)}\n絵文字数: {len(guild.emojis)}",
            inline=True
        )
        
        await interaction.response.send_message(embed=embed)


async def setup(bot):
    await bot.add_cog(Utility(bot))
