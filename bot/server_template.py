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
        # 違反者は違反者・窓口カテゴリー以外見えない（@everyone より違反者ロールの設定が優先される）
        {"name": "🌙 ── 天月への門 ──", "access": {"everyone": READ, "violator": HIDDEN, "staff": WRITE}, "channels": [
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

# 「でっぱ寿司」= 寿司屋モチーフの評価鯖。部署ごとに 統括・副統括・係 の3段のロールを持つ
_DEPPA_LEAD_PERMS = {"manage_messages": True, "move_members": True, "mute_members": True}
_NETA = ["マグロ", "中トロ", "サーモン", "ハマチ", "タイ", "エビ", "イカ", "タコ", "ウニ", "イクラ", "穴子", "玉子"]

DEPPA_SUSHI = {
    "name": "でっぱ寿司",
    "description": "寿司屋モチーフの評価鯖",
    "groups": {
        # 板前（運営）は鯖主・副鯖主・各統括に付ける
        "staff": ["owner", "vice_owner", "itamae"],
        "eval_staff": ["eval_lead", "eval_vice", "evaluator"],
        "interviewer": ["noren_lead", "noren_vice", "noren"],
        "event_staff": ["event_lead", "event_vice", "patissier"],
        "game_staff": ["game_lead", "game_vice", "game"],
        "fish_staff": ["fish_lead", "fish_vice", "fish"],
        "night_staff": ["sake_lead", "sake_staff", "sake_cast"],
        # 本面・準面
        "members": ["futokyaku", "joren"],
        "main": ["futokyaku"],
        "candidate": ["ichigen"],
        # 本面・準面・仮メン
        "residents": ["futokyaku", "joren", "ichigen"],
        "failed": ["hosokyaku"],
    },
    "roles": [
        {"key": "owner", "name": "大将", "color": 0xC0392B, "hoist": True,
         "perms": {"administrator": True}, "settings": ["ADMIN_ROLE_IDS"]},
        {"key": "vice_owner", "name": "親方", "color": 0xE74C3C, "hoist": True,
         "perms": _STAFF_PERMS, "settings": ["ADMIN_ROLE_IDS"]},
        {"key": "itamae", "name": "板前", "color": 0xF5B041, "hoist": True,
         "perms": _STAFF_PERMS, "settings": ["ADMIN_ROLE_IDS"]},
        # 評価員
        {"key": "eval_lead", "name": "食べログ隊長", "color": 0x8E44AD, "hoist": True,
         "perms": _DEPPA_LEAD_PERMS, "settings": ["EVALUATOR_TIER3_ROLE_IDS"]},
        {"key": "eval_vice", "name": "食べログ副隊長", "color": 0x9B59B6, "hoist": True,
         "perms": {"move_members": True}, "settings": ["EVALUATOR_TIER2_ROLE_IDS"]},
        {"key": "evaluator", "name": "食べログ民", "color": 0xAF7AC5, "hoist": True,
         "perms": {"move_members": True}, "settings": ["EVALUATOR_ROLE_IDS"]},
        # 面接官
        {"key": "noren_lead", "name": "のれん番", "color": 0x2471A3, "hoist": True,
         "perms": _DEPPA_LEAD_PERMS, "settings": ["INTERVIEWER_ROLE_IDS"]},
        {"key": "noren_vice", "name": "のれん番補佐", "color": 0x2E86C1, "hoist": True,
         "perms": {"move_members": True}, "settings": ["INTERVIEWER_ROLE_IDS"]},
        {"key": "noren", "name": "のれん係", "color": 0x5DADE2, "hoist": True,
         "perms": {"move_members": True}, "settings": ["INTERVIEWER_ROLE_IDS"]},
        # イベンター
        {"key": "event_lead", "name": "パティスリー店長", "color": 0xD81B60, "hoist": True,
         "perms": _DEPPA_LEAD_PERMS, "settings": ["EVENT_MANAGER_ROLE_IDS"]},
        {"key": "event_vice", "name": "パティスリー副店長", "color": 0xEC407A, "hoist": True,
         "perms": {"move_members": True}, "settings": ["EVENT_MANAGER_ROLE_IDS"]},
        {"key": "patissier", "name": "パティシエ", "color": 0xF48FB1, "hoist": True},
        # ゲーム
        {"key": "game_lead", "name": "サイド大臣", "color": 0x117A65, "hoist": True, "perms": _DEPPA_LEAD_PERMS},
        {"key": "game_vice", "name": "サイド副大臣", "color": 0x16A085, "hoist": True, "perms": {"move_members": True}},
        {"key": "game", "name": "サイド参謀", "color": 0x48C9B0, "hoist": True},
        # 評価落ち担当
        {"key": "fish_lead", "name": "鮮魚商店長", "color": 0x1F618D, "hoist": True, "perms": _DEPPA_LEAD_PERMS},
        {"key": "fish_vice", "name": "鮮魚商副店長", "color": 0x2874A6, "hoist": True, "perms": {"move_members": True}},
        {"key": "fish", "name": "鮮魚商", "color": 0x3498DB, "hoist": True},
        # 夜色
        {"key": "sake_lead", "name": "酒屋店長", "color": 0x512E5F, "hoist": True, "perms": _DEPPA_LEAD_PERMS},
        {"key": "sake_staff", "name": "酒屋店員", "color": 0x2C3E50, "hoist": True},
        {"key": "sake_cast", "name": "酒屋キャスト", "color": 0x6C3483, "hoist": True},
        # プレイヤー
        {"key": "futokyaku", "name": "太客", "color": 0xF1C40F, "hoist": True,
         "settings": ["MAIN_SUB_MEMBER_ROLE_IDS", "MAIN_MEMBER_ROLE_IDS"]},
        {"key": "joren", "name": "常連", "color": 0xF8C471, "hoist": True,
         "settings": ["MAIN_SUB_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS"]},
        {"key": "ichigen", "name": "一見さん", "color": 0xBDC3C7, "hoist": True, "settings": ["NEW_MEMBER_ROLE_IDS"]},
        {"key": "hosokyaku", "name": "細客", "color": 0x7F8C8D, "settings": ["DOWNGRADE_ROLE_ID"]},
        # 準面以上の属性ロール（自由選択）
        {"key": "attr_akami", "name": "赤身", "color": 0xE74C3C},
        {"key": "attr_shiromi", "name": "白身", "color": 0xECF0F1},
        {"key": "attr_kai", "name": "貝類", "color": 0xA04000},
        {"key": "attr_gunkan", "name": "軍艦", "color": 0x1C2833},
        {"key": "attr_maki", "name": "巻物", "color": 0x58D68D},
        # 本面以上の好きなネタ（自由選択）
        *[{"key": f"neta_{i}", "name": n} for i, n in enumerate(_NETA)],
    ],
    "categories": [
        {"name": "🏮 ── のれん ──", "access": {"everyone": READ, "staff": WRITE}, "channels": [
            {"name": "🍣｜いらっしゃいませ"},
            {"name": "📜｜店のきまり"},
            {"name": "📢｜お知らせ"},
            {"name": "🗒️｜役職一覧", "topic": "大将・親方・板前（鯖主・副鯖主・各統括に付与）と各部署の役職"},
            {"name": "🔰｜入店手続き", "access": {"interviewer": WRITE},
             "topic": "ダッシュボード「面接」から面接チケットのパネルを設置"},
        ]},
        {"name": "🚪 ── 面接 ──",
         "access": {"everyone": WRITE, "residents": HIDDEN, "failed": HIDDEN, "interviewer": WRITE, "staff": WRITE},
         "channels": [
            {"name": "💬｜面接待合室"},
            {"name": "面接室", "type": "voice"},
        ]},
        {"name": "🍽️ ── カウンター（評価）──", "setting": "EVALUATION_CATEGORY_ID",
         "access": {"candidate": WRITE, "members": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📋｜評価の流れ", "access": {"candidate": READ, "members": READ}},
            {"name": "🙋｜自己紹介", "setting": "SELF_INTRO_CHANNEL_IDS"},
            {"name": "💬｜評価雑談"},
            {"name": "評価VC①", "type": "voice"},
            {"name": "評価VC②", "type": "voice"},
            {"name": "評価VC③", "type": "voice"},
        ]},
        {"name": "🍣 ── 店内 ──", "access": {"residents": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜雑談"},
            {"name": "📸｜画像・スクショ"},
            {"name": "🤖｜コマンド"},
            {"name": "📞｜通話募集", "topic": "ダッシュボード「通話募集掲示板」からパネルを設置"},
            {"name": "🎉｜レベルアップ", "setting": "LEVEL_UP_CHANNEL_ID", "access": {"residents": READ}},
            # 準面以上
            {"name": "🏷️｜属性ロール", "access": {"candidate": HIDDEN, "members": READ},
             "topic": "/運営 任意ロールパネル設置 で 赤身（活発・元気）／白身（かっこいい）／貝類（大人）／軍艦（個性的）／巻物（かわいい）のパネルを置く"},
            # 本面以上
            {"name": "🍣｜好きなネタ", "access": {"residents": HIDDEN, "main": READ},
             "topic": "/運営 任意ロールパネル設置 で好きなネタのロールのパネルを置く（本面以上）"},
            {"name": "雑談VC", "type": "voice"},
            {"name": "➕ VC作成", "type": "voice", "auto_vc": True},
        ]},
        {"name": "🎂 ── パティスリー（イベント）──",
         "access": {"residents": WRITE, "event_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📢｜イベント告知", "access": {"residents": READ}},
            {"name": "💬｜イベント雑談"},
            {"name": "💡｜イベント要望"},
            {"name": "イベントVC", "type": "voice"},
        ]},
        {"name": "🎲 ── サイドメニュー（ゲーム）──",
         "access": {"residents": WRITE, "game_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "🎰｜カジノ"},
            {"name": "🎁｜ガチャ", "topic": "/運営 福引パネル設置"},
            {"name": "♟️｜ボードゲーム", "topic": "オセロ・チェス・将棋"},
            {"name": "🃏｜ポーカー"},
            {"name": "🛍️｜ショップ"},
            {"name": "🎮｜ゲームvc作成", "access": {"residents": READ},
             "topic": "ダッシュボード「部屋」からゲームVC・賭博VCの作成パネルを設置"},
            {"name": "ゲームVC", "type": "voice"},
        ]},
        {"name": "🍶 ── 夜の酒屋 ──", "access": {"members": WRITE, "night_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜酒屋の案内", "access": {"members": READ}},
            {"name": "🍶｜カウンター"},
            {"name": "💌｜指名・予約"},
            {"name": "酒屋VC①", "type": "voice"},
            {"name": "酒屋VC②", "type": "voice"},
        ]},
        {"name": "🛏️ ── 宿 ──", "access": {"residents": WRITE, "staff": WRITE}, "channels": [
            {"name": "🛏️｜宿・部屋作成", "access": {"residents": READ},
             "topic": "ダッシュボード「部屋」から一般宿・高級宿・カスタムVCの作成パネルを設置（部屋はこのカテゴリーに作られる）"},
        ]},
        {"name": "🎫 ── 窓口 ──",
         "access": {"members": READ, "candidate": READ, "failed": READ, "staff": WRITE}, "channels": [
            {"name": "🎫｜お問い合わせ", "topic": "ダッシュボード「チケット」からお問い合わせパネルを設置"},
            {"name": "🎭｜匿名チャット", "topic": "ダッシュボード「チケット」から匿名チャットパネルを設置"},
            {"name": "🎨｜スタンプ依頼", "topic": "ダッシュボード「チケット」からスタンプ制作依頼パネルを設置"},
        ]},
        # 評価落ち（細客）専用。鮮魚商が担当
        {"name": "🐟 ── 鮮魚市場（再評価）──",
         "access": {"failed": WRITE, "fish_staff": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📜｜細客の案内", "access": {"failed": READ}},
            {"name": "📮｜再評価申請"},
            {"name": "💬｜細客待機所"},
            {"name": "細客VC", "type": "voice"},
        ]},
        # 部署の控室（その部署と運営だけ）
        {"name": "📝 ── 食べログ本部 ──", "access": {"eval_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "📋｜評価会議"},
            {"name": "📝｜評価記録"},
            {"name": "📊｜評価対象一覧"},
            {"name": "食べログ会議", "type": "voice"},
        ]},
        {"name": "🚪 ── のれん番控室 ──", "access": {"interviewer": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜面接官連絡"},
            {"name": "📝｜面接記録"},
            {"name": "面接官会議", "type": "voice"},
        ]},
        {"name": "🎂 ── パティスリー厨房 ──", "access": {"event_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜イベンター連絡"},
            {"name": "🗓️｜イベント企画"},
            {"name": "イベンター会議", "type": "voice"},
        ]},
        {"name": "🎲 ── サイド参謀本部 ──", "access": {"game_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜ゲーム運営連絡"},
            {"name": "🗓️｜ゲーム企画"},
            {"name": "ゲーム運営会議", "type": "voice"},
        ]},
        {"name": "🐟 ── 鮮魚商控室 ──", "access": {"fish_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜鮮魚商連絡"},
            {"name": "📝｜細客の記録"},
            {"name": "鮮魚商会議", "type": "voice"},
        ]},
        {"name": "🍶 ── 酒屋裏方 ──", "access": {"night_staff": WRITE, "staff": WRITE}, "channels": [
            {"name": "💬｜酒屋連絡"},
            {"name": "📋｜シフト・指名表"},
            {"name": "酒屋スタッフVC", "type": "voice"},
        ]},
        {"name": "🔪 ── 板場（運営）──", "access": {"staff": WRITE}, "channels": [
            {"name": "🔪｜運営連絡"},
            {"name": "📌｜運営メモ"},
            {"name": "👑｜統括会議"},
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
        ]},
    ],
}

