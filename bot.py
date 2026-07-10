"""
bot.py - 多様化bot メインエントリーポイント
1つのbotで複数サーバーを完全独立管理（全データがguild_idで分離）
"""
import discord
from discord.ext import commands
import os
import datetime
import asyncio
from dotenv import load_dotenv
import database
from keep_alive import keep_alive
from config import JST, TC_XP_COOLDOWN, VC_XP_PER_MIN, MSG_COOLDOWN
from helpers import (
    get_setting, send_log, is_rank_eligible, is_vc_coins_eligible,
    check_and_assign_level_roles, check_and_assign_level_coins
)

load_dotenv()
TOKEN = os.getenv("DISCORD_BOT_TOKEN")


class MultiGuildBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents)

        # --- サーバーごとのキャッシュ ---
        self.guild_settings_cache: dict[int, dict] = {}          # {guild_id: {key: value}}
        self.evaluation_settings_cache: dict[int, dict] = {}     # {guild_id: {forum_..., self_intro_...}}
        self.rank_settings_cache: dict[int, dict] = {}           # {guild_id: {whitelist, blacklist, ...}}
        self.vc_coins_settings_cache: dict[int, dict] = {}       # {guild_id: {...}}
        self.antigrief_settings_cache: dict[int, dict] = {}      # {guild_id: {...}}
        self.auto_vc_triggers: dict[int, set] = {}               # {guild_id: set(channel_ids)}
        self.auto_vc_configs: dict[int, dict] = {}               # {channel_id: config_dict}

        # --- ユーザーセッション管理 ---
        self.vc_sessions: dict[int, dict] = {}                   # {user_id: {guild_id, join_time}}
        self.tc_xp_cooldowns: dict[tuple, float] = {}            # {(guild_id, user_id): timestamp}
        self.message_cooldowns: dict[tuple, float] = {}          # {(guild_id, user_id): timestamp}
        self.spam_tracker: dict[int, dict] = {}                  # {user_id: spam_data}
        self.invite_cache: dict[int, dict] = {}                  # {guild_id: {code: uses}}
        self.empty_custom_vcs: dict[int, float] = {}             # {channel_id: empty_since}

    # ============================================================
    # キャッシュアクセサ
    # ============================================================
    def get_evaluation_config(self, guild_id: int) -> dict:
        return self.evaluation_settings_cache.get(guild_id, {
            "forum_channel_ids": set(),
            "self_intro_channel_ids": set()
        })

    def get_rank_config(self, guild_id: int) -> dict:
        return self.rank_settings_cache.get(guild_id, {
            "whitelist": set(), "blacklist": set(),
            "categories": set(), "blacklist_categories": set()
        })

    def get_vc_coins_config(self, guild_id: int) -> dict:
        return self.vc_coins_settings_cache.get(guild_id, {
            "whitelist": set(), "blacklist": set(),
            "categories": set(), "blacklist_categories": set()
        })

    def get_antigrief_config(self, guild_id: int) -> dict:
        return self.antigrief_settings_cache.get(guild_id, {
            "categories": set(), "channels": set(), "exempt_roles": set()
        })

    async def refresh_guild_settings(self, guild_id: int):
        """サーバーの設定を再取得してキャッシュを更新する（設定変更後に呼ぶ）"""
        self.guild_settings_cache[guild_id] = await database.load_guild_settings(guild_id)

    # ============================================================
    # setup_hook（起動時初期化）
    # ============================================================
    async def setup_hook(self):
        await database.setup_db()

        # 全サーバーの設定をロード
        try:
            for guild in self.guilds:
                self.guild_settings_cache[guild.id] = await database.load_guild_settings(guild.id)
        except Exception as e:
            print(f"[WARN] Could not pre-load guild settings (guilds not yet available): {e}")

        # 評価設定ロード
        try:
            for s in await database.get_all_evaluation_settings():
                self.evaluation_settings_cache[s["guild_id"]] = {
                    "forum_channel_ids": set(s["forum_channel_ids"]),
                    "self_intro_channel_ids": set(s["self_intro_channel_ids"])
                }
        except Exception as e:
            print(f"[ERROR] Failed to load evaluation settings: {e}")

        # ランク設定ロード
        try:
            for r in await database.get_all_rank_settings():
                self.rank_settings_cache[r["guild_id"]] = {
                    "whitelist": set(r["whitelist"]),
                    "blacklist": set(r["blacklist"]),
                    "categories": set(r["categories"]),
                    "blacklist_categories": set(r["blacklist_categories"])
                }
        except Exception as e:
            print(f"[ERROR] Failed to load rank settings: {e}")

        # VCコイン設定ロード
        try:
            for r in await database.get_all_vc_coins_settings():
                self.vc_coins_settings_cache[r["guild_id"]] = {
                    "whitelist": set(r["whitelist"]),
                    "blacklist": set(r["blacklist"]),
                    "categories": set(r["categories"]),
                    "blacklist_categories": set(r["blacklist_categories"])
                }
        except Exception as e:
            print(f"[ERROR] Failed to load vc_coins settings: {e}")

        # 荒らし対策設定ロード
        try:
            for s in await database.get_all_antigrief_settings():
                self.antigrief_settings_cache[s["guild_id"]] = {
                    "categories": set(s["categories"]),
                    "channels": set(s["channels"]),
                    "exempt_roles": set(s["exempt_roles"])
                }
        except Exception as e:
            print(f"[ERROR] Failed to load antigrief settings: {e}")

        # Cogsのロード（Phase 1）
        cogs_to_load = [
            "cogs.evaluation",
            "cogs.interview",
            "cogs.leveling",
            "cogs.ranking",
            "cogs.logging_cog",
            "cogs.admin",
        ]
        for cog in cogs_to_load:
            try:
                await self.load_extension(cog)
                print(f"[OK] Loaded: {cog}")
            except Exception as e:
                print(f"[ERROR] Failed to load {cog}: {e}")

        await self.tree.sync()
        print("[OK] Slash commands synced.")

    async def on_ready(self):
        # on_readyで設定を再ロード（guildsが利用可能になるため）
        for guild in self.guilds:
            if guild.id not in self.guild_settings_cache:
                self.guild_settings_cache[guild.id] = await database.load_guild_settings(guild.id)
        print(f"[OK] Bot ready: {self.user} (ID: {self.user.id})")
        print(f"[OK] Serving {len(self.guilds)} guilds.")


