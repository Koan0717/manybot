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

guild_to_db = {}

master_pool = None

import inspect



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



async def get_guild_db_url(guild_id: int):

    if guild_id in guild_to_db:

        return guild_to_db[guild_id]

    p = await get_master_pool()

    try:

        val = await p.fetchval("SELECT database_url FROM guild_databases WHERE guild_id = $1", guild_id)

        guild_to_db[guild_id] = val

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

        guild_to_db[guild_id] = url

        new_pool = await get_pool(guild_id)

        await setup_db_schema(new_pool)

    else:

        await p.execute("DELETE FROM guild_databases WHERE guild_id = $1", guild_id)

        guild_to_db[guild_id] = None



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

                print(f"❁E[DB Error] Supabase (専用DB) への接続に失敗しました (ギルドID: {guild_id}): {e}")

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

        await conn.execute('''

            CREATE TABLE IF NOT EXISTS rooms (

                channel_id BIGINT PRIMARY KEY,

                owner_id BIGINT,

                room_type TEXT,

                expire_at TIMESTAMP

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
                is_enabled BOOLEAN DEFAULT TRUE
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

                exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}'

            )

        ''')

        try:
            await conn.execute('ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE')
        except Exception:
            pass



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



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS self_intro_welcome_messages (

                guild_id    BIGINT,

                user_id     BIGINT,

                message_id  BIGINT,

                channel_id  BIGINT,

                PRIMARY KEY (guild_id, user_id)

            )

        ''')



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



async def transfer_balance(guild_id: int, sender_id: int, receiver_id: int, amount: int) -> bool:

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

            return True



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



async def add_room(channel_id: int, owner_id: int, room_type: str, expire_at: datetime.datetime, trigger_channel_id: int = None):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('INSERT INTO rooms (channel_id, owner_id, room_type, expire_at, trigger_channel_id) VALUES ($1, $2, $3, $4, $5)', 

                         channel_id, owner_id, room_type, expire_at, trigger_channel_id)



async def get_room(channel_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT owner_id, room_type, expire_at, trigger_channel_id FROM rooms WHERE channel_id = $1', channel_id)

        if row:

            return {"owner_id": row['owner_id'], "room_type": row['room_type'], "expire_at": row['expire_at'], "trigger_channel_id": row['trigger_channel_id']}

        return None





async def has_room_type(owner_id: int, room_types: list[str]) -> bool:

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT 1 FROM rooms WHERE owner_id = $1 AND room_type = ANY($2) LIMIT 1', owner_id, room_types)

        return row is not None



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

        row = await conn.fetchrow('SELECT base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids FROM auto_vc_config WHERE channel_id = $1', channel_id)

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
                
                "allowed_role_ids": list(row["allowed_role_ids"]) if row["allowed_role_ids"] else []

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

                rows = await conn.fetch('SELECT channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel, is_invite_only, invite_visible_role_ids, allowed_role_ids FROM auto_vc_config')

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

                    "allowed_role_ids": list(r["allowed_role_ids"]) if r["allowed_role_ids"] else []

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

async def save_custom_ticket_panel(guild_id: int, channel_id: int, panel_title: str, panel_description: str, button_label: str = "チケットを作成する", button_emoji: str = None, mention_role_ids: list[int] = None, target_role_ids: list[int] = None, ticket_prefix: str = "ticket", panel_type: str = "custom_ticket"):

    mention_role_ids = mention_role_ids or []

    target_role_ids = target_role_ids or []

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO custom_ticket_panels (

                channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type

            ) 

            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 

            ON CONFLICT (channel_id) 

            DO UPDATE SET 

                panel_title = $2,

                panel_description = $3,

                button_label = $4,

                button_emoji = $5,

                mention_role_ids = $6,

                target_role_ids = $7,

                ticket_prefix = $8,

                panel_type = $9

        ''', channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type)



async def get_custom_ticket_panel(guild_id: int, channel_id: int) -> dict:

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        row = await conn.fetchrow('''

            SELECT panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type 

            FROM custom_ticket_panels 

            WHERE channel_id = $1

        ''', channel_id)

        if row:

            return {

                "panel_title": row["panel_title"],

                "panel_description": row["panel_description"],

                "button_label": row["button_label"],

                "button_emoji": row["button_emoji"],

                "mention_role_ids": row["mention_role_ids"] or [],

                "target_role_ids": row["target_role_ids"] or [],

                "ticket_prefix": row["ticket_prefix"] or "ticket",

                "panel_type": (row["panel_type"] if "panel_type" in row.keys() else None) or "custom_ticket"

            }

        return None



