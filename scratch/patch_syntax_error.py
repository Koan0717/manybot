import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''async def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    await interaction.response.defer(ephemeral=True)
    owner_id = interaction.user.id
    
    if not hasattr(bot, 'processing_rooms'):
        bot.processing_rooms = set()
    if owner_id in bot.processing_rooms:
        return await interaction.edit_original_response(content="処理中です。連打はご遠慮ください。")
    bot.processing_rooms.add(owner_id)
    
    try:
        if room_type in ["宿", "高級宿"] and await database.has_room_type(owner_id, ["宿", "高級宿"]):'''

replacement = '''async def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    await interaction.response.defer(ephemeral=True)
    owner_id = interaction.user.id
    
    if room_type in ["宿", "高級宿"] and await database.has_room_type(owner_id, ["宿", "高級宿"]):'''

content = content.replace(target, replacement)

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
