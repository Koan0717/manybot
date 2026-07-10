"""
cogs/logging_cog.py - ログ機能・荒らし対策
"""
import discord
from discord.ext import commands
import datetime
from helpers import get_setting, send_log
from config import JST


class LoggingCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # ============================================================
    # メンバー参加・退出・BAN
    # ============================================================
    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        embed = discord.Embed(
            title="📥 メンバー参加",
            description=f"{member.mention} がサーバーに参加しました。",
            color=discord.Color.green(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{member} (ID: {member.id})", icon_url=member.display_avatar.url)
        embed.add_field(name="アカウント作成日", value=discord.utils.format_dt(member.created_at, "F"), inline=False)
        await send_log(self.bot, member.guild, "join_leave", embed)

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member):
        embed = discord.Embed(
            title="📤 メンバー退出",
            description=f"{member.mention} がサーバーから退出しました。",
            color=discord.Color.red(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{member} (ID: {member.id})", icon_url=member.display_avatar.url)
        roles = [r.mention for r in member.roles if r.name != "@everyone"]
        if roles:
            embed.add_field(name="保持ロール", value=", ".join(roles[:10]), inline=False)
        await send_log(self.bot, member.guild, "join_leave", embed)

    @commands.Cog.listener()
    async def on_member_ban(self, guild: discord.Guild, user: discord.User):
        embed = discord.Embed(
            title="🔨 BAN",
            description=f"{user.mention} がBANされました。",
            color=discord.Color.dark_red(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{user} (ID: {user.id})", icon_url=user.display_avatar.url)
        await send_log(self.bot, guild, "ban_unban", embed)

    @commands.Cog.listener()
    async def on_member_unban(self, guild: discord.Guild, user: discord.User):
        embed = discord.Embed(
            title="✅ BAN解除",
            description=f"{user.mention} のBANが解除されました。",
            color=discord.Color.green(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{user} (ID: {user.id})", icon_url=user.display_avatar.url)
        await send_log(self.bot, guild, "ban_unban", embed)

    # ============================================================
    # メッセージ編集・削除
    # ============================================================
    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message):
        if before.author.bot or not before.guild:
            return
        if before.content == after.content:
            return

        embed = discord.Embed(
            title="✏️ メッセージ編集",
            color=discord.Color.yellow(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{before.author} (ID: {before.author.id})", icon_url=before.author.display_avatar.url)
        embed.add_field(name="チャンネル", value=before.channel.mention, inline=False)
        embed.add_field(name="編集前", value=before.content[:1024] or "（内容なし）", inline=False)
        embed.add_field(name="編集後", value=after.content[:1024] or "（内容なし）", inline=False)
        embed.add_field(name="メッセージリンク", value=after.jump_url, inline=False)
        await send_log(self.bot, before.guild, "message_edit_delete", embed)

    @commands.Cog.listener()
    async def on_message_delete(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return

        embed = discord.Embed(
            title="🗑️ メッセージ削除",
            color=discord.Color.red(),
            timestamp=datetime.datetime.now(JST)
        )
        embed.set_author(name=f"{message.author} (ID: {message.author.id})", icon_url=message.author.display_avatar.url)
        embed.add_field(name="チャンネル", value=message.channel.mention, inline=False)
        embed.add_field(name="内容", value=message.content[:1024] or "（内容なし）", inline=False)
        await send_log(self.bot, message.guild, "message_edit_delete", embed)

    # ============================================================
    # タイムアウト・ロール変更ログ
    # ============================================================
    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if not after.guild:
            return

        # タイムアウト検知
        if before.timed_out_until != after.timed_out_until:
            if after.timed_out_until:
                embed = discord.Embed(
                    title="⏱️ タイムアウト",
                    description=f"{after.mention} にタイムアウトが設定されました。",
                    color=discord.Color.orange(),
                    timestamp=datetime.datetime.now(JST)
                )
                embed.add_field(
                    name="解除予定",
                    value=discord.utils.format_dt(after.timed_out_until, "F"),
                    inline=False
                )
                await send_log(self.bot, after.guild, "timeout", embed)

    # ============================================================
    # 荒らし対策（スパム検知）
    # ============================================================
    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return

        guild_id = message.guild.id
        user_id  = message.author.id
        now      = datetime.datetime.now(JST)

        # 荒らし対策設定チェック
        cfg = self.bot.get_antigrief_config(guild_id)
        target_categories = cfg.get("categories", set())
        target_channels   = cfg.get("channels", set())
        exempt_roles      = cfg.get("exempt_roles", set())

        # 対象チャンネル判定
        in_target = False
        if target_categories or target_channels:
            if message.channel.id in target_channels:
                in_target = True
            elif message.channel.category and message.channel.category.id in target_categories:
                in_target = True
        else:
            in_target = True  # 設定なし→全チャンネル対象

        if not in_target:
            return

        # 免除ロール確認
        member_role_ids = {r.id for r in message.author.roles}
        if member_role_ids & exempt_roles:
            return
        if message.author.guild_permissions.administrator:
            return

        # スパムトラッカー更新
        tracker = self.bot.spam_tracker.get(user_id, {
            "last_content": "",
            "content_count": 0,
            "everyone_count": 0,
            "last_time": now
        })

        time_diff = (now - tracker["last_time"]).total_seconds()

        if time_diff > 5:
            # 5秒以上経過したらリセット
            tracker = {
                "last_content": message.content,
                "content_count": 1,
                "everyone_count": 1 if message.mention_everyone else 0,
                "last_time": now
            }
        else:
            # 同一内容連続送信チェック（3秒以内に3回以上）
            if message.content == tracker["last_content"] and time_diff < 3:
                tracker["content_count"] += 1
            else:
                tracker["content_count"] = 1
                tracker["last_content"] = message.content

            if message.mention_everyone:
                tracker["everyone_count"] += 1
            tracker["last_time"] = now

        self.bot.spam_tracker[user_id] = tracker

        # タイムアウト判定
        should_timeout = False
        reason = ""
        if tracker["content_count"] >= 3:
            should_timeout = True
            reason = "スパム検知（短時間に同一内容を3回以上送信）"
        elif tracker["everyone_count"] >= 2:
            should_timeout = True
            reason = "スパム検知（@everyone/@here の連続使用）"
        elif len(message.mentions) >= 8:
            should_timeout = True
            reason = "スパム検知（大量メンション）"

        if should_timeout:
            try:
                until = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
                await message.author.timeout(until, reason=reason)

                embed = discord.Embed(
                    title="🚨 自動タイムアウト",
                    description=f"{message.author.mention} を自動タイムアウト（1時間）しました。",
                    color=discord.Color.dark_red(),
                    timestamp=now
                )
                embed.add_field(name="理由", value=reason, inline=False)
                await send_log(self.bot, message.guild, "timeout", embed)

                # リセット
                self.bot.spam_tracker[user_id] = {
                    "last_content": "",
                    "content_count": 0,
                    "everyone_count": 0,
                    "last_time": now
                }
            except Exception as e:
                print(f"[ERROR] Auto timeout failed for {message.author}: {e}")


async def setup(bot):
    await bot.add_cog(LoggingCog(bot))
