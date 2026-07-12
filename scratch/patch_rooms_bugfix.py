import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix get_setting calls
content = content.replace(
    '''configs = get_setting(bot, guild.id, "ROOM_PANEL_CONFIGS")''',
    '''configs = get_setting(bot, "ROOM_PANEL_CONFIGS", guild.id)'''
)
content = content.replace(
    '''configs = get_setting(bot, interaction.guild.id, "ROOM_PANEL_CONFIGS")''',
    '''configs = get_setting(bot, "ROOM_PANEL_CONFIGS", interaction.guild.id)'''
)

# Fix race condition in process_room_purchase
target_process = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    await interaction.response.defer(ephemeral=True)
    owner_id = interaction.user.id
    if room_type in ["宿", "高級宿"] and await database.has_room_type(owner_id, ["宿", "高級宿"]):'''

replacement_process = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    await interaction.response.defer(ephemeral=True)
    owner_id = interaction.user.id
    
    if not hasattr(bot, 'processing_rooms'):
        bot.processing_rooms = set()
    if owner_id in bot.processing_rooms:
        return await interaction.edit_original_response(content="処理中です。連打はご遠慮ください。")
    bot.processing_rooms.add(owner_id)
    
    try:
        if room_type in ["宿", "高級宿"] and await database.has_room_type(owner_id, ["宿", "高級宿"]):'''

if "bot.processing_rooms = set()" not in content:
    content = content.replace(target_process, replacement_process)

# Now we need to add the finally block to remove from processing_rooms
# The function ends around here:
#         except Exception as e:
#             print(f"Failed to give item: {e}")
#             
#     await interaction.edit_original_response(content=f"「{room_type}」を作成しました！", view=None)

# We will just replace the very end of the function, BUT there are multiple returns inside the function.
# Instead of a huge try-finally block, we can just replace all `return await ...` with `bot.processing_rooms.discard(owner_id); return await ...`
# Wait, replacing the whole body with try...finally is safer.
# Let's use a wrapper function!
content = content.replace(
    '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):''',
    '''async def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):'''
)

wrapper = '''
async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    owner_id = interaction.user.id
    if not hasattr(bot, 'processing_rooms'):
        bot.processing_rooms = set()
    if owner_id in bot.processing_rooms:
        # 既にdeferされている可能性もあるため、応答を試みる
        try:
            if not interaction.response.is_done():
                await interaction.response.send_message("現在処理中です。少しお待ちください。", ephemeral=True)
        except:
            pass
        return
    bot.processing_rooms.add(owner_id)
    try:
        await _process_room_purchase_inner(bot, interaction, room_type, duration, panel_id)
    finally:
        bot.processing_rooms.discard(owner_id)
'''
# inject wrapper before _process_room_purchase_inner
content = content.replace(
    '''async def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):''',
    wrapper + '''\nasync def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):'''
)

# And remove the defer code that I injected above if I already ran it... but wait, I used a replace string that failed if it wasn't there. So I didn't inject the first one. Let's check.

# Now save
with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
