import asyncio
import database
from dotenv import load_dotenv

load_dotenv()

async def test():
    await database.setup_db()
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        try:
            res = await conn.fetchrow('SELECT chinchiro_count FROM users LIMIT 1')
            print("chinchiro_count exists!")
            print(res)
        except Exception as e:
            print(f"Error: {e}")

        try:
            # Let's list all columns of the users table
            res = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'users';")
            print("Columns in users table:")
            for r in res:
                print(r['column_name'])
        except Exception as e:
            print(f"Error fetching columns: {e}")

if __name__ == "__main__":
    asyncio.run(test())
