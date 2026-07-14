import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import get_setting, has_admin_role, has_banker_role, send_log

class Economy(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="balance", description="自分の所持金を確認します（管理者・銀行員は他のユーザーも確認可能）")
    async def balance(self, interaction: discord.Interaction, user: discord.Member = None):
        target_user = user or interaction.user
        if target_user != interaction.user and not (has_admin_role(self.bot, interaction.user) or has_banker_role(self.bot, interaction.user)):
            await interaction.response.send_message("他人の残高を確認する権限がありません。", ephemeral=True)
            return
        bal = await database.get_balance(interaction.guild.id, target_user.id)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        if target_user == interaction.user:
            await interaction.response.send_message(f"あなたの所持金は **{bal} {currency_name}** です。", ephemeral=True)
        else:
            await interaction.response.send_message(f"{target_user.display_name} の所持金は **{bal} {currency_name}** です。", ephemeral=True)

    @app_commands.command(name="pay", description="他のユーザーに通貨を送ります")
    async def pay(self, interaction: discord.Interaction, target: discord.Member, amount: int):
        if amount <= 0:
            await interaction.response.send_message("1以上の金額を指定してください。", ephemeral=True)
            return
        if target.id == interaction.user.id:
            await interaction.response.send_message("自分自身には送金できません。", ephemeral=True)
            return
            
        success = await database.transfer_balance(interaction.guild.id, interaction.user.id, target.id, amount)
        if not success:
            await interaction.response.send_message("残高が不足しています。", ephemeral=True)
            return
            
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        await interaction.response.send_message(f"{target.mention} に **{amount} {currency_name}** を送金しました！")

        # 通貨ログ送信
        embed = discord.Embed(
            title="💸 送金",
            description="ユーザー間で送金が行われました。",
            color=discord.Color.blue(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="送金元", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
        embed.add_field(name="送金先", value=f"{target.mention} ({target.id})", inline=True)
        embed.add_field(name="金額", value=f"{amount:,} {currency_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)

    @app_commands.command(name="初期発行", description="指定したユーザー達、またはロール全員に初期発行額の通貨を付与します。")
    @app_commands.describe(users_mentions="付与するユーザーのメンションを複数指定（任意）", role="付与するロール（全員に付与）（任意）")
    async def initial_issue(self, interaction: discord.Interaction, users_mentions: str = None, role: discord.Role = None):
        if not (has_admin_role(self.bot, interaction.user) or has_banker_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if not users_mentions and not role:
            await interaction.response.send_message("ユーザーのメンションか、ロールのどちらかを指定してください。", ephemeral=True)
            return
            
        await interaction.response.defer()
        
        init_coins = get_setting(self.bot, "INITIAL_COINS") or 30000
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        
        success_users = []
        
        # ユーザーメンションからの付与
        if users_mentions:
            import re
            user_ids = set(re.findall(r'<@!?(\d+)>', users_mentions))
            for uid in user_ids:
                member = interaction.guild.get_member(int(uid))
                if member:
                    await database.add_balance(interaction.guild.id, member.id, init_coins)
                    success_users.append(member.mention)
                    
        # ロールからの付与
        if role:
            for member in role.members:
                await database.add_balance(interaction.guild.id, member.id, init_coins)
                success_users.append(member.mention)
                
        # 重複を排除してユニークなメンションリストにする
        success_users = list(set(success_users))
                
        if not success_users:
            await interaction.followup.send("サーバー内に該当するユーザーが見つかりませんでした。")
            return
            
        msg = f"合計 **{len(success_users)}名** に初期発行額 **{init_coins:,} {currency_name}** を付与しました！"
        await interaction.followup.send(msg)

        # 通貨ログ送信
        embed = discord.Embed(
            title="🏦 初期発行",
            description="管理者または銀行員によって初期発行が行われました。",
            color=discord.Color.green(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=False)
        
        if role:
            embed.add_field(name="対象ロール", value=role.mention, inline=False)
            
        mentions_str = " ".join(success_users)
        if len(mentions_str) > 1024:
            mentions_str = mentions_str[:1021] + "..."
            
        embed.add_field(name="対象者一覧", value=mentions_str, inline=False)
        embed.add_field(name="付与額 (1人あたり)", value=f"{init_coins:,} {currency_name}", inline=False)
        embed.add_field(name="合計付与人数", value=f"{len(success_users)}名", inline=False)
        
        await send_log(self.bot, interaction.guild, "currency", embed)

async def setup(bot):
    await bot.add_cog(Economy(bot))
