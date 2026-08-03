import discord
import datetime
import database

JST = datetime.timezone(datetime.timedelta(hours=9))

# 部屋作成の設定
ROOM_SETTINGS = {
    "宿": {
        12: {"price": 10000, "duration_hours": 12},
        24: {"price": 15000, "duration_hours": 24}
    },
    "高級宿": {
        12: {"price": 150000, "duration_hours": 12},
        24: {"price": 250000, "duration_hours": 24}
    },
    "カスタムVC": {
        24: {"price": 30000, "duration_hours": 24}
    }
}
CREATE_VC_CHANNEL_ID = 123456789012345678

# 面接・入界設定
NEW_MEMBER_ROLE_NAME = "【仮】新規メンバーロール名"
PENDING_MEMBER_ROLE_NAME = "【仮】入界待機者ロール名"
INTERVIEWER_ROLE_NAMES = ["【仮】面接官ロール名A", "【仮】面接官ロール名B"]
MAIN_SUB_MEMBER_ROLE_NAMES = ["【仮】本・準メンバーロール名A", "【仮】本・準メンバーロール名B"]
EMBLEM_MANAGER_ROLE_NAME = "【仮】スタンプ統括ロール名"
EMBLEM_MASTER_ROLE_NAME = "【仮】スタンプ制作ロール名"
CONFESSION_PRIEST_ROLE_NAME = "【仮】告解司祭ロール名"
PRIEST_ROLE_NAME = "【仮】司祭ロール名"

# 自己紹介・評価設定
SELF_INTRO_CHANNEL_IDS = [123456789012345678, 123456789012345678]
EVALUATION_FORUM_CHANNEL_IDS = []
EVALUATION_FAILED_ROLE_NAME = "評価落ち"
VIOLATOR_ROLE_NAME = "ルール違反者"

# --- 運営権限チェック用の仮ロール名 ---
ADMIN_ROLE_NAMES = ["【仮】管理者ロール名A", "【仮】管理者ロール名B"]
EVALUATOR_ROLE_NAMES = ["【仮】評価員ロール名A", "【仮】評価員ロール名B"]

# --- 動的設定管理 (DB保存) ---
DEFAULT_SETTINGS = {
    "LEVEL_UP_CHANNEL_ID": 123456789012345678,
    "CREATE_VC_CHANNEL_ID": 123456789012345678,
    "EVAL_TIME_CATEGORY_ID": 123456789012345678,
    "NEW_MEMBER_ROLE_ID": 123456789012345678,
    "PENDING_MEMBER_ROLE_ID": 123456789012345678,
    "INTERVIEWER_ROLE_IDS": [],
    "MAIN_SUB_MEMBER_ROLE_IDS": [],
    "EMBLEM_MANAGER_ROLE_ID": 123456789012345678,
    "EMBLEM_MASTER_ROLE_ID": 123456789012345678,
    "EMBLEM_MASTER_ROLE_IDS": [],
    "CONFESSION_PRIEST_ROLE_ID": 123456789012345678,
    "PRIEST_ROLE_ID": 123456789012345678,
    "ADMIN_ROLE_IDS": [],
    "EVALUATOR_ROLE_IDS": [],
    "EVENT_MANAGER_ROLE_IDS": [],
    "SELF_INTRO_CHANNEL_IDS": [],
    "EVALUATION_FORUM_CHANNEL_IDS": [],
    "GAMBLE_CHINCHIRO_EXPECTATION": 0.95,
    "GAMBLE_COINFLIP_EXPECTATION": 0.95,
    "GAMBLE_SLOT_EXPECTATION": 0.95,
    "GAMBLE_BLACKJACK_EXPECTATION": 0.95,
    "GAMBLE_ROULETTE_EXPECTATION": 0.95,
    "GAMBLE_MAX_BET": 100000,
    "GAMBLE_MAX_PLAYS": 10,
    "GAMBLE_DAILY_LIMIT": 0,
    "EVALUATION_FAILED_ROLE_ID": None,
    "VIOLATOR_ROLE_ID": None,
    "MINUS_TARGET_ROLE_IDS": [],
    "ENABLE_VC_COINS": True,
    "CURRENCY_NAME": "Rune",
    "MSG_COOLDOWN": 60,
    "TC_XP_REWARD": 10,
    "TC_XP_COOLDOWN": 10,
    "VC_XP_PER_MIN": 15,
    "INITIAL_COINS": 30000,
    "ENABLE_EXCLUDE_RANK_ROLE": False,
    "EXCLUDE_RANK_ROLE_IDS": [],
    "ENABLE_ROLE_BASED_LEVEL_REWARDS": False
}

