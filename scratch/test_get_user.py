import asyncio
import database

async def main():
    pools = await database.get_all_configured_pools()
    print("Testing get_user across all pools...")
    for i, p in enumerate(pools):
        try:
            # test get_user logic directly
            res = await database.get_user(999999999, 888888888)
            print(f"Pool {i} get_user test SUCCESS: balance={res.get('balance')}")
        except Exception as e:
            print(f"Pool {i} get_user test FAILED: {e}")

if __name__ == "__main__":
    asyncio.run(main())
