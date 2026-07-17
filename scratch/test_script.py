import asyncio
import database
import traceback
from cogs.utility import EventGroup

async def test():
    try:
        p = await database.get_pool()
        async with p.acquire() as conn:
            print("DB Connection OK")
            try:
                row = await conn.fetchrow('SELECT * FROM custom_ticket_panels LIMIT 1')
                print("Table OK:", row)
            except Exception as e:
                print("Table Error:", e)
    except Exception as e:
        print("DB Error:", e)

if __name__ == "__main__":
    asyncio.run(test())
