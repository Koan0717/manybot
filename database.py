# -*- coding: utf-8 -*-
import asyncpg

import datetime

import os

import asyncio

import json

from dotenv import load_dotenv



load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

JST = datetime.timezone(datetime.timedelta(hours=9))



def get_now_naive() -> datetime.datetime:

    return datetime.datetime.now(JST).replace(tzinfo=None)



# 謗･邯壹・繝ｼ繝ｫ繧剁E晁E縺吶E螟画焁E

# -- NEW POOL LOGIC --

pools = {}

# guild_id -> (database_url or None, 取得時刻)
# ダッシュボードで接続先を変更した場合に再起動なしで反映されるよう、
# 一定時間で自動的に再取得する
guild_to_db = {}

GUILD_DB_CACHE_TTL_SECONDS = 300

master_pool = None

import inspect



class GuildDatabaseUnavailable(Exception):
    """専用DBが設定されているのに接続できない場合に送出する。

    ここでマスターDBにフォールバックしてしまうと、別のDBに対して
    読み書きを行い「データが全部リセットされた」ように見えてしまうため、
    黙って代替せずエラーとして扱う。"""

    def __init__(self, guild_id, original):
        self.guild_id = guild_id
        self.original = original
        super().__init__(
            f"ギルド {guild_id} の専用データベースに接続できません: {original}"
        )



def invalidate_guild_db_cache(guild_id: int = None):
    """接続先のキャッシュを破棄する。guild_id 未指定で全件破棄。"""
    if guild_id is None:
        guild_to_db.clear()
    else:
        guild_to_db.pop(guild_id, None)



async def get_master_pool():

    global master_pool

    if master_pool is None:

        master_pool = await asyncpg.create_pool(DATABASE_URL, statement_cache_size=0, min_size=1, max_size=10)

    return master_pool



async def get_all_configured_pools():

    p = await get_master_pool()

    try:

        urls = await p.fetch("SELECT DISTINCT database_url FROM guild_databases")

        all_pools = [p]

        for r in urls:

            url = r['database_url']

            if not url:

                continue

            try:

                if url not in pools:

                    pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)

                if pools[url] not in all_pools:

                    all_pools.append(pools[url])

            except Exception as e:

                print(f"❁E[DB Error] Supabase (専用DB) への接続に失敗しました ({url}): {e}")

        return all_pools

    except asyncpg.exceptions.UndefinedTableError:

        return [p]



def _normalize_db_url(val):
    """空文字や空白だけのURLは「専用DB未設定」として扱う。

    ダッシュボードから空文字が保存されてしまうと、専用DBを指していたはずの
    ギルドが黙ってマスターDBに切り替わるため、ここで None に正規化する。"""
    if val is None:
        return None
    val = str(val).strip()
    return val or None



async def get_guild_db_url(guild_id: int):

    cached = guild_to_db.get(guild_id)

    if cached is not None:

        url, fetched_at = cached

        if (datetime.datetime.now() - fetched_at).total_seconds() < GUILD_DB_CACHE_TTL_SECONDS:

            return url

    p = await get_master_pool()

    try:

        val = await p.fetchval("SELECT database_url FROM guild_databases WHERE guild_id = $1", guild_id)

        val = _normalize_db_url(val)

        guild_to_db[guild_id] = (val, datetime.datetime.now())

        return val

    except asyncpg.exceptions.UndefinedTableError:

        return None



async def set_guild_db_url(guild_id: int, url: str):

    p = await get_master_pool()

    if url:

        await p.execute("""

            INSERT INTO guild_databases (guild_id, database_url) 

            VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url

        """, guild_id, url)

        guild_to_db[guild_id] = (_normalize_db_url(url), datetime.datetime.now())

        new_pool = await get_pool(guild_id)

        await setup_db_schema(new_pool)

    else:

        await p.execute("DELETE FROM guild_databases WHERE guild_id = $1", guild_id)

        guild_to_db[guild_id] = (None, datetime.datetime.now())



async def get_pool(guild_id: int = None):

    if guild_id is None:

        try:

            import sys

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



    if guild_id:

        url = await get_guild_db_url(guild_id)

        if url:

            try:

                if url not in pools:

                    pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)

                return pools[url]

            except Exception as e:

                print(f"[DB Error] Supabase (専用DB) への接続に失敗しました (ギルドID: {guild_id}): {e}")

                # マスターDBで代替すると、そのギルドのデータが空に見えたうえで
                # 新しいデータが別のDBに書き込まれてしまう。データを分裂させない
                # ため、フォールバックせずエラーにする
                raise GuildDatabaseUnavailable(guild_id, e) from e

    return await get_master_pool()



class _ResilientConn:
    """
    setup_db_schema() は数十個E CREATE TABLE / ALTER TABLE を頁Eに実行するが、E
    途中の1斁E例外を投げると(型不一致・ロチE・権限エラーなど)、後続E
    チEEブル作EめEラム追加マイグレーションが一刁E行されずに関数全体が
    そこで止まってしまぁE題があった、E

    こEラチEーは conn.execute() の呼び出しだけを横取りし、失敗してめE
    警告を出して次の斁E進めるようにする。setup_db_schema() 本体ESQLは
    一刁E更せず、安E性だけを底上げする、E
    """

    def __init__(self, conn):
        self._conn = conn

    async def execute(self, query, *args, **kwargs):
        try:
            return await self._conn.execute(query, *args, **kwargs)
        except Exception as e:
            preview = " ".join(query.split())[:100]
            print(f"[Schema] Statement failed, continuing with next: {preview}... ({e})")
            return None

    def __getattr__(self, name):
        return getattr(self._conn, name)


