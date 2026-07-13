import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect(
        "postgresql://postgres.gjbckzsshcstzhojikhs:Kakijun06100717!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
        statement_cache_size=0
    )
        
    print("--- bot_settings (ROOM_PRICES) ---")
    bs = await conn.fetch("SELECT guild_id, setting_value FROM bot_settings WHERE setting_key = 'ROOM_PRICES'")
    for r in bs:
        print(dict(r))
        
    print("--- role_room_prices ---")
    rrp = await conn.fetch("SELECT * FROM role_room_prices")
    for r in rrp:
        print(dict(r))

    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
