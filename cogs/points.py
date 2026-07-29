import discord
from discord.ext import commands
from discord import app_commands
import database
import config
import re

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

    @PointGroup.command(name="付与", description="指定したユーザーにイベントポイントを付与します（複数指定可）")
    @app_commands.describe(users="ポイントを付与するユーザー（メンションまたはIDを複数指定可）", amount="付与するポイント数")
    async def add(self, interaction: discord.Interaction, users: str, amount: int):
        if not (config.has_admin_role(self.bot, interaction.user) or config.has_event_manager_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("1以上のポイントを指定してください。", ephemeral=True)
            return

        user_ids = set(re.findall(r'\d{17,19}', users))
        if not user_ids:
            await interaction.response.send_message("ユーザーを正しく指定してください（メンションまたはID）。", ephemeral=True)
            return

        await interaction.response.defer()

        results = []
        for uid_str in user_ids:
            uid = int(uid_str)
            new_points = await database.add_event_points(interaction.guild.id, uid, amount)
            results.append(f"<@{uid}> (残高: **{new_points} P**)")
        
        # ログ送信
        log_desc = f"{interaction.user.mention} が以下のユーザーに **{amount} P** を付与しました。\n" + "\n".join(results)
        if len(log_desc) > 4000:
            log_desc = log_desc[:4000] + "\n... (省略)"

        await config.send_economy_log(
            interaction.guild,
            "🎁 イベントポイント付与",
            log_desc,
            user=interaction.user
        )

        msg = f"以下のユーザーに **{amount} P** のイベントポイントを付与しました！\n" + "\n".join(results)
        if len(msg) > 2000:
            msg = msg[:1900] + "\n... (省略)"
        await interaction.followup.send(msg)

    @PointGroup.command(name="没収", description="指定したユーザーからイベントポイントを没収します（複数指定可）")
    @app_commands.describe(users="ポイントを没収するユーザー（メンションまたはIDを複数指定可）", amount="没収するポイント数")
    async def remove(self, interaction: discord.Interaction, users: str, amount: int):
        if not (config.has_admin_role(self.bot, interaction.user) or config.has_event_manager_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if amount <= 0:
            await interaction.response.send_message("1以上のポイントを指定してください。", ephemeral=True)
            return

        user_ids = set(re.findall(r'\d{17,19}', users))
        if not user_ids:
            await interaction.response.send_message("ユーザーを正しく指定してください（メンションまたはID）。", ephemeral=True)
            return

        await interaction.response.defer()

        results = []
        for uid_str in user_ids:
            uid = int(uid_str)
            current_points = await database.get_event_points(interaction.guild.id, uid)
            if current_points == 0:
                results.append(f"<@{uid}> (すでに 0 P です)")
                continue

            new_points = await database.remove_event_points(interaction.guild.id, uid, amount)
            results.append(f"<@{uid}> (残高: **{new_points} P**)")
        
        # ログ送信
        log_desc = f"{interaction.user.mention} が以下のユーザーから **{amount} P** を没収しました。\n" + "\n".join(results)
        if len(log_desc) > 4000:
            log_desc = log_desc[:4000] + "\n... (省略)"

        await config.send_economy_log(
            interaction.guild,
            "🗑️ イベントポイント没収",
            log_desc,
            user=interaction.user,
            color=discord.Color.red()
        )

        msg = f"以下のユーザーから **{amount} P** のイベントポイントを没収しました！\n" + "\n".join(results)
        if len(msg) > 2000:
            msg = msg[:1900] + "\n... (省略)"
        await interaction.followup.send(msg)

async def setup(bot):
    await bot.add_cog(Points(bot))
