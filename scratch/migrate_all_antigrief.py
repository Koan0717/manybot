import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            try:
                await conn.execute("ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_category_ids BIGINT[] DEFAULT '{}'")
                await conn.execute("ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS target_channel_ids BIGINT[] DEFAULT '{}'")
                await conn.execute("ALTER TABLE antigrief_settings ADD COLUMN IF NOT EXISTS exempt_role_ids BIGINT[] DEFAULT '{}'")
                print(f"Pool {i} antigrief_settings migrated successfully.")
            except Exception as e:
                print(f"Pool {i} migration error: {e}")

if __name__ == '__main__':
    asyncio.run(main())
