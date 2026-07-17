import asyncio, database
async def main():
    s = await database.load_settings()
    print(s.get(1502700570396590100, {}).get('NEW_MEMBER_ROLE_ID'))
    print(type(s.get(1502700570396590100, {}).get('NEW_MEMBER_ROLE_ID')))
asyncio.run(main())
