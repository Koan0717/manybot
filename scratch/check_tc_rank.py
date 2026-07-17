import sys
sys.path.append('.')
import asyncio
import database
import json

async def main():
    pools = await database.get_all_configured_pools()
    if not pools: return
    async with pools[0].acquire() as conn:
        rows = await conn.fetch("SELECT setting_value FROM bot_settings WHERE setting_key = 'ENABLE_TC_RANK'")
        print("Pool 0:", [r['setting_value'] for r in rows])
                
    if len(pools) > 1:
        async with pools[1].acquire() as conn:
            rows = await conn.fetch("SELECT setting_value FROM bot_settings WHERE setting_key = 'ENABLE_TC_RANK'")
            print("Pool 1:", [r['setting_value'] for r in rows])

if __name__ == '__main__':
    asyncio.run(main())
