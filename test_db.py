import asyncio, asyncpg
async def main():
    try:
        conn = await asyncpg.connect(postgresql://postgres.obmiqcqdddrqjvztxmgl:Kakijun06100717!@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres)
        print(Success!)
        await conn.close()
    except Exception as e:
        print(Error:, e)
asyncio.run(main())
