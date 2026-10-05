"""サーバー構築テンプレート（/運営 サーバー構築）。

「零の天月鯖」= マイクラRP鯖 × 評価鯖 のロール・カテゴリー・チャンネルを一括で作る。
同じ名前のロール・カテゴリー・チャンネルが既にあれば作らずにそのまま使う（何度実行しても重複しない）。
既にあるものの権限は書き換えない。
"""
import discord
import database

# --- 権限レベル ---
# hidden: 見えない / read: 見るだけ（リアクション・VC参加は可、発言不可） / write: 発言・通話可
HIDDEN, READ, WRITE = "hidden", "read", "write"

# 権限グループ（ロールキーの集まり）。everyone は @everyone
GROUPS = {
    "staff": ["owner", "admin"],
    "eval_staff": ["owner", "admin", "eval_lead", "evaluator"],
    "interviewer": ["interviewer"],
    "members": ["main", "sub"],
    "candidate": ["candidate"],
    "pending": ["pending"],
    "failed": ["failed"],
    "violator": ["violator"],
    "rp_master": ["rp_master"],
    "mc_staff": ["mc_staff"],
}

_STAFF_PERMS = dict(
    manage_channels=True, manage_roles=True, manage_messages=True, manage_nicknames=True,
    kick_members=True, ban_members=True, moderate_members=True, view_audit_log=True,
    mute_members=True, deafen_members=True, move_members=True, mention_everyone=True,
)

