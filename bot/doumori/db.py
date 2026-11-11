"""
どう森機能のデータベース操作（doumori リポジトリ src/database/db.js から移植）

ManyBot のほかの機能と同じく、サーバーごとのDB（database.get_pool(guild_id)）を使う。
メインダッシュボードの「データベース設定」でサーバー専用DBが登録されていればそのDBになる。
テーブルは初めて使うときに自動作成する。
"""
import datetime
import json
import random

import database
from doumori.data import DEFAULT_MISSIONS, DEFAULT_RANKS

JST = datetime.timezone(datetime.timedelta(hours=9))

# ダッシュボード（/doumori/[guild_id] の基本設定）と同じ既定値
DEFAULT_SETTINGS = {
    # どう森機能をこのサーバーで使うか（OFF のサーバーではコマンド・浮上計測とも動かない）
    "doumori_enabled": False,
    # 浮上・チケット獲得
    "ticket_required_minutes": 60,
    "ticket_chat_activity_seconds": 60,
    "ticket_chat_cooldown_seconds": 60,
    "ticket_notify_enabled": True,
    "ticket_notify_destination": "last_channel",  # 'dm' | 'channel' | 'last_channel'
    "ticket_notify_channel_id": "",
    "ticket_notify_message": "🎉 **【浮上特典】** {user} さんがアクティビティを達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）",
    # ショップ・両替
    "miles_per_ticket": 100,
    "fishing_rod_price": 1,
    "bug_net_price": 1,
    # 採集
    "shiny_chance_percent": 0.5,
    # 図鑑
    "book_page_size": 10,
    # コンプリートロール
    "fish_completion_role_name": "🎣 金のつりざお",
    "fish_completion_role_color": "#FFD700",
    "bug_completion_role_name": "🦋 金の虫取り網",
    "bug_completion_role_color": "#FFD700",
    # 売却（レア度別・鯖内通貨）
    "sell_price_common": 100,
    "sell_price_uncommon": 300,
    "sell_price_rare": 800,
    "sell_price_super_rare": 2500,
    "sell_price_legendary": 10000,
    "sell_price_shiny_multiplier": 5,
    # ミッション
    "mission_report_channel_id": "",
    "daily_mission_slot_count": 3,
    # 総合操作パネル
    "panel_channel_id": "",
    "panel_title": "🍃 どうぶつの森林 - 総合操作パネル",
    "panel_color": "#2ECC71",
    # 権限ロール（/設定パネル で設定）
    "admin_role_ids": [],
    "mile_grant_role_ids": [],
    "ticket_grant_role_ids": [],
    "mission_staff_role_ids": [],
}

DIY_EVENT_REWARD_MILES = 150
DIY_COOLDOWN_DAYS = 7

_ensured_pools: set[int] = set()


async def get_pool(guild_id: int):
    """このサーバーのDB（どう森のテーブルを用意済み）"""
    p = await database.get_pool(guild_id)
    if id(p) not in _ensured_pools:
        await _ensure_schema(p)
        _ensured_pools.add(id(p))
    return p


