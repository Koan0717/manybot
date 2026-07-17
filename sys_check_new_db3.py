import asyncio
import asyncpg

async def main():
    db_url = 'postgresql://postgres.ptnuucirxfrayffcfbtj:Kakijun06100717@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        columns = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'sticky_templates'")
        col_names = [r['column_name'] for r in columns]
        print(f"sticky_templates columns: {col_names}")
    finally:
        await conn.close()

asyncio.run(main())
