import os, json, sys

sys.stdout.reconfigure(encoding='utf-8')

res = []
for r, d, fs in os.walk('.'):
    for f in fs:
        if f.endswith('.py'):
            p = os.path.join(r, f)
            if 'venv' in p or 'test' in p or '__pycache__' in p:
                continue
            try:
                with open(p, encoding='utf-8', errors='ignore') as file:
                    for i, line in enumerate(file):
                        if 'スタンプ' in line or 'stamp' in line.lower() or 'role' in line.lower():
                            res.append({'p': p, 'l': i+1, 'c': line.strip()})
            except Exception as e:
                pass

with open('search_stamp.json', 'w', encoding='utf-8') as f:
    json.dump(res, f, ensure_ascii=False, indent=2)
