"""荒らし対策（スパム検知・NGキーワード検知・タイムアウト・BOT導入制限・管理者通知）"""
import asyncio
import datetime
import re
import unicodedata

import discord

import config
import database
from helpers import get_setting, send_log

# Discord招待URL検知用パターン（毎メッセージでのコンパイルを避けるためモジュールレベルで定義）
DISCORD_INVITE_PATTERN = re.compile(
    r'(?:https?://)?(?:www\.)?(?:discord\.gg|discord\.com/invite|discordapp\.com/invite)/[a-zA-Z0-9-]+',
    re.IGNORECASE
)

TIMEOUT_DURATION = datetime.timedelta(hours=1)

# BOT追加の監査ログは参加イベントより遅れて届くことがあるので、間を空けて数回探す（秒）
BOT_ADD_LOG_RETRY_DELAYS = (0, 0.5, 1, 2)
# 参加時刻よりこれ以上古い監査ログは、以前に同じBotを入れたときの記録として扱わない
BOT_ADD_LOG_MAX_AGE = datetime.timedelta(minutes=1)


def _normalize(text: str) -> str:
    """全角/半角・大文字/小文字の違いを吸収して比較するための正規化"""
    return unicodedata.normalize("NFKC", text or "").lower()


def find_ng_keyword(content: str, keywords) -> str | None:
    """メッセージに含まれるNGキーワードを返す（なければ None）"""
    if not content or not keywords:
        return None
    normalized = _normalize(content)
    for kw in keywords:
        if kw and _normalize(kw) in normalized:
            return kw
    return None


def is_antigrief_enabled(bot, guild: discord.Guild) -> bool:
    """荒らし対策機能全体のオン/オフ"""
    enable_antigrief = get_setting(bot, "ENABLE_ANTIGRIEF", guild.id)
    if enable_antigrief is None:
        return True
    if isinstance(enable_antigrief, str):
        return enable_antigrief.lower() == "true"
    return bool(enable_antigrief)


def _in_scope(message: discord.Message, categories: set, channels: set, exempt_roles: set) -> bool:
    """監視対象（カテゴリー/チャンネル）と免除ロールの判定。対象が未指定なら全チャンネル"""
    if exempt_roles & {role.id for role in message.author.roles}:
        return False
    if categories or channels:
        channel = message.channel
        # スレッド内の発言は親チャンネルの設定に従う
        parent = getattr(channel, "parent", None)
        channel_ids = {channel.id} | ({parent.id} if parent is not None else set())
        category_id = getattr(channel, "category_id", None)
        if not (channel_ids & channels) and category_id not in categories:
            return False
    return True


def is_antigrief_target(bot, message: discord.Message) -> bool:
    """このメッセージがスパム検知（連投・メンション等）の監視対象かどうか"""
    cfg = bot.get_antigrief_config(message.guild.id)
    return _in_scope(
        message,
        cfg.get("categories", set()),
        cfg.get("channels", set()),
        cfg.get("exempt_roles", set()),
    )


def match_ng_rules(message: discord.Message, rules) -> tuple[dict | None, str | None]:
    """NGワードルールを順に判定し、最初に一致した (ルール, キーワード) を返す"""
    for rule in rules or []:
        if not rule.get("enabled", True):
            continue
        if not _in_scope(message, rule.get("categories", set()), rule.get("channels", set()), rule.get("exempt_roles", set())):
            continue
        keyword = find_ng_keyword(message.content, rule.get("keywords", []))
        if keyword:
            return rule, keyword
    return None, None


async def _get_config(bot, guild_id: int) -> dict:
    """荒らし対策設定を返す（NGワードルールが未読込ならDBから読み込む）"""
    cfg = bot.get_antigrief_config(guild_id)
    if "ng_rules" not in cfg:
        try:
            cfg = await bot.fetch_and_cache_antigrief_config(guild_id)
        except Exception as e:
            print(f"[ERROR] Failed to load antigrief NG rules for guild {guild_id}: {e}")
            cfg["ng_rules"] = []
    return cfg


