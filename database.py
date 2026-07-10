"""
database.py - 全テーブルにguild_idを持つ完全マルチサーバー対応DB層
"""
import asyncpg
import datetime
import os
import json
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
JST = datetime.timezone(datetime.timedelta(hours=9))

pool = None


async def get_pool():
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            statement_cache_size=0,
            min_size=1,
            max_size=10
        )
    return pool


def get_now_naive():
    return datetime.datetime.now(JST).replace(tzinfo=None)


# ============================================================
# DBセットアップ（テーブル作成）
# ============================================================
async def setup_db():
    p = await get_pool()
    async with p.acquire() as conn:

        # --- guild_settings（全設定を guild_id + key で管理）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id      BIGINT NOT NULL,
                setting_key   TEXT   NOT NULL,
                setting_value TEXT,
                PRIMARY KEY (guild_id, setting_key)
            )
        ''')

        # --- users（guild_id で完全分離）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                guild_id        BIGINT  NOT NULL,
                user_id         BIGINT  NOT NULL,
                balance         INTEGER DEFAULT 0,
                last_daily      TIMESTAMP,
                tc_xp           INTEGER DEFAULT 0,
                tc_level        INTEGER DEFAULT 1,
                vc_xp           INTEGER DEFAULT 0,
                vc_level        INTEGER DEFAULT 1,
                eval_vc_time    INTEGER DEFAULT 0,
                initial_issued  BOOLEAN DEFAULT FALSE,
                PRIMARY KEY (guild_id, user_id)
            )
        ''')

        # --- evaluation_periods ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS evaluation_periods (
                guild_id   BIGINT    NOT NULL,
                user_id    BIGINT    NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time   TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            )
        ''')

        # --- user_evaluations（評価シート）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS user_evaluations (
                id              SERIAL PRIMARY KEY,
                guild_id        BIGINT    NOT NULL,
                target_user_id  BIGINT    NOT NULL,
                evaluator_id    BIGINT    NOT NULL,
                evaluator_name  TEXT      NOT NULL,
                score           INTEGER   NOT NULL,
                stamp_count     INTEGER   DEFAULT 0,
                comment         TEXT      DEFAULT '',
                created_at      TIMESTAMP NOT NULL DEFAULT NOW()
            )
        ''')

        # --- interviewer_logs ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS interviewer_logs (
                id              SERIAL PRIMARY KEY,
                guild_id        BIGINT    NOT NULL,
                interviewer_id  BIGINT    NOT NULL,
                target_user_id  BIGINT    NOT NULL,
                created_at      TIMESTAMP NOT NULL DEFAULT NOW()
            )
        ''')

        # --- log_settings ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS log_settings (
                guild_id   BIGINT      NOT NULL,
                log_type   VARCHAR(50) NOT NULL,
                channel_id BIGINT,
                PRIMARY KEY (guild_id, log_type)
            )
        ''')

        # --- evaluation_settings ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS evaluation_settings (
                guild_id               BIGINT PRIMARY KEY,
                forum_channel_ids      BIGINT[] DEFAULT '{}',
                self_intro_channel_ids BIGINT[] DEFAULT '{}'
            )
        ''')

        # --- rank_settings（XP対象チャンネル/カテゴリ）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS rank_settings (
                guild_id               BIGINT PRIMARY KEY,
                whitelist_channel_ids  BIGINT[] DEFAULT '{}',
                blacklist_channel_ids  BIGINT[] DEFAULT '{}',
                whitelist_category_ids BIGINT[] DEFAULT '{}',
                blacklist_category_ids BIGINT[] DEFAULT '{}'
            )
        ''')

        # --- vc_coins_settings ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS vc_coins_settings (
                guild_id               BIGINT PRIMARY KEY,
                whitelist_channel_ids  BIGINT[] DEFAULT '{}',
                blacklist_channel_ids  BIGINT[] DEFAULT '{}',
                whitelist_category_ids BIGINT[] DEFAULT '{}',
                blacklist_category_ids BIGINT[] DEFAULT '{}'
            )
        ''')

        # --- antigrief_settings ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS antigrief_settings (
                guild_id              BIGINT PRIMARY KEY,
                target_category_ids   BIGINT[] DEFAULT '{}',
                target_channel_ids    BIGINT[] DEFAULT '{}',
                exempt_role_ids       BIGINT[] DEFAULT '{}'
            )
        ''')

        # --- level_role_rewards ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS level_role_rewards (
                guild_id   BIGINT      NOT NULL,
                level_type VARCHAR(10) NOT NULL,
                level      INTEGER     NOT NULL,
                role_id    BIGINT      NOT NULL,
                PRIMARY KEY (guild_id, level_type, level, role_id)
            )
        ''')

        # --- level_coin_rewards ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS level_coin_rewards (
                guild_id   BIGINT      NOT NULL,
                level_type VARCHAR(10) NOT NULL,
                level      INTEGER     NOT NULL,
                coins      INTEGER     NOT NULL,
                PRIMARY KEY (guild_id, level_type, level)
            )
        ''')

        # --- auto_vc_triggers ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS auto_vc_triggers (
                guild_id   BIGINT NOT NULL,
                channel_id BIGINT NOT NULL,
                PRIMARY KEY (guild_id, channel_id)
            )
        ''')

        # --- auto_vc_config ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS auto_vc_config (
                guild_id            BIGINT  NOT NULL,
                channel_id          BIGINT  NOT NULL,
                base_name           TEXT    DEFAULT '',
                allow_rename        BOOLEAN DEFAULT TRUE,
                include_owner_name  BOOLEAN DEFAULT TRUE,
                use_numbering       BOOLEAN DEFAULT FALSE,
                allow_limit_change  BOOLEAN DEFAULT TRUE,
                show_panel          BOOLEAN DEFAULT TRUE,
                PRIMARY KEY (guild_id, channel_id)
            )
        ''')

        # --- user_vc_durations（VCカテゴリごとの滞在時間）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS user_vc_durations (
                guild_id          BIGINT  NOT NULL,
                user_id           BIGINT  NOT NULL,
                category_id       BIGINT  NOT NULL,
                duration_seconds  INTEGER DEFAULT 0,
                PRIMARY KEY (guild_id, user_id, category_id)
            )
        ''')

        # --- rooms（Phase 3用）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS rooms (
                guild_id           BIGINT NOT NULL,
                channel_id         BIGINT NOT NULL,
                owner_id           BIGINT,
                room_type          TEXT,
                expire_at          TIMESTAMP,
                trigger_channel_id BIGINT,
                PRIMARY KEY (guild_id, channel_id)
            )
        ''')

        # --- shop_items（Phase 3用）---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS shop_items (
                item_id         SERIAL PRIMARY KEY,
                guild_id        BIGINT  NOT NULL,
                name            TEXT    NOT NULL,
                description     TEXT    DEFAULT '',
                price           INTEGER NOT NULL,
                target_role_ids BIGINT[] DEFAULT '{}',
                reward_role_ids BIGINT[] DEFAULT '{}',
                duration_days   INTEGER DEFAULT NULL,
                is_eval_extend  BOOLEAN DEFAULT FALSE,
                extend_days     INTEGER DEFAULT 0
            )
        ''')

        # --- reaction_roles ---
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS reaction_roles (
                guild_id   BIGINT NOT NULL,
                message_id BIGINT NOT NULL,
                emoji      TEXT   NOT NULL,
                role_id    BIGINT NOT NULL,
                PRIMARY KEY (guild_id, message_id, emoji)
            )
        ''')

        print("[DB] All tables created/verified.")


