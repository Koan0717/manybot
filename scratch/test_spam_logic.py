import asyncio
import datetime
import re

# モック用のクラス
class MockMember:
    def __init__(self, user_id, display_name):
        self.id = user_id
        self.display_name = display_name
        self.timeout_called = False
        self.timeout_duration = None
        self.timeout_reason = None

    async def timeout(self, duration, reason):
        self.timeout_called = True
        self.timeout_duration = duration
        self.timeout_reason = reason

class MockChannel:
    def __init__(self):
        self.sent_messages = []

    async def send(self, content):
        self.sent_messages.append(content)

class MockMessage:
    def __init__(self, author, content, mention_everyone=False, mentions=[], role_mentions=[]):
        self.author = author
        self.content = content
        self.mention_everyone = mention_everyone
        self.mentions = mentions
        self.role_mentions = role_mentions
        self.channel = MockChannel()
        self.delete_called = False

    async def delete(self):
        self.delete_called = True

class MockBot:
    def __init__(self):
        self.spam_tracker = {}

# テスト対象のロジック (logging_cog.py の on_message 内の荒らし対策ロジックを再現)
async def run_spam_check(bot, message):
    user_id = message.author.id
    now = datetime.datetime.now() # JSTの代わりにローカルで

    if isinstance(message.author, MockMember): # discord.Memberの代わり
        user_tracker = bot.spam_tracker.setdefault(user_id, {
            "last_content": None,
            "content_count": 0,
            "everyone_url_count": 0,
            "mention_count": 0,
            "last_time": now
        })

        # 3秒以上経過していればリセット
        if (now - user_tracker["last_time"]).total_seconds() > 3:
            user_tracker["content_count"] = 0
            user_tracker["everyone_url_count"] = 0
            user_tracker["mention_count"] = 0

        user_tracker["last_time"] = now
        timeout_reason = None

        # 同じメッセージの連続検知 (内容が存在する場合)
        if message.content and message.content == user_tracker["last_content"]:
            user_tracker["content_count"] += 1
            if user_tracker["content_count"] >= 3:
                timeout_reason = "連続で同じメッセージを送信したため"
        else:
            user_tracker["last_content"] = message.content
            user_tracker["content_count"] = 1

        # @everyone / @here メンション、またはDiscord招待URL送信の検知 (3秒以内累計5回以上)
        DISCORD_INVITE_PATTERN = re.compile(
            r'(?:https?://)?(?:www\.)?(?:discord\.gg|discord\.com/invite|discordapp\.com/invite)/[a-zA-Z0-9-]+',
            re.IGNORECASE
        )
        if message.mention_everyone or DISCORD_INVITE_PATTERN.search(message.content):
            user_tracker["everyone_url_count"] += 1
            if user_tracker["everyone_url_count"] >= 5:
                timeout_reason = "短時間にDiscord招待リンクまたは@everyoneメンションを複数回送信したため"

        # メンションスパムの検知 (ユーザーメンション + 役職メンション)
        msg_mentions = len(message.mentions) + len(message.role_mentions)
        if msg_mentions >= 5:
            timeout_reason = "1つのメッセージで大量のメンションを送信したため"
        elif msg_mentions > 0:
            user_tracker["mention_count"] += msg_mentions
            if user_tracker["mention_count"] >= 10:
                timeout_reason = "短時間に連続してメンションを送信したため"

        if timeout_reason:
            try:
                # トリガーとなったメッセージの自動削除を試みる
                try:
                    await message.delete()
                except Exception as de:
                    print(f"[ERROR] Message deletion failed: {de}")

                timeout_duration = datetime.timedelta(hours=1)
                await message.author.timeout(timeout_duration, reason=timeout_reason)
                await message.channel.send(f"🚨 {message.author.mention if hasattr(message.author, 'mention') else message.author.display_name} がスパム行為（{timeout_reason}）によりタイムアウトされました。")
                
                user_tracker["content_count"] = 0
                user_tracker["everyone_url_count"] = 0
                user_tracker["mention_count"] = 0
                return True # スパム検知
            except Exception as e:
                print(f"[ERROR] Timeout failed for {message.author.display_name}: {e}")
    return False

