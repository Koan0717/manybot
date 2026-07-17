import asyncio
from database import get_pool

async def main():
    pool = await get_pool(1505398772828471357)
    try:
        tables = await pool.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        for t in tables:
            table = t['table_name']
            try:
                has_guild_id = await pool.fetchval(f"SELECT COUNT(*) FROM information_schema.columns WHERE table_name = '{table}' AND column_name = 'guild_id'")
                if has_guild_id > 0:
                    old_count = await pool.fetchval(f"SELECT COUNT(*) FROM {table} WHERE guild_id = 1505398772828471300")
                    if old_count > 0:
                        print(f"{table}: old={old_count}")
            except Exception as e:
                pass
    except Exception as e:
        print('Error:', e)

asyncio.run(main())
