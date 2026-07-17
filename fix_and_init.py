import asyncio
import asyncpg
import database
from dotenv import load_dotenv

load_dotenv()

async def main():
    db_url = 'postgresql://postgres.ptnuucirxfrayffcfbtj:Kakijun06100717@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
    pool = await asyncpg.create_pool(db_url, statement_cache_size=0, min_size=1, max_size=2)
    try:
        print("Re-initializing database schema for the specific new database...")
        await database.setup_db_schema(pool)
        print("Done!")
    finally:
        await pool.close()

asyncio.run(main())
