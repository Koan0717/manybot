"""
cogs/evaluation.py - 評価機能
全操作は guild_id で分離済み
"""
import discord
from discord.ext import commands
from discord import app_commands
import datetime
import database
from helpers import (
    get_setting, get_role_by_setting,
    get_evaluator_tier, has_evaluator_role,
    format_jst_datetime, send_log
)
from config import JST, DEFAULT_EVAL_DAYS


# ============================================================
# Select Menu: 評価シート詳細表示
# ============================================================
class EvaluatorSheetSelect(discord.ui.Select):
    def __init__(self, target_user: discord.Member, data: list[dict]):
        self.target_user = target_user
        self.data = data
        options = [
            discord.SelectOption(
                label=f"評価ID: {d['eval_id']} ({d['evaluator_name']})",
                value=str(d['eval_id'])
            )
            for d in data[:25]  # Selectは最大25件
        ]
        super().__init__(placeholder="詳細を見る評価を選択してください...", options=options)

    async def callback(self, interaction: discord.Interaction):
        eval_id = int(self.values[0])
        info = next((d for d in self.data if d["eval_id"] == eval_id), None)
        if not info:
            await interaction.response.send_message("評価データが見つかりません。", ephemeral=True)
            return

        embed = discord.Embed(
            title=f"📋 評価詳細 (ID: {eval_id})",
            color=discord.Color.blue()
        )
        embed.add_field(name="対象者",   value=self.target_user.mention, inline=True)
        embed.add_field(name="評価員",   value=info["evaluator_name"],   inline=True)
        embed.add_field(name="評価時間", value=format_jst_datetime(info["created_at"]), inline=False)
        embed.add_field(name="点数",     value=f"**{info['score']}点**",  inline=True)
        embed.add_field(name="スタンプ数", value=f"{info['stamp_count']}個", inline=True)
        embed.add_field(name="コメント", value=info["comment"] or "コメントなし", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)


class EvaluatorSheetSelectView(discord.ui.View):
    def __init__(self, target_user: discord.Member, data: list[dict]):
        super().__init__(timeout=180)
        self.add_item(EvaluatorSheetSelect(target_user, data))


