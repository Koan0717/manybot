import asyncio, asyncpg
async def check():
    conn = await asyncpg.connect('postgresql://postgres.istbbvpplxqbphqcbfdx:Kakijun06100717@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres', statement_cache_size=0)
    tables = ['users', 'inquiry_panels', 'custom_ticket_panels', 'shop_items', 'sticky_templates']
    await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_count INTEGER DEFAULT 0')
    await conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS chinchiro_last_date TEXT')
    print("Added columns")
    await conn.close()
asyncio.run(check())
