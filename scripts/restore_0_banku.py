import asyncio
from database import get_pool

async def main():
    pool = await get_pool(1505398772828471357)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Find users who have old records (guild_id = 1505398772828471300)
            old_users = await conn.fetch("SELECT user_id FROM users WHERE guild_id = 1505398772828471300")
            old_user_ids = [r['user_id'] for r in old_users]
            
            if not old_user_ids:
                print("No old users found. Nothing to migrate.")
                return
            
            print(f"Found {len(old_user_ids)} users with old data.")
            
            # Delete any new records for these users to avoid conflict
            deleted = await conn.execute("DELETE FROM users WHERE guild_id = 1505398772828471357 AND user_id = ANY($1)", old_user_ids)
            print(f"Deleted new conflicting rows: {deleted}")
            
            # Update old records to have the correct guild_id
            updated = await conn.execute("UPDATE users SET guild_id = 1505398772828471357 WHERE guild_id = 1505398772828471300")
            print(f"Updated old rows to new guild_id: {updated}")

asyncio.run(main())
