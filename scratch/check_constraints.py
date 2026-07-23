import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    print(f"Total pools: {len(pools)}")
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            # Check constraints on users
            constraints = await conn.fetch("""
                SELECT conname, pg_get_constraintdef(c.oid)
                FROM pg_constraint c
                JOIN pg_namespace n ON n.oid = c.connamespace
                WHERE conrelid = 'users'::regclass;
            """)
            print(f"Pool {i} users constraints: {[(r['conname'], r['pg_get_constraintdef']) for r in constraints]}")
            
            indexes = await conn.fetch("""
                SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users';
            """)
            print(f"Pool {i} users indexes: {[(r['indexname'], r['indexdef']) for r in indexes]}")

if __name__ == "__main__":
    asyncio.run(main())
