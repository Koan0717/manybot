import asyncio
import database

async def main():
    p = await database.get_master_pool()
    rows = await p.fetch('SELECT guild_id, database_url FROM guild_databases')
    
    # Check master pool
    try:
        master_panels = await p.fetch('SELECT * FROM custom_ticket_panels')
        print(f"Master pool custom_ticket_panels: {len(master_panels)}")
    except Exception as e:
        print(f"Master pool error: {e}")

    for r in rows:
        guild_id = r['guild_id']
        url = r['database_url']
        try:
            pool = await database.get_pool(guild_id)
            panels = await pool.fetch('SELECT * FROM custom_ticket_panels')
            print(f"Guild {guild_id} custom_ticket_panels: {len(panels)}")
            for p_row in panels:
                print(f"  - Channel {p_row['channel_id']}: {p_row['panel_title']}")
        except Exception as e:
            print(f"Guild {guild_id} error: {e}")

asyncio.run(main())
