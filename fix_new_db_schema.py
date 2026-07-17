import asyncio
import asyncpg

async def main():
    db_url = 'postgresql://postgres.ptnuucirxfrayffcfbtj:Kakijun06100717@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    try:
        print("間違った構造のテーブルを削除しています...")
        await conn.execute('DROP TABLE IF EXISTS auto_vc_triggers CASCADE')
        await conn.execute('DROP TABLE IF EXISTS auto_vc_config CASCADE')
        await conn.execute('DROP TABLE IF EXISTS sticky_templates CASCADE')
        print("完了しました！")
    except Exception as e:
        print(f"エラーが発生しました: {e}")
    finally:
        await conn.close()

asyncio.run(main())