# ============================================================
# guild_settings（動的設定）
# ============================================================
async def get_guild_setting(guild_id: int, key: str):
    """サーバーごとの設定値を取得。JSONデコードも試みる。"""
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT setting_value FROM guild_settings WHERE guild_id=$1 AND setting_key=$2",
            guild_id, key
        )
    if row is None:
        return None
    val = row["setting_value"]
    if val is None:
        return None
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return val


async def set_guild_setting(guild_id: int, key: str, value):
    """サーバーごとの設定値を保存。リスト・bool・intは JSON文字列に変換。"""
    p = await get_pool()
    if isinstance(value, (list, dict, bool)):
        val_str = json.dumps(value, ensure_ascii=False)
    elif value is None:
        val_str = None
    else:
        val_str = str(value)

    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO guild_settings (guild_id, setting_key, setting_value)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
            ''',
            guild_id, key, val_str
        )


async def load_guild_settings(guild_id: int) -> dict:
    """サーバーの全設定をdictで返す。"""
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT setting_key, setting_value FROM guild_settings WHERE guild_id=$1",
            guild_id
        )
    result = {}
    for row in rows:
        val = row["setting_value"]
        try:
            result[row["setting_key"]] = json.loads(val) if val is not None else None
        except (json.JSONDecodeError, TypeError):
            result[row["setting_key"]] = val
    return result


# ============================================================
# users
# ============================================================
async def ensure_user(guild_id: int, user_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO users (guild_id, user_id) VALUES ($1, $2)
            ON CONFLICT (guild_id, user_id) DO NOTHING
            ''',
            guild_id, user_id
        )