TEMPLATES = {"zero_tengetsu": ZERO_TENGETSU, "deppa_sushi": DEPPA_SUSHI}


# ==========================================================================
# カスタムテンプレート（ダッシュボード「サーバー作成」）
# 基本設定のロール設定ごとにロール名を入れると、そのロールを元に基盤のカテゴリー・チャンネルを作る。
# 保存先: bot_settings の SERVER_BUILD_TEMPLATE（テンプレ保存）/ SERVER_BUILD_PENDING（サーバー作成）
# 形式: {"name": str, "roles": {設定キー: ロール名}, "categories": [カテゴリーID, ...]}
# ==========================================================================
CUSTOM_TEMPLATE_KEY = "SERVER_BUILD_TEMPLATE"
CUSTOM_PENDING_KEY = "SERVER_BUILD_PENDING"
CUSTOM_STATUS_KEY = "SERVER_BUILD_STATUS"

# 設定キー → ロールの作り方。並び順＝ロールの上下（上ほど上位）
# group: カテゴリーの見える範囲を決める権限グループ
CUSTOM_ROLE_SETTINGS = [
    ("ADMIN_ROLE_IDS", {"group": "staff", "color": 0xE6B422, "hoist": True, "perms": _STAFF_PERMS}),
    ("EVALUATOR_TIER3_ROLE_IDS", {"group": "eval_staff", "color": 0x8E44AD, "hoist": True,
                                  "perms": {"manage_messages": True, "move_members": True}}),
    ("EVALUATOR_TIER2_ROLE_IDS", {"group": "eval_staff", "color": 0x9B59B6, "hoist": True, "perms": {"move_members": True}}),
    ("EVALUATOR_ROLE_IDS", {"group": "eval_staff", "color": 0xAF7AC5, "hoist": True, "perms": {"move_members": True}}),
    ("EVALUATOR_MENTION_ROLE_IDS", {"group": "eval_staff", "color": 0xD2B4DE, "mentionable": True}),
    ("INTERVIEWER_ROLE_IDS", {"group": "interviewer", "color": 0x5DADE2, "hoist": True, "perms": {"move_members": True}}),
    ("EVENT_MANAGER_ROLE_IDS", {"group": "event_staff", "color": 0xF1948A, "hoist": True}),
    ("GAMBLE_MANAGER_ROLE_IDS", {"group": "casino_staff", "color": 0xD68910}),
    ("GAMBLE_EMPLOYEE_ROLE_IDS", {"group": "casino_staff", "color": 0xF39C12}),
    ("SHOP_MANAGER_ROLE_ID", {"group": "shop_staff", "color": 0x229954}),
    ("SHOP_EMPLOYEE_ROLE_ID", {"group": "shop_staff", "color": 0x52BE80}),
    ("EMBLEM_MANAGER_ROLE_ID", {"group": "stamp_staff", "color": 0xCA6F1E}),
    ("EMBLEM_MASTER_ROLE_IDS", {"group": "stamp_staff", "color": 0xE59866}),
    ("CONFESSION_PRIEST_ROLE_ID", {"group": "priest", "color": 0x5D6D7E}),
    ("PRIEST_ROLE_ID", {"group": "priest", "color": 0x85929E}),
    ("BANKER_ROLE_IDS", {"group": "banker", "color": 0x48C9B0}),
    ("MAIN_SUB_MEMBER_ROLE_IDS", {"group": "members", "color": 0x85C1E9, "hoist": True}),
    ("MAIN_MEMBER_ROLE_IDS", {"group": "members", "color": 0x85C1E9, "hoist": True}),
    ("SUB_MEMBER_ROLE_IDS", {"group": "members", "color": 0xAED6F1, "hoist": True}),
    ("FREE_INN_ROLE_IDS", {"color": 0xA3E4D7}),
    ("NEW_MEMBER_ROLE_IDS", {"group": "candidate", "color": 0xBDC3C7, "hoist": True}),
    ("PENDING_MEMBER_ROLE_ID", {"group": "pending", "color": 0x95A5A6}),
    ("DOWNGRADE_ROLE_ID", {"group": "failed", "color": 0x7F8C8D}),
    ("MINUS_TARGET_ROLE_IDS", {"color": 0x6E2C00}),
    ("GAMBLE_VIOLATOR_ROLE_IDS", {"group": "violator", "color": 0x641E16}),
    ("MALE_ROLE_ID", {"color": 0x3498DB}),
    ("FEMALE_ROLE_ID", {"color": 0xFF69B4}),
]
CUSTOM_ROLE_KEYS = [k for k, _ in CUSTOM_ROLE_SETTINGS]

