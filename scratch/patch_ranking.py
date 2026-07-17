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
        
        if 'tc_xp_reward = config.get_setting(self.bot, "TC_XP_REWARD", interaction.guild_id) or 10' in line:
            new_lines.append(line)
            # Check if we already added enable_tc
            if i + 1 < len(lines) and 'enable_tc_str =' not in lines[i+1]:
                indent = line[:len(line) - len(line.lstrip())]
                new_lines.append(indent + 'enable_tc_str = config.get_setting(self.bot, "ENABLE_TC_RANK", interaction.guild_id)\n')
                new_lines.append(indent + 'enable_tc = str(enable_tc_str).lower() != "false" if enable_tc_str is not None else True\n')
            i += 1
            continue
            
        if 'enable_tc=True,' in line and 'generate_rank_card' in "".join(lines[max(0, i-10):i]):
            new_lines.append(line.replace('enable_tc=True,', 'enable_tc=enable_tc,'))
            i += 1
            continue
            
        if '# TC' in line and i + 1 < len(lines) and 'tc_value = (' in lines[i+1]:
            # The fallback embed logic
            new_lines.append(line)
            
            # Start of if enable_tc block
            indent = line[:len(line) - len(line.lstrip())]
            new_lines.append(indent + 'if enable_tc:\n')
            
            i += 1 # move to tc_value = (
            while i < len(lines):
                if 'embed.add_field(name="💬 テキストチャット", value=tc_value, inline=False)' in lines[i]:
                    new_lines.append(indent + '    ' + lines[i].lstrip())
                    i += 1
                    break
                else:
                    new_lines.append(indent + '    ' + lines[i].lstrip())
                    i += 1
            continue
            
        new_lines.append(line)
        i += 1

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

print("ranking.py successfully patched")
