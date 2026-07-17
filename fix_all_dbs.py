import asyncio
import database
from dotenv import load_dotenv

load_dotenv()

async def fix_all():
    await database.setup_db()
    master_pool = database.master_pool
    if not master_pool:
        print("Failed to get master pool")
        return

    # Fix master DB
    print("Fixing master DB...")
    async with master_pool.acquire() as conn:
        try:
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_count INTEGER DEFAULT 0')
            await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_last_date TEXT')
            print("Master DB fixed.")
        except Exception as e:
            print(f"Error on master DB: {e}")

    # Fix all guild DBs
    async with master_pool.acquire() as conn:
        guilds = await conn.fetch("SELECT guild_id, database_url FROM guild_databases")
        for g in guilds:
            gid = g['guild_id']
            print(f"Fixing DB for guild {gid}...")
            pool = await database.get_pool(gid)
            if pool:
                async with pool.acquire() as gconn:
                    try:
                        await gconn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_count INTEGER DEFAULT 0')
                        await gconn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_last_date TEXT')
                        print(f"Guild {gid} fixed.")
                    except Exception as e:
                        print(f"Error on guild {gid}: {e}")

if __name__ == "__main__":
    asyncio.run(fix_all())
