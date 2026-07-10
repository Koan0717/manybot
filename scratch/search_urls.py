import glob, re, sys
sys.stdout.reconfigure(encoding='utf-8')
for f in glob.glob('**/*.py', recursive=True):
    if 'pycache' in f or 'scratch' in f: continue
    try:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            urls = re.findall(r'https?://[^\s"\'\>]+', content)
            if urls:
                print(f'{f}: {urls}')
    except Exception as e:
        print(f"Error reading {f}: {e}")
