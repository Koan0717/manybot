import os
import filecmp

def compare(d1, d2):
    dcmp = filecmp.dircmp(d1, d2)
    diffs = [os.path.join(d1, f) for f in dcmp.diff_files]
    for sub in dcmp.common_dirs:
        if sub in ['.git', 'node_modules', '__pycache__', 'scratch', '.next']:
            continue
        diffs.extend(compare(os.path.join(d1, sub), os.path.join(d2, sub)))
    return diffs

d1 = r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot'
d2 = r'c:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot'
res = compare(d1, d2)
for f in res:
    if f.endswith('.py'):
        print(f)
