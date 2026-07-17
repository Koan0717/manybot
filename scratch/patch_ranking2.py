import sys

paths = [
    r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\cogs\ranking.py',
    r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\cogs\ranking.py'
]

for path in paths:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except FileNotFoundError:
        continue

    new_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        
        if 'async def rank_top_tc(self, interaction: discord.Interaction):' in line:
            new_lines.append(line)
            if i + 1 < len(lines) and 'enable_tc_str' not in lines[i+1]:
                indent = line[:len(line) - len(line.lstrip())] + '    '
                new_lines.append(indent + 'enable_tc_str = config.get_setting(self.bot, "ENABLE_TC_RANK", interaction.guild_id)\n')
                new_lines.append(indent + 'if enable_tc_str is not None and str(enable_tc_str).lower() == "false":\n')
                new_lines.append(indent + '    return await interaction.response.send_message("現在、テキストチャット(TC)ランク機能はオフになっています。", ephemeral=True)\n')
            i += 1
            continue

        if 'in_correct_category = config.is_xp_enabled(self.bot, message.channel)' in line:
            new_lines.append(line)
            if i + 1 < len(lines) and 'enable_tc_str' not in lines[i+1] and 'enable_tc_str' not in lines[i+2]:
                indent = line[:len(line) - len(line.lstrip())]
                new_lines.append(indent + 'enable_tc_str = config.get_setting(self.bot, "ENABLE_TC_RANK", message.guild.id)\n')
                new_lines.append(indent + 'if enable_tc_str is not None and str(enable_tc_str).lower() == "false":\n')
                new_lines.append(indent + '    return\n')
            i += 1
            continue
            
        new_lines.append(line)
        i += 1

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

print("ranking.py completely patched")