# ロール（上から順に作る＝上にあるほど上位）。setting は Bot 設定のキー（list は複数選択の設定）
ZERO_TENGETSU = {
    "name": "零の天月鯖",
    "description": "マイクラRP × 評価鯖",
    "roles": [
        {"key": "owner", "name": "🌙 天月主", "color": 0xF5D76E, "hoist": True,
         "perms": {"administrator": True}, "settings": ["ADMIN_ROLE_IDS"]},
        {"key": "admin", "name": "🌕 天月議会（運営）", "color": 0xE6B422, "hoist": True,
         "perms": _STAFF_PERMS, "settings": ["ADMIN_ROLE_IDS"]},
        {"key": "eval_lead", "name": "⚖️ 評価統括", "color": 0x9B59B6, "hoist": True,
         "perms": {"manage_messages": True, "move_members": True}, "settings": ["EVALUATOR_TIER3_ROLE_IDS"]},
        {"key": "evaluator", "name": "📋 評価員", "color": 0xAF7AC5, "hoist": True,
         "perms": {"move_members": True}, "settings": ["EVALUATOR_ROLE_IDS"]},
        {"key": "interviewer", "name": "🚪 面接官", "color": 0x5DADE2, "hoist": True,
         "perms": {"move_members": True}, "settings": ["INTERVIEWER_ROLE_IDS"]},
        {"key": "banker", "name": "🏦 銀行員", "color": 0x48C9B0, "settings": ["BANKER_ROLE_IDS"]},
        {"key": "rp_master", "name": "🎭 RP進行役（GM）", "color": 0xEC7063, "hoist": True,
         "perms": {"manage_messages": True}},
        {"key": "mc_staff", "name": "⛏️ マイクラ管理", "color": 0x58D68D},
        {"key": "main", "name": "✦ 天月民（本住民）", "color": 0x85C1E9, "hoist": True,
         "settings": ["MAIN_SUB_MEMBER_ROLE_IDS", "MAIN_MEMBER_ROLE_IDS"]},
        {"key": "sub", "name": "✧ 天月民（準住民）", "color": 0xAED6F1, "hoist": True,
         "settings": ["MAIN_SUB_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS"]},
        {"key": "candidate", "name": "🌑 仮住民（評価中）", "color": 0xBDC3C7, "hoist": True,
         "settings": ["NEW_MEMBER_ROLE_IDS"]},
        {"key": "pending", "name": "🌫️ 入界待機", "color": 0x95A5A6, "settings": ["PENDING_MEMBER_ROLE_ID"]},
        {"key": "failed", "name": "⛓️ 評価落ち", "color": 0x7F8C8D, "settings": ["DOWNGRADE_ROLE_ID"]},
        {"key": "violator", "name": "🚫 違反者", "color": 0x641E16, "settings": ["GAMBLE_VIOLATOR_ROLE_IDS"]},
        # RP 用の所属ギルド（自由選択。任意ロールパネル等で配る）
        {"key": "guild_knight", "name": "⚔️ 天月騎士団", "color": 0xC0392B},
        {"key": "guild_merchant", "name": "🛒 商人ギルド", "color": 0xD4AC0D},
        {"key": "guild_miner", "name": "⛏️ 採掘ギルド", "color": 0x839192},
        {"key": "guild_farmer", "name": "🌾 農耕ギルド", "color": 0x7DCEA0},
        {"key": "guild_builder", "name": "🔨 建築ギルド", "color": 0xDC7633},
        {"key": "guild_mage", "name": "📜 魔導書院", "color": 0x7D3C98},
        # 通知ロール
        {"key": "notify_news", "name": "🔔 お知らせ通知", "mentionable": True},
        {"key": "notify_event", "name": "🎉 イベント通知", "mentionable": True},
        {"key": "notify_mc", "name": "🎮 マイクラ鯖通知", "mentionable": True},
    ],
    # access: 権限グループ → レベル（書いていないグループと @everyone は hidden）
    # チャンネルの access はカテゴリーの access を上書きする
    "categories": [
        {"name": "🌙 ── 天月への門 ──", "access": {"everyone": READ, "staff": WRITE}, "channels": [
            {"name": "🌙｜ようこそ"},
            {"name": "📜｜鯖ルール"},
            {"name": "📖｜世界観・設定"},
            {"name": "📢｜お知らせ"},
            {"name": "🔰｜入界手続き", "access": {"pending": WRITE, "interviewer": WRITE}},
        ]},
        {"name": "🚪 ── 面接 ──", "access": {"pending": WRITE, "interviewer": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜面接待合室"},
            {"name": "面接室", "type": "voice"},
        ]},
        {"name": "🌑 ── 評価の間 ──", "setting": "EVALUATION_CATEGORY_ID",
         "access": {"candidate": WRITE, "members": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📋｜評価の流れ", "access": {"candidate": READ, "members": READ}},
            {"name": "🙋｜自己紹介", "setting": "SELF_INTRO_CHANNEL_IDS"},
            {"name": "💬｜評価雑談"},
            {"name": "評価VC①", "type": "voice"},
            {"name": "評価VC②", "type": "voice"},
            {"name": "評価VC③", "type": "voice"},
        ]},
        {"name": "🏰 ── 天月の街 ──", "access": {"members": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜雑談"},
            {"name": "📸｜画像・スクショ"},
            {"name": "🤖｜コマンド"},
            {"name": "🎉｜レベルアップ", "setting": "LEVEL_UP_CHANNEL_ID", "access": {"members": READ}},
            {"name": "雑談VC", "type": "voice"},
            {"name": "➕ VC作成", "type": "voice", "auto_vc": True},
        ]},
        {"name": "⛏️ ── マインクラフト ──",
         "access": {"members": WRITE, "candidate": WRITE, "mc_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "🗺️｜鯖情報", "access": {"members": READ, "candidate": READ}},
            {"name": "📣｜鯖ステータス", "access": {"members": READ, "candidate": READ}},
            {"name": "💬｜マイクラ雑談"},
            {"name": "🏗️｜建築報告"},
            {"name": "🛒｜取引所"},
            {"name": "🐛｜不具合報告"},
            {"name": "マイクラVC", "type": "voice"},
        ]},
        {"name": "🎭 ── ロールプレイ ──",
         "access": {"members": WRITE, "candidate": WRITE, "rp_master": WRITE, "staff": WRITE}, "channels": [
            {"name": "📖｜rpルール", "access": {"members": READ, "candidate": READ}},
            {"name": "📰｜天月新聞", "access": {"members": READ, "candidate": READ}},
            {"name": "🪪｜キャラシート"},
            {"name": "🎭｜rp本編"},
            {"name": "🗣️｜中の人雑談"},
            {"name": "⚔️｜ギルド募集"},
            {"name": "RP-VC", "type": "voice"},
        ]},
        {"name": "🎲 ── 娯楽 ──", "access": {"members": WRITE, "staff": WRITE}, "channels": [
            {"name": "🎰｜カジノ"},
            {"name": "🎁｜ガチャ"},
            {"name": "♟️｜ボードゲーム"},
            {"name": "🛍️｜ショップ"},
        ]},
        {"name": "⚖️ ── 評価員室 ──", "access": {"eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📋｜評価会議"},
            {"name": "📝｜評価記録"},
            {"name": "📊｜評価対象一覧"},
            {"name": "評価員会議", "type": "voice"},
        ]},
        # 評価落ち専用（既に構築済みのサーバーでも、このカテゴリーに足りないチャンネルだけ追加される）
        {"name": "⛓️ ── 再評価 ──", "access": {"failed": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜評価落ちの案内", "access": {"failed": READ}},
            {"name": "📮｜再評価申請"},
            {"name": "💬｜評価落ち待機所"},
            {"name": "評価落ちVC", "type": "voice"},
        ]},
        # 違反者専用
        {"name": "🚫 ── 違反者 ──", "access": {"violator": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜違反者の案内", "access": {"violator": READ}},
            {"name": "⚠️｜処分通知", "access": {"violator": READ}},
            {"name": "📝｜反省文"},
            {"name": "📮｜異議申し立て"},
            {"name": "違反者VC", "type": "voice"},
        ]},
        {"name": "🛡️ ── 運営 ──", "access": {"staff": WRITE}, "channels": [
            {"name": "🛡️｜運営連絡"},
            {"name": "📂｜ログ"},
            {"name": "🧾｜通貨ログ"},
            {"name": "運営会議", "type": "voice"},
        ]},
    ],
}

