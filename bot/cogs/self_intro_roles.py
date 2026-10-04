import re
import unicodedata
import discord
from discord.ext import commands
import database
from helpers import get_setting


# 項目名と中身を区切るのに使われる記号（比較のときは取り除く）。♀ や絵文字などの中身は残す
_SEPARATORS = r"[\s【】\[\]［］「」『』()（）<>＜＞《》〈〉〔〕|｜:：;；・,，、。.．\-‐=＝~〜/／_＿*＊#＃→⇒]+"


def normalize_intro_text(text: str) -> str:
    """
    表記ゆれを吸収するため、全角/半角をそろえ（NFKC）、空白と区切り記号（【】｜：「」など）を取り除く。
    例:「【鯖で使う名前】山田」「鯖で使う名前｜山田」「鯖で使う名前：山田」はどれも「鯖で使う名前山田」になる。
    """
    text = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(_SEPARATORS, "", text)


def extract_template_items(template: str) -> list:
    """
    テンプレートの各行から (比較用の項目名, 表示用の項目名) を取り出す。
    【〇〇】 / 〇〇： / 〇〇| のような書き方なら 〇〇 の部分、それ以外の行は行全体を項目名にする。
    """
    items = []
    for line in template.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"[【\[［「『]([^】\]］」』]+)[】\]］」』]", line)
        if not m:
            m = re.match(r"([^：:｜|]+)[：:｜|]", line)
        raw = (m.group(1) if m else line).strip()
        label = normalize_intro_text(raw)
        if label and label not in [k for k, _ in items]:
            items.append((label, raw))
    return items


def extract_template_keywords(template: str) -> list:
    return [k for k, _ in extract_template_items(template)]


def find_intro_items(message_content: str, keywords: list) -> tuple:
    """
    メッセージの中で (書かれていない項目, 中身が空の項目) を返す。
    項目名のあとから次の項目名までを、その項目の中身とみなす。
    """
    text = normalize_intro_text(message_content)
    spans = {}
    taken = []
    # 長い項目名から探す（「タイプ」が「好きなタイプ」の中で見つからないように）
    for kw in sorted(keywords, key=len, reverse=True):
        start = 0
        while True:
            i = text.find(kw, start)
            if i < 0:
                break
            if not any(a <= i < b or a < i + len(kw) <= b for a, b in taken):
                spans[kw] = (i, i + len(kw))
                taken.append((i, i + len(kw)))
                break
            start = i + 1
    missing = [kw for kw in keywords if kw not in spans]
    order = sorted(spans.items(), key=lambda x: x[1][0])
    empty = []
    for n, (kw, (_, end)) in enumerate(order):
        nxt = order[n + 1][1][0] if n + 1 < len(order) else len(text)
        if not text[end:nxt]:
            empty.append(kw)
    return missing, empty


def check_intro_completeness(message_content: str, keywords: list) -> bool:
    """全項目が書かれていて、中身も埋まっているか（括弧や区切り記号の違いは気にしない）。"""
    missing, empty = find_intro_items(message_content, keywords)
    return not missing and not empty


def get_intro_channel_ids(settings: dict) -> list:
    """自己紹介チャンネルのID一覧（複数設定。無ければ以前の1つだけの channel_id）。"""
    ids = [int(c) for c in (settings.get("channel_ids") or []) if c]
    if not ids and settings.get("channel_id"):
        ids = [int(settings["channel_id"])]
    return ids


def get_channel_role_rules(settings: dict) -> dict:
    """
    チャンネルごとの追加ロール（例: 男性用の自己紹介チャンネル → 男性ロール）。
    「チャンネルごとのロール付与」がOFFなら空。ONでも、OFFにしてある行は使わない。
    """
    if not settings.get("channel_roles_enabled"):
        return {}
    rules = {}
    for rule in settings.get("channel_roles") or []:
        if not rule.get("enabled", True) or not rule.get("role_ids"):
            continue
        rules.setdefault(int(rule["channel_id"]), [])
        for rid in rule["role_ids"]:
            if int(rid) not in rules[int(rule["channel_id"])]:
                rules[int(rule["channel_id"])].append(int(rid))
    return rules


def get_watch_channel_ids(settings: dict) -> list:
    """監視するチャンネル = 自己紹介チャンネル + チャンネルごとのロールを設定したチャンネル。"""
    ids = get_intro_channel_ids(settings)
    for cid in get_channel_role_rules(settings):
        if cid not in ids:
            ids.append(cid)
    return ids


