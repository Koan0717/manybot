import sys
import shutil

# First fix helpers.py in 多様化bot
path = r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_block = '''def has_interviewer_role(bot, user: discord.Member):
    interviewer_role_ids = get_setting(bot, "INTERVIEWER_ROLE_IDS") or []
    admin_role_ids = get_setting(bot, "ADMIN_ROLE_IDS") or []
    user_role_ids = [r.id for r in user.roles]
    if any(rid in interviewer_role_ids or rid in admin_role_ids for rid in user_role_ids) or user.guild_permissions.administrator:'''

new_block = '''def has_interviewer_role(bot, user: discord.Member):
    interviewer_role_ids = get_setting(bot, "INTERVIEWER_ROLE_IDS") or []
    admin_role_ids = get_setting(bot, "ADMIN_ROLE_IDS") or []
    user_role_ids = [str(r.id) for r in user.roles]
    if any(str(rid) in user_role_ids for rid in interviewer_role_ids + admin_role_ids) or user.guild_permissions.administrator:'''

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed helpers.py")
else:
    print("old_block not found in helpers.py")

# Now copy files to manybot
files_to_copy = [
    r'config.py',
    r'helpers.py',
    r'cogs\logging_cog.py'
]

src_base = r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot'
dst_base = r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot'

for file in files_to_copy:
    src = f"{src_base}\\{file}"
    dst = f"{dst_base}\\{file}"
    shutil.copy2(src, dst)
    print(f"Copied {file} to manybot")

print("All done!")
