import discord
from discord.ext import commands
from discord import app_commands
import random
import database
from helpers import get_setting


class GachaCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ガチャ", description="福引ガチャを引きます")
    async def gacha(self, interaction: discord.Interaction):
        guild = interaction.guild
        member = interaction.user
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"

        settings = await database.get_gacha_settings(guild.id)

        if not settings.get("is_enabled", True):
            await interaction.response.send_message("現在、福引ガチャは無効になっています。", ephemeral=True)
            return

        allowed_role_ids = settings.get("allowed_role_ids") or []
        if allowed_role_ids:
            member_role_ids = {str(r.id) for r in member.roles}
            if not any(rid in member_role_ids for rid in allowed_role_ids):
                await interaction.response.send_message("あなたは福引ガチャを引く条件を満たしていません。", ephemeral=True)
                return

        prizes = await database.get_gacha_prizes(guild.id)
        if not prizes:
            await interaction.response.send_message("福引ガチャの景品が設定されていません。管理者にお問い合わせください。", ephemeral=True)
            return

        pull_cost = settings.get("pull_cost") or 0
        if pull_cost > 0:
            user_data = await database.get_user(guild.id, member.id)
            balance = user_data["balance"] if user_data else 0
            if balance < pull_cost:
                await interaction.response.send_message(f"所持{currency_name}が足りません。（必要: {pull_cost}{currency_name} / 所持: {balance}{currency_name}）", ephemeral=True)
                return
            await database.add_balance(guild.id, member.id, -pull_cost)

        # 重み付き抽選
        weights = [max(p["weight"], 0) for p in prizes]
        if sum(weights) <= 0:
            await interaction.response.send_message("福引ガチャの設定に問題があります。管理者にお問い合わせください。", ephemeral=True)
            return

        won = random.choices(prizes, weights=weights, k=1)[0]

        # 報酬の付与
        reward_lines = []
        if won.get("reward_coins"):
            await database.add_balance(guild.id, member.id, won["reward_coins"])
            reward_lines.append(f"💰 {won['reward_coins']}{currency_name}")

        if won.get("reward_role_id"):
            role = guild.get_role(won["reward_role_id"])
            if role:
                try:
                    await member.add_roles(role, reason="福引ガチャ当選")
                    reward_lines.append(f"🎗️ {role.name} ロール")
                except Exception as e:
                    print(f"[Gacha] Failed to add reward role: {e}")

        await database.add_gacha_history(guild.id, member.id, won["id"], won["prize_number"], won["prize_name"])

        message = f"🎉 **{won['prize_number']}番『{won['prize_name']}』に当選しました！**"
        if reward_lines:
            message += "\n" + "\n".join(reward_lines)

        await interaction.response.send_message(message, ephemeral=True)


async def setup(bot):
    await bot.add_cog(GachaCog(bot))
