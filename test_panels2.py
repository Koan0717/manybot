import asyncio, database
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

async def main():
    pools = await database.get_all_configured_pools()
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            try:
                rows = await conn.fetch("SELECT * FROM custom_ticket_panels")
                print(f"Pool {i} custom_ticket_panels: {len(rows)} rows")
                for r in rows:
                    d = dict(r)
                    print(f"  {d}")
            except Exception as e:
                print(f"Pool {i} error: {e}")
asyncio.run(main())
