import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

helper = '''async def check_panel_permission(bot, guild, member, panel_id: str) -> bool:
    configs = get_setting(bot, guild.id, "ROOM_PANEL_CONFIGS")
    if not configs or not isinstance(configs, dict) or panel_id not in configs:
        return True # 設定がなければ全員許可
    
    config = configs[panel_id]
    allow_temp = config.get("allowTemp", True)
    allow_main_sub = config.get("allowMainSub", True)
    
    # 仮メン判定
    if is_new_member(bot, member):
        if not allow_temp: return False
        
    # 本・準メン判定
    if is_main_or_sub_member(bot, member):
        if not allow_main_sub: return False
        
    return True
'''

if "def check_panel_permission" not in content:
    content = content.replace("async def process_room_purchase", helper + "\nasync def process_room_purchase")

target_proc = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int):'''
replacement_proc = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):'''
if replacement_proc not in content:
    content = content.replace(target_proc, replacement_proc)

target_cat = '''            channel = await interaction.guild.create_voice_channel(name=f"{room_type}-{interaction.user.display_name}", category=interaction.channel.category, overwrites=overwrites, user_limit=(2 if room_type=="宿" else 0))'''
replacement_cat = '''            target_category = interaction.channel.category
            if panel_id:
                configs = get_setting(bot, interaction.guild.id, "ROOM_PANEL_CONFIGS")
                if configs and isinstance(configs, dict) and panel_id in configs:
                    cat_id = configs[panel_id].get("categoryId")
                    if cat_id:
                        try:
                            cat = interaction.guild.get_channel(int(cat_id))
                            if cat: target_category = cat
                        except:
                            pass
            channel = await interaction.guild.create_voice_channel(name=f"{room_type}-{interaction.user.display_name}", category=target_category, overwrites=overwrites, user_limit=(2 if room_type=="宿" else 0))'''
if "target_category = interaction.channel.category" not in content:
    content = content.replace(target_cat, replacement_cat)

# Use regex to safely replace inside specific classes
# RoomView inn
content = re.sub(
    r'(class RoomView\(discord\.ui\.View\):.*?async def inn\(self, it, btn\):\n)(\s+)(is_free = is_free_inn_member\(it\.client, it\.user\))',
    r'\1\2if not await check_panel_permission(it.client, it.guild, it.user, "inn"):\n\2    return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n\2\3',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class RoomView\(discord\.ui\.View\):.*?await it\.response\.send_message\(msg, view=InnDurationSelectView\(it\.client, is_free)\), ephemeral=True\)',
    r'\1, "inn"), ephemeral=True)',
    content, flags=re.DOTALL
)

# LuxuryRoomView luxury (we use 'luxury_inn_single'? wait, RoomView/LuxuryRoomView are separate? Yes, the dashboard sends them separately. We'll use 'luxury_inn_single' for LuxuryRoomView too? Wait, dashboard has `luxury_inn_single` which uses LuxuryInnPanelView! What uses LuxuryRoomView? No, dashboard sends `luxury_inn_single` which is `LuxuryInnPanelView`! Wait, if the user doesn't care about `LuxuryRoomView`, I can still patch it as "luxury_inn_single".)
content = re.sub(
    r'(class LuxuryRoomView\(discord\.ui\.View\):.*?async def luxury\(self, it, btn\):\n\s+bot = it\.client\n\s+member = it\.user\n)',
    r'\1        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class LuxuryRoomView\(discord\.ui\.View\):.*?await it\.response\.send_message\("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView\(it\.client, it\.user)\), ephemeral=True\)',
    r'\1, "luxury_inn_single"), ephemeral=True)',
    content, flags=re.DOTALL
)

# InnCombinedView inn
content = re.sub(
    r'(class InnCombinedView\(discord\.ui\.View\):.*?async def inn\(self, it, btn\):\n)(\s+)(is_free = is_free_inn_member\(it\.client, it\.user\))',
    r'\1\2if not await check_panel_permission(it.client, it.guild, it.user, "inn_combined"):\n\2    return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n\2\3',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class InnCombinedView\(discord\.ui\.View\):.*?await it\.response\.send_message\(msg, view=InnDurationSelectView\(it\.client, is_free)\), ephemeral=True\)',
    r'\1, "inn_combined"), ephemeral=True)',
    content, flags=re.DOTALL
)