# ============================================================
# /評価員 コマンドグループ
# ============================================================
class EvaluationGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価員", description="評価員専用コマンド")
        self.bot = bot

    @app_commands.command(name="help", description="評価員コマンドの使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="📋 評価員コマンド一覧",
            description="評価対象者の管理・評価を行うコマンドです。",
            color=discord.Color.blue()
        )
        embed.add_field(
            name="/評価員 開始 <ユーザー> [日数]",
            value="指定ユーザーの評価期間を開始します（デフォルト14日）。",
            inline=False
        )
        embed.add_field(
            name="/評価員 確認 <ユーザー>",
            value="評価状況（平均点・スタンプ数・浮上時間）を確認します。",
            inline=False
        )
        embed.add_field(
            name="/評価員 期間変更 <ユーザー> <日数>",
            value="評価終了日を変更します（マイナス値で短縮も可）。",
            inline=False
        )
        embed.add_field(
            name="/評価シート 登録 <ユーザー> <点数> <スタンプ数> [コメント]",
            value="評価シートを登録します（0〜10点）。",
            inline=False
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="開始", description="【評価員専用】指定ユーザーの評価期間を開始します")
    @app_commands.describe(user="評価対象のユーザー", duration_days=f"評価期間の日数（デフォルト: {DEFAULT_EVAL_DAYS}）")
    async def start_eval(self, interaction: discord.Interaction, user: discord.Member, duration_days: int = DEFAULT_EVAL_DAYS):
        if not has_evaluator_role(self.bot, interaction.user):
            return await interaction.response.send_message("評価員ロールが必要です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        now = datetime.datetime.now(JST)
        start_time = now
        end_time = now + datetime.timedelta(days=duration_days)

        await database.add_evaluation_period(guild_id, user.id, start_time, end_time)

        embed = discord.Embed(
            title="✅ 評価期間開始",
            description=(
                f"{user.mention} の評価期間を設定しました。\n"
                f"**開始:** {format_jst_datetime(start_time)}\n"
                f"**終了:** {format_jst_datetime(end_time)}"
            ),
            color=discord.Color.green()
        )
        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="確認", description="【評価員専用】指定ユーザーの評価状況を確認します")
    @app_commands.describe(user="確認するユーザー")
    async def check_eval(self, interaction: discord.Interaction, user: discord.Member):
        if not has_evaluator_role(self.bot, interaction.user):
            return await interaction.response.send_message("評価員ロールが必要です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        period = await database.get_evaluation_period(guild_id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)

        evals = await database.get_user_evaluations(guild_id, user.id)

        embed = discord.Embed(
            title=f"📋 {user.display_name} の評価状況",
            description=(
                f"**評価期間:** {format_jst_datetime(period['start_time'])} ～ {format_jst_datetime(period['end_time'])}"
            ),
            color=discord.Color.blue()
        )
        embed.set_thumbnail(url=user.display_avatar.url)

        # 評価浮上時間
        eval_cat_id = get_setting(self.bot, guild_id, "EVALUATION_CATEGORY_ID")
        eval_time_str = "0時間0分0秒"
        if eval_cat_id:
            stay_sec = await database.get_vc_duration_for_categories(guild_id, user.id, [int(eval_cat_id)])
            # 現在VCに入っている場合はリアルタイム追加
            active_extra = 0
            session = self.bot.vc_sessions.get(user.id)
            if session and session.get("guild_id") == guild_id:
                if user.voice and user.voice.channel and user.voice.channel.category:
                    if user.voice.channel.category.id == int(eval_cat_id):
                        active_extra = int((datetime.datetime.now(JST) - session["join_time"]).total_seconds())
            total_sec = stay_sec + active_extra
            h, rem = divmod(total_sec, 3600)
            m, s = divmod(rem, 60)
            eval_time_str = f"{h}時間{m}分{s}秒"

        embed.add_field(name="⏱️ 評価浮上時間", value=f"**{eval_time_str}**", inline=False)

        if not evals:
            embed.add_field(name="評価データ", value="まだ評価が登録されていません。", inline=False)
            await interaction.followup.send(embed=embed, ephemeral=True)
        else:
            avg_score = sum(e["score"] for e in evals) / len(evals)
            total_stamps = sum(e["stamp_count"] for e in evals)
            embed.add_field(name="評価件数",   value=f"{len(evals)} 件",         inline=True)
            embed.add_field(name="平均点数",   value=f"{avg_score:.1f} / 10点",  inline=True)
            embed.add_field(name="スタンプ総数", value=f"{total_stamps} 個",      inline=True)
            await interaction.followup.send(embed=embed, view=EvaluatorSheetSelectView(user, evals), ephemeral=True)

    @app_commands.command(name="期間変更", description="【評価員専用】評価終了予定日時を変更します")
    @app_commands.describe(user="対象ユーザー", additional_days="追加する日数（マイナスで短縮）")
    async def extend_period(self, interaction: discord.Interaction, user: discord.Member, additional_days: int):
        if not has_evaluator_role(self.bot, interaction.user):
            return await interaction.response.send_message("評価員ロールが必要です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id
        period = await database.get_evaluation_period(guild_id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)

        new_end = period["end_time"] + datetime.timedelta(days=additional_days)
        await database.update_evaluation_period_end(guild_id, user.id, new_end)

        await interaction.followup.send(
            f"✅ {user.mention} の評価終了日時を変更しました。\n"
            f"変更後: {format_jst_datetime(new_end)}",
            ephemeral=True
        )


# ============================================================
# /評価シート コマンドグループ
# ============================================================
class EvaluatorSheetGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価シート", description="評価シートの登録・削除")
        self.bot = bot

    @app_commands.command(name="登録", description="【評価員専用】対象メンバーの評価シートを登録します")
    @app_commands.describe(
        user="評価するユーザー",
        score="点数 (0〜10)",
        stamp_count="スタンプ数",
        comment="コメント（任意）"
    )
    async def create_sheet(self, interaction: discord.Interaction,
                           user: discord.Member, score: int, stamp_count: int, comment: str = ""):
        tier = get_evaluator_tier(self.bot, interaction.user)
        if tier == 0:
            return await interaction.response.send_message("評価シートを登録する権限がありません。", ephemeral=True)
        if not (0 <= score <= 10):
            return await interaction.response.send_message("点数は0〜10の間で指定してください。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        guild_id = interaction.guild.id

        period = await database.get_evaluation_period(guild_id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)

        await database.add_user_evaluation(
            guild_id=guild_id,
            target_user_id=user.id,
            evaluator_id=interaction.user.id,
            evaluator_name=interaction.user.display_name,
            score=score,
            stamp_count=stamp_count,
            comment=comment
        )

        embed = discord.Embed(
            title="✅ 評価シート登録完了",
            color=discord.Color.green()
        )
        embed.add_field(name="対象者", value=user.mention,     inline=True)
        embed.add_field(name="点数",   value=f"{score}点",     inline=True)
        embed.add_field(name="スタンプ数", value=f"{stamp_count}個", inline=True)
        if comment:
            embed.add_field(name="コメント", value=comment, inline=False)

        await interaction.followup.send(embed=embed, ephemeral=True)

        # ログ送信
        log_embed = discord.Embed(
            title="📝 評価シート登録",
            color=discord.Color.blue(),
            timestamp=discord.utils.utcnow()
        )
        log_embed.add_field(name="評価員",   value=f"{interaction.user.mention} (ID:{interaction.user.id})", inline=False)
        log_embed.add_field(name="対象者",   value=f"{user.mention} (ID:{user.id})", inline=False)
        log_embed.add_field(name="点数",     value=f"{score}点", inline=True)
        log_embed.add_field(name="スタンプ数", value=f"{stamp_count}個", inline=True)
        if comment:
            log_embed.add_field(name="コメント", value=comment, inline=False)
        await send_log(self.bot, interaction.guild, "evaluation", log_embed)

    @app_commands.command(name="削除", description="【管理者専用】評価シートIDを指定して削除します")
    @app_commands.describe(eval_id="削除する評価シートのID")
    async def delete_sheet(self, interaction: discord.Interaction, eval_id: int):
        from helpers import has_admin_role
        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)
        if not interaction.guild:
            return

        await interaction.response.defer(ephemeral=True)
        await database.delete_user_evaluation(eval_id, interaction.guild.id)
        await interaction.followup.send(f"✅ 評価シート ID:{eval_id} を削除しました。", ephemeral=True)


# ============================================================
# Cog 本体
# ============================================================
class Evaluation(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(EvaluationGroup(self.bot))
        self.bot.tree.add_command(EvaluatorSheetGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("評価員")
        self.bot.tree.remove_command("評価シート")

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel):
        """チャンネル削除時に評価設定のキャッシュを更新"""
        if not channel.guild:
            return
        guild_id = channel.guild.id
        cfg = self.bot.get_evaluation_config(guild_id)
        changed = False
        if channel.id in cfg["forum_channel_ids"]:
            cfg["forum_channel_ids"].discard(channel.id)
            changed = True
        if channel.id in cfg["self_intro_channel_ids"]:
            cfg["self_intro_channel_ids"].discard(channel.id)
            changed = True
        if changed:
            await database.set_evaluation_settings(
                guild_id,
                list(cfg["forum_channel_ids"]),
                list(cfg["self_intro_channel_ids"])
            )

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        """新メンバーロール付与で評価期間を自動開始"""
        guild_id = after.guild.id
        new_member_role_id = get_setting(self.bot, guild_id, "NEW_MEMBER_ROLE_ID")
        if not new_member_role_id:
            return

        human_role = after.guild.get_role(int(new_member_role_id))
        if not human_role:
            return
        if human_role in after.roles and human_role not in before.roles:
            existing = await database.get_evaluation_period(guild_id, after.id)
            if not existing:
                now = datetime.datetime.now(JST)
                eval_days = get_setting(self.bot, guild_id, "EVAL_DURATION_DAYS") or DEFAULT_EVAL_DAYS
                start_time = now + datetime.timedelta(minutes=5)
                end_time = start_time + datetime.timedelta(days=int(eval_days))
                await database.add_evaluation_period(guild_id, after.id, start_time, end_time)
                print(f"[Evaluation] Auto-started for {after.display_name} in guild {guild_id}")

        # 評価落ちロール付与ログ
        downgrade_role_id = get_setting(self.bot, guild_id, "DOWNGRADE_ROLE_ID")
        if not downgrade_role_id:
            return
        downgrade_role = after.guild.get_role(int(downgrade_role_id))
        if downgrade_role and downgrade_role in after.roles and downgrade_role not in before.roles:
            import asyncio
            await asyncio.sleep(1)
            moderator = None
            try:
                async for entry in after.guild.audit_logs(limit=5, action=discord.AuditLogAction.member_role_update):
                    if entry.target.id == after.id:
                        if downgrade_role in entry.after.roles and downgrade_role not in entry.before.roles:
                            if not (entry.user and entry.user.bot):
                                moderator = entry.user
                            break
            except Exception as e:
                print(f"[WARN] Audit log fetch failed: {e}")

            if moderator:
                embed = discord.Embed(
                    title="📉 評価落ち",
                    description=f"{after.mention} が評価落ちしました。",
                    color=discord.Color.red()
                )
                embed.add_field(name="実行者", value=moderator.mention, inline=False)
                await send_log(self.bot, after.guild, "evaluation_failure", embed)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """自己紹介投稿で評価フォーラムにスレッドを自動作成"""
        if message.author.bot or not message.guild:
            return

        guild_id = message.guild.id
        cfg = self.bot.get_evaluation_config(guild_id)
        if not cfg["forum_channel_ids"]:
            return
        if message.channel.id not in cfg["self_intro_channel_ids"]:
            return

        new_member_role_id = get_setting(self.bot, guild_id, "NEW_MEMBER_ROLE_ID")
        if not new_member_role_id:
            return
        human_role = message.guild.get_role(int(new_member_role_id))
        if not human_role or human_role not in message.author.roles:
            return

        # アクティブスレッドを取得して重複チェック
        try:
            active_threads = await message.guild.active_threads()
        except Exception as e:
            print(f"[ERROR] active_threads fetch: {e}")
            active_threads = message.guild.threads

        for forum_id in cfg["forum_channel_ids"]:
            forum_channel = self.bot.get_channel(forum_id)
            if forum_channel is None:
                try:
                    forum_channel = await self.bot.fetch_channel(forum_id)
                except Exception as e:
                    print(f"[ERROR] Fetch forum channel {forum_id}: {e}")
                    continue

            if not isinstance(forum_channel, discord.ForumChannel):
                continue

            # user_id をスレッド名に含めて重複チェック（名前だけよりも確実）
            target_suffix = f"_{message.author.id}"
            duplicate = any(
                t.parent_id == forum_id and str(message.author.id) in t.name
                for t in active_threads
            )
            if duplicate:
                continue

            period = await database.get_evaluation_period(guild_id, message.author.id)
            if period:
                period_str = (
                    f"**評価期間:** {format_jst_datetime(period['start_time'])} ～ "
                    f"{format_jst_datetime(period['end_time'])}\n\n"
                )
            else:
                period_str = "**評価期間:** 未設定\n\n"

            content = (
                f"**対象者:** {message.author.mention}\n"
                f"{period_str}"
                f"**自己紹介:** {message.jump_url}"
            )
            thread_name = f"{message.author.display_name}_{message.author.id}"

            try:
                await forum_channel.create_thread(
                    name=thread_name,
                    content=content,
                    reason=f"評価スレッド自動作成: {message.author.display_name}"
                )
                print(f"[Evaluation] Thread created for {message.author.display_name} in forum {forum_id}")
            except Exception as e:
                print(f"[ERROR] Create forum thread in {forum_id}: {e}")


async def setup(bot):
    await bot.add_cog(Evaluation(bot))