async def _ensure_schema(p):
    async with p.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS doumori_users (
                guild_id BIGINT, user_id BIGINT,
                tickets INTEGER DEFAULT 0, coins INTEGER DEFAULT 0,
                vc_total_seconds INTEGER DEFAULT 0, vc_unclaimed_seconds INTEGER DEFAULT 0,
                chat_message_count INTEGER DEFAULT 0,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS doumori_inventory (
                guild_id BIGINT, user_id BIGINT, item_id TEXT, quantity INTEGER DEFAULT 0,
                PRIMARY KEY (guild_id, user_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS doumori_collection (
                guild_id BIGINT, user_id BIGINT, category TEXT, creature_id TEXT,
                count INTEGER DEFAULT 1, has_shiny BOOLEAN DEFAULT FALSE,
                first_caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, user_id, category, creature_id)
            );
            CREATE TABLE IF NOT EXISTS doumori_miles (
                guild_id BIGINT, user_id BIGINT,
                miles INTEGER DEFAULT 0, rank_level INTEGER DEFAULT 1,
                mission_count INTEGER DEFAULT 0, total_mission_count INTEGER DEFAULT 0,
                last_diy_at TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS doumori_daily_missions (
                guild_id BIGINT, user_id BIGINT, date_key TEXT,
                mission_slot INTEGER DEFAULT 1, mission_id INTEGER, mission_title TEXT,
                mission_desc TEXT, reward_miles INTEGER DEFAULT 100,
                status TEXT DEFAULT 'pending', proof_url TEXT
            );
            CREATE TABLE IF NOT EXISTS doumori_missions_master (
                id SERIAL PRIMARY KEY, guild_id BIGINT DEFAULT 0,
                title TEXT NOT NULL, description TEXT NOT NULL,
                target_rank INTEGER DEFAULT 0, reward_miles INTEGER DEFAULT 100,
                is_active BOOLEAN DEFAULT TRUE,
                times_assigned INTEGER DEFAULT 0, times_completed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS doumori_ranks_master (
                level INTEGER PRIMARY KEY, name TEXT NOT NULL, required_miles INTEGER NOT NULL,
                color TEXT NOT NULL, role_name TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS doumori_mission_logs (
                id SERIAL PRIMARY KEY, guild_id BIGINT, user_id BIGINT, staff_id BIGINT,
                mission_desc TEXT, reward_miles INTEGER DEFAULT 100, mission_count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS doumori_mile_logs (
                id SERIAL PRIMARY KEY, guild_id BIGINT, user_id BIGINT, admin_id BIGINT,
                amount INTEGER, action TEXT, reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS doumori_settings (
                guild_id BIGINT, setting_key TEXT, setting_value TEXT,
                PRIMARY KEY (guild_id, setting_key)
            );
        """)
        # 古い主キー (guild_id, user_id, date_key) を外して、同じ日に複数枠を保存できるようにする
        await conn.execute("ALTER TABLE doumori_daily_missions DROP CONSTRAINT IF EXISTS doumori_daily_missions_pkey")
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS doumori_daily_missions_slot_uidx "
            "ON doumori_daily_missions (guild_id, user_id, date_key, mission_slot)"
        )
        for r in DEFAULT_RANKS:
            await conn.execute(
                "INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name) "
                "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (level) DO NOTHING",
                r["level"], r["name"], r["required_miles"], r["color"], r["role_name"],
            )
        if not await conn.fetchval("SELECT COUNT(*) FROM doumori_missions_master"):
            for m in DEFAULT_MISSIONS:
                await conn.execute(
                    "INSERT INTO doumori_missions_master (title, description, target_rank, reward_miles, is_active) "
                    "VALUES ($1, $2, 0, 100, TRUE)",
                    m["title"], m["description"],
                )


# ───────────────────────── 設定 ─────────────────────────

def _parse_value(raw):
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


async def get_settings(guild_id: int) -> dict:
    """ダッシュボードの設定（未設定の項目は既定値）"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT setting_key, setting_value FROM doumori_settings WHERE guild_id = $1", guild_id)
    settings = dict(DEFAULT_SETTINGS)
    for r in rows:
        settings[r["setting_key"]] = _parse_value(r["setting_value"])
    return settings


async def save_settings(guild_id: int, values: dict):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        for key, value in values.items():
            text = json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict, bool)) else str(value)
            await conn.execute(
                "INSERT INTO doumori_settings (guild_id, setting_key, setting_value) VALUES ($1, $2, $3) "
                "ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3",
                guild_id, key, text,
            )


def as_bool(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "on", "yes")
    return bool(value)


def as_int(value, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def is_enabled(guild_id: int) -> bool:
    try:
        return as_bool((await get_settings(guild_id)).get("doumori_enabled"))
    except Exception as e:
        print(f"[Doumori] settings read failed for guild {guild_id}: {e}")
        return False


# ───────────────────────── ユーザー・マイル ─────────────────────────

async def get_user(guild_id: int, user_id: int) -> dict:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO doumori_users (guild_id, user_id) VALUES ($1, $2) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET guild_id = EXCLUDED.guild_id RETURNING *",
            guild_id, user_id,
        )
    return dict(row)


async def get_user_miles(guild_id: int, user_id: int) -> dict:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO doumori_miles (guild_id, user_id, miles, rank_level) VALUES ($1, $2, 0, 1) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET guild_id = EXCLUDED.guild_id RETURNING *",
            guild_id, user_id,
        )
    return dict(row)


async def add_miles(guild_id: int, user_id: int, amount: int) -> int:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO doumori_miles (guild_id, user_id, miles) VALUES ($1, $2, GREATEST(0, $3)) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET miles = GREATEST(0, doumori_miles.miles + $3) RETURNING miles",
            guild_id, user_id, amount,
        )


async def update_last_diy_at(guild_id: int, user_id: int):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute(
            "INSERT INTO doumori_miles (guild_id, user_id, last_diy_at) VALUES ($1, $2, CURRENT_TIMESTAMP) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET last_diy_at = CURRENT_TIMESTAMP",
            guild_id, user_id,
        )


async def diy_days_since(guild_id: int, user_id: int) -> float | None:
    """前回 DIY 作業台を使ってからの日数（DB の時計で計算する。未使用なら None）"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP::timestamp - last_diy_at)) / 86400.0 "
            "FROM doumori_miles WHERE guild_id = $1 AND user_id = $2 AND last_diy_at IS NOT NULL",
            guild_id, user_id,
        )


async def rank_up(guild_id: int, user_id: int, new_level: int, cost: int):
    """マイルを支払って昇格し、階級内のミッション回数をリセットする"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute(
            "INSERT INTO doumori_miles (guild_id, user_id, miles, rank_level, mission_count) VALUES ($1, $2, 0, $3, 0) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET miles = GREATEST(0, doumori_miles.miles - $4), "
            "rank_level = $3, mission_count = 0",
            guild_id, user_id, new_level, cost,
        )


async def get_ranks(guild_id: int) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT level, name, required_miles, color, role_name FROM doumori_ranks_master ORDER BY level ASC")
    return [dict(r) for r in rows] or [dict(r) for r in DEFAULT_RANKS]


async def admin_add_miles(guild_id: int, user_id: int, amount: int, admin_id: int, reason: str) -> int:
    new_miles = await add_miles(guild_id, user_id, amount)
    await _log_miles(guild_id, user_id, admin_id, amount, "grant", reason)
    return new_miles


async def admin_remove_miles(guild_id: int, user_id: int, amount: int, admin_id: int, reason: str) -> tuple[int, int]:
    current = (await get_user_miles(guild_id, user_id))["miles"] or 0
    deducted = min(current, amount)
    new_miles = await add_miles(guild_id, user_id, -deducted)
    await _log_miles(guild_id, user_id, admin_id, deducted, "revoke", reason)
    return new_miles, deducted


async def _log_miles(guild_id, user_id, admin_id, amount, action, reason):
    try:
        p = await get_pool(guild_id)
        async with p.acquire() as conn:
            await conn.execute(
                "INSERT INTO doumori_mile_logs (guild_id, user_id, admin_id, amount, action, reason) VALUES ($1, $2, $3, $4, $5, $6)",
                guild_id, user_id, admin_id, amount, action, reason,
            )
    except Exception as e:
        print(f"[Doumori] mile log failed: {e}")


# ───────────────────────── チケット・道具 ─────────────────────────

async def add_tickets(guild_id: int, user_id: int, amount: int) -> int:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO doumori_users (guild_id, user_id, tickets) VALUES ($1, $2, GREATEST(0, $3)) "
            "ON CONFLICT (guild_id, user_id) DO UPDATE SET tickets = GREATEST(0, doumori_users.tickets + $3) RETURNING tickets",
            guild_id, user_id, amount,
        )