# InnCombinedView luxury
content = re.sub(
    r'(class InnCombinedView\(discord\.ui\.View\):.*?async def luxury\(self, it, btn\):\n\s+bot = it\.client\n\s+member = it\.user\n)',
    r'\1        if not await check_panel_permission(bot, it.guild, member, "inn_combined"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class InnCombinedView\(discord\.ui\.View\):.*?await it\.response\.send_message\("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView\(it\.client, it\.user)\), ephemeral=True\)',
    r'\1, "inn_combined"), ephemeral=True)',
    content, flags=re.DOTALL
)

# MainInnPanelView
content = re.sub(
    r'(class MainInnPanelView\(discord\.ui\.View\):.*?async def inn_main\(self, it, btn\):\n)',
    r'\1        if not await check_panel_permission(it.client, it.guild, it.user, "main_inn"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class MainInnPanelView\(discord\.ui\.View\):.*?await it\.response\.send_message\("「一般宿」を無料で時間無制限で作成しますか？", view=MainInnConfirmView\(it\.client)\), ephemeral=True\)',
    r'\1, it.user, "main_inn"), ephemeral=True)',
    content, flags=re.DOTALL
)

# TempInnPanelView
content = re.sub(
    r'(class TempInnPanelView\(discord\.ui\.View\):.*?async def inn_temp\(self, it, btn\):\n)',
    r'\1        if not await check_panel_permission(it.client, it.guild, it.user, "inn_temp"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class TempInnPanelView\(discord\.ui\.View\):.*?await it\.response\.send_message\("「一般宿」の利用期間を選択してください。", view=TempInnDurationSelectView\(it\.client)\), ephemeral=True\)',
    r'\1, "inn_temp"), ephemeral=True)',
    content, flags=re.DOTALL
)

# LuxuryInnPanelView
content = re.sub(
    r'(class LuxuryInnPanelView\(discord\.ui\.View\):.*?async def luxury\(self, it, btn\):\n\s+bot = it\.client\n\s+member = it\.user\n)',
    r'\1        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n',
    content, flags=re.DOTALL
)
content = re.sub(
    r'(class LuxuryInnPanelView\(discord\.ui\.View\):.*?await it\.response\.send_message\("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView\(it\.client, it\.user)\), ephemeral=True\)',
    r'\1, "luxury_inn_single"), ephemeral=True)',
    content, flags=re.DOTALL
)

# Now inject panel_id into the inner views:
def patch_view_init(content, view_name, current_args, new_args, init_super_assign):
    # Change __init__ signature
    content = re.sub(
        rf'(class {view_name}\(discord\.ui\.View\):\n\s+def __init__\(self, {current_args}\):)',
        rf'class {view_name}(discord.ui.View):\n    def __init__(self, {new_args}):',
        content
    )
    # Add self.panel_id
    content = re.sub(
        rf'(class {view_name}\(discord\.ui\.View\):.*?{init_super_assign})',
        rf'\1\n        self.panel_id = panel_id',
        content, flags=re.DOTALL
    )
    return content

content = patch_view_init(content, "InnDurationSelectView", r"bot, is_free=False", "bot, is_free=False, panel_id=None", r"self\.is_free = is_free")
content = patch_view_init(content, "TempInnDurationSelectView", r"bot", "bot, panel_id=None", r"self\.bot = bot")
content = patch_view_init(content, "LuxuryInnDurationSelectView", r"bot, member=None", "bot, member=None, panel_id=None", r"self\.member = member")
content = patch_view_init(content, "MainInnConfirmView", r"bot, member=None", "bot, member=None, panel_id=None", r"self\.member = member")

# Pass panel_id to process_room_purchase
content = re.sub(r'await process_room_purchase\(self\.bot, interaction, "宿", 12\)', r'await process_room_purchase(self.bot, interaction, "宿", 12, getattr(self, "panel_id", None))', content)
content = re.sub(r'await process_room_purchase\(self\.bot, interaction, "宿", 24\)', r'await process_room_purchase(self.bot, interaction, "宿", 24, getattr(self, "panel_id", None))', content)
content = re.sub(r'await process_room_purchase\(self\.bot, interaction, "宿", 0\)', r'await process_room_purchase(self.bot, interaction, "宿", 0, getattr(self, "panel_id", None))', content)

content = re.sub(r'await process_room_purchase\(self\.bot, interaction, "高級宿", 12\)', r'await process_room_purchase(self.bot, interaction, "高級宿", 12, getattr(self, "panel_id", None))', content)
content = re.sub(r'await process_room_purchase\(self\.bot, interaction, "高級宿", 24\)', r'await process_room_purchase(self.bot, interaction, "高級宿", 24, getattr(self, "panel_id", None))', content)

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
