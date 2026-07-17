import asyncio, database
async def main():
    pools = await database.get_all_configured_pools()
    for p in pools:
        async with p.acquire() as conn:
            await conn.execute('UPDATE evaluation_settings SET is_enabled = true WHERE guild_id = 1502700570396590100')
            await conn.execute('UPDATE evaluation_settings SET is_enabled = true WHERE guild_id = 1505398772828471357')
asyncio.run(main())
