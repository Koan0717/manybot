import asyncio
import asyncpg
import os

async def main():
    db_url = 'postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        tables = ['log_settings', 'antigrief_settings', 'rank_settings', 'vc_coins_settings']
        for table in tables:
            columns = await conn.fetch(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
            col_names = [r['column_name'] for r in columns]
            print(f"{table}: has channel_id? {'channel_id' in col_names}")
            if not 'channel_id' in col_names:
                print(f"  Columns: {col_names}")
    finally:
        await conn.close()

asyncio.run(main())
