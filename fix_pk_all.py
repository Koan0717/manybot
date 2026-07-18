import asyncio
import database
from dotenv import load_dotenv

load_dotenv()

async def fix_pk():
    await database.setup_db()
    master_pool = database.master_pool

    async def fix_pk_for_db(pool, db_name):
        async with pool.acquire() as conn:
            try:
                # Find the existing primary key constraint name
                pk_query = """
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'users' AND constraint_type = 'PRIMARY KEY';
                """
                pk_res = await conn.fetch(pk_query)
                for row in pk_res:
                    cname = row['constraint_name']
                    # Drop the existing PK
                    await conn.execute(f'ALTER TABLE users DROP CONSTRAINT {cname}')
                    print(f"Dropped old PK {cname} in {db_name}")
                
                # Add the new PK constraint
                await conn.execute('ALTER TABLE users ADD PRIMARY KEY (guild_id, user_id)')
                print(f"Added PRIMARY KEY (guild_id, user_id) in {db_name}")
            except Exception as e:
                print(f"Error fixing PK in {db_name}: {e}")

    await fix_pk_for_db(master_pool, "Master DB")

    async with master_pool.acquire() as conn:
        guilds = await conn.fetch("SELECT guild_id FROM guild_databases")
        for g in guilds:
            gid = g['guild_id']
            pool = await database.get_pool(gid)
            if pool:
                await fix_pk_for_db(pool, f"Guild {gid}")

if __name__ == "__main__":
    asyncio.run(fix_pk())
