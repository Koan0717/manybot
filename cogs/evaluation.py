import discord
from discord.ext import commands, tasks
from discord import app_commands
import datetime
import database
from helpers import (
    JST, get_setting, get_role_by_setting, get_evaluator_tier, has_evaluator_role,
    format_evaluation_datetime, NEW_MEMBER_ROLE_NAME, ADMIN_ROLE_NAMES,
    EVALUATOR_ROLE_NAMES
)

class EvaluatorSheetSelect(discord.ui.Select):
    def __init__(self, target_user, data):
        self.target_user = target_user
        self.data = data
        options = [
            discord.SelectOption(label=f"評価ID: {d['eval_id']} ({d['evaluator_name']})", value=str(d['eval_id']))
            for d in data
        ]
        super().__init__(placeholder="詳細を見る評価を選択してください...", options=options)

    async def callback(self, interaction: discord.Interaction):
        eval_id = int(self.values[0])
        eval_info = next(d for d in self.data if d["eval_id"] == eval_id)
        
        embed = discord.Embed(
            title=f"📋 評価詳細 (ID: {eval_id})",
            color=discord.Color.blue()
        )
        embed.add_field(name="対象者", value=self.target_user.mention, inline=True)
        embed.add_field(name="評価員", value=eval_info["evaluator_name"], inline=True)
        embed.add_field(name="評価時間", value=format_evaluation_datetime(eval_info["created_at"]), inline=False)
        embed.add_field(name="点数", value=f"**{eval_info['score']}点**", inline=True)
        embed.add_field(name="スタンプ数", value=f"{eval_info['stamp_count']}個", inline=True)
        embed.add_field(name="コメント", value=eval_info["comment"] or "コメントなし", inline=False)
        
        await interaction.response.send_message(embed=embed, ephemeral=True)

class EvaluatorSheetSelectView(discord.ui.View):
    def __init__(self, target_user, data):
        super().__init__(timeout=180)
        self.add_item(EvaluatorSheetSelect(target_user, data))

class EvaluationGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価員", description="評価員専用コマンド")
        self.bot = bot

    @app_commands.command(name="help", description="評価員用コマンドの使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="📋 評価員用コマンドの使い方",
            description="評価対象者の評価期間管理や進捗確認を行うことができます。",
            color=discord.Color.blue()
        )
        embed.add_field(name="1. /評価員 開始 <ユーザー> [期間(日)]", value="指定ユーザーの評価期間（デフォルト14日）を開始します。", inline=False)
        embed.add_field(name="2. /評価員 確認 <ユーザー>", value="指定ユーザーの現在の評価状況（平均点、スタンプ数、評価浮上時間など）を確認します。", inline=False)
        embed.add_field(name="3. /評価員 期間変更 <ユーザー> <追加日数>", value="指定ユーザーの評価終了予定日時を変更します（マイナス値で短縮も可能）。", inline=False)
        embed.add_field(name="4. /評価シート 登録 <ユーザー> <点数(0-10)> <スタンプ数> [コメント]", value="対象メンバーの評価を登録します。", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    def has_evaluator_permission(self):
        async def predicate(interaction: discord.Interaction):
            if not interaction.guild: return False
            if has_evaluator_role(self.bot, interaction.user):
                return True
            await interaction.response.send_message("このコマンドを実行する権限がありません（評価員ロールが必要です）。", ephemeral=True)
            return False
        return app_commands.check(predicate)

    @app_commands.command(name="開始", description="【評価員専用】指定したユーザーの評価期間を開始します")
    @app_commands.describe(user="評価対象のユーザー", duration_days="評価期間の日数 (デフォルト: 14)")
    async def start_eval(self, interaction: discord.Interaction, user: discord.Member, duration_days: int = 14):
        bot = self.bot
        if not has_evaluator_role(bot, interaction.user):
            return await interaction.response.send_message("この操作を行う権限がありません。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        now = datetime.datetime.now(JST)
        start_time = now
        end_time = start_time + datetime.timedelta(days=duration_days)
        
        await database.add_evaluation_period(interaction.guild.id, user.id, start_time, end_time)
        
        embed = discord.Embed(
            title="✅ 評価期間開始",
            description=f"{user.mention} の評価期間を設定しました。\n"
                        f"**開始:** {format_evaluation_datetime(start_time)}\n"
                        f"**終了:** {format_evaluation_datetime(end_time)}",
            color=discord.Color.green()
        )
        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="確認", description="【評価員専用】指定したユーザーの評価状況を確認します")
    @app_commands.describe(user="確認するユーザー")
    async def check_eval(self, interaction: discord.Interaction, user: discord.Member):
        bot = self.bot
        if not has_evaluator_role(bot, interaction.user):
            return await interaction.response.send_message("この操作を行う権限がありません。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        period = await database.get_evaluation_period(interaction.guild.id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)
            
        evals = await database.get_user_evaluations(user.id)
        
        embed = discord.Embed(
            title=f"📋 {user.display_name} の評価状況",
            description=f"**評価期間:** {format_evaluation_datetime(period['start_time'])} ～ {format_evaluation_datetime(period['end_time'])}",
            color=discord.Color.blue()
        )
        
        eval_category_id = get_setting(bot, "EVALUATION_CATEGORY_ID")
        eval_time_str = "0時間0分0秒"
        if eval_category_id:
            stay_seconds = await database.get_vc_duration_for_categories(user.id, [eval_category_id])
            active_extra = 0
            if user.id in bot.vc_sessions and user.voice and user.voice.channel and user.voice.channel.category:
                if user.voice.channel.category.id == eval_category_id:
                    join_time = bot.vc_sessions[user.id]
                    active_extra = int((datetime.datetime.now(JST) - join_time).total_seconds())
            total_seconds = stay_seconds + active_extra
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            eval_time_str = f"{hours}時間{minutes}分{seconds}秒"

        embed.add_field(name="⏱️ 評価浮上時間", value=f"**{eval_time_str}**", inline=False)
        
        if not evals:
            embed.add_field(name="評価データ", value="現在、登録されている評価はありません。", inline=False)
            await interaction.followup.send(embed=embed, ephemeral=True)
        else:
            total_score = sum(e["score"] for e in evals)
            avg_score = total_score / len(evals)
            total_stamps = sum(e["stamp_count"] for e in evals)
            
            embed.add_field(name="評価件数", value=f"{len(evals)} 件", inline=True)
            embed.add_field(name="平均点数", value=f"{avg_score:.1f} 点 / 10点", inline=True)
            embed.add_field(name="獲得スタンプ総数", value=f"{total_stamps} 個", inline=True)
            
            await interaction.followup.send(embed=embed, view=EvaluatorSheetSelectView(user, evals), ephemeral=True)

    @app_commands.command(name="期間変更", description="【評価員専用】指定したユーザーの評価終了予定日時を変更します")
    @app_commands.describe(user="対象ユーザー", additional_days="追加する日数（マイナスで短縮）")
    async def extend_period(self, interaction: discord.Interaction, user: discord.Member, additional_days: int):
        bot = self.bot
        if not has_evaluator_role(bot, interaction.user):
            return await interaction.response.send_message("この操作を行う権限がありません。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        period = await database.get_evaluation_period(interaction.guild.id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)
            
        new_end = period["end_time"] + datetime.timedelta(days=additional_days)
        await database.update_evaluation_period_end(user.id, new_end)
        
        await interaction.followup.send(
            f"✅ {user.mention} の評価終了日時を変更しました。\n"
            f"変更後終了予定: {format_evaluation_datetime(new_end)}",
            ephemeral=True
        )

class EvaluatorSheetGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価シート", description="評価員用の評価登録コマンド")
        self.bot = bot

    @app_commands.command(name="登録", description="【評価員専用】対象メンバーの評価を登録します")
    @app_commands.describe(user="評価するユーザー", score="点数 (0〜10)", stamp_count="スタンプ数", comment="コメント（任意）")
    async def create_sheet(self, interaction: discord.Interaction, user: discord.Member, score: int, stamp_count: int, comment: str = ""):
        bot = self.bot
        tier = get_evaluator_tier(bot, interaction.user)
        if tier == 0:
            return await interaction.response.send_message("評価シートを登録する権限がありません。", ephemeral=True)
            
        if score < 0 or score > 10:
            return await interaction.response.send_message("点数は0から10の間で指定してください。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        period = await database.get_evaluation_period(interaction.guild.id, user.id)
        if not period:
            return await interaction.followup.send(f"{user.mention} の評価期間が設定されていません。", ephemeral=True)
            
        await database.add_user_evaluation(
            user_id=user.id,
            evaluator_id=interaction.user.id,
            evaluator_name=interaction.user.display_name,
            score=score,
            stamp_count=stamp_count,
            comment=comment
        )
        
        await interaction.followup.send(f"✅ {user.mention} への評価を登録しました。", ephemeral=True)

# --- Cogの定義 ---
class Evaluation(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(EvaluationGroup(self.bot))
        self.bot.tree.add_command(EvaluatorSheetGroup(self.bot))
        self.check_evaluation_deadlines.start()

    async def cog_unload(self):
        self.bot.tree.remove_command("評価員")
        self.bot.tree.remove_command("評価シート")
        self.check_evaluation_deadlines.cancel()

    @tasks.loop(minutes=5)
    async def check_evaluation_deadlines(self):
        expired_periods = await database.get_expired_evaluation_periods()
        for period in expired_periods:
            guild_id = period["guild_id"]
            user_id = period["user_id"]
            
            # Check settings
            eval_settings = await database.get_evaluation_settings(guild_id)
            if not eval_settings or not eval_settings.get("auto_fail_on_deadline", False):
                continue
                
            guild = self.bot.get_guild(guild_id)
            if not guild:
                continue
                
            member = guild.get_member(user_id)
            if not member:
                continue
                
            # Requirements: Only when they have NEW_MEMBER_ROLE (仮メン)
            temp_member_role = get_role_by_setting(self.bot, guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
            if not temp_member_role or temp_member_role not in member.roles:
                continue
                
            eval_failed_role = get_role_by_setting(self.bot, guild, "DOWNGRADE_ROLE_ID", "評価落ち")
            if not eval_failed_role:
                continue
                
            try:
                # Add fail role and remove temp member role
                roles_to_add = [eval_failed_role]
                roles_to_remove = [temp_member_role]
                
                await member.add_roles(*roles_to_add, reason="評価期間締切超過のため自動評価落ち")
                await member.remove_roles(*roles_to_remove, reason="評価期間締切超過のため自動評価落ち")
                
                # Delete the period from DB since it's processed
                await database.remove_evaluation_period(guild_id, user_id)
                
                # Send notification to the evaluation thread if possible
                forum_ids = eval_settings.get("forum_channel_ids", [])
                notified = False
                for forum_id in forum_ids:
                    if notified: break
                    forum = guild.get_channel(forum_id)
                    if isinstance(forum, discord.ForumChannel):
                        for thread in forum.threads:
                            if thread.owner_id == self.bot.user.id and (str(member.id) in thread.name or member.name.lower() in thread.name.lower()):
                                try:
                                    await thread.send(f"{member.mention} 評価期間の締切を超過したため、自動で評価落ちとなりました。")
                                    notified = True
                                    break
                                except Exception:
                                    pass
                            else:
                                # Sometimes thread name doesn't match, check starter message
                                try:
                                    starter = await thread.fetch_message(thread.id)
                                    if str(member.id) in starter.content:
                                        await thread.send(f"{member.mention} 評価期間の締切を超過したため、自動で評価落ちとなりました。")
                                        notified = True
                                        break
                                except Exception:
                                    pass
                                    
                print(f"[Evaluation] Auto-failed {member.display_name} due to deadline.")
            except Exception as e:
                print(f"[Evaluation ERROR] Failed to auto-fail {member.display_name}: {e}")

    @check_evaluation_deadlines.before_loop
    async def before_check_evaluation_deadlines(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel):
        if channel.guild:
            cfg = self.bot.get_evaluation_config(channel.guild.id)
            changed = False
            if channel.id in cfg["forum_channel_ids"]:
                cfg["forum_channel_ids"].discard(channel.id)
                changed = True
            if channel.id in cfg["self_intro_channel_ids"]:
                cfg["self_intro_channel_ids"].discard(channel.id)
                changed = True
            if changed:
                await database.set_evaluation_settings(channel.guild.id, list(cfg["forum_channel_ids"]), list(cfg["self_intro_channel_ids"]))

    @commands.Cog.listener()
    async def on_member_update(self, before, after):
        bot = self.bot
        human_role = get_role_by_setting(bot, after.guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
        if human_role and human_role in after.roles and human_role not in before.roles:
            eval_settings = await database.get_evaluation_settings(after.guild.id)
            if eval_settings and eval_settings.get("auto_generate_period", True):
                existing = await database.get_evaluation_period(after.guild.id, after.id)
                if not existing:
                    now = datetime.datetime.now(JST)
                    if 23 <= now.hour <= 23:
                        start_time = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    else:
                        start_time = now + datetime.timedelta(minutes=5)
                    
                    end_time = start_time + datetime.timedelta(days=14)
                    await database.add_evaluation_period(after.guild.id, after.id, start_time, end_time)
                    print(f"[Evaluation] Started for {after.display_name}: {start_time} to {end_time}")

        # 評価落ちロール付与検知
        eval_failed_role = get_role_by_setting(bot, after.guild, "DOWNGRADE_ROLE_ID", "評価落ち")
        if eval_failed_role and eval_failed_role in after.roles and eval_failed_role not in before.roles:
            import asyncio
            await asyncio.sleep(1)
            moderator = None
            reason = "評価基準未到達のため"
            is_manual = True
            try:
                async for entry in after.guild.audit_logs(limit=5, action=discord.AuditLogAction.member_role_update):
                    if entry.target.id == after.id:
                        if eval_failed_role in entry.after.roles and eval_failed_role not in entry.before.roles:
                            moderator = entry.user
                            if entry.reason == "通貨マイナスになったため" or (entry.user and entry.user.bot):
                                is_manual = False
                            break
            except Exception as e:
                print(f"[Evaluation Failure Log] Failed to fetch audit log: {e}")
            
            if is_manual:
                embed = discord.Embed(
                    title="📉 評価落ち",
                    description=f"{after.mention} が評価落ちしました。",
                    color=discord.Color.red()
                )
                embed.add_field(name="理由", value=reason, inline=False)
                embed.add_field(name="実行者", value=moderator.mention if moderator else "不明", inline=False)
                await send_log(bot, after.guild, "evaluation_failure", embed)

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot:
            return
            
        guild = message.guild
        if guild:
            try:
                cfg = self.bot.get_evaluation_config(guild.id)
                human_role = get_role_by_setting(self.bot, guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
                print(f"[DEBUG-EVAL] msg_id={message.id} channel={message.channel.id}")
                print(f"  cfg={cfg}")
                print(f"  human_role={human_role.name if human_role else None}")
                has_role = human_role in getattr(message.author, 'roles', [])
                print(f"  has_role={has_role}")
            except Exception as e:
                print(f"[DEBUG-EVAL ERROR] {e}")
                
            cfg = self.bot.get_evaluation_config(guild.id)
            if not cfg.get("is_enabled", True):
                return
            if cfg["forum_channel_ids"] and message.channel.id in cfg["self_intro_channel_ids"]:
                human_role = get_role_by_setting(self.bot, guild, "NEW_MEMBER_ROLE_ID", NEW_MEMBER_ROLE_NAME)
                if human_role and human_role in message.author.roles:
                    # Fetch active threads from Discord API for robust check
                    try:
                        active_threads = await guild.active_threads()
                    except Exception as e:
                        print(f"[ERROR] Failed to fetch active threads: {e}")
                        active_threads = guild.threads

                    for forum_id in cfg["forum_channel_ids"]:
                        forum_channel = self.bot.get_channel(forum_id)
                        if forum_channel is None:
                            try:
                                forum_channel = await self.bot.fetch_channel(forum_id)
                            except Exception as e:
                                print(f"[ERROR] Failed to fetch forum channel {forum_id}: {e}")
                                try:
                                    await message.channel.send(f"⚠️ {message.author.mention} エラー: フォーラムチャンネルにアクセスできません（権限不足）。Discord側でボットに「チャンネルを見る」権限を付与してください！", delete_after=15)
                                except:
                                    pass
                                continue

                        if isinstance(forum_channel, discord.ForumChannel):
                            # Suffix match on unique username to avoid substring mismatch (e.g. *_username)
                            target_suffix = f"_{message.author.name.lower()}"
                            duplicate = any(
                                thread.parent_id == forum_id and thread.name.lower().endswith(target_suffix)
                                for thread in active_threads
                            )
                            
                            if not duplicate:
                                period = await database.get_evaluation_period(message.guild.id, message.author.id)
                                if period:
                                    start_str = format_evaluation_datetime(period['start_time'])
                                    end_str = format_evaluation_datetime(period['end_time'])
                                    content_thread = (
                                        f"**対象者:** {message.author.mention}\n"
                                        f"**評価期間:** {start_str} ～ {end_str}\n\n"
                                        f"**自己紹介へのリンク:**\n{message.jump_url}"
                                    )
                                else:
                                    content_thread = (
                                        f"**対象者:** {message.author.mention}\n"
                                        f"**評価期間:** データが見つかりませんでした。\n\n"
                                        f"**自己紹介へのリンク:**\n{message.jump_url}"
                                    )
                                    
                                thread_name = f"{message.author.display_name}_{message.author.name}"
                                try:
                                    await forum_channel.create_thread(
                                        name=thread_name,
                                        content=content_thread,
                                        reason=f"Auto created evaluation thread for {message.author.display_name}"
                                    )
                                    print(f"[Evaluation Thread] Created for {message.author.display_name} in forum {forum_id}")
                                except Exception as e:
                                    print(f"[ERROR] Failed to create forum thread in forum {forum_id}: {e}")
                                    try:
                                        await message.channel.send(f"⚠️ {message.author.mention} 評価シート（スレッド）の自動生成に失敗しました。\nエラー: `{e}`\nフォーラムの「タグ必須」設定やボットの権限（スレッド作成権限など）を確認してください。", delete_after=15)
                                    except:
                                        pass

async def setup(bot):
    await bot.add_cog(Evaluation(bot))
