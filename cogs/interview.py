import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import (
    get_setting, get_role_by_setting, has_interviewer_role,
    NEW_MEMBER_ROLE_NAME, PENDING_MEMBER_ROLE_NAME, send_log
)

class InterviewNicknameModal(discord.ui.Modal, title='入界手続き：名前の設定'):
    name_input = discord.ui.TextInput(label='サーバーでの名前（ニックネーム）', placeholder='例: ヤマダ太郎', max_length=32, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        new_role = get_role_by_setting(bot, interaction.guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
        pending_role = get_role_by_setting(bot, interaction.guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
        
        if not new_role:
            await interaction.followup.send(f"エラー: ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。", ephemeral=True)
            return
        if new_role in interaction.user.roles:
            await interaction.followup.send("既に手続きは完了しています。", ephemeral=True)
            return
            
        try:
            nick_success = True
            try:
                await interaction.user.edit(nick=self.name_input.value)
            except discord.Forbidden:
                nick_success = False

            await interaction.user.add_roles(new_role)
            if pending_role and pending_role in interaction.user.roles:
                await interaction.user.remove_roles(pending_role)
                
            initial_coins = get_setting(bot, "INITIAL_COINS") or 30000
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            await database.add_balance(interaction.guild.id, interaction.user.id, initial_coins)
            await database.mark_initial_issued(interaction.guild_id, interaction.user.id)

            # 通貨ログ送信
            embed_log = discord.Embed(
                title="🪙 初期給与 (自己入界)",
                description="新規ユーザーの自己入界手続きに伴い、初期給与が発行されました。",
                color=discord.Color.gold(),
                timestamp=discord.utils.utcnow()
            )
            embed_log.add_field(name="対象者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
            embed_log.add_field(name="発行額", value=f"{initial_coins:,} {currency_name}", inline=True)
            await send_log(bot, interaction.guild, "currency", embed_log)
            
            if nick_success:
                await interaction.followup.send(f"✅ 完了！名前を「{self.name_input.value}」にし、{initial_coins} {currency_name} を発行しました。", ephemeral=True)
            else:
                await interaction.followup.send(f"✅ 完了！{initial_coins} {currency_name} を発行しました。（名前変更は権限不足のためスキップされました）", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}。Botのロール順位等を確認してください。", ephemeral=True)

class InterviewPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="入界手続きを開始", style=discord.ButtonStyle.success, emoji="📝", custom_id="persistent_interview_btn")
    async def start_button(self, interaction, button):
        await interaction.response.send_modal(InterviewNicknameModal())

class InterviewerGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="面接官", description="面接官専用コマンド")
        self.bot = bot

    @app_commands.command(name="help", description="面接官コマンドの使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🎤 面接官用コマンドの使い方",
            description="新規メンバーの入界手続きの処理を行うことができます。",
            color=discord.Color.blue()
        )
        embed.add_field(name="1. /面接官 入界許可実行", value="このチャンネルに名前を書き込んだ待機メンバーの入界手続き（仮ロール付与、初期通貨付与、ログ出力など）を完了します。", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)


    @app_commands.command(name="チャット削除", description="【面接官専用】チャンネル内のメッセージを指定された件数分、一括削除します")
    @app_commands.describe(count="削除するメッセージの件数")
    async def clear_chat(self, interaction: discord.Interaction, count: int):
        bot = self.bot
        if not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)
            
        if count <= 0:
            return await interaction.response.send_message("1以上の件数を指定してください。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=count)
        await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)

    def has_interviewer_permission(self):
        async def predicate(interaction: discord.Interaction):
            if not interaction.guild: return False
            if has_interviewer_role(self.bot, interaction.user):
                return True
            await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)
            return False
        return app_commands.check(predicate)

    @app_commands.command(name="入界許可実行", description="【面接官専用】このチャンネルで名前を記入した待機メンバーの入界手続きを完了します")
    async def execute_interview(self, interaction: discord.Interaction):
        bot = self.bot
        if not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)

        await interaction.response.defer(ephemeral=True)
        new_role = get_role_by_setting(bot, interaction.guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
        pending_role = get_role_by_setting(bot, interaction.guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
        
        if not new_role:
            return await interaction.followup.send(f"エラー: ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。", ephemeral=True)
        if not pending_role:
            return await interaction.followup.send(f"エラー: ロール「{PENDING_MEMBER_ROLE_NAME}」が見つかりません。", ephemeral=True)
            
        try:
            # --- チャンネル履歴から入界待機者とその希望する名前を自動取得 ---
            user = None
            proposed_nick = None
            try:
                async for message in interaction.channel.history(limit=50):
                    if not message.author.bot and isinstance(message.author, discord.Member):
                        if pending_role in message.author.roles:
                            content = message.content.strip()
                            if content:
                                user = message.author
                                proposed_nick = content
                                break
            except Exception as e:
                print(f"[WARNING] Failed to fetch channel history: {e}")

            if not user:
                return await interaction.followup.send("チャンネル履歴から名前を記入した入界待機者を見つけることができませんでした。", ephemeral=True)

            if new_role in user.roles:
                return await interaction.followup.send(f"{user.display_name} は既に手続きが完了しています。", ephemeral=True)

            nick_change_status = ""
            duplicate_warning = ""
            
            if proposed_nick:
                if len(proposed_nick) > 32:
                    proposed_nick = proposed_nick[:32]
                
                # 重複ユーザーの検索 (対象ユーザー自身は除く、かつ入界待ちロールを持っていない人)
                duplicate_member = None
                target_name_lower = proposed_nick.lower()
                for member in interaction.guild.members:
                    if member.id == user.id:
                        continue
                    # 入界待ちロールを持っている人は重複チェックから除外する
                    if pending_role and pending_role in member.roles:
                        continue
                        
                    m_nick = (member.nick or "").strip().lower()
                    m_disp = (member.display_name or "").strip().lower()
                    m_name = (member.name or "").strip().lower()
                    
                    if m_nick == target_name_lower or m_disp == target_name_lower or m_name == target_name_lower:
                        duplicate_member = member
                        break
                
                # 重複が見つかった場合の処理
                if duplicate_member:
                    try:
                        await interaction.channel.send(
                            f"⚠️ {user.mention} さんの希望した名前「{proposed_nick}」は、すでに鯖内で使用されている名前です。\n別の名前をこのチャンネルに記入してください。\n（※名前が記入されたら、面接官の方は再度コマンドを実行してください）"
                        )
                    except Exception as e:
                        print(f"[WARNING] Failed to send duplicate warning message to channel: {e}")
                    
                    return await interaction.followup.send(f"⚠️ 名前が重複しているため、処理を中断しました。対象ユーザーに別の名前を記入してもらってから再実行してください。", ephemeral=True)
                
                try:
                    await user.edit(nick=proposed_nick)
                    nick_change_status = f"\n✅ 名前を「{proposed_nick}」に変更しました。"
                except discord.Forbidden:
                    nick_change_status = f"\n⚠️ 権限不足のため名前を変更できませんでした（Botのロール順位や権限を確認してください）。"
                except Exception as e:
                    nick_change_status = f"\n❌ 名前変更中にエラーが発生しました: {e}"
            else:
                nick_change_status = "\nℹ️ チャンネル履歴に対象ユーザーのメッセージが見つからなかったため、名前変更はスキップされました。"

            await user.add_roles(new_role)
            if pending_role and pending_role in user.roles:
                await user.remove_roles(pending_role)
                
            initial_coins = get_setting(bot, "INITIAL_COINS") or 30000
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            await database.add_balance(interaction.guild.id, user.id, initial_coins)
            await database.mark_initial_issued(interaction.guild_id, user.id)
            
            await interaction.followup.send(f"✅ {user.mention} の入界手続きを完了しました！（{initial_coins} {currency_name} 発行済み）{nick_change_status}", ephemeral=True)

            # 通貨ログ送信
            embed_log = discord.Embed(
                title="🪙 初期給与 (面接官許可)",
                description="面接官による入界許可に伴い、初期給与が発行されました。",
                color=discord.Color.gold(),
                timestamp=discord.utils.utcnow()
            )
            embed_log.add_field(name="面接官", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
            embed_log.add_field(name="対象者", value=f"{user.mention} ({user.id})", inline=True)
            embed_log.add_field(name="発行額", value=f"{initial_coins:,} {currency_name}", inline=True)
            await send_log(bot, interaction.guild, "currency", embed_log)

            # 面接実績の記録と累計取得
            await database.add_interviewer_log(interaction.user.id, user.id, interaction.guild.id)
            interviewer_count = await database.get_interviewer_count(interaction.user.id)
            
            # 接続VC名の取得
            vc_name = "❌ VC未接続"
            if interaction.user.voice and interaction.user.voice.channel:
                vc_name = f"🔊 {interaction.user.voice.channel.name}"

            # 面接官ログ送信
            embed_interviewer = discord.Embed(
                title="📝 面接官アクション: 入界許可",
                description="面接官による入界許可アクションが実行されました。",
                color=discord.Color.purple(),
                timestamp=discord.utils.utcnow()
            )
            embed_interviewer.add_field(name="面接官", value=f"{interaction.user.mention} (ID: {interaction.user.id})", inline=False)
            embed_interviewer.add_field(name="許可されたユーザー", value=f"{user.mention} (ID: {user.id})", inline=False)
            embed_interviewer.add_field(name="実行場所", value=vc_name, inline=True)
            embed_interviewer.add_field(name="対応実績", value=f"累計 {interviewer_count} 人目の対応", inline=True)
            
            await send_log(bot, interaction.guild, "interviewer", embed_interviewer)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

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
