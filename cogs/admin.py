import discord
from discord.ext import commands
from discord import app_commands
import datetime
import asyncio
import database
from helpers import (
    JST, get_setting, get_role_by_setting, has_admin_role, is_admin, is_admin_or_interviewer, is_admin_or_banker, send_log,
    NEW_MEMBER_ROLE_NAME, INTERVIEWER_ROLE_NAMES, FREE_INN_ROLE_NAMES,
    EMBLEM_MANAGER_ROLE_NAME, EMBLEM_MASTER_ROLE_NAME, CONFESSION_PRIEST_ROLE_NAME,
    PRIEST_ROLE_NAME, ADMIN_ROLE_NAMES, EVALUATOR_ROLE_NAMES, DEFAULT_SETTINGS,
    format_setting_status, circled_to_int, get_circled_number, apply_bot_nicknames
)
# 注意: bot.pyの245行目あたりにあった bot_settings や triggers のキャッシュは bot 側にある。

# --- UIクラス (ヘルパーのダミーインポート等も利用) ---
# 他のUIインポートや定義
from cogs.rooms import VCRenamePanelView, RoomView, CustomRoomView, LuxuryRoomView, InnCombinedView, GameRoomPanelView
from cogs.gambling import ChinchiroView, CoinflipView, SlotView, BlackjackView, RouletteView
from cogs.interview import InterviewPanelView
from cogs.utility import EmblemRequestPanelView, ConfessionRequestPanelView, InquiryRequestPanelView, AnonymousChatPanelView, CustomTicketPanelView, AnonymousChatSetupView, InquirySetupView

async def trigger_evaluation_failure(guild, target, reason, executor, bot):
    is_minus_trigger = (reason == "通貨マイナスになったため")
    if is_minus_trigger:
        enable_penalty = str(get_setting(bot, "ENABLE_MINUS_PENALTY", guild.id)).lower() == "true"
        if not enable_penalty:
            return

    # 通貨マイナス落ち対象ロールを剥奪
    minus_target_ids = get_setting(bot, "MINUS_TARGET_ROLE_IDS") or []
    roles_to_remove = [r for r in target.roles if r.id in minus_target_ids]
    if roles_to_remove:
        try:
            await target.remove_roles(*roles_to_remove, reason=reason)
        except Exception as e:
            print(f"[Evaluation] Failed to remove minus target roles: {e}")

    punish_type = get_setting(bot, "MINUS_PUNISHMENT_TYPE") or "evaluation_failure"
    is_minus_trigger = (reason == "通貨マイナスになったため")
    
    if is_minus_trigger and punish_type == "violator":
        # 違反者ロールを付与
        role = get_role_by_setting(bot, guild, "GAMBLE_VIOLATOR_ROLE_ID", "違反者")
        if role and role not in target.roles:
            try:
                await target.add_roles(role, reason=reason)
            except Exception as e:
                print(f"[Evaluation] Failed to add violator role: {e}")
                
        dm_msg = "通貨がマイナスになった為、違反者になりました。"
        try:
            await target.send(dm_msg)
        except Exception:
            pass
            
        embed = discord.Embed(
            title="🚨 違反者登録",
            description=f"{target.mention} が違反者に登録されました。",
            color=discord.Color.red()
        )
        embed.add_field(name="理由", value=reason, inline=False)
        embed.add_field(name="実行者", value=executor.mention if executor else "システム", inline=False)
        await send_log(bot, guild, "evaluation_failure", embed)
    else:
        # 評価落ちロールを付与
        role = get_role_by_setting(bot, guild, "DOWNGRADE_ROLE_ID", "評価落ち")
        if role and role not in target.roles:
            try:
                await target.add_roles(role, reason=reason)
            except Exception as e:
                print(f"[Evaluation] Failed to add role: {e}")
                
        dm_msg = "審査の結果評価落ちになりました。" if reason != "通貨マイナスになったため" else "通貨がマイナスになった為、評価落ちしました。"
        try:
            await target.send(dm_msg)
        except Exception:
            pass
            
        embed = discord.Embed(
            title="📉 評価落ち",
            description=f"{target.mention} が評価落ちしました。",
            color=discord.Color.red()
        )
        embed.add_field(name="理由", value=reason, inline=False)
        embed.add_field(name="実行者", value=executor.mention if executor else "システム", inline=False)
        await send_log(bot, guild, "evaluation_failure", embed)

