import re

import discord
from discord.ext import commands

from helpers import get_setting, has_interviewer_role

# 告知パネル: 面接官が時刻のボタン（20:30 など）や「5分前告知」を押すと、ダッシュボードの面接官設定で
# 決めた文章を告知チャンネルに出し、面接官統括ロールへ通知チャンネルでメンション付きのお知らせを送る。

DEFAULT_TIMES = ["20:30", "21:30", "22:30", "23:30"]
DEFAULT_MESSAGE = (
    "# 📢 本日__**{time}より**__入店の儀を開催します。\n\n"
    "参加される方はVCへお越しください。\n\n"
    "尚、\n"
    "__**途中入退出・ミュートでの参加は禁止**__となっております。\n\n"
    "儀式最中に口頭でお答えしてもらう場面がございます。\n"
    "必ず環境が整った状態での参加をお願い致します。\n\n"
    "-# 5分前には会場に入室してください。"
)
DEFAULT_REMINDER_MESSAGE = "# 入店の儀5分前\n\n入店希望の方はVCへお集まりください。"
TIME_PATTERN = re.compile(r"^[0-9]{1,2}:[0-5][0-9]$")
MAX_TIMES = 20  # 1メッセージのボタンは25個まで（5分前告知の分を残す）
REMINDER_KEY = "reminder"


def _to_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_announce_times(bot, guild_id: int) -> list[str]:
    raw = get_setting(bot, "INTERVIEW_ANNOUNCE_TIMES", guild_id)
    if raw is None:
        return list(DEFAULT_TIMES)
    if not isinstance(raw, list):
        raw = [raw]
    times = []
    for t in raw:
        t = str(t).strip()
        if TIME_PATTERN.match(t) and t not in times:
            times.append(t)
    return times[:MAX_TIMES]


async def _get_channel(guild: discord.Guild, channel_id: int | None):
    if not channel_id:
        return None
    channel = guild.get_channel_or_thread(channel_id)
    if channel:
        return channel
    try:
        return await guild.fetch_channel(channel_id)
    except discord.HTTPException:
        return None


async def notify_managers(bot, guild: discord.Guild, sender: discord.Member, label: str, sent: discord.Message) -> str:
    """面接官統括ロールに、通知チャンネルでメンション付きのお知らせを送る。結果の説明を返す。"""
    channel = await _get_channel(guild, _to_int(get_setting(bot, "INTERVIEW_MANAGER_NOTIFY_CHANNEL_ID", guild.id)))
    if not channel:
        return "（面接官統括への通知先チャンネルが未設定のため、通知はしていません）"

    role_ids = get_setting(bot, "INTERVIEW_MANAGER_ROLE_IDS", guild.id) or []
    if not isinstance(role_ids, list):
        role_ids = [role_ids]
    roles = [r for r in (guild.get_role(_to_int(rid) or 0) for rid in role_ids) if r]
    mentions = " ".join(r.mention for r in roles)
    content = f"📢 {sender.mention} が **{label}** を {sent.channel.mention} に送信しました。\n{sent.jump_url}"
    if mentions:
        content = f"{mentions}\n{content}"
    try:
        await channel.send(content, allowed_mentions=discord.AllowedMentions(roles=True, users=False, everyone=False))
    except discord.HTTPException as e:
        return f"（面接官統括への通知に失敗しました: {e}）"
    if not roles:
        return f"{channel.mention} に通知しました（面接官統括ロールが未設定のため、メンションはしていません）。"
    return f"{channel.mention} で面接官統括に通知しました。"


class AnnounceButton(discord.ui.DynamicItem[discord.ui.Button], template=r"interview_announce:(?P<key>[0-9]{1,2}:[0-9]{2}|reminder)"):
    """告知パネルのボタン。押したときの設定で文章を作るので、設置後に文章を変えてもそのまま使える。"""

    def __init__(self, key: str):
        is_reminder = key == REMINDER_KEY
        super().__init__(discord.ui.Button(
            label="5分前告知" if is_reminder else key,
            emoji="⏰" if is_reminder else "📢",
            style=discord.ButtonStyle.danger if is_reminder else discord.ButtonStyle.primary,
            custom_id=f"interview_announce:{key}"
        ))
        self.key = key

    @classmethod
    async def from_custom_id(cls, interaction: discord.Interaction, item: discord.ui.Button, match, /):
        return cls(match["key"])

    async def callback(self, interaction: discord.Interaction):
        bot = interaction.client
        guild = interaction.guild
        if not guild or not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このボタンを使う権限がありません（面接官ロールが必要です）。", ephemeral=True)

        channel = await _get_channel(guild, _to_int(get_setting(bot, "INTERVIEW_ANNOUNCE_CHANNEL_ID", guild.id)))
        if not channel:
            return await interaction.response.send_message("❌ 告知チャンネルが設定されていません。ダッシュボードの「面接官設定」で設定してください。", ephemeral=True)

        if self.key == REMINDER_KEY:
            label = "5分前告知"
            text = get_setting(bot, "INTERVIEW_ANNOUNCE_REMINDER_MESSAGE", guild.id) or DEFAULT_REMINDER_MESSAGE
        else:
            label = f"{self.key}の告知"
            text = (get_setting(bot, "INTERVIEW_ANNOUNCE_MESSAGE", guild.id) or DEFAULT_MESSAGE).replace("{time}", self.key)

        await interaction.response.defer(ephemeral=True)
        try:
            sent = await channel.send(str(text)[:2000], allowed_mentions=discord.AllowedMentions(everyone=True, roles=True, users=True))
        except discord.HTTPException as e:
            return await interaction.followup.send(f"❌ {channel.mention} に告知を送信できませんでした（Botの権限を確認してください）: {e}", ephemeral=True)

        notice = await notify_managers(bot, guild, interaction.user, label, sent)
        await interaction.followup.send(f"✅ {channel.mention} に{label}を送信しました。\n{notice}", ephemeral=True)


async def post_announce_panel(bot, guild: discord.Guild, channel):
    """IPC・コマンドから呼ばれる: 告知パネルを投稿する。ボタンは設置時点の時刻設定で並べる。"""
    times = get_announce_times(bot, guild.id)
    announce_channel = await _get_channel(guild, _to_int(get_setting(bot, "INTERVIEW_ANNOUNCE_CHANNEL_ID", guild.id)))
    embed = discord.Embed(
        title="📢 告知パネル",
        description="面接官は時刻のボタンを押すと、その時刻の告知を送信できます。\n"
                    "「5分前告知」で開始5分前のお知らせを送信します。\n"
                    "送信すると面接官統括にもお知らせが届きます。",
        color=discord.Color.from_rgb(255, 140, 190)
    )
    embed.add_field(name="告知チャンネル", value=announce_channel.mention if announce_channel else "未設定（ダッシュボードの面接官設定で設定してください）", inline=False)
    view = discord.ui.View(timeout=None)
    for t in times:
        view.add_item(AnnounceButton(t))
    view.add_item(AnnounceButton(REMINDER_KEY))
    await channel.send(embed=embed, view=view)


class InterviewAnnounce(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_dynamic_items(AnnounceButton)


async def setup(bot):
    await bot.add_cog(InterviewAnnounce(bot))
