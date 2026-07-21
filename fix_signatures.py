import os

db_path = 'database.py'
with open(db_path, 'r', encoding='utf-8') as f:
    db_content = f.read()

db_content = db_content.replace('async def save_custom_ticket_panel(channel_id: int', 'async def save_custom_ticket_panel(guild_id: int, channel_id: int')
db_content = db_content.replace('async def get_custom_ticket_panel(channel_id: int) -> dict:\n\n    p = await get_pool()', 'async def get_custom_ticket_panel(guild_id: int, channel_id: int) -> dict:\n\n    p = await get_pool(guild_id)')
db_content = db_content.replace('async def remove_custom_ticket_panel(channel_id: int):\n\n    p = await get_pool()', 'async def remove_custom_ticket_panel(guild_id: int, channel_id: int):\n\n    p = await get_pool(guild_id)')

# Fix save_custom_ticket_panel get_pool call
target_str = '''    target_role_ids = target_role_ids or []\n\n    p = await get_pool()\n\n    async with p.acquire() as conn:'''
new_str = '''    target_role_ids = target_role_ids or []\n\n    p = await get_pool(guild_id)\n\n    async with p.acquire() as conn:'''
db_content = db_content.replace(target_str, new_str)

with open(db_path, 'w', encoding='utf-8') as f:
    f.write(db_content)

ipc_path = 'cogs/ipc.py'
with open(ipc_path, 'r', encoding='utf-8') as f:
    ipc_content = f.read()
ipc_content = ipc_content.replace('await database.get_custom_ticket_panel(channel_id)', 'await database.get_custom_ticket_panel(guild_id, channel_id)')
with open(ipc_path, 'w', encoding='utf-8') as f:
    f.write(ipc_content)

tickets_path = 'cogs/tickets.py'
with open(tickets_path, 'r', encoding='utf-8') as f:
    t_content = f.read()
t_content = t_content.replace('await database.save_custom_ticket_panel(\n            channel_id=channel.id', 'await database.save_custom_ticket_panel(\n            guild_id=channel.guild.id,\n            channel_id=channel.id')
t_content = t_content.replace('await database.get_custom_ticket_panel(self.channel_id)', 'await database.get_custom_ticket_panel(interaction.guild.id, self.channel_id)')
with open(tickets_path, 'w', encoding='utf-8') as f:
    f.write(t_content)

utility_path = 'cogs/utility.py'
with open(utility_path, 'r', encoding='utf-8') as f:
    u_content = f.read()
u_content = u_content.replace('await database.save_custom_ticket_panel(\n            channel_id=channel.id', 'await database.save_custom_ticket_panel(\n            guild_id=channel.guild.id,\n            channel_id=channel.id')
u_content = u_content.replace('await database.get_custom_ticket_panel(self.channel_id)', 'await database.get_custom_ticket_panel(interaction.guild.id, self.channel_id)')
with open(utility_path, 'w', encoding='utf-8') as f:
    f.write(u_content)

print("Signatures fixed")
