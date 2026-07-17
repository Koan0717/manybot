import asyncio
import asyncpg
import os

async def main():
    db_url = 'postgresql://postgres.ptnuucirxfrayffcfbtj:Kakijun06100717@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        tables = ['rooms', 'auto_vc_triggers', 'auto_vc_config']
        for table in tables:
            columns = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = '" + table + "'")
            col_names = [r['column_name'] for r in columns]
            print(f"{table}: has channel_id? {'channel_id' in col_names}")
            if 'channel_id' not in col_names:
                print(f"  Columns: {col_names}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await conn.close()

asyncio.run(main())
