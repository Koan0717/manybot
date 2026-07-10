"""
cogs/interview.py - 面接・入界フロー
"""
import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import (
    get_setting, get_role_by_setting,
    has_interviewer_role, has_admin_role, send_log
)
from config import INITIAL_COINS_DEFAULT


# ============================================================
# 入界手続きモーダル（自己入界ボタン用）
# ============================================================
class InterviewNicknameModal(discord.ui.Modal, title='入界手続き：名前の設定'):
    name_input = discord.ui.TextInput(
        label='サーバーでの名前（ニックネーム）',
        placeholder='例: ヤマダ太郎',
        max_length=32,
        required=True
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        guild = interaction.guild
        guild_id = guild.id
        user = interaction.user

        new_role_id = get_setting(bot, guild_id, "NEW_MEMBER_ROLE_ID")
        pending_role_id = get_setting(bot, guild_id, "PENDING_MEMBER_ROLE_ID")
        new_role     = guild.get_role(int(new_role_id))     if new_role_id     else None
        pending_role = guild.get_role(int(pending_role_id)) if pending_role_id else None

        if not new_role:
            return await interaction.followup.send("エラー: 新メンバーロールが設定されていません。管理者に連絡してください。", ephemeral=True)
        if new_role in user.roles:
            return await interaction.followup.send("既に手続きは完了しています。", ephemeral=True)

        # 初期コイン発行済みチェック
        if await database.is_initial_issued(guild_id, user.id):
            return await interaction.followup.send("既に初期通貨が発行されています。", ephemeral=True)

        try:
            nick_ok = True
            try:
                await user.edit(nick=self.name_input.value)
            except discord.Forbidden:
                nick_ok = False

            await user.add_roles(new_role)
            if pending_role and pending_role in user.roles:
                await user.remove_roles(pending_role)

            initial_coins = get_setting(bot, guild_id, "INITIAL_COINS") or INITIAL_COINS_DEFAULT
            currency_name = get_setting(bot, guild_id, "CURRENCY_NAME") or "コイン"
            await database.add_balance(guild_id, user.id, int(initial_coins))
            await database.mark_initial_issued(guild_id, user.id)

            # 通貨ログ
            log_embed = discord.Embed(
                title="🪙 初期給与（自己入界）",
                color=discord.Color.gold(),
                timestamp=discord.utils.utcnow()
            )
            log_embed.add_field(name="対象者", value=f"{user.mention} (ID:{user.id})", inline=True)
            log_embed.add_field(name="発行額", value=f"{int(initial_coins):,} {currency_name}", inline=True)
            await send_log(bot, guild, "currency", log_embed)

            msg = (
                f"✅ 完了！名前を「{self.name_input.value}」にし、{int(initial_coins):,} {currency_name} を発行しました。"
                if nick_ok else
                f"✅ 完了！{int(initial_coins):,} {currency_name} を発行しました。（名前変更は権限不足のためスキップ）"
            )
            await interaction.followup.send(msg, ephemeral=True)

        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)


# ============================================================
# 入界手続きパネルView（persistent）
# ============================================================
class InterviewPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="入界手続きを開始",
        style=discord.ButtonStyle.success,
        emoji="📝",
        custom_id="persistent_interview_btn"
    )
    async def start_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(InterviewNicknameModal())


