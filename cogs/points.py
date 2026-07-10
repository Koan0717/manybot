import discord
from discord.ext import commands
from discord import app_commands
import database
import config

class Points(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    PointGroup = app_commands.Group(name="ポイント", description="イベント専用ポイントの管理を行います")

    @PointGroup.command(name="残高", description="イベントポイントの残高を確認します（管理者は他のユーザーも確認可能）")
    @app_commands.describe(user="確認するユーザー（指定しない場合は自分自身）")
    async def balance(self, interaction: discord.Interaction, user: discord.Member = None):
        target_user = user or interaction.user
        
        # 本人以外の場合は、管理者またはイベンター統括ロールが必要
        if target_user != interaction.user and not (config.has_admin_role(self.bot, interaction.user) or config.has_event_manager_role(self.bot, interaction.user)):
            await interaction.response.send_message("他人の残高を確認する権限がありません。", ephemeral=True)
            return

        points = await database.get_event_points(interaction.guild.id, target_user.id)
        if target_user == interaction.user:
            await interaction.response.send_message(f"あなたのイベントポイント残高は **{points} P** です。", ephemeral=True)
        else:
            await interaction.response.send_message(f"{target_user.display_name} のイベントポイント残高は **{points} P** です。", ephemeral=True)

    @PointGroup.command(name="付与", description="指定したユーザーにイベントポイントを付与します")
    @app_commands.describe(user="ポイントを付与するユーザー", amount="付与するポイント数")
    async def add(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        if not (config.has_admin_role(self.bot, interaction.user) or config.has_event_manager_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("1以上のポイントを指定してください。", ephemeral=True)
            return

        new_points = await database.add_event_points(interaction.guild.id, user.id, amount)
        
        # ログ送信
        await config.send_economy_log(
            interaction.guild,
            "🎁 イベントポイント付与",
            f"{interaction.user.mention} が {user.mention} に **{amount} P** を付与しました。\n現在の残高: **{new_points} P**",
            user=interaction.user
        )

        await interaction.response.send_message(f"{user.mention} に **{amount} P** のイベントポイントを付与しました！（現在の残高: **{new_points} P**）")

    @PointGroup.command(name="没収", description="指定したユーザーからイベントポイントを没収します")
    @app_commands.describe(user="ポイントを没収するユーザー", amount="没収するポイント数")
    async def remove(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        if not (config.has_admin_role(self.bot, interaction.user) or config.has_event_manager_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("1以上のポイントを指定してください。", ephemeral=True)
            return

        current_points = await database.get_event_points(interaction.guild.id, user.id)
        if current_points == 0:
            await interaction.response.send_message(f"{user.display_name} のイベントポイントは既に 0 P です。", ephemeral=True)
            return

        new_points = await database.remove_event_points(interaction.guild.id, user.id, amount)
        
        # ログ送信
        await config.send_economy_log(
            interaction.guild,
            "🗑️ イベントポイント没収",
            f"{interaction.user.mention} が {user.mention} から **{amount} P** を没収しました。\n現在の残高: **{new_points} P**",
            user=interaction.user,
            color=discord.Color.red()
        )

        await interaction.response.send_message(f"{user.mention} から **{amount} P** のイベントポイントを没収しました！（現在の残高: **{new_points} P**）")

async def setup(bot):
    await bot.add_cog(Points(bot))
