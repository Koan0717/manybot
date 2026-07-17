import asyncio, database
async def main():
    pools = await database.get_all_configured_pools()
    for p in pools:
        async with p.acquire() as conn:
            await conn.execute("INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES (1502700570396590100, 0, 'reload_eval') ON CONFLICT DO NOTHING")
            await conn.execute("INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES (1505398772828471357, 0, 'reload_eval') ON CONFLICT DO NOTHING")
asyncio.run(main())
