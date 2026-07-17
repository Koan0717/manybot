import codecs

with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'rb') as f:
    lines = f.readlines()

new_content = """# 面接・入国設定
NEW_MEMBER_ROLE_NAME = "【仮】新規メンバーロール名"
PENDING_MEMBER_ROLE_NAME = "【仮】入国待機者ロール名"
INTERVIEWER_ROLE_NAMES = ["【仮】面接官ロール名1", "【仮】面接官ロール名2"]
FREE_INN_ROLE_NAMES = ["【仮】無料宿ロール名1", "【仮】無料宿ロール名2"]
MAIN_SUB_MEMBER_ROLE_NAMES = ["【仮】本メンバーロール名", "【仮】準メンバーロール名"]
EMBLEM_MANAGER_ROLE_NAME = "【仮】スタンプ統括ロール名"
EMBLEM_MASTER_ROLE_NAME = "【仮】スタンプ制作ロール名"
CONFESSION_PRIEST_ROLE_NAME = "【仮】告解司祭ロール名"
PRIEST_ROLE_NAME = "【仮】司祭ロール名"

# 自己紹介・評価設定
SELF_INTRO_CHANNEL_IDS = [123456789012345678, 123456789012345678]
EVALUATION_FORUM_CHANNEL_IDS = []

# --- 運営権限チェック用の仮ロール名 ---
ADMIN_ROLE_NAMES = ["【仮】管理者ロール名1", "【仮】管理者ロール名2"]
"""

with open(r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\helpers.py', 'wb') as f:
    f.writelines(lines[:63])
    f.write(new_content.encode('utf-8'))
    f.writelines(lines[81:])
