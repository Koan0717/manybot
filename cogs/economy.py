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
        await interaction.response.defer(ephemeral=True)
        target_user = user or interaction.user
        if target_user != interaction.user and not (has_admin_role(self.bot, interaction.user) or has_banker_role(self.bot, interaction.user)):
            await interaction.followup.send("他人の残高を確認する権限がありません。", ephemeral=True)
            return
        bal = await database.get_balance(interaction.guild.id, target_user.id)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        if target_user == interaction.user:
            await interaction.followup.send(f"あなたの所持金は **{bal} {currency_name}** です。", ephemeral=True)
        else:
            await interaction.followup.send(f"{target_user.display_name} の所持金は **{bal} {currency_name}** です。", ephemeral=True)

    @app_commands.command(name="pay", description="1人または複数のユーザーに通貨を送ります")
    @app_commands.describe(
        targets="送金先のユーザー（メンションまたはIDをスペース区切りで複数指定可能）",
        amount="1人あたりの送金額"
    )
    async def pay(self, interaction: discord.Interaction, targets: str, amount: int):
        await interaction.response.defer()

        if amount <= 0:
            await interaction.followup.send("1以上の金額を指定してください。", ephemeral=True)
            return

        import re
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"

        # メンションまたはIDからユーザーIDを抽出し重複排除
        raw_ids = set(re.findall(r'\d{17,19}', targets))
        if not raw_ids:
            await interaction.followup.send("送金先のユーザーが見つかりませんでした。メンションまたはIDで指定してください。", ephemeral=True)
            return

        target_members = []
        not_found = []
        for uid_str in raw_ids:
            uid = int(uid_str)
            if uid == interaction.user.id:
                continue  # 自分自身はスキップ
            member = interaction.guild.get_member(uid)
            if member:
                target_members.append(member)
            else:
                not_found.append(uid_str)

        if not target_members:
            await interaction.followup.send("送金先のユーザーがサーバー内に見つかりませんでした。", ephemeral=True)
            return

        success_members = []
        failed_members = []
        for member in target_members:
            ok = await database.transfer_balance(interaction.guild.id, interaction.user.id, member.id, amount)
            if ok:
                success_members.append(member)
            else:
                failed_members.append(member)

        if not success_members:
            await interaction.followup.send("残高が不足しているため送金できませんでした。", ephemeral=True)
            return

        mentions_str = " ".join(m.mention for m in success_members)
        if len(success_members) == 1:
            msg = f"💵 {mentions_str} に **{amount:,} {currency_name}** を送金しました。"
        else:
            msg = f"💵 {mentions_str} の計 **{len(success_members)}名** に **{amount:,} {currency_name}**（合計 **{amount * len(success_members):,} {currency_name}**）を送金しました。"

        if failed_members:
            msg += f"\n⚠️ 残高不足により {len(failed_members)}名 への送金は失敗しました。"
        if not_found:
            msg += f"\n⚠️ サーバーに存在しないため {len(not_found)}名 はスキップしました。"

        if len(msg) > 2000:
            msg = msg[:1900] + "\n... (省略)"
        await interaction.followup.send(msg)

        # 通貨ログ送信
        embed = discord.Embed(
            title="💸 送金",
            description=f"ユーザー間で送金が行われました。",
            color=discord.Color.blue(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="送金元", value=f"{interaction.user.mention} ({interaction.user.id})", inline=False)
        targets_val = "\n".join(f"{m.mention} ({m.id})" for m in success_members)
        if len(targets_val) > 1024:
            targets_val = targets_val[:1021] + "..."
        embed.add_field(name=f"送金先 ({len(success_members)}名)", value=targets_val, inline=False)
        embed.add_field(name="1人あたりの金額", value=f"{amount:,} {currency_name}", inline=True)
        embed.add_field(name="合計金額", value=f"{amount * len(success_members):,} {currency_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)

    @app_commands.command(name="初期発行", description="指定したユーザー達、またはロール全員に初期発行額の通貨を付与します。")
    @app_commands.describe(users="付与するユーザー達（メンションまたはIDを複数指定）", role="付与するロール（全員に付与）（任意）")
    async def initial_issue(self, interaction: discord.Interaction, users: str = None, role: discord.Role = None):
        if not (has_admin_role(self.bot, interaction.user) or has_banker_role(self.bot, interaction.user)):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return

        if not users and not role:
            await interaction.response.send_message("ユーザーか、ロールのどちらかを指定してください。", ephemeral=True)
            return
            
        await interaction.response.defer()
        
        init_coins = get_setting(self.bot, "INITIAL_COINS") or 30000
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        
        success_users = []
        skipped_users = []

        # 初期発行は1人につき1回のみ（initial_issued フラグで冪等化）
        async def _issue(member):
            if await database.check_initial_issued(interaction.guild.id, member.id):
                skipped_users.append(member.mention)
                return
            await database.add_balance(interaction.guild.id, member.id, init_coins)
            await database.set_initial_issued(interaction.guild.id, member.id)
            success_users.append(member.mention)

        # ユーザー指定からの付与
        if users:
            import re
            user_ids = set(re.findall(r'\d{17,19}', users))
            for uid_str in user_ids:
                uid = int(uid_str)
                member = interaction.guild.get_member(uid)
                if member:
                    await _issue(member)

        # ロールからの付与
        if role:
            for member in role.members:
                await _issue(member)

        # 重複を排除してユニークなメンションリストにする
        success_users = list(set(success_users))
        skipped_users = list(set(skipped_users))

        if not success_users:
            if skipped_users:
                await interaction.followup.send(f"対象者は全員すでに初期発行済みのため、付与しませんでした。（{len(skipped_users)}名）")
            else:
                await interaction.followup.send("サーバー内に該当するユーザーが見つかりませんでした。")
            return
            
        users_str = " ".join(success_users)
        if len(success_users) == 1:
            msg = f"💵 {users_str} に初期発行額 **{init_coins:,} {currency_name}** を付与しました。"
        else:
            msg = f"💵 {users_str} の計**{len(success_users)}名**に初期発行額 **{init_coins:,} {currency_name}** を付与しました。"

        if skipped_users:
            msg += f"\n（すでに発行済みのため **{len(skipped_users)}名** はスキップしました）"

        if len(msg) > 2000:
            msg = msg[:1900] + "\n... (省略)"
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
