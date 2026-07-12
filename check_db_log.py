import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def check_db():
    try:
        conn = await asyncpg.connect(os.environ['DATABASE_URL'])
        res = await conn.fetch('''
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'log_settings'::regclass;
        ''')
        for r in res:
            print(dict(r))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'conn' in locals():
            await conn.close()

asyncio.run(check_db())
