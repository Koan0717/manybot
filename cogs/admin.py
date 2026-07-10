"""
cogs/admin.py - 管理者用設定パネル（UI一本化）
全設定はguild_idベースでSupabaseに保存される。
古いスラッシュコマンドは廃止し、/設定ダッシュボード に統合しました。
"""
import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import (
    get_setting, has_admin_role, send_log,
    format_setting_status
)


# ============================================================
# データ保存用ヘルパー
# ============================================================
async def save_and_refresh(bot, guild_id: int, key: str, value):
    await database.set_guild_setting(guild_id, key, value)
    await bot.refresh_guild_settings(guild_id)


# ============================================================
# UIコンポーネント: 基本設定モーダル
# ============================================================
class BasicSettingsModal(discord.ui.Modal, title='基本設定の変更'):
    currency_name = discord.ui.TextInput(
        label='通貨名 (例: コイン, Rune)',
        placeholder='コイン',
        required=True,
        max_length=20
    )
    initial_coins = discord.ui.TextInput(
        label='入界時の初期通貨数',
        placeholder='30000',
        required=True,
        max_length=10
    )
    eval_days = discord.ui.TextInput(
        label='評価期間の日数 (デフォルト)',
        placeholder='14',
        required=True,
        max_length=5
    )

    def __init__(self, bot, current_currency, current_initial, current_eval):
        super().__init__()
        self.bot = bot
        self.currency_name.default = str(current_currency)
        self.initial_coins.default = str(current_initial)
        self.eval_days.default = str(current_eval)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            init_c = int(self.initial_coins.value)
            ev_d = int(self.eval_days.value)
        except ValueError:
            return await interaction.response.send_message("❌ 初期通貨数と評価期間は数値を入力してください。", ephemeral=True)

        guild_id = interaction.guild.id
        await save_and_refresh(self.bot, guild_id, "CURRENCY_NAME", self.currency_name.value)
        await save_and_refresh(self.bot, guild_id, "INITIAL_COINS", init_c)
        await save_and_refresh(self.bot, guild_id, "EVAL_DURATION_DAYS", ev_d)

        await interaction.response.send_message("✅ 基本設定を保存しました。パネルを更新するには「再表示」を押してください。", ephemeral=True)


