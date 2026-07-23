import os, re

def search_antigrief_logic():
    for root, dirs, files in os.walk(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot'):
        if 'node_modules' in root or '.git' in root or '__pycache__' in root:
            continue
        for f in files:
            if f.endswith('.py'):
                p = os.path.join(root, f)
                try:
                    with open(p, 'r', encoding='utf-8') as file:
                        lines = file.readlines()
                        for i, line in enumerate(lines):
                            if 'spam_tracker' in line or 'delete()' in line or 'delete(' in line or 'ENABLE_ANTIGRIEF' in line or 'antigrief' in line:
                                print(f"{p}:{i+1}: {line.strip()[:120]}")
                except Exception:
                    pass

if __name__ == '__main__':
    search_antigrief_logic()