TEMPLATES = {"zero_tengetsu": ZERO_TENGETSU}

_LIST_SETTINGS = {
    "ADMIN_ROLE_IDS", "EVALUATOR_ROLE_IDS", "EVALUATOR_TIER3_ROLE_IDS", "INTERVIEWER_ROLE_IDS",
    "BANKER_ROLE_IDS", "MAIN_SUB_MEMBER_ROLE_IDS", "MAIN_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS",
    "NEW_MEMBER_ROLE_IDS", "GAMBLE_VIOLATOR_ROLE_IDS", "SELF_INTRO_CHANNEL_IDS",
}


def _overwrite(level: str) -> discord.PermissionOverwrite:
    if level == WRITE:
        return discord.PermissionOverwrite(
            view_channel=True, send_messages=True, send_messages_in_threads=True, add_reactions=True,
            attach_files=True, embed_links=True, read_message_history=True, connect=True, speak=True, stream=True,
        )
    if level == READ:
        return discord.PermissionOverwrite(
            view_channel=True, send_messages=False, send_messages_in_threads=False,
            create_public_threads=False, create_private_threads=False, add_reactions=True,
            read_message_history=True, connect=True, speak=False,
        )
    return discord.PermissionOverwrite(view_channel=False)


def _build_overwrites(guild: discord.Guild, access: dict, roles: dict) -> dict:
    overwrites = {guild.default_role: _overwrite(access.get("everyone", HIDDEN))}
    for group, level in access.items():
        if group == "everyone":
            continue
        for key in GROUPS.get(group, [group]):
            role = roles.get(key)
            if role:
                overwrites[role] = _overwrite(level)
    # Bot 自身は全カテゴリーで操作できるようにする
    overwrites[guild.me] = discord.PermissionOverwrite(
        view_channel=True, send_messages=True, manage_channels=True, manage_messages=True,
        embed_links=True, attach_files=True, read_message_history=True, connect=True, move_members=True,
    )
    return overwrites


def _role_permissions(guild: discord.Guild, perms: dict) -> discord.Permissions:
    p = discord.Permissions(**(perms or {}))
    me = guild.me.guild_permissions
    if me.administrator:
        return p
    # Bot が持っていない権限はロールに付けられないので外す
    return discord.Permissions(p.value & me.value)


def plan_summary(template: dict) -> str:
    n_ch = sum(len(c["channels"]) for c in template["categories"])
    return f"ロール {len(template['roles'])} 個・カテゴリー {len(template['categories'])} 個・チャンネル {n_ch} 個"


