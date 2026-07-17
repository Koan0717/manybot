import sys
import re

paths = [
    r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\config.py',
    r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py',
    r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\config.py',
    r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\helpers.py'
]

for path in paths:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        continue

    # Fix has_interviewer_role
    old_block = '''def has_interviewer_role(bot, user: discord.Member):
    interviewer_role_ids = get_setting(bot, "INTERVIEWER_ROLE_IDS")
    user_role_ids = [r.id for r in user.roles]
    if any(rid in interviewer_role_ids for rid in user_role_ids):
        return True'''

    new_block = '''def has_interviewer_role(bot, user: discord.Member):
    interviewer_role_ids = get_setting(bot, "INTERVIEWER_ROLE_IDS") or []
    user_role_ids = [str(r.id) for r in user.roles]
    if any(str(rid) in user_role_ids for rid in interviewer_role_ids):
        return True'''
        
    if old_block in content:
        content = content.replace(old_block, new_block)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {path}")
    else:
        print(f"Could not find block in {path}")