import inspect

import sys

def get_setting(bot, key: str, guild_id: int = None):
    if guild_id is None:
        try:
            f = sys._getframe(1)
            for _ in range(15):
                if f is None: break
                locs = f.f_locals
                if 'interaction' in locs:
                    obj = locs['interaction']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'message' in locs:
                    obj = locs['message']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'member' in locs:
                    obj = locs['member']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'guild' in locs:
                    obj = locs['guild']
                    if hasattr(obj, 'id'):
                        guild_id = obj.id
                        break
                elif 'channel' in locs:
                    obj = locs['channel']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                f = f.f_back
        except Exception:
            pass

    if hasattr(bot, 'bot_settings') and guild_id in bot.bot_settings and key in bot.bot_settings[guild_id]:
        return bot.bot_settings[guild_id][key]
    if key == "EVAL_TIME_CATEGORY_ID" and hasattr(bot, 'bot_settings') and guild_id in bot.bot_settings and "RANKING_CATEGORY_ID" in bot.bot_settings[guild_id]:
        return bot.bot_settings[guild_id]["RANKING_CATEGORY_ID"]
    return DEFAULT_SETTINGS.get(key)


def get_role_by_setting(bot, guild, key, default_name):
    role_id = get_setting(bot, key, guild.id)
    try:
        role_id = int(role_id)
    except (TypeError, ValueError):
        role_id = None
    role = guild.get_role(role_id) if role_id else None
    if not role:
        role = discord.utils.get(guild.roles, name=default_name)
    return role

def get_role_by_id_or_name(guild, role_id, default_name):
    role = guild.get_role(role_id) if role_id else None
    if not role:
        role = discord.utils.get(guild.roles, name=default_name)
    return role

def has_event_manager_role(bot, user: discord.Member):
    event_manager_role_ids = get_setting(bot, "EVENT_MANAGER_ROLE_IDS")
    if not event_manager_role_ids:
        event_manager_role_ids = []
    user_role_ids = [role.id for role in user.roles]
    if any(rid in event_manager_role_ids for rid in user_role_ids) or user.guild_permissions.administrator:
        return True
    return False

def has_admin_role(bot, user: discord.Member):
    admin_role_ids = get_setting(bot, "ADMIN_ROLE_IDS")
    if not admin_role_ids:
        admin_role_ids = []
    user_role_ids = [role.id for role in user.roles]
    if any(rid in admin_role_ids for rid in user_role_ids) or user.guild_permissions.administrator:
        return True
    user_role_names = [role.name for role in user.roles]
    if any(name in ADMIN_ROLE_NAMES for name in user_role_names):
        return True
    return False

def get_evaluator_tier(bot, user: discord.Member) -> int:
    if user.guild_permissions.administrator: return 3
    user_role_ids = [r.id for r in user.roles]
    
    admin_ids = get_setting(bot, "ADMIN_ROLE_IDS") or []
    if any(rid in admin_ids for rid in user_role_ids): return 3
    
    tier3_ids = get_setting(bot, "EVALUATOR_TIER3_ROLE_IDS") or []
    if any(rid in tier3_ids for rid in user_role_ids): return 3
    
    tier2_ids = get_setting(bot, "EVALUATOR_TIER2_ROLE_IDS") or []
    if any(rid in tier2_ids for rid in user_role_ids): return 2
    
    tier1_ids = get_setting(bot, "EVALUATOR_TIER1_ROLE_IDS") or []
    if any(rid in tier1_ids for rid in user_role_ids): return 1
    
    old_eval_ids = get_setting(bot, "EVALUATOR_ROLE_IDS") or []
    if any(rid in old_eval_ids for rid in user_role_ids): return 1
    
    user_role_names = [role.name for role in user.roles]
    if any(name in EVALUATOR_ROLE_NAMES or name in ADMIN_ROLE_NAMES for name in user_role_names):
        return 1
    
    return 0

def has_evaluator_role(bot, user: discord.Member) -> bool:
    return get_evaluator_tier(bot, user) > 0

def has_interviewer_role(bot, user: discord.Member):
    interviewer_role_ids = get_setting(bot, "INTERVIEWER_ROLE_IDS") or []
    user_role_ids = [str(r.id) for r in user.roles]
    if any(str(rid) in user_role_ids for rid in interviewer_role_ids):
        return True
    user_role_names = [r.name for r in user.roles]
    if any(name in INTERVIEWER_ROLE_NAMES for name in user_role_names):
        return True
    return False

