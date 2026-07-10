import re

with open(r"c:\Users\kakij\OneDrive\ドキュメント\評価鯖 bot\bot.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

definitions = []
for i, line in enumerate(lines):
    line_num = i + 1
    # class, async def, def, @bot.command, @bot.event, @tree.command, discord.ui.View などを抽出
    if re.match(r"^\s*(class|def|async def)\s+(\w+)", line):
        definitions.append(f"{line_num}: {line.strip()}")
    elif re.match(r"^\s*@bot\.", line):
        definitions.append(f"{line_num}: {line.strip()}")
    elif re.match(r"^\s*@tasks\.loop", line):
        definitions.append(f"{line_num}: {line.strip()}")
    elif "class " in line and "View" in line:
        definitions.append(f"{line_num}: {line.strip()}")

with open(r"c:\Users\kakij\OneDrive\ドキュメント\評価鯖 bot\scratch\bot_structure.txt", "w", encoding="utf-8") as out:
    out.write("\n".join(definitions))

print("Structure analysis completed. Output saved to scratch/bot_structure.txt")
