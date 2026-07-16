import sys
sys.path.append('.')
from PIL import Image
import os

source_path = r"C:\Users\kakij\.gemini\antigravity\brain\c1c1cf76-ceba-427b-a912-f85141a20002\media__1784212723387.jpg"
dest_path1 = r"C:\Users\kakij\OneDrive\ドキュメント\多様化bot\assets\background_1505398772828471357.png"
dest_path2 = r"C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\assets\background_1505398772828471357.png"

try:
    with Image.open(source_path) as img:
        img.save(dest_path1, format="PNG")
        img.save(dest_path2, format="PNG")
    print("Successfully converted and saved image.")
except Exception as e:
    print(f"Error: {e}")
