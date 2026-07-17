import sys
sys.path.append('.')
import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    if not pools: return
    async with pools[0].acquire() as conn:
        rows = await conn.fetch("SELECT DISTINCT guild_id FROM bot_settings")
        print("--- Pool 0 ---")
        print([r['guild_id'] for r in rows])
                
    if len(pools) > 1:
        async with pools[1].acquire() as conn:
            rows = await conn.fetch("SELECT DISTINCT guild_id FROM bot_settings")
            print("--- Pool 1 ---")
            print([r['guild_id'] for r in rows])

if __name__ == '__main__':
    asyncio.run(main())
