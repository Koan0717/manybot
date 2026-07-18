import asyncio
import database
from dotenv import load_dotenv

load_dotenv()

async def fix_pk2():
    await database.setup_db()
    master_pool = database.master_pool

    async def fix_pk_for_db(pool, db_name, gid=None):
        async with pool.acquire() as conn:
            # 1. Ensure no NULL guild_ids
            if gid:
                await conn.execute('UPDATE users SET guild_id = $1 WHERE guild_id IS NULL', gid)
            else:
                # If master db has NULL guild_ids, we can't easily fix without knowing what guild they belong to.
                # But master db is usually unused for actual commands if guilds have their own DBs.
                # Let's just delete rows with NULL guild_id in master db, or set them to 0.
                await conn.execute('UPDATE users SET guild_id = 0 WHERE guild_id IS NULL')

            # 2. Delete duplicate rows (keep one)
            await conn.execute('''
                DELETE FROM users a USING users b 
                WHERE a.ctid < b.ctid AND a.guild_id = b.guild_id AND a.user_id = b.user_id
            ''')

            # 3. Add primary key
            try:
                await conn.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey')
                await conn.execute('ALTER TABLE users ADD PRIMARY KEY (guild_id, user_id)')
                print(f"Successfully added PK in {db_name}")
            except Exception as e:
                print(f"Error adding PK in {db_name}: {e}")

    await fix_pk_for_db(master_pool, "Master DB")

    async with master_pool.acquire() as conn:
        guilds = await conn.fetch("SELECT guild_id FROM guild_databases")
        for g in guilds:
            gid = g['guild_id']
            pool = await database.get_pool(gid)
            if pool:
                await fix_pk_for_db(pool, f"Guild {gid}", gid)

if __name__ == "__main__":
    asyncio.run(fix_pk2())