def _detect_spam(bot, message: discord.Message) -> str | None:
    """連投・@everyone・招待URL・メンションスパムを検知して理由を返す"""
    now = datetime.datetime.now(config.JST)
    tracker = bot.spam_tracker.setdefault(message.author.id, {})
    for key in ("content_count", "everyone_count", "invite_count", "mention_count"):
        tracker.setdefault(key, 0)
    tracker.setdefault("last_content", None)
    tracker.setdefault("last_time", now)

    # 3秒以上経過していればリセット
    if (now - tracker["last_time"]).total_seconds() > 3:
        tracker["content_count"] = 0
        tracker["everyone_count"] = 0
        tracker["invite_count"] = 0
        tracker["mention_count"] = 0
    tracker["last_time"] = now

    reason = None

    # 同じメッセージの連続検知 (内容が存在する場合)
    if message.content and message.content == tracker["last_content"]:
        tracker["content_count"] += 1
        if tracker["content_count"] >= 3:
            reason = "連続で同じメッセージを送信したため"
    else:
        tracker["last_content"] = message.content
        tracker["content_count"] = 1

    # @everyone or @here の検知 (3秒以内の累計でカウント)
    if message.mention_everyone:
        tracker["everyone_count"] += 1
        if tracker["everyone_count"] >= 5:
            reason = "短時間に@everyoneメンションを複数回送信したため"

    # Discord招待URLの検知
    if DISCORD_INVITE_PATTERN.search(message.content or ""):
        tracker["invite_count"] += 1
        if tracker["invite_count"] >= 5:
            reason = "連続でDiscordの招待リンクを送信したため"

    # メンションスパムの検知 (ユーザーメンション + 役職メンション)
    msg_mentions = len(message.mentions) + len(message.role_mentions)
    if msg_mentions >= 5:
        reason = "1つのメッセージで大量のメンションを送信したため"
    elif msg_mentions > 0:
        tracker["mention_count"] += msg_mentions
        if tracker["mention_count"] >= 10:
            reason = "短時間に連続してメンションを送信したため"

    if reason:
        tracker["content_count"] = 0
        tracker["everyone_count"] = 0
        tracker["invite_count"] = 0
        tracker["mention_count"] = 0
    return reason


def _clip(text: str, limit: int = 1024) -> str:
    text = text or "（本文なし）"
    return text if len(text) <= limit else text[:limit - 3] + "..."


async def _send_admin_channel(bot, guild: discord.Guild, content: str, embed: discord.Embed):
    """管理者チャットに通知する（未設定なら何もしない）"""
    admin_channel_id = bot.get_antigrief_config(guild.id).get("admin_channel_id")
    if not admin_channel_id:
        return
    channel = guild.get_channel(admin_channel_id)
    if channel is None:
        try:
            channel = await guild.fetch_channel(admin_channel_id)
        except Exception:
            return
    try:
        await channel.send(content=content, embed=embed)
    except Exception as e:
        print(f"[ERROR] Failed to notify antigrief admin channel {admin_channel_id}: {e}")


async def _notify_timeout(bot, message: discord.Message, reason: str, rule: dict | None, keyword: str | None, timed_out: bool, error: str | None):
    """管理者チャットとログチャンネルにタイムアウトを通知する"""
    guild = message.guild
    member = message.author
    until = datetime.datetime.now(config.JST) + TIMEOUT_DURATION

    embed = discord.Embed(
        title="🚨 荒らし対策: タイムアウト" if timed_out else "⚠️ 荒らし対策: タイムアウト失敗",
        color=discord.Color.red() if timed_out else discord.Color.orange(),
        timestamp=datetime.datetime.now(config.JST),
    )
    embed.set_author(name=f"{member.display_name} ({member.name})", icon_url=member.display_avatar.url)
    embed.add_field(name="対象者", value=f"{member.mention} (**{discord.utils.escape_markdown(member.display_name)}** / ID: {member.id})", inline=False)
    embed.add_field(name="理由", value=reason, inline=False)
    if rule is not None:
        embed.add_field(name="NGワードルール", value=rule.get("name") or f"ルール#{rule.get('id')}", inline=True)
    if keyword:
        embed.add_field(name="検知キーワード", value=f"`{keyword}`", inline=True)
    embed.add_field(name="チャンネル", value=message.channel.mention, inline=True)
    if timed_out:
        embed.add_field(name="タイムアウト", value=f"1時間（<t:{int(until.timestamp())}:f> まで）", inline=True)
    else:
        embed.add_field(name="エラー", value=_clip(error or "不明なエラー"), inline=False)
    embed.add_field(name="メッセージ内容", value=_clip(message.content), inline=False)

    # 管理者チャット（メンション付き）
    action = "をタイムアウト（1時間）しました" if timed_out else "のタイムアウトに失敗しました"
    await _send_admin_channel(bot, guild, f"🚨 {member.mention}（{discord.utils.escape_markdown(member.display_name)}）{action}。", embed)

    # ログチャンネル
    await send_log(bot, guild, "antigrief", embed)


