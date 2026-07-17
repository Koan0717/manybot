import sys

paths = [
    r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\cogs\gambling.py',
    r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\cogs\gambling.py'
]

for path in paths:
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    current_param = "interaction"
    for i, line in enumerate(lines):
        if 'def ' in line:
            if '(self, it' in line:
                current_param = "it"
            else:
                current_param = "interaction"
                
        if current_param == "interaction":
            lines[i] = lines[i].replace('it.guild.id', 'interaction.guild.id')

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)

print("Restored interaction variable where appropriate.")
