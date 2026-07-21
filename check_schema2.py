import asyncio
import database

async def get_columns(p):
    async with p.acquire() as conn:
        rows = await conn.fetch("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'custom_ticket_panels'")
        return {r['column_name']: r['data_type'] for r in rows}

async def main():
    try:
        mp = await database.get_master_pool()
        sp = await database.get_pool(1526517033125023764)
        
        m_cols = await get_columns(mp)
        s_cols = await get_columns(sp)
        
        print("Master cols:", m_cols)
        print("Sakekasu cols:", s_cols)
        
        if m_cols != s_cols:
            print("DIFFERENCE!")
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