# カテゴリーID → 作るときに必要な権限グループ（どれか1つにロールがあれば作る。空なら常に作る）
CUSTOM_CATEGORY_REQUIRES = {
    "info": [],
    "interview": ["interviewer", "pending"],
    "evaluation": ["eval_staff", "candidate"],
    "community": [],
    "support": [],
    "entertainment": [],
    "eval_room": ["eval_staff"],
    "failed": ["failed"],
    "violator": ["violator"],
    "staff": [],
    "logs": [],
}
CUSTOM_CATEGORY_IDS = list(CUSTOM_CATEGORY_REQUIRES)


def _custom_categories(has) -> list:
    """has(group) でロールがある権限グループを判定して、基盤のカテゴリー・チャンネルを組み立てる。"""
    # 住民（本・準・仮）が設定されていなければ、交流系は @everyone に開く（待機・違反者は除く）
    if has("members") or has("candidate"):
        community = {"members": WRITE, "candidate": WRITE}
        community_read = {"members": READ, "candidate": READ}
    else:
        community = {"everyone": WRITE, "pending": HIDDEN, "violator": HIDDEN, "failed": HIDDEN}
        community_read = {"everyone": READ}

    def ch(name, cond=True, **kw):
        return {"name": name, **kw} if cond else None

    cats = {
        "info": {"name": "📢 ── 案内 ──", "access": {"everyone": READ, "violator": HIDDEN, "staff": WRITE}, "channels": [
            ch("👋｜ようこそ"),
            ch("📜｜ルール"),
            ch("📢｜お知らせ"),
            ch("🔰｜入界手続き", has("pending"), access={"pending": WRITE, "interviewer": WRITE},
               topic="ダッシュボード「面接」から面接チケットのパネルを設置"),
        ]},
        "interview": {"name": "🚪 ── 面接 ──", "access": {"pending": WRITE, "interviewer": WRITE, "staff": WRITE}, "channels": [
            ch("💬｜面接待合室"),
            ch("面接室", type="voice"),
        ]},
        "evaluation": {"name": "📋 ── 評価 ──", "setting": "EVALUATION_CATEGORY_ID",
                       "access": {"candidate": WRITE, "members": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            ch("📋｜評価の流れ", access={"candidate": READ, "members": READ}),
            ch("🙋｜自己紹介", setting="SELF_INTRO_CHANNEL_IDS"),
            ch("💬｜評価雑談"),
            ch("評価VC①", type="voice"),
            ch("評価VC②", type="voice"),
        ]},
        "community": {"name": "💬 ── 交流 ──", "access": {**community, "staff": WRITE}, "channels": [
            ch("💬｜雑談"),
            ch("📸｜画像・スクショ"),
            ch("🤖｜コマンド"),
            ch("📞｜通話募集", topic="ダッシュボード「通話募集掲示板」からパネルを設置"),
            ch("🎉｜レベルアップ", setting="LEVEL_UP_CHANNEL_ID", access=community_read),
            ch("🏦｜銀行", has("banker"), access={"banker": WRITE}, topic="/balance・/pay"),
            ch("雑談VC", type="voice"),
            ch("➕ VC作成", type="voice", auto_vc=True),
        ]},
        "support": {"name": "🎫 ── 窓口 ──", "access": {"everyone": READ, "staff": WRITE}, "channels": [
            ch("🎫｜お問い合わせ", topic="ダッシュボード「チケット」からお問い合わせパネルを設置"),
            ch("🎭｜匿名チャット", topic="ダッシュボード「チケット」から匿名チャットパネルを設置"),
            ch("🎨｜スタンプ依頼", has("stamp_staff"), access={"stamp_staff": WRITE},
               topic="ダッシュボード「チケット」からスタンプ制作依頼パネルを設置"),
            ch("⛪｜告解室", has("priest"), access={"priest": WRITE},
               topic="ダッシュボード「チケット」から告解パネルを設置"),
        ]},
        "entertainment": {"name": "🎲 ── 娯楽 ──",
                          "access": {**community, "casino_staff": WRITE, "shop_staff": WRITE, "event_staff": WRITE, "staff": WRITE},
                          "channels": [
            ch("🎉｜イベント", has("event_staff")),
            ch("🎰｜カジノ"),
            ch("🛍️｜ショップ"),
            ch("🎁｜ガチャ", topic="/運営 福引パネル設置"),
            ch("♟️｜ボードゲーム", topic="オセロ・チェス・将棋"),
            ch("🎮｜ゲームvc作成", access=community_read,
               topic="ダッシュボード「部屋」からゲームVC・賭博VCの作成パネルを設置"),
        ]},
        "eval_room": {"name": "⚖️ ── 評価員室 ──", "access": {"eval_staff": WRITE, "staff": WRITE}, "channels": [
            ch("📋｜評価会議"),
            ch("📝｜評価記録"),
            ch("評価員会議", type="voice"),
        ]},
        "failed": {"name": "⛓️ ── 再評価 ──", "access": {"failed": WRITE, "eval_staff": WRITE, "staff": WRITE}, "channels": [
            ch("📜｜評価落ちの案内", access={"failed": READ}),
            ch("📮｜再評価申請"),
            ch("💬｜評価落ち待機所"),
        ]},
        "violator": {"name": "🚫 ── 違反者 ──", "access": {"violator": WRITE, "staff": WRITE}, "channels": [
            ch("📜｜違反者の案内", access={"violator": READ}),
            ch("📝｜反省文"),
            ch("📮｜異議申し立て"),
        ]},
        "staff": {"name": "🛡️ ── 運営 ──", "access": {"staff": WRITE}, "channels": [
            ch("🛡️｜運営連絡"),
            ch("📌｜運営メモ"),
            ch("運営会議", type="voice"),
        ]},
        "logs": {"name": "📂 ── ログ ──", "access": {"staff": WRITE}, "channels": [
            ch("📥｜入退室ログ", logs=["member_join_leave"]),
            ch("✏️｜メッセージログ", logs=["message_edit", "message_delete"]),
            ch("🔊｜vcログ", logs=["vc_join_leave"]),
            ch("🧾｜通貨ログ", logs=["currency", "role_salary", "member_transfer"]),
            ch("🛍️｜ショップ・ガチャログ", logs=["shop", "shop_extend", "gacha"]),
            ch("🎰｜カジノログ", logs=["gambling"]),
            ch("📋｜評価・面接ログ", has("eval_staff") or has("interviewer"), logs=["evaluation_failure", "interviewer"]),
            ch("🛡️｜荒らし対策ログ", logs=["antigrief"]),
        ]},
    }
    for c in cats.values():
        c["channels"] = [x for x in c["channels"] if x]
    return cats


