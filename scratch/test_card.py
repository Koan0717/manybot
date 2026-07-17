import sys
sys.path.append('.')
import asyncio
from card_generator import generate_rank_card
import io

async def main():
    try:
        await generate_rank_card(
            user_name="Test User",
            avatar_bytes=None,
            server_logo_bytes=None,
            vc_level=1,
            vc_xp=10,
            vc_next_xp=100,
            vc_role_name="None",
            tc_level=1,
            tc_xp=10,
            tc_next_xp=100,
            tc_role_name="None",
            enable_tc=True,
            eval_time_str="0時間 0分",
            vc_xp_per_min=15,
            tc_xp_reward=10
        )
        print("Success!")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == '__main__':
    asyncio.run(main())
