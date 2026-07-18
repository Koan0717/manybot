import asyncio, database
async def main():
    pools = await database.get_all_configured_pools()
    for p in pools:
        async with p.acquire() as conn:
            try:
                await conn.execute('ALTER TABLE log_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE')
                print("Applied log_settings migration")
            except Exception as e:
                print(f"Error: {e}")
asyncio.run(main())
