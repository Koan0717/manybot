import asyncio
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    
    print("--- evaluation_settings ---")
    rows = await conn.fetch("SELECT * FROM evaluation_settings")
    for r in rows:
        print(dict(r))
        
    print("\n--- log_settings ---")
    rows = await conn.fetch("SELECT * FROM log_settings")
    for r in rows:
        print(dict(r))
        
    print("\n--- system_settings (if any) ---")
    try:
        rows = await conn.fetch("SELECT * FROM settings")
        for r in rows:
            print(dict(r))
    except Exception as e:
        print(f"Error fetching settings: {e}")
        
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