async def get_user(guild_id: int, user_id: int) -> dict | None:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM users WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )
    return dict(row) if row else None


async def get_balance(guild_id: int, user_id: int) -> int:
    await ensure_user(guild_id, user_id)
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT balance FROM users WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )
    return row["balance"] if row else 0


async def add_balance(guild_id: int, user_id: int, amount: int) -> int:
    await ensure_user(guild_id, user_id)
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2 RETURNING balance",
            guild_id, user_id, amount
        )
    return row["balance"] if row else 0


async def set_balance(guild_id: int, user_id: int, amount: int) -> int:
    await ensure_user(guild_id, user_id)
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE users SET balance=$3 WHERE guild_id=$1 AND user_id=$2 RETURNING balance",
            guild_id, user_id, amount
        )
    return row["balance"] if row else 0


async def mark_initial_issued(guild_id: int, user_id: int):
    await ensure_user(guild_id, user_id)
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "UPDATE users SET initial_issued=TRUE WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )


async def is_initial_issued(guild_id: int, user_id: int) -> bool:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT initial_issued FROM users WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )
    return bool(row["initial_issued"]) if row else False


# ============================================================
# XP / レベル
# ============================================================
async def add_xp(guild_id: int, user_id: int, amount: int, xp_type: str) -> int | None:
    """
    XPを加算し、レベルアップした場合は新しいレベルを返す（しなければNone）。
    xp_type: 'tc' or 'vc'
    """
    await ensure_user(guild_id, user_id)
    p = await get_pool()
    xp_col = "tc_xp" if xp_type == "tc" else "vc_xp"
    lv_col  = "tc_level" if xp_type == "tc" else "vc_level"

    async with p.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {xp_col}, {lv_col} FROM users WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )
        if not row:
            return None

        current_xp = row[xp_col] + amount
        current_lv = row[lv_col]
        new_lv = _calculate_level(current_xp)

        await conn.execute(
            f"UPDATE users SET {xp_col}=$3, {lv_col}=$4 WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id, current_xp, new_lv
        )

    return new_lv if new_lv > current_lv else None


def _calculate_level(xp: int) -> int:
    """XP → レベル変換（既存botと同じ式）"""
    level = 1
    required = 100
    while xp >= required:
        xp -= required
        level += 1
        required = int(required * 1.15)
    return level


async def get_xp_for_level(level: int, xp_type: str = "tc") -> int:
    """レベルに必要な累計XP"""
    total = 0
    req = 100
    for _ in range(level - 1):
        total += req
        req = int(req * 1.15)
    return total


async def get_top_users(guild_id: int, xp_type: str, limit: int = 10) -> list[dict]:
    p = await get_pool()
    col = "tc_xp" if xp_type == "tc" else "vc_xp"
    lv_col = "tc_level" if xp_type == "tc" else "vc_level"
    async with p.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT user_id, {col} as xp, {lv_col} as level FROM users WHERE guild_id=$1 ORDER BY {col} DESC LIMIT $2",
            guild_id, limit
        )
    return [dict(r) for r in rows]


# ============================================================
# VC滞在時間
# ============================================================
async def add_vc_duration(guild_id: int, user_id: int, category_id: int, seconds: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO user_vc_durations (guild_id, user_id, category_id, duration_seconds)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id, category_id)
            DO UPDATE SET duration_seconds = user_vc_durations.duration_seconds + EXCLUDED.duration_seconds
            ''',
            guild_id, user_id, category_id, seconds
        )


async def get_vc_duration_for_categories(guild_id: int, user_id: int, category_ids: list[int]) -> int:
    if not category_ids:
        return 0
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT duration_seconds FROM user_vc_durations WHERE guild_id=$1 AND user_id=$2 AND category_id=ANY($3)",
            guild_id, user_id, category_ids
        )
    return sum(r["duration_seconds"] for r in rows)


# ============================================================
# 評価期間
# ============================================================
async def add_evaluation_period(guild_id: int, user_id: int, start_time, end_time):
    p = await get_pool()
    st = start_time.replace(tzinfo=None) if hasattr(start_time, 'tzinfo') and start_time.tzinfo else start_time
    et = end_time.replace(tzinfo=None)   if hasattr(end_time, 'tzinfo')   and end_time.tzinfo   else end_time
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO evaluation_periods (guild_id, user_id, start_time, end_time)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id) DO UPDATE
            SET start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time
            ''',
            guild_id, user_id, st, et
        )