def is_main_or_sub_member(bot, user: discord.Member):
    main_sub_role_ids = get_setting(bot, "MAIN_SUB_MEMBER_ROLE_IDS")
    user_role_ids = [r.id for r in user.roles]
    if any(rid in main_sub_role_ids for rid in user_role_ids):
        return True
    user_role_names = [r.name for r in user.roles]
    if any(name in MAIN_SUB_MEMBER_ROLE_NAMES for name in user_role_names):
        return True
    return False

def is_in_eval_time_category(bot, channel):
    if not channel or not channel.category:
        return False
    eval_cat_id = get_setting(bot, "EVAL_TIME_CATEGORY_ID")
    if channel.category.id == eval_cat_id:
        return True
    ranking_cat_name = get_setting(bot, "RANKING_CATEGORY_NAME")
    if ranking_cat_name and ranking_cat_name.lower() in channel.category.name.lower():
        return True
    return False

def is_xp_enabled(bot, channel):
    try:
        if not channel or not channel.guild:
            return False
        cfg = bot.get_rank_config(channel.guild.id)
        whitelist = cfg.get("whitelist", set())
        blacklist = cfg.get("blacklist", set())
        wl_categories = cfg.get("whitelist_categories", set())
        bl_categories = cfg.get("blacklist_categories", set())
        
        # どちらも未指定の場合はすべてのチャンネルを対象にする
        if not whitelist and not blacklist and not wl_categories and not bl_categories:
            return True
            
        # 無効チャンネル・カテゴリーは最優先で除外
        if channel.id in blacklist:
            return False
        if channel.category and channel.category.id in bl_categories:
            return False
            
        # 有効（ホワイトリスト）が指定されている場合はその中のみ対象
        # 有効が指定されていない場合は無効以外すべてが対象
        if whitelist or wl_categories:
            in_whitelist = (channel.id in whitelist) or (channel.category and channel.category.id in wl_categories)
            if not in_whitelist:
                return False
            
        return True
    except Exception as e:
        print(f"[ERROR] Error in is_xp_enabled: {e}")
        return False

def is_in_evaluation_category(bot, channel):
    if not channel or not channel.category:
        return False
    cfg = bot.get_rank_config(channel.guild.id)
    categories = cfg.get("categories", set())
    if categories:
        return channel.category.id in categories
    eval_cat_id = get_setting(bot, "EVAL_TIME_CATEGORY_ID")
    if channel.category.id == eval_cat_id:
        return True
    ranking_cat_name = get_setting(bot, "RANKING_CATEGORY_NAME")
    if ranking_cat_name and ranking_cat_name.lower() in channel.category.name.lower():
        return True
    return False

def format_evaluation_datetime(dt: datetime.datetime) -> str:
    if not dt:
        return "データなし"
    if dt.tzinfo is not None:
        dt = dt.astimezone(JST)
    weekday_ja = ["月", "火", "水", "木", "金", "土", "日"][dt.weekday()]
    return dt.strftime(f"%Y年%m月%d日({weekday_ja}) %H:%M")

def _is_role_based_rewards_enabled(bot, guild_id: int) -> bool:
    val = get_setting(bot, "ENABLE_ROLE_BASED_LEVEL_REWARDS", guild_id)
    return str(val).lower() in ["true", "1", "yes", "on"]

