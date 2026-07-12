import re
with open('dashboard/src/app/dashboard/[guild_id]/rooms/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''<div key={panel.id} className="bg-zinc-900 rounded border border-zinc-700 overflow-hidden">'''
replacement = '''<div key={panel.id} className="bg-zinc-900 rounded border border-zinc-700">'''

content = content.replace(target, replacement)

with open('dashboard/src/app/dashboard/[guild_id]/rooms/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