def custom_template(spec: dict) -> dict:
    """ダッシュボードで作ったテンプレート（設定キー → ロール名）を build() に渡せる形にする。"""
    if not isinstance(spec, dict):
        raise ValueError("テンプレートの形式が正しくありません")
    names = spec.get("roles") or {}
    meta = dict(CUSTOM_ROLE_SETTINGS)

    roles, by_name, groups = [], {}, {}
    for key in CUSTOM_ROLE_KEYS:
        name = str(names.get(key) or "").strip()[:100]
        if not name:
            continue
        m = meta[key]
        spec_role = by_name.get(name)
        if spec_role is None:
            # 同じ名前を複数の設定に入れたら1つのロールにまとめる（上位の設定の色・権限を使う）
            spec_role = {"key": f"r{len(roles)}", "name": name, "color": m.get("color", 0),
                         "hoist": m.get("hoist", False), "mentionable": m.get("mentionable", False),
                         "perms": m.get("perms"), "settings": []}
            roles.append(spec_role)
            by_name[name] = spec_role
        else:
            spec_role["hoist"] = spec_role["hoist"] or m.get("hoist", False)
            spec_role["mentionable"] = spec_role["mentionable"] or m.get("mentionable", False)
        spec_role["settings"].append(key)
        if m.get("group"):
            members = groups.setdefault(m["group"], [])
            if spec_role["key"] not in members:
                members.append(spec_role["key"])
    if not roles:
        raise ValueError("ロール名が1つも入力されていません")
    if not any("MAIN_SUB_MEMBER_ROLE_IDS" in r["settings"] for r in roles):
        # 本・準メンバーロールが空なら、本メンバー・準メンバーのロールをそこにも入れる
        for r in roles:
            if {"MAIN_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS"} & set(r["settings"]):
                r["settings"].append("MAIN_SUB_MEMBER_ROLE_IDS")

    has = lambda g: bool(groups.get(g))
    cats = _custom_categories(has)
    selected = spec.get("categories")
    if not isinstance(selected, list):
        selected = CUSTOM_CATEGORY_IDS
    categories = []
    for cid in CUSTOM_CATEGORY_IDS:
        if cid not in selected:
            continue
        req = CUSTOM_CATEGORY_REQUIRES[cid]
        if req and not any(has(g) for g in req):
            continue
        categories.append(cats[cid])

    return {
        "name": str(spec.get("name") or "").strip()[:50] or "カスタムテンプレート",
        "description": "ダッシュボードで作成",
        "roles": roles,
        "groups": groups,
        "categories": categories,
    }

