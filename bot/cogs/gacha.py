import discord
from discord.ext import commands, tasks
from discord import app_commands
import random
import datetime
import database
from helpers import get_setting, send_log


async def create_gacha_panel_embed(bot, guild_id: int) -> discord.Embed:
    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    settings = await database.get_gacha_settings(guild_id)
    prizes = await database.get_gacha_prizes(guild_id)

    pull_cost = settings.get("pull_cost", 0)
    cost_text = f"{pull_cost:,} {currency_name}" if pull_cost > 0 else "無料"

    embed = discord.Embed(
        title="🎁 福引ガチャ",
        description=f"下のボタンを押して福引ガチャを引くことができます！\n\n**【消費{currency_name}】** {cost_text}",
        color=discord.Color.red()
    )

    if prizes:
        prize_lines = []
        for p in prizes:
            line = f"・**{p['prize_number']}番**: {p['prize_name']}"
            rewards = []
            if p.get("reward_coins"):
                rewards.append(f"{p['reward_coins']:,}{currency_name}")
            if p.get("reward_role_id"):
                role_dur = p.get("reward_role_duration_days", 0)
                dur_txt = f" ({role_dur}日間)" if role_dur > 0 else " (無期限)"
                rewards.append(f"ロール付与{dur_txt}")
            if rewards:
                line += f" （報酬: {' / '.join(rewards)}）"
            prize_lines.append(line)
        
        embed.add_field(
            name="📜 当選景品一覧",
            value="\n".join(prize_lines[:15]) + ("\n...他" if len(prize_lines) > 15 else ""),
            inline=False
        )

    embed.set_footer(text="※ 結果はあなただけに表示されます。")
    return embed


async def execute_gacha(interaction: discord.Interaction, bot):
    guild = interaction.guild
    member = interaction.user
    if not guild or not isinstance(member, discord.Member):
        await interaction.response.send_message("サーバー内で実行してください。", ephemeral=True)
        return

    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    settings = await database.get_gacha_settings(guild.id)

    if not settings.get("is_enabled", True):
        await interaction.response.send_message("現在、福引ガチャは無効になっています。", ephemeral=True)
        return

    allowed_role_ids = settings.get("allowed_role_ids") or []
    if allowed_role_ids:
        member_role_ids = {str(r.id) for r in member.roles}
        if not any(rid in member_role_ids for rid in allowed_role_ids):
            await interaction.response.send_message("あなたは福引ガチャを引く条件を満たしていません。", ephemeral=True)
            return

    prizes = await database.get_gacha_prizes(guild.id)
    if not prizes:
        await interaction.response.send_message("福引ガチャの景品が設定されていません。管理者にお問い合わせください。", ephemeral=True)
        return

    pull_cost = settings.get("pull_cost") or 0
    if pull_cost > 0:
        user_data = await database.get_user(guild.id, member.id)
        balance = user_data["balance"] if user_data else 0
        if balance < pull_cost:
            await interaction.response.send_message(f"所持{currency_name}が足りません。（必要: {pull_cost:,}{currency_name} / 所持: {balance:,}{currency_name}）", ephemeral=True)
            return
        await database.add_balance(guild.id, member.id, -pull_cost)

    # 重み付き抽選
    weights = [max(p["weight"], 0) for p in prizes]
    if sum(weights) <= 0:
        await interaction.response.send_message("福引ガチャの設定に問題があります。管理者にお問い合わせください。", ephemeral=True)
        return

    won = random.choices(prizes, weights=weights, k=1)[0]

    # 報酬の付与
    reward_lines = []
    if won.get("reward_coins"):
        await database.add_balance(guild.id, member.id, won["reward_coins"])
        reward_lines.append(f"💰 **{won['reward_coins']:,}** {currency_name}")

    if won.get("reward_role_id"):
        role = guild.get_role(won["reward_role_id"])
        if role:
            try:
                await member.add_roles(role, reason="福引ガチャ当選")
                duration_days = won.get("reward_role_duration_days") or 0
                if duration_days > 0:
                    expires_at = await database.add_gacha_user_role(guild.id, member.id, role.id, duration_days, won.get("id"))
                    expires_str = expires_at.strftime("%Y/%m/%d %H:%M")
                    reward_lines.append(f"🎗️ **{role.name}** ロール（有効期限: {duration_days}日間 / 期限: {expires_str}まで）")
                else:
                    reward_lines.append(f"🎗️ **{role.name}** ロール（無期限）")
            except Exception as e:
                print(f"[Gacha] Failed to add reward role: {e}")

    await database.add_gacha_history(guild.id, member.id, won["id"], won["prize_number"], won["prize_name"])

    message = f"🎉 **{won['prize_number']}番『{won['prize_name']}』に当選しました！**"
    if reward_lines:
        message += "\n\n**【獲得報酬】**\n" + "\n".join(reward_lines)

    await interaction.response.send_message(message, ephemeral=True)


class GachaPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🎁 福引を引く", style=discord.ButtonStyle.danger, custom_id="persistent_gacha_btn")
    async def gacha_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await execute_gacha(interaction, interaction.client)


class GachaCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.bot.add_view(GachaPanelView())
        self.check_expired_roles.start()

    def cog_unload(self):
        self.check_expired_roles.cancel()

    @tasks.loop(minutes=1)
    async def check_expired_roles(self):
        try:
            expired_roles = await database.get_expired_gacha_user_roles()
            for record in expired_roles:
                guild = self.bot.get_guild(record["guild_id"])
                if not guild:
                    try:
                        guild = await self.bot.fetch_guild(record["guild_id"])
                    except Exception:
                        pass

                if guild:
                    member = guild.get_member(record["user_id"])
                    if not member:
                        try:
                            member = await guild.fetch_member(record["user_id"])
                        except Exception:
                            pass

                    role = guild.get_role(record["role_id"])
                    if member and role and role in member.roles:
                        try:
                            await member.remove_roles(role, reason="福引ガチャ報酬ロールの有効期限切れによる剥奪")
                            print(f"[Gacha] Removed expired role '{role.name}' from {member.display_name} in {guild.name}")

                            # ログ通知
                            embed = discord.Embed(
                                title="⏰ 福引報酬ロール有効期限切れ剥奪",
                                color=discord.Color.red(),
                                timestamp=datetime.datetime.now(datetime.timezone.utc)
                            )
                            embed.add_field(name="対象者", value=f"{member.mention} ({member.display_name})", inline=False)
                            embed.add_field(name="剥奪ロール", value=f"{role.name} (`{role.id}`)", inline=False)
                            await send_log(self.bot, guild, "gacha", embed)
                        except discord.Forbidden:
                            print(f"[Gacha] Permission denied removing role {role.name} from {member.display_name}")
                        except Exception as e:
                            print(f"[Gacha] Error removing role {role.name} from {member.display_name}: {e}")

                await database.mark_gacha_user_role_removed(record["id"])
        except Exception as e:
            print(f"[Gacha] Error in check_expired_roles loop: {e}")

    @check_expired_roles.before_loop
    async def before_check_expired_roles(self):
        await self.bot.wait_until_ready()

    @app_commands.command(name="ガチャ", description="福引ガチャを引きます")
    async def gacha(self, interaction: discord.Interaction):
        await execute_gacha(interaction, self.bot)

    @app_commands.command(name="福引パネル設置", description="このチャンネルに福引パネルを設置します (管理者専用)")
    @app_commands.default_permissions(administrator=True)
    async def setup_gacha_panel(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("サーバー内で実行してください。", ephemeral=True)
            return

        embed = await create_gacha_panel_embed(self.bot, interaction.guild.id)
        view = GachaPanelView()
        await interaction.channel.send(embed=embed, view=view)
        await interaction.response.send_message("✅ 福引パネルを設置しました！", ephemeral=True)


async def setup(bot):
    await bot.add_cog(GachaCog(bot))
    bot.add_view(GachaPanelView())
