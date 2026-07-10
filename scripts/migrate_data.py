import asyncio
import asyncpg

# ==============================================================================
# 設定情報 (実行前に新しいDB URLを設定してください)
# ==============================================================================

# 移行元: Noctis
NOCTIS_DB_URL = "postgresql://postgres.nxvdvrebqjrzxcxfrpun:Kakijun06100717@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
NOCTIS_GUILD_ID = 1502700570396590100

# 移行元: 0番区
ZERO_DB_URL = "postgresql://postgres.gjbckzsshcstzhojikhs:Kakijun06100717!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
ZERO_GUILD_ID = 1505398772828471357

# 移行先: 新しい統合DB (ユーザーが作成済みのものをここに入れる)
NEW_DB_URL = "postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"

# ==============================================================================
# 移行対象のテーブルリスト (構造が同じ、かつ guild_id を付与して移行するもの)
# ==============================================================================

TABLES_TO_MIGRATE = [
    "users",
    "rooms",
    "evaluation_periods",
    "inquiry_panels",
    "custom_ticket_panels",
    "evaluation_settings",
    "rank_settings",
    "vc_coins_settings",
    "antigrief_settings",
    "user_evaluations",
    "user_vc_durations",
    "shop_settings",
    "shop_items",
    "user_items",
    "anonymous_chats",
    "sticky_templates"
]

# サーバー固有の guild_id を付与してデータを移行する
async def migrate_table(old_pool, new_pool, table_name, guild_id):
    async with old_pool.acquire() as old_conn:
        # 古いDBから全件取得
        try:
            records = await old_conn.fetch(f"SELECT * FROM {table_name}")
        except asyncpg.exceptions.UndefinedTableError:
            print(f"[SKIP] Table '{table_name}' does not exist in old DB.")
            return

        if not records:
            return

        print(f"Migrating {len(records)} records for table '{table_name}' (Guild: {guild_id})")
        
        async with new_pool.acquire() as new_conn:
            # 新しいDBのテーブルの列リストを取得
            columns_query = f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}' AND table_schema = 'public'"
            new_table_cols = [r['column_name'] for r in await new_conn.fetch(columns_query)]
            
            for record in records:
                # レコードの辞書化
                data = dict(record)
                
                # guild_id 列が存在する場合のみ追加
                if 'guild_id' in new_table_cols:
                    data['guild_id'] = guild_id
                
                # 新しいテーブルに存在しない列をデータから除外
                filtered_data = {k: v for k, v in data.items() if k in new_table_cols}
                
                columns = list(filtered_data.keys())
                values = list(filtered_data.values())
                
                col_names = ", ".join(columns)
                placeholders = ", ".join(f"${i+1}" for i in range(len(columns)))
                
                query = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                
                try:
                    await new_conn.execute(query, *values)
                except Exception as e:
                    print(f"[ERROR] Failed to insert into {table_name}: {e}")

async def run_migration():
    print("Connecting to databases...")
    
    noctis_pool = await asyncpg.create_pool(NOCTIS_DB_URL, statement_cache_size=0)
    zero_pool = await asyncpg.create_pool(ZERO_DB_URL, statement_cache_size=0)
    
    try:
        new_pool = await asyncpg.create_pool(NEW_DB_URL, statement_cache_size=0)
    except Exception as e:
        print(f"Failed to connect to NEW_DB_URL. Please set the correct URL. Error: {e}")
        return

    print("--- Starting migration for Noctis ---")
    for table in TABLES_TO_MIGRATE:
        await migrate_table(noctis_pool, new_pool, table, NOCTIS_GUILD_ID)
        
    print("--- Starting migration for 0番区 ---")
    for table in TABLES_TO_MIGRATE:
        await migrate_table(zero_pool, new_pool, table, ZERO_GUILD_ID)
        
    print("Migration completed successfully.")
    
    await noctis_pool.close()
    await zero_pool.close()
    await new_pool.close()

if __name__ == "__main__":
    asyncio.run(run_migration())
