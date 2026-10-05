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
    # 住民（本・準）＋仮メン
    "residents": ["main", "sub", "candidate"],
    # 住民＋仮メン＋評価落ち（マイクラ・RP に参加できる人）
    "players": ["main", "sub", "candidate", "failed"],
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
        {"key": "casino_staff", "name": "🎰 カジノ従業員", "color": 0xF39C12, "settings": ["GAMBLE_EMPLOYEE_ROLE_IDS"]},
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
        # PvP に参加する人（自由選択。決闘・戦争の呼びかけ用）
        {"key": "pvp", "name": "⚔️ PvP参加", "color": 0xA93226, "mentionable": True},
        # 通知ロール
        {"key": "notify_news", "name": "🔔 お知らせ通知", "mentionable": True},
        {"key": "notify_event", "name": "🎉 イベント通知", "mentionable": True},
        {"key": "notify_mc", "name": "🎮 マイクラ鯖通知", "mentionable": True},
    ],
    # access: 権限グループ → レベル（書いていないグループと @everyone は hidden）
    # チャンネルの access はカテゴリーの access を上書きする
    # topic: チャンネルの説明 / logs: そのチャンネルに流す Bot のログ種類（未設定のものだけ登録）
    # 既に構築済みのサーバーで再実行すると、足りないカテゴリー・チャンネルだけが追加される
    "categories": [
        {"name": "🌙 ── 天月への門 ──", "access": {"everyone": READ, "staff": WRITE}, "channels": [
            {"name": "🌙｜ようこそ"},
            {"name": "📜｜鯖ルール"},
            {"name": "📖｜世界観・設定"},
            {"name": "📢｜お知らせ"},
            {"name": "🔰｜入界手続き", "access": {"pending": WRITE, "interviewer": WRITE},
             "topic": "ダッシュボード「面接」から面接チケットのパネルを設置"},
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
        {"name": "🏰 ── 天月の街 ──", "access": {"residents": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜雑談"},
            {"name": "📸｜画像・スクショ"},
            {"name": "🤖｜コマンド"},
            {"name": "📞｜通話募集", "topic": "ダッシュボード「通話募集掲示板」からパネルを設置"},
            {"name": "🏷️｜ロール選択", "access": {"residents": READ},
             "topic": "/運営 任意ロールパネル設置 でギルド・通知・PvP参加ロールのパネルを置く"},
            {"name": "🎉｜レベルアップ", "setting": "LEVEL_UP_CHANNEL_ID", "access": {"residents": READ}},
            {"name": "雑談VC", "type": "voice"},
            {"name": "➕ VC作成", "type": "voice", "auto_vc": True},
        ]},
        {"name": "🎫 ── 窓口 ──",
         "access": {"members": READ, "candidate": READ, "failed": READ, "violator": READ, "staff": WRITE}, "channels": [
            {"name": "🎫｜お問い合わせ", "topic": "ダッシュボード「チケット」からお問い合わせパネルを設置"},
            {"name": "🎭｜匿名チャット", "topic": "ダッシュボード「チケット」から匿名チャットパネルを設置"},
            {"name": "🎨｜スタンプ依頼", "topic": "ダッシュボード「チケット」からスタンプ制作依頼パネルを設置"},
        ]},
        {"name": "⛏️ ── マインクラフト ──",
         "access": {"players": WRITE, "mc_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "🗺️｜鯖情報", "access": {"players": READ},
             "topic": "サーバーアドレス・ポート・参加方法・必要なバージョン"},
            {"name": "🔗｜連携方法", "access": {"players": READ},
             "topic": "/manybot:link で出る6桁コードを Web のメンバー画面（プロフィール → マイクラ連携）に入力"},
            {"name": "📣｜鯖ステータス", "access": {"players": READ}},
            {"name": "🟢｜入退出ログ", "access": {"players": READ},
             "topic": "ダッシュボード「マイクラ連携の設定」→ ログ送信設定 でこのチャンネルを選ぶ"},
            {"name": "💬｜マイクラ雑談"},
            {"name": "🏗️｜建築報告"},
            {"name": "🐛｜不具合報告"},
            {"name": "マイクラVC", "type": "voice"},
        ]},
        {"name": "💰 ── 交易・経済 ──",
         "access": {"residents": WRITE, "mc_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜取引ルール", "access": {"residents": READ}},
            {"name": "💹｜取引ログ", "access": {"residents": READ},
             "topic": "ダッシュボード「マイクラ連携の設定」→ ログ送信設定 の取引ログに選ぶ（ゲーム内ショップの売買）"},
            {"name": "🛒｜売ります"},
            {"name": "🛍️｜買います"},
            {"name": "🤝｜取引交渉"},
            {"name": "📈｜相場情報"},
            {"name": "📦｜依頼掲示板", "topic": "採掘・建築・護衛などの依頼と報酬"},
            {"name": "🏦｜銀行・送金", "topic": "/balance・/pay（マイクラ内の通貨と共通）"},
            {"name": "⚖️｜取引トラブル相談"},
            {"name": "商談VC", "type": "voice"},
        ]},
        {"name": "⚔️ ── PvP・戦争 ──",
         "access": {"residents": WRITE, "rp_master": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜pvpルール", "access": {"residents": READ},
             "topic": "PvP可能エリア・禁止行為・キル後のアイテムの扱い・戦争のルール"},
            {"name": "⚔️｜決闘申請"},
            {"name": "🏰｜宣戦布告", "topic": "勢力間の戦争・抗争の宣言（RP進行役が承認）"},
            {"name": "🕊️｜同盟・停戦"},
            {"name": "📊｜戦績報告"},
            {"name": "🚨｜pvp違反報告"},
            {"name": "作戦会議VC①", "type": "voice"},
            {"name": "作戦会議VC②", "type": "voice"},
            {"name": "戦場VC", "type": "voice"},
        ]},
        {"name": "🎭 ── ロールプレイ ──",
         "access": {"players": WRITE, "rp_master": WRITE, "staff": WRITE}, "channels": [
            {"name": "📖｜rpルール", "access": {"players": READ}},
            {"name": "📰｜天月新聞", "access": {"players": READ}},
            {"name": "🏛️｜国家・勢力"},
            {"name": "🗺️｜土地申請"},
            {"name": "🪪｜キャラシート"},
            {"name": "🎭｜rp本編"},
            {"name": "🗣️｜中の人雑談"},
            {"name": "⚔️｜ギルド募集"},
            {"name": "RP-VC", "type": "voice"},
        ]},
        {"name": "🛏️ ── 宿 ──", "access": {"residents": WRITE, "staff": WRITE}, "channels": [
            {"name": "🛏️｜宿・部屋作成", "access": {"residents": READ},
             "topic": "ダッシュボード「部屋」から一般宿・高級宿・カスタムVCの作成パネルを設置（部屋はこのカテゴリーに作られる）"},
        ]},
        {"name": "🎲 ── 娯楽 ──", "access": {"residents": WRITE, "staff": WRITE}, "channels": [
            {"name": "🎰｜カジノ"},
            {"name": "🎁｜ガチャ", "topic": "/運営 福引パネル設置"},
            {"name": "♟️｜ボードゲーム", "topic": "オセロ・チェス・将棋"},
            {"name": "🃏｜ポーカー"},
            {"name": "🛍️｜ショップ"},
            {"name": "🎮｜ゲームvc作成", "access": {"residents": READ},
             "topic": "ダッシュボード「部屋」からゲームVC・賭博VCの作成パネルを設置"},
        ]},
        {"name": "⚖️ ── 評価員室 ──", "access": {"eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📋｜評価会議"},
            {"name": "📝｜評価記録"},
            {"name": "📊｜評価対象一覧"},
            {"name": "評価員会議", "type": "voice"},
        ]},
        # 評価落ち専用
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
            {"name": "📌｜運営メモ"},
            {"name": "運営会議", "type": "voice"},
        ]},
        {"name": "📂 ── ログ ──", "access": {"staff": WRITE}, "channels": [
            {"name": "📥｜入退室ログ", "logs": ["member_join_leave"]},
            {"name": "✏️｜メッセージログ", "logs": ["message_edit", "message_delete"]},
            {"name": "🔊｜vcログ", "logs": ["vc_join_leave"]},
            {"name": "🧾｜通貨ログ", "logs": ["currency", "role_salary", "member_transfer"]},
            {"name": "🛍️｜ショップ・ガチャログ", "logs": ["shop", "shop_extend", "gacha"]},
            {"name": "🎰｜カジノログ", "logs": ["gambling"]},
            {"name": "📋｜評価・面接ログ", "logs": ["evaluation_failure", "interviewer"]},
            {"name": "🛡️｜荒らし対策ログ", "logs": ["antigrief"]},
            {"name": "⛏️｜マイクラ管理ログ"},
        ]},
    ],
}

