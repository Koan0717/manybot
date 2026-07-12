import asyncio
import io
from card_generator import generate_rank_card

async def test():
    try:
        card_bytes = await generate_rank_card(
            user_name="Test User",
            avatar_bytes=b"dummy",
            server_logo_bytes=None,
            vc_level=5,
            vc_xp=276,
            vc_next_xp=789,
            vc_role_name="Role 1",
            tc_level=3,
            tc_xp=81,
            tc_next_xp=473,
            tc_role_name="Role 2",
            enable_tc=True,
            eval_time_str="0時間53分0秒"
        )
        print("Success! Size:", len(card_bytes))
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test())
