import sys
import re

path = r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\cogs\gambling.py'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'interaction.guild.id' in line and 'it' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
    # If the block has 'it: discord.Interaction', we can aggressively replace 'interaction.' with 'it.' in that method
    
    # Let's just fix specific lines for CoinflipBetModal and SlotBetModal
    # For resetting count:
    if 'await database.reset_gambling_count(interaction.guild.id, it.user.id' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
    if 'await database.get_balance(interaction.guild.id, it.user.id' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
    if 'await database.remove_balance(interaction.guild.id, it.user.id' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
    if 'await database.increment_gambling_count(interaction.guild.id, it.user.id' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
    if 'await database.add_balance(interaction.guild.id, it.user.id' in line:
        lines[i] = line.replace('interaction.guild.id', 'it.guild.id')
        
    if 'await it.response.send_message("エラー", ephemeral=True)' in line:
        # replace with proper error handling
        indent = line[:len(line) - len(line.lstrip())]
        lines[i] = indent + "if not it.response.is_done():\n" + indent + "    await it.response.send_message('エラー', ephemeral=True)\n" + indent + "else:\n" + indent + "    await it.followup.send('エラー', ephemeral=True)\n"

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Patched successfully")
