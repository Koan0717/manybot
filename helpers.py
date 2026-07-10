"""
helpers.py - ユーティリティ関数・権限チェック・ログ送信
全設定はguild_idベースのget_guild_setting()から取得する。
"""
import datetime
import discord
from discord import app_commands
import database
from config import JST, DEFAULT_GUILD_SETTINGS


# ============================================================
# 設定取得ヘルパー
# ============================================================
def get_setting(bot, guild_id: int, key: str):
    """
    bot.guild_settings_cache[guild_id][key] → なければDEFAULT_GUILD_SETTINGSのデフォルト値
    """
    cache = getattr(bot, "guild_settings_cache", {})
    guild_cache = cache.get(guild_id, {})
    if key in guild_cache:
        return guild_cache[key]
    return DEFAULT_GUILD_SETTINGS.get(key)


def get_role_by_setting(bot, guild: discord.Guild, guild_id: int, key: str) -> discord.Role | None:
    role_id = get_setting(bot, guild_id, key)
    if role_id:
        return guild.get_role(int(role_id))
    return None


def get_roles_by_setting(bot, guild: discord.Guild, guild_id: int, key: str) -> list[discord.Role]:
    role_ids = get_setting(bot, guild_id, key) or []
    roles = []
    for rid in role_ids:
        r = guild.get_role(int(rid))
        if r:
            roles.append(r)
    return roles


