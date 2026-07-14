import asyncio
import database

async def main():
    p = await database.get_master_pool()
    async with p.acquire() as conn:
        res = await conn.fetch('SELECT DISTINCT guild_id FROM users')
        print([r['guild_id'] for r in res])

asyncio.run(main())