TEMPLATES = {"zero_tengetsu": ZERO_TENGETSU}

_LIST_SETTINGS = {
    "ADMIN_ROLE_IDS", "EVALUATOR_ROLE_IDS", "EVALUATOR_TIER3_ROLE_IDS", "INTERVIEWER_ROLE_IDS",
    "BANKER_ROLE_IDS", "MAIN_SUB_MEMBER_ROLE_IDS", "MAIN_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS",
    "NEW_MEMBER_ROLE_IDS", "GAMBLE_VIOLATOR_ROLE_IDS", "GAMBLE_EMPLOYEE_ROLE_IDS", "SELF_INTRO_CHANNEL_IDS",
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


async def _sync_overwrites(guild: discord.Guild, target, overwrites: dict, roles: dict, reason: str) -> bool:
    """既存のカテゴリー・チャンネルの権限を、テンプレートのロール分だけ作り直す（それ以外の個別設定は残す）。"""
    managed = {guild.default_role.id, guild.me.id} | {r.id for r in roles.values()}
    merged = {t: ow for t, ow in target.overwrites.items() if t.id not in managed}
    merged.update(overwrites)
    if merged == target.overwrites:
        return False
    await target.edit(overwrites=merged, reason=reason)
    return True


async def build(bot, guild: discord.Guild, template: dict, apply_settings: bool = True, progress=None,
                sync_permissions: bool = False) -> dict:
    """テンプレートどおりにロール・カテゴリー・チャンネルを作る。結果の集計を返す。"""
    result = {"created_roles": [], "reused_roles": [], "created_channels": [], "reused_channels": [],
              "errors": [], "settings": {}, "synced": []}
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
    log_channels = {}
    for cat_spec in template["categories"]:
        await report(f"「{cat_spec['name']}」を作成しています…")
        category = discord.utils.get(guild.categories, name=cat_spec["name"])
        if category:
            result["reused_channels"].append(category.name)
            if sync_permissions:
                try:
                    if await _sync_overwrites(guild, category, _build_overwrites(guild, cat_spec["access"], roles), roles, reason):
                        result["synced"].append(category.name)
                except discord.HTTPException as e:
                    result["errors"].append(f"カテゴリー「{cat_spec['name']}」の権限: {e}")
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
            access = {**cat_spec["access"], **ch_spec.get("access", {})}
            overwrites = _build_overwrites(guild, access, roles)
            if channel:
                result["reused_channels"].append(channel.name)
                if sync_permissions:
                    try:
                        if await _sync_overwrites(guild, channel, overwrites, roles, reason):
                            result["synced"].append(channel.name)
                    except discord.HTTPException as e:
                        result["errors"].append(f"チャンネル「{ch_spec['name']}」の権限: {e}")
            else:
                try:
                    if is_voice:
                        channel = await category.create_voice_channel(ch_spec["name"], overwrites=overwrites, reason=reason)
                    else:
                        channel = await category.create_text_channel(
                            ch_spec["name"], overwrites=overwrites, topic=ch_spec.get("topic"), reason=reason)
                    result["created_channels"].append(channel.name)
                except discord.HTTPException as e:
                    result["errors"].append(f"チャンネル「{ch_spec['name']}」: {e}")
                    continue
            if ch_spec.get("setting"):
                result["settings"].setdefault(ch_spec["setting"], []).append(channel.id)
            if ch_spec.get("auto_vc"):
                auto_vc_ids.append(channel.id)
            for log_type in ch_spec.get("logs", []):
                log_channels[log_type] = channel.id

    # --- Bot 設定へ反映 ---
    if apply_settings:
        await report("Bot の設定に反映しています…")
        await _apply_settings(bot, guild, result["settings"], result["errors"])
        for cid in auto_vc_ids:
            await _register_auto_vc(bot, cid, result["errors"])
        await _apply_log_channels(guild, log_channels, result)
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


async def _apply_log_channels(guild: discord.Guild, log_channels: dict, result: dict):
    """ログの送信先を登録する。既に送信先が決まっているログ種類はそのまま。"""
    result["logs"] = []
    for log_type, channel_id in log_channels.items():
        try:
            if await database.get_log_channel(guild.id, log_type):
                continue
            await database.save_log_channel(guild.id, log_type, channel_id)
            result["logs"].append(log_type)
        except Exception as e:
            result["errors"].append(f"ログ {log_type}: {e}")


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