async def spend_tickets(guild_id: int, user_id: int, amount: int) -> int | None:
    """チケットが足りれば消費して残りを返す。足りなければ None"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "UPDATE doumori_users SET tickets = tickets - $3 WHERE guild_id = $1 AND user_id = $2 AND tickets >= $3 RETURNING tickets",
            guild_id, user_id, amount,
        )


async def buy_tickets_with_miles(guild_id: int, user_id: int, count: int, rate: int) -> dict:
    count = max(1, int(count))
    needed = count * rate
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        async with conn.transaction():
            new_miles = await conn.fetchval(
                "UPDATE doumori_miles SET miles = miles - $3 WHERE guild_id = $1 AND user_id = $2 AND miles >= $3 RETURNING miles",
                guild_id, user_id, needed,
            )
            if new_miles is None:
                current = await conn.fetchval("SELECT miles FROM doumori_miles WHERE guild_id = $1 AND user_id = $2", guild_id, user_id)
                return {"success": False, "needed": needed, "current": current or 0}
            new_tickets = await conn.fetchval(
                "INSERT INTO doumori_users (guild_id, user_id, tickets) VALUES ($1, $2, $3) "
                "ON CONFLICT (guild_id, user_id) DO UPDATE SET tickets = doumori_users.tickets + $3 RETURNING tickets",
                guild_id, user_id, count,
            )
    return {"success": True, "spent": needed, "count": count, "new_miles": new_miles, "new_tickets": new_tickets}


async def get_item_count(guild_id: int, user_id: int, item_id: str) -> int:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "SELECT quantity FROM doumori_inventory WHERE guild_id = $1 AND user_id = $2 AND item_id = $3",
            guild_id, user_id, item_id,
        ) or 0


async def add_item(guild_id: int, user_id: int, item_id: str, amount: int) -> int:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO doumori_inventory (guild_id, user_id, item_id, quantity) VALUES ($1, $2, $3, GREATEST(0, $4)) "
            "ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET quantity = GREATEST(0, doumori_inventory.quantity + $4) RETURNING quantity",
            guild_id, user_id, item_id, amount,
        )


async def use_item(guild_id: int, user_id: int, item_id: str) -> bool:
    """道具を1つ消費する。持っていなければ False"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        left = await conn.fetchval(
            "UPDATE doumori_inventory SET quantity = quantity - 1 WHERE guild_id = $1 AND user_id = $2 AND item_id = $3 AND quantity > 0 RETURNING quantity",
            guild_id, user_id, item_id,
        )
    return left is not None


