import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''class LuxuryInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member: discord.Member):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id
        self.member = member'''

replacement = '''class LuxuryInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member: discord.Member, panel_id=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id'''

content = content.replace(target, replacement)

# Check if there are other Views that failed similarly
target_main = '''class MainInnConfirmView(discord.ui.View):
    def __init__(self, bot, member=None):'''
# MainInnConfirmView was member=None, let's check it.
# Wait, I can just rewrite the LuxuryInnDurationSelectView properly.

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
