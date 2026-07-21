import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    if not pools:
        print("No pools found.")
        return
    p = pools[0]
    
    # Try the same query the dashboard does
    try:
        async with p.acquire() as conn:
            channel_id = 999999999999999999 # dummy
            panel_title = 'test'
            panel_description = 'test'
            button_label = 'チケット作成'
            button_emoji = ''
            mention_role_ids = []
            target_role_ids = []
            ticket_prefix = 'ticket'
            panel_type = 'custom_ticket'
            
            await conn.execute(
                """INSERT INTO custom_ticket_panels (
                  channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type
                ) VALUES ($1, $2, $3, $4, $5, $6::BIGINT[], $7::BIGINT[], $8, $9)
                ON CONFLICT (channel_id) DO UPDATE SET 
                  panel_title = $2, panel_description = $3, button_label = $4, button_emoji = $5, mention_role_ids = $6::BIGINT[], target_role_ids = $7::BIGINT[], ticket_prefix = $8, panel_type = $9""",
                channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type
            )
            print("Query successful!")
            
            # cleanup
            await conn.execute("DELETE FROM custom_ticket_panels WHERE channel_id = $1", channel_id)
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