async def setup_db_schema(p):

    async with p.acquire() as raw_conn:

        conn = _ResilientConn(raw_conn)

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS users (

                guild_id BIGINT,

                user_id BIGINT,

                PRIMARY KEY (guild_id, user_id),

                balance INTEGER DEFAULT 0,

                last_daily TIMESTAMP,

                chinchiro_count INTEGER DEFAULT 0,

                chinchiro_last_date TEXT,

                chinchiro_daily_bet INTEGER DEFAULT 0,

                tc_xp INTEGER DEFAULT 0,

                tc_level INTEGER DEFAULT 1,

                vc_xp INTEGER DEFAULT 0,

                vc_level INTEGER DEFAULT 1,

                evaluation_vc_time INTEGER DEFAULT 0,

                initial_issued BOOLEAN DEFAULT FALSE,

                event_points INTEGER DEFAULT 0

            )

        ''')

        # 送金履歴（/pay・アクティビティ・Webの送金）。ダッシュボードのメンバー画面で直近の送金を表示する

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS transfer_logs (

                id BIGSERIAL PRIMARY KEY,

                guild_id BIGINT NOT NULL,

                sender_id BIGINT NOT NULL,

                receiver_id BIGINT NOT NULL,

                amount BIGINT NOT NULL,

                source TEXT NOT NULL DEFAULT 'pay',

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

            )

        ''')

        await conn.execute('CREATE INDEX IF NOT EXISTS idx_transfer_logs_sender ON transfer_logs (guild_id, sender_id, created_at DESC)')

        await conn.execute('CREATE INDEX IF NOT EXISTS idx_transfer_logs_receiver ON transfer_logs (guild_id, receiver_id, created_at DESC)')

        # ロールの付け外しの履歴（cogs/role_history.py）。ダッシュボードの「役職」タブで付与日を表示する

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS role_history (

                id BIGSERIAL PRIMARY KEY,

                guild_id BIGINT NOT NULL,

                user_id BIGINT NOT NULL,

                role_id BIGINT NOT NULL,

                role_name TEXT,

                action TEXT NOT NULL,

                source TEXT NOT NULL DEFAULT 'bot',

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

            )

        ''')

        await conn.execute('CREATE INDEX IF NOT EXISTS idx_role_history_user ON role_history (guild_id, user_id, created_at DESC)')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS rooms (

                channel_id BIGINT PRIMARY KEY,

                owner_id BIGINT,

                room_type TEXT,

                expire_at TIMESTAMP,

                guild_id BIGINT

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS evaluation_periods (

                guild_id BIGINT,

                user_id BIGINT,

                PRIMARY KEY (guild_id, user_id),

                start_time TIMESTAMP,

                end_time TIMESTAMP

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS auto_vc_triggers (

                channel_id BIGINT PRIMARY KEY

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS auto_vc_config (

                channel_id BIGINT PRIMARY KEY,

                base_name TEXT DEFAULT '',

                allow_rename BOOLEAN DEFAULT TRUE,

                include_owner_name BOOLEAN DEFAULT TRUE,

                use_numbering BOOLEAN DEFAULT FALSE,

                allow_limit_change BOOLEAN DEFAULT TRUE,

                show_panel BOOLEAN DEFAULT TRUE,

                is_invite_only BOOLEAN DEFAULT FALSE,

                invite_visible_role_ids BIGINT[] DEFAULT '{}',

                allowed_role_ids BIGINT[] DEFAULT '{}'

            )

        ''')

        # VCトリガーで作ったVCで画面共有を許可するか（ダッシュボードのVCトリガー設定）

        await conn.execute('ALTER TABLE auto_vc_config ADD COLUMN IF NOT EXISTS allow_stream BOOLEAN DEFAULT TRUE')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS inquiry_panels (

                channel_id BIGINT PRIMARY KEY,

                mention_role_id BIGINT,

                mention_role_ids BIGINT[]

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS bot_settings (

                guild_id BIGINT,

                setting_key TEXT,

                setting_value TEXT,

                PRIMARY KEY (guild_id, setting_key)

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS antigrief_settings (

                guild_id BIGINT PRIMARY KEY,

                target_category_ids BIGINT[],

                target_channel_ids BIGINT[],

                exempt_role_ids BIGINT[]

            )

        ''')

        try:

            await conn.execute('ALTER TABLE inquiry_panels ADD COLUMN IF NOT EXISTS mention_role_ids BIGINT[]')

        except Exception as e:

            print(f"[Migration] inquiry_panels migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE anonymous_chats ADD COLUMN IF NOT EXISTS panel_channel_id BIGINT')
            await conn.execute('ALTER TABLE anonymous_chats ADD COLUMN IF NOT EXISTS dest_channel_id BIGINT')
            # ダチEュボEチENext.js)側が過去に channel_id/guild_id とぁE別スキーマで
            # こEチEEブルをEに作ってしまってぁEケースがあり、その場吁E
            # panel_channel_id には一意制紁E付いてぁEぁEめE
            # INSERT ... ON CONFLICT (panel_channel_id) が失敗する。ここで補強する、E
            try:
                await conn.execute('ALTER TABLE anonymous_chats ADD CONSTRAINT anonymous_chats_panel_channel_id_key UNIQUE (panel_channel_id)')
            except Exception:
                pass  # 既に制紁Eある場合EそEまま無要E

        except Exception as e:

            print(f"[Migration] anonymous_chats migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS trigger_channel_id BIGINT')

        except Exception as e:

            print(f"[Migration] rooms migration warning: {e}")



        try:

            await conn.execute('''

                CREATE TABLE IF NOT EXISTS deleted_user_data (

                    guild_id BIGINT,

                    user_id BIGINT,

                    balance BIGINT DEFAULT 0,

                    tc_xp INTEGER DEFAULT 0,

                    tc_level INTEGER DEFAULT 1,

                    vc_xp INTEGER DEFAULT 0,

                    vc_level INTEGER DEFAULT 1,

                    evaluation_vc_time INTEGER DEFAULT 0,

                    event_points INTEGER DEFAULT 0,

                    initial_issued BOOLEAN DEFAULT FALSE,

                    deleted_at TIMESTAMP,

                    PRIMARY KEY (guild_id, user_id)

                )

            ''')

        except Exception as e:

            print(f"[Migration] deleted_user_data migration warning: {e}")



        try:

            # 複数ギルドが同一DBを共有する構成では guild_id が無いと
            # 「他サーバーで作った部屋」まで重複判定に引っかかってしまうため追加
            await conn.execute('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS guild_id BIGINT')

            await conn.execute('CREATE INDEX IF NOT EXISTS rooms_owner_guild_idx ON rooms (owner_id, guild_id)')

        except Exception as e:

            print(f"[Migration] rooms guild_id migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE auto_vc_config ADD COLUMN IF NOT EXISTS show_panel BOOLEAN DEFAULT TRUE')

        except Exception as e:

            print(f"[Migration] auto_vc_config migration warning: {e}")



        try:
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS guild_id BIGINT')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_count INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_last_date TEXT')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_daily_bet INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS tc_xp INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS tc_level INTEGER DEFAULT 1')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS vc_xp INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS vc_level INTEGER DEFAULT 1')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS evaluation_vc_time INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_issued BOOLEAN DEFAULT FALSE')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS event_points INTEGER DEFAULT 0')
            await conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_guild_user_idx ON users (guild_id, user_id)')
        except Exception as e:
            print(f"[Migration] users migration warning: {e}")

        try:
            await conn.execute('ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_category_ids BIGINT[] DEFAULT \'{}\'')
            await conn.execute('ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_channel_ids BIGINT[] DEFAULT \'{}\'')
            await conn.execute('ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS exempt_role_ids BIGINT[] DEFAULT \'{}\'')
        except Exception as e:
            print(f"[Migration] antigrief_settings migration warning: {e}")

        try:
            await conn.execute('ALTER TABLE level_role_rewards ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL')
            await conn.execute('ALTER TABLE level_role_rewards DROP CONSTRAINT IF EXISTS level_role_rewards_pkey')
            await conn.execute('ALTER TABLE level_role_rewards ADD PRIMARY KEY (guild_id, level_type, level, role_id, condition_role_id)')
        except Exception as e:
            print(f"[Migration] level_role_rewards condition_role_id migration warning: {e}")

        try:
            await conn.execute('ALTER TABLE level_coin_rewards ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL')
            await conn.execute('ALTER TABLE level_coin_rewards DROP CONSTRAINT IF EXISTS level_coin_rewards_pkey')
            await conn.execute('ALTER TABLE level_coin_rewards ADD PRIMARY KEY (guild_id, level_type, level, condition_role_id)')
        except Exception as e:
            print(f"[Migration] level_coin_rewards condition_role_id migration warning: {e}")







        await conn.execute('''
            CREATE TABLE IF NOT EXISTS call_board_settings (
                guild_id BIGINT PRIMARY KEY,
                panel_channel_id BIGINT,
                board_channel_id BIGINT,
                vc_category_id BIGINT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        await conn.execute('''
            CREATE TABLE IF NOT EXISTS gacha_settings (
                guild_id BIGINT PRIMARY KEY,
                allowed_role_ids BIGINT[] DEFAULT '{}',
                pull_cost INTEGER DEFAULT 0,
                is_enabled BOOLEAN DEFAULT TRUE,
                panel_channel_id BIGINT DEFAULT NULL
            )
        ''')

        await conn.execute('''
            CREATE TABLE IF NOT EXISTS gacha_prizes (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                prize_number INTEGER NOT NULL,
                prize_name TEXT NOT NULL,
                weight INTEGER NOT NULL DEFAULT 1,
                reward_coins INTEGER DEFAULT 0,
                reward_role_id BIGINT,
                reward_role_duration_days INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        await conn.execute('''
            CREATE TABLE IF NOT EXISTS gacha_user_roles (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                role_id BIGINT NOT NULL,
                prize_id INTEGER,
                expires_at TIMESTAMP NOT NULL,
                role_removed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        await conn.execute('''
            CREATE TABLE IF NOT EXISTS gacha_history (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                prize_id INTEGER,
                prize_number INTEGER,
                prize_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS level_role_rewards (

                guild_id BIGINT,

                level_type VARCHAR(10),

                level INTEGER,

                role_id BIGINT,

                condition_role_id BIGINT DEFAULT NULL,

                PRIMARY KEY (guild_id, level_type, level, role_id, condition_role_id)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS room_prices (

                room_type VARCHAR(20),

                duration INTEGER,

                price INTEGER,

                PRIMARY KEY (room_type, duration)

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS room_panels (

                guild_id BIGINT,

                channel_id BIGINT,

                message_id BIGINT,

                panel_type VARCHAR(50) DEFAULT 'inn',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                PRIMARY KEY (guild_id, panel_type)

            )

        ''')



        await conn.execute('''

            INSERT INTO room_prices (room_type, duration, price) VALUES

            ('螳E', 12, 10000),

            ('螳E', 24, 15000),

            ('鬮倡E壼EE', 12, 150000),

            ('鬮倡E壼EE', 24, 250000),

            ('繧E繧E繧E繝VC', 24, 30000),

            ('繧E繝ｼ繝VC', 12, 10000),

            ('繧E繝ｼ繝VC', 24, 15000),

            ('雉ｭ蜊啖C', 12, 10000),

            ('雉ｭ蜊啖C', 24, 15000)

            ON CONFLICT (room_type, duration) DO NOTHING

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS role_room_prices (

                role_key TEXT NOT NULL,

                room_type TEXT NOT NULL,

                duration INTEGER NOT NULL,

                price INTEGER NOT NULL,

                PRIMARY KEY (role_key, room_type, duration)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS anonymous_chats (

                panel_channel_id BIGINT PRIMARY KEY,

                dest_channel_id BIGINT

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS custom_ticket_panels (

                channel_id BIGINT PRIMARY KEY,

                panel_title TEXT NOT NULL,

                panel_description TEXT NOT NULL,

                button_label TEXT NOT NULL,

                button_emoji TEXT,

                mention_role_ids BIGINT[] NOT NULL,

                target_role_ids BIGINT[] NOT NULL,

                ticket_prefix TEXT NOT NULL,

                panel_type TEXT DEFAULT 'custom_ticket'

            )

        ''')

        try:

            await conn.execute("ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS button_label TEXT DEFAULT '繝Eこ繝Eヨ繧剁E懈E縺吶EE")

            await conn.execute("ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS button_emoji TEXT")

            await conn.execute("ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS target_role_ids BIGINT[] DEFAULT '{}'::BIGINT[]")

            await conn.execute("ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS ticket_prefix TEXT DEFAULT 'ticket'")

            await conn.execute("ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS panel_type TEXT DEFAULT 'custom_ticket'")

        except Exception as e:

            print(f"[Migration] custom_ticket_panels migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS panel_requests (

                id SERIAL PRIMARY KEY,

                guild_id BIGINT,

                channel_id BIGINT,

                panel_type VARCHAR(50),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS log_settings (

                guild_id BIGINT,

                log_type VARCHAR(50),

                channel_id BIGINT,

                is_enabled BOOLEAN DEFAULT TRUE,

                PRIMARY KEY (guild_id, log_type)

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS evaluation_settings (

                guild_id BIGINT PRIMARY KEY,

                forum_channel_ids BIGINT[],

                self_intro_channel_ids BIGINT[]

            )

        ''')

        try:

            await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS forum_channel_ids BIGINT[] DEFAULT \'{}\'')

            await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS self_intro_channel_ids BIGINT[] DEFAULT \'{}\'')

            await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE')

            await conn.execute('ALTER TABLE log_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE')

            await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS auto_generate_period BOOLEAN DEFAULT TRUE')

            await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS auto_fail_on_deadline BOOLEAN DEFAULT FALSE')

            await conn.execute("ALTER TABLE auto_vc_config ADD COLUMN IF NOT EXISTS is_invite_only BOOLEAN DEFAULT FALSE")

            await conn.execute("ALTER TABLE auto_vc_config ADD COLUMN IF NOT EXISTS invite_visible_role_ids BIGINT[] DEFAULT '{}'")

            await conn.execute("ALTER TABLE auto_vc_config ADD COLUMN IF NOT EXISTS allowed_role_ids BIGINT[] DEFAULT '{}'")

            # evaluation_periods カラム移行 (start_date/end_date -> start_time/end_time, member_id/target_id -> user_id)
            eval_period_renames = [
                ("start_date", "start_time"),
                ("end_date", "end_time"),
                ("member_id", "user_id"),
                ("target_user_id", "user_id"),
                ("target_id", "user_id"),
                ("server_id", "guild_id"),
            ]
            for old_col, new_col in eval_period_renames:
                try:
                    await conn.execute(f'ALTER TABLE evaluation_periods RENAME COLUMN {old_col} TO {new_col}')
                except Exception:
                    pass

            try:
                await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS guild_id BIGINT')
                await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS user_id BIGINT')
                await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS start_time TIMESTAMP')
                await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS end_time TIMESTAMP')
            except Exception:
                pass

            # user_evaluations カラム移行
            eval_user_renames = [
                ("user_id", "target_user_id"),
                ("member_id", "target_user_id"),
            ]
            for old_col, new_col in eval_user_renames:
                try:
                    await conn.execute(f'ALTER TABLE user_evaluations RENAME COLUMN {old_col} TO {new_col}')
                except Exception:
                    pass

        except Exception as e:

            print(f"[Migration] evaluation_settings migration warning: {e}")

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS rank_settings (

                guild_id BIGINT PRIMARY KEY,

                whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',

                blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',

                whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}',

                blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}',

                enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE,

                exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}'

            )

        ''')

        try:

            try:

                await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE')

            except Exception as e:

                pass

            try:

                await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT \'{}\'')

            except Exception as e:

                pass

            try:

                await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS ephemeral_rank_commands BOOLEAN NOT NULL DEFAULT FALSE')

            except Exception as e:

                pass

            await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids BIGINT[] NOT NULL DEFAULT \'{}\'')

        except Exception as e:

            print(f"[Migration] rank_settings migration warning: {e}")

        try:

            await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS blacklist_category_ids BIGINT[] NOT NULL DEFAULT \'{}\'')

        except Exception as e:

            print(f"[Migration] rank_settings migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS vc_coins_settings (

                guild_id BIGINT PRIMARY KEY,

                is_enabled BOOLEAN NOT NULL DEFAULT FALSE,

                whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',

                blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',

                whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}',

                blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}',

                enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE,

                exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}',

                use_common_reward BOOLEAN NOT NULL DEFAULT TRUE,

                role_scope_per_rule BOOLEAN NOT NULL DEFAULT FALSE,

                stack_multiple_roles BOOLEAN NOT NULL DEFAULT FALSE,

                common_reward_amount INT NOT NULL DEFAULT 100,

                common_reward_interval INT NOT NULL DEFAULT 10

            )

        ''')

        try:
            await conn.execute('ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE')
        except Exception:
            pass

        for _col_sql in [
            "ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS use_common_reward BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS role_scope_per_rule BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS stack_multiple_roles BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS common_reward_amount INT NOT NULL DEFAULT 100",
            "ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS common_reward_interval INT NOT NULL DEFAULT 10",
        ]:
            try:
                await conn.execute(_col_sql)
            except Exception:
                pass

        await conn.execute('''
            CREATE TABLE IF NOT EXISTS vc_coins_role_rewards (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                role_id BIGINT NOT NULL,
                reward_amount INT NOT NULL DEFAULT 100,
                reward_interval INT NOT NULL DEFAULT 10,
                is_whitelist_mode BOOLEAN NOT NULL DEFAULT TRUE,
                whitelist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
                blacklist_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
                whitelist_category_ids BIGINT[] NOT NULL DEFAULT '{}',
                blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}'
            )
        ''')



        try:

            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_issued BOOLEAN DEFAULT FALSE')

        except Exception as e:

            print(f"[Migration] users initial_issued migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS evaluation_vc_time INTEGER DEFAULT 0')

        except Exception as e:

            print(f"[Migration] users evaluation_vc_time migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS interviewer_logs (

                interviewer_id BIGINT,

                target_user_id BIGINT,

                guild_id BIGINT,

                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

                PRIMARY KEY (interviewer_id, target_user_id)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS interviewer_stats (

                guild_id BIGINT,

                interviewer_id BIGINT,

                total_handled INTEGER DEFAULT 0,

                PRIMARY KEY (guild_id, interviewer_id)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS user_evaluations (

                id SERIAL PRIMARY KEY,

                guild_id BIGINT,

                target_user_id BIGINT,

                evaluator_id BIGINT,

                result TEXT,

                created_at TIMESTAMP

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS reaction_roles (

                message_id BIGINT,

                emoji TEXT,

                role_id BIGINT,

                PRIMARY KEY (message_id, emoji)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS user_vc_durations (

                guild_id BIGINT,

                user_id BIGINT,

                category_id BIGINT,

                duration_seconds INTEGER DEFAULT 0,

                PRIMARY KEY (guild_id, user_id, category_id)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS sticky_templates (

                channel_id BIGINT PRIMARY KEY,

                title TEXT,

                content TEXT,

                last_message_id BIGINT

            )

        ''')

        try:

            await conn.execute('ALTER TABLE sticky_templates ADD COLUMN IF NOT EXISTS title TEXT')
            await conn.execute('ALTER TABLE sticky_templates ADD COLUMN IF NOT EXISTS content TEXT')
            await conn.execute('ALTER TABLE sticky_templates ADD COLUMN IF NOT EXISTS last_message_id BIGINT')
            await conn.execute('ALTER TABLE sticky_templates ADD COLUMN IF NOT EXISTS last_text_message_id BIGINT')

        except Exception as e:

            print(f"[Migration] sticky_templates migration warning: {e}")





        await conn.execute('''

            CREATE TABLE IF NOT EXISTS shop_settings (

                guild_id BIGINT PRIMARY KEY,

                employee_role_id BIGINT,

                manager_role_id BIGINT,

                inquiry_mention_role_id BIGINT,

                inquiry_mention_role_ids BIGINT[] DEFAULT '{}'

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS shop_items (

                item_id SERIAL PRIMARY KEY,

                guild_id BIGINT,

                name TEXT,

                usage TEXT,

                price INTEGER DEFAULT 0,

                target_role_id BIGINT,

                reward_role_id BIGINT

            )

        ''')

        

        try:

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS target_role_id BIGINT')

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS reward_role_id BIGINT')

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS target_role_ids BIGINT[] DEFAULT \'{}\'')

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS reward_role_ids BIGINT[] DEFAULT \'{}\'')

            # Migrate existing data

            await conn.execute("UPDATE shop_items SET target_role_ids = ARRAY[target_role_id] WHERE target_role_id IS NOT NULL AND (target_role_ids IS NULL OR target_role_ids = '{}')")

            await conn.execute("UPDATE shop_items SET reward_role_ids = ARRAY[reward_role_id] WHERE reward_role_id IS NOT NULL AND (reward_role_ids IS NULL OR reward_role_ids = '{}')")

        except Exception as e:

            print(f"[Migration] shop_items migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS inquiry_mention_role_id BIGINT')

            await conn.execute('ALTER TABLE shop_settings ADD COLUMN IF NOT EXISTS inquiry_mention_role_ids BIGINT[] DEFAULT \'{}\'')

            await conn.execute("UPDATE shop_settings SET inquiry_mention_role_ids = ARRAY[inquiry_mention_role_id] WHERE inquiry_mention_role_id IS NOT NULL AND (inquiry_mention_role_ids IS NULL OR inquiry_mention_role_ids = '{}')")

        except Exception as e:

            print(f"[Migration] shop_settings inquiry_mention_role_ids migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS user_items (

                id SERIAL PRIMARY KEY,

                guild_id BIGINT,

                user_id BIGINT,

                item_id INTEGER,

                purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

            )

        ''')

        # 購入品の有効期限（add_user_item / get_expired_user_items が使う列）

        await conn.execute('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS expire_at TIMESTAMP')

        await conn.execute('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS role_removed BOOLEAN DEFAULT FALSE')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS level_coin_rewards (

                guild_id BIGINT,

                level_type VARCHAR(10),

                level INTEGER,

                coins INTEGER,

                condition_role_id BIGINT DEFAULT NULL,

                PRIMARY KEY (guild_id, level_type, level, condition_role_id)

            )

        ''')



        try:

            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS event_points INTEGER DEFAULT 0')

        except Exception as e:

            print(f"[Migration] users event_points migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS available_commands (

                command_name TEXT PRIMARY KEY,

                description TEXT,

                category TEXT

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS command_settings (

                guild_id BIGINT,

                command_name TEXT,

                is_enabled BOOLEAN,

                PRIMARY KEY (guild_id, command_name)

            )

        ''')



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS self_intro_role_settings (

                guild_id            BIGINT PRIMARY KEY,

                channel_id          BIGINT,

                welcome_channel_id  BIGINT,

                role_id             BIGINT,

                template            TEXT,

                is_enabled          BOOLEAN DEFAULT TRUE

            )

        ''')

        # 自己紹介チャンネルを複数設定できるようにする（channel_id は1つ目。以前の設定との互換用）

        await conn.execute("ALTER TABLE self_intro_role_settings ADD COLUMN IF NOT EXISTS channel_ids BIGINT[] DEFAULT '{}'")

        # チャンネルごとの追加ロール

        await conn.execute("ALTER TABLE self_intro_role_settings ADD COLUMN IF NOT EXISTS channel_roles_enabled BOOLEAN DEFAULT FALSE")

        await conn.execute("ALTER TABLE self_intro_role_settings ADD COLUMN IF NOT EXISTS channel_roles JSONB DEFAULT '[]'::jsonb")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS self_intro_welcome_messages (

                guild_id    BIGINT,

                user_id     BIGINT,

                message_id  BIGINT,

                channel_id  BIGINT,

                PRIMARY KEY (guild_id, user_id)

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS user_game_stats (

                guild_id     BIGINT,

                user_id      BIGINT,

                game_type    TEXT,

                plays        INTEGER DEFAULT 0,

                wins         INTEGER DEFAULT 0,

                losses       INTEGER DEFAULT 0,

                draws        INTEGER DEFAULT 0,

                total_bet    BIGINT DEFAULT 0,

                total_payout BIGINT DEFAULT 0,

                net_profit   BIGINT DEFAULT 0,

                max_win      BIGINT DEFAULT 0,

                extra_data   JSONB DEFAULT '{}'::jsonb,

                updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                PRIMARY KEY (guild_id, user_id, game_type)

            )

        ''')

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS invite_issuers (

                guild_id   BIGINT,

                code       TEXT,

                issuer_id  BIGINT NOT NULL,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                PRIMARY KEY (guild_id, code)

            )

        ''')

        try:
            await conn.execute('ALTER TABLE gacha_prizes ADD COLUMN IF NOT EXISTS reward_role_duration_days INTEGER DEFAULT 0')
        except Exception as e:
            print(f"[Migration] gacha_prizes reward_role_duration_days warning: {e}")

        try:
            await conn.execute('ALTER TABLE gacha_settings ADD COLUMN IF NOT EXISTS panel_channel_id BIGINT DEFAULT NULL')
        except Exception as e:
            print(f"[Migration] gacha_settings panel_channel_id warning: {e}")




def mask_db_url(url: str) -> str:
    """パスワードを伏せた接続先の表示用文字列を返す。"""
    if not url:
        return "(未設定)"
    try:
        head, _, tail = str(url).partition("@")
        if not tail:
            return "(設定あり)"
        scheme, _, creds = head.partition("://")
        user = creds.split(":")[0] if creds else "?"
        return f"{scheme}://{user}:****@{tail}"
    except Exception:
        return "(設定あり)"


async def _count_guild_data(conn, guild_id: int) -> dict:
    """1つの接続について、そのギルドのユーザーデータ件数を数える。"""
    out = {"users": None, "active": None, "error": None}
    try:
        out["users"] = await conn.fetchval(
            'SELECT COUNT(*) FROM users WHERE guild_id = $1', guild_id
        )
        out["active"] = await conn.fetchval(
            """SELECT COUNT(*) FROM users
               WHERE guild_id = $1
                 AND (COALESCE(tc_xp,0) > 0 OR COALESCE(vc_xp,0) > 0
                      OR COALESCE(tc_level,1) > 1 OR COALESCE(vc_level,1) > 1
                      OR COALESCE(balance,0) > 0)""",
            guild_id
        )
    except Exception as e:
        out["error"] = str(e)
    return out


async def diagnose_guild_database(guild_id: int, refresh: bool = False) -> dict:
    """このギルドのデータがどのDBに入っているかを診断する。

    「ランクが全部リセットされた」という症状の大半は、データが消えたのではなく
    参照先のDBが切り替わっていることが原因なので、両方のDBの件数を突き合わせる。
    """
    if refresh:
        invalidate_guild_db_cache(guild_id)

    result = {
        "guild_id": guild_id,
        "raw_url": None,          # guild_databases に保存されている生の値
        "url_is_blank": False,    # 空文字が保存されている(設定が消えた状態)
        "has_row": False,         # guild_databases に行があるか
        "dedicated_ok": None,     # 専用DBに接続できたか (None = 専用DB未設定)
        "dedicated_error": None,
        "using": "master",        # 実際に読み書きしているDB
        "master": {},
        "dedicated": {},
    }

    master = await get_master_pool()

    try:
        row = await master.fetchrow(
            "SELECT database_url FROM guild_databases WHERE guild_id = $1", guild_id
        )
        if row is not None:
            result["has_row"] = True
            result["raw_url"] = row["database_url"]
            result["url_is_blank"] = _normalize_db_url(row["database_url"]) is None
    except Exception as e:
        result["dedicated_error"] = f"guild_databases の読み取りに失敗: {e}"

    async with master.acquire() as conn:
        result["master"] = await _count_guild_data(conn, guild_id)

    url = _normalize_db_url(result["raw_url"])
    if url:
        conn = None
        try:
            conn = await asyncpg.connect(url, statement_cache_size=0, timeout=10)
            result["dedicated_ok"] = True
            result["using"] = "dedicated"
            result["dedicated"] = await _count_guild_data(conn, guild_id)
        except Exception as e:
            result["dedicated_ok"] = False
            result["dedicated_error"] = str(e)
        finally:
            if conn is not None:
                try:
                    await conn.close()
                except Exception:
                    pass

    return result


# 分裂したデータを突き合わせるときに比較するカラム
_MERGE_FIELDS = [
    "balance", "tc_xp", "tc_level", "vc_xp", "vc_level",
    "evaluation_vc_time", "event_points",
]