_LIST_SETTINGS = {
    "ADMIN_ROLE_IDS", "EVALUATOR_ROLE_IDS", "EVALUATOR_TIER3_ROLE_IDS", "INTERVIEWER_ROLE_IDS",
    "BANKER_ROLE_IDS", "MAIN_SUB_MEMBER_ROLE_IDS", "MAIN_MEMBER_ROLE_IDS", "SUB_MEMBER_ROLE_IDS",
    "NEW_MEMBER_ROLE_IDS", "GAMBLE_VIOLATOR_ROLE_IDS", "GAMBLE_EMPLOYEE_ROLE_IDS", "SELF_INTRO_CHANNEL_IDS",
}


_SHOP_SETTINGS = {"SHOP_EMPLOYEE_ROLE_ID", "SHOP_MANAGER_ROLE_ID"}


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


def _build_overwrites(guild: discord.Guild, access: dict, roles: dict, groups: dict = None) -> dict:
    groups = GROUPS if groups is None else groups
    overwrites = {guild.default_role: _overwrite(access.get("everyone", HIDDEN))}
    for group, level in access.items():
        if group == "everyone":
            continue
        for key in groups.get(group, [group]):
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
    groups = template.get("groups", GROUPS)

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
                    if await _sync_overwrites(guild, category, _build_overwrites(guild, cat_spec["access"], roles, groups), roles, reason):
                        result["synced"].append(category.name)
                except discord.HTTPException as e:
                    result["errors"].append(f"カテゴリー「{cat_spec['name']}」の権限: {e}")
        else:
            try:
                category = await guild.create_category(
                    cat_spec["name"], overwrites=_build_overwrites(guild, cat_spec["access"], roles, groups), reason=reason)
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
            overwrites = _build_overwrites(guild, access, roles, groups)
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
        if key in _SHOP_SETTINGS:
            continue
        if key in _LIST_SETTINGS or key.endswith("_IDS"):
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
    shop = {k: ids[0] for k, ids in settings.items() if k in _SHOP_SETTINGS and ids}
    if shop:
        # ショップの従業員・統括ロールは bot_settings ではなく shop_settings に入っている
        try:
            cur = await database.get_shop_settings(guild.id)
            await database.set_shop_settings(
                guild.id,
                shop.get("SHOP_EMPLOYEE_ROLE_ID", cur.get("employee_role_id")),
                shop.get("SHOP_MANAGER_ROLE_ID", cur.get("manager_role_id")),
                cur.get("inquiry_mention_role_id"),
                cur.get("inquiry_mention_role_ids") or [],
            )
        except Exception as e:
            errors.append(f"ショップのロール設定: {e}")


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


