import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("このパネルを利用する権限がありません。", "こちらの宿はご利用になれません。")

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
