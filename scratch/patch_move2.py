import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''            await channel.send(content=f"{interaction.user.mention}", embed=embed, view=view)'''

replacement = '''            await channel.send(content=f"{interaction.user.mention}", embed=embed, view=view)
            
            if interaction.user.voice and interaction.user.voice.channel:
                try:
                    await interaction.user.move_to(channel)
                except:
                    pass'''

content = content.replace(target, replacement)

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
