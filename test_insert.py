import asyncio
import database

async def main():
    cmds = [
        {'name': '運営 手動給与', 'description': '【運営専用】指定したユーザーまたはロール全員に通貨を直接発行して付与します', 'category': 'Admin'},
        {'name': '初期発行', 'description': '指定したユーザー達、またはロール全員に初期発行額の通貨を付与します。', 'category': 'Economy'}
    ]
    await database.update_available_commands(cmds)
    print('Done')

asyncio.run(main())