async def build(bot, guild: discord.Guild, template: dict, apply_settings: bool = True, progress=None) -> dict:
    """テンプレートどおりにロール・カテゴリー・チャンネルを作る。結果の集計を返す。"""
    result = {"created_roles": [], "reused_roles": [], "created_channels": [], "reused_channels": [],
              "errors": [], "settings": {}}
    reason = f"サーバー構築テンプレート「{template['name']}」"

    async def report(msg):
        if progress:
            try:
                await progress(msg)
            except Exception:
                pass

    # --- ロール ---
    await report("ロールを作成しています…")
    roles: dict = {}
    for spec in template["roles"]:
        role = discord.utils.get(guild.roles, name=spec["name"])
        if role:
            result["reused_roles"].append(role.name)
        else:
            try:
                role = await guild.create_role(
                    name=spec["name"],
                    color=discord.Color(spec.get("color", 0)),
                    hoist=spec.get("hoist", False),
                    mentionable=spec.get("mentionable", False),
                    permissions=_role_permissions(guild, spec.get("perms")),
                    reason=reason,
                )
                result["created_roles"].append(role.name)
            except discord.HTTPException as e:
                result["errors"].append(f"ロール「{spec['name']}」: {e}")
                continue
        roles[spec["key"]] = role
        for key in spec.get("settings", []):
            result["settings"].setdefault(key, []).append(role.id)

    # --- カテゴリー・チャンネル ---
    auto_vc_ids = []
    for cat_spec in template["categories"]:
        await report(f"「{cat_spec['name']}」を作成しています…")
        category = discord.utils.get(guild.categories, name=cat_spec["name"])
        if category:
            result["reused_channels"].append(category.name)
        else:
            try:
                category = await guild.create_category(
                    cat_spec["name"], overwrites=_build_overwrites(guild, cat_spec["access"], roles), reason=reason)
                result["created_channels"].append(category.name)
            except discord.HTTPException as e:
                result["errors"].append(f"カテゴリー「{cat_spec['name']}」: {e}")
                continue
        if cat_spec.get("setting"):
            result["settings"].setdefault(cat_spec["setting"], []).append(category.id)

        for ch_spec in cat_spec["channels"]:
            is_voice = ch_spec.get("type") == "voice"
            existing = category.voice_channels if is_voice else category.text_channels
            channel = discord.utils.get(existing, name=ch_spec["name"])
            if channel:
                result["reused_channels"].append(channel.name)
            else:
                access = {**cat_spec["access"], **ch_spec.get("access", {})}
                overwrites = _build_overwrites(guild, access, roles)
                try:
                    if is_voice:
                        channel = await category.create_voice_channel(ch_spec["name"], overwrites=overwrites, reason=reason)
                    else:
                        channel = await category.create_text_channel(ch_spec["name"], overwrites=overwrites, reason=reason)
                    result["created_channels"].append(channel.name)
                except discord.HTTPException as e:
                    result["errors"].append(f"チャンネル「{ch_spec['name']}」: {e}")
                    continue
            if ch_spec.get("setting"):
                result["settings"].setdefault(ch_spec["setting"], []).append(channel.id)
            if ch_spec.get("auto_vc"):
                auto_vc_ids.append(channel.id)

    # --- Bot 設定へ反映 ---
    if apply_settings:
        await report("Bot の設定に反映しています…")
        await _apply_settings(bot, guild, result["settings"], result["errors"])
        for cid in auto_vc_ids:
            await _register_auto_vc(bot, cid, result["errors"])
    return result


async def _apply_settings(bot, guild: discord.Guild, settings: dict, errors: list):
    cache = getattr(bot, "bot_settings", None)
    if cache is None:
        bot.bot_settings = cache = {}
    guild_cache = cache.setdefault(guild.id, {})
    for key, ids in settings.items():
        if key in _LIST_SETTINGS:
            # 既に設定されているものは残して追加する
            current = guild_cache.get(key) or []
            if isinstance(current, (int, str)):
                current = [current]
            merged = []
            for v in list(current) + ids:
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    continue
                if v not in merged:
                    merged.append(v)
            value = merged
        else:
            value = ids[0]
        try:
            # ダッシュボード（JS）で桁落ちしないよう ID は文字列で保存する（読み込み時に int に戻る）
            stored = [str(v) for v in value] if isinstance(value, list) else str(value)
            await database.save_setting(guild.id, key, stored)
            guild_cache[key] = value
        except Exception as e:
            errors.append(f"設定 {key}: {e}")


async def _register_auto_vc(bot, channel_id: int, errors: list):
    triggers = getattr(bot, "auto_vc_triggers", None)
    if triggers is not None and channel_id in triggers:
        return
    try:
        await database.add_auto_vc_trigger(channel_id)
        await database.save_auto_vc_config(channel_id, "", True, True, False, True, True)
        if triggers is not None:
            triggers.add(channel_id)
        if hasattr(bot, "auto_vc_configs"):
            bot.auto_vc_configs[channel_id] = {
                "channel_id": channel_id, "base_name": "", "allow_rename": True, "include_owner_name": True,
                "use_numbering": False, "allow_limit_change": True, "show_panel": True,
            }
    except Exception as e:
        errors.append(f"VC作成チャンネルの登録: {e}")