# ───────────────────────── 図鑑 ─────────────────────────

async def record_catch(guild_id: int, user_id: int, category: str, creature_id: str, is_shiny: bool) -> bool:
    """捕獲を記録する。初めての種類なら True"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        count = await conn.fetchval(
            "INSERT INTO doumori_collection (guild_id, user_id, category, creature_id, count, has_shiny) VALUES ($1, $2, $3, $4, 1, $5) "
            "ON CONFLICT (guild_id, user_id, category, creature_id) DO UPDATE SET count = doumori_collection.count + 1, "
            "has_shiny = doumori_collection.has_shiny OR EXCLUDED.has_shiny RETURNING count",
            guild_id, user_id, category, creature_id, is_shiny,
        )
    return count == 1


async def get_collection(guild_id: int, user_id: int, category: str) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM doumori_collection WHERE guild_id = $1 AND user_id = $2 AND category = $3",
            guild_id, user_id, category,
        )
    return [dict(r) for r in rows]


async def take_duplicates(guild_id: int, user_id: int) -> list[dict]:
    """2匹以上いる生き物を1匹だけ残して取り出す（売却用）。取り出した行（元の count 付き）を返す"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "UPDATE doumori_collection c SET count = 1 FROM doumori_collection o "
            "WHERE c.guild_id = $1 AND c.user_id = $2 AND c.count > 1 "
            "AND o.guild_id = c.guild_id AND o.user_id = c.user_id AND o.category = c.category AND o.creature_id = c.creature_id "
            "RETURNING c.category, c.creature_id, c.has_shiny, o.count AS old_count",
            guild_id, user_id,
        )
    return [dict(r) for r in rows]


async def get_leaderboard(guild_id: int) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch(
            "SELECT user_id, COUNT(DISTINCT category || ':' || creature_id) AS caught_types FROM doumori_collection "
            "WHERE guild_id = $1 GROUP BY user_id ORDER BY caught_types DESC LIMIT 10",
            guild_id,
        )
    return [dict(r) for r in rows]


# ───────────────────────── 浮上（VC・チャット）時間 ─────────────────────────