# ============================================================
# 権限チェック
# ============================================================
def has_admin_role(bot, member: discord.Member) -> bool:
    if member.guild_permissions.administrator:
        return True
    admin_ids = get_setting(bot, member.guild.id, "ADMIN_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in admin_ids)


def has_interviewer_role(bot, member: discord.Member) -> bool:
    if has_admin_role(bot, member):
        return True
    ids = get_setting(bot, member.guild.id, "INTERVIEWER_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in ids)


def get_evaluator_tier(bot, member: discord.Member) -> int:
    """0=権限なし, 1=評価員Tier1, 2=Tier2, 3=Tier3/管理者"""
    if member.guild_permissions.administrator:
        return 3

    guild_id = member.guild.id
    member_role_ids = [r.id for r in member.roles]

    admin_ids = get_setting(bot, guild_id, "ADMIN_ROLE_IDS") or []
    if any(int(rid) in member_role_ids for rid in admin_ids):
        return 3

    tier3_ids = get_setting(bot, guild_id, "EVALUATOR_TIER3_ROLE_IDS") or []
    if any(int(rid) in member_role_ids for rid in tier3_ids):
        return 3

    tier2_ids = get_setting(bot, guild_id, "EVALUATOR_TIER2_ROLE_IDS") or []
    if any(int(rid) in member_role_ids for rid in tier2_ids):
        return 2

    tier1_ids = get_setting(bot, guild_id, "EVALUATOR_TIER1_ROLE_IDS") or []
    if any(int(rid) in member_role_ids for rid in tier1_ids):
        return 1

    # 後方互換: 旧EVALUATOR_ROLE_IDSも確認
    old_ids = get_setting(bot, guild_id, "EVALUATOR_ROLE_IDS") or []
    if any(int(rid) in member_role_ids for rid in old_ids):
        return 1

    return 0


def has_evaluator_role(bot, member: discord.Member) -> bool:
    return get_evaluator_tier(bot, member) > 0


def has_event_manager_role(bot, member: discord.Member) -> bool:
    if has_admin_role(bot, member):
        return True
    ids = get_setting(bot, member.guild.id, "EVENT_MANAGER_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in ids)


def has_banker_role(bot, member: discord.Member) -> bool:
    if has_admin_role(bot, member):
        return True
    ids = get_setting(bot, member.guild.id, "BANKER_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in ids)


def is_main_or_sub_member(bot, member: discord.Member) -> bool:
    ids = get_setting(bot, member.guild.id, "MAIN_SUB_MEMBER_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in ids)


def is_new_member(bot, member: discord.Member) -> bool:
    role_id = get_setting(bot, member.guild.id, "NEW_MEMBER_ROLE_ID")
    if role_id:
        return any(r.id == int(role_id) for r in member.roles)
    return False


def is_free_inn_member(bot, member: discord.Member) -> bool:
    ids = get_setting(bot, member.guild.id, "FREE_INN_ROLE_IDS") or []
    member_role_ids = [r.id for r in member.roles]
    return any(int(rid) in member_role_ids for rid in ids)


# ============================================================
# チャンネル適格性判定（ランク・VCコイン）
# ============================================================
def _check_channel_eligible(channel, cfg: dict) -> bool:
    whitelist = set(cfg.get("whitelist", []))
    blacklist = set(cfg.get("blacklist", []))
    wl_cats   = set(cfg.get("categories", []))
    bl_cats   = set(cfg.get("blacklist_categories", []))

    has_whitelist = bool(whitelist or wl_cats)
    has_blacklist = bool(blacklist or bl_cats)

    in_whitelist = channel.id in whitelist or (channel.category and channel.category.id in wl_cats)
    in_blacklist = channel.id in blacklist or (channel.category and channel.category.id in bl_cats)

    if not has_whitelist and not has_blacklist:
        return True
    elif has_whitelist and not has_blacklist:
        return in_whitelist
    elif not has_whitelist and has_blacklist:
        return not in_blacklist
    else:
        return in_whitelist and not in_blacklist


def is_rank_eligible(bot, channel) -> bool:
    if not channel or not getattr(channel, "guild", None):
        return False
    cfg = bot.get_rank_config(channel.guild.id)
    return _check_channel_eligible(channel, cfg)


def is_vc_coins_eligible(bot, channel) -> bool:
    if not channel or not getattr(channel, "guild", None):
        return False
    cfg = bot.get_vc_coins_config(channel.guild.id)
    return _check_channel_eligible(channel, cfg)


# ============================================================
# ログ送信
# ============================================================
async def send_log(bot, guild: discord.Guild, log_type: str, embed: discord.Embed):
    if not guild:
        return
    channel_id = await database.get_log_channel(guild.id, log_type)
    if not channel_id:
        return
    channel = guild.get_channel(channel_id)
    if not channel:
        try:
            channel = await guild.fetch_channel(channel_id)
        except Exception:
            return
    try:
        await channel.send(embed=embed)
    except Exception as e:
        print(f"[ERROR] send_log({log_type}): {e}")


# ============================================================
# レベルアップ処理
# ============================================================
async def check_and_assign_level_roles(bot, member: discord.Member, level_type: str, new_level: int):
    guild_id = member.guild.id
    rewards = await database.get_level_role_rewards(guild_id, level_type)
    if not rewards:
        return

    # 現レベル以下の最大レベル報酬のみを付与（累積ではなく最新ロールに切り替え）
    target_level = -1
    for r in rewards:
        if r["level"] <= new_level:
            target_level = max(target_level, r["level"])

    roles_to_add = []
    roles_to_remove = []
    for r in rewards:
        role = member.guild.get_role(r["role_id"])
        if not role:
            continue
        if r["level"] == target_level:
            if role not in member.roles:
                roles_to_add.append(role)
        else:
            if role in member.roles:
                roles_to_remove.append(role)

    try:
        if roles_to_remove:
            await member.remove_roles(*roles_to_remove, reason=f"{level_type.upper()}レベル更新（古いロール解除）")
        if roles_to_add:
            await member.add_roles(*roles_to_add, reason=f"{level_type.upper()}レベル到達報酬 (Lv.{new_level})")
            role_mentions = ", ".join(r.mention for r in roles_to_add)
            lv_channel_id = get_setting(bot, guild_id, "LEVEL_UP_CHANNEL_ID")
            if lv_channel_id:
                lv_ch = member.guild.get_channel(int(lv_channel_id))
                if lv_ch:
                    await lv_ch.send(
                        f"🎁 {member.mention} が **{level_type.upper()} Lv.{new_level}** に到達し、"
                        f"ロールが付与されました！\n{role_mentions}"
                    )
    except Exception as e:
        print(f"[ERROR] check_and_assign_level_roles({member.display_name}): {e}")


async def check_and_assign_level_coins(bot, member: discord.Member, level_type: str, new_level: int):
    guild_id = member.guild.id
    rewards = await database.get_level_coin_rewards(guild_id, level_type)
    coins_to_add = sum(r["coins"] for r in rewards if r["level"] == new_level)
    if coins_to_add <= 0:
        return
    try:
        await database.add_balance(guild_id, member.id, coins_to_add)
        currency_name = get_setting(bot, guild_id, "CURRENCY_NAME") or "コイン"
        lv_channel_id = get_setting(bot, guild_id, "LEVEL_UP_CHANNEL_ID")
        if lv_channel_id:
            lv_ch = member.guild.get_channel(int(lv_channel_id))
            if lv_ch:
                await lv_ch.send(
                    f"🪙 {member.mention} が **{level_type.upper()} Lv.{new_level}** 到達報酬として "
                    f"**{coins_to_add:,} {currency_name}** が付与されました！"
                )
    except Exception as e:
        print(f"[ERROR] check_and_assign_level_coins({member.display_name}): {e}")


# ============================================================
# 日時フォーマット
# ============================================================
def format_jst_datetime(dt: datetime.datetime) -> str:
    if not dt:
        return "データなし"
    if dt.tzinfo is not None:
        dt = dt.astimezone(JST)
    weekday_ja = ["月", "火", "水", "木", "金", "土", "日"][dt.weekday()]
    return dt.strftime(f"%Y年%m月%d日({weekday_ja}) %H:%M")


# ============================================================
# 設定表示用フォーマット
# ============================================================
def format_setting_status(bot, guild: discord.Guild, key: str) -> str:
    val = get_setting(bot, guild.id, key)
    if val is None or val == [] or val == "":
        return "❌ 未設定"
    if isinstance(val, bool):
        return "🟢 有効" if val else "🔴 無効"
    if "ROLE" in key:
        if isinstance(val, list):
            roles = [guild.get_role(int(rid)) for rid in val]
            mentions = [r.mention for r in roles if r]
            return ", ".join(mentions) if mentions else "❌ 未設定（ロールが見つかりません）"
        else:
            r = guild.get_role(int(val))
            return r.mention if r else "❌ 未設定（ロールが見つかりません）"
    if "CHANNEL" in key or "FORUM" in key:
        if isinstance(val, list):
            channels = [guild.get_channel(int(cid)) for cid in val]
            mentions = [c.mention for c in channels if c]
            return ", ".join(mentions) if mentions else "❌ 未設定（チャンネルが見つかりません）"
        else:
            c = guild.get_channel(int(val))
            return c.mention if c else "❌ 未設定（チャンネルが見つかりません）"
    if "CATEGORY" in key:
        c = guild.get_channel(int(val)) if val else None
        return c.name if c else "❌ 未設定（カテゴリーが見つかりません）"
    return str(val)


# ============================================================
# app_commands チェックデコレータ
# ============================================================
def is_admin():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            return False
        if has_admin_role(interaction.client, interaction.user):
            return True
        await interaction.response.send_message(
            "このコマンドは管理者専用です。", ephemeral=True
        )
        return False
    return app_commands.check(predicate)


def is_admin_or_interviewer():
    async def predicate(interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            return False
        if has_admin_role(interaction.client, interaction.user) or \
           has_interviewer_role(interaction.client, interaction.user):
            return True
        await interaction.response.send_message(
            "このコマンドは管理者または面接官専用です。", ephemeral=True
        )
        return False
    return app_commands.check(predicate)