async def load_saved_template(guild_id: int):
    """「テンプレ保存」で保存したテンプレートを build() 用に変換して返す。無ければ None。"""
    spec = await database.get_setting_value(guild_id, CUSTOM_TEMPLATE_KEY)
    if not spec:
        return None
    return custom_template(spec)


def result_summary(result: dict) -> dict:
    return {
        "created_roles": len(result["created_roles"]), "reused_roles": len(result["reused_roles"]),
        "created_channels": len(result["created_channels"]), "reused_channels": len(result["reused_channels"]),
        "synced": len(result["synced"]), "settings": len(result["settings"]), "logs": len(result.get("logs", [])),
        "errors": result["errors"][:30],
    }


async def run_dashboard_build(bot, guild: discord.Guild, apply_settings: bool, sync_permissions: bool):
    """ダッシュボードの「サーバー作成」ボタンから（IPC 経由で）呼ばれる。進み具合は SERVER_BUILD_STATUS に書く。"""
    import datetime

    def now():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    status = {"state": "running", "started_at": now(), "message": "準備しています…"}

    async def save_status(**kw):
        status.update(kw)
        try:
            await database.save_setting(guild.id, CUSTOM_STATUS_KEY, status)
        except Exception as e:
            print(f"[ServerBuild] status save error: {e}")

    await save_status()
    try:
        me = guild.me.guild_permissions
        if not (me.manage_roles and me.manage_channels):
            raise ValueError("Bot に「ロールの管理」と「チャンネルの管理」の権限が必要です")
        spec = await database.get_setting_value(guild.id, CUSTOM_PENDING_KEY)
        if not spec:
            raise ValueError("作成するテンプレートが見つかりません")
        template = custom_template(spec)
        await save_status(name=template["name"], message=f"{plan_summary(template)} を作成します…")
        result = await build(bot, guild, template, apply_settings, lambda msg: save_status(message=msg), sync_permissions)
        await save_status(state="done", finished_at=now(), message="完了しました", result=result_summary(result))
    except Exception as e:
        await save_status(state="error", finished_at=now(), message=str(e))


