import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    for p in pools:
        async with p.acquire() as conn:
            # Drop the wrong table
            await conn.execute("DROP TABLE IF EXISTS custom_ticket_panels")
            
            # Recreate with the correct schema
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS custom_ticket_panels (
                    channel_id BIGINT PRIMARY KEY,
                    panel_title TEXT NOT NULL,
                    panel_description TEXT NOT NULL,
                    button_label TEXT NOT NULL,
                    button_emoji TEXT,
                    mention_role_ids BIGINT[] NOT NULL,
                    target_role_ids BIGINT[] NOT NULL,
                    ticket_prefix TEXT NOT NULL,
                    panel_type TEXT DEFAULT 'custom_ticket'
                )
            ''')
            print("Fixed custom_ticket_panels schema for a database pool")

asyncio.run(main())