bot = MultiGuildBot()


# ============================================================
# メッセージイベント
# ============================================================
@bot.event
async def on_message(message: discord.Message):
    if message.author.bot or not message.guild:
        return
    await bot.process_commands(message)


# ============================================================
# VCイベント（XP・コイン・ログ）
# ============================================================
@bot.event
async def on_voice_state_update(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    if member.bot:
        return

    guild = member.guild
    guild_id = guild.id
    user_id = member.id
    now = datetime.datetime.now(JST)

    # ----- VCログ送信 -----
    try:
        embed = None
        if before.channel is None and after.channel is not None:
            embed = discord.Embed(
                title="🎙️ VC参加",
                description=f"{member.mention} が {after.channel.mention} に参加しました。",
                color=discord.Color.green(),
                timestamp=now
            )
            embed.set_author(name=f"{member} (ID: {user_id})", icon_url=member.display_avatar.url)
        elif before.channel is not None and after.channel is None:
            embed = discord.Embed(
                title="🎙️ VC退出",
                description=f"{member.mention} が {before.channel.mention} から退出しました。",
                color=discord.Color.red(),
                timestamp=now
            )
            embed.set_author(name=f"{member} (ID: {user_id})", icon_url=member.display_avatar.url)
        elif before.channel and after.channel and before.channel.id != after.channel.id:
            embed = discord.Embed(
                title="🎙️ VC移動",
                description=f"{member.mention} が {before.channel.mention} → {after.channel.mention} に移動しました。",
                color=discord.Color.blue(),
                timestamp=now
            )
            embed.set_author(name=f"{member} (ID: {user_id})", icon_url=member.display_avatar.url)
        if embed:
            await send_log(bot, guild, "vc_join_leave", embed)
    except Exception as e:
        print(f"[ERROR] VC log: {e}")

    # ----- XP・コインセッション管理 -----
    try:
        # 参加・移動時 → セッション開始
        if after.channel is not None:
            is_join = (before.channel is None) or (before.channel.id != after.channel.id)
            if is_join:
                eval_cat_id = get_setting(bot, guild_id, "EVALUATION_CATEGORY_ID")
                in_rank    = is_rank_eligible(bot, after.channel)
                in_eval    = (after.channel.category and eval_cat_id and
                              after.channel.category.id == int(eval_cat_id))
                enable_vc_coins = get_setting(bot, guild_id, "ENABLE_VC_COINS")
                if enable_vc_coins is None:
                    enable_vc_coins = True
                in_coins = is_vc_coins_eligible(bot, after.channel) and enable_vc_coins

                if in_rank or in_eval or in_coins:
                    bot.vc_sessions[user_id] = {"guild_id": guild_id, "join_time": now}

        # 退出・移動時 → セッション終了・XP付与
        if before.channel is not None and (after.channel is None or before.channel.id != after.channel.id):
            session = bot.vc_sessions.pop(user_id, None)
            if session and session["guild_id"] == guild_id:
                duration_seconds = int((now - session["join_time"]).total_seconds())

                # カテゴリIDでVC滞在時間を記録
                if before.channel.category:
                    await database.add_vc_duration(guild_id, user_id, before.channel.category.id, duration_seconds)

                duration_minutes = duration_seconds // 60
                if duration_minutes > 0:
                    # ランクXP付与
                    if is_rank_eligible(bot, before.channel):
                        xp_reward = duration_minutes * VC_XP_PER_MIN
                        new_lv = await database.add_xp(guild_id, user_id, xp_reward, "vc")
                        if new_lv:
                            lv_ch_id = get_setting(bot, guild_id, "LEVEL_UP_CHANNEL_ID")
                            if lv_ch_id:
                                lv_ch = guild.get_channel(int(lv_ch_id))
                                if lv_ch:
                                    await lv_ch.send(
                                        f"🎊 {member.mention} が **VCレベルアップ！** "
                                        f"(Lv.{new_lv-1} → **{new_lv}**)"
                                    )
                            await check_and_assign_level_roles(bot, member, "vc", new_lv)
                            await check_and_assign_level_coins(bot, member, "vc", new_lv)

                    # VCコイン付与
                    enable_vc_coins = get_setting(bot, guild_id, "ENABLE_VC_COINS")
                    if enable_vc_coins is None:
                        enable_vc_coins = True
                    if enable_vc_coins and is_vc_coins_eligible(bot, before.channel):
                        coins_per_min = get_setting(bot, guild_id, "VC_COINS_PER_MIN") or 12
                        coins = duration_minutes * int(coins_per_min)
                        if coins > 0:
                            await database.add_balance(guild_id, user_id, coins)

    except Exception as e:
        print(f"[CRITICAL] on_voice_state_update: {e}")


if __name__ == "__main__":
    if TOKEN:
        discord.utils.setup_logging()
        keep_alive()
        bot.run(TOKEN)
    else:
        print("[ERROR] DISCORD_BOT_TOKEN が .env に設定されていません。")
