import re

with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Replace all triple-quoted docstrings because they might contain corrupted unicode
content = re.sub(r'\"\"\"[\s\S]*?\"\"\"', '', content)
content = content.replace("笶・譛ｪ險ｭ螳・(繝√Ε繝ｳ繝阪Ν縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ)", "❌ 未設定")
content = content.replace("笶・譛ｪ險ｭ螳・(繧ｫ繝・ざ繝ｪ繝ｼ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ)", "❌ 未設定")

with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'w', encoding='utf-8') as f:
    f.write(content)
