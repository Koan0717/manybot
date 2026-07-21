import asyncio
import database

async def main():
    pool = await database.get_pool(1526517033125023764)
    # Get the connection string for this pool? 
    # Not easily accessible, but we can query the database name
    async with pool.acquire() as conn:
        db_name = await conn.fetchval("SELECT current_database()")
        print("Sakekasu Database Name:", db_name)
    
    mp = await database.get_master_pool()
    async with mp.acquire() as conn:
        db_name = await conn.fetchval("SELECT current_database()")
        print("Master Database Name:", db_name)

asyncio.run(main())
