import asyncio
import sys
import os
import io

# 新しいプロジェクトルートをPythonパスに追加
sys.path.append(r"C:\Users\kakij\OneDrive\ドキュメント\評価鯖 bot")

from card_generator import generate_rank_card
from PIL import Image, ImageDraw

def make_dummy_bytes(color, size):
    img = Image.new("RGBA", (size, size), color)
    draw = ImageDraw.Draw(img)
    draw.ellipse([size//4, size//4, size*3//4, size*3//4], fill=(255, 255, 255, 128))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()

async def main():
    dummy_avatar = make_dummy_bytes((39, 174, 96, 255), 256)
    dummy_logo = make_dummy_bytes((231, 76, 60, 255), 128)
    
    output_dir = r"C:\Users\kakij\.gemini\antigravity\brain\937a2b33-b19e-439c-920c-9afbf1e890f4"
    workspace_dir = r"C:\Users\kakij\OneDrive\ドキュメント\評価鯖 bot"
    
    # テスト時のカレントディレクトリを変更
    os.chdir(workspace_dir)
    
    # 1. VCのみのテスト
    print("Generating VC only card...")
    vc_only_bytes = await generate_rank_card(
        user_name="テストユーザー (VCのみ)",
        avatar_bytes=dummy_avatar,
        server_logo_bytes=dummy_logo,
        vc_level=13,
        vc_xp=1980,
        vc_next_xp=2200,
        vc_role_name="覚醒者",
        enable_tc=False,
        eval_time_str="5時間12分34秒"
    )
    
    with open(os.path.join(output_dir, "test_vc_only_bot.png"), "wb") as f:
        f.write(vc_only_bytes)
    with open(os.path.join(workspace_dir, "test_vc_only.png"), "wb") as f:
        f.write(vc_only_bytes)
    print("VC only card saved to both locations.")
        
    # 2. VC + TCのテスト
    print("Generating VC + TC card...")
    vc_tc_bytes = await generate_rank_card(
        user_name="テストユーザー (VC+TC)",
        avatar_bytes=dummy_avatar,
        server_logo_bytes=dummy_logo,
        vc_level=13,
        vc_xp=1980,
        vc_next_xp=2200,
        vc_role_name="覚醒者",
        tc_level=8,
        tc_xp=450,
        tc_next_xp=1200,
        tc_role_name="達人",
        enable_tc=True,
        eval_time_str="12時間34分56秒"
    )
    with open(os.path.join(output_dir, "test_vc_tc_bot.png"), "wb") as f:
        f.write(vc_tc_bytes)
    with open(os.path.join(workspace_dir, "test_vc_tc.png"), "wb") as f:
        f.write(vc_tc_bytes)
    print("VC + TC card saved to both locations.")

if __name__ == "__main__":
    asyncio.run(main())
