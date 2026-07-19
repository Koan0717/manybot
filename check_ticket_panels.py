import asyncio
import database

async def main():
    # まず問題のサーバーのパネル設定を確認
    # channel_idが必要 - ボットのDMや別の方法で確認
    # とりあえずすべてのcustom_ticket_panelsを全プールから検索
    pools = await database.get_all_configured_pools()
    for i, p in enumerate(pools):
        async with p.acquire() as conn:
            rows = await conn.fetch('SELECT * FROM custom_ticket_panels')
            if rows:
                print(f"Pool {i}: {len(rows)} panels found")
                for r in rows:
                    print(f"  channel_id={r['channel_id']}, panel_title={r['panel_title']}, target_role_ids={r['target_role_ids']}")
            else:
                print(f"Pool {i}: no panels")

asyncio.run(main())
