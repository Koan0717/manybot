import asyncio
import database
from dotenv import load_dotenv

load_dotenv()

async def fix():
    await database.setup_db()
    pool = await database.get_pool()
    if not pool:
        print("Failed to get database pool")
        return

    async with pool.acquire() as conn:
        try:
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_count INTEGER DEFAULT 0')
            print("Added chinchiro_count")
        except Exception as e:
            print(f"Error adding chinchiro_count: {e}")
            
        try:
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_last_date TEXT')
            print("Added chinchiro_last_date")
        except Exception as e:
            print(f"Error adding chinchiro_last_date: {e}")

if __name__ == "__main__":
    asyncio.run(fix())