async def get_evaluation_period(guild_id: int, user_id: int) -> dict | None:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM evaluation_periods WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )
    return dict(row) if row else None


async def update_evaluation_period_end(guild_id: int, user_id: int, new_end):
    et = new_end.replace(tzinfo=None) if hasattr(new_end, 'tzinfo') and new_end.tzinfo else new_end
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "UPDATE evaluation_periods SET end_time=$3 WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id, et
        )


async def delete_evaluation_period(guild_id: int, user_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "DELETE FROM evaluation_periods WHERE guild_id=$1 AND user_id=$2",
            guild_id, user_id
        )


# ============================================================
# 評価シート
# ============================================================
async def add_user_evaluation(guild_id: int, target_user_id: int, evaluator_id: int,
                               evaluator_name: str, score: int, stamp_count: int = 0, comment: str = ""):
    p = await get_pool()
    now = get_now_naive()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO user_evaluations
                (guild_id, target_user_id, evaluator_id, evaluator_name, score, stamp_count, comment, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ''',
            guild_id, target_user_id, evaluator_id, evaluator_name, score, stamp_count, comment, now
        )


async def get_user_evaluations(guild_id: int, user_id: int) -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            '''
            SELECT id as eval_id, evaluator_id, evaluator_name, score, stamp_count, comment, created_at
            FROM user_evaluations
            WHERE guild_id=$1 AND target_user_id=$2
            ORDER BY created_at DESC
            ''',
            guild_id, user_id
        )
    return [dict(r) for r in rows]


async def delete_user_evaluation(eval_id: int, guild_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "DELETE FROM user_evaluations WHERE id=$1 AND guild_id=$2",
            eval_id, guild_id
        )


# ============================================================
# 面接ログ
# ============================================================
async def add_interviewer_log(guild_id: int, interviewer_id: int, target_user_id: int):
    p = await get_pool()
    now = get_now_naive()
    async with p.acquire() as conn:
        await conn.execute(
            "INSERT INTO interviewer_logs (guild_id, interviewer_id, target_user_id, created_at) VALUES ($1,$2,$3,$4)",
            guild_id, interviewer_id, target_user_id, now
        )


async def get_interviewer_count(guild_id: int, interviewer_id: int) -> int:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT COUNT(*) as cnt FROM interviewer_logs WHERE guild_id=$1 AND interviewer_id=$2",
            guild_id, interviewer_id
        )
    return row["cnt"] if row else 0


# ============================================================
# ログ設定
# ============================================================
async def set_log_channel(guild_id: int, log_type: str, channel_id: int | None):
    p = await get_pool()
    async with p.acquire() as conn:
        if channel_id is None:
            await conn.execute(
                "DELETE FROM log_settings WHERE guild_id=$1 AND log_type=$2",
                guild_id, log_type
            )
        else:
            await conn.execute(
                '''
                INSERT INTO log_settings (guild_id, log_type, channel_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (guild_id, log_type) DO UPDATE SET channel_id=EXCLUDED.channel_id
                ''',
                guild_id, log_type, channel_id
            )


async def get_log_channel(guild_id: int, log_type: str) -> int | None:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT channel_id FROM log_settings WHERE guild_id=$1 AND log_type=$2",
            guild_id, log_type
        )
    return row["channel_id"] if row else None


async def get_all_log_settings(guild_id: int) -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT log_type, channel_id FROM log_settings WHERE guild_id=$1",
            guild_id
        )
    return [dict(r) for r in rows]


# ============================================================
# 評価設定（フォーラム・自己紹介チャンネル）
# ============================================================
async def set_evaluation_settings(guild_id: int, forum_ids: list, self_intro_ids: list):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO evaluation_settings (guild_id, forum_channel_ids, self_intro_channel_ids)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id) DO UPDATE
            SET forum_channel_ids=EXCLUDED.forum_channel_ids,
                self_intro_channel_ids=EXCLUDED.self_intro_channel_ids
            ''',
            guild_id, forum_ids, self_intro_ids
        )


async def get_evaluation_settings(guild_id: int) -> dict:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM evaluation_settings WHERE guild_id=$1",
            guild_id
        )
    if row:
        return {
            "forum_channel_ids": list(row["forum_channel_ids"] or []),
            "self_intro_channel_ids": list(row["self_intro_channel_ids"] or [])
        }
    return {"forum_channel_ids": [], "self_intro_channel_ids": []}


