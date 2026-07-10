"""
定数のみ。DB依存の動的設定はguild_settings(Supabase)で管理する。
"""
import datetime

# タイムゾーン
JST = datetime.timezone(datetime.timedelta(hours=9))

# メッセージXP
TC_XP_REWARD = 10      # メッセージ1通あたりのXP
TC_XP_COOLDOWN = 10    # TC XP獲得のクールダウン（秒）
MSG_COOLDOWN = 60       # 通貨獲得のクールダウン（秒）

# VCのXP
VC_XP_PER_MIN = 15     # VC滞在1分あたりのXP

# 入界時の初期コイン（DBで上書き可能）
INITIAL_COINS_DEFAULT = 30000

# 評価Tier数
EVALUATOR_TIER_COUNT = 3

# デフォルト評価期間（日数）
DEFAULT_EVAL_DAYS = 14

# ギャンブル部屋設定（Phase 3用プレースホルダー）
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
    },
    "ゲームVC": {
        12: {"price": 10000, "duration_hours": 12},
        24: {"price": 15000, "duration_hours": 24}
    },
    "賭博VC": {
        12: {"price": 10000, "duration_hours": 12},
        24: {"price": 15000, "duration_hours": 24}
    }
}

# --- 動的設定のデフォルト値 ---
# guild_settingsテーブルに値がない場合のフォールバック
DEFAULT_GUILD_SETTINGS = {
    # 通貨
    "CURRENCY_NAME": "コイン",
    "INITIAL_COINS": 30000,

    # チャンネル
    "LEVEL_UP_CHANNEL_ID": None,
    "CREATE_VC_CHANNEL_ID": None,
    "EVALUATION_CATEGORY_ID": None,

    # ロール
    "NEW_MEMBER_ROLE_ID": None,
    "PENDING_MEMBER_ROLE_ID": None,
    "INTERVIEWER_ROLE_IDS": [],
    "MAIN_SUB_MEMBER_ROLE_IDS": [],
    "FREE_INN_ROLE_IDS": [],
    "ADMIN_ROLE_IDS": [],
    "EVALUATOR_ROLE_IDS": [],
    "EVALUATOR_TIER1_ROLE_IDS": [],
    "EVALUATOR_TIER2_ROLE_IDS": [],
    "EVALUATOR_TIER3_ROLE_IDS": [],
    "EVENT_MANAGER_ROLE_IDS": [],
    "BANKER_ROLE_IDS": [],
    "DOWNGRADE_ROLE_ID": None,
    "VIOLATOR_ROLE_ID": None,
    "MINUS_TARGET_ROLE_IDS": [],

    # 評価
    "SELF_INTRO_CHANNEL_IDS": [],
    "EVALUATION_FORUM_CHANNEL_IDS": [],
    "EVAL_DURATION_DAYS": 14,

    # レベリング
    "ENABLE_TC_RANK": True,
    "ENABLE_VC_RANK": True,
    "ENABLE_VC_COINS": True,
    "VC_COINS_PER_MIN": 12,

    # ギャンブル設定
    "GAMBLE_MAX_BET": 100000,
    "GAMBLE_MAX_PLAYS": 10,
    "GAMBLE_DAILY_LIMIT": 1000000,
    "GAMBLE_TAX_ENABLED": False,
    "GAMBLE_TAX_RATE": 0.05,

    # 処罰設定
    "MINUS_PUNISHMENT_TYPE": "evaluation_failure",
}
