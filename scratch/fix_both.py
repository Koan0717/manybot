import re

def fix_mojibake(file_path):
    with open(file_path, 'rb') as f:
        raw = f.read()
    
    # decode ignoring errors so it doesn't crash
    text = raw.decode('utf-8', errors='ignore')
    
    # If the text has obvious Mojibake, replace it
    # These are the known corrupted blocks from Shift-JIS vs UTF-8 confusion
    text = re.sub(r'\"縲蝉ｻｮ縲第眠隕上Γ繝ｳ繝舌・繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】新規メンバーロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲大・逡悟ｾ・ｩ溯€・Ο繝ｼ繝ｫ蜷・?', '"【仮】入国待機者ロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲鷹擇謗･螳倥Ο繝ｼ繝ｫ蜷喉\"', '"【仮】面接官ロール名A"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲鷹擇謗･螳倥Ο繝ｼ繝ｫ蜷坑\"', '"【仮】面接官ロール名B"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲醍┌譁吝ｮｿ繝ｭ繝ｼ繝ｫ蜷喉\"', '"【仮】無料宿ロール名A"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲醍┌譁吝ｮｿ繝ｭ繝ｼ繝ｫ蜷坑\"', '"【仮】無料宿ロール名B"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲第悽繝｡繝ｳ繝舌・繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】本メンバーロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲第ｺ悶Γ繝ｳ繝舌・繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】準メンバーロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲代せ繧ｿ繝ｳ繝礼ｵｱ諡ｬ繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】スタンプ統括ロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲代せ繧ｿ繝ｳ繝怜宛菴懊Ο繝ｼ繝ｫ蜷・?', '"【仮】スタンプ制作ロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲大相隗｣蜿ｸ逾ｭ繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】告解司祭ロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲大昇逾ｭ繝ｭ繝ｼ繝ｫ蜷・?', '"【仮】司祭ロール名"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲醍ｮ｡逅・€・Ο繝ｼ繝ｫ蜷喉\"', '"【仮】管理者ロール名A"', text)
    text = re.sub(r'\"縲蝉ｻｮ縲醍ｮ｡逅・€・Ο繝ｼ繝ｫ蜷坑\"', '"【仮】管理者ロール名B"', text)
    
    # Also clean up the docstring that had the unclosed literal
    text = re.sub(r'\"\"\"[\s\S]*?bot\.bot_settings[\s\S]*?\"\"\"', '"""bot_settingsからニックネームを更新します"""', text)
    
    # Just in case there are remaining broken `"""` blocks, let's fix them manually
    text = re.sub(r'bot\.bot_settings 縺九ｉ BOT_NICKNAME 繧定ｪｭ縺ｿ蜿悶ｊ縲∝推繧ｵ繝ｼ繝舌・縺ｧ縺ｮ繝九ャ繧ｯ繝阪・繝繧呈峩譁ｰ縺吶ｋ縲・?', '', text)

    # Check if the syntax is valid
    try:
        compile(text, file_path, 'exec')
    except SyntaxError as e:
        print(f"Failed to fix syntax in {file_path}: {e}")
        return False
        
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f"Fixed {file_path}")
    return True

if fix_mojibake(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py'):
    print("Successfully fixed 多様化bot")

if fix_mojibake(r'c:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\helpers.py'):
    print("Successfully fixed manybot")