CATALOG_KEY = "SERVER_TEMPLATE_CATALOG"


def preview(template: dict) -> dict:
    """ダッシュボードで中身を見せるための要約（ロール・カテゴリー・チャンネル）。"""
    return {
        "name": template["name"],
        "description": template.get("description", ""),
        "summary": plan_summary(template),
        "roles": [{"name": r["name"], "color": r.get("color", 0), "settings": r.get("settings", [])}
                  for r in template["roles"]],
        "categories": [{"name": c["name"], "channels": [
            {"name": ch["name"], "voice": ch.get("type") == "voice"} for ch in c["channels"]]}
            for c in template["categories"]],
    }


async def publish_catalog(guild_id: int):
    """組み込みテンプレートと「テンプレ保存」したテンプレートの中身を SERVER_TEMPLATE_CATALOG に書く。"""
    import datetime
    items = [{"id": key, "source": "builtin", **preview(tpl)} for key, tpl in TEMPLATES.items()]
    spec = await database.get_setting_value(guild_id, CUSTOM_TEMPLATE_KEY)
    if spec:
        item = {"id": "custom", "source": "saved",
                "updated_at": spec.get("updated_at") if isinstance(spec, dict) else None}
        try:
            item.update(preview(custom_template(spec)))
        except Exception as e:
            item.update({"name": (spec.get("name") if isinstance(spec, dict) else None) or "保存したテンプレート",
                         "error": str(e)})
        items.append(item)
    await database.save_setting(guild_id, CATALOG_KEY, {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "templates": items,
    })
