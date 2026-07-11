import discord
from discord.ext import commands, tasks
from discord import app_commands
import datetime
import database
from helpers import JST, TC_XP_REWARD, TC_XP_COOLDOWN, VC_XP_PER_MIN, get_setting, is_rank_eligible, is_vc_coins_eligible, check_and_assign_level_roles, check_and_assign_level_coins

class Leveling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.tc_xp_cooldowns = {}   # {user_id: timestamp}
        self.vc_reward_loop.start()

    def cog_unload(self):
        self.vc_reward_loop.cancel()

    @tasks.loop(minutes=1)
    async def vc_reward_loop(self):
        now = datetime.datetime.now(JST)
        for user_id, last_reward_time in list(self.bot.vc_sessions.items()):
            member = None
            for guild in self.bot.guilds:
                m = guild.get_member(user_id)
                if m and m.voice and m.voice.channel:
                    member = m
                    break
            
            if member:
                in_correct_category = is_rank_eligible(self.bot, member.voice.channel)
                eval_category_id = get_setting(self.bot, "EVALUATION_CATEGORY_ID")
                is_eval_category = (member.voice.channel.category and member.voice.channel.category.id == eval_category_id)
                
                enable_vc_coins = get_setting(self.bot, "ENABLE_VC_COINS")
                if enable_vc_coins is None: enable_vc_coins = True
                actual_coins_eligible = is_vc_coins_eligible(self.bot, member.voice.channel) and enable_vc_coins
                
                if not in_correct_category and not is_eval_category and not actual_coins_eligible:
                    self.bot.vc_sessions.pop(user_id, None)
                    continue

                elapsed_minutes = int((now - last_reward_time).total_seconds() / 60)
                if elapsed_minutes >= 1:
                    if in_correct_category:
                        xp_reward = elapsed_minutes * VC_XP_PER_MIN
                        print(f"[DEBUG] VC XP Awarding: {member.display_name}")
                        new_lv = await database.add_xp(member.guild.id, user_id, xp_reward, "vc")
                        if new_lv:
                            lv_channel = self.bot.get_channel(get_setting(self.bot, "LEVEL_UP_CHANNEL_ID"))
                            if lv_channel:
                                await lv_channel.send(f"🎊 {member.mention} が **VCレベルアップ！** (Lv.{new_lv-1} ➔ **{new_lv}**)")
                            await check_and_assign_level_roles(self.bot, member, "vc", new_lv)
                            await check_and_assign_level_coins(self.bot, member, "vc", new_lv)
                        
                    if actual_coins_eligible:
                        coins_per_min = get_setting(self.bot, "VC_COINS_PER_MIN")
                        if coins_per_min is None: coins_per_min = 12
                        coins_reward = elapsed_minutes * coins_per_min
                        if coins_reward > 0:
                            await database.add_balance(member.guild.id, user_id, coins_reward)
                            print(f"[DEBUG] VC Coins Awarding: {member.display_name} - {coins_reward} coins")
                    
                    if member.voice.channel and member.voice.channel.category:
                        elapsed_seconds = int((now - last_reward_time).total_seconds())
                        await database.add_vc_duration(user_id, member.voice.channel.category.id, elapsed_seconds)
                    
                    self.bot.vc_sessions[user_id] = now
            else:
                self.bot.vc_sessions.pop(user_id, None)

    @vc_reward_loop.before_loop
    async def before_vc_reward_loop(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot:
            return

        if not get_setting(self.bot, "ENABLE_TC_RANK"):
            return

        user_id = message.author.id
        now = datetime.datetime.now(JST)
        in_correct_category = is_rank_eligible(self.bot, message.channel)

        if in_correct_category:
            last_xp_time = self.tc_xp_cooldowns.get(user_id)
            if not last_xp_time or (now - last_xp_time).total_seconds() > TC_XP_COOLDOWN:
                new_lv = await database.add_xp(message.guild.id, user_id, TC_XP_REWARD, "tc")
                self.tc_xp_cooldowns[user_id] = now
                if new_lv:
                    lv_channel = self.bot.get_channel(get_setting(self.bot, "LEVEL_UP_CHANNEL_ID"))
                    if lv_channel:
                        await lv_channel.send(f"🎊 {message.author.mention} が **TCレベルアップ！** (Lv.{new_lv-1} ➔ **{new_lv}**)")
                    if isinstance(message.author, discord.Member):
                        await check_and_assign_level_roles(self.bot, message.author, "tc", new_lv)
                        await check_and_assign_level_coins(self.bot, message.author, "tc", new_lv)

class RankGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="rank", description="ランク（レベル）に関するコマンド")
        self.bot = bot

    @app_commands.command(name="info", description="自分または他ユーザーのランク（レベル）を表示します")
    async def info(self, interaction: discord.Interaction, user: discord.Member = None):
        try:
            await interaction.response.defer(ephemeral=True)
        except:
            return

        try:
            target_user = user or interaction.user
            user_data = await database.get_user(target_user.id)
            
            tc_xp, tc_lv = user_data["tc_xp"], user_data["tc_level"]
            vc_xp, vc_lv = user_data["vc_xp"], user_data["vc_level"]
            tc_next = database.get_next_level_xp(tc_lv)
            vc_next = database.get_next_level_xp(vc_lv)

            # アバターとロゴのバイナリ取得
            avatar_bytes = None
            try:
                avatar_bytes = await target_user.display_avatar.read()
            except Exception as e:
                print(f"[Leveling Cog] Failed to read avatar for {target_user.display_name}: {e}")
                
            server_logo_bytes = None
            if interaction.guild and interaction.guild.icon:
                try:
                    server_logo_bytes = await interaction.guild.icon.read()
                except Exception as e:
                    print(f"[Leveling Cog] Failed to read guild icon: {e}")

            # ロール名の取得
            user_role_ids = {r.id for r in target_user.roles}
            
            vc_role_name = None
            vc_rewards = await database.get_level_role_rewards("vc")
            vc_rewards.sort(key=lambda x: x["level"], reverse=True)
            for r in vc_rewards:
                if r["role_id"] in user_role_ids:
                    role = target_user.guild.get_role(r["role_id"])
                    if role:
                        vc_role_name = role.name
                        break
            
            tc_role_name = None
            tc_rewards = await database.get_level_role_rewards("tc")
            tc_rewards.sort(key=lambda x: x["level"], reverse=True)
            for r in tc_rewards:
                if r["role_id"] in user_role_ids:
                    role = target_user.guild.get_role(r["role_id"])
                    if role:
                        tc_role_name = role.name
                        break

            enable_tc = bool(get_setting(self.bot, "ENABLE_TC_RANK"))

            # 評価浮上時間の取得
            eval_category_id = get_setting(self.bot, "EVALUATION_CATEGORY_ID")
            eval_time_str = "0時間0分0秒"
            if eval_category_id and eval_category_id != 123456789012345678:
                stay_seconds = await database.get_vc_duration_for_categories(target_user.id, [eval_category_id])
                active_extra = 0
                if target_user.id in self.bot.vc_sessions and target_user.voice and target_user.voice.channel and target_user.voice.channel.category:
                    if target_user.voice.channel.category.id == eval_category_id:
                        join_time = self.bot.vc_sessions[target_user.id]
                        active_extra = int((datetime.datetime.now(JST) - join_time).total_seconds())
                total_seconds = stay_seconds + active_extra
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                seconds = total_seconds % 60
                eval_time_str = f"{hours}時間{minutes}分{seconds}秒"

            # ランクカード画像の生成
            import io
            from card_generator import generate_rank_card
            try:
                card_bytes = await generate_rank_card(
                    user_name=target_user.display_name,
                    avatar_bytes=avatar_bytes,
                    server_logo_bytes=server_logo_bytes,
                    vc_level=vc_lv,
                    vc_xp=vc_xp,
                    vc_next_xp=vc_next,
                    vc_role_name=vc_role_name,
                    tc_level=tc_lv,
                    tc_xp=tc_xp,
                    tc_next_xp=tc_next,
                    tc_role_name=tc_role_name,
                    enable_tc=enable_tc,
                    eval_time_str=eval_time_str
                )
                file = discord.File(fp=io.BytesIO(card_bytes), filename="rank_card.png")
                await interaction.followup.send(file=file)
                return
            except Exception as e:
                print(f"[Leveling Cog] Image generation error, falling back to text embed: {e}")


            # --- フォールバック: 画像生成が失敗した場合はテキストベースのEmbedを送信 ---
            def create_progress_bar(current, total, length=12):
                if total <= 0: total = 100
                pct = min(current / total, 1.0)
                filled = int(pct * length)
                bar = "▰" * filled + "▱" * (length - filled)
                return f"{bar}  **{int(pct*100)}%**"

            tc_needed = tc_next - tc_xp
            tc_est_msgs = -(-tc_needed // TC_XP_REWARD)
            
            vc_needed = vc_next - vc_xp
            vc_est_mins = -(-vc_needed // VC_XP_PER_MIN)

            eval_category_id = get_setting(self.bot, "EVALUATION_CATEGORY_ID")
            eval_time_str = "0時間0分0秒"
            if eval_category_id and eval_category_id != 123456789012345678:
                stay_seconds = await database.get_vc_duration_for_categories(target_user.id, [eval_category_id])
                active_extra = 0
                if target_user.id in self.bot.vc_sessions and target_user.voice and target_user.voice.channel and target_user.voice.channel.category:
                    if target_user.voice.channel.category.id == eval_category_id:
                        join_time = self.bot.vc_sessions[target_user.id]
                        active_extra = int((datetime.datetime.now(JST) - join_time).total_seconds())
                total_seconds = stay_seconds + active_extra
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                seconds = total_seconds % 60
                eval_time_str = f"{hours}時間{minutes}分{seconds}秒"

            embed = discord.Embed(
                title=f"✨ {target_user.display_name} のステータス",
                description=f"{target_user.mention} の活動記録です。",
                color=0x2f3136
            )
            embed.set_thumbnail(url=target_user.display_avatar.url)

            if get_setting(self.bot, "ENABLE_TC_RANK"):
                tc_value = (
                    f"**Level:** `{tc_lv}`\n"
                    f"**Next:** `{tc_xp}` / `{tc_next}` XP\n"
                    f"{create_progress_bar(tc_xp, tc_next)}\n"
                    f"┗ 次のレベルまであと **{tc_needed}** XP\n"
                    f"┗ 目安: あと **約{tc_est_msgs}通** のチャット"
                )
                embed.add_field(name="💬 テキスト活動 (TC)", value=tc_value, inline=False)

            vc_value = (
                f"**Level:** `{vc_lv}`\n"
                f"**Next:** `{vc_xp}` / `{vc_next}` XP\n"
                f"{create_progress_bar(vc_xp, vc_next)}\n"
                f"┗ 次のレベルまであと **{vc_needed}** XP\n"
                f"┗ 目安: あと **約{vc_est_mins}分** の滞在"
            )
            embed.add_field(name="🎙️ ボイス活動 (VC)", value=vc_value, inline=False)
            embed.add_field(name="⏱️ 評価浮上時間", value=f"**{eval_time_str}**", inline=False)

            embed.set_footer(text=f"Requested by {interaction.user.display_name}", icon_url=interaction.user.display_avatar.url)
            embed.timestamp = datetime.datetime.now(JST)

            await interaction.followup.send(embed=embed)
        except Exception as e:
            print(f"[ERROR] rank command: {e}")
            try:
                await interaction.followup.send(f"❌ エラーが発生しました: `{e}`", ephemeral=True)
            except:
                pass

    @app_commands.command(name="top", description="VCレベルのランキングを表示します")
    async def top(self, interaction: discord.Interaction):
        try:
            await interaction.response.defer(ephemeral=True)
        except:
            return

        try:
            ranking = await database.get_vc_ranking(10)
            if not ranking:
                await interaction.followup.send("📭 ランキングデータがありません。", ephemeral=True)
                return

            embed = discord.Embed(
                title="🏆 VCレベルランキング (Top 10)",
                description="VCレベルが最も高いメンバーのランキングです。",
                color=0xf1c40f
            )
            embed.timestamp = datetime.datetime.now(JST)

            for i, r in enumerate(ranking, 1):
                user_id = r["user_id"]
                member = interaction.guild.get_member(user_id)
                if not member:
                    try:
                        member = await interaction.guild.fetch_member(user_id)
                    except:
                        pass
                
                name = member.display_name if member else f"不明なユーザー (ID: {user_id})"
                mention = member.mention if member else ""
                
                medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else f"**#{i}**"
                embed.add_field(
                    name=f"{medal} {name}",
                    value=f"┗ **Level:** `{r['vc_level']}` | **XP:** `{r['vc_xp']}` {mention}",
                    inline=False
                )

            await interaction.followup.send(embed=embed)
        except Exception as e:
            print(f"[ERROR] rank top command: {e}")
            try:
                await interaction.followup.send(f"❌ エラーが発生しました: `{e}`", ephemeral=True)
            except:
                pass

async def setup(bot):
    await bot.add_cog(Leveling(bot))
    bot.tree.add_command(RankGroup(bot))