async def add_activity_seconds(guild_id: int, user_id: int, seconds: int, required_seconds: int) -> tuple[int, int]:
    """浮上時間を加算し、必要時間ごとにチケットへ換算する。(今回付与したチケット数, 所持チケット数) を返す"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        async with conn.transaction():
            unclaimed = await conn.fetchval(
                "INSERT INTO doumori_users (guild_id, user_id, vc_total_seconds, vc_unclaimed_seconds) VALUES ($1, $2, $3, $3) "
                "ON CONFLICT (guild_id, user_id) DO UPDATE SET vc_total_seconds = doumori_users.vc_total_seconds + $3, "
                "vc_unclaimed_seconds = doumori_users.vc_unclaimed_seconds + $3 RETURNING vc_unclaimed_seconds",
                guild_id, user_id, seconds,
            )
            if not required_seconds or unclaimed < required_seconds:
                return 0, 0
            given = unclaimed // required_seconds
            total = await conn.fetchval(
                "UPDATE doumori_users SET vc_unclaimed_seconds = $3, tickets = tickets + $4 "
                "WHERE guild_id = $1 AND user_id = $2 RETURNING tickets",
                guild_id, user_id, unclaimed % required_seconds, given,
            )
    return given, total


# ───────────────────────── デイリーミッション ─────────────────────────

def today_key() -> str:
    return datetime.datetime.now(JST).strftime("%Y-%m-%d")


async def get_daily_slot_count(guild_id: int) -> int:
    v = as_int((await get_settings(guild_id)).get("daily_mission_slot_count"), 3)
    return v if 1 <= v <= 30 else 3


async def _active_masters(conn, guild_id: int, rank_level: int) -> list[dict]:
    """有効なミッション（サーバー専用を優先し、無ければ共通テンプレート guild_id = 0）"""
    rows = await conn.fetch(
        "SELECT * FROM doumori_missions_master WHERE guild_id = $1 AND is_active = TRUE AND (target_rank = 0 OR target_rank = $2) ORDER BY id",
        guild_id, rank_level,
    )
    if not rows:
        rows = await conn.fetch(
            "SELECT * FROM doumori_missions_master WHERE guild_id = $1 AND is_active = TRUE ORDER BY id", guild_id,
        )
    if not rows:
        rows = await conn.fetch(
            "SELECT * FROM doumori_missions_master WHERE (guild_id = 0 OR guild_id IS NULL) AND is_active = TRUE "
            "AND (target_rank = 0 OR target_rank = $1) ORDER BY id",
            rank_level,
        )
    masters = [dict(r) for r in rows]
    if not masters:
        masters = [
            {"id": None, "title": "VC交流", "description": "VCに通算30分以上参加する", "reward_miles": 100},
            {"id": None, "title": "雑談チャット", "description": "雑談チャンネルで3回以上メッセージを発言する", "reward_miles": 100},
            {"id": None, "title": "魚釣り挑戦", "description": "`/釣り` で魚を1匹以上釣り上げる", "reward_miles": 100},
        ]
    return masters


async def get_or_create_daily_missions(guild_id: int, user_id: int, rank_level: int = 1) -> list[dict]:
    """本日のデイリーミッション（設定の枠数分。足りない枠はランダムに選んで作る）"""
    date_key = today_key()
    slot_setting = await get_daily_slot_count(guild_id)
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        masters = await _active_masters(conn, guild_id, rank_level)
        target = max(1, min(slot_setting, len(masters)))
        current = [dict(r) for r in await conn.fetch(
            "SELECT * FROM doumori_daily_missions WHERE guild_id = $1 AND user_id = $2 AND date_key = $3 ORDER BY mission_slot",
            guild_id, user_id, date_key,
        )]
        ids = {m["id"] for m in masters if m.get("id")}
        titles = {m["title"] for m in masters}
        outdated = any(
            r["status"] == "pending" and (
                r["mission_slot"] > target
                or (r["mission_id"] and r["mission_id"] not in ids)
                or (not r["mission_id"] and r["mission_title"] not in titles)
            )
            for r in current
        )
        if outdated or len(current) != target:
            # 枠数を超えた・無効になった未報告の枠は作り直す（報告済み・承認済みは残す）
            await conn.execute(
                "DELETE FROM doumori_daily_missions WHERE guild_id = $1 AND user_id = $2 AND date_key = $3 "
                "AND status = 'pending' AND mission_slot > $4",
                guild_id, user_id, date_key, target,
            )
            if outdated or len(current) < target:
                await conn.execute(
                    "DELETE FROM doumori_daily_missions WHERE guild_id = $1 AND user_id = $2 AND date_key = $3 AND status = 'pending'",
                    guild_id, user_id, date_key,
                )

        saved = [dict(r) for r in await conn.fetch(
            "SELECT * FROM doumori_daily_missions WHERE guild_id = $1 AND user_id = $2 AND date_key = $3 AND mission_slot <= $4",
            guild_id, user_id, date_key, target,
        )]
        occupied = {r["mission_slot"] for r in saved}
        used_ids = {r["mission_id"] for r in saved if r["mission_id"]}
        used_titles = {r["mission_title"] for r in saved}
        available = [m for m in masters if m.get("id") not in used_ids and m["title"] not in used_titles]
        random.shuffle(available)
        fallback = masters[:]
        random.shuffle(fallback)

        idx = 0
        for slot in range(1, target + 1):
            if slot in occupied:
                continue
            m = available[idx] if idx < len(available) else fallback[idx % len(fallback)]
            idx += 1
            await conn.execute(
                "INSERT INTO doumori_daily_missions (guild_id, user_id, date_key, mission_slot, mission_id, mission_title, mission_desc, reward_miles, status) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') ON CONFLICT DO NOTHING",
                guild_id, user_id, date_key, slot, m.get("id"), m.get("title") or "デイリーミッション",
                m.get("description") or "ミッションを達成しよう！", m.get("reward_miles") or 100,
            )
            if m.get("id"):
                await conn.execute("UPDATE doumori_missions_master SET times_assigned = times_assigned + 1 WHERE id = $1", m["id"])

        rows = await conn.fetch(
            "SELECT * FROM doumori_daily_missions WHERE guild_id = $1 AND user_id = $2 AND date_key = $3 AND mission_slot <= $4 ORDER BY mission_slot",
            guild_id, user_id, date_key, target,
        )
    return [dict(r) for r in rows]


async def submit_mission_report(guild_id: int, user_id: int, date_key: str, slot: int, proof_url: str):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if slot > 0:
            await conn.execute(
                "UPDATE doumori_daily_missions SET status = 'submitted', proof_url = $1 "
                "WHERE guild_id = $2 AND user_id = $3 AND date_key = $4 AND mission_slot = $5 AND status = 'pending'",
                proof_url, guild_id, user_id, date_key, slot,
            )
        else:
            await conn.execute(
                "UPDATE doumori_daily_missions SET status = 'submitted', proof_url = $1 "
                "WHERE guild_id = $2 AND user_id = $3 AND date_key = $4 AND status = 'pending'",
                proof_url, guild_id, user_id, date_key,
            )


async def approve_missions(guild_id: int, user_id: int, date_key: str, slot: int, staff_id: int) -> dict | None:
    """ミッションを承認してマイルと達成回数を加算する。承認できるものが無ければ None"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        async with conn.transaction():
            if slot > 0:
                rows = await conn.fetch(
                    "UPDATE doumori_daily_missions SET status = 'approved' WHERE guild_id = $1 AND user_id = $2 "
                    "AND date_key = $3 AND mission_slot = $4 AND status <> 'approved' RETURNING *",
                    guild_id, user_id, date_key, slot,
                )
            else:
                rows = await conn.fetch(
                    "UPDATE doumori_daily_missions SET status = 'approved' WHERE guild_id = $1 AND user_id = $2 "
                    "AND date_key = $3 AND status <> 'approved' RETURNING *",
                    guild_id, user_id, date_key,
                )
            if not rows:
                return None
            total = 0
            for m in rows:
                reward = m["reward_miles"] or 100
                total += reward
                if m["mission_id"]:
                    await conn.execute("UPDATE doumori_missions_master SET times_completed = times_completed + 1 WHERE id = $1", m["mission_id"])
                await conn.execute(
                    "INSERT INTO doumori_mission_logs (guild_id, user_id, staff_id, mission_desc, reward_miles, mission_count) "
                    "VALUES ($1, $2, $3, $4, $5, 1)",
                    guild_id, user_id, staff_id, m["mission_desc"] or m["mission_title"], reward,
                )
            updated = await conn.fetchrow(
                "INSERT INTO doumori_miles (guild_id, user_id, miles, rank_level, mission_count, total_mission_count) "
                "VALUES ($1, $2, $3, 1, $4, $4) ON CONFLICT (guild_id, user_id) DO UPDATE SET "
                "miles = doumori_miles.miles + $3, mission_count = COALESCE(doumori_miles.mission_count, 0) + $4, "
                "total_mission_count = COALESCE(doumori_miles.total_mission_count, 0) + $4 "
                "RETURNING miles, rank_level, mission_count, total_mission_count",
                guild_id, user_id, total, len(rows),
            )
    return {"approved_count": len(rows), "reward_miles": total, **dict(updated)}