async def get_all_evaluation_settings() -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM evaluation_settings")
    return [
        {
            "guild_id": r["guild_id"],
            "forum_channel_ids": list(r["forum_channel_ids"] or []),
            "self_intro_channel_ids": list(r["self_intro_channel_ids"] or [])
        }
        for r in rows
    ]


# ============================================================
# ランク設定（XP対象チャンネル/カテゴリ）
# ============================================================
async def get_rank_settings(guild_id: int) -> dict:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM rank_settings WHERE guild_id=$1", guild_id)
    if row:
        return {
            "whitelist": list(row["whitelist_channel_ids"] or []),
            "blacklist": list(row["blacklist_channel_ids"] or []),
            "categories": list(row["whitelist_category_ids"] or []),
            "blacklist_categories": list(row["blacklist_category_ids"] or [])
        }
    return {"whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": []}


async def save_rank_settings(guild_id: int, whitelist: list, blacklist: list,
                              wl_cats: list, bl_cats: list):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO rank_settings
                (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (guild_id) DO UPDATE
            SET whitelist_channel_ids=EXCLUDED.whitelist_channel_ids,
                blacklist_channel_ids=EXCLUDED.blacklist_channel_ids,
                whitelist_category_ids=EXCLUDED.whitelist_category_ids,
                blacklist_category_ids=EXCLUDED.blacklist_category_ids
            ''',
            guild_id, whitelist, blacklist, wl_cats, bl_cats
        )


async def get_all_rank_settings() -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM rank_settings")
    return [
        {
            "guild_id": r["guild_id"],
            "whitelist": list(r["whitelist_channel_ids"] or []),
            "blacklist": list(r["blacklist_channel_ids"] or []),
            "categories": list(r["whitelist_category_ids"] or []),
            "blacklist_categories": list(r["blacklist_category_ids"] or [])
        }
        for r in rows
    ]


# ============================================================
# VCコイン設定
# ============================================================
async def get_vc_coins_settings(guild_id: int) -> dict:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM vc_coins_settings WHERE guild_id=$1", guild_id)
    if row:
        return {
            "whitelist": list(row["whitelist_channel_ids"] or []),
            "blacklist": list(row["blacklist_channel_ids"] or []),
            "categories": list(row["whitelist_category_ids"] or []),
            "blacklist_categories": list(row["blacklist_category_ids"] or [])
        }
    return {"whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": []}


async def save_vc_coins_settings(guild_id: int, whitelist: list, blacklist: list,
                                  wl_cats: list, bl_cats: list):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO vc_coins_settings
                (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (guild_id) DO UPDATE
            SET whitelist_channel_ids=EXCLUDED.whitelist_channel_ids,
                blacklist_channel_ids=EXCLUDED.blacklist_channel_ids,
                whitelist_category_ids=EXCLUDED.whitelist_category_ids,
                blacklist_category_ids=EXCLUDED.blacklist_category_ids
            ''',
            guild_id, whitelist, blacklist, wl_cats, bl_cats
        )


async def get_all_vc_coins_settings() -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM vc_coins_settings")
    return [
        {
            "guild_id": r["guild_id"],
            "whitelist": list(r["whitelist_channel_ids"] or []),
            "blacklist": list(r["blacklist_channel_ids"] or []),
            "categories": list(r["whitelist_category_ids"] or []),
            "blacklist_categories": list(r["blacklist_category_ids"] or [])
        }
        for r in rows
    ]


# ============================================================
# 荒らし対策設定
# ============================================================
async def get_antigrief_settings(guild_id: int) -> dict:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM antigrief_settings WHERE guild_id=$1", guild_id)
    if row:
        return {
            "categories": list(row["target_category_ids"] or []),
            "channels": list(row["target_channel_ids"] or []),
            "exempt_roles": list(row["exempt_role_ids"] or [])
        }
    return {"categories": [], "channels": [], "exempt_roles": []}


