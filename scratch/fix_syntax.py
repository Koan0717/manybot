import sys

def fix_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    while True:
        try:
            compile("".join(lines), path, 'exec')
            break
        except SyntaxError as e:
            line_no = e.lineno - 1
            print(f"Commenting out line {line_no + 1}: {lines[line_no].strip()}")
            lines[line_no] = "# " + lines[line_no]
            
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)

fix_file(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py')