def has_any_grant(settings: dict) -> bool:
    return bool(settings.get("role_id") or get_channel_role_rules(settings))


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

        intro_channel_ids = get_watch_channel_ids(settings)
        welcome_channel_id = settings.get("welcome_channel_id")
        template = settings.get("template") or ""

        if not intro_channel_ids or not has_any_grant(settings):
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
        """自己紹介として扱うメッセージなら (付与するロール一覧, 項目名) を返す。対象外なら None。"""
        if message.author.bot or not message.guild or not isinstance(message.author, discord.Member):
            return None
        guild = message.guild
        try:
            settings = await database.get_self_intro_role_settings(guild.id)
        except Exception:
            return None
        if not settings.get("is_enabled"):
            return None

        template = settings.get("template") or ""
        if not template or not has_any_grant(settings):
            return None

        # 自己紹介チャンネル（どれか）のメッセージのみ対象（スレッドなら親チャンネルで判定）
        channel_ids = {message.channel.id, getattr(message.channel, "parent_id", None)}
        if not channel_ids & set(get_watch_channel_ids(settings)):
            return None

        # 付与するロール = 共通のロール + 投稿したチャンネルに設定したロール
        role_ids = []
        if settings.get("role_id"):
            role_ids.append(int(settings["role_id"]))
        rules = get_channel_role_rules(settings)
        for cid in channel_ids:
            for rid in rules.get(cid, []) if cid else []:
                if rid not in role_ids:
                    role_ids.append(rid)
        roles = [r for r in (guild.get_role(rid) for rid in role_ids) if r and r not in message.author.roles]
        if not roles:
            return None
        items = extract_template_items(template)
        if not items:
            return None
        return roles, items

    async def _try_grant(self, message: discord.Message, notify: bool = True, warn: bool = True) -> bool:
        """テンプレートの項目がそろっていればロールを付与する。付与したら True。"""
        target = await self._intro_target(message)
        if not target:
            return False
        roles, items = target
        keywords = [k for k, _ in items]
        names = dict(items)
        missing, empty = find_intro_items(message.content, keywords)
        if missing or empty:
            # 自己紹介のつもりの投稿（項目が半分以上ある）なら、足りない項目を教える
            if warn and len(keywords) - len(missing) >= max(1, len(keywords) / 2):
                lines = []
                if empty:
                    lines.append("✏️ 中身が空の項目: " + " ".join(f"【{names[k]}】" for k in empty))
                if missing:
                    lines.append("❓ 見つからない項目: " + " ".join(f"【{names[k]}】" for k in missing))
                try:
                    await message.reply(
                        "⚠️ 自己紹介の項目がまだ埋まっていないため、ロールを付与できませんでした。\n"
                        + "\n".join(lines)
                        + "\n項目のあとに内容を書いて送り直すか、このメッセージを編集してください。",
                        delete_after=60,
                        mention_author=False,
                    )
                except discord.HTTPException:
                    pass
            return False

        guild = message.guild
        member = message.author
        role_names = "、".join(f"**{r.name}**" for r in roles)
        try:
            await member.add_roles(*roles, reason="自己紹介テンプレート完成によるロール付与")
        except discord.Forbidden:
            print(f"[SelfIntroRoles] Cannot add roles {[r.id for r in roles]} to {member} in guild {guild.id}")
            if warn:
                try:
                    await message.reply(
                        f"⚠️ Botの権限が足りず、ロール {role_names} を付与できませんでした。\n"
                        "管理者の方へ: サーバー設定 → ロール で、Botのロールを付与するロールより上に移動し、「ロールの管理」権限を付けてください。",
                        delete_after=120,
                        mention_author=False,
                    )
                except discord.HTTPException:
                    pass
            return False
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to add role: {e}")
            return False

        # 付与したことがチャンネルでも分かるようにリアクションを付ける
        try:
            await message.add_reaction("✅")
        except discord.HTTPException:
            pass

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
                    f"✅ 【{guild.name}】自己紹介ありがとうございます！ロール {role_names} を付与しました🎉"
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
            if not settings.get("is_enabled") or not has_any_grant(settings) or not settings.get("template"):
                continue
            granted = 0
            for cid in get_watch_channel_ids(settings):
                channel = guild.get_channel(cid)
                if not isinstance(channel, discord.TextChannel):
                    continue
                try:
                    async for message in channel.history(limit=200):
                        if await self._try_grant(message, warn=False):
                            granted += 1
                except (discord.Forbidden, discord.HTTPException) as e:
                    print(f"[SelfIntroRoles] Cannot read history of {cid} in guild {guild.id}: {e}")
            if granted:
                print(f"[SelfIntroRoles] Backfilled self-intro role for {granted} member(s) in guild {guild.id}")


async def setup(bot):
    await bot.add_cog(SelfIntroRoles(bot))