async def _fetch_guild_users(conn, guild_id: int) -> dict:
    """1つの接続から、そのギルドのユーザーデータを user_id 辞書で取得する。"""
    cols = ", ".join(_MERGE_FIELDS)
    rows = await conn.fetch(
        f'SELECT user_id, {cols}, initial_issued FROM users WHERE guild_id = $1',
        guild_id
    )
    out = {}
    for r in rows:
        d = {f: (r[f] or 0) for f in _MERGE_FIELDS}
        d["initial_issued"] = bool(r["initial_issued"])
        out[r["user_id"]] = d
    return out


async def _open_dedicated_conn(guild_id: int):
    """診断・統合用に、専用DBへの一時接続を開く。専用DB未設定なら None。"""
    master = await get_master_pool()
    raw = await master.fetchval(
        "SELECT database_url FROM guild_databases WHERE guild_id = $1", guild_id
    )
    url = _normalize_db_url(raw)
    if not url:
        return None
    return await asyncpg.connect(url, statement_cache_size=0, timeout=15)


async def compare_guild_databases(guild_id: int) -> dict:
    """マスターDBと専用DBのユーザーデータを突き合わせる（読み取りのみ）。

    どちらのDBが新しいかを判断するための材料を返す。
    """
    result = {
        "ok": False, "error": None,
        "master_only": 0, "dedicated_only": 0, "both": 0,
        "master_ahead": 0, "dedicated_ahead": 0, "mixed": 0, "same": 0,
        "totals": {"master": {}, "dedicated": {}},
        "samples": [],
    }

    dedicated = None
    try:
        dedicated = await _open_dedicated_conn(guild_id)
        if dedicated is None:
            result["error"] = "専用DBが設定されていないため比較できません。"
            return result

        master_pool = await get_master_pool()
        async with master_pool.acquire() as mconn:
            m = await _fetch_guild_users(mconn, guild_id)
        d = await _fetch_guild_users(dedicated, guild_id)
    except Exception as e:
        result["error"] = str(e)
        return result
    finally:
        if dedicated is not None:
            try:
                await dedicated.close()
            except Exception:
                pass

    for label, data in (("master", m), ("dedicated", d)):
        result["totals"][label] = {f: sum(u[f] for u in data.values()) for f in _MERGE_FIELDS}
        result["totals"][label]["users"] = len(data)

    result["master_only"] = len(set(m) - set(d))
    result["dedicated_only"] = len(set(d) - set(m))
    common = set(m) & set(d)
    result["both"] = len(common)

    diffs = []
    for uid in common:
        mu, du = m[uid], d[uid]
        m_bigger = [f for f in _MERGE_FIELDS if mu[f] > du[f]]
        d_bigger = [f for f in _MERGE_FIELDS if du[f] > mu[f]]
        if not m_bigger and not d_bigger:
            result["same"] += 1
            continue
        if m_bigger and not d_bigger:
            result["master_ahead"] += 1
        elif d_bigger and not m_bigger:
            result["dedicated_ahead"] += 1
        else:
            result["mixed"] += 1
        gap = sum(abs(mu[f] - du[f]) for f in _MERGE_FIELDS)
        diffs.append((gap, uid, mu, du))

    diffs.sort(reverse=True, key=lambda x: x[0])
    for gap, uid, mu, du in diffs[:5]:
        result["samples"].append({
            "user_id": uid,
            "master": {f: mu[f] for f in _MERGE_FIELDS},
            "dedicated": {f: du[f] for f in _MERGE_FIELDS},
        })

    result["ok"] = True
    return result


_MERGE_BACKUP_DDL = """
    CREATE TABLE IF NOT EXISTS merge_backup_users (
        backup_at TIMESTAMP,
        guild_id BIGINT,
        user_id BIGINT,
        balance BIGINT,
        tc_xp INTEGER,
        tc_level INTEGER,
        vc_xp INTEGER,
        vc_level INTEGER,
        evaluation_vc_time INTEGER,
        event_points INTEGER,
        initial_issued BOOLEAN
    )
"""

_MERGE_BACKUP_INSERT = """
    INSERT INTO merge_backup_users
        (backup_at, guild_id, user_id, balance, tc_xp, tc_level, vc_xp,
         vc_level, evaluation_vc_time, event_points, initial_issued)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
"""

_MERGE_UPSERT = """
    INSERT INTO users
        (guild_id, user_id, balance, tc_xp, tc_level, vc_xp, vc_level,
         evaluation_vc_time, event_points, initial_issued)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
        balance = EXCLUDED.balance,
        tc_xp = EXCLUDED.tc_xp,
        tc_level = EXCLUDED.tc_level,
        vc_xp = EXCLUDED.vc_xp,
        vc_level = EXCLUDED.vc_level,
        evaluation_vc_time = EXCLUDED.evaluation_vc_time,
        event_points = EXCLUDED.event_points,
        initial_issued = EXCLUDED.initial_issued
"""


async def merge_guild_databases(guild_id: int, strategy: str = "max", dry_run: bool = True) -> dict:
    """分裂したデータを、現在使っているDB（専用DB）に統合する。

    strategy:
      max       ... 項目ごとに大きい方を採用する（誰のランクも下がらない）
      master    ... マスターDBの値を優先する
      dedicated ... 専用DBの値を優先し、欠けている人だけ取り込む

    dry_run=True のときは書き込まず、変更内容の集計だけを返す。
    書き込む場合は、変更前の専用DBの内容を merge_backup_users に退避する。
    """
    if strategy not in ("max", "master", "dedicated"):
        return {"ok": False, "error": f"不明な統合方法です: {strategy}"}

    out = {
        "ok": False, "error": None, "strategy": strategy, "dry_run": dry_run,
        "inserted": 0, "updated": 0, "unchanged": 0, "backed_up": 0,
        "changes": [],
    }

    dedicated = None
    try:
        dedicated = await _open_dedicated_conn(guild_id)
        if dedicated is None:
            out["error"] = "専用DBが設定されていないため統合できません。"
            return out

        master_pool = await get_master_pool()
        async with master_pool.acquire() as mconn:
            m = await _fetch_guild_users(mconn, guild_id)
        d = await _fetch_guild_users(dedicated, guild_id)

        plan = {}
        for uid, mu in m.items():
            du = d.get(uid)
            if du is None:
                merged = {f: mu[f] for f in _MERGE_FIELDS}
                merged["initial_issued"] = bool(mu["initial_issued"])
                plan[uid] = ("insert", merged)
                continue
            if strategy == "max":
                merged = {f: max(mu[f], du[f]) for f in _MERGE_FIELDS}
            elif strategy == "master":
                merged = {f: mu[f] for f in _MERGE_FIELDS}
            else:
                merged = {f: du[f] for f in _MERGE_FIELDS}
            merged["initial_issued"] = bool(mu["initial_issued"] or du["initial_issued"])
            same_values = all(merged[f] == du[f] for f in _MERGE_FIELDS)
            if same_values and merged["initial_issued"] == du["initial_issued"]:
                out["unchanged"] += 1
                continue
            plan[uid] = ("update", merged)

        for uid, (kind, vals) in plan.items():
            if kind == "insert":
                out["inserted"] += 1
            else:
                out["updated"] += 1
            if len(out["changes"]) < 5:
                out["changes"].append({
                    "user_id": uid, "kind": kind,
                    "before": d.get(uid), "after": {f: vals[f] for f in _MERGE_FIELDS},
                })

        if dry_run or not plan:
            out["ok"] = True
            return out

        # 変更前の状態を退避してから書き込む
        await dedicated.execute(_MERGE_BACKUP_DDL)
        backup_at = get_now_naive()
        for uid in plan:
            du = d.get(uid)
            if du is None:
                continue
            await dedicated.execute(
                _MERGE_BACKUP_INSERT,
                backup_at, guild_id, uid, du["balance"], du["tc_xp"], du["tc_level"],
                du["vc_xp"], du["vc_level"], du["evaluation_vc_time"],
                du["event_points"], du["initial_issued"]
            )
            out["backed_up"] += 1

        for uid, (kind, vals) in plan.items():
            await dedicated.execute(
                _MERGE_UPSERT,
                guild_id, uid, vals["balance"], vals["tc_xp"], vals["tc_level"],
                vals["vc_xp"], vals["vc_level"], vals["evaluation_vc_time"],
                vals["event_points"], bool(vals.get("initial_issued"))
            )

        out["ok"] = True
        return out
    except Exception as e:
        out["error"] = str(e)
        return out
    finally:
        if dedicated is not None:
            try:
                await dedicated.close()
            except Exception:
                pass


async def setup_db():

    p = await get_master_pool()

    async with p.acquire() as conn:

        await conn.execute("""

            CREATE TABLE IF NOT EXISTS guild_databases (

                guild_id BIGINT PRIMARY KEY,

                database_url TEXT NOT NULL

            )

        """)

    for p in await get_all_configured_pools():

        await setup_db_schema(p)