async def remove_custom_ticket_panel(guild_id: int, channel_id: int):

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM custom_ticket_panels WHERE channel_id = $1', channel_id)



async def get_panel_requests(guild_ids: list[int] = None) -> list[dict]:

    pools = await get_all_configured_pools()

    all_requests = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                if guild_ids is not None:

                    rows = await conn.fetch('SELECT id, guild_id, channel_id, panel_type FROM panel_requests WHERE guild_id = ANY($1::bigint[]) ORDER BY created_at ASC LIMIT 10', guild_ids)

                else:

                    rows = await conn.fetch('SELECT id, guild_id, channel_id, panel_type FROM panel_requests ORDER BY created_at ASC LIMIT 10')

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
            row = await conn.fetchrow('SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM vc_coins_settings WHERE guild_id = $1', guild_id)
        except Exception:
            try:
                await conn.execute('ALTER TABLE vc_coins_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE')
                row = await conn.fetchrow('SELECT is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM vc_coins_settings WHERE guild_id = $1', guild_id)
            except Exception:
                row = await conn.fetchrow('SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM vc_coins_settings WHERE guild_id = $1', guild_id)

        if row:

            return {

                "is_enabled": row["is_enabled"] if "is_enabled" in row and row["is_enabled"] is not None else False,

                "whitelist": row["whitelist_channel_ids"] or [],

                "blacklist": row["blacklist_channel_ids"] or [],

                "categories": row["whitelist_category_ids"] or [],

                "blacklist_categories": row["blacklist_category_ids"] or [],
                "enable_exclude_rank_role": row.get("enable_exclude_rank_role", False) if hasattr(row, "get") else (row["enable_exclude_rank_role"] if "enable_exclude_rank_role" in row else False),
                "exclude_rank_role_ids": row.get("exclude_rank_role_ids", []) if hasattr(row, "get") else (row["exclude_rank_role_ids"] if "exclude_rank_role_ids" in row else [])

            }

        else:

            await conn.execute('INSERT INTO vc_coins_settings (guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (guild_id) DO NOTHING', guild_id, False, [], [], [], [], False, [])

            return {"is_enabled": False, "whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": [], "enable_exclude_rank_role": False, "exclude_rank_role_ids": []}



