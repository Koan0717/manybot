"""
cogs/admin.py - 管理者用設定コマンド
全設定はguild_idベースでSupabaseに保存される。
Botの再起動不要でDiscord上から設定変更可能。
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
# /設定 コマンドグループ
# ============================================================
class AdminGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="設定", description="【管理者専用】サーバー設定コマンド")
        self.bot = bot

    def _admin_check(self, member: discord.Member) -> bool:
        return has_admin_role(self.bot, member)

    # ----------------------------------------------------------
    # 現在の設定一覧表示
    # ----------------------------------------------------------
    @app_commands.command(name="確認", description="【管理者専用】現在のサーバー設定を表示します")
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

        # --- 通貨設定 ---
        currency_name  = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        initial_coins  = get_setting(self.bot, guild_id, "INITIAL_COINS") or 30000
        embed.add_field(
            name="💰 通貨設定",
            value=(
                f"**通貨名:** {currency_name}\n"
                f"**入界初期コイン:** {int(initial_coins):,} {currency_name}"
            ),
            inline=False
        )

        # --- ロール設定 ---
        embed.add_field(
            name="👥 ロール設定",
            value=(
                f"**新メンバーロール:** {format_setting_status(self.bot, guild, 'NEW_MEMBER_ROLE_ID')}\n"
                f"**入界待機ロール:** {format_setting_status(self.bot, guild, 'PENDING_MEMBER_ROLE_ID')}\n"
                f"**面接官ロール:** {format_setting_status(self.bot, guild, 'INTERVIEWER_ROLE_IDS')}\n"
                f"**管理者ロール:** {format_setting_status(self.bot, guild, 'ADMIN_ROLE_IDS')}\n"
                f"**評価員Tier1:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER1_ROLE_IDS')}\n"
                f"**評価員Tier2:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER2_ROLE_IDS')}\n"
                f"**評価員Tier3:** {format_setting_status(self.bot, guild, 'EVALUATOR_TIER3_ROLE_IDS')}\n"
                f"**本・準メンバー:** {format_setting_status(self.bot, guild, 'MAIN_SUB_MEMBER_ROLE_IDS')}\n"
                f"**評価落ちロール:** {format_setting_status(self.bot, guild, 'DOWNGRADE_ROLE_ID')}"
            ),
            inline=False
        )

        # --- チャンネル設定 ---
        embed.add_field(
            name="📢 チャンネル設定",
            value=(
                f"**レベルアップ通知:** {format_setting_status(self.bot, guild, 'LEVEL_UP_CHANNEL_ID')}\n"
                f"**自己紹介チャンネル:** {format_setting_status(self.bot, guild, 'SELF_INTRO_CHANNEL_IDS')}\n"
                f"**評価フォーラム:** {format_setting_status(self.bot, guild, 'EVALUATION_FORUM_CHANNEL_IDS')}\n"
                f"**評価浮上カテゴリ:** {format_setting_status(self.bot, guild, 'EVALUATION_CATEGORY_ID')}"
            ),
            inline=False
        )

        # --- レベリング設定 ---
        embed.add_field(
            name="📊 レベリング設定",
            value=(
                f"**TCランク:** {format_setting_status(self.bot, guild, 'ENABLE_TC_RANK')}\n"
                f"**VCランク:** {format_setting_status(self.bot, guild, 'ENABLE_VC_RANK')}\n"
                f"**VCコイン:** {format_setting_status(self.bot, guild, 'ENABLE_VC_COINS')}\n"
                f"**VCコイン/分:** {get_setting(self.bot, guild_id, 'VC_COINS_PER_MIN') or 12}"
            ),
            inline=False
        )

        embed.set_footer(text="設定変更は /設定 ロール / チャンネル / 通貨 コマンドで行えます。")
        await interaction.followup.send(embed=embed, ephemeral=True)

    # ----------------------------------------------------------
    # 通貨設定
    # ----------------------------------------------------------
    @app_commands.command(name="通貨名", description="【管理者専用】このサーバーの通貨名を変更します")
    @app_commands.describe(name="新しい通貨名（例: Rune, コイン, ゴールド）")
    async def set_currency_name(self, interaction: discord.Interaction, name: str):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "CURRENCY_NAME", name)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 通貨名を **{name}** に変更しました。", ephemeral=True)

    @app_commands.command(name="初期コイン", description="【管理者専用】入界時の初期コイン数を変更します")
    @app_commands.describe(amount="初期コイン数")
    async def set_initial_coins(self, interaction: discord.Interaction, amount: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return
        if amount < 0:
            return await interaction.response.send_message("0以上の値を指定してください。", ephemeral=True)

        guild_id = interaction.guild.id
        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        await database.set_guild_setting(guild_id, "INITIAL_COINS", amount)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 初期コインを **{amount:,} {currency_name}** に変更しました。", ephemeral=True)

    # ----------------------------------------------------------
    # ロール設定
    # ----------------------------------------------------------
    @app_commands.command(name="新メンバーロール", description="【管理者専用】新メンバーロールを設定します")
    @app_commands.describe(role="設定するロール")
    async def set_new_member_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "NEW_MEMBER_ROLE_ID", role.id)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 新メンバーロールを {role.mention} に設定しました。", ephemeral=True)

    @app_commands.command(name="入界待機ロール", description="【管理者専用】入界待機ロールを設定します")
    @app_commands.describe(role="設定するロール")
    async def set_pending_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "PENDING_MEMBER_ROLE_ID", role.id)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 入界待機ロールを {role.mention} に設定しました。", ephemeral=True)

    @app_commands.command(name="管理者ロール追加", description="【管理者専用】管理者ロールを追加します")
    @app_commands.describe(role="追加するロール")
    async def add_admin_role(self, interaction: discord.Interaction, role: discord.Role):
        if not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("サーバー管理者権限が必要です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "ADMIN_ROLE_IDS") or []
        if role.id not in ids:
            ids.append(role.id)
        await database.set_guild_setting(guild_id, "ADMIN_ROLE_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 管理者ロールに {role.mention} を追加しました。", ephemeral=True)

    @app_commands.command(name="管理者ロール削除", description="【管理者専用】管理者ロールを削除します")
    @app_commands.describe(role="削除するロール")
    async def remove_admin_role(self, interaction: discord.Interaction, role: discord.Role):
        if not interaction.user.guild_permissions.administrator:
            return await interaction.response.send_message("サーバー管理者権限が必要です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "ADMIN_ROLE_IDS") or []
        ids = [i for i in ids if i != role.id]
        await database.set_guild_setting(guild_id, "ADMIN_ROLE_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 管理者ロールから {role.mention} を削除しました。", ephemeral=True)

    @app_commands.command(name="面接官ロール追加", description="【管理者専用】面接官ロールを追加します")
    @app_commands.describe(role="追加するロール")
    async def add_interviewer_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "INTERVIEWER_ROLE_IDS") or []
        if role.id not in ids:
            ids.append(role.id)
        await database.set_guild_setting(guild_id, "INTERVIEWER_ROLE_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 面接官ロールに {role.mention} を追加しました。", ephemeral=True)

    @app_commands.command(name="面接官ロール削除", description="【管理者専用】面接官ロールを削除します")
    @app_commands.describe(role="削除するロール")
    async def remove_interviewer_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "INTERVIEWER_ROLE_IDS") or []
        ids = [i for i in ids if i != role.id]
        await database.set_guild_setting(guild_id, "INTERVIEWER_ROLE_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 面接官ロールから {role.mention} を削除しました。", ephemeral=True)

    @app_commands.command(name="評価員ロール追加", description="【管理者専用】評価員ロールをTierに追加します")
    @app_commands.describe(role="追加するロール", tier="Tier番号 (1〜3)")
    @app_commands.choices(tier=[
        app_commands.Choice(name="Tier 1（一般評価員）", value=1),
        app_commands.Choice(name="Tier 2（中堅評価員）", value=2),
        app_commands.Choice(name="Tier 3（上位評価員）", value=3),
    ])
    async def add_evaluator_role(self, interaction: discord.Interaction, role: discord.Role, tier: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        key = f"EVALUATOR_TIER{tier}_ROLE_IDS"
        ids = get_setting(self.bot, guild_id, key) or []
        if role.id not in ids:
            ids.append(role.id)
        await database.set_guild_setting(guild_id, key, ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 評価員Tier{tier}に {role.mention} を追加しました。", ephemeral=True)

    @app_commands.command(name="評価員ロール削除", description="【管理者専用】評価員ロールをTierから削除します")
    @app_commands.describe(role="削除するロール", tier="Tier番号 (1〜3)")
    @app_commands.choices(tier=[
        app_commands.Choice(name="Tier 1", value=1),
        app_commands.Choice(name="Tier 2", value=2),
        app_commands.Choice(name="Tier 3", value=3),
    ])
    async def remove_evaluator_role(self, interaction: discord.Interaction, role: discord.Role, tier: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        key = f"EVALUATOR_TIER{tier}_ROLE_IDS"
        ids = get_setting(self.bot, guild_id, key) or []
        ids = [i for i in ids if i != role.id]
        await database.set_guild_setting(guild_id, key, ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 評価員Tier{tier}から {role.mention} を削除しました。", ephemeral=True)

    @app_commands.command(name="評価落ちロール", description="【管理者専用】評価落ちロールを設定します")
    @app_commands.describe(role="設定するロール")
    async def set_downgrade_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "DOWNGRADE_ROLE_ID", role.id)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 評価落ちロールを {role.mention} に設定しました。", ephemeral=True)

    @app_commands.command(name="本準メンバーロール追加", description="【管理者専用】本・準メンバーロールを追加します")
    @app_commands.describe(role="追加するロール")
    async def add_main_sub_role(self, interaction: discord.Interaction, role: discord.Role):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "MAIN_SUB_MEMBER_ROLE_IDS") or []
        if role.id not in ids:
            ids.append(role.id)
        await database.set_guild_setting(guild_id, "MAIN_SUB_MEMBER_ROLE_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 本・準メンバーロールに {role.mention} を追加しました。", ephemeral=True)

    # ----------------------------------------------------------
    # チャンネル設定
    # ----------------------------------------------------------
    @app_commands.command(name="レベルアップ通知チャンネル", description="【管理者専用】レベルアップ通知チャンネルを設定します")
    @app_commands.describe(channel="設定するチャンネル")
    async def set_levelup_channel(self, interaction: discord.Interaction, channel: discord.TextChannel):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "LEVEL_UP_CHANNEL_ID", channel.id)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ レベルアップ通知チャンネルを {channel.mention} に設定しました。", ephemeral=True)

    @app_commands.command(name="評価浮上カテゴリ", description="【管理者専用】評価浮上時間を計測するVCカテゴリを設定します")
    @app_commands.describe(category="設定するカテゴリ")
    async def set_eval_category(self, interaction: discord.Interaction, category: discord.CategoryChannel):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "EVALUATION_CATEGORY_ID", category.id)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 評価浮上カテゴリを **{category.name}** に設定しました。", ephemeral=True)

    @app_commands.command(name="自己紹介チャンネル追加", description="【管理者専用】評価スレッドを自動作成する自己紹介チャンネルを追加します")
    @app_commands.describe(channel="追加するチャンネル")
    async def add_self_intro_channel(self, interaction: discord.Interaction, channel: discord.TextChannel):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        ids = get_setting(self.bot, guild_id, "SELF_INTRO_CHANNEL_IDS") or []
        if channel.id not in ids:
            ids.append(channel.id)
        await database.set_guild_setting(guild_id, "SELF_INTRO_CHANNEL_IDS", ids)
        await self.bot.refresh_guild_settings(guild_id)

        # evaluation_settings も更新
        forum_ids = get_setting(self.bot, guild_id, "EVALUATION_FORUM_CHANNEL_IDS") or []
        await database.set_evaluation_settings(guild_id, forum_ids, ids)
        self.bot.evaluation_settings_cache[guild_id] = {
            "forum_channel_ids": set(forum_ids),
            "self_intro_channel_ids": set(ids)
        }
        await interaction.response.send_message(f"✅ 自己紹介チャンネルに {channel.mention} を追加しました。", ephemeral=True)

    @app_commands.command(name="評価フォーラム追加", description="【管理者専用】評価スレッドを作成するフォーラムチャンネルを追加します")
    @app_commands.describe(forum="追加するフォーラムチャンネル")
    async def add_eval_forum(self, interaction: discord.Interaction, forum: discord.ForumChannel):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        forum_ids = get_setting(self.bot, guild_id, "EVALUATION_FORUM_CHANNEL_IDS") or []
        if forum.id not in forum_ids:
            forum_ids.append(forum.id)
        await database.set_guild_setting(guild_id, "EVALUATION_FORUM_CHANNEL_IDS", forum_ids)
        await self.bot.refresh_guild_settings(guild_id)

        intro_ids = get_setting(self.bot, guild_id, "SELF_INTRO_CHANNEL_IDS") or []
        await database.set_evaluation_settings(guild_id, forum_ids, intro_ids)
        self.bot.evaluation_settings_cache[guild_id] = {
            "forum_channel_ids": set(forum_ids),
            "self_intro_channel_ids": set(intro_ids)
        }
        await interaction.response.send_message(f"✅ 評価フォーラムに {forum.mention} を追加しました。", ephemeral=True)

    # ----------------------------------------------------------
    # ログ設定
    # ----------------------------------------------------------
    @app_commands.command(name="ログチャンネル設定", description="【管理者専用】ログの種別とチャンネルを設定します")
    @app_commands.describe(channel="ログを送信するチャンネル")
    @app_commands.choices(log_type=[
        app_commands.Choice(name="参加・退出",           value="join_leave"),
        app_commands.Choice(name="BAN・BAN解除",         value="ban_unban"),
        app_commands.Choice(name="メッセージ編集・削除",  value="message_edit_delete"),
        app_commands.Choice(name="VC参加・退出",          value="vc_join_leave"),
        app_commands.Choice(name="タイムアウト",          value="timeout"),
        app_commands.Choice(name="評価シート",            value="evaluation"),
        app_commands.Choice(name="評価落ち",              value="evaluation_failure"),
        app_commands.Choice(name="面接官",                value="interviewer"),
        app_commands.Choice(name="通貨",                  value="currency"),
    ])
    async def set_log_channel(self, interaction: discord.Interaction,
                               log_type: str, channel: discord.TextChannel):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        await database.set_log_channel(interaction.guild.id, log_type, channel.id)

        type_names = {
            "join_leave":          "参加・退出",
            "ban_unban":           "BAN・BAN解除",
            "message_edit_delete": "メッセージ編集・削除",
            "vc_join_leave":       "VC参加・退出",
            "timeout":             "タイムアウト",
            "evaluation":          "評価シート",
            "evaluation_failure":  "評価落ち",
            "interviewer":         "面接官",
            "currency":            "通貨",
        }
        await interaction.response.send_message(
            f"✅ 「{type_names.get(log_type, log_type)}」のログチャンネルを {channel.mention} に設定しました。",
            ephemeral=True
        )

    @app_commands.command(name="ログ設定確認", description="【管理者専用】現在のログ設定を確認します")
    async def show_log_settings(self, interaction: discord.Interaction):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        rows = await database.get_all_log_settings(guild_id)

        type_names = {
            "join_leave":          "参加・退出",
            "ban_unban":           "BAN・BAN解除",
            "message_edit_delete": "メッセージ編集・削除",
            "vc_join_leave":       "VC参加・退出",
            "timeout":             "タイムアウト",
            "evaluation":          "評価シート",
            "evaluation_failure":  "評価落ち",
            "interviewer":         "面接官",
            "currency":            "通貨",
        }

        embed = discord.Embed(title="📋 ログ設定一覧", color=discord.Color.blurple())
        if not rows:
            embed.description = "ログチャンネルが設定されていません。"
        else:
            for row in rows:
                ch = interaction.guild.get_channel(row["channel_id"])
                ch_str = ch.mention if ch else f"❌ ID:{row['channel_id']}"
                embed.add_field(
                    name=type_names.get(row["log_type"], row["log_type"]),
                    value=ch_str,
                    inline=True
                )
        await interaction.followup.send(embed=embed, ephemeral=True)

    # ----------------------------------------------------------
    # VCコイン設定
    # ----------------------------------------------------------
    @app_commands.command(name="vcコイン", description="【管理者専用】VC報酬コインの有効/無効を切り替えます")
    @app_commands.describe(enabled="有効にするか")
    async def toggle_vc_coins(self, interaction: discord.Interaction, enabled: bool):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "ENABLE_VC_COINS", enabled)
        await self.bot.refresh_guild_settings(guild_id)
        status = "有効" if enabled else "無効"
        await interaction.response.send_message(f"✅ VCコイン報酬を **{status}** にしました。", ephemeral=True)

    @app_commands.command(name="vcコイン毎分", description="【管理者専用】VC滞在1分あたりのコイン数を設定します")
    @app_commands.describe(amount="1分あたりのコイン数")
    async def set_vc_coins_per_min(self, interaction: discord.Interaction, amount: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return
        if amount < 0:
            return await interaction.response.send_message("0以上の値を指定してください。", ephemeral=True)

        guild_id = interaction.guild.id
        currency_name = get_setting(self.bot, guild_id, "CURRENCY_NAME") or "コイン"
        await database.set_guild_setting(guild_id, "VC_COINS_PER_MIN", amount)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ VC報酬を **{amount} {currency_name}/分** に設定しました。", ephemeral=True)

    # ----------------------------------------------------------
    # 評価期間設定
    # ----------------------------------------------------------
    @app_commands.command(name="評価期間日数", description="【管理者専用】評価期間のデフォルト日数を設定します")
    @app_commands.describe(days="評価期間の日数")
    async def set_eval_days(self, interaction: discord.Interaction, days: int):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return
        if days <= 0:
            return await interaction.response.send_message("1以上の値を指定してください。", ephemeral=True)

        guild_id = interaction.guild.id
        await database.set_guild_setting(guild_id, "EVAL_DURATION_DAYS", days)
        await self.bot.refresh_guild_settings(guild_id)
        await interaction.response.send_message(f"✅ 評価期間のデフォルト日数を **{days}日** に設定しました。", ephemeral=True)

    # ----------------------------------------------------------
    # リロード（設定キャッシュの強制更新）
    # ----------------------------------------------------------
    @app_commands.command(name="設定リロード", description="【管理者専用】このサーバーの設定キャッシュを再読み込みします")
    async def reload_settings(self, interaction: discord.Interaction):
        if not self._admin_check(interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        await self.bot.refresh_guild_settings(guild_id)

        # 評価設定も再ロード
        es = await database.get_evaluation_settings(guild_id)
        self.bot.evaluation_settings_cache[guild_id] = {
            "forum_channel_ids": set(es["forum_channel_ids"]),
            "self_intro_channel_ids": set(es["self_intro_channel_ids"])
        }

        await interaction.followup.send("✅ 設定キャッシュを再読み込みしました。", ephemeral=True)

    # ----------------------------------------------------------
    # 残高操作（管理者）
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

        # ログ送信
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

    async def cog_unload(self):
        self.bot.tree.remove_command("設定")

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild):
        """新しいサーバーに参加したとき設定を初期化"""
        self.bot.guild_settings_cache[guild.id] = await database.load_guild_settings(guild.id)
        print(f"[INFO] Joined new guild: {guild.name} (ID: {guild.id})")


async def setup(bot):
    await bot.add_cog(Admin(bot))
