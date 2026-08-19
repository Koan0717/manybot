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
        guild = interaction.guild
        me = guild.me if guild else None
        
        new_role = get_role_by_setting(bot, interaction.guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
        pending_role = get_role_by_setting(bot, interaction.guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
        
        if not new_role:
            await interaction.followup.send(f"❌ エラー: ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。", ephemeral=True)
            return
        if new_role in interaction.user.roles:
            await interaction.followup.send("ℹ️ 既に手続きは完了しています。", ephemeral=True)
            return

        if me:
            if not me.guild_permissions.manage_roles:
                return await interaction.followup.send(
                    "❌ Botに「ロールの管理」権限がありません。\nサーバー管理者にお問い合わせください。",
                    ephemeral=True
                )
            if new_role >= me.top_role:
                return await interaction.followup.send(
                    f"❌ ロール順位エラー: 付与対象のロール「{new_role.name}」がBotの最上位ロール（{me.top_role.name}）以上の位置にあります。\nサーバー設定でBotのロールを「{new_role.name}」より上に移動してください。",
                    ephemeral=True
                )
            
        try:
            nick_success = True
            try:
                await interaction.user.edit(nick=self.name_input.value)
            except discord.Forbidden:
                nick_success = False

            try:
                await interaction.user.add_roles(new_role, reason="入界手続き（自己申請）")
            except discord.Forbidden:
                return await interaction.followup.send(
                    f"❌ ロール付与権限エラー: Botに「{new_role.name}」を付与する権限がありません。\nBotのロール順位（サーバー設定 > ロール）を確認してください。",
                    ephemeral=True
                )

            if pending_role and pending_role in interaction.user.roles:
                try:
                    await interaction.user.remove_roles(pending_role, reason="入界手続き完了に伴う待機ロール剥奪")
                except discord.Forbidden:
                    pass
                
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
                await interaction.followup.send(f"✅ 完了！名前を「{self.name_input.value}」にし、{initial_coins:,} {currency_name} を発行しました。", ephemeral=True)
            else:
                await interaction.followup.send(f"✅ 完了！{initial_coins:,} {currency_name} を発行しました。（名前変更は権限不足のためスキップされました）", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

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
        embed.add_field(name="2. /面接官 チャット削除 <件数>", value="チャンネル内のメッセージを指定された件数分、一括削除します。", inline=False)
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
        
        # 権限チェック
        ch_perms = interaction.channel.permissions_for(interaction.guild.me)
        if not ch_perms.manage_messages:
            return await interaction.followup.send(
                "❌ エラー: Botにこのチャンネルの「メッセージの管理」権限がありません。\nチャンネル設定でBotに権限を付与してください。",
                ephemeral=True
            )
            
        try:
            deleted = await interaction.channel.purge(limit=count)
            await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send("❌ エラー: メッセージの削除権限がありません。", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ メッセージ削除中にエラーが発生しました: {e}", ephemeral=True)

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
        guild = interaction.guild
        me = guild.me

        new_role = get_role_by_setting(bot, guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
        pending_role = get_role_by_setting(bot, guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
        
        if not new_role:
            return await interaction.followup.send(f"❌ エラー: 付与対象ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。ダッシュボードまたは設定を確認してください。", ephemeral=True)
        if not pending_role:
            return await interaction.followup.send(f"❌ エラー: 待機ロール「{PENDING_MEMBER_ROLE_NAME}」が見つかりません。ダッシュボードまたは設定を確認してください。", ephemeral=True)

        # 1. Botの権限チェック
        if not me.guild_permissions.manage_roles:
            return await interaction.followup.send(
                "❌ **Botの権限不足エラー**:\n"
                "Botに「**ロールの管理**」権限が付与されていません。\n"
                "サーバー設定 > ロール > Botのロール で「ロールの管理」権限をONにしてください。",
                ephemeral=True
            )

        # 2. ロール順位（ヒエラルキー）チェック
        if new_role >= me.top_role:
            return await interaction.followup.send(
                f"❌ **ロール順位エラー (403 Forbidden)**:\n"
                f"付与対象のロール「**{new_role.name}**」がBotの最上位ロール（**{me.top_role.name}**）以上の位置にあります。\n"
                f"Discordの【サーバー設定】>【ロール】一覧で、**Botのロールを「{new_role.name}」よりも上にドラッグして移動**してください。",
                ephemeral=True
            )

        if pending_role >= me.top_role:
            return await interaction.followup.send(
                f"❌ **ロール順位エラー (403 Forbidden)**:\n"
                f"剥奪対象のロール「**{pending_role.name}**」がBotの最上位ロール（**{me.top_role.name}**）以上の位置にあります。\n"
                f"Discordの【サーバー設定】>【ロール】一覧で、**Botのロールを「{pending_role.name}」よりも上にドラッグして移動**してください。",
                ephemeral=True
            )

        # 3. チャンネル閲覧・メッセージ履歴読み取り権限チェック
        ch_perms = interaction.channel.permissions_for(me)
        if not ch_perms.read_message_history:
            return await interaction.followup.send(
                "❌ **チャンネル権限エラー**:\n"
                "Botにこのチャンネルの「**メッセージ履歴を読む**」権限がありません。\n"
                "チャンネル設定またはカテゴリー設定でBotの権限を許可してください。",
                ephemeral=True
            )
            
        try:
            # --- チャンネル履歴から入界待機者とその希望する名前を自動取得 ---
            user = None
            proposed_nick = None
            try:
                async for message in interaction.channel.history(limit=50):
                    if not message.author.bot:
                        # discord.User の場合は Member オブジェクトに解決
                        member = message.author if isinstance(message.author, discord.Member) else guild.get_member(message.author.id)
                        if not member:
                            try:
                                member = await guild.fetch_member(message.author.id)
                            except Exception:
                                member = None

                        if member and pending_role in member.roles:
                            content = message.clean_content.strip() if hasattr(message, 'clean_content') else message.content.strip()
                            if content:
                                user = member
                                proposed_nick = content
                                break
            except discord.Forbidden:
                return await interaction.followup.send("❌ チャンネルのメッセージ履歴を取得できませんでした（権限不足）。", ephemeral=True)
            except Exception as e:
                print(f"[WARNING] Failed to fetch channel history: {e}")

            if not user:
                return await interaction.followup.send(
                    f"⚠️ チャンネル履歴（直近50件）から「{pending_role.name}」ロールを持ち、名前を書き込んだ入界待機者を見つけることができませんでした。",
                    ephemeral=True
                )

            if new_role in user.roles:
                return await interaction.followup.send(f"ℹ️ {user.display_name} は既に「{new_role.name}」が付与されており、手続き完了済みです。", ephemeral=True)

            nick_change_status = ""
            
            if proposed_nick:
                if len(proposed_nick) > 32:
                    proposed_nick = proposed_nick[:32]
                
                # 重複ユーザーの検索 (対象ユーザー自身は除く、かつ入界待ちロールを持っていない人)
                duplicate_member = None
                target_name_lower = proposed_nick.lower()
                for member in guild.members:
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
                    nick_change_status = f"\n⚠️ 名前変更は権限不足のためスキップされました（Botに「ニックネームの管理」権限があるか、対象者のロール順位を確認してください）。"
                except Exception as e:
                    nick_change_status = f"\n❌ 名前変更中にエラーが発生しました: {e}"
            else:
                nick_change_status = "\nℹ️ チャンネル履歴に対象ユーザーのメッセージが見つからなかったため、名前変更はスキップされました。"

            # ロール付与
            try:
                await user.add_roles(new_role, reason=f"面接官入界許可 (面接官: {interaction.user.display_name})")
            except discord.Forbidden:
                return await interaction.followup.send(
                    f"❌ **ロール付与に失敗しました (403 Forbidden)**:\n"
                    f"Botのロールが「{new_role.name}」より下にあるか、「ロールの管理」権限がありません。\n"
                    f"サーバー設定 > ロール でBotのロール順位を上げてから再実行してください。",
                    ephemeral=True
                )

            # 待機ロール剥奪
            if pending_role and pending_role in user.roles:
                try:
                    await user.remove_roles(pending_role, reason=f"面接官入界許可 (面接官: {interaction.user.display_name})")
                except discord.Forbidden:
                    nick_change_status += f"\n⚠️ 「{pending_role.name}」の剥奪は権限不足のためスキップされました（サーバー設定でBotのロールを上位に移動してください）。"
                
            initial_coins = get_setting(bot, "INITIAL_COINS") or 30000
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            await database.add_balance(guild.id, user.id, initial_coins)
            await database.mark_initial_issued(interaction.guild_id, user.id)
            
            await interaction.followup.send(f"✅ {user.mention} の入界手続きを完了しました！（{initial_coins:,} {currency_name} 発行済み）{nick_change_status}", ephemeral=True)

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
            await send_log(bot, guild, "currency", embed_log)

            # 面接実績の記録と累計取得
            await database.add_interviewer_log(interaction.user.id, user.id, guild.id)
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
            
            await send_log(bot, guild, "interviewer", embed_interviewer)
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