async def get_all_vc_coins_settings() -> list[dict]:

    pools = await get_all_configured_pools()

    all_settings = []

    for p in pools:

        try:

            async with p.acquire() as conn:

                try:
                    rows = await conn.fetch('SELECT guild_id, is_enabled, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_settings')
                except Exception:
                    rows = await conn.fetch('SELECT guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM vc_coins_settings')

                all_settings.extend([

                    {

                        "guild_id": r["guild_id"],

                        "is_enabled": r["is_enabled"] if "is_enabled" in r and r["is_enabled"] is not None else False,

                        "whitelist": r["whitelist_channel_ids"] or [],

                        "blacklist": r["blacklist_channel_ids"] or [],

                        "categories": r["whitelist_category_ids"] or [],

                        "blacklist_categories": r["blacklist_category_ids"] or []

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

            INSERT INTO user_vc_durations (user_id, category_id, duration_seconds)

            VALUES ($1, $2, $3)

            ON CONFLICT (user_id, category_id)

            DO UPDATE SET duration_seconds = user_vc_durations.duration_seconds + $3

        ''', user_id, category_id, seconds)



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



async def get_reaction_role(message_id: int, emoji: str):

    p = await get_pool()

    async with p.acquire() as conn:

        row = await conn.fetchrow('SELECT role_id FROM reaction_roles WHERE message_id = $1 AND emoji = $2', message_id, emoji)

        return row['role_id'] if row else None



async def add_evaluation_vc_time(guild_id: int, user_id: int, seconds: int):

    await get_user(guild_id, user_id)

    p = await get_pool(guild_id)

    async with p.acquire() as conn:

        await conn.execute('UPDATE users SET evaluation_vc_time = evaluation_vc_time + $1 WHERE guild_id = $3 AND user_id = $2', seconds, user_id, guild_id)



async def remove_reaction_role(message_id: int, emoji: str):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('DELETE FROM reaction_roles WHERE message_id = $1 AND emoji = $2', message_id, emoji)











async def add_reaction_role(message_id: int, emoji: str, role_id: int):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO reaction_roles (message_id, emoji, role_id)

            VALUES ($1, $2, $3)

            ON CONFLICT (message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id

        ''', message_id, emoji, role_id)





        await conn.execute('''

            CREATE TABLE IF NOT EXISTS shop_settings (

                guild_id BIGINT PRIMARY KEY,

                employee_role_id BIGINT,

                manager_role_id BIGINT

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

            print(f"[Migration] shop_items duplicate migration warning: {e}")



        await conn.execute('''

            CREATE TABLE IF NOT EXISTS user_items (

                id SERIAL PRIMARY KEY,

                guild_id BIGINT,

                user_id BIGINT,

                item_id INTEGER,

                purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

            )

        ''')



        try:

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT NULL')

        except Exception as e:

            print(f"[Migration] shop_items duration_days migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS expire_at TIMESTAMP DEFAULT NULL')

            await conn.execute('ALTER TABLE user_items ADD COLUMN IF NOT EXISTS role_removed BOOLEAN DEFAULT FALSE')

        except Exception as e:

            print(f"[Migration] user_items columns migration warning: {e}")



        try:

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS is_eval_extend BOOLEAN DEFAULT FALSE')

            await conn.execute('ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS extend_days INTEGER DEFAULT NULL')

        except Exception as e:

            print(f"[Migration] shop_items eval_extend migration warning: {e}")



        # user_evaluations columns migration

        try:

            await conn.execute('ALTER TABLE user_evaluations ADD COLUMN IF NOT EXISTS evaluator_name TEXT')

            await conn.execute('ALTER TABLE user_evaluations ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0')

            await conn.execute('ALTER TABLE user_evaluations ADD COLUMN IF NOT EXISTS stamp_count INTEGER DEFAULT 0')

            await conn.execute('ALTER TABLE user_evaluations ADD COLUMN IF NOT EXISTS comment TEXT')

        except Exception as e:

            print(f"[Migration] user_evaluations columns migration warning: {e}")



        try:

            # Migrate all tables that should have guild_id

            tables_to_migrate = [

                "users", "evaluation_periods", "bot_settings", "antigrief_settings", 

                "level_role_rewards", "panel_requests", "log_settings", "evaluation_settings", 

                "rank_settings", "vc_coins_settings", "interviewer_logs", "user_evaluations", 

                "user_vc_durations", "shop_settings", "shop_items", "user_items", "level_coin_rewards"

            ]

            

            default_guild_id = 1111621213446053898 # 譌｢蟁E・繝E・繧E繧堤EE陦後E繧九ョ繝輔か繝ｫ繝医し繝ｼ繝E・ID

            

            for table in tables_to_migrate:

                try:

                    # try to add column, it will error if it already exists

                    await conn.execute(f'ALTER TABLE {table} ADD COLUMN guild_id BIGINT')

                    await conn.execute(f'UPDATE {table} SET guild_id = $1 WHERE guild_id IS NULL', default_guild_id)

                except Exception:

                    pass # column likely already exists

                

                try:

                    # Recreate primary keys for specific tables if necessary

                    if table == "users":

                        await conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_pkey CASCADE')

                        await conn.execute(f'ALTER TABLE {table} ADD PRIMARY KEY (guild_id, user_id)')

                    elif table in ["antigrief_settings", "evaluation_settings", "rank_settings", "vc_coins_settings", "shop_settings"]:

                        await conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_pkey CASCADE')

                        await conn.execute(f'ALTER TABLE {table} ADD PRIMARY KEY (guild_id)')

                    elif table == "level_role_rewards":

                        await conn.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL')

                        await conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_pkey CASCADE')

                        await conn.execute(f'ALTER TABLE {table} ADD PRIMARY KEY (guild_id, level_type, level, role_id, condition_role_id)')

                    elif table == "level_coin_rewards":

                        await conn.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS condition_role_id BIGINT DEFAULT NULL')

                        await conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_pkey CASCADE')

                        await conn.execute(f'ALTER TABLE {table} ADD PRIMARY KEY (guild_id, level_type, level, condition_role_id)')

                    print(f"[Migration] Added guild_id to {table} and migrated data.")

                except Exception as e:

                    print(f"[Migration] {table} PK migration warning: {e}")

        except Exception as e:

            print(f"[Migration] Comprehensive migration error: {e}")



async def get_user_evaluation_counts(target_user_id: int) -> dict:

    p = await get_pool()

    async with p.acquire() as conn:

        rows = await conn.fetch('''

            SELECT result, COUNT(*) as count

            FROM user_evaluations

            WHERE target_user_id = $1

            GROUP BY result

        ''', target_user_id)

        return {r['result']: r['count'] for r in rows}



async def add_user_evaluation(user_id: int, evaluator_id: int, evaluator_name: str, score: int, stamp_count: int, comment: str):

    p = await get_pool()

    async with p.acquire() as conn:

        await conn.execute('''

            INSERT INTO user_evaluations (target_user_id, evaluator_id, evaluator_name, score, stamp_count, comment, created_at)

            VALUES ($1, $2, $3, $4, $5, $6, $7)

        ''', user_id, evaluator_id, evaluator_name, score, stamp_count, comment, get_now_naive())



async def get_user_evaluations(target_user_id: int) -> list[dict]:

    p = await get_pool()

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



async def get_interviewer_count(interviewer_id: int) -> int:

    p = await get_pool()

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

            rows = await p.fetch("SELECT id, user_id, item_id FROM user_items WHERE expire_at < $1 AND role_removed = FALSE", get_now_naive())

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

            rows = await p.fetch("SELECT id, user_id, item_id FROM user_items WHERE expire_at < $1 AND role_removed = FALSE", get_now_naive())

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

async def get_self_intro_role_settings(guild_id: int) -> dict:
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT channel_id, welcome_channel_id, role_id, template, is_enabled FROM self_intro_role_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            return {
                "channel_id": row['channel_id'],
                "welcome_channel_id": row['welcome_channel_id'],
                "role_id": row['role_id'],
                "template": row['template'],
                "is_enabled": row['is_enabled'],
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
            VALUES ($1, $2)
            ON CONFLICT (guild_id) DO UPDATE SET last_seen_at = $2
        ''', guild_id, get_now_naive())


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


async def delete_user_data(guild_id: int, user_id: int):
    pool = await get_pool(guild_id)
    async with pool.acquire() as conn:
        try:
            await conn.execute('DELETE FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM user_items WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM user_vc_durations WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            await conn.execute('DELETE FROM self_intro_welcome_messages WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)
            print(f"[UserData Cleanup] Successfully deleted data for user {user_id} in guild {guild_id} upon leave.")
        except Exception as e:
            print(f"[UserData Cleanup] Error deleting user data for user {user_id} in guild {guild_id}: {e}")


# --- 福引ガチャ ---

async def get_gacha_settings(guild_id: int) -> dict:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT allowed_role_ids, pull_cost, is_enabled FROM gacha_settings WHERE guild_id = $1',
            guild_id
        )
        if row:
            return {
                "allowed_role_ids": [str(r) for r in (row["allowed_role_ids"] or [])],
                "pull_cost": row["pull_cost"],
                "is_enabled": row["is_enabled"],
            }
        return {"allowed_role_ids": [], "pull_cost": 0, "is_enabled": True}


async def save_gacha_settings(guild_id: int, allowed_role_ids: list[int], pull_cost: int, is_enabled: bool):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO gacha_settings (guild_id, allowed_role_ids, pull_cost, is_enabled)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO UPDATE
            SET allowed_role_ids = $2, pull_cost = $3, is_enabled = $4
        ''', guild_id, allowed_role_ids, pull_cost, is_enabled)


async def get_gacha_prizes(guild_id: int) -> list[dict]:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch(
            'SELECT id, prize_number, prize_name, weight, reward_coins, reward_role_id FROM gacha_prizes WHERE guild_id = $1 ORDER BY prize_number ASC',
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
                    INSERT INTO gacha_prizes (guild_id, prize_number, prize_name, weight, reward_coins, reward_role_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                ''', guild_id, prize["prize_number"], prize["prize_name"], prize.get("weight", 1),
                    prize.get("reward_coins", 0), prize.get("reward_role_id"))


async def add_gacha_history(guild_id: int, user_id: int, prize_id: int, prize_number: int, prize_name: str):
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO gacha_history (guild_id, user_id, prize_id, prize_number, prize_name)
            VALUES ($1, $2, $3, $4, $5)
        ''', guild_id, user_id, prize_id, prize_number, prize_name)
