import os, re

def search_text(path, query):
    for root, dirs, files in os.walk(path):
        if 'node_modules' in root or '.git' in root or '__pycache__' in root:
            continue
        for file in files:
            if file.endswith('.py') or file.endswith('.js') or file.endswith('.json'):
                full_path = os.path.join(root, file)
                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        for idx, line in enumerate(lines):
                            if query.lower() in line.lower():
                                print(f"{full_path}:{idx+1}: {line.strip()}")
                except Exception:
                    pass

if __name__ == '__main__':
    search_text(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot', 'antigrief')