async def handle_antigrief(bot, message: discord.Message) -> bool:
    """荒らし対策を実行する。タイムアウト処理を行った場合 True を返す"""
    guild = message.guild
    if not guild or not isinstance(message.author, discord.Member):
        return False
    if not is_antigrief_enabled(bot, guild):
        return False

    cfg = await _get_config(bot, guild.id)

    # NGワードルール（ルールごとの監視対象・免除設定で判定）
    rule, keyword = match_ng_rules(message, cfg.get("ng_rules", []))
    if keyword:
        rule_name = rule.get("name") or f"ルール#{rule.get('id')}"
        reason = f"NGワードルール「{rule_name}」のキーワード「{keyword}」を含むメッセージを送信したため"
    elif is_antigrief_target(bot, message):
        # スパム検知（荒らし対策の監視対象・免除設定で判定）
        reason = _detect_spam(bot, message)
    else:
        reason = None
    if not reason:
        return False

    # トリガーとなったメッセージの自動削除を試みる
    try:
        await message.delete()
    except discord.Forbidden:
        print("[WARNING] Cannot delete message. Missing permissions.")
    except Exception as de:
        print(f"[ERROR] Message deletion failed: {de}")

    timed_out = False
    error = None
    try:
        await message.author.timeout(TIMEOUT_DURATION, reason=f"[荒らし対策] {reason}"[:512])
        timed_out = True
    except Exception as e:
        error = str(e)
        print(f"[ERROR] Timeout failed for {message.author.display_name} ({message.author.id}): {e}")

    if timed_out:
        try:
            await message.channel.send(f"🚨 {message.author.mention} が荒らし対策（{reason}）によりタイムアウトされました。")
        except Exception as e:
            print(f"[ERROR] Failed to send timeout notice: {e}")

    try:
        await _notify_timeout(bot, message, reason, rule, keyword, timed_out, error)
    except Exception as e:
        print(f"[ERROR] Antigrief notification failed: {e}")
    return True


async def _get_bot_guard_config(bot, guild: discord.Guild) -> dict | None:
    """BOT導入制限が有効なら設定を返す（無効、または設定を読めないときは None）"""
    if not is_antigrief_enabled(bot, guild):
        return None
    cfg = bot.get_antigrief_config(guild.id)
    if "bot_guard_enabled" not in cfg:
        try:
            cfg = await bot.fetch_and_cache_antigrief_config(guild.id)
        except Exception as e:
            print(f"[ERROR] Failed to load bot guard settings for guild {guild.id}: {e}")
            return None
    return cfg if cfg.get("bot_guard_enabled") else None


async def _find_bot_adder(guild: discord.Guild, member: discord.Member):
    """監査ログからBotを追加した人を探す（見つからなければ None）"""
    oldest = member.joined_at - BOT_ADD_LOG_MAX_AGE if member.joined_at else None
    for delay in BOT_ADD_LOG_RETRY_DELAYS:
        if delay:
            await asyncio.sleep(delay)
        try:
            async for entry in guild.audit_logs(limit=25, action=discord.AuditLogAction.bot_add):
                if entry.target is None or entry.target.id != member.id:
                    continue
                # 新しい順に並ぶので、古い記録に当たったらこれ以上探しても無い
                if oldest is not None and entry.created_at < oldest:
                    break
                return entry.user
        except discord.Forbidden:
            print(f"[WARNING] Cannot read audit log in guild {guild.id}. Missing permissions.")
            return None
        except Exception as e:
            print(f"[ERROR] Failed to fetch bot_add audit log: {e}")
    return None


async def _notify_bot_guard(bot, member: discord.Member, adder, action: str, error: str | None):
    """未許可Botの処分を管理者チャットとログチャンネルに通知する"""
    guild = member.guild
    label = "BAN" if action == "ban" else "キック"
    embed = discord.Embed(
        title=f"⚠️ 荒らし対策: 未許可BOTの{label}に失敗" if error else f"🚨 荒らし対策: 未許可BOTを{label}",
        color=discord.Color.orange() if error else discord.Color.red(),
        timestamp=datetime.datetime.now(config.JST),
    )
    embed.set_author(name=member.name, icon_url=member.display_avatar.url)
    embed.add_field(name="BOT", value=f"{member.mention} (**{discord.utils.escape_markdown(member.name)}** / ID: {member.id})", inline=False)
    embed.add_field(name="追加した人", value=f"{adder.mention} (ID: {adder.id})" if adder else "不明（監査ログで確認できませんでした）", inline=False)
    if error:
        embed.add_field(name="エラー", value=_clip(error), inline=False)

    result = f"の{label}に失敗しました" if error else f"を{label}しました"
    await _send_admin_channel(bot, guild, f"🚨 未許可のBOT {member.mention}（{discord.utils.escape_markdown(member.name)}）{result}。", embed)
    await send_log(bot, guild, "antigrief", embed)