# ============================================================
# UIコンポーネント: ロール設定ビュー
# ============================================================
class RoleSettingsView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=300)
        self.bot = bot
        self.selected_roles = []
        self.selected_target = None

    @discord.ui.select(
        cls=discord.ui.RoleSelect,
        placeholder="設定したいロールを選択してください (複数可)",
        min_values=1,
        max_values=5,
        custom_id="role_select"
    )
    async def select_roles(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        self.selected_roles = select.values
        await interaction.response.send_message(f"✅ {len(self.selected_roles)} 個のロールを選択しました。下のアクションを選んでください。", ephemeral=True)

    @discord.ui.select(
        placeholder="どこの設定に割り当てますか？",
        options=[
            discord.SelectOption(label="新メンバーロール (単一)", value="NEW_MEMBER_ROLE_ID"),
            discord.SelectOption(label="入界待機ロール (単一)", value="PENDING_MEMBER_ROLE_ID"),
            discord.SelectOption(label="管理者ロール (追加)", value="ADMIN_ROLE_IDS"),
            discord.SelectOption(label="面接官ロール (追加)", value="INTERVIEWER_ROLE_IDS"),
            discord.SelectOption(label="評価員Tier1 (追加)", value="EVALUATOR_TIER1_ROLE_IDS"),
            discord.SelectOption(label="評価員Tier2 (追加)", value="EVALUATOR_TIER2_ROLE_IDS"),
            discord.SelectOption(label="評価員Tier3 (追加)", value="EVALUATOR_TIER3_ROLE_IDS"),
            discord.SelectOption(label="本・準メンバー (追加)", value="MAIN_SUB_MEMBER_ROLE_IDS"),
            discord.SelectOption(label="評価落ちロール (単一)", value="DOWNGRADE_ROLE_ID"),
        ],
        custom_id="target_setting_select"
    )
    async def select_target(self, interaction: discord.Interaction, select: discord.ui.Select):
        self.selected_target = select.values[0]
        await interaction.response.defer(ephemeral=True)

    @discord.ui.button(label="保存して適用", style=discord.ButtonStyle.success, row=2)
    async def save_roles(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_roles or not self.selected_target:
            return await interaction.response.send_message("❌ ロールと設定先を両方選んでください。", ephemeral=True)

        guild_id = interaction.guild.id
        single_keys = ["NEW_MEMBER_ROLE_ID", "PENDING_MEMBER_ROLE_ID", "DOWNGRADE_ROLE_ID"]

        if self.selected_target in single_keys:
            # 単一設定
            role = self.selected_roles[0]
            await save_and_refresh(self.bot, guild_id, self.selected_target, role.id)
            msg = f"✅ `{self.selected_target}` を {role.mention} に設定しました。"
        else:
            # リストに追加
            current_ids = get_setting(self.bot, guild_id, self.selected_target) or []
            added = 0
            for r in self.selected_roles:
                if r.id not in current_ids:
                    current_ids.append(r.id)
                    added += 1
            await save_and_refresh(self.bot, guild_id, self.selected_target, current_ids)
            msg = f"✅ `{self.selected_target}` に {added} 個のロールを追加しました。"

        # 選択状態リセット
        self.selected_roles = []
        self.selected_target = None
        await interaction.response.send_message(msg, ephemeral=True)


# ============================================================
# UIコンポーネント: チャンネル設定ビュー
# ============================================================
class ChannelSettingsView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=300)
        self.bot = bot
        self.selected_channels = []
        self.selected_target = None

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        channel_types=[discord.ChannelType.text, discord.ChannelType.forum, discord.ChannelType.category],
        placeholder="設定したいチャンネル/カテゴリを選択 (複数可)",
        min_values=1,
        max_values=5,
        custom_id="channel_select"
    )
    async def select_channels(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        self.selected_channels = select.values
        await interaction.response.send_message(f"✅ {len(self.selected_channels)} 個のチャンネルを選択しました。下のアクションを選んでください。", ephemeral=True)

    @discord.ui.select(
        placeholder="どこの設定に割り当てますか？",
        options=[
            discord.SelectOption(label="レベルアップ通知 (単一・テキスト)", value="LEVEL_UP_CHANNEL_ID"),
            discord.SelectOption(label="評価浮上カテゴリ (単一・カテゴリ)", value="EVALUATION_CATEGORY_ID"),
            discord.SelectOption(label="自己紹介 (追加・テキスト)", value="SELF_INTRO_CHANNEL_IDS"),
            discord.SelectOption(label="評価フォーラム (追加・フォーラム)", value="EVALUATION_FORUM_CHANNEL_IDS"),
        ],
        custom_id="channel_target_select"
    )
    async def select_target(self, interaction: discord.Interaction, select: discord.ui.Select):
        self.selected_target = select.values[0]
        await interaction.response.defer(ephemeral=True)

    @discord.ui.button(label="保存して適用", style=discord.ButtonStyle.success, row=2)
    async def save_channels(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_channels or not self.selected_target:
            return await interaction.response.send_message("❌ チャンネルと設定先を両方選んでください。", ephemeral=True)

        guild_id = interaction.guild.id
        single_keys = ["LEVEL_UP_CHANNEL_ID", "EVALUATION_CATEGORY_ID"]

        if self.selected_target in single_keys:
            ch = self.selected_channels[0]
            await save_and_refresh(self.bot, guild_id, self.selected_target, ch.id)
            msg = f"✅ `{self.selected_target}` を {ch.name} に設定しました。"
        else:
            current_ids = get_setting(self.bot, guild_id, self.selected_target) or []
            added = 0
            for c in self.selected_channels:
                if c.id not in current_ids:
                    current_ids.append(c.id)
                    added += 1
            await save_and_refresh(self.bot, guild_id, self.selected_target, current_ids)

            # 評価設定の専用テーブルも同期
            if self.selected_target in ["SELF_INTRO_CHANNEL_IDS", "EVALUATION_FORUM_CHANNEL_IDS"]:
                f_ids = get_setting(self.bot, guild_id, "EVALUATION_FORUM_CHANNEL_IDS") or []
                i_ids = get_setting(self.bot, guild_id, "SELF_INTRO_CHANNEL_IDS") or []
                await database.set_evaluation_settings(guild_id, f_ids, i_ids)
                self.bot.evaluation_settings_cache[guild_id] = {
                    "forum_channel_ids": set(f_ids),
                    "self_intro_channel_ids": set(i_ids)
                }

            msg = f"✅ `{self.selected_target}` に {added} 個のチャンネルを追加しました。"

        self.selected_channels = []
        self.selected_target = None
        await interaction.response.send_message(msg, ephemeral=True)


# ============================================================
# UIコンポーネント: ログ設定ビュー
# ============================================================
class LogSettingsView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=300)
        self.bot = bot
        self.selected_channel = None
        self.selected_log_type = None

    @discord.ui.select(
        cls=discord.ui.ChannelSelect,
        channel_types=[discord.ChannelType.text],
        placeholder="送信先のチャンネルを選択してください",
        min_values=1,
        max_values=1,
        custom_id="log_channel_select"
    )
    async def select_channel(self, interaction: discord.Interaction, select: discord.ui.ChannelSelect):
        self.selected_channel = select.values[0]
        await interaction.response.send_message(f"✅ 送信先を {self.selected_channel.mention} に選択しました。", ephemeral=True)

    @discord.ui.select(
        placeholder="どのログを送信しますか？",
        options=[
            discord.SelectOption(label="参加・退出", value="join_leave"),
            discord.SelectOption(label="BAN・BAN解除", value="ban_unban"),
            discord.SelectOption(label="メッセージ編集・削除", value="message_edit_delete"),
            discord.SelectOption(label="VC参加・退出", value="vc_join_leave"),
            discord.SelectOption(label="タイムアウト", value="timeout"),
            discord.SelectOption(label="評価シート", value="evaluation"),
            discord.SelectOption(label="評価落ち", value="evaluation_failure"),
            discord.SelectOption(label="面接官", value="interviewer"),
            discord.SelectOption(label="通貨", value="currency"),
        ],
        custom_id="log_type_select"
    )
    async def select_log_type(self, interaction: discord.Interaction, select: discord.ui.Select):
        self.selected_log_type = select.values[0]
        await interaction.response.defer(ephemeral=True)

    @discord.ui.button(label="ログ設定を保存", style=discord.ButtonStyle.success, row=2)
    async def save_log_setting(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_channel or not self.selected_log_type:
            return await interaction.response.send_message("❌ チャンネルとログ種別を両方選んでください。", ephemeral=True)

        guild_id = interaction.guild.id
        await database.set_log_channel(guild_id, self.selected_log_type, self.selected_channel.id)

        msg = f"✅ `{self.selected_log_type}` のログを {self.selected_channel.mention} に送信するように設定しました。"
        self.selected_channel = None
        self.selected_log_type = None
        await interaction.response.send_message(msg, ephemeral=True)


# ============================================================
# UIコンポーネント: メインダッシュボードビュー
# ============================================================
class AdminDashboardView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

    async def update_message(self, interaction: discord.Interaction, category: str):
        guild = interaction.guild
        guild_id = guild.id
        embed = discord.Embed(title=f"⚙️ 設定ダッシュボード - {category}", color=discord.Color.blurple())

        if category == "💰 通貨・基本設定":
            currency = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
            init_c = get_setting(self.bot, guild_id, "INITIAL_COINS") or 30000
            eval_d = get_setting(self.bot, guild_id, "EVAL_DURATION_DAYS") or 14
            embed.description = (
                f"**通貨名:** {currency}\n"
                f"**初期通貨:** {init_c}\n"
                f"**評価期間(日):** {eval_d}\n\n"
                f"下のボタンから数値を入力して変更できます。"
            )
            view = discord.ui.View(timeout=180)

            # ボタンコールバック内にModal展開の処理を入れる
            async def open_modal_callback(i: discord.Interaction):
                await i.response.send_modal(BasicSettingsModal(self.bot, currency, init_c, eval_d))

            btn = discord.ui.Button(label="基本設定を変更する", style=discord.ButtonStyle.primary)
            btn.callback = open_modal_callback
            view.add_item(btn)
            await interaction.response.edit_message(embed=embed, view=view)

        elif category == "👥 ロール設定":
            embed.description = (
                f"**新メンバー:** {format_setting_status(self.bot, guild, 'NEW_MEMBER_ROLE_ID')}\n"
                f"**入界待機:** {format_setting_status(self.bot, guild, 'PENDING_MEMBER_ROLE_ID')}\n"
                f"**面接官:** {format_setting_status(self.bot, guild, 'INTERVIEWER_ROLE_IDS')}\n"
                f"**管理者:** {format_setting_status(self.bot, guild, 'ADMIN_ROLE_IDS')}\n"
                f"**評価員T1:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER1_ROLE_IDS')}\n"
                f"**評価員T2:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER2_ROLE_IDS')}\n"
                f"**評価員T3:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER3_ROLE_IDS')}\n"
                f"**本/準メン:** {format_setting_status(self.bot, guild, 'MAIN_SUB_MEMBER_ROLE_IDS')}\n"
                f"**評価落ち:** {format_setting_status(self.bot, guild, 'DOWNGRADE_ROLE_ID')}"
            )
            await interaction.response.edit_message(embed=embed, view=RoleSettingsView(self.bot))

        elif category == "📢 チャンネル設定":
            embed.description = (
                f"**Lvアップ通知:** {format_setting_status(self.bot, guild, 'LEVEL_UP_CHANNEL_ID')}\n"
                f"**自己紹介:** {format_setting_status(self.bot, guild, 'SELF_INTRO_CHANNEL_IDS')}\n"
                f"**評価フォーラム:** {format_setting_status(self.bot, guild, 'EVALUATION_FORUM_CHANNEL_IDS')}\n"
                f"**評価カテゴリ:** {format_setting_status(self.bot, guild, 'EVALUATION_CATEGORY_ID')}"
            )
            await interaction.response.edit_message(embed=embed, view=ChannelSettingsView(self.bot))

        elif category == "📝 ログ設定":
            rows = await database.get_all_log_settings(guild_id)
            if not rows:
                embed.description = "ログチャンネルは設定されていません。\n下のメニューから設定を追加してください。"
            else:
                desc = ""
                for row in rows:
                    ch = guild.get_channel(row["channel_id"])
                    ch_str = ch.mention if ch else "❌ 見つかりません"
                    desc += f"**{row['log_type']}:** {ch_str}\n"
                embed.description = desc
            await interaction.response.edit_message(embed=embed, view=LogSettingsView(self.bot))

    @discord.ui.select(
        placeholder="編集したい設定カテゴリを選んでください",
        options=[
            discord.SelectOption(label="💰 通貨・基本設定", description="通貨名や初期コインの変更"),
            discord.SelectOption(label="👥 ロール設定", description="権限や自動付与ロールの設定"),
            discord.SelectOption(label="📢 チャンネル設定", description="通知先やフォーラムの設定"),
            discord.SelectOption(label="📝 ログ設定", description="アクションごとのログ送信先"),
        ],
        custom_id="dashboard_category_select"
    )
    async def select_category(self, interaction: discord.Interaction, select: discord.ui.Select):
        await self.update_message(interaction, select.values[0])


# ============================================================
# /設定 コマンドグループ
# ============================================================
class AdminGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="設定", description="【管理者専用】サーバー設定コマンド")
        self.bot = bot

    def _admin_check(self, member: discord.Member) -> bool:
        return has_admin_role(self.bot, member)

    @app_commands.command(name="ダッシュボード", description="【管理者専用】設定パネルを開いて設定を変更します")
    async def open_dashboard(self, interaction: discord.Interaction):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        embed = discord.Embed(
            title=f"⚙️ {interaction.guild.name} 設定ダッシュボード",
            description="下のメニューから、編集したい設定カテゴリを選んでください。\n現在の設定状態を確認しながら編集できます。",
            color=discord.Color.blurple()
        )
        await interaction.response.send_message(embed=embed, view=AdminDashboardView(self.bot), ephemeral=True)

    @app_commands.command(name="一覧確認", description="【管理者専用】現在のサーバー設定をまとめて表示します")
    async def show_settings(self, interaction: discord.Interaction):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        guild_id = guild.id

        embed = discord.Embed(
            title=f"⚙️ {guild.name} の設定一覧",
            color=discord.Color.blurple()
        )

        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        initial_coins = get_setting(self.bot, guild_id, "INITIAL_COINS") or 30000
        embed.add_field(
            name="💰 通貨設定",
            value=(
                f"**通貨名:** {currency_name}\n"
                f"**入界初期:** {int(initial_coins):,} {currency_name}"
            ),
            inline=False
        )

        embed.add_field(
            name="👥 ロール設定",
            value=(
                f"**新メンバー:** {format_setting_status(self.bot, guild, 'NEW_MEMBER_ROLE_ID')}\n"
                f"**入界待機:** {format_setting_status(self.bot, guild, 'PENDING_MEMBER_ROLE_ID')}\n"
                f"**面接官:** {format_setting_status(self.bot, guild, 'INTERVIEWER_ROLE_IDS')}\n"
                f"**管理者:** {format_setting_status(self.bot, guild, 'ADMIN_ROLE_IDS')}\n"
                f"**評価員T1:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER1_ROLE_IDS')}\n"
                f"**評価員T2:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER2_ROLE_IDS')}\n"
                f"**評価員T3:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER3_ROLE_IDS')}\n"
                f"**本・準メン:** {format_setting_status(self.bot, guild, 'MAIN_SUB_MEMBER_ROLE_IDS')}\n"
                f"**評価落ち:** {format_setting_status(self.bot, guild, 'DOWNGRADE_ROLE_ID')}"
            ),
            inline=False
        )

        embed.add_field(
            name="📢 チャンネル設定",
            value=(
                f"**LvUP通知:** {format_setting_status(self.bot, guild, 'LEVEL_UP_CHANNEL_ID')}\n"
                f"**自己紹介:** {format_setting_status(self.bot, guild, 'SELF_INTRO_CHANNEL_IDS')}\n"
                f"**評価フォーラム:** {format_setting_status(self.bot, guild, 'EVALUATION_FORUM_CHANNEL_IDS')}\n"
                f"**評価カテゴリ:** {format_setting_status(self.bot, guild, 'EVALUATION_CATEGORY_ID')}"
            ),
            inline=False
        )

        embed.set_footer(text="編集は /設定 ダッシュボード を使用してください。")
        await interaction.followup.send(embed=embed, ephemeral=True)


    # ----------------------------------------------------------
    # 残高操作（管理機能としてそのまま残す）
    # ----------------------------------------------------------
    @app_commands.command(name="残高付与", description="【管理者専用】指定ユーザーに通貨を付与します")
    @app_commands.describe(user="対象ユーザー", amount="付与する金額")
    async def grant_balance(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return
        if amount == 0:
            return await interaction.response.send_message("0以外の値を指定してください。", ephemeral=True)

        guild_id = interaction.guild.id
        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        new_balance = await database.add_balance(guild_id, user.id, amount)

        action = "付与" if amount > 0 else "没収"
        embed = discord.Embed(
            title=f"💰 残高{action}",
            color=discord.Color.green() if amount > 0 else discord.Color.red()
        )
        embed.add_field(name="対象者",   value=user.mention,               inline=True)
        embed.add_field(name=action,     value=f"{abs(amount):,} {currency_name}", inline=True)
        embed.add_field(name="変更後残高", value=f"{new_balance:,} {currency_name}", inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)

        log_embed = discord.Embed(
            title=f"💰 管理者による残高{action}",
            color=discord.Color.gold(),
            timestamp=discord.utils.utcnow()
        )
        log_embed.add_field(name="管理者", value=f"{interaction.user.mention}", inline=True)
        log_embed.add_field(name="対象者", value=f"{user.mention}", inline=True)
        log_embed.add_field(name=action,   value=f"{abs(amount):,} {currency_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", log_embed)

    @app_commands.command(name="残高確認", description="指定ユーザーの残高を確認します")
    @app_commands.describe(user="確認するユーザー（省略時は自分）")
    async def check_balance(self, interaction: discord.Interaction, user: discord.Member = None):
        if not interaction.guild:
            return
        target = user or interaction.user
        guild_id = interaction.guild.id
        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        balance = await database.get_balance(guild_id, target.id)

        embed = discord.Embed(
            title=f"💰 {target.display_name} の残高",
            description=f"**{balance:,} {currency_name}**",
            color=discord.Color.gold()
        )
        embed.set_thumbnail(url=target.display_avatar.url)
        await interaction.response.send_message(embed=embed, ephemeral=True)


# ============================================================
# Cog 本体
# ============================================================
class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(AdminGroup(self.bot))
        # Viewをpersistentとして登録する場合はここで行うが、今回はカテゴリ切り替えがあるため動的に生成

    async def cog_unload(self):
        self.bot.tree.remove_command("設定")

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild):
        self.bot.guild_settings_cache[guild.id] = await database.load_guild_settings(guild.id)
        print(f"[INFO] Joined new guild: {guild.name} (ID: {guild.id})")


async def setup(bot):
    await bot.add_cog(Admin(bot))