async def check_and_assign_level_roles(bot, member: discord.Member, level_type: str, new_level: int):
    # Check if level rewards are enabled
    is_enabled = get_setting(bot, "ENABLE_LEVEL_REWARDS", member.guild.id)
    if str(is_enabled).lower() not in ["true", "1", "yes", "on"]:
        return

    role_based_enabled = _is_role_based_rewards_enabled(bot, member.guild.id)
    member_role_ids = {r.id for r in member.roles}

    try:
        # --- Coin Rewards ---
        coin_rewards = await database.get_level_coin_rewards(member.guild.id, level_type)
        if coin_rewards:
            default_coin_rewards = [cr for cr in coin_rewards if not cr.get("condition_role_id")]
            conditional_coin_rewards = [cr for cr in coin_rewards if cr.get("condition_role_id")]

            active_coin_rewards = default_coin_rewards
            if role_based_enabled:
                matched = [cr for cr in conditional_coin_rewards if cr["condition_role_id"] in member_role_ids and cr["level"] == new_level]
                if matched:
                    active_coin_rewards = matched

            total_coins = 0
            for cr in active_coin_rewards:
                if cr["level"] == new_level:
                    total_coins += cr["coins"]

            if total_coins > 0:
                await database.add_balance(member.guild.id, member.id, total_coins)
                lv_channel_id = get_setting(bot, "LEVEL_UP_CHANNEL_ID", member.guild.id)
                if lv_channel_id:
                    lv_channel = member.guild.get_channel(lv_channel_id)
                    if lv_channel:
                        currency = get_setting(bot, "CURRENCY_NAME", member.guild.id) or "Rune"
                        await lv_channel.send(f"🪙 {member.mention} が {level_type.upper()} レベル {new_level} に到達したボーナスとして、**{total_coins} {currency}** を獲得しました！")

        # --- Role Rewards ---
        cfg = bot.get_rank_config(member.guild.id)
        exclude_enabled = cfg.get("enable_exclude_rank_role", False)
        if str(exclude_enabled).lower() in ["true", "1", "yes", "on", "True"]:
            exclude_role_ids = cfg.get("exclude_rank_role_ids", [])
            if any(r_id in exclude_role_ids for r_id in member_role_ids):
                return

        rewards = await database.get_level_role_rewards(member.guild.id, level_type)
        if not rewards:
            return

        default_rewards = [r for r in rewards if not r.get("condition_role_id")]
        conditional_rewards = [r for r in rewards if r.get("condition_role_id")]

        # ロール別報酬がONの場合、ユーザーが持つ条件ロールに一致するルール群を優先して使用する
        active_rewards = default_rewards
        if role_based_enabled:
            matched = [r for r in conditional_rewards if r["condition_role_id"] in member_role_ids]
            if matched:
                active_rewards = matched

        target_level = -1
        for r in active_rewards:
            if r["level"] <= new_level:
                target_level = max(target_level, r["level"])

        if target_level == -1:
            return

        roles_to_add = []
        roles_to_remove = []

        for r in active_rewards:
            role = member.guild.get_role(r["role_id"])
            if not role: continue

            if r["level"] == target_level:
                roles_to_add.append(role)
            else:
                roles_to_remove.append(role)

        # 過去に付与された他トラック（他条件ロール/デフォルト）の報酬ロールも整理して重複を防ぐ
        for r in rewards:
            if r in active_rewards:
                continue
            role = member.guild.get_role(r["role_id"])
            if role and role not in roles_to_add and role not in roles_to_remove:
                roles_to_remove.append(role)

        new_roles = [r for r in member.roles if r not in roles_to_remove]
        added_any = False
        for r in roles_to_add:
            if r not in new_roles:
                new_roles.append(r)
                added_any = True

        if set(new_roles) != set(member.roles):
            await member.edit(roles=new_roles, reason=f"{level_type.upper()}レベル更新 (Lv.{new_level})")
            
            if added_any and roles_to_add:
                role_mentions = ", ".join([role.mention for role in roles_to_add])
                lv_channel_id = get_setting(bot, "LEVEL_UP_CHANNEL_ID", member.guild.id)
                if lv_channel_id:
                    lv_channel = member.guild.get_channel(lv_channel_id)
                    if lv_channel:
                        await lv_channel.send(f"🎁 {member.mention} が {level_type.upper()} レベル {new_level} に到達したため、以下のロールが付与されました！\n{role_mentions}")
                    
    except Exception as e:
        print(f"[ERROR] check_and_assign_level_roles for {member.display_name}: {e}")

# ------------
async def send_log(guild: discord.Guild, log_type: str, embed: discord.Embed):
    if not guild:
        return
    channel_id = await database.get_log_channel(guild.id, log_type)
    if channel_id:
        channel = guild.get_channel(channel_id)
        if not channel:
            try:
                channel = await guild.fetch_channel(channel_id)
            except:
                pass
        if channel:
            try:
                await channel.send(embed=embed)
            except Exception as e:
                print(f"[ERROR] Failed to send log to channel {channel_id}: {e}")

async def send_economy_log(guild: discord.Guild, title: str, description: str, user: discord.Member = None, color: discord.Color = discord.Color.gold()):
    embed = discord.Embed(title=title, description=description, color=color, timestamp=datetime.datetime.now(JST))
    if user:
        embed.set_author(name=f"{user} (ID: {user.id})", icon_url=user.display_avatar.url)
    await send_log(guild, "economy", embed)

async def send_gambling_log(bot, guild: discord.Guild, user: discord.Member, game_name: str, bet: int, count: int):
    bal = await database.get_balance(guild.id, user.id)
    rem = 10 - count
    currency_name = get_setting(bot, "CURRENCY_NAME", guild.id) or "コイン"
    await send_economy_log(
        guild,
        f"🎲 カジノ ({game_name})",
        f"{user.mention} が **{game_name}** に **{bet} {currency_name}** 賭けました。\n💰 残高: **{bal} {currency_name}**\n🔄 残り回数: **{rem}回**",
        user=user
    )
