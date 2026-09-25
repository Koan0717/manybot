import re
import unicodedata
import discord
from discord.ext import commands
import database
from helpers import get_setting


def normalize_intro_text(text: str) -> str:
    """
    表記ゆれを吸収するため、全角/半角をそろえ（NFKC）、空白・記号（【】｜：「」など）・絵文字を取り除く。
    例:「【鯖で使う名前】山田」「鯖で使う名前｜山田」「鯖で使う名前：山田」はどれも「鯖で使う名前山田」になる。
    """
    text = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(r"[\W_]+", "", text)


def extract_template_keywords(template: str) -> list:
    """
    テンプレートの各行から項目名を取り出す（比較用に normalize_intro_text 済み）。
    【〇〇】 / 〇〇： / 〇〇| のような書き方なら 〇〇 の部分、それ以外の行は行全体を項目名にする。
    """
    keywords = []
    for line in template.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"[【\[［「『]([^】\]］」』]+)[】\]］」』]", line)
        if not m:
            m = re.match(r"([^：:｜|]+)[：:｜|]", line)
        label = normalize_intro_text(m.group(1) if m else line)
        if label and label not in keywords:
            keywords.append(label)
    return keywords


def check_intro_completeness(message_content: str, keywords: list) -> bool:
    """メッセージに全項目名が含まれているか確認する（括弧や区切り記号の違いは気にしない）。"""
    text = normalize_intro_text(message_content)
    return all(kw in text for kw in keywords)


def get_intro_channel_ids(settings: dict) -> list:
    """自己紹介チャンネルのID一覧（複数設定。無ければ以前の1つだけの channel_id）。"""
    ids = [int(c) for c in (settings.get("channel_ids") or []) if c]
    if not ids and settings.get("channel_id"):
        ids = [int(settings["channel_id"])]
    return ids


class SelfIntroRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        """入室時に自己紹介チャンネルへメンション付きで案内を送る。"""
        if member.bot:
            return
        guild = member.guild
        try:
            settings = await database.get_self_intro_role_settings(guild.id)
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to get settings for guild {guild.id}: {e}")
            return

        if not settings.get("is_enabled"):
            return

        intro_channel_ids = get_intro_channel_ids(settings)
        welcome_channel_id = settings.get("welcome_channel_id")
        template = settings.get("template") or ""

        if not intro_channel_ids or not settings.get("role_id"):
            return

        # 案内メッセージの送信先チャンネルを決定（未設定なら1つ目の自己紹介チャンネル）
        target_channel_id = welcome_channel_id if welcome_channel_id else intro_channel_ids[0]
        channel = guild.get_channel(int(target_channel_id))
        if not channel:
            return

        # 案内には自己紹介チャンネルをすべて並べる（どれか1つで自己紹介すればよい）
        intro_mention = " / ".join(f"<#{cid}>" for cid in intro_channel_ids)

        # 案内メッセージ作成
        if template:
            guide_text = (
                f"🎉 {member.mention} さん、ようこそ！\n\n"
                f"まず {intro_mention} で以下のテンプレートを使って自己紹介をお願いします📝\n"
                f"全ての項目を埋めて送信すると、ロールが付与されます！\n\n"
                f"```\n{template}\n```"
            )
        else:
            guide_text = (
                f"🎉 {member.mention} さん、ようこそ！\n\n"
                f"{intro_mention} で自己紹介をお願いします📝"
            )

        try:
            msg = await channel.send(guide_text)
            await database.save_self_intro_welcome_message(guild.id, member.id, msg.id, channel.id)
        except discord.Forbidden:
            print(f"[SelfIntroRoles] Cannot send message to channel {target_channel_id} in guild {guild.id}")
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to send welcome message: {e}")

    async def _intro_target(self, message: discord.Message):
        """自己紹介として扱うメッセージなら (付与するロール, 項目名) を返す。対象外なら None。"""
        if message.author.bot or not message.guild or not isinstance(message.author, discord.Member):
            return None
        guild = message.guild
        try:
            settings = await database.get_self_intro_role_settings(guild.id)
        except Exception:
            return None
        if not settings.get("is_enabled"):
            return None

        intro_channel_ids = get_intro_channel_ids(settings)
        role_id = settings.get("role_id")
        template = settings.get("template") or ""
        if not intro_channel_ids or not role_id or not template:
            return None

        # 自己紹介チャンネル（どれか）のメッセージのみ対象（スレッドなら親チャンネルで判定）
        channel_ids = {message.channel.id, getattr(message.channel, "parent_id", None)}
        if not channel_ids & set(intro_channel_ids):
            return None

        target_role = guild.get_role(int(role_id))
        if not target_role or target_role in message.author.roles:
            return None
        keywords = extract_template_keywords(template)
        if not keywords:
            return None
        return target_role, keywords

    async def _try_grant(self, message: discord.Message, notify: bool = True) -> bool:
        """テンプレートの項目がそろっていればロールを付与する。付与したら True。"""
        target = await self._intro_target(message)
        if not target:
            return False
        target_role, keywords = target
        if not check_intro_completeness(message.content, keywords):
            return False

        guild = message.guild
        member = message.author
        try:
            await member.add_roles(target_role, reason="自己紹介テンプレート完成によるロール付与")
        except discord.Forbidden:
            print(f"[SelfIntroRoles] Cannot add role {target_role.id} to {member} in guild {guild.id}")
            return False
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to add role: {e}")
            return False

        # 案内メッセージを削除
        try:
            welcome_data = await database.get_self_intro_welcome_message(guild.id, member.id)
            if welcome_data:
                welcome_channel = guild.get_channel(int(welcome_data["channel_id"]))
                if welcome_channel:
                    try:
                        welcome_msg = await welcome_channel.fetch_message(int(welcome_data["message_id"]))
                        await welcome_msg.delete()
                    except (discord.NotFound, discord.Forbidden):
                        pass
                await database.delete_self_intro_welcome_message(guild.id, member.id)
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to delete welcome message: {e}")

        # 付与完了の通知（チャンネルには出さず、本人のDMにだけ送る）
        if notify:
            try:
                await member.send(
                    f"✅ 【{guild.name}】自己紹介ありがとうございます！ロール **{target_role.name}** を付与しました🎉"
                )
            except (discord.Forbidden, discord.HTTPException):
                # DM拒否設定の場合は通知なし（ロールは付与済み）
                pass
        return True

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """自己紹介チャンネルへの投稿を検知してロールを付与する。"""
        await self._try_grant(message)

    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message):
        """投稿後に書き足して項目がそろった場合もロールを付与する。"""
        if before.content == after.content:
            return
        await self._try_grant(after)

    @commands.Cog.listener()
    async def on_ready(self):
        """
        起動時に、自己紹介チャンネルの最近の投稿を見直す。
        以前は【】の書き方が違うと判定できなかったため、条件を満たしているのにロールが付いていない人に付け直す。
        """
        if getattr(self, "_backfilled", False):
            return
        self._backfilled = True
        for guild in self.bot.guilds:
            try:
                settings = await database.get_self_intro_role_settings(guild.id)
            except Exception:
                continue
            if not settings.get("is_enabled") or not settings.get("role_id") or not settings.get("template"):
                continue
            granted = 0
            for cid in get_intro_channel_ids(settings):
                channel = guild.get_channel(cid)
                if not isinstance(channel, discord.TextChannel):
                    continue
                try:
                    async for message in channel.history(limit=200):
                        if await self._try_grant(message):
                            granted += 1
                except (discord.Forbidden, discord.HTTPException) as e:
                    print(f"[SelfIntroRoles] Cannot read history of {cid} in guild {guild.id}: {e}")
            if granted:
                print(f"[SelfIntroRoles] Backfilled self-intro role for {granted} member(s) in guild {guild.id}")


async def setup(bot):
    await bot.add_cog(SelfIntroRoles(bot))
