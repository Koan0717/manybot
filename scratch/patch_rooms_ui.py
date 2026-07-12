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

content = content.replace("async def process_room_purchase", helper + "\nasync def process_room_purchase")

target_proc = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int):'''
replacement_proc = '''async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):'''
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
content = content.replace(target_cat, replacement_cat)

# Now update the Views
def update_view_init(class_name, target, replacement):
    global content
    content = content.replace(target, replacement)

# InnDurationSelectView
content = content.replace(
    '''class InnDurationSelectView(discord.ui.View):\n    def __init__(self, bot, is_free=False):''',
    '''class InnDurationSelectView(discord.ui.View):\n    def __init__(self, bot, is_free=False, panel_id=None):\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.is_free = is_free''',
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.is_free = is_free\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        await process_room_purchase(self.bot, interaction, "宿", 12)''',
    '''        await process_room_purchase(self.bot, interaction, "宿", 12, getattr(self, "panel_id", None))'''
)
content = content.replace(
    '''        await process_room_purchase(self.bot, interaction, "宿", 24)''',
    '''        await process_room_purchase(self.bot, interaction, "宿", 24, getattr(self, "panel_id", None))'''
)
content = content.replace(
    '''        await process_room_purchase(self.bot, interaction, "宿", 0)''',
    '''        await process_room_purchase(self.bot, interaction, "宿", 0, getattr(self, "panel_id", None))'''
)

# TempInnDurationSelectView
content = content.replace(
    '''class TempInnDurationSelectView(discord.ui.View):\n    def __init__(self, bot):''',
    '''class TempInnDurationSelectView(discord.ui.View):\n    def __init__(self, bot, panel_id=None):\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        super().__init__(timeout=60)\n        self.bot = bot''',
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.panel_id = panel_id'''
)

# LuxuryInnDurationSelectView
content = content.replace(
    '''class LuxuryInnDurationSelectView(discord.ui.View):\n    def __init__(self, bot, member=None):''',
    '''class LuxuryInnDurationSelectView(discord.ui.View):\n    def __init__(self, bot, member=None, panel_id=None):\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.member = member''',
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.member = member\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        await process_room_purchase(self.bot, interaction, "高級宿", 12)''',
    '''        await process_room_purchase(self.bot, interaction, "高級宿", 12, getattr(self, "panel_id", None))'''
)
content = content.replace(
    '''        await process_room_purchase(self.bot, interaction, "高級宿", 24)''',
    '''        await process_room_purchase(self.bot, interaction, "高級宿", 24, getattr(self, "panel_id", None))'''
)

# MainInnConfirmView
content = content.replace(
    '''class MainInnConfirmView(discord.ui.View):\n    def __init__(self, bot, member=None):''',
    '''class MainInnConfirmView(discord.ui.View):\n    def __init__(self, bot, member=None, panel_id=None):\n        self.panel_id = panel_id'''
)
content = content.replace(
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.member = member''',
    '''        super().__init__(timeout=60)\n        self.bot = bot\n        self.member = member\n        self.panel_id = panel_id'''
)

# RoomView
content = content.replace(
    '''    async def inn(self, it, btn):\n        is_free = is_free_inn_member(it.client, it.user)''',
    '''    async def inn(self, it, btn):\n        if not await check_panel_permission(it.client, it.guild, it.user, "inn"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n        is_free = is_free_inn_member(it.client, it.user)'''
)
content = content.replace(
    '''        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free), ephemeral=True)''',
    '''        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free, "inn"), ephemeral=True)'''
)

# LuxuryRoomView
content = content.replace(
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user''',
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user\n        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)'''
)
content = content.replace(
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user), ephemeral=True)''',
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "luxury_inn_single"), ephemeral=True)'''
)

# InnCombinedView
content = content.replace(
    '''    async def inn(self, it, btn):\n        is_free = is_free_inn_member(it.client, it.user)''',
    '''    async def inn(self, it, btn):\n        if not await check_panel_permission(it.client, it.guild, it.user, "inn_combined"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n        is_free = is_free_inn_member(it.client, it.user)'''
)
content = content.replace(
    '''        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free), ephemeral=True)''',
    '''        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free, "inn_combined"), ephemeral=True)'''
)
content = content.replace(
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user''',
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user\n        if not await check_panel_permission(bot, it.guild, member, "inn_combined"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)'''
)
content = content.replace(
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user), ephemeral=True)''',
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "inn_combined"), ephemeral=True)'''
)

# MainInnPanelView
content = content.replace(
    '''    async def inn_main(self, it, btn):\n        if not (is_main_or_sub_member(it.client, it.user) or has_admin_role(it.client, it.user)):''',
    '''    async def inn_main(self, it, btn):\n        if not await check_panel_permission(it.client, it.guild, it.user, "main_inn"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n        if not (is_main_or_sub_member(it.client, it.user) or has_admin_role(it.client, it.user)):'''
)
content = content.replace(
    '''        await it.response.send_message("「一般宿」を無料で時間無制限で作成しますか？", view=MainInnConfirmView(it.client), ephemeral=True)''',
    '''        await it.response.send_message("「一般宿」を無料で時間無制限で作成しますか？", view=MainInnConfirmView(it.client, it.user, "main_inn"), ephemeral=True)'''
)

# TempInnPanelView
# Deprecated, but just in case
content = content.replace(
    '''    async def inn_temp(self, it, btn):\n        if is_main_or_sub_member(it.client, it.user):''',
    '''    async def inn_temp(self, it, btn):\n        if not await check_panel_permission(it.client, it.guild, it.user, "inn_temp"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)\n        if is_main_or_sub_member(it.client, it.user):'''
)
content = content.replace(
    '''        await it.response.send_message("「一般宿」の利用期間を選択してください。", view=TempInnDurationSelectView(it.client), ephemeral=True)''',
    '''        await it.response.send_message("「一般宿」の利用期間を選択してください。", view=TempInnDurationSelectView(it.client, "inn_temp"), ephemeral=True)'''
)

# LuxuryInnPanelView
content = content.replace(
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user''',
    '''    async def luxury(self, it, btn):\n        bot = it.client\n        member = it.user\n        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):\n            return await it.response.send_message("このパネルを利用する権限がありません。", ephemeral=True)'''
)
content = content.replace(
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user), ephemeral=True)''',
    '''        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "luxury_inn_single"), ephemeral=True)'''
)

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
