import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix InnDurationSelectView
content = content.replace(
    '''class InnDurationSelectView(discord.ui.View):
    def __init__(self, bot, is_free: bool, member=None):''',
    '''class InnDurationSelectView(discord.ui.View):
    def __init__(self, bot, is_free: bool, member=None, panel_id=None):'''
)
if "self.panel_id = panel_id" not in content.split('''class InnDurationSelectView(discord.ui.View):''')[1].split("class ")[0]:
    content = content.replace(
        '''self.member = member
        p12 = get_room_price(self.bot, getattr(self, "member", None), "宿", 12)''',
        '''self.member = member
        self.panel_id = panel_id
        p12 = get_room_price(self.bot, getattr(self, "member", None), "宿", 12)'''
    )

# Fix calls to InnDurationSelectView
content = content.replace(
    '''InnDurationSelectView(it.client, is_free, "inn")''',
    '''InnDurationSelectView(it.client, is_free, it.user, "inn")'''
)
content = content.replace(
    '''InnDurationSelectView(it.client, is_free, "inn_combined")''',
    '''InnDurationSelectView(it.client, is_free, it.user, "inn_combined")'''
)

# Fix TempInnDurationSelectView
content = content.replace(
    '''class TempInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member=None):''',
    '''class TempInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member=None, panel_id=None):'''
)
if "self.panel_id = panel_id" not in content.split('''class TempInnDurationSelectView(discord.ui.View):''')[1].split("class ")[0]:
    content = content.replace(
        '''self.member = member
        p12 = get_room_price(self.bot, self.member, "宿", 12)''',
        '''self.member = member
        self.panel_id = panel_id
        p12 = get_room_price(self.bot, self.member, "宿", 12)'''
    )

content = content.replace(
    '''TempInnDurationSelectView(it.client, "inn_temp")''',
    '''TempInnDurationSelectView(it.client, it.user, "inn_temp")'''
)


with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
