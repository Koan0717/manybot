import asyncio
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

async def main():
    conn = await asyncpg.connect(DATABASE_URL)
    
    print("--- user_evaluations columns ---")
    rows = await conn.fetch("""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'user_evaluations'
    """)
    for r in rows:
        print(dict(r))
        
    print("\n--- user_evaluations sample data ---")
    try:
        rows = await conn.fetch("SELECT * FROM user_evaluations LIMIT 5")
        for r in rows:
            print(dict(r))
    except Exception as e:
        print(f"Error: {e}")
        
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
