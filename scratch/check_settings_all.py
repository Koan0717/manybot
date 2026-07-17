import sys
sys.path.append('.')
import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    if not pools: return
    async with pools[0].acquire() as conn:
        rows = await conn.fetch("SELECT guild_id, setting_key, setting_value FROM bot_settings WHERE setting_key IN ('AUTO_DETECT_MANUAL_JOIN', 'INTERVIEWER_ROLE_IDS', 'NEW_MEMBER_ROLE_ID')")
        print("--- Pool 0 ---")
        for row in rows:
            print(f"Guild {row['guild_id']} - {row['setting_key']}: {row['setting_value']}")
                
    if len(pools) > 1:
        async with pools[1].acquire() as conn:
            rows = await conn.fetch("SELECT guild_id, setting_key, setting_value FROM bot_settings WHERE setting_key IN ('AUTO_DETECT_MANUAL_JOIN', 'INTERVIEWER_ROLE_IDS', 'NEW_MEMBER_ROLE_ID')")
            print("--- Pool 1 ---")
            for row in rows:
                print(f"Guild {row['guild_id']} - {row['setting_key']}: {row['setting_value']}")

if __name__ == '__main__':
    asyncio.run(main())
