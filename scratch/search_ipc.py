import os

def search_files():
    for root, dirs, files in os.walk(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot'):
        if 'node_modules' in root or '.git' in root or '__pycache__' in root:
            continue
        for f in files:
            if f.endswith('.py') or f.endswith('.js') or f.endswith('.ts'):
                p = os.path.join(root, f)
                try:
                    with open(p, 'r', encoding='utf-8') as file:
                        c = file.read()
                        if 'antigrief' in c or 'antigrief_settings' in c:
                            print(p)
                except Exception:
                    pass

if __name__ == '__main__':
    search_files()
