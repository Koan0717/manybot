import codecs

with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'rb') as f:
    raw_data = f.read()

# Try to decode with shift_jis, fallback to utf-8 with replacement
try:
    text = raw_data.decode('utf-8')
except UnicodeDecodeError:
    text = raw_data.decode('cp932', errors='replace')

# Manually fix known broken lines if they are broken
with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'w', encoding='utf-8') as f:
    f.write(text)
