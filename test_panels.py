import asyncio, database
async def main():
    pools = await database.get_all_configured_pools()
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            try:
                rows = await conn.fetch("SELECT * FROM custom_ticket_panels")
                print(f"Pool {i} custom_ticket_panels: {len(rows)} rows")
                for r in rows:
                    print(f"  {dict(r)}")
            except Exception as e:
                print(f"Pool {i} error: {e}")
            try:
                rows = await conn.fetch("SELECT * FROM panel_requests")
                print(f"Pool {i} panel_requests: {len(rows)} rows")
                for r in rows:
                    print(f"  {dict(r)}")
            except Exception as e:
                pass
asyncio.run(main())
