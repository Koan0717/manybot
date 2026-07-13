import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect(
        "postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
        statement_cache_size=0
    )
    bs = await conn.fetch("SELECT * FROM guild_databases")
    print("--- guild_databases ---")
    for r in bs:
        print(dict(r))
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