# --- コア設定パネル更新関数 ---
# --- リアクションロール ---
class StickyTemplateModal(discord.ui.Modal, title="固定テンプレートの作成"):
    content_input = discord.ui.TextInput(
        label="固定するテキスト内容",
        style=discord.TextStyle.paragraph,
        placeholder="メッセージの最後に常に表示される内容を入力してください。",
        max_length=2000,
        required=True
    )
    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        # 以前表示されていた jump_url 等を考慮せず、シンプルなコンテンツの送信
        await database.save_sticky_template(interaction.channel.id, self.content_input.value)
        
        # 新しいメッセージを送信
                # 新しいメッセージを送信
        new_msg = await interaction.channel.send(content=self.content_input.value)
        await database.update_sticky_last_message(interaction.channel.id, new_msg.id, None)
        await interaction.followup.send("✅ 固定テンプレートを設定しました。", ephemeral=True)

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

# --- コマンドグループ ---
class AdminGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="運営", description="運営管理者専用コマンド")
        self.bot = bot

    @app_commands.command(name="ボット名変更", description="【運営専用】このサーバー内でのボットの名前（ニックネーム）を変更します。")
    @app_commands.describe(nickname="新しい名前を入力してください。未入力の場合は元の名前に戻ります。")
    @is_admin()
    async def set_bot_nickname(self, interaction: discord.Interaction, nickname: str = None):
        await interaction.response.defer(ephemeral=True)
        try:
            await interaction.guild.me.edit(nick=nickname)
            if nickname:
                await interaction.followup.send(f"✅ ボットの名前を `{nickname}` に変更しました。", ephemeral=True)
            else:
                await interaction.followup.send("✅ ボットの名前を元に戻しました。", ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send("❌ エラー: ボットの名前を変更する権限がありません。（ボットのロールが一番上にあるか確認してください）", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

    @app_commands.command(name="任意ロールパネル設置", description="【運営専用】ユーザーがリアクションを押すことで自由に付与・剥奪できるロールパネルを設置します")
    @is_admin()
    async def reaction_role_setup(self, interaction: discord.Interaction):
        await interaction.response.send_modal(CustomRolePanelSetupModal())

    @app_commands.command(name="固定テンプレート設定", description="【運営専用】このチャンネルのチャットテンプレートを固定し、常に最新の発言として自動更新します")
    @is_admin()
    async def sticky_template_create(self, interaction: discord.Interaction):
        await interaction.response.send_modal(StickyTemplateModal())

    @app_commands.command(name="固定テンプレート削除", description="【運営専用】このチャンネルに設定されている固定テンプレートを削除します")
    @is_admin()
    async def sticky_template_delete(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        sticky_data = await database.get_sticky_template(interaction.channel.id)
        if not sticky_data:
            return await interaction.followup.send("⚠️ このチャンネルには固定テンプレートが設定されていません。", ephemeral=True)
            
        if sticky_data["last_message_id"]:
            try:
                old_msg = await interaction.channel.fetch_message(sticky_data["last_message_id"])
                await old_msg.delete()
            except:
                pass
                
        await database.remove_sticky_template(interaction.channel.id)
        await interaction.followup.send("🗑️ 固定テンプレートの設定を削除しました。", ephemeral=True)

    @app_commands.command(name="チャット消去", description="【運営・面接官専用】チャンネル内のメッセージを指定された件数分、一括削除します")
    @is_admin_or_interviewer()
    async def clear_chat(self, interaction: discord.Interaction, count: int):
        if count <= 0:
            return await interaction.response.send_message("1以上の件数を指定してください。", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=count)
        await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)

    @app_commands.command(name="手動付与_複数人選択", description="【運営専用】指定した複数のユーザーに通貨を直接発行して付与します")
    @is_admin_or_banker()
    @app_commands.describe(users="付与するユーザー（メンションまたはIDを複数指定可）", amount="金額")
    async def manual_issue_users(self, interaction: discord.Interaction, users: str, amount: int):
        await interaction.response.defer()
        if amount <= 0:
            return await interaction.followup.send("❌ 1以上の金額を指定してください。", ephemeral=True)

        import re
        user_ids = set(re.findall(r'\d{17,19}', users))
        if not user_ids:
            return await interaction.followup.send("❌ ユーザーを正しく指定してください（メンションまたはID）。", ephemeral=True)

        cur_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        minus_target_ids = get_setting(self.bot, "MINUS_TARGET_ROLE_IDS") or []

        success_users = []
        for uid_str in user_ids:
            uid = int(uid_str)
            member = interaction.guild.get_member(uid)
            if not member:
                continue
            new_bal = await database.add_balance(interaction.guild.id, member.id, amount)
            success_users.append(member.mention)

            if new_bal < 0:
                member_roles = [r.id for r in member.roles]
                if any(rid in minus_target_ids for rid in member_roles):
                    await trigger_evaluation_failure(interaction.guild, member, "通貨マイナスになったため", interaction.user, self.bot)

        if not success_users:
            return await interaction.followup.send("❌ 指定されたユーザーがサーバー内に見つかりませんでした。", ephemeral=True)

        msg = f"💵 合計 **{len(success_users)}名** に **{amount} {cur_name}** を付与しました！\n" + " ".join(success_users)
        if len(msg) > 2000:
            msg = msg[:1900] + "\n... (省略)"
        await interaction.followup.send(msg)

        embed = discord.Embed(
            title="💵 手動付与 (複数人)",
            description="運営による手動付与が行われました。",
            color=discord.Color.green(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=False)
        mentions_str = " ".join(success_users)
        if len(mentions_str) > 1024:
            mentions_str = mentions_str[:1021] + "..."
        embed.add_field(name="対象者一覧", value=mentions_str, inline=False)
        embed.add_field(name="付与額 (1人あたり)", value=f"{amount:,} {cur_name}", inline=False)
        embed.add_field(name="合計付与人数", value=f"{len(success_users)}名", inline=False)
        await send_log(self.bot, interaction.guild, "currency", embed)

    @app_commands.command(name="手動付与_ロール指定", description="【運営専用】指定したロール全員に通貨を直接発行して付与します")
    @is_admin_or_banker()
    @app_commands.describe(role="付与するロール", amount="金額")
    async def manual_issue_role(self, interaction: discord.Interaction, role: discord.Role, amount: int):
        await interaction.response.defer()
        if amount <= 0:
            return await interaction.followup.send("❌ 1以上の金額を指定してください。", ephemeral=True)

        members = role.members
        if not members:
            return await interaction.followup.send(f"❌ {role.name} ロールを持つメンバーが見つかりませんでした。", ephemeral=True)

        cur_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        minus_target_ids = get_setting(self.bot, "MINUS_TARGET_ROLE_IDS") or []

        success_count = 0
        for member in members:
            new_bal = await database.add_balance(interaction.guild.id, member.id, amount)
            success_count += 1
            if new_bal < 0:
                member_roles = [r.id for r in member.roles]
                if any(rid in minus_target_ids for rid in member_roles):
                    await trigger_evaluation_failure(interaction.guild, member, "通貨マイナスになったため", interaction.user, self.bot)

        await interaction.followup.send(f"💵 {role.mention} を持つ **{success_count}名** に **{amount} {cur_name}** を一括付与しました。")
        
        embed = discord.Embed(
            title="💵 手動付与 (ロール一括)",
            description="運営による手動付与（ロール一括）が行われました。",
            color=discord.Color.green(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
        embed.add_field(name="対象ロール", value=f"{role.mention} ({success_count}名)", inline=True)
        embed.add_field(name="付与額", value=f"{amount:,} {cur_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)

    @app_commands.command(name="手動没収", description="【運営専用】指定したユーザーから通貨を直接没収（減額）します")
    @is_admin_or_banker()
    @app_commands.describe(user="没収するユーザー", amount="金額")
    async def manual_confiscate(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        await interaction.response.defer()
        if amount <= 0:
            await interaction.followup.send("❌ 1以上の金額を指定してください。", ephemeral=True)
            return

        await database.remove_balance(interaction.guild.id, user.id, amount, force=True)
        new_bal = await database.get_balance(interaction.guild.id, user.id)
        cur_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        
        await interaction.followup.send(f"💸 {user.mention} から **{amount} {cur_name}** を没収しました。（現在の残高: **{new_bal} {cur_name}**）")

        # 通貨ログの送信
        embed = discord.Embed(
            title="📉 手動没収 (運営)",
            description="運営による手動没収が行われました。",
            color=discord.Color.red(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
        embed.add_field(name="対象者", value=f"{user.mention} ({user.id})", inline=True)
        embed.add_field(name="没収額", value=f"{amount:,} {cur_name}", inline=True)
        embed.add_field(name="新残高", value=f"{new_bal:,} {cur_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)
        
        if new_bal < 0:
            minus_target_ids = get_setting(self.bot, "MINUS_TARGET_ROLE_IDS") or []
            member_roles = [r.id for r in user.roles]
            if any(rid in minus_target_ids for rid in member_roles):
                await trigger_evaluation_failure(interaction.guild, user, "通貨マイナスになったため", interaction.user, self.bot)

    @app_commands.command(name="一括初期給与", description="【運営専用】全員（サーバー全体）に一括で初期給与（30000コイン）を受け取っていない人を含めて一律で発行します")
    @app_commands.describe(preview="Trueの場合、実際には付与せずに対象者の一覧を表示します（デフォルト: True）")
    @is_admin()
    async def batch_initial_issue(self, interaction: discord.Interaction, preview: bool = True):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        bot = self.bot
        
        try:
            # 1. メンバーを API 経由で確実にフェッチする（guild.chunk() のフリーズ回避）
            members = []
            async for member in guild.fetch_members(limit=None):
                if not member.bot:
                    members.append(member)
                
            initial_coins = get_setting(bot, "INITIAL_COINS") or 30000
            cur_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            
            # --- プレビューモードの場合 ---
            if preview:
                issue_list_text = [f"- {m.mention} (ID: {m.id})" for m in members[:10]]
                if len(members) > 10:
                    issue_list_text.append(f"他 {len(members) - 10} 名...")

                embed = discord.Embed(
                    title="📋 【プレビュー】一括初期給与 対象者一覧",
                    description="実際には付与を行っていません。内容に問題がなければ、`/一括初期給与 preview:False` で実行してください。",
                    color=discord.Color.blue(),
                    timestamp=discord.utils.utcnow()
                )
                embed.add_field(
                    name=f"🪙 全員一括発行 対象者 ({len(members)} 名)",
                    value="\n".join(issue_list_text) if members else "対象者なし",
                    inline=False
                )
                embed.set_footer(text=f"※実行すると、全員に一律 {initial_coins:,} {cur_name} が加算され、初期給与済みにマークされます。")
                return await interaction.followup.send(embed=embed, ephemeral=True)

            # --- 実行モード (preview=False) の場合 ---
            issued_count = 0
            issued_members_log = []
            
            # 全員に初期給与を付与してフラグを TRUE にマークする
            for member in members:
                await database.add_balance(interaction.guild.id, member.id, initial_coins)
                await database.mark_initial_issued(interaction.guild_id, member.id)
                issued_count += 1
                issued_members_log.append(f"{member.mention} (ID: {member.id})")
                    
            await interaction.followup.send(
                f"✅ 処理が完了しました！\n"
                f"- 全員一括発行: {issued_count} 名に {initial_coins:,} {cur_name} を付与しました。",
                ephemeral=True
            )

            if issued_count > 0:
                embed = discord.Embed(
                    title="🪙 一括初期給与 (全員対象・運営)",
                    description="運営による一括初期給与が実行されました。",
                    color=discord.Color.gold(),
                    timestamp=discord.utils.utcnow()
                )
                embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
                embed.add_field(name="発行人数", value=f"{issued_count} 名", inline=True)
                embed.add_field(name="発行総額", value=f"{issued_count * initial_coins:,} {cur_name}", inline=True)
                
                members_text = "\n".join(issued_members_log[:20])
                if len(issued_members_log) > 20:
                    members_text += f"\n他 {len(issued_members_log) - 20} 名..."
                embed.add_field(name="対象メンバー一覧 (最大20名)", value=members_text, inline=False)
                
                await send_log(self.bot, interaction.guild, "currency", embed)
                
        except Exception as e:
            # エラーをキャッチしてDiscordに送信する（フリーズ回避）
            import traceback
            tb = traceback.format_exc()
            print(f"[ERROR] batch_initial_issue: {e}\n{tb}")
            await interaction.followup.send(f"❌ エラーが発生しました: `{e}`\nBotのログまたはコンソールを確認してください。", ephemeral=True)

    @app_commands.command(name="デバッグ用vc強制退室", description="【運営専用】指定したユーザーのVC接続セッションを強制的に終了させます（時間測定 of バグ修正用）")
    @is_admin()
    @app_commands.describe(user="強制退室させるユーザー")
    async def debug_vc(self, interaction: discord.Interaction, user: discord.Member):
        await interaction.response.defer(ephemeral=True)
        session = self.bot.vc_sessions.pop(user.id, None)
        if session:
            await interaction.followup.send(f"✅ {user.display_name} のVCセッションを破棄しました。", ephemeral=True)
        else:
            await interaction.followup.send(f"⚠️ {user.display_name} はVCセッションを保持していませんでした。", ephemeral=True)

# --- Cogの定義 ---
class DowngradeGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価落ち", description="評価落ちに関するコマンド")
        self.bot = bot

    @app_commands.command(name="実行", description="【運営専用】指定したユーザーを評価落ちさせます")
    @app_commands.describe(target="対象メンバー", reason="評価落ちの理由")
    async def downgrade_execute(self, interaction: discord.Interaction, target: discord.Member, reason: str):
        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（運営専用）。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        await trigger_evaluation_failure(interaction.guild, target, reason, interaction.user, self.bot)
        await interaction.followup.send(f"✅ {target.mention} を評価落ちさせました（理由: {reason}）。", ephemeral=True)

class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        
        # コマンドグループの追加
        self.bot.tree.add_command(AdminGroup(self.bot))
        self.bot.tree.add_command(DowngradeGroup(self.bot))

        # 招待キャッシュの初期化 (コグリロード時の対応)
        for guild in self.bot.guilds:
            self.bot.loop.create_task(self.update_invite_cache(guild))

    async def cog_unload(self):
        self.bot.tree.remove_command("運営")
        self.bot.tree.remove_command("評価落ち")

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot:
            return

        # 荒らし対策: 連続同じメッセージ、@everyone/メンションスパム、招待URL連投
        if isinstance(message.author, discord.Member):
            should_check_spam = True
            # 適用対象および免除ロールの確認
            guild = message.guild
            if guild:
                cfg = self.bot.get_antigrief_config(guild.id)
                
                # 免除ロールチェック
                exempt_roles = cfg.get("exempt_roles", set())
                author_role_ids = {role.id for role in message.author.roles}
                if exempt_roles & author_role_ids:
                    should_check_spam = False
                
                # 対象カテゴリー/チャンネルチェック
                if should_check_spam:
                    target_categories = cfg.get("categories", set())
                    target_channels = cfg.get("channels", set())
                    if target_categories or target_channels:
                        in_target_channel = message.channel.id in target_channels
                        in_target_category = message.channel.category and message.channel.category.id in target_categories
                        if not in_target_channel and not in_target_category:
                            should_check_spam = False
            else:
                should_check_spam = False

            if should_check_spam:
                user_id = message.author.id
                now = datetime.datetime.now(JST)

                if not hasattr(self.bot, 'spam_tracker'):
                    self.bot.spam_tracker = {}

                user_tracker = self.bot.spam_tracker.setdefault(user_id, {
                    "last_content": None,
                    "content_count": 0,
                    "everyone_count": 0,
                    "invite_count": 0,
                    "mention_count": 0,
                    "last_time": now
                })

                # 3秒以上経過していればリセット
                if (now - user_tracker["last_time"]).total_seconds() > 3:
                    user_tracker["content_count"] = 0
                    user_tracker["everyone_count"] = 0
                    user_tracker["invite_count"] = 0
                    user_tracker["mention_count"] = 0

                user_tracker["last_time"] = now
                timeout_reason = None

                # 同じメッセージの連続検知 (内容が存在する場合)
                if message.content and message.content == user_tracker["last_content"]:
                    user_tracker["content_count"] += 1
                    if user_tracker["content_count"] >= 3:
                        timeout_reason = "連続で同じメッセージを送信したため"
                else:
                    user_tracker["last_content"] = message.content
                    user_tracker["content_count"] = 1

                # @everyone or @here の検知 (他のメッセージを挟んでも3秒以内の累計でカウント)
                if message.mention_everyone:
                    user_tracker["everyone_count"] += 1
                    if user_tracker["everyone_count"] >= 5:
                        timeout_reason = "短時間に@everyoneメンションを複数回送信したため"

                # Discord招待URLの検知 (discord.gg/ などの招待リンク)
                import re
                DISCORD_INVITE_PATTERN = re.compile(
                    r'(?:https?://)?(?:www\.)?(?:discord\.gg|discord\.com/invite|discordapp\.com/invite)/[a-zA-Z0-9-]+',
                    re.IGNORECASE
                )
                if DISCORD_INVITE_PATTERN.search(message.content):
                    user_tracker["invite_count"] += 1
                    if user_tracker["invite_count"] >= 5:
                        timeout_reason = "連続でDiscordの招待リンクを送信したため"

                # メンションスパムの検知 (ユーザーメンション + 役職メンション)
                msg_mentions = len(message.mentions) + len(message.role_mentions)
                if msg_mentions >= 5:
                    timeout_reason = "1つのメッセージで大量のメンションを送信したため"
                elif msg_mentions > 0:
                    user_tracker["mention_count"] += msg_mentions
                    if user_tracker["mention_count"] >= 10:
                        timeout_reason = "短時間に連続してメンションを送信したため"

                if timeout_reason:
                    try:
                        # トリガーとなったメッセージの自動削除を試みる
                        try:
                            await message.delete()
                        except discord.Forbidden:
                            print(f"[WARNING] Cannot delete message. Missing permissions.")
                        except Exception as de:
                            print(f"[ERROR] Message deletion failed: {de}")

                        timeout_duration = datetime.timedelta(hours=1)
                        await message.author.timeout(timeout_duration, reason=timeout_reason)
                        await message.channel.send(f"🚨 {message.author.mention} がスパム行為（{timeout_reason}）によりタイムアウトされました。")
                        
                        user_tracker["content_count"] = 0
                        user_tracker["everyone_count"] = 0
                        user_tracker["invite_count"] = 0
                        user_tracker["mention_count"] = 0
                        return # スパムなら処理終了
                    except Exception as e:
                        print(f"[ERROR] Timeout failed for {message.author.display_name}: {e}")




    # --- 招待キャッシュ同期リスナー ---
    @commands.Cog.listener()
    async def on_ready(self):
        await apply_bot_nicknames(self.bot)
        print("[Bot Nicknames] Initialized bot nicknames for all guilds.")


    @commands.command(name="sync")
    @commands.has_permissions(administrator=True)
    async def sync_commands(self, ctx):
        await ctx.send("コマンドを同期しています...")
        try:
            self.bot.tree.copy_global_to(guild=ctx.guild)
            synced = await self.bot.tree.sync(guild=ctx.guild)
            await ctx.send(f"このサーバーに {len(synced)} 個のコマンドを同期しました！\n※これで即座にDiscordへ反映されるはずです。")
        except Exception as e:
            await ctx.send(f"同期中にエラーが発生しました: {e}")

async def setup(bot):
    await bot.add_cog(Admin(bot))
