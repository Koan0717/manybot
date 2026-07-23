import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    print(f"Total pools: {len(pools)}")
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            # Check antigrief_settings columns and constraints
            try:
                cols = await conn.fetch("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'antigrief_settings'")
                print(f"Pool {i} antigrief_settings cols: {[(r['column_name'], r['data_type']) for r in cols]}")
                
                constraints = await conn.fetch("""
                    SELECT conname, pg_get_constraintdef(c.oid)
                    FROM pg_constraint c
                    WHERE conrelid = 'antigrief_settings'::regclass;
                """)
                print(f"Pool {i} antigrief_settings constraints: {[(r['conname'], r['pg_get_constraintdef']) for r in constraints]}")
            except Exception as e:
                print(f"Pool {i} ERROR checking antigrief_settings: {e}")

if __name__ == "__main__":
    asyncio.run(main())
