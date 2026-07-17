import asyncio, os, asyncpg
from dotenv import load_dotenv
load_dotenv()
async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    tables = ['users', 'evaluation_periods', 'user_items', 'log_settings', 'evaluation_settings', 'shop_items']
    for t in tables:
        rows = await conn.fetch("SELECT table_schema, column_name FROM information_schema.columns WHERE table_name = $1", t)
        print(f"Table {t}:")
        for r in rows:
            print(f"  {r['table_schema']}.{r['column_name']}")
    await conn.close()
asyncio.run(main())