async def main():
    bot = MockBot()
    member = MockMember(123, "TestUser")

    # テスト1: 同じメッセージを3回連続送信 (3秒以内)
    print("--- Test 1: Same Message 3 Times ---")
    for i in range(3):
        msg = MockMessage(member, "Hello")
        detected = await run_spam_check(bot, msg)
        print(f"Send {i+1}: detected={detected}, delete={msg.delete_called}, timeout={member.timeout_called}")
    
    # 状態クリア
    member.timeout_called = False
    bot.spam_tracker.clear()

    # テスト2: Discord招待URLや@everyoneの混在で3秒以内に5回送信 (通常WebサイトのURLも挟むが、これはカウントされない)
    print("\n--- Test 2: Discord Invite & @everyone Spam (Mix of invites and @everyone, total 5 times) ---")
    messages = [
        MockMessage(member, "Check: https://discord.gg/abc"),          # Discord招待 1
        MockMessage(member, "Google it: https://google.com"),         # 通常URL (カウントされない)
        MockMessage(member, "Hey @everyone", mention_everyone=True),  # @everyone 2
        MockMessage(member, "Check: https://discord.com/invite/def"), # Discord招待 3
        MockMessage(member, "Normal message"),                        # Normal
        MockMessage(member, "Hey again @everyone", mention_everyone=True), # @everyone 4
        MockMessage(member, "Last check: https://discordapp.com/invite/ghi") # Discord招待 5 -> ここで検知されるはず
    ]
    for i, msg in enumerate(messages):
        detected = await run_spam_check(bot, msg)
        print(f"Send {i+1} ('{msg.content}'): detected={detected}, delete={msg.delete_called}, timeout={member.timeout_called}")
        if member.timeout_called:
            print(f"Reason: {member.timeout_reason}")

    # 状態クリア
    member.timeout_called = False
    bot.spam_tracker.clear()

    # テスト3: Discord招待URLを3.5秒空けて送信 (リセットされるため検知されないこと)
    print("\n--- Test 3: Discord Invite with 3.5s delay (should NOT detect) ---")
    for i in range(5):
        msg = MockMessage(member, "Check: https://discord.gg/abc")
        detected = await run_spam_check(bot, msg)
        print(f"Send {i+1}: detected={detected}, delete={msg.delete_called}, timeout={member.timeout_called}")
        if i < 4:
            await asyncio.sleep(3.5)

    # 状態クリア
    member.timeout_called = False
    bot.spam_tracker.clear()

    # テスト4: 単一メッセージでの大量メンション (5人以上)
    print("\n--- Test 4: Heavy mentions in single message ---")
    msg = MockMessage(member, "Hello list", mentions=[1,2,3,4,5])
    detected = await run_spam_check(bot, msg)
    print(f"Send: detected={detected}, delete={msg.delete_called}, timeout={member.timeout_called}, reason={member.timeout_reason}")

    # 状態クリア
    member.timeout_called = False
    bot.spam_tracker.clear()

    # テスト5: 3秒内での累計メンション (計10個)
    print("\n--- Test 5: Cumulative mentions within 3 seconds ---")
    # 4回メンション x 2回 = 8個 (セーフ) -> さらに3個 (計11個でアウト)
    sends = [
        MockMessage(member, "Hey", mentions=[1,2,3,4]),
        MockMessage(member, "Ho", mentions=[5,6,7,8]),
        MockMessage(member, "Let's go", mentions=[9,10,11])
    ]
    for i, msg in enumerate(sends):
        detected = await run_spam_check(bot, msg)
        print(f"Send {i+1} (mentions={len(msg.mentions)}): detected={detected}, delete={msg.delete_called}, timeout={member.timeout_called}")
        if member.timeout_called:
            print(f"Reason: {member.timeout_reason}")

if __name__ == "__main__":
    asyncio.run(main())
