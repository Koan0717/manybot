import asyncio
import asyncpg

async def main():
    db_url = 'postgresql://postgres.ptnuucirxfrayffcfbtj:Kakijun06100717@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        tables = ['panel_requests', 'log_settings', 'inquiry_panels', 'custom_ticket_panels', 'sticky_templates']
        for table in tables:
            columns = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = '" + table + "'")
            col_names = [r['column_name'] for r in columns]
            print(f"{table}: has channel_id? {'channel_id' in col_names}")
    finally:
        await conn.close()

asyncio.run(main())
