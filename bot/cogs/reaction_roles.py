import discord
from discord.ext import commands
import asyncio
import database
import config

class ReactionRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _resolve(self, payload: discord.RawReactionActionEvent):
        """リアクションから (guild, member, role) を求める。対象外なら None。"""
        if not payload.guild_id or payload.user_id == self.bot.user.id:
            return None
        role_id = await database.get_reaction_role(payload.message_id, str(payload.emoji), guild_id=payload.guild_id)
        if not role_id:
            return None
        guild = self.bot.get_guild(payload.guild_id)
        if not guild:
            return None
        member = payload.member or guild.get_member(payload.user_id)
        if member is None:
            try:
                member = await guild.fetch_member(payload.user_id)
            except discord.HTTPException:
                return None
        if member.bot:
            return None
        role = guild.get_role(int(role_id))
        if role is None:
            print(f"[ReactionRoles] role {role_id} not found in guild {guild.id} (message {payload.message_id})")
            await self._report(guild, member, None, f"紐付けられたロール（ID: {role_id}）がサーバーに見つかりません。ロールが削除されていないか確認してください。")
            return None
        return guild, member, role

    async def _report(self, guild: discord.Guild, member: discord.Member, role, reason: str):
        """付与・解除に失敗した理由をサーバーのログに残す。"""
        try:
            from helpers import send_log
            embed = discord.Embed(title="⚠️ リアクションロールの付与に失敗", description=reason, color=discord.Color.orange())
            embed.add_field(name="ユーザー", value=member.mention, inline=True)
            if role is not None:
                embed.add_field(name="ロール", value=role.mention, inline=True)
            await send_log(self.bot, guild, "reaction_role", embed)
        except Exception as e:
            print(f"[ReactionRoles] failed to send log: {e}")

    def _permission_problem(self, guild: discord.Guild, role: discord.Role):
        me = guild.me
        if not me.guild_permissions.manage_roles:
            return "Botに「ロールの管理」権限がありません。"
        if role >= me.top_role:
            return f"ロール {role.mention} がBotの一番上のロール（{me.top_role.mention}）と同じか上にあります。サーバー設定 → ロール で、Botのロールを付与するロールより上に移動してください。"
        if role.managed:
            return f"ロール {role.mention} は連携（BOT・ブースト等）で管理されているため付与できません。"
        return None

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        resolved = await self._resolve(payload)
        if not resolved:
            return
        guild, member, role = resolved
        if role in member.roles:
            return
        problem = self._permission_problem(guild, role)
        if problem:
            print(f"[ReactionRoles] cannot add {role.id} to {member.id} in {guild.id}: {problem}")
            return await self._report(guild, member, role, problem)
        try:
            await member.add_roles(role, reason="リアクションロール")
        except discord.HTTPException as e:
            print(f"[ReactionRoles] add_roles failed: {e}")
            await self._report(guild, member, role, f"ロールの付与でエラーが発生しました: {e}")

    @commands.Cog.listener()
    async def on_raw_reaction_remove(self, payload: discord.RawReactionActionEvent):
        resolved = await self._resolve(payload)
        if not resolved:
            return
        guild, member, role = resolved
        if role not in member.roles:
            return
        problem = self._permission_problem(guild, role)
        if problem:
            print(f"[ReactionRoles] cannot remove {role.id} from {member.id} in {guild.id}: {problem}")
            return await self._report(guild, member, role, problem.replace("付与", "解除"))
        try:
            await member.remove_roles(role, reason="リアクションロール解除")
        except discord.HTTPException as e:
            print(f"[ReactionRoles] remove_roles failed: {e}")
            await self._report(guild, member, role, f"ロールの解除でエラーが発生しました: {e}")

async def setup(bot):
    await bot.add_cog(ReactionRoles(bot))

class CustomRolePanelSetupModal(discord.ui.Modal, title="任意ロールパネル設置"):
    panel_title = discord.ui.TextInput(label="パネルのタイトル", default="ロール付与パネル")
    panel_desc = discord.ui.TextInput(
        label="説明文 (例: 🎮:ゲーム)", 
        style=discord.TextStyle.paragraph, 
        default="以下のリアクションを押してロールを取得してください。"
    )

    async def on_submit(self, interaction: discord.Interaction):
        embed = discord.Embed(title=self.panel_title.value, description=self.panel_desc.value, color=discord.Color.gold())
        msg = await interaction.channel.send(embed=embed)
        await interaction.response.send_message(
            "パネルを設置しました！続けて以下のメニューから、付与するロールと絵文字を紐付けてください。",
            view=ReactionRoleAdminView(msg),
            ephemeral=True
        )

class ReactionRoleAdminView(discord.ui.View):
    def __init__(self, target_message: discord.Message):
        super().__init__(timeout=None)
        self.target_message = target_message

    @discord.ui.select(cls=discord.ui.RoleSelect, placeholder="付与するロールを選択してください...")
    async def select_role(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        selected_role = select.values[0]
        await interaction.response.send_message(
            f"🎯 ロール {selected_role.mention} を選択しました。\n\n"
            f"**対象のパネル（上のメッセージ）に、Discord標準の絵文字ピッカーを使って直接リアクションを付けてください！**\n"
            f"（※スタンプ一覧からの検索機能がそのまま使えます。60秒以内にリアクションをお願いします）", 
            ephemeral=True
        )
        
        def check(payload: discord.RawReactionActionEvent):
            return payload.message_id == self.target_message.id and payload.user_id == interaction.user.id

        try:
            payload = await interaction.client.wait_for('raw_reaction_add', timeout=60.0, check=check)
        except asyncio.TimeoutError:
            try:
                await interaction.followup.send("⏳ タイムアウトしました。もう一度メニューからロールを選び直してください。", ephemeral=True)
            except:
                pass
            return
            
        emoji_str = str(payload.emoji)
        
        try:
            await self.target_message.remove_reaction(payload.emoji, interaction.user)
            await self.target_message.add_reaction(payload.emoji)
        except Exception:
            pass

        await database.add_reaction_role(self.target_message.id, emoji_str, selected_role.id)
        await interaction.followup.send(f"✅ 追加完了！\n絵文字 {emoji_str} にロール {selected_role.mention} を紐付けました！\n続けて別のロールを設定する場合は、上のメニューから再度選択してください。", ephemeral=True)
