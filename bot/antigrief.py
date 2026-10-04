"""荒らし対策（スパム検知・NGキーワード検知・タイムアウト・管理者通知）"""
import datetime
import re
import unicodedata

import discord

import config
from helpers import get_setting, send_log

# Discord招待URL検知用パターン（毎メッセージでのコンパイルを避けるためモジュールレベルで定義）
DISCORD_INVITE_PATTERN = re.compile(
    r'(?:https?://)?(?:www\.)?(?:discord\.gg|discord\.com/invite|discordapp\.com/invite)/[a-zA-Z0-9-]+',
    re.IGNORECASE
)

TIMEOUT_DURATION = datetime.timedelta(hours=1)


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


def is_antigrief_target(bot, message: discord.Message) -> bool:
    """このメッセージが荒らし対策の監視対象かどうか"""
    guild = message.guild
    if not guild or not isinstance(message.author, discord.Member):
        return False

    enable_antigrief = get_setting(bot, "ENABLE_ANTIGRIEF", guild.id)
    if enable_antigrief is None:
        enable_antigrief = True
    elif isinstance(enable_antigrief, str):
        enable_antigrief = enable_antigrief.lower() == "true"
    if not enable_antigrief:
        return False

    cfg = bot.get_antigrief_config(guild.id)

    # 免除ロールチェック
    exempt_roles = cfg.get("exempt_roles", set())
    if exempt_roles & {role.id for role in message.author.roles}:
        return False

    # 対象カテゴリー/チャンネルチェック
    target_categories = cfg.get("categories", set())
    target_channels = cfg.get("channels", set())
    if target_categories or target_channels:
        in_target_channel = message.channel.id in target_channels
        category = getattr(message.channel, "category", None)
        in_target_category = category is not None and category.id in target_categories
        if not in_target_channel and not in_target_category:
            return False
    return True


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


async def _notify_timeout(bot, message: discord.Message, reason: str, keyword: str | None, timed_out: bool, error: str | None):
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
    if keyword:
        embed.add_field(name="検知キーワード", value=f"`{keyword}`", inline=True)
    embed.add_field(name="チャンネル", value=message.channel.mention, inline=True)
    if timed_out:
        embed.add_field(name="タイムアウト", value=f"1時間（<t:{int(until.timestamp())}:f> まで）", inline=True)
    else:
        embed.add_field(name="エラー", value=_clip(error or "不明なエラー"), inline=False)
    embed.add_field(name="メッセージ内容", value=_clip(message.content), inline=False)

    # 管理者チャット（メンション付き）
    admin_channel_id = bot.get_antigrief_config(guild.id).get("admin_channel_id")
    if admin_channel_id:
        channel = guild.get_channel(admin_channel_id)
        if channel is None:
            try:
                channel = await guild.fetch_channel(admin_channel_id)
            except Exception:
                channel = None
        if channel is not None:
            action = "をタイムアウト（1時間）しました" if timed_out else "のタイムアウトに失敗しました"
            try:
                await channel.send(
                    content=f"🚨 {member.mention}（{discord.utils.escape_markdown(member.display_name)}）{action}。",
                    embed=embed,
                )
            except Exception as e:
                print(f"[ERROR] Failed to notify antigrief admin channel {admin_channel_id}: {e}")

    # ログチャンネル
    await send_log(bot, guild, "antigrief", embed)


async def handle_antigrief(bot, message: discord.Message) -> bool:
    """荒らし対策を実行する。タイムアウト処理を行った場合 True を返す"""
    if not is_antigrief_target(bot, message):
        return False

    keyword = find_ng_keyword(message.content, bot.get_antigrief_config(message.guild.id).get("ng_keywords", []))
    if keyword:
        reason = f"NGキーワード「{keyword}」を含むメッセージを送信したため"
    else:
        reason = _detect_spam(bot, message)
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
        await _notify_timeout(bot, message, reason, keyword, timed_out, error)
    except Exception as e:
        print(f"[ERROR] Antigrief notification failed: {e}")
    return True
