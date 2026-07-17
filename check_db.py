import asyncio, database
async def main():
    s = await database.load_settings()
    print(s.get(1505398772828471357, {}).get('NEW_MEMBER_ROLE_ID'))
asyncio.run(main())