async def _notify_bot_approved(bot, member: discord.Member, adder):
    """許可された人が入れたBotの自動承認をログチャンネルに記録する"""
    embed = discord.Embed(
        title="✅ 荒らし対策: BOTを承認",
        description=f"{adder.mention} が追加した {member.mention} (ID: {member.id}) を承認しました。",
        color=discord.Color.green(),
        timestamp=datetime.datetime.now(config.JST),
    )
    await send_log(bot, member.guild, "antigrief", embed)


async def _review_bot(bot, member: discord.Member) -> bool:
    """Botを追加した人を確認し、許可された人なら承認、それ以外なら処分する。承認したら True を返す"""
    guild = member.guild
    adder = await _find_bot_adder(guild, member)
    cfg = bot.get_antigrief_config(guild.id)

    # サーバーオーナーは許可リストになくても追加できる
    if adder is not None and (adder.id == guild.owner_id or adder.id in cfg.get("bot_guard_allowed_users", ())):
        try:
            await database.add_approved_bot(guild.id, member.id, member.name, "inviter", adder.id)
        except Exception as e:
            print(f"[ERROR] Failed to save approved bot {member.id}: {e}")
        bot.get_antigrief_config(guild.id).setdefault("approved_bots", set()).add(member.id)
        bot.bot_guard_reviews.pop((guild.id, member.id), None)
        try:
            await _notify_bot_approved(bot, member, adder)
        except Exception as e:
            print(f"[ERROR] Bot guard notification failed: {e}")
        return True

    # 追加した人が分からないときも、許可された人が入れたと確認できないので処分する
    action = cfg.get("bot_guard_action", "kick")
    reason = f"[荒らし対策] 未許可のBOT（追加した人: {adder or '不明'}）"[:512]
    error = None
    try:
        if action == "ban":
            await member.ban(reason=reason)
        else:
            await member.kick(reason=reason)
    except Exception as e:
        error = str(e)
        print(f"[ERROR] Failed to {action} bot {member.name} ({member.id}): {e}")

    try:
        await _notify_bot_guard(bot, member, adder, action, error)
    except Exception as e:
        print(f"[ERROR] Bot guard notification failed: {e}")
    return False


def _start_bot_review(bot, member: discord.Member) -> asyncio.Task:
    """審査を1回だけ走らせる。参加イベントとメッセージで同じ結果を待ち、二重に処分・通知しない"""
    key = (member.guild.id, member.id)
    task = bot.bot_guard_reviews.get(key)
    if task is None:
        task = asyncio.create_task(_review_bot(bot, member))
        bot.bot_guard_reviews[key] = task
    return task


async def handle_bot_join(bot, member: discord.Member):
    """Botの参加時に、未承認ならその場で審査する"""
    if member.id == bot.user.id:
        return
    cfg = await _get_bot_guard_config(bot, member.guild)
    if cfg is None or member.id in cfg.get("approved_bots", ()):
        return
    await _start_bot_review(bot, member)


async def handle_bot_leave(bot, member: discord.Member):
    """退出したBotの承認を取り消す。入れ直すときは許可された人の追加が必要"""
    guild_id = member.guild.id
    bot.bot_guard_reviews.pop((guild_id, member.id), None)
    bot.get_antigrief_config(guild_id).get("approved_bots", set()).discard(member.id)
    try:
        await database.remove_approved_bot(guild_id, member.id)
    except Exception as e:
        print(f"[ERROR] Failed to remove approved bot {member.id}: {e}")


async def handle_bot_message(bot, message: discord.Message):
    """未承認Botのメッセージを削除する。オフライン中に入ったBotもここで審査する"""
    guild = message.guild
    author = message.author
    if not guild or author.id == bot.user.id or author.system:
        return
    member = guild.get_member(author.id)
    # Webhookの投稿は author.bot が True でもサーバーのメンバーではない
    if message.webhook_id is not None and member is None:
        return
    cfg = await _get_bot_guard_config(bot, guild)
    if cfg is None or author.id in cfg.get("approved_bots", ()):
        return
    # 許可された人が入れたBotの最初の発言を消さないよう、審査の結果を待ってから削除する
    if member is not None and await _start_bot_review(bot, member):
        return
    try:
        await message.delete()
    except discord.NotFound:
        pass
    except Exception as e:
        print(f"[ERROR] Failed to delete message from unapproved bot {author.id}: {e}")