# ============================================================
# /面接官 コマンドグループ
# ============================================================
class InterviewerGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="面接官", description="面接官専用コマンド")
        self.bot = bot

    @app_commands.command(name="help", description="面接官コマンドの使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🎤 面接官コマンド一覧",
            color=discord.Color.blue()
        )
        embed.add_field(
            name="/面接官 入界許可 <ユーザー>",
            value="待機メンバーの入界手続き（ロール付与・初期通貨発行）を完了します。",
            inline=False
        )
        embed.add_field(
            name="/面接官 入界パネル設置",
            value="自己入界ボタンパネルをこのチャンネルに設置します。",
            inline=False
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="入界許可", description="【面接官専用】待機メンバーの入界手続きを完了します")
    @app_commands.describe(user="入界を許可するユーザー")
    async def execute_interview(self, interaction: discord.Interaction, user: discord.Member):
        if not has_interviewer_role(self.bot, interaction.user):
            return await interaction.response.send_message("面接官ロールが必要です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        guild_id = guild.id

        new_role_id     = get_setting(self.bot, guild_id, "NEW_MEMBER_ROLE_ID")
        pending_role_id = get_setting(self.bot, guild_id, "PENDING_MEMBER_ROLE_ID")
        new_role     = guild.get_role(int(new_role_id))     if new_role_id     else None
        pending_role = guild.get_role(int(pending_role_id)) if pending_role_id else None

        if not new_role:
            return await interaction.followup.send("エラー: 新メンバーロールが設定されていません。", ephemeral=True)
        if new_role in user.roles:
            return await interaction.followup.send(f"{user.display_name} は既に手続きが完了しています。", ephemeral=True)

        # 初期コイン発行済みチェック
        if await database.is_initial_issued(guild_id, user.id):
            return await interaction.followup.send(f"{user.display_name} には既に初期通貨が発行されています。", ephemeral=True)

        try:
            # チャンネル履歴から希望ニックネームを取得
            proposed_nick = None
            nick_status = ""
            duplicate_warning = ""

            try:
                async for msg in interaction.channel.history(limit=50):
                    if msg.author.id == user.id and msg.content.strip():
                        proposed_nick = msg.content.strip()[:32]
                        break
            except Exception as e:
                print(f"[WARN] History fetch for nick: {e}")

            if proposed_nick:
                # 重複ニックネームチェック
                dup_member = None
                for m in guild.members:
                    if m.id == user.id:
                        continue
                    if pending_role and pending_role in m.roles:
                        continue
                    names = {(m.nick or "").lower(), m.display_name.lower(), m.name.lower()}
                    if proposed_nick.lower() in names:
                        dup_member = m
                        break

                if dup_member:
                    duplicate_warning = f"\n⚠️ 同名ユーザー {dup_member.mention} ({dup_member.display_name}) が存在します。"
                    try:
                        await interaction.channel.send(
                            f"⚠️ **名前重複警告**: {user.mention} が希望した名前「{proposed_nick}」は既に使用されています。"
                        )
                    except Exception:
                        pass

                try:
                    await user.edit(nick=proposed_nick)
                    nick_status = f"\n✅ 名前を「{proposed_nick}」に変更しました。{duplicate_warning}"
                except discord.Forbidden:
                    nick_status = f"\n⚠️ 権限不足で名前を変更できませんでした。{duplicate_warning}"
                except Exception as e:
                    nick_status = f"\n❌ 名前変更エラー: {e}{duplicate_warning}"
            else:
                nick_status = "\nℹ️ チャンネル履歴にメッセージが見つからなかったため名前変更はスキップ。"

            # ロール付与
            await user.add_roles(new_role)
            if pending_role and pending_role in user.roles:
                await user.remove_roles(pending_role)

            initial_coins = get_setting(self.bot, guild_id, "INITIAL_COINS") or INITIAL_COINS_DEFAULT
            currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
            await database.add_balance(guild_id, user.id, int(initial_coins))
            await database.mark_initial_issued(guild_id, user.id)

            await interaction.followup.send(
                f"✅ {user.mention} の入界手続きを完了！（{int(initial_coins):,} {currency_name} 発行済み）{nick_status}",
                ephemeral=True
            )

            # 通貨ログ
            cur_embed = discord.Embed(
                title="🪙 初期給与（面接官許可）",
                color=discord.Color.gold(),
                timestamp=discord.utils.utcnow()
            )
            cur_embed.add_field(name="面接官", value=f"{interaction.user.mention} (ID:{interaction.user.id})", inline=True)
            cur_embed.add_field(name="対象者", value=f"{user.mention} (ID:{user.id})", inline=True)
            cur_embed.add_field(name="発行額", value=f"{int(initial_coins):,} {currency_name}", inline=True)
            await send_log(self.bot, guild, "currency", cur_embed)

            # 面接ログ記録
            await database.add_interviewer_log(guild_id, interaction.user.id, user.id)
            count = await database.get_interviewer_count(guild_id, interaction.user.id)

            vc_name = "❌ VC未接続"
            if interaction.user.voice and interaction.user.voice.channel:
                vc_name = f"🔊 {interaction.user.voice.channel.name}"

            iv_embed = discord.Embed(
                title="📝 面接官アクション: 入界許可",
                color=discord.Color.purple(),
                timestamp=discord.utils.utcnow()
            )
            iv_embed.add_field(name="面接官",       value=f"{interaction.user.mention} (ID:{interaction.user.id})", inline=False)
            iv_embed.add_field(name="許可されたユーザー", value=f"{user.mention} (ID:{user.id})", inline=False)
            iv_embed.add_field(name="実行場所",     value=vc_name, inline=True)
            iv_embed.add_field(name="対応実績",     value=f"累計 {count} 人目", inline=True)
            await send_log(self.bot, guild, "interviewer", iv_embed)

        except Exception as e:
            await interaction.followup.send(f"❌ エラー: {e}", ephemeral=True)

    @app_commands.command(name="入界パネル設置", description="【管理者専用】自己入界ボタンパネルをこのチャンネルに設置します")
    async def setup_panel(self, interaction: discord.Interaction):
        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        currency_name = get_setting(self.bot, interaction.guild.id, "CURRENCY_NAME") or "コイン"
        initial_coins = get_setting(self.bot, interaction.guild.id, "INITIAL_COINS") or INITIAL_COINS_DEFAULT

        embed = discord.Embed(
            title="📝 入界手続き",
            description=(
                f"下のボタンを押して、サーバーでの名前（ニックネーム）を入力してください。\n"
                f"手続き完了後、**{int(initial_coins):,} {currency_name}** が付与されます。"
            ),
            color=discord.Color.green()
        )
        await interaction.response.send_message("✅ パネルを設置しました。", ephemeral=True)
        await interaction.channel.send(embed=embed, view=InterviewPanelView())


# ============================================================
# Cog 本体
# ============================================================
class Interview(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(InterviewPanelView())
        self.bot.tree.add_command(InterviewerGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("面接官")


async def setup(bot):
    await bot.add_cog(Interview(bot))