async def save_antigrief_settings(guild_id: int, categories: list, channels: list, exempt_roles: list):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO antigrief_settings (guild_id, target_category_ids, target_channel_ids, exempt_role_ids)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (guild_id) DO UPDATE
            SET target_category_ids=EXCLUDED.target_category_ids,
                target_channel_ids=EXCLUDED.target_channel_ids,
                exempt_role_ids=EXCLUDED.exempt_role_ids
            ''',
            guild_id, categories, channels, exempt_roles
        )


async def get_all_antigrief_settings() -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM antigrief_settings")
    return [
        {
            "guild_id": r["guild_id"],
            "categories": list(r["target_category_ids"] or []),
            "channels": list(r["target_channel_ids"] or []),
            "exempt_roles": list(r["exempt_role_ids"] or [])
        }
        for r in rows
    ]


# ============================================================
# レベルロール報酬
# ============================================================
async def get_level_role_rewards(guild_id: int, level_type: str) -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT level, role_id FROM level_role_rewards WHERE guild_id=$1 AND level_type=$2 ORDER BY level",
            guild_id, level_type
        )
    return [dict(r) for r in rows]


async def add_level_role_reward(guild_id: int, level_type: str, level: int, role_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO level_role_rewards (guild_id, level_type, level, role_id)
            VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
            ''',
            guild_id, level_type, level, role_id
        )


async def remove_level_role_reward(guild_id: int, level_type: str, level: int, role_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "DELETE FROM level_role_rewards WHERE guild_id=$1 AND level_type=$2 AND level=$3 AND role_id=$4",
            guild_id, level_type, level, role_id
        )


# ============================================================
# レベルコイン報酬
# ============================================================
async def get_level_coin_rewards(guild_id: int, level_type: str) -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT level, coins FROM level_coin_rewards WHERE guild_id=$1 AND level_type=$2 ORDER BY level",
            guild_id, level_type
        )
    return [dict(r) for r in rows]


async def set_level_coin_reward(guild_id: int, level_type: str, level: int, coins: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO level_coin_rewards (guild_id, level_type, level, coins)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (guild_id, level_type, level) DO UPDATE SET coins=EXCLUDED.coins
            ''',
            guild_id, level_type, level, coins
        )


# ============================================================
# 自動VC
# ============================================================
async def get_auto_vc_triggers(guild_id: int) -> list[int]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT channel_id FROM auto_vc_triggers WHERE guild_id=$1", guild_id)
    return [r["channel_id"] for r in rows]


async def add_auto_vc_trigger(guild_id: int, channel_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "INSERT INTO auto_vc_triggers (guild_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            guild_id, channel_id
        )


async def remove_auto_vc_trigger(guild_id: int, channel_id: int):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            "DELETE FROM auto_vc_triggers WHERE guild_id=$1 AND channel_id=$2",
            guild_id, channel_id
        )


async def save_auto_vc_config(guild_id: int, channel_id: int, base_name: str,
                               allow_rename: bool, include_owner_name: bool,
                               use_numbering: bool, allow_limit_change: bool, show_panel: bool):
    p = await get_pool()
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO auto_vc_config
                (guild_id, channel_id, base_name, allow_rename, include_owner_name,
                 use_numbering, allow_limit_change, show_panel)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (guild_id, channel_id) DO UPDATE
            SET base_name=EXCLUDED.base_name, allow_rename=EXCLUDED.allow_rename,
                include_owner_name=EXCLUDED.include_owner_name, use_numbering=EXCLUDED.use_numbering,
                allow_limit_change=EXCLUDED.allow_limit_change, show_panel=EXCLUDED.show_panel
            ''',
            guild_id, channel_id, base_name, allow_rename, include_owner_name,
            use_numbering, allow_limit_change, show_panel
        )


async def get_all_auto_vc_configs(guild_id: int) -> list[dict]:
    p = await get_pool()
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM auto_vc_config WHERE guild_id=$1", guild_id)
    return [dict(r) for r in rows]


async def get_auto_vc_config(guild_id: int, channel_id: int) -> dict | None:
    p = await get_pool()
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM auto_vc_config WHERE guild_id=$1 AND channel_id=$2",
            guild_id, channel_id
        )
    return dict(row) if row else None
