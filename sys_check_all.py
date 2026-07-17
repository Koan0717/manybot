import asyncio
import asyncpg
import os
import re

async def main():
    db_url = 'postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        tables = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        table_names = [r['table_name'] for r in tables]
        for table in table_names:
            columns = await conn.fetch(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'")
            col_names = [r['column_name'] for r in columns]
            if 'channel_id' not in col_names:
                print(f"{table} does NOT have channel_id")
    finally:
        await conn.close()

asyncio.run(main())