async def get_user(guild_id: int, user_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:
            row = await conn.fetchrow('SELECT balance, chinchiro_count, chinchiro_last_date, tc_xp, tc_level, vc_xp, vc_level, evaluation_vc_time, initial_issued, chinchiro_daily_bet, event_points FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
        except asyncpg.exceptions.UndefinedColumnError:
            # カラムが存在しなぁE合、E動的に追加して再試衁E
            print("[Auto-Recovery] users チEEブルに不足カラムを追加中...")
            for col_sql in [
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS evaluation_vc_time INTEGER DEFAULT 0',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_issued BOOLEAN DEFAULT FALSE',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS event_points INTEGER DEFAULT 0',
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_daily_bet INTEGER DEFAULT 0',
            ]:
                try:
                    await conn.execute(col_sql)
                except Exception:
                    pass
            row = await conn.fetchrow('SELECT balance, chinchiro_count, chinchiro_last_date, tc_xp, tc_level, vc_xp, vc_level, evaluation_vc_time, initial_issued, chinchiro_daily_bet, event_points FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)

        if row:

            return {

                "balance": row['balance'], 

                "chinchiro_count": row['chinchiro_count'],

                "chinchiro_last_date": row['chinchiro_last_date'],

                "tc_xp": row['tc_xp'],

                "tc_level": row['tc_level'],

                "vc_xp": row['vc_xp'],

                "vc_level": row['vc_level'],

                "evaluation_vc_time": row['evaluation_vc_time'],

                "initial_issued": row['initial_issued'],

                "chinchiro_daily_bet": row['chinchiro_daily_bet'] if 'chinchiro_daily_bet' in row.keys() else 0,

                "event_points": row['event_points'] if 'event_points' in row.keys() else 0

            }

        else:
            try:
                await conn.execute('INSERT INTO users (guild_id, user_id, balance, initial_issued) VALUES ($1, $2, 0, FALSE) ON CONFLICT (guild_id, user_id) DO NOTHING', guild_id, user_id)
            except Exception:
                try:
                    await conn.execute('INSERT INTO users (guild_id, user_id, balance, initial_issued) VALUES ($1, $2, 0, FALSE) ON CONFLICT DO NOTHING', guild_id, user_id)
                except Exception:
                    pass
            return {"balance": 0, "chinchiro_count": 0, "chinchiro_last_date": None, "tc_xp": 0, "tc_level": 1, "vc_xp": 0, "vc_level": 1, "evaluation_vc_time": 0, "initial_issued": False, "chinchiro_daily_bet": 0, "event_points": 0}



async def get_balance(guild_id: int, user_id: int) -> int:

    user = await get_user(guild_id, user_id)

    return user["balance"]



async def add_balance(guild_id: int, user_id: int, amount: int):

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        new_balance = await conn.fetchval('UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3 RETURNING balance', amount, guild_id, user_id)

        return new_balance



async def remove_balance(guild_id: int, user_id: int, amount: int, force: bool = False) -> bool:

    if amount < 0:

        return False

        

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        if force:

            await conn.execute('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, user_id)

            return True

        else:

            status = await conn.execute('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 AND balance >= $1', amount, guild_id, user_id)

            return status == "UPDATE 1"



async def add_role_history(guild_id: int, user_id: int, role_id: int, role_name: str, action: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute(

            'INSERT INTO role_history (guild_id, user_id, role_id, role_name, action) VALUES ($1, $2, $3, $4, $5)',

            guild_id, user_id, role_id, role_name, action

        )





async def transfer_balance(guild_id: int, sender_id: int, receiver_id: int, amount: int, source: str = 'pay') -> bool:

    if amount <= 0:

        return False

    if sender_id == receiver_id:

        return False

        

    await get_user(guild_id, receiver_id)

    await get_user(guild_id, sender_id)

    

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        async with conn.transaction():

            status = await conn.execute('UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 AND balance >= $1', amount, guild_id, sender_id)

            if status != "UPDATE 1":

                return False

            await conn.execute('UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, receiver_id)

            # 送金履歴。記録に失敗しても送金自体は成立させる（セーブポイントで巻き戻すのは記録だけ）

            try:

                async with conn.transaction():

                    await conn.execute('INSERT INTO transfer_logs (guild_id, sender_id, receiver_id, amount, source) VALUES ($1, $2, $3, $4, $5)', guild_id, sender_id, receiver_id, amount, source)

            except Exception as e:

                print(f"[transfer_logs] failed to record transfer: {e}")

            return True



async def log_transfer(guild_id: int, sender_id: int, receiver_id: int, amount: int, source: str) -> None:
    """残高の移動は済んでいて、送金履歴だけ残したいとき用（対局の賭けで負けた人→勝った人など）。失敗しても例外は出さない"""
    if not guild_id or not sender_id or not receiver_id or amount <= 0 or sender_id == receiver_id:
        return
    try:
        p = await get_pool(guild_id)
        async with p.acquire() as conn:
            await conn.execute('INSERT INTO transfer_logs (guild_id, sender_id, receiver_id, amount, source) VALUES ($1, $2, $3, $4, $5)',
                               guild_id, sender_id, receiver_id, amount, source)
    except Exception as e:
        print(f"[transfer_logs] failed to record {source}: {e}")


async def get_event_points(guild_id: int, user_id: int) -> int:

    user = await get_user(guild_id, user_id)

    return user.get("event_points", 0)



async def add_event_points(guild_id: int, user_id: int, amount: int) -> int:

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        new_points = await conn.fetchval('UPDATE users SET event_points = event_points + $1 WHERE guild_id = $2 AND user_id = $3 RETURNING event_points', amount, guild_id, user_id)

        return new_points



async def remove_event_points(guild_id: int, user_id: int, amount: int) -> int:

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        new_points = await conn.fetchval('UPDATE users SET event_points = GREATEST(0, event_points - $1) WHERE guild_id = $2 AND user_id = $3 RETURNING event_points', amount, guild_id, user_id)

        return new_points





async def reset_gambling_count(guild_id: int, user_id: int, date_str: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET chinchiro_count = 0, chinchiro_daily_bet = 0, chinchiro_last_date = $1 WHERE guild_id = $2 AND user_id = $3', date_str, guild_id, user_id)



async def increment_gambling_count(guild_id: int, user_id: int, amount: int = 0):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET chinchiro_count = chinchiro_count + 1, chinchiro_daily_bet = chinchiro_daily_bet + $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, user_id)



async def record_game_result(
    guild_id: int,
    user_id: int,
    game_type: str,
    is_win: bool,
    is_draw: bool,
    bet: int,
    payout: int,
    extra_key: str = None,
    custom_extra: dict = None
):
    """
    ユーザーのゲーム・ギャンブル戦績を記録・更新する。
    """
    p = await get_pool(guild_id)
    net_profit = int(payout - bet)
    win_inc = 1 if (is_win and not is_draw) else 0
    draw_inc = 1 if is_draw else 0
    loss_inc = 1 if (not is_win and not is_draw) else 0

    async with p.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT extra_data, max_win FROM user_game_stats WHERE guild_id = $1 AND user_id = $2 AND game_type = $3",
            guild_id, user_id, game_type
        )

        extra_data = {}
        prev_max_win = 0
        if row:
            prev_max_win = row['max_win'] or 0
            raw_extra = row['extra_data']
            if raw_extra:
                try:
                    if isinstance(raw_extra, str):
                        extra_data = json.loads(raw_extra)
                    elif isinstance(raw_extra, dict):
                        extra_data = dict(raw_extra)
                except Exception:
                    extra_data = {}

        if extra_key:
            extra_data[extra_key] = extra_data.get(extra_key, 0) + 1
        if custom_extra:
            for k, v in custom_extra.items():
                if isinstance(v, int):
                    extra_data[k] = extra_data.get(k, 0) + v
                else:
                    extra_data[k] = v

        new_max_win = max(prev_max_win, payout)
        extra_json = json.dumps(extra_data)

        await conn.execute('''
            INSERT INTO user_game_stats (
                guild_id, user_id, game_type, plays, wins, losses, draws,
                total_bet, total_payout, net_profit, max_win, extra_data, updated_at
            ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, CURRENT_TIMESTAMP)
            ON CONFLICT (guild_id, user_id, game_type) DO UPDATE SET
                plays = user_game_stats.plays + 1,
                wins = user_game_stats.wins + $4,
                losses = user_game_stats.losses + $5,
                draws = user_game_stats.draws + $6,
                total_bet = user_game_stats.total_bet + $7,
                total_payout = user_game_stats.total_payout + $8,
                net_profit = user_game_stats.net_profit + $9,
                max_win = GREATEST(user_game_stats.max_win, $10),
                extra_data = $11::jsonb,
                updated_at = CURRENT_TIMESTAMP
        ''', guild_id, user_id, game_type, win_inc, loss_inc, draw_inc, bet, payout, net_profit, new_max_win, extra_json)


async def get_user_game_stats(guild_id: int, user_id: int, game_type: str = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if game_type:
            row = await conn.fetchrow(
                "SELECT * FROM user_game_stats WHERE guild_id = $1 AND user_id = $2 AND game_type = $3",
                guild_id, user_id, game_type
            )
            if not row:
                return {
                    "guild_id": guild_id,
                    "user_id": user_id,
                    "game_type": game_type,
                    "plays": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "total_bet": 0,
                    "total_payout": 0,
                    "net_profit": 0,
                    "max_win": 0,
                    "extra_data": {}
                }
            res = dict(row)
            if isinstance(res.get("extra_data"), str):
                try:
                    res["extra_data"] = json.loads(res["extra_data"])
                except Exception:
                    res["extra_data"] = {}
            elif res.get("extra_data") is None:
                res["extra_data"] = {}
            return res
        else:
            rows = await conn.fetch(
                "SELECT * FROM user_game_stats WHERE guild_id = $1 AND user_id = $2",
                guild_id, user_id
            )
            results = {}
            for r in rows:
                d = dict(r)
                if isinstance(d.get("extra_data"), str):
                    try:
                        d["extra_data"] = json.loads(d["extra_data"])
                    except Exception:
                        d["extra_data"] = {}
                elif d.get("extra_data") is None:
                    d["extra_data"] = {}
                results[d["game_type"]] = d
            return results


async def get_all_user_game_stats(guild_id: int, user_id: int):
    return await get_user_game_stats(guild_id, user_id, game_type=None)



def get_next_level_xp(level: int) -> int:

    return int(100 * (level ** 1.2) + 100)



async def add_xp(guild_id: int, user_id: int, amount: int, mode: str):

    await get_user(guild_id, user_id)

    field_xp = "tc_xp" if mode == "tc" else "vc_xp"

    field_lv = "tc_level" if mode == "tc" else "vc_level"

    

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow(f'SELECT {field_xp}, {field_lv} FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)

        current_xp, current_lv = row[0], row[1]

        new_xp = current_xp + amount

        new_lv = current_lv

        leveled_up = False

        while True:

            needed = get_next_level_xp(new_lv)

            if new_xp >= needed:

                new_xp -= needed

                new_lv += 1

                leveled_up = True

            else:

                break

        await conn.execute(f'UPDATE users SET {field_xp} = $1, {field_lv} = $2 WHERE guild_id = $3 AND user_id = $4', new_xp, new_lv, guild_id, user_id)

        return new_lv if leveled_up else None



async def add_room(channel_id: int, owner_id: int, room_type: str, expire_at: datetime.datetime, trigger_channel_id: int = None, guild_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:

            await conn.execute('INSERT INTO rooms (channel_id, owner_id, room_type, expire_at, trigger_channel_id, guild_id) VALUES ($1, $2, $3, $4, $5, $6)',
                             channel_id, owner_id, room_type, expire_at, trigger_channel_id, guild_id)

        except asyncpg.UndefinedColumnError:

            await conn.execute('INSERT INTO rooms (channel_id, owner_id, room_type, expire_at, trigger_channel_id) VALUES ($1, $2, $3, $4, $5)',
                             channel_id, owner_id, room_type, expire_at, trigger_channel_id)



async def get_room(channel_id: int, guild_id: int = None):
    """channel_idでroomを取得。guild_idを渡せばそのDBのみを検索し、なければ全DBを検索する。"""

    if guild_id is not None:
        p = await get_pool(guild_id)
        async with p.acquire() as conn:
            row = await conn.fetchrow('SELECT owner_id, room_type, expire_at, trigger_channel_id FROM rooms WHERE channel_id = $1', channel_id)
            if row:
                return {"owner_id": row['owner_id'], "room_type": row['room_type'], "expire_at": row['expire_at'], "trigger_channel_id": row['trigger_channel_id']}
        return None

    # guild_idなし: 全プールを検索して最初にヒットした結果を返す
    for p in await get_all_configured_pools():
        async with p.acquire() as conn:
            row = await conn.fetchrow('SELECT owner_id, room_type, expire_at, trigger_channel_id FROM rooms WHERE channel_id = $1', channel_id)
            if row:
                return {"owner_id": row['owner_id'], "room_type": row['room_type'], "expire_at": row['expire_at'], "trigger_channel_id": row['trigger_channel_id']}

    return None



async def has_room_type(owner_id: int, room_types: list[str], guild_id: int = None) -> bool:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        if guild_id is None:

            row = await conn.fetchrow('SELECT 1 FROM rooms WHERE owner_id = $1 AND room_type = ANY($2) LIMIT 1', owner_id, room_types)

        else:

            # guild_id が NULL の古いレコードは、どのギルドのものか判別できないため
            # 互換のために対象に含める(呼び出し側で実チャンネルを確認して補正する)
            try:

                row = await conn.fetchrow(
                    'SELECT 1 FROM rooms WHERE owner_id = $1 AND room_type = ANY($2) AND (guild_id = $3 OR guild_id IS NULL) LIMIT 1',
                    owner_id, room_types, guild_id
                )

            except asyncpg.UndefinedColumnError:

                row = await conn.fetchrow('SELECT 1 FROM rooms WHERE owner_id = $1 AND room_type = ANY($2) LIMIT 1', owner_id, room_types)

        return row is not None



async def get_owned_rooms(owner_id: int, room_types: list[str], guild_id: int = None) -> list[dict]:
    """指定オーナーの部屋レコードを取得する。

    guild_id を指定した場合は、そのギルドのレコードと
    guild_id 未設定(古いレコード)のみを返す。"""

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:

            if guild_id is None:

                rows = await conn.fetch(
                    'SELECT channel_id, owner_id, room_type, expire_at, guild_id FROM rooms WHERE owner_id = $1 AND room_type = ANY($2)',
                    owner_id, room_types
                )

            else:

                rows = await conn.fetch(
                    'SELECT channel_id, owner_id, room_type, expire_at, guild_id FROM rooms WHERE owner_id = $1 AND room_type = ANY($2) AND (guild_id = $3 OR guild_id IS NULL)',
                    owner_id, room_types, guild_id
                )

        except asyncpg.UndefinedColumnError:

            # guild_id カラムのマイグレーションが未適用のDBでも動作するようにする
            rows = await conn.fetch(
                'SELECT channel_id, owner_id, room_type, expire_at FROM rooms WHERE owner_id = $1 AND room_type = ANY($2)',
                owner_id, room_types
            )

        result = []

        for r in rows:

            d = dict(r)

            d.setdefault("guild_id", None)

            result.append(d)

        return result



async def set_room_guild(channel_id: int, guild_id: int):
    """guild_id が未設定の古いレコードに、実チャンネルから判明したギルドIDを補完する。"""

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:

            await conn.execute('UPDATE rooms SET guild_id = $1 WHERE channel_id = $2 AND guild_id IS NULL', guild_id, channel_id)

        except asyncpg.UndefinedColumnError:

            pass



async def remove_room(channel_id: int):

    for p in await get_all_configured_pools():

        await p.execute("DELETE FROM rooms WHERE channel_id = $1", channel_id)



async def extend_room(channel_id: int, new_expire_at: datetime.datetime):

    if new_expire_at.tzinfo:

        new_expire_at = new_expire_at.replace(tzinfo=None)

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('UPDATE rooms SET expire_at = $1 WHERE channel_id = $2', new_expire_at, channel_id)


async def get_all_rooms_for_guild(guild_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT channel_id, owner_id, room_type, expire_at FROM rooms')

        return [{"channel_id": r['channel_id'], "owner_id": r['owner_id'], "room_type": r['room_type'], "expire_at": r['expire_at']} for r in rows]




async def get_expired_rooms():

    all_expired = []

    for p in await get_all_configured_pools():

        try:

            rows = await p.fetch("SELECT channel_id FROM rooms WHERE expire_at < $1", get_now_naive())

            all_expired.extend([row['channel_id'] for row in rows])

        except Exception:

            pass

    return all_expired



async def save_room_panel(guild_id: int, channel_id: int, message_id: int, panel_type: str = 'inn'):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO room_panels (guild_id, channel_id, message_id, panel_type)

            VALUES ($1, $2, $3, $4)

            ON CONFLICT (guild_id, panel_type)

            DO UPDATE SET channel_id = $2, message_id = $3, created_at = CURRENT_TIMESTAMP

        ''', guild_id, channel_id, message_id, panel_type)



async def get_room_panels(guild_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT channel_id, message_id, panel_type, created_at FROM room_panels WHERE guild_id = $1', guild_id)

        return [dict(r) for r in rows]



async def has_panel_type(guild_id: int, panel_type: str) -> bool:

    p = await get_pool(guild_id)

    try:

        async with p.acquire() as conn:

            row = await conn.fetchrow('SELECT 1 FROM room_panels WHERE guild_id = $1 AND panel_type = $2 LIMIT 1', guild_id, panel_type)

            return row is not None

    except Exception:

        return False



async def delete_room_panel(guild_id: int, panel_type: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM room_panels WHERE guild_id = $1 AND panel_type = $2', guild_id, panel_type)



async def reset_user_rank(guild_id: int, user_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            UPDATE users 

            SET tc_xp = 0, tc_level = 1, vc_xp = 0, vc_level = 1 

            WHERE guild_id = $1 AND user_id = $2

        ''', guild_id, user_id)



async def reset_user_balance(guild_id: int, user_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET balance = 0 WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)



# --- 隧穂ｾE譛滁E邂｡送EE畑髢E謨E ---

async def add_evaluation_period(guild_id: int, user_id: int, start_time: datetime.datetime, end_time: datetime.datetime):

    if start_time.tzinfo:

        start_time = start_time.replace(tzinfo=None)

    if end_time.tzinfo:

        end_time = end_time.replace(tzinfo=None)

        

    p = await get_pool(guild_id)

async def ensure_evaluation_periods_schema(conn):
    try:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS evaluation_periods (
                guild_id BIGINT,
                user_id BIGINT,
                PRIMARY KEY (guild_id, user_id),
                start_time TIMESTAMP,
                end_time TIMESTAMP
            )
        ''')
        renames = [
            ("start_date", "start_time"),
            ("end_date", "end_time"),
            ("member_id", "user_id"),
            ("target_user_id", "user_id"),
            ("target_id", "user_id"),
            ("server_id", "guild_id"),
        ]
        for old_col, new_col in renames:
            try:
                await conn.execute(f'ALTER TABLE evaluation_periods RENAME COLUMN {old_col} TO {new_col}')
            except Exception:
                pass
        try:
            await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS guild_id BIGINT')
            await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS user_id BIGINT')
            await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS start_time TIMESTAMP')
            await conn.execute('ALTER TABLE evaluation_periods ADD COLUMN IF NOT EXISTS end_time TIMESTAMP')
        except Exception:
            pass
    except Exception as e:
        print(f"[Migration] ensure_evaluation_periods_schema error: {e}")

async def add_evaluation_period(guild_id: int, user_id: int, start_time: datetime.datetime, end_time: datetime.datetime):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        try:
            await conn.execute('''
                INSERT INTO evaluation_periods (guild_id, user_id, start_time, end_time) 
                VALUES ($1, $2, $3, $4) 
                ON CONFLICT (guild_id, user_id) DO UPDATE SET start_time = $3, end_time = $4
            ''', guild_id, user_id, start_time, end_time)
        except Exception as e:
            if "column \"start_time\" does not exist" in str(e) or "column \"start_date\"" in str(e):
                await ensure_evaluation_periods_schema(conn)
                await conn.execute('''
                    INSERT INTO evaluation_periods (guild_id, user_id, start_time, end_time) 
                    VALUES ($1, $2, $3, $4) 
                    ON CONFLICT (guild_id, user_id) DO UPDATE SET start_time = $3, end_time = $4
                ''', guild_id, user_id, start_time, end_time)
            else:
                raise e

async def get_evaluation_period(guild_id: int, user_id: int):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        try:
            row = await conn.fetchrow('SELECT start_time, end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            if row:
                return {"start_time": row['start_time'], "end_time": row['end_time']}
            return None
        except Exception as e:
            if "column \"start_time\" does not exist" in str(e) or "column \"start_date\"" in str(e):
                await ensure_evaluation_periods_schema(conn)
                # フォールバックで再取得
                row = await conn.fetchrow('SELECT start_time, end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
                if row:
                    return {"start_time": row['start_time'], "end_time": row['end_time']}
                return None
            else:
                raise e

async def get_all_evaluation_periods():
    all_periods = []
    for p in await get_all_configured_pools():
        try:
            async with p.acquire() as conn:
                try:
                    rows = await p.fetch("SELECT guild_id, user_id, start_time, end_time FROM evaluation_periods")
                    all_periods.extend([dict(row) for row in rows])
                except Exception as e:
                    if "column \"start_time\" does not exist" in str(e) or "column \"start_date\"" in str(e):
                        await ensure_evaluation_periods_schema(conn)
                        rows = await p.fetch("SELECT guild_id, user_id, start_time, end_time FROM evaluation_periods")
                        all_periods.extend([dict(row) for row in rows])
        except Exception:
            pass
    return all_periods

async def extend_evaluation_period(guild_id: int, user_id: int, extra_days: int) -> bool:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        try:
            row = await conn.fetchrow('SELECT end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            if not row:
                return False
            new_end_time = row['end_time'] + datetime.timedelta(days=extra_days)
            await conn.execute('UPDATE evaluation_periods SET end_time = $1 WHERE guild_id = $2 AND user_id = $3', new_end_time, guild_id, user_id)
            return True
        except Exception as e:
            if "column \"end_time\" does not exist" in str(e) or "column \"end_date\"" in str(e):
                await ensure_evaluation_periods_schema(conn)
                row = await conn.fetchrow('SELECT end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
                if not row:
                    return False
                new_end_time = row['end_time'] + datetime.timedelta(days=extra_days)
                await conn.execute('UPDATE evaluation_periods SET end_time = $1 WHERE guild_id = $2 AND user_id = $3', new_end_time, guild_id, user_id)
                return True
            else:
                raise e

async def update_evaluation_period_end(guild_id: int, user_id: int, new_end_time: datetime.datetime) -> bool:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        try:
            result = await conn.execute('UPDATE evaluation_periods SET end_time = $1 WHERE guild_id = $2 AND user_id = $3', new_end_time, guild_id, user_id)
            return result != "UPDATE 0"
        except Exception as e:
            if "column \"end_time\" does not exist" in str(e) or "column \"end_date\"" in str(e):
                await ensure_evaluation_periods_schema(conn)
                result = await conn.execute('UPDATE evaluation_periods SET end_time = $1 WHERE guild_id = $2 AND user_id = $3', new_end_time, guild_id, user_id)
                return result != "UPDATE 0"
            else:
                raise e



# --- VC菴懈E繝医Μ繧E繝ｼ邂｡送EE畑髢E謨E ---

async def add_auto_vc_trigger(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('INSERT INTO auto_vc_triggers (channel_id) VALUES ($1) ON CONFLICT (channel_id) DO NOTHING', channel_id)



async def remove_auto_vc_trigger(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM auto_vc_triggers WHERE channel_id = $1', channel_id)



async def get_auto_vc_triggers() -> list[int]:

    pools = await get_all_configured_pools()

    all_triggers = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                rows = await conn.fetch('SELECT channel_id FROM auto_vc_triggers')

                all_triggers.extend([row['channel_id'] for row in rows])

        except Exception as e:

            print(f'[DB Error] Failed to fetch auto_vc_triggers: {e}')

    return all_triggers



# --- VC菴懈E繝医Μ繧E繝ｼ險E螳夂ｮE送EE畑髢E謨E ---

async def save_auto_vc_config(channel_id: int, base_name: str, allow_rename: bool, include_owner_name: bool, use_numbering: bool, allow_limit_change: bool, show_panel: bool, is_invite_only: bool = False, invite_visible_role_ids: list = None, allowed_role_ids: list = None):

    p = await get_pool()

    if invite_visible_role_ids is None:
        invite_visible_role_ids = []
    if allowed_role_ids is None:
        allowed_role_ids = []

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO auto_vc_config (channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids)

            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)

            ON CONFLICT (channel_id) DO UPDATE SET

                base_name = $2, allow_rename = $3, include_owner_name = $4, use_numbering = $5, allow_limit_change = $6, show_panel = $7, is_invite_only = $8, invite_visible_role_ids = $9, allowed_role_ids = $10

        ''', channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids)



async def get_auto_vc_config(channel_id: int) -> dict | None:

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids, allow_stream FROM auto_vc_config WHERE channel_id = $1', channel_id)

        if row:

            return {

                "base_name": row["base_name"],

                "allow_rename": row["allow_rename"],

                "include_owner_name": row["include_owner_name"],

                "use_numbering": row["use_numbering"],

                "allow_limit_change": row["allow_limit_change"],

                "show_panel": row["show_panel"],

                "is_invite_only": row["is_invite_only"] or False,

                "invite_visible_role_ids": list(row["invite_visible_role_ids"]) if row["invite_visible_role_ids"] else [],
                
                "allowed_role_ids": list(row["allowed_role_ids"]) if row["allowed_role_ids"] else [],

                "allow_stream": row["allow_stream"] is not False

            }

        return None



async def remove_auto_vc_config(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM auto_vc_config WHERE channel_id = $1', channel_id)



async def get_all_auto_vc_configs() -> list[dict]:

    pools = await get_all_configured_pools()

    all_configs = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                rows = await conn.fetch('SELECT channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids, allow_stream FROM auto_vc_config')

                all_configs.extend([{

                    "channel_id": r["channel_id"],

                    "base_name": r["base_name"],

                    "allow_rename": r["allow_rename"],

                    "include_owner_name": r["include_owner_name"],

                    "use_numbering": r["use_numbering"],

                    "allow_limit_change": r["allow_limit_change"],

                    "show_panel": r["show_panel"],

                    "is_invite_only": r["is_invite_only"] or False,

                    "invite_visible_role_ids": list(r["invite_visible_role_ids"]) if r["invite_visible_role_ids"] else [],

                    "allowed_role_ids": list(r["allowed_role_ids"]) if r["allowed_role_ids"] else [],

                    "allow_stream": r["allow_stream"] is not False

                } for r in rows])

        except Exception as e:

            print(f'[DB Error] Failed to fetch auto_vc_configs: {e}')

    return all_configs



# --- 縺雁撫縺・粋繧上○繝代ロ繝ｫ邂｡送EE畑髢E謨E ---

async def add_inquiry_panel(channel_id: int, mention_role_ids: list[int]):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO inquiry_panels (channel_id, mention_role_ids) 

            VALUES ($1, $2) 

            ON CONFLICT (channel_id) 

            DO UPDATE SET mention_role_ids = $2

        ''', channel_id, mention_role_ids)



async def get_inquiry_panel_roles(channel_id: int) -> list[int]:

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT mention_role_ids, mention_role_id FROM inquiry_panels WHERE channel_id = $1', channel_id)

        if row:

            if row['mention_role_ids'] is not None:

                return row['mention_role_ids']

            elif row['mention_role_id'] is not None:

                return [row['mention_role_id']]

        return []



async def remove_inquiry_panel(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM inquiry_panels WHERE channel_id = $1', channel_id)



# --- Bot險E螳壼€E邂｡送EE畑髢E謨E ---

async def save_setting(guild_id: int, key: str, value):

    p = await get_pool(guild_id)

    val_json = json.dumps(value)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO bot_settings (guild_id, setting_key, setting_value)

            VALUES ($1, $2, $3)

            ON CONFLICT (guild_id, setting_key)

            DO UPDATE SET setting_value = $3

        ''', guild_id, key, val_json)



async def load_settings() -> dict:

    settings = {}

    for p in await get_all_configured_pools():

        try:

            rows = await p.fetch("SELECT guild_id, setting_key, setting_value FROM bot_settings")

            for row in rows:

                g_id = row['guild_id']

                if g_id not in settings:

                    settings[g_id] = {}

                try:

                    val = json.loads(row['setting_value'])

                    if isinstance(val, list):

                        val = [int(v) if isinstance(v, str) and v.isdigit() else v for v in val]

                    elif isinstance(val, str) and val.isdigit():

                        val = int(val)

                    settings[g_id][row['setting_key']] = val

                except:

                    settings[g_id][row['setting_key']] = row['setting_value']

        except Exception:

            pass

    return settings



async def add_level_role_reward(guild_id: int, level_type: str, level: int, role_id: int, condition_role_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO level_role_rewards (guild_id, level_type, level, role_id, condition_role_id)

            VALUES ($1, $2, $3, $4, $5)

            ON CONFLICT (guild_id, level_type, level, role_id, condition_role_id) DO NOTHING

        ''', guild_id, level_type, level, role_id, condition_role_id)



async def get_level_role_rewards(guild_id: int, level_type: str = None) -> list[dict]:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        if level_type:

            rows = await conn.fetch('''

                SELECT level_type, level, role_id, condition_role_id 

                FROM level_role_rewards 

                WHERE guild_id = $1 AND level_type = $2 

                ORDER BY level ASC

            ''', guild_id, level_type)

        else:

            rows = await conn.fetch('''

                SELECT level_type, level, role_id, condition_role_id 

                FROM level_role_rewards 

                WHERE guild_id = $1

                ORDER BY level_type ASC, level ASC

            ''', guild_id)

        return [{"level_type": r["level_type"], "level": r["level"], "role_id": r["role_id"], "condition_role_id": r["condition_role_id"]} for r in rows]



async def remove_level_role_reward(guild_id: int, level_type: str, level: int, role_id: int, condition_role_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            DELETE FROM level_role_rewards 

            WHERE guild_id = $1 AND level_type = $2 AND level = $3 AND role_id = $4 AND condition_role_id IS NOT DISTINCT FROM $5

        ''', guild_id, level_type, level, role_id, condition_role_id)



# --- 驛ｨ螻倶EE譬E邂｡送EE畑髢E謨E ---

async def get_all_room_prices() -> list[dict]:

    p = await get_pool()

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT room_type, duration, price FROM room_prices ORDER BY room_type ASC, duration ASC')

        return [{"room_type": r["room_type"], "duration": r["duration"], "price": r["price"]} for r in rows]



async def update_room_price(room_type: str, duration: int, price: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO room_prices (room_type, duration, price) 

            VALUES ($1, $2, $3)

            ON CONFLICT (room_type, duration) 

            DO UPDATE SET price = EXCLUDED.price

        ''', room_type, duration, price)



async def get_all_role_room_prices() -> dict:

    results = {}

    master = await get_master_pool()

    

    guild_urls = {}

    try:

        rows = await master.fetch("SELECT guild_id, database_url FROM guild_databases")

        for r in rows:

            guild_urls[r['guild_id']] = r['database_url']

    except Exception:

        pass

        

    for g_id, url in guild_urls.items():

        if url not in pools:

            pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)

        p = pools[url]

        try:

            async with p.acquire() as conn:

                db_rows = await conn.fetch('SELECT role_key, room_type, duration, price FROM role_room_prices ORDER BY role_key ASC, room_type ASC, duration ASC')

                results[g_id] = [{"role_key": r["role_key"], "room_type": r["room_type"], "duration": r["duration"], "price": r["price"]} for r in db_rows]

        except Exception:

            pass

            

    try:

        async with master.acquire() as conn:

            master_rows = await conn.fetch('SELECT role_key, room_type, duration, price FROM role_room_prices ORDER BY role_key ASC, room_type ASC, duration ASC')

            results['default'] = [{"role_key": r["role_key"], "room_type": r["room_type"], "duration": r["duration"], "price": r["price"]} for r in master_rows]

    except Exception:

        pass

        

    return results



async def save_role_room_price(role_key: str, room_type: str, duration: int, price: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO role_room_prices (role_key, room_type, duration, price)

            VALUES ($1, $2, $3, $4)

            ON CONFLICT (role_key, room_type, duration)

            DO UPDATE SET price = EXCLUDED.price

        ''', role_key, room_type, duration, price)



async def delete_role_room_price(role_key: str, room_type: str, duration: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            DELETE FROM role_room_prices

            WHERE role_key = $1 AND room_type = $2 AND duration = $3

        ''', role_key, room_type, duration)



# --- 蛹E蜷阪メ繝｣繝Eヨ邂｡送EE畑髢E謨E ---

async def add_anonymous_chat(panel_channel_id: int, dest_channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO anonymous_chats (panel_channel_id, dest_channel_id)

            VALUES ($1, $2)

            ON CONFLICT (panel_channel_id)

            DO UPDATE SET dest_channel_id = $2

        ''', panel_channel_id, dest_channel_id)



async def get_anonymous_chat(panel_channel_id: int) -> int:

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT dest_channel_id FROM anonymous_chats WHERE panel_channel_id = $1', panel_channel_id)

        return row['dest_channel_id'] if row else None



async def remove_anonymous_chat(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM anonymous_chats WHERE panel_channel_id = $1 OR dest_channel_id = $1', channel_id)



async def get_panel_channel_by_dest(dest_channel_id: int) -> list[int]:

    p = await get_pool()

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT panel_channel_id FROM anonymous_chats WHERE dest_channel_id = $1', dest_channel_id)

        return [r['panel_channel_id'] for r in rows]



# --- 繧E繧E繧E繝繝Eこ繝Eヨ繝代ロ繝ｫ邂｡送EE畑髢E謨E ---

_ticket_schema_ready = set()


async def _ensure_ticket_panel_schema(p):
    """1チャンネルに複数パネルを置けるよう、パネルIDの付与とチャンネルの一意制約の撤廃を行う(冪等)。"""
    if id(p) in _ticket_schema_ready:
        return
    ok = True
    try:
        async with p.acquire() as conn:
            for sql in (
                "ALTER TABLE panel_requests ADD COLUMN IF NOT EXISTS panel_id BIGINT",
                "ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS guild_id BIGINT",
                "ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS id SERIAL",
                "ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS staff_role_ids BIGINT[] DEFAULT '{}'::BIGINT[]",
                "ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS forum_post_title TEXT",
                "ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS forum_post_content TEXT",
                "ALTER TABLE custom_ticket_panels DROP CONSTRAINT IF EXISTS custom_ticket_panels_pkey",
                "DROP INDEX IF EXISTS idx_custom_ticket_panels_channel_id",
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_ticket_panels_id ON custom_ticket_panels (id)",
            ):
                try:
                    await conn.execute(sql)
                except Exception as e:
                    ok = False
                    print(f"[Migration] custom_ticket_panels schema warning ({sql}): {e}")
    except Exception as e:
        ok = False
        print(f"[Migration] custom_ticket_panels schema check failed: {e}")
    if ok:
        _ticket_schema_ready.add(id(p))


async def save_custom_ticket_panel(guild_id: int, channel_id: int, panel_title: str, panel_description: str, button_label: str = "チケットを作成する", button_emoji: str = None, mention_role_ids: list[int] = None, target_role_ids: list[int] = None, ticket_prefix: str = "ticket", panel_type: str = "custom_ticket", panel_id: int = None, staff_role_ids: list[int] = None) -> int:
    """パネルを保存してそのIDを返す。panel_id指定なら更新、未指定なら同じチャンネルでも新規追加する。"""
    mention_role_ids = mention_role_ids or []
    target_role_ids = target_role_ids or []
    staff_role_ids = staff_role_ids or []

    p = await get_pool(guild_id)
    await _ensure_ticket_panel_schema(p)
    async with p.acquire() as conn:
        if panel_id is not None:
            updated = await conn.fetchval('''
                UPDATE custom_ticket_panels SET
                    panel_title = $2,
                    panel_description = $3,
                    button_label = $4,
                    button_emoji = $5,
                    mention_role_ids = $6,
                    target_role_ids = $7,
                    ticket_prefix = $8,
                    panel_type = $9,
                    staff_role_ids = $11
                WHERE id = $1 AND (guild_id = $10 OR guild_id IS NULL)
                RETURNING id
            ''', panel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, guild_id, staff_role_ids)
            if updated is not None:
                return updated

        return await conn.fetchval('''
            INSERT INTO custom_ticket_panels (
                guild_id, channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, staff_role_ids
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        ''', guild_id, channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, staff_role_ids)


async def get_custom_ticket_panel(guild_id: int, channel_id: int, panel_id: int = None) -> dict:
    """panel_id指定ならそのパネル、未指定(旧ボタン)ならそのチャンネルで最も古いパネルを返す。"""
    p = await get_pool(guild_id)
    await _ensure_ticket_panel_schema(p)
    async with p.acquire() as conn:
        if panel_id is not None:
            row = await conn.fetchrow('''
                SELECT id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, staff_role_ids, forum_post_title, forum_post_content
                FROM custom_ticket_panels
                WHERE id = $1
            ''', panel_id)
        else:
            row = await conn.fetchrow('''
                SELECT id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, staff_role_ids, forum_post_title, forum_post_content
                FROM custom_ticket_panels
                WHERE channel_id = $1
                ORDER BY id ASC
                LIMIT 1
            ''', channel_id)

        if row:
            return {
                "id": row["id"],
                "panel_title": row["panel_title"],
                "panel_description": row["panel_description"],
                "button_label": row["button_label"],
                "button_emoji": row["button_emoji"],
                "mention_role_ids": row["mention_role_ids"] or [],
                "target_role_ids": row["target_role_ids"] or [],
                "staff_role_ids": row["staff_role_ids"] or [],
                "ticket_prefix": row["ticket_prefix"] or "ticket",
                "panel_type": row["panel_type"] or "custom_ticket",
                "forum_post_title": row["forum_post_title"] or "",
                "forum_post_content": row["forum_post_content"] or ""
            }

        return None


async def remove_custom_ticket_panel(guild_id: int, channel_id: int, panel_id: int = None):
    """panel_id指定ならそのパネルのみ、未指定ならそのチャンネルのパネルをすべて削除する。"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if panel_id is not None:
            await conn.execute('DELETE FROM custom_ticket_panels WHERE id = $1', panel_id)
        else:
            await conn.execute('DELETE FROM custom_ticket_panels WHERE channel_id = $1', channel_id)


async def get_panel_requests(guild_ids: list[int] = None) -> list[dict]:

    pools = await get_all_configured_pools()

    all_requests = []

    for p in pools:

        await _ensure_ticket_panel_schema(p)

        try:

            async with p.acquire() as conn:

                if guild_ids is not None:

                    rows = await conn.fetch('SELECT id, guild_id, channel_id, panel_type, panel_id FROM panel_requests WHERE guild_id = ANY($1::bigint[]) ORDER BY created_at ASC LIMIT 10', guild_ids)

                else:

                    rows = await conn.fetch('SELECT id, guild_id, channel_id, panel_type, panel_id FROM panel_requests ORDER BY created_at ASC LIMIT 10')

                all_requests.extend([dict(row) for row in rows])

        except Exception as e:

            pass

    return all_requests



async def delete_panel_request(request_id: int, guild_id: int):

    pools = await get_all_configured_pools()

    for p in pools:

        try:

            async with p.acquire() as conn:

                await conn.execute('DELETE FROM panel_requests WHERE id = $1', request_id)

        except Exception:

            pass



async def set_log_channel(guild_id: int, log_type: str, channel_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO log_settings (guild_id, log_type, channel_id)

            VALUES ($1, $2, $3)

            ON CONFLICT (guild_id, log_type)

            DO UPDATE SET channel_id = $3

        ''', guild_id, log_type, channel_id)



async def save_log_channel(guild_id: int, log_type: str, channel_id: int):

    await set_log_channel(guild_id, log_type, channel_id)



async def get_log_channel(guild_id: int, log_type: str) -> int:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT channel_id, is_enabled FROM log_settings WHERE guild_id = $1 AND log_type = $2', guild_id, log_type)

        if row and (row['is_enabled'] is None or row['is_enabled']):

            return row['channel_id']

        return None



async def get_all_log_settings(guild_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT log_type, channel_id FROM log_settings WHERE guild_id = $1', guild_id)

        return {row['log_type']: row['channel_id'] for row in rows}



async def remove_log_channel(guild_id: int, log_type: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM log_settings WHERE guild_id = $1 AND log_type = $2', guild_id, log_type)







# --- 閾E蟾E邏ｹ莉九E隧穂ｾE險E螳夂ｮE送EE畑髢E謨E ---

async def get_evaluation_settings(guild_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:
            row = await conn.fetchrow('SELECT is_enabled, auto_generate_period, auto_fail_on_deadline, evaluation_duration_days, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1', guild_id)
        except Exception:
            try:
                await conn.execute('ALTER TABLE evaluation_settings ADD COLUMN IF NOT EXISTS evaluation_duration_days INT DEFAULT 14')
                row = await conn.fetchrow('SELECT is_enabled, auto_generate_period, auto_fail_on_deadline, evaluation_duration_days, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1', guild_id)
            except Exception:
                row = await conn.fetchrow('SELECT is_enabled, auto_generate_period, auto_fail_on_deadline, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1', guild_id)

        if row:

            return {

                "is_enabled": row["is_enabled"] if row["is_enabled"] is not None else True,

                "auto_generate_period": row["auto_generate_period"] if row["auto_generate_period"] is not None else True,

                "auto_fail_on_deadline": row["auto_fail_on_deadline"] if row["auto_fail_on_deadline"] is not None else False,

                "evaluation_duration_days": row["evaluation_duration_days"] if ("evaluation_duration_days" in row and row["evaluation_duration_days"] is not None) else 14,

                "forum_channel_ids": row["forum_channel_ids"] or [],

                "self_intro_channel_ids": row["self_intro_channel_ids"] or []

            }

        return None



async def get_all_evaluation_settings() -> list[dict]:

    pools = await get_all_configured_pools()

    all_settings = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                try:
                    rows = await conn.fetch('SELECT guild_id, is_enabled, auto_generate_period, auto_fail_on_deadline, evaluation_duration_days, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings')
                except Exception:
                    rows = await conn.fetch('SELECT guild_id, is_enabled, auto_generate_period, auto_fail_on_deadline, forum_channel_ids, self_intro_channel_ids FROM evaluation_settings')

                all_settings.extend([{

                    "guild_id": r["guild_id"], 

                    "is_enabled": r["is_enabled"] if r["is_enabled"] is not None else True,

                    "auto_generate_period": r["auto_generate_period"] if r["auto_generate_period"] is not None else True,

                    "auto_fail_on_deadline": r["auto_fail_on_deadline"] if r["auto_fail_on_deadline"] is not None else False,

                    "evaluation_duration_days": r["evaluation_duration_days"] if ("evaluation_duration_days" in r and r["evaluation_duration_days"] is not None) else 14,

                    "forum_channel_ids": r["forum_channel_ids"] or [],

                    "self_intro_channel_ids": r["self_intro_channel_ids"] or []

                } for r in rows])

        except Exception as e:

            print(f'[DB Error] Failed to fetch evaluation_settings: {e}')

    return all_settings



async def set_evaluation_settings(guild_id: int, forum_channel_ids: list[int], self_intro_channel_ids: list[int], is_enabled: bool = True, auto_generate_period: bool = True, auto_fail_on_deadline: bool = False):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO evaluation_settings (guild_id, forum_channel_ids, self_intro_channel_ids, is_enabled, auto_generate_period, auto_fail_on_deadline)

            VALUES ($1, $2, $3, $4, $5, $6)

            ON CONFLICT (guild_id)

            DO UPDATE SET forum_channel_ids = $2, self_intro_channel_ids = $3, is_enabled = $4, auto_generate_period = $5, auto_fail_on_deadline = $6

        ''', guild_id, forum_channel_ids, self_intro_channel_ids, is_enabled, auto_generate_period, auto_fail_on_deadline)





# --- 繝ｩ繝ｳ繧E蟁E雎｡險E螳夂ｮE送EE畑髢E謨E ---

async def get_rank_settings(guild_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, ephemeral_rank_commands FROM rank_settings WHERE guild_id = $1', guild_id)

        if row:
            return {
                "whitelist": row["whitelist_channel_ids"] or [],
                "blacklist": row["blacklist_channel_ids"] or [],
                "categories": row["whitelist_category_ids"] or [],
                "blacklist_categories": row["blacklist_category_ids"] or [],
                "enable_exclude_rank_role": row["enable_exclude_rank_role"],
                "exclude_rank_role_ids": row["exclude_rank_role_ids"] or [],
                "ephemeral_rank_commands": row["ephemeral_rank_commands"]
            }
        else:
            await conn.execute('INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, ephemeral_rank_commands) VALUES ($1, $2, $3, $4, $5, FALSE, \'{}\', FALSE) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [])
            return {"whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": [], "enable_exclude_rank_role": False, "exclude_rank_role_ids": [], "ephemeral_rank_commands": False}

async def toggle_ephemeral_rank_commands(guild_id: int) -> bool:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow('SELECT ephemeral_rank_commands FROM rank_settings WHERE guild_id = $1', guild_id)
        if not row:
            await conn.execute('INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, ephemeral_rank_commands) VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [])
            return True
        else:
            new_val = not row['ephemeral_rank_commands']
            await conn.execute('UPDATE rank_settings SET ephemeral_rank_commands = $2 WHERE guild_id = $1', guild_id, new_val)
            return new_val

async def get_all_rank_settings() -> list[dict]:

    pools = await get_all_configured_pools()

    all_settings = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                rows = await conn.fetch('SELECT guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM rank_settings')

                all_settings.extend([

                    {

                        "guild_id": r["guild_id"],

                        "whitelist": r["whitelist_channel_ids"] or [],

                        "blacklist": r["blacklist_channel_ids"] or [],

                        "categories": r["whitelist_category_ids"] or [],

                        "blacklist_categories": r["blacklist_category_ids"] or []

                    }

                    for r in rows

                ])

        except Exception as e:

            print(f'[DB Error] Failed to fetch rank_settings: {e}')

    return all_settings



async def set_rank_settings(guild_id: int, whitelist_ids: list[int], blacklist_ids: list[int], category_ids: list[int], blacklist_category_ids: list[int]):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids)

            VALUES ($1, $2, $3, $4, $5, $6, $7)

            ON CONFLICT (guild_id)

            DO UPDATE SET whitelist_channel_ids = $2, blacklist_channel_ids = $3, whitelist_category_ids = $4, blacklist_category_ids = $5

        ''', guild_id, whitelist_ids, blacklist_ids, category_ids, blacklist_category_ids, False, [])





# --- VC繧E繧E繝ｳ蟁E雎｡險E螳夂ｮE送EE畑髢E謨E ---

async def get_vc_coins_settings(guild_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        try:
            row = await conn.fetchrow('SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, use_common_reward, role_scope_per_rule, stack_multiple_roles, common_reward_amount, common_reward_interval FROM vc_coins_settings WHERE guild_id = $1', guild_id)
        except Exception:
            try:
                await conn.execute('ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE')
                row = await conn.fetchrow('SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, use_common_reward, role_scope_per_rule, stack_multiple_roles, common_reward_amount, common_reward_interval FROM vc_coins_settings WHERE guild_id = $1', guild_id)
            except Exception:
                row = await conn.fetchrow('SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM vc_coins_settings WHERE guild_id = $1', guild_id)

        try:
            role_rows = await conn.fetch('SELECT role_id, reward_amount, reward_interval, is_whitelist_mode, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_role_rewards WHERE guild_id = $1', guild_id)
        except Exception:
            role_rows = []

        role_rewards = [
            {
                "role_id": r["role_id"],
                "reward_amount": r["reward_amount"],
                "reward_interval": r["reward_interval"],
                "is_whitelist_mode": r["is_whitelist_mode"],
                "whitelist": r["whitelist_channel_ids"] or [],
                "blacklist": r["blacklist_channel_ids"] or [],
                "categories": r["whitelist_category_ids"] or [],
                "blacklist_categories": r["blacklist_category_ids"] or [],
            }
            for r in role_rows
        ]

        if row:

            def _get(key, default):
                try:
                    return row[key] if key in row and row[key] is not None else default
                except Exception:
                    return default

            return {

                "is_enabled": row["is_enabled"] if "is_enabled" in row and row["is_enabled"] is not None else False,

                "whitelist": row["whitelist_channel_ids"] or [],

                "blacklist": row["blacklist_channel_ids"] or [],

                "categories": row["whitelist_category_ids"] or [],

                "blacklist_categories": row["blacklist_category_ids"] or [],
                "enable_exclude_rank_role": row.get("enable_exclude_rank_role", False) if hasattr(row, "get") else (row["enable_exclude_rank_role"] if "enable_exclude_rank_role" in row else False),
                "exclude_rank_role_ids": row.get("exclude_rank_role_ids", []) if hasattr(row, "get") else (row["exclude_rank_role_ids"] if "exclude_rank_role_ids" in row else []),
                "use_common_reward": _get("use_common_reward", True),
                "role_scope_per_rule": _get("role_scope_per_rule", False),
                "stack_multiple_roles": _get("stack_multiple_roles", False),
                "common_reward_amount": _get("common_reward_amount", 100),
                "common_reward_interval": _get("common_reward_interval", 10),
                "role_rewards": role_rewards,

            }

        else:

            await conn.execute('INSERT INTO vc_coins_settings (guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (guild_id) DO NOTHING', guild_id, False, [], [], [], [], False, [])

            return {"is_enabled": False, "whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": [], "enable_exclude_rank_role": False, "exclude_rank_role_ids": [], "use_common_reward": True, "role_scope_per_rule": False, "stack_multiple_roles": False, "common_reward_amount": 100, "common_reward_interval": 10, "role_rewards": []}



async def get_all_vc_coins_settings() -> list[dict]:

    pools = await get_all_configured_pools()

    all_settings = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                try:
                    rows = await conn.fetch('SELECT guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, use_common_reward, role_scope_per_rule, stack_multiple_roles, common_reward_amount, common_reward_interval FROM vc_coins_settings')
                except Exception:
                    rows = await conn.fetch('SELECT guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_settings')

                try:
                    role_rows = await conn.fetch('SELECT guild_id, role_id, reward_amount, reward_interval, is_whitelist_mode, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_role_rewards')
                except Exception:
                    role_rows = []

                role_rewards_by_guild: dict = {}
                for rr in role_rows:
                    role_rewards_by_guild.setdefault(rr["guild_id"], []).append({
                        "role_id": rr["role_id"],
                        "reward_amount": rr["reward_amount"],
                        "reward_interval": rr["reward_interval"],
                        "is_whitelist_mode": rr["is_whitelist_mode"],
                        "whitelist": rr["whitelist_channel_ids"] or [],
                        "blacklist": rr["blacklist_channel_ids"] or [],
                        "categories": rr["whitelist_category_ids"] or [],
                        "blacklist_categories": rr["blacklist_category_ids"] or [],
                    })

                def _rget(r, key, default):
                    try:
                        return r[key] if key in r and r[key] is not None else default
                    except Exception:
                        return default

                all_settings.extend([

                    {

                        "guild_id": r["guild_id"],

                        "is_enabled": r["is_enabled"] if "is_enabled" in r and r["is_enabled"] is not None else False,

                        "whitelist": r["whitelist_channel_ids"] or [],

                        "blacklist": r["blacklist_channel_ids"] or [],

                        "categories": r["whitelist_category_ids"] or [],

                        "blacklist_categories": r["blacklist_category_ids"] or [],

                        "use_common_reward": _rget(r, "use_common_reward", True),

                        "role_scope_per_rule": _rget(r, "role_scope_per_rule", False),

                        "stack_multiple_roles": _rget(r, "stack_multiple_roles", False),

                        "common_reward_amount": _rget(r, "common_reward_amount", 100),

                        "common_reward_interval": _rget(r, "common_reward_interval", 10),

                        "role_rewards": role_rewards_by_guild.get(r["guild_id"], []),

                    }

                    for r in rows

                ])

        except Exception as e:

            print(f'[DB Error] Failed to fetch vc_coins_settings: {e}')

    return all_settings



async def set_vc_coins_settings(guild_id: int, whitelist_ids: list[int], blacklist_ids: list[int], category_ids: list[int], blacklist_category_ids: list[int]):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO vc_coins_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids)

            VALUES ($1, $2, $3, $4, $5, $6, $7)

            ON CONFLICT (guild_id)

            DO UPDATE SET whitelist_channel_ids = $2, blacklist_channel_ids = $3, whitelist_category_ids = $4, blacklist_category_ids = $5

        ''', guild_id, whitelist_ids, blacklist_ids, category_ids, blacklist_category_ids, False, [])





# --- VC貊槫惠譎る俣邂｡送EE畑髢E謨E ---

async def add_vc_duration(guild_id: int, user_id: int, category_id: int, seconds: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO user_vc_durations (guild_id, user_id, category_id, duration_seconds)

            VALUES ($1, $2, $3, $4)

            ON CONFLICT (guild_id, user_id, category_id)

            DO UPDATE SET duration_seconds = user_vc_durations.duration_seconds + $4

        ''', guild_id, user_id, category_id, seconds)



async def get_vc_duration_for_categories(user_id: int, category_ids: list[int]) -> int:

    if not category_ids:

        return 0

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('''

            SELECT SUM(duration_seconds) FROM user_vc_durations

            WHERE user_id = $1 AND category_id = ANY($2)

        ''', user_id, category_ids)

        return row[0] if row and row[0] is not None else 0



# --- 蟶E險E繝EΦ繝励Ξ繝ｼ繝ESticky Template)邂｡送EE畑髢E謨E ---

async def get_sticky_template(channel_id: int) -> dict:

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT title, content, last_message_id, last_text_message_id FROM sticky_templates WHERE channel_id = $1', channel_id)

        if row:

            return {

                "title": row["title"],

                "content": row["content"],

                "last_message_id": row["last_message_id"],

                "last_text_message_id": row["last_text_message_id"] if "last_text_message_id" in row else None

            }

        return None



async def save_sticky_template(channel_id: int, content: str, title: str = None):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO sticky_templates (channel_id, title, content, last_message_id, last_text_message_id)

            VALUES ($1, $2, $3, NULL, NULL)

            ON CONFLICT (channel_id)

            DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, last_message_id = NULL, last_text_message_id = NULL

        ''', channel_id, title, content)



async def update_sticky_last_message(channel_id: int, message_id: int, text_message_id: int = None):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            UPDATE sticky_templates SET last_message_id = $2, last_text_message_id = $3 WHERE channel_id = $1

        ''', channel_id, message_id, text_message_id)



async def remove_sticky_template(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM sticky_templates WHERE channel_id = $1', channel_id)









async def check_initial_issued(guild_id: int, user_id: int) -> bool:

    user = await get_user(guild_id, user_id)

    return user["initial_issued"]



async def get_reaction_role(message_id: int, emoji: str, guild_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2', message_id, emoji)

        return row['role_id'] if row else None



async def add_evaluation_vc_time(guild_id: int, user_id: int, seconds: int):

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET evaluation_vc_time = evaluation_vc_time + $1 WHERE guild_id = $3 AND user_id = $2', seconds, user_id, guild_id)



async def remove_reaction_role(message_id: int, emoji: str, guild_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM reaction_roles WHERE message_id = $1 AND emoji = $2', message_id, emoji)











async def add_reaction_role(message_id: int, emoji: str, role_id: int, guild_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO reaction_roles (message_id, emoji, role_id)

            VALUES ($1, $2, $3)

            ON CONFLICT (message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id

        ''', message_id, emoji, role_id)

async def get_user_evaluation_counts(target_user_id: int, guild_id: int = None) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('''

            SELECT result, COUNT(*) as count

            FROM user_evaluations

            WHERE target_user_id = $1

            GROUP BY result

        ''', target_user_id)

        return {r['result']: r['count'] for r in rows}



async def add_user_evaluation(user_id: int, evaluator_id: int, evaluator_name: str, score: int, stamp_count: int, comment: str, guild_id: int = None):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO user_evaluations (target_user_id, evaluator_id, evaluator_name, score, stamp_count, comment, created_at)

            VALUES ($1, $2, $3, $4, $5, $6, $7)

        ''', user_id, evaluator_id, evaluator_name, score, stamp_count, comment, get_now_naive())



async def get_user_evaluations(target_user_id: int, guild_id: int = None) -> list[dict]:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('''

            SELECT id as eval_id, evaluator_id, evaluator_name, score, stamp_count, comment, created_at

            FROM user_evaluations

            WHERE target_user_id = $1

            ORDER BY created_at DESC

        ''', target_user_id)

        return [dict(r) for r in rows]



async def set_initial_issued(guild_id: int, user_id: int):

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET initial_issued = TRUE WHERE guild_id = $2 AND user_id = $1', user_id, guild_id)



async def mark_initial_issued(guild_id: int, user_id: int):

    await set_initial_issued(guild_id, user_id)



async def add_interviewer_log(interviewer_id: int, target_user_id: int, guild_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO interviewer_logs (interviewer_id, target_user_id, guild_id)

            VALUES ($1, $2, $3)

            ON CONFLICT (interviewer_id, target_user_id) DO NOTHING

        ''', interviewer_id, target_user_id, guild_id)



async def get_interviewer_count(interviewer_id: int, guild_id: int = None) -> int:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        val = await conn.fetchval('SELECT COUNT(*) FROM interviewer_logs WHERE interviewer_id = $1', interviewer_id)

        return val or 0



# --- 闕EE縺怜ｯE遲冶EE螳夂ｮE送EE畑髢E謨E ---

async def get_antigrief_settings(guild_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT target_category_ids, target_channel_ids, exempt_role_ids FROM antigrief_settings WHERE guild_id = $1', guild_id)

        if row:

            return {

                "categories": row["target_category_ids"] or [],

                "channels": row["target_channel_ids"] or [],

                "exempt_roles": row["exempt_role_ids"] or []

            }

        else:

            await conn.execute('INSERT INTO antigrief_settings (guild_id, target_category_ids, target_channel_ids, exempt_role_ids) VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [])

            return {"categories": [], "channels": [], "exempt_roles": []}



async def get_all_antigrief_settings() -> list[dict]:

    pools = await get_all_configured_pools()

    all_settings = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                rows = await conn.fetch('SELECT guild_id, target_category_ids, target_channel_ids, exempt_role_ids FROM antigrief_settings')

                all_settings.extend([

                    {

                        "guild_id": r["guild_id"],

                        "categories": r["target_category_ids"] or [],

                        "channels": r["target_channel_ids"] or [],

                        "exempt_roles": r["exempt_role_ids"] or []

                    }

                    for r in rows

                ])

        except Exception as e:

            print(f'[DB Error] Failed to fetch antigrief_settings: {e}')

    return all_settings



async def set_antigrief_settings(guild_id: int, category_ids: list[int], channel_ids: list[int], exempt_role_ids: list[int]):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO antigrief_settings (guild_id, target_category_ids, target_channel_ids, exempt_role_ids)

            VALUES ($1, $2, $3, $4)

            ON CONFLICT (guild_id)

            DO UPDATE SET target_category_ids = $2, target_channel_ids = $3, exempt_role_ids = $4

        ''', guild_id, category_ids, channel_ids, exempt_role_ids)



async def update_antigrief_settings_list(guild_id: int, field_type: str, item_id: int, action: str):

    cfg = await get_antigrief_settings(guild_id)

    if field_type == "categories":

        target = cfg["categories"]

    elif field_type == "channels":

        target = cfg["channels"]

    elif field_type == "exempt_roles":

        target = cfg["exempt_roles"]

    else:

        return



    if action == "add":

        if item_id not in target:

            target.append(item_id)

    elif action == "remove":

        if item_id in target:

            target.remove(item_id)



    await set_antigrief_settings(guild_id, cfg["categories"], cfg["channels"], cfg["exempt_roles"])



async def clear_antigrief_settings_field(guild_id: int, field_name: str):

    cfg = await get_antigrief_settings(guild_id)

    if field_name == "target_category_ids":

        cfg["categories"] = []

    elif field_name == "target_channel_ids":

        cfg["channels"] = []

    elif field_name == "exempt_role_ids":

        cfg["exempt_roles"] = []

    else:

        return



    await set_antigrief_settings(guild_id, cfg["categories"], cfg["channels"], cfg["exempt_roles"])



# --- 荳榊E蜷井ｿE豁E・壹Λ繝ｳ繧E蟁E雎｡險E螳壹・譖ｴ譁E逕ｨ髢E謨E ---

async def update_rank_settings_list(guild_id: int, field_type: str, item_id: int, action: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM rank_settings WHERE guild_id = $1', guild_id)

        if not row:

            await conn.execute('INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [], False, [])

            wl_ch, bl_ch, wl_cat, bl_cat = [], [], [], []

        else:

            wl_ch = row["whitelist_channel_ids"] or []

            bl_ch = row["blacklist_channel_ids"] or []

            wl_cat = row["whitelist_category_ids"] or []

            bl_cat = row["blacklist_category_ids"] or []



        if field_type == "whitelist_channels":

            target_list = wl_ch

        elif field_type == "blacklist_channels":

            target_list = bl_ch

        elif field_type == "whitelist_categories":

            target_list = wl_cat

        elif field_type == "blacklist_categories":

            target_list = bl_cat

        else:

            return



        if action == "add":

            if item_id not in target_list:

                target_list.append(item_id)

        elif action == "remove":

            if item_id in target_list:

                target_list.remove(item_id)



        await conn.execute('''

            UPDATE rank_settings

            SET whitelist_channel_ids = $2, blacklist_channel_ids = $3, whitelist_category_ids = $4, blacklist_category_ids = $5

            WHERE guild_id = $1

        ''', guild_id, wl_ch, bl_ch, wl_cat, bl_cat)



async def clear_rank_settings_field(guild_id: int, field_name: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        if field_name in ["whitelist_channel_ids", "blacklist_channel_ids", "whitelist_category_ids", "blacklist_category_ids"]:

            await conn.execute(f'UPDATE rank_settings SET {field_name} = $2 WHERE guild_id = $1', guild_id, [])





async def update_vc_coins_settings_list(guild_id: int, field_type: str, item_id: int, action: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_settings WHERE guild_id = $1', guild_id)

        if not row:

            await conn.execute('INSERT INTO vc_coins_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [], False, [])

            wl_ch, bl_ch, wl_cat, bl_cat = [], [], [], []

        else:

            wl_ch = row["whitelist_channel_ids"] or []

            bl_ch = row["blacklist_channel_ids"] or []

            wl_cat = row["whitelist_category_ids"] or []

            bl_cat = row["blacklist_category_ids"] or []



        if field_type == "whitelist_channels":

            target_list = wl_ch

        elif field_type == "blacklist_channels":

            target_list = bl_ch

        elif field_type == "whitelist_categories":

            target_list = wl_cat

        elif field_type == "blacklist_categories":

            target_list = bl_cat

        else:

            return



        if action == "add":

            if item_id not in target_list:

                target_list.append(item_id)

        elif action == "remove":

            if item_id in target_list:

                target_list.remove(item_id)



        await conn.execute('''

            UPDATE vc_coins_settings

            SET whitelist_channel_ids = $2, blacklist_channel_ids = $3, whitelist_category_ids = $4, blacklist_category_ids = $5

            WHERE guild_id = $1

        ''', guild_id, wl_ch, bl_ch, wl_cat, bl_cat)



async def clear_vc_coins_settings_field(guild_id: int, field_name: str):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        if field_name in ["whitelist_channel_ids", "blacklist_channel_ids", "whitelist_category_ids", "blacklist_category_ids"]:

            await conn.execute(f'UPDATE vc_coins_settings SET {field_name} = $2 WHERE guild_id = $1', guild_id, [])







# 繧E繝ｧ繝E・險E螳・

async def get_shop_settings(guild_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT employee_role_id, manager_role_id, inquiry_mention_role_id, inquiry_mention_role_ids FROM shop_settings WHERE guild_id = $1', guild_id)

        if row:

            try:

                inquiry_val = row["inquiry_mention_role_id"]

            except KeyError:

                inquiry_val = None

            try:

                inquiry_vals = row["inquiry_mention_role_ids"]

            except KeyError:

                inquiry_vals = None

            if inquiry_vals is None:

                inquiry_vals = []

            return {

                "employee_role_id": row["employee_role_id"], 

                "manager_role_id": row["manager_role_id"],

                "inquiry_mention_role_id": inquiry_val,

                "inquiry_mention_role_ids": inquiry_vals

            }

        else:

            return {"employee_role_id": None, "manager_role_id": None, "inquiry_mention_role_id": None, "inquiry_mention_role_ids": []}



async def set_shop_settings(guild_id: int, employee_role_id: int, manager_role_id: int, inquiry_mention_role_id: int, inquiry_mention_role_ids: list):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO shop_settings (guild_id, employee_role_id, manager_role_id, inquiry_mention_role_id, inquiry_mention_role_ids)

            VALUES ($1, $2, $3, $4, $5)

            ON CONFLICT (guild_id) DO UPDATE SET

            employee_role_id = EXCLUDED.employee_role_id,

            manager_role_id = EXCLUDED.manager_role_id,

            inquiry_mention_role_id = EXCLUDED.inquiry_mention_role_id,

            inquiry_mention_role_ids = EXCLUDED.inquiry_mention_role_ids

        ''', guild_id, employee_role_id, manager_role_id, inquiry_mention_role_id, inquiry_mention_role_ids)



# 繧E繝ｧ繝E・蝠・刀髢E騾E

async def get_shop_items(guild_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT item_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days FROM shop_items WHERE guild_id = $1 ORDER BY item_id ASC', guild_id)

        return [dict(r) for r in rows]



async def get_shop_item(item_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT item_id, guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days FROM shop_items WHERE item_id = $1', item_id)

        return dict(row) if row else None



async def add_shop_item(guild_id: int, name: str, usage: str, price: int, target_role_ids: list = None, reward_role_ids: list = None, duration_days: int = None, is_eval_extend: bool = False, extend_days: int = None):

    if target_role_ids is None: target_role_ids = []

    if reward_role_ids is None: reward_role_ids = []

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('''

            INSERT INTO shop_items (guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days)

            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)

            RETURNING item_id

        ''', guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days)

        return dict(row)["item_id"] if row else None



async def update_shop_item(item_id: int, name: str, usage: str, price: int, target_role_ids: list = None, reward_role_ids: list = None, duration_days: int = None, is_eval_extend: bool = False, extend_days: int = None):

    if target_role_ids is None: target_role_ids = []

    if reward_role_ids is None: reward_role_ids = []

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            UPDATE shop_items SET name = $1, usage = $2, price = $3, target_role_ids = $4, reward_role_ids = $5, duration_days = $6, is_eval_extend = $7, extend_days = $8 WHERE item_id = $9

        ''', name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days, item_id)



async def delete_shop_item(item_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM shop_items WHERE item_id = $1', item_id)



async def add_user_item(user_id: int, item_id: int, expire_at: datetime.datetime = None):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO user_items (user_id, item_id, expire_at, role_removed) 

            VALUES ($1, $2, $3, FALSE)

        ''', user_id, item_id, expire_at)



async def get_user_items(user_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT * FROM user_items WHERE user_id = $1', user_id)

        return [dict(r) for r in rows]



async def get_expired_user_items():

    all_expired = []

    for p in await get_all_configured_pools():

        try:

            # 期限切れロールの剥奪（cogs/shop.py の check_expired_roles）には guild_id と reward_role_ids が要るので商品と結合する

            rows = await p.fetch("SELECT ui.id, ui.user_id, ui.item_id, si.guild_id, si.reward_role_ids FROM user_items ui JOIN shop_items si ON si.item_id = ui.item_id WHERE ui.expire_at < $1 AND COALESCE(ui.role_removed, FALSE) = FALSE", get_now_naive())

            all_expired.extend([dict(row) for row in rows])

        except Exception:

            pass

    return all_expired



async def mark_user_item_role_removed(user_item_id: int):
    for p in await get_all_configured_pools():
        try:
            await p.execute("UPDATE user_items SET role_removed = TRUE WHERE id = $1", user_item_id)
        except Exception:
            pass


async def add_level_coin_reward(guild_id: int, level_type: str, level: int, coins: int, condition_role_id: int = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO level_coin_rewards (guild_id, level_type, level, coins, condition_role_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id, level_type, level, condition_role_id)
            DO UPDATE SET coins = EXCLUDED.coins
        ''', guild_id, level_type, level, coins, condition_role_id)


async def get_level_coin_rewards(guild_id: int, level_type: str = None) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if level_type:
            rows = await conn.fetch('''
                SELECT level_type, level, coins, condition_role_id 
                FROM level_coin_rewards 
                WHERE guild_id = $1 AND level_type = $2 
                ORDER BY level ASC
            ''', guild_id, level_type)
        else:
            rows = await conn.fetch('''
                SELECT level_type, level, coins, condition_role_id 
                FROM level_coin_rewards 
                WHERE guild_id = $1
                ORDER BY level_type ASC, level ASC
            ''', guild_id)
        return [{"level_type": r["level_type"], "level": r["level"], "coins": r["coins"], "condition_role_id": r["condition_role_id"]} for r in rows]


async def remove_level_coin_reward(guild_id: int, level_type: str, level: int, condition_role_id: int = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            DELETE FROM level_coin_rewards 
            WHERE guild_id = $1 AND level_type = $2 AND level = $3 AND condition_role_id IS NOT DISTINCT FROM $4
        ''', guild_id, level_type, level, condition_role_id)
        await conn.execute('''
            INSERT INTO self_intro_welcome_messages (guild_id, user_id, message_id, channel_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id) DO UPDATE
            SET message_id = $3, channel_id = $4
        ''', guild_id, user_id, message_id, channel_id)



async def get_self_intro_welcome_message(guild_id: int, user_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT message_id, channel_id FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2',
            guild_id, user_id
        )
        if row:
            return {"message_id": row['message_id'], "channel_id": row['channel_id']}
        return None



async def delete_self_intro_welcome_message(guild_id: int, user_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute(
            'DELETE FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2',
            guild_id, user_id
        )


async def get_call_board_settings(guild_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            return {
                "panel_channel_id": str(row['panel_channel_id']) if row['panel_channel_id'] else "",
                "board_channel_id": str(row['board_channel_id']) if row['board_channel_id'] else "",
                "vc_category_id": str(row['vc_category_id']) if row['vc_category_id'] else ""
            }
        return {"panel_channel_id": "", "board_channel_id": "", "vc_category_id": ""}


async def save_call_board_settings(guild_id: int, panel_channel_id: int, board_channel_id: int, vc_category_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO call_board_settings (guild_id, panel_channel_id, board_channel_id, vc_category_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO UPDATE SET
                panel_channel_id = $2,
                board_channel_id = $3,
                vc_category_id = $4
        ''', guild_id, panel_channel_id, board_channel_id, vc_category_id)


async def add_shop_item(guild_id: int, name: str, usage: str, price: int, target_role_ids: list = None, reward_role_ids: list = None, duration_days: int = None, is_eval_extend: bool = False, extend_days: int = None) -> int:
    if target_role_ids is None: target_role_ids = []
    if reward_role_ids is None: reward_role_ids = []

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('''

            INSERT INTO shop_items (guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days)

            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)

            RETURNING item_id

        ''', guild_id, name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days)

        return dict(row)["item_id"] if row else None



async def update_shop_item(item_id: int, name: str, usage: str, price: int, target_role_ids: list = None, reward_role_ids: list = None, duration_days: int = None, is_eval_extend: bool = False, extend_days: int = None):

    if target_role_ids is None: target_role_ids = []

    if reward_role_ids is None: reward_role_ids = []

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            UPDATE shop_items SET name = $1, usage = $2, price = $3, target_role_ids = $4, reward_role_ids = $5, duration_days = $6, is_eval_extend = $7, extend_days = $8 WHERE item_id = $9

        ''', name, usage, price, target_role_ids, reward_role_ids, duration_days, is_eval_extend, extend_days, item_id)



async def delete_shop_item(item_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM shop_items WHERE item_id = $1', item_id)



async def add_user_item(user_id: int, item_id: int, expire_at: datetime.datetime = None):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO user_items (user_id, item_id, expire_at, role_removed) 

            VALUES ($1, $2, $3, FALSE)

        ''', user_id, item_id, expire_at)



async def get_user_items(user_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        rows = await conn.fetch('SELECT * FROM user_items WHERE user_id = $1', user_id)

        return [dict(r) for r in rows]



async def get_expired_user_items():

    all_expired = []

    for p in await get_all_configured_pools():

        try:

            # 期限切れロールの剥奪（cogs/shop.py の check_expired_roles）には guild_id と reward_role_ids が要るので商品と結合する

            rows = await p.fetch("SELECT ui.id, ui.user_id, ui.item_id, si.guild_id, si.reward_role_ids FROM user_items ui JOIN shop_items si ON si.item_id = ui.item_id WHERE ui.expire_at < $1 AND COALESCE(ui.role_removed, FALSE) = FALSE", get_now_naive())

            all_expired.extend([dict(row) for row in rows])

        except Exception:

            pass

    return all_expired



async def mark_user_item_role_removed(user_item_id: int):
    for p in await get_all_configured_pools():
        try:
            await p.execute("UPDATE user_items SET role_removed = TRUE WHERE id = $1", user_item_id)
        except Exception:
            pass


async def add_level_coin_reward(guild_id: int, level_type: str, level: int, coins: int, condition_role_id: int = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO level_coin_rewards (guild_id, level_type, level, coins, condition_role_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id, level_type, level, condition_role_id)
            DO UPDATE SET coins = EXCLUDED.coins
        ''', guild_id, level_type, level, coins, condition_role_id)


async def get_level_coin_rewards(guild_id: int, level_type: str = None) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if level_type:
            rows = await conn.fetch('''
                SELECT level_type, level, coins, condition_role_id 
                FROM level_coin_rewards 
                WHERE guild_id = $1 AND level_type = $2 
                ORDER BY level ASC
            ''', guild_id, level_type)
        else:
            rows = await conn.fetch('''
                SELECT level_type, level, coins, condition_role_id 
                FROM level_coin_rewards 
                WHERE guild_id = $1
                ORDER BY level_type ASC, level ASC
            ''', guild_id)
        return [{"level_type": r["level_type"], "level": r["level"], "coins": r["coins"], "condition_role_id": r["condition_role_id"]} for r in rows]


async def remove_level_coin_reward(guild_id: int, level_type: str, level: int, condition_role_id: int = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            DELETE FROM level_coin_rewards 
            WHERE guild_id = $1 AND level_type = $2 AND level = $3 AND condition_role_id IS NOT DISTINCT FROM $4
        ''', guild_id, level_type, level, condition_role_id)


async def save_self_intro_welcome_message(guild_id: int, user_id: int, message_id: int, channel_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO self_intro_welcome_messages (guild_id, user_id, message_id, channel_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id) DO UPDATE
            SET message_id = $3, channel_id = $4
        ''', guild_id, user_id, message_id, channel_id)



async def get_self_intro_welcome_message(guild_id: int, user_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT message_id, channel_id FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2',
            guild_id, user_id
        )
        if row:
            return {"message_id": row['message_id'], "channel_id": row['channel_id']}
        return None



async def delete_self_intro_welcome_message(guild_id: int, user_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute(
            'DELETE FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2',
            guild_id, user_id
        )


async def get_call_board_settings(guild_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            return {
                "panel_channel_id": str(row['panel_channel_id']) if row['panel_channel_id'] else "",
                "board_channel_id": str(row['board_channel_id']) if row['board_channel_id'] else "",
                "vc_category_id": str(row['vc_category_id']) if row['vc_category_id'] else ""
            }
        return {"panel_channel_id": "", "board_channel_id": "", "vc_category_id": ""}


async def save_call_board_settings(guild_id: int, panel_channel_id: int, board_channel_id: int, vc_category_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO call_board_settings (guild_id, panel_channel_id, board_channel_id, vc_category_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO UPDATE
            SET panel_channel_id = $2, board_channel_id = $3, vc_category_id = $4
        ''', guild_id, panel_channel_id, board_channel_id, vc_category_id)


# --- 以下、他セチEョンによるdatabase.py書き換え時に誤って削除されてぁE関数を復允E---

async def get_expired_evaluation_periods() -> list:
    pools = await get_all_configured_pools()
    now = get_now_naive()
    all_expired = []
    for p in pools:
        try:
            async with p.acquire() as conn:
                rows = await conn.fetch('''
                    SELECT guild_id, user_id, start_time, end_time
                    FROM evaluation_periods
                    WHERE end_time < $1
                ''', now)
                all_expired.extend([dict(row) for row in rows])
        except Exception as e:
            print(f'[DB Error] Failed to fetch expired evaluation periods: {e}')
    return all_expired


async def get_interviewer_stats(guild_id: int, interviewer_id: int) -> int:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow('SELECT total_handled FROM interviewer_stats WHERE guild_id = $1 AND interviewer_id = $2', guild_id, interviewer_id)
        return row['total_handled'] if row else 0


async def increment_interviewer_stats(guild_id: int, interviewer_id: int) -> int:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow('''
            INSERT INTO interviewer_stats (guild_id, interviewer_id, total_handled)
            VALUES ($1, $2, 1)
            ON CONFLICT (guild_id, interviewer_id)
            DO UPDATE SET total_handled = interviewer_stats.total_handled + 1
            RETURNING total_handled
        ''', guild_id, interviewer_id)
        return row['total_handled']


async def set_interviewer_stats(guild_id: int, interviewer_id: int, total: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO interviewer_stats (guild_id, interviewer_id, total_handled)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, interviewer_id)
            DO UPDATE SET total_handled = $3
        ''', guild_id, interviewer_id, total)


async def get_all_interviewer_stats(guild_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        rows = await conn.fetch('SELECT interviewer_id, total_handled FROM interviewer_stats WHERE guild_id = $1 ORDER BY total_handled DESC', guild_id)
        return [{"interviewer_id": str(r['interviewer_id']), "total_handled": r['total_handled']} for r in rows]


async def update_available_commands(commands_to_sync: list):
    p = await get_master_pool()
    async with p.acquire() as conn:
        valid_names = [cmd['name'] for cmd in commands_to_sync]
        if valid_names:
            await conn.execute('''
                DELETE FROM available_commands WHERE NOT (command_name = ANY($1::text[]))
            ''', valid_names)
        for cmd in commands_to_sync:
            await conn.execute('''
                INSERT INTO available_commands (command_name, description, category)
                VALUES ($1, $2, $3)
                ON CONFLICT (command_name) DO UPDATE
                SET description = EXCLUDED.description, category = EXCLUDED.category
            ''', cmd['name'], cmd['description'], cmd['category'])


async def is_command_enabled(guild_id: int, command_name: str) -> bool:
    if guild_id is None:
        return True

    pool = await get_pool(guild_id)
    if not pool:
        return True

    async with pool.acquire() as conn:
        row = await conn.fetchrow('''
            SELECT is_enabled FROM command_settings
            WHERE guild_id = $1 AND (command_name = $2 OR command_name = $3)
            ORDER BY is_enabled ASC LIMIT 1
        ''', guild_id, command_name, f'/{command_name}')

        if row is not None:
            return row['is_enabled']

        return True


# --- 自己紹介ロール設宁E---

def _parse_channel_roles(raw) -> list:
    """チャンネルごとの追加ロール [{channel_id, role_ids, enabled}] を読み込む。"""
    try:
        items = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except Exception:
        return []
    rules = []
    for item in items if isinstance(items, list) else []:
        try:
            channel_id = int(item.get("channel_id"))
            role_ids = [int(r) for r in (item.get("role_ids") or []) if str(r).isdigit()]
        except (TypeError, ValueError, AttributeError):
            continue
        rules.append({"channel_id": channel_id, "role_ids": role_ids, "enabled": item.get("enabled", True) is not False})
    return rules


async def get_self_intro_role_settings(guild_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT channel_id, channel_ids, welcome_channel_id, role_id, template, is_enabled, channel_roles_enabled, channel_roles::text AS channel_roles FROM self_intro_role_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            # 複数の自己紹介チャンネル。未設定（以前の設定）なら channel_id の1つだけ
            channel_ids = [int(c) for c in (row['channel_ids'] or []) if c] or ([row['channel_id']] if row['channel_id'] else [])
            return {
                "channel_id": row['channel_id'],
                "channel_ids": channel_ids,
                "welcome_channel_id": row['welcome_channel_id'],
                "role_id": row['role_id'],
                "template": row['template'],
                "is_enabled": row['is_enabled'],
                "channel_roles_enabled": bool(row['channel_roles_enabled']),
                "channel_roles": _parse_channel_roles(row['channel_roles']),
            }
        return {"channel_id": None, "welcome_channel_id": None, "role_id": None, "template": None, "is_enabled": False}


async def save_self_intro_role_settings(guild_id: int, channel_id, welcome_channel_id, role_id, template: str, is_enabled: bool):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO self_intro_role_settings (guild_id, channel_id, welcome_channel_id, role_id, template, is_enabled)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (guild_id) DO UPDATE
            SET channel_id = $2, welcome_channel_id = $3, role_id = $4, template = $5, is_enabled = $6
        ''', guild_id, channel_id, welcome_channel_id, role_id, template, is_enabled)


async def save_self_intro_welcome_message(guild_id: int, user_id: int, message_id: int, channel_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO self_intro_welcome_messages (guild_id, user_id, message_id, channel_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id) DO UPDATE
            SET message_id = $3, channel_id = $4
        ''', guild_id, user_id, message_id, channel_id)


async def ensure_user(guild_id: int, user_id: int):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO users (guild_id, user_id) VALUES ($1, $2)
            ON CONFLICT (guild_id, user_id) DO NOTHING
            ''',
            guild_id, user_id
        )


async def get_top_users(guild_id: int, mode: str, limit: int = 10) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        if mode == "tc":
            rows = await conn.fetch('''
                SELECT user_id, tc_level as level, tc_xp as xp
                FROM users
                WHERE guild_id = $1
                ORDER BY tc_level DESC, tc_xp DESC
                LIMIT $2
            ''', guild_id, limit)
        else:
            rows = await conn.fetch('''
                SELECT user_id, vc_level as level, vc_xp as xp
                FROM users
                WHERE guild_id = $1
                ORDER BY vc_level DESC, vc_xp DESC
                LIMIT $2
            ''', guild_id, limit)
        return [{"user_id": r["user_id"], "level": r["level"], "xp": r["xp"]} for r in rows]


async def remove_evaluation_period(guild_id: int, user_id: int):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute(
            'DELETE FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2',
            guild_id, user_id
        )

# ------------------------------------------------------------
# Bot Heartbeat
# ------------------------------------------------------------

async def update_heartbeat(guild_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS bot_heartbeat (
                guild_id BIGINT PRIMARY KEY,
                last_seen_at TIMESTAMP NOT NULL
            )
        ''')
        await conn.execute('''
            INSERT INTO bot_heartbeat (guild_id, last_seen_at)
            VALUES ($1, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            ON CONFLICT (guild_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        ''', guild_id)


async def get_heartbeat(guild_id: int) -> dict | None:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                'SELECT last_seen_at FROM bot_heartbeat WHERE guild_id = $1',
                guild_id
            )
            if row:
                return {"last_seen_at": row['last_seen_at']}
            return None
        except Exception:
            return None


# ------------------------------------------------------------
# Invite issuers (招待リンクパネルで発行したユーザーの記録)
# ------------------------------------------------------------

async def save_invite_issuer(guild_id: int, code: str, issuer_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO invite_issuers (guild_id, code, issuer_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, code) DO UPDATE SET issuer_id = $3
        ''', guild_id, code, issuer_id)


async def get_invite_issuer(guild_id: int, code: str) -> int | None:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        return await conn.fetchval(
            'SELECT issuer_id FROM invite_issuers WHERE guild_id = $1 AND code = $2',
            guild_id, code
        )


async def archive_user_data(guild_id: int, user_id: int) -> bool:
    """削除する前にランク・通貨を退避しておく。

    退出時にデータを消す運用でも、再参加したときにランクを戻せるようにする。
    アイテムやガチャロールは対象外。"""
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                '''SELECT balance, tc_xp, tc_level, vc_xp, vc_level,
                          evaluation_vc_time, event_points, initial_issued
                   FROM users WHERE guild_id = $1 AND user_id = $2''',
                guild_id, user_id
            )
            if row is None:
                return False
            await conn.execute(
                '''INSERT INTO deleted_user_data
                       (guild_id, user_id, balance, tc_xp, tc_level, vc_xp, vc_level,
                        evaluation_vc_time, event_points, initial_issued, deleted_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                   ON CONFLICT (guild_id, user_id) DO UPDATE SET
                       balance = EXCLUDED.balance,
                       tc_xp = EXCLUDED.tc_xp,
                       tc_level = EXCLUDED.tc_level,
                       vc_xp = EXCLUDED.vc_xp,
                       vc_level = EXCLUDED.vc_level,
                       evaluation_vc_time = EXCLUDED.evaluation_vc_time,
                       event_points = EXCLUDED.event_points,
                       initial_issued = EXCLUDED.initial_issued,
                       deleted_at = EXCLUDED.deleted_at''',
                guild_id, user_id,
                row["balance"] or 0, row["tc_xp"] or 0, row["tc_level"] or 1,
                row["vc_xp"] or 0, row["vc_level"] or 1,
                row["evaluation_vc_time"] or 0, row["event_points"] or 0,
                bool(row["initial_issued"]), get_now_naive()
            )
            return True
        except Exception as e:
            print(f"[UserData Archive] Failed to archive user {user_id} in guild {guild_id}: {e}")
            return False


async def restore_user_data(guild_id: int, user_id: int) -> dict | None:
    """退避しておいたランク・通貨を復元する。復元した内容を返す。"""
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                '''SELECT balance, tc_xp, tc_level, vc_xp, vc_level,
                          evaluation_vc_time, event_points, initial_issued
                   FROM deleted_user_data WHERE guild_id = $1 AND user_id = $2''',
                guild_id, user_id
            )
            if row is None:
                return None
            await conn.execute(
                '''INSERT INTO users
                       (guild_id, user_id, balance, tc_xp, tc_level, vc_xp, vc_level,
                        evaluation_vc_time, event_points, initial_issued)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                   ON CONFLICT (guild_id, user_id) DO UPDATE SET
                       balance = EXCLUDED.balance,
                       tc_xp = EXCLUDED.tc_xp,
                       tc_level = EXCLUDED.tc_level,
                       vc_xp = EXCLUDED.vc_xp,
                       vc_level = EXCLUDED.vc_level,
                       evaluation_vc_time = EXCLUDED.evaluation_vc_time,
                       event_points = EXCLUDED.event_points,
                       initial_issued = EXCLUDED.initial_issued''',
                guild_id, user_id,
                row["balance"] or 0, row["tc_xp"] or 0, row["tc_level"] or 1,
                row["vc_xp"] or 0, row["vc_level"] or 1,
                row["evaluation_vc_time"] or 0, row["event_points"] or 0,
                bool(row["initial_issued"])
            )
            await conn.execute(
                'DELETE FROM deleted_user_data WHERE guild_id = $1 AND user_id = $2',
                guild_id, user_id
            )
            print(f"[UserData Restore] Restored data for user {user_id} in guild {guild_id}.")
            return dict(row)
        except Exception as e:
            print(f"[UserData Restore] Failed to restore user {user_id} in guild {guild_id}: {e}")
            return None


async def delete_user_data(guild_id: int, user_id: int):
    # 退出者のランク・通貨は消す前に退避しておき、再参加時に戻せるようにする
    await archive_user_data(guild_id, user_id)
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        try:
            await conn.execute('DELETE FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM user_items WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM user_vc_durations WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM gacha_user_roles WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            print(f"[UserData Cleanup] Successfully deleted data for user {user_id} in guild {guild_id} upon leave.")
        except Exception as e:
            print(f"[UserData Cleanup] Error deleting user data for user {user_id} in guild {guild_id}: {e}")


# --- 福引ガチャ ---

async def get_gacha_settings(guild_id: int) -> dict:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT allowed_role_ids, pull_cost, is_enabled, panel_channel_id FROM gacha_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            return {
                "allowed_role_ids": [str(r) for r in (row["allowed_role_ids"] or [])],
                "pull_cost": row["pull_cost"],
                "is_enabled": row["is_enabled"],
                "panel_channel_id": str(row["panel_channel_id"]) if row["panel_channel_id"] else "",
            }
        return {"allowed_role_ids": [], "pull_cost": 0, "is_enabled": True, "panel_channel_id": ""}


async def save_gacha_settings(guild_id: int, allowed_role_ids: list[int], pull_cost: int, is_enabled: bool, panel_channel_id: int = None):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO gacha_settings (guild_id, allowed_role_ids, pull_cost, is_enabled, panel_channel_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (guild_id) DO UPDATE
            SET allowed_role_ids = $2, pull_cost = $3, is_enabled = $4, panel_channel_id = $5
        ''', guild_id, allowed_role_ids, pull_cost, is_enabled, panel_channel_id)


async def get_gacha_prizes(guild_id: int) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch(
            'SELECT id, prize_number, prize_name, weight, reward_coins, reward_role_id, reward_role_duration_days FROM gacha_prizes WHERE guild_id = $1 ORDER BY prize_number ASC',
            guild_id
        )
        return [dict(r) for r in rows]


async def replace_gacha_prizes(guild_id: int, prizes: list[dict]):
    """ダッシュボードからの保存時、その guild の景品リストを丸ごと入れ替える"""
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        async with conn.transaction():
            await conn.execute('DELETE FROM gacha_prizes WHERE guild_id = $1', guild_id)
            for prize in prizes:
                await conn.execute('''
                    INSERT INTO gacha_prizes (guild_id, prize_number, prize_name, weight, reward_coins, reward_role_id, reward_role_duration_days)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                ''', guild_id, prize["prize_number"], prize["prize_name"], prize.get("weight", 1),
                    prize.get("reward_coins", 0), prize.get("reward_role_id"), prize.get("reward_role_duration_days", 0))


async def add_gacha_history(guild_id: int, user_id: int, prize_id: int, prize_number: int, prize_name: str):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO gacha_history (guild_id, user_id, prize_id, prize_number, prize_name)
            VALUES ($1, $2, $3, $4, $5)
        ''', guild_id, user_id, prize_id, prize_number, prize_name)


async def add_gacha_user_role(guild_id: int, user_id: int, role_id: int, duration_days: int, prize_id: int = None) -> datetime.datetime:
    """有効期限付きロールのレコードを追加または既存期限を延長する"""
    now = get_now_naive()
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        existing = await conn.fetchrow('''
            SELECT id, expires_at FROM gacha_user_roles
            WHERE guild_id = $1 AND user_id = $2 AND role_id = $3 AND role_removed = FALSE AND expires_at > $4
            ORDER BY expires_at DESC LIMIT 1
        ''', guild_id, user_id, role_id, now)

        if existing:
            base_time = max(existing['expires_at'], now)
            new_expires_at = base_time + datetime.timedelta(days=duration_days)
            await conn.execute('''
                UPDATE gacha_user_roles
                SET expires_at = $1, prize_id = COALESCE($2, prize_id)
                WHERE id = $3
            ''', new_expires_at, prize_id, existing['id'])
            return new_expires_at
        else:
            new_expires_at = now + datetime.timedelta(days=duration_days)
            await conn.execute('''
                INSERT INTO gacha_user_roles (guild_id, user_id, role_id, prize_id, expires_at, role_removed)
                VALUES ($1, $2, $3, $4, $5, FALSE)
            ''', guild_id, user_id, role_id, prize_id, new_expires_at)
            return new_expires_at


async def get_expired_gacha_user_roles() -> list[dict]:
    """期限切れになった福引ロールを全設定プールから取得"""
    now = get_now_naive()
    all_expired = []
    for p in await get_all_configured_pools():
        try:
            rows = await p.fetch('''
                SELECT id, guild_id, user_id, role_id, prize_id, expires_at
                FROM gacha_user_roles
                WHERE expires_at < $1 AND role_removed = FALSE
            ''', now)
            all_expired.extend([dict(r) for r in rows])
        except Exception:
            pass
    return all_expired


async def mark_gacha_user_role_removed(record_id: int):
    """ロール剥奪完了フラグを更新"""
    for p in await get_all_configured_pools():
        try:
            await p.execute('UPDATE gacha_user_roles SET role_removed = TRUE WHERE id = $1', record_id)
        except Exception:
            pass

