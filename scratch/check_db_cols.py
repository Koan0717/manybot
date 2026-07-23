import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    print(f"Total pools: {len(pools)}")
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            cols = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")
            col_names = [r['column_name'] for r in cols]
            print(f"Pool {i} users columns: {col_names}")
            
            tables = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            print(f"Pool {i} tables: {[r['table_name'] for r in tables]}")

if __name__ == "__main__":
    asyncio.run(main())
