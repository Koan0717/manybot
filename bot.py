import discord
from discord.ext import commands, tasks
from discord import app_commands
import os
import datetime
import asyncio
from dotenv import load_dotenv
import database
from keep_alive import keep_alive
from helpers import (
    JST,
    get_setting, is_rank_eligible, get_effective_vc_coins_rate, send_log
)
import config

load_dotenv()
TOKEN = os.getenv("DISCORD_BOT_TOKEN")

class EconomyBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents)
        self.message_cooldowns = {} # {user_id: timestamp} (通貨用)
        self.tc_xp_cooldowns = {}   # {user_id: timestamp} (経験値用)
        self.vc_sessions = {}       # {user_id: join_timestamp}
        self.eval_vc_sessions = {}  # {user_id: join_timestamp}
        self.vc_duration_sessions = {}  # {user_id: join_timestamp}（カテゴリ別のVC滞在時間の記録用）
        self.vc_coin_carry = {}     # {(guild_id, user_id): 端数}（VC通貨の1分あたりの端数）
        self.empty_custom_vcs = {}  # {channel_id: empty_since_timestamp}
        self.auto_vc_triggers = set()
        self.auto_vc_configs = {}  # {channel_id: config_dict}
        self.evaluation_settings = {}  # {guild_id: {"forum_channel_ids": set, "self_intro_channel_ids": set}}
        self.rank_settings_cache = {}  # {guild_id: {"whitelist": set, "blacklist": set, "categories": set, "blacklist_categories": set}}
        self.vc_coins_settings_cache = {}  # {guild_id: {"whitelist": set, "blacklist": set, "categories": set, "blacklist_categories": set}}
        self.role_room_prices = {}     # {(role_key, room_type, duration): price}
        self.spam_tracker = {}         # {user_id: {"last_content": str, "content_count": int, "everyone_count": int, "last_time": datetime}}
        self.invite_cache = {}         # {guild_id: {invite_code: uses}}
        self.antigrief_settings_cache = {} # {guild_id: {"categories": set, "channels": set, "exempt_roles": set}}

    def get_evaluation_config(self, guild_id: int) -> dict:
        if guild_id not in self.evaluation_settings:
            forum_vals = get_setting(self, "EVALUATION_FORUM_CHANNEL_IDS") or []
            forum_ids = forum_vals if isinstance(forum_vals, list) else ([forum_vals] if forum_vals else [])
            self.evaluation_settings[guild_id] = {
                "is_enabled": True,
                "auto_generate_period": True,
                "auto_fail_on_deadline": False,
                "evaluation_duration_days": 14,
                "forum_channel_ids": set(forum_ids),
                "self_intro_channel_ids": set(get_setting(self, "SELF_INTRO_CHANNEL_IDS") or [])
            }
        return self.evaluation_settings[guild_id]

    async def fetch_and_cache_evaluation_config(self, guild_id: int) -> dict:
        data = await database.get_evaluation_settings(guild_id)
        if data:
            self.evaluation_settings[guild_id] = {
                "is_enabled": data.get("is_enabled", True),
                "auto_generate_period": data.get("auto_generate_period", True),
                "auto_fail_on_deadline": data.get("auto_fail_on_deadline", False),
                "evaluation_duration_days": data.get("evaluation_duration_days", 14),
                "forum_channel_ids": set(data.get("forum_channel_ids", [])),
                "self_intro_channel_ids": set(data.get("self_intro_channel_ids", []))
            }
        else:
            self.evaluation_settings[guild_id] = {
                "is_enabled": True,
                "auto_generate_period": True,
                "auto_fail_on_deadline": False,
                "evaluation_duration_days": 14,
                "forum_channel_ids": set(),
                "self_intro_channel_ids": set()
            }
        return self.evaluation_settings[guild_id]

    def get_rank_config(self, guild_id: int) -> dict:
        if guild_id not in self.rank_settings_cache:
            return {"whitelist": set(), "blacklist": set(), "categories": set(), "blacklist_categories": set(), "enable_exclude_rank_role": False, "exclude_rank_role_ids": set()}
        return self.rank_settings_cache[guild_id]

    async def fetch_and_cache_rank_config(self, guild_id: int) -> dict:
        data = await database.get_rank_settings(guild_id)
        self.rank_settings_cache[guild_id] = {
            "whitelist": set(data.get("whitelist", [])),
            "blacklist": set(data.get("blacklist", [])),
            "categories": set(data.get("categories", [])),
            "blacklist_categories": set(data.get("blacklist_categories", [])),
            "enable_exclude_rank_role": data.get("enable_exclude_rank_role", False),
            "exclude_rank_role_ids": set(data.get("exclude_rank_role_ids", []))
        }
        return self.rank_settings_cache[guild_id]

    def get_vc_coins_config(self, guild_id: int) -> dict:
        if guild_id not in self.vc_coins_settings_cache:
            return {
                "is_enabled": False, "whitelist": set(), "blacklist": set(), "categories": set(), "blacklist_categories": set(),
                "enable_exclude_rank_role": False, "exclude_rank_role_ids": set(),
                "use_common_reward": True, "role_scope_per_rule": False, "stack_multiple_roles": False,
                "common_reward_amount": 100, "common_reward_interval": 10, "role_rewards": [],
            }
        return self.vc_coins_settings_cache[guild_id]

    async def fetch_and_cache_vc_coins_config(self, guild_id: int) -> dict:
        data = await database.get_vc_coins_settings(guild_id)
        self.vc_coins_settings_cache[guild_id] = {
            "is_enabled": data.get("is_enabled", False),
            "whitelist": set(data.get("whitelist", [])),
            "blacklist": set(data.get("blacklist", [])),
            "categories": set(data.get("categories", [])),
            "blacklist_categories": set(data.get("blacklist_categories", [])),
            "enable_exclude_rank_role": data.get("enable_exclude_rank_role", False),
            "exclude_rank_role_ids": set(data.get("exclude_rank_role_ids", [])),
            "use_common_reward": data.get("use_common_reward", True),
            "role_scope_per_rule": data.get("role_scope_per_rule", False),
            "stack_multiple_roles": data.get("stack_multiple_roles", False),
            "common_reward_amount": data.get("common_reward_amount", 100),
            "common_reward_interval": data.get("common_reward_interval", 10),
            "role_rewards": data.get("role_rewards", []),
        }
        return self.vc_coins_settings_cache[guild_id]

    def get_antigrief_config(self, guild_id: int) -> dict:
        if guild_id not in self.antigrief_settings_cache:
            self.antigrief_settings_cache[guild_id] = {
                "categories": set(),
                "channels": set(),
                "exempt_roles": set()
            }
        return self.antigrief_settings_cache[guild_id]

    async def fetch_and_cache_antigrief_config(self, guild_id: int) -> dict:
        data = await database.get_antigrief_settings(guild_id)
        self.antigrief_settings_cache[guild_id] = {
            "categories": set(data.get("categories", [])),
            "channels": set(data.get("channels", [])),
            "exempt_roles": set(data.get("exempt_roles", []))
        }
        return self.antigrief_settings_cache[guild_id]

    async def setup_hook(self):
        await database.setup_db()
        try:
            from cogs.shop import ShopPanelView
            from cogs.utility import CustomTicketPanelView, EmblemRequestPanelView, ConfessionRequestPanelView, InquiryRequestPanelView, AnonymousChatPanelView, TicketControlView
            from cogs.call_board import CallBoardPanelView, CallBoardJoinView
            self.add_view(ShopPanelView(self))
            self.add_view(CustomTicketPanelView())
            self.add_view(EmblemRequestPanelView())
            self.add_view(ConfessionRequestPanelView())
            self.add_view(InquiryRequestPanelView())
            self.add_view(AnonymousChatPanelView())
            self.add_view(TicketControlView())
            self.add_view(CallBoardPanelView())
            self.add_view(CallBoardJoinView())
        except Exception as e:
            print(f'Failed to load persistent views: {e}')
        self.bot_settings = await database.load_settings()

        # 荒らし対策設定のロード
        try:
            db_antigrief = await database.get_all_antigrief_settings()
            for s in db_antigrief:
                self.antigrief_settings_cache[s["guild_id"]] = {
                    "categories": set(s.get("categories", [])),
                    "channels": set(s.get("channels", [])),
                    "exempt_roles": set(s.get("exempt_roles", []))
                }
        except Exception as e:
            print(f"[ERROR] Failed to load antigrief settings from DB: {e}")

        # ランク設定のロード
        try:
            db_rank = await database.get_all_rank_settings()
            for r in db_rank:
                self.rank_settings_cache[r["guild_id"]] = {
                    "whitelist": set(r.get("whitelist", [])),
                    "blacklist": set(r.get("blacklist", [])),
                    "categories": set(r.get("categories", [])),
                    "blacklist_categories": set(r.get("blacklist_categories", []))
                }
        except Exception as e:
            print(f"[ERROR] Failed to load rank settings from DB: {e}")

        # VCコイン獲得制限設定のロード
        try:
            db_vc_coins = await database.get_all_vc_coins_settings()
            for r in db_vc_coins:
                self.vc_coins_settings_cache[r["guild_id"]] = {
                    "is_enabled": r.get("is_enabled", False),
                    "whitelist": set(r.get("whitelist", [])),
                    "blacklist": set(r.get("blacklist", [])),
                    "categories": set(r.get("categories", [])),
                    "blacklist_categories": set(r.get("blacklist_categories", [])),
                    "use_common_reward": r.get("use_common_reward", True),
                    "role_scope_per_rule": r.get("role_scope_per_rule", False),
                    "stack_multiple_roles": r.get("stack_multiple_roles", False),
                    "common_reward_amount": r.get("common_reward_amount", 100),
                    "common_reward_interval": r.get("common_reward_interval", 10),
                    "role_rewards": r.get("role_rewards", []),
                }
        except Exception as e:
            print(f"[ERROR] Failed to load VC coins settings from DB: {e}")

        # 自己紹介・評価設定のロード
        try:
            db_eval_settings = await database.get_all_evaluation_settings()
            for s in db_eval_settings:
                self.evaluation_settings[s["guild_id"]] = {
                    "is_enabled": s.get("is_enabled", True),
                    "forum_channel_ids": set(s["forum_channel_ids"]),
                    "self_intro_channel_ids": set(s["self_intro_channel_ids"])
                }
        except Exception as e:
            print(f"[ERROR] Failed to load evaluation settings from DB: {e}")

        # VC作成トリガーの読み込み
        self.auto_vc_triggers = set(await database.get_auto_vc_triggers())
        try:
            db_configs = await database.get_all_auto_vc_configs()
            for cfg in db_configs:
                self.auto_vc_configs[cfg["channel_id"]] = cfg
        except Exception as e:
            print(f"[ERROR] Failed to load auto VC configs: {e}")

        create_vc_id = get_setting(self, "CREATE_VC_CHANNEL_ID")
        if not self.auto_vc_triggers and create_vc_id != 123456789012345678:
            await database.add_auto_vc_trigger(create_vc_id)
            self.auto_vc_triggers.add(create_vc_id)
            await database.save_auto_vc_config(create_vc_id, "", True, True, False, True, True)
            self.auto_vc_configs[create_vc_id] = {
                "channel_id": create_vc_id,
                "base_name": "",
                "allow_rename": True,
                "include_owner_name": True,
                "use_numbering": False,
                "allow_limit_change": True,
                "show_panel": True
            }

        # ロール別部屋価格のキャッシュロード
        try:
            db_role_prices = await database.get_all_role_room_prices()
            self.role_room_prices.clear()
            for g_id, prices in db_role_prices.items():
                if g_id not in self.role_room_prices:
                    self.role_room_prices[g_id] = {}
                for rp in prices:
                    self.role_room_prices[g_id][(rp["role_key"], rp["room_type"], rp["duration"])] = rp["price"]
        except Exception as e:
            print(f"[ERROR] Failed to load role room prices from DB: {e}")

        # Cogsのロード
        cogs_to_load = [
            "cogs.admin",
            "cogs.economy",
            "cogs.leveling",
            "cogs.rooms",
            "cogs.gambling",
            "cogs.interview",
            "cogs.evaluation",
            "cogs.utility",
            "cogs.points",
            "cogs.ipc",
            "cogs.logging_cog",
            "cogs.ranking",
            "cogs.reaction_roles",
            "cogs.shop",
            "cogs.tickets",
            "cogs.self_intro_roles",
            "cogs.call_board",
            "cogs.gacha",
            "cogs.othello",
            "cogs.board_games",
            "cogs.invite_link",
            "cogs.role_history",
            "cogs.vc_float",
            "cogs.poker",
        ]
        for cog in cogs_to_load:
            try:
                await self.load_extension(cog)
                print(f"[OK] Loaded Cog: {cog}")
            except Exception as e:
                print(f"[ERROR] Failed to load Cog {cog}: {e}")

        try:
            # Sync to the specific guild to avoid the 50240 Entry Point global error
            sync_guild_id = int(os.getenv("SYNC_GUILD_ID", "1500185499929804983"))
            guild = discord.Object(id=sync_guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            print(f"[OK] Synced commands to guild {sync_guild_id} successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to sync slash commands: {e}")
            
        # Sync commands to database for dashboard toggle feature
        commands_to_sync = []
        for cmd in self.tree.walk_commands():
            if isinstance(cmd, discord.app_commands.Command):
                cog_name = cmd.binding.__class__.__name__ if cmd.binding else "General"
                commands_to_sync.append({
                    "name": cmd.qualified_name,
                    "description": cmd.description or "説明なし",
                    "category": cog_name
                })
        try:
            await database.update_available_commands(commands_to_sync)
            print("[OK] Synced available commands to database.")
        except Exception as e:
            print(f"[ERROR] Failed to sync available commands to DB: {e}")

        print(f"[OK] Bot is ready! Logged in as {self.user} (ID: {self.user.id})")
        print("[OK] Slash commands and persistent views are synced.")

bot = EconomyBot()

@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    import traceback
    tb = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    print(f"[AppCommandError] {interaction.command.name if interaction.command else 'Unknown'}: {error}\n{tb}")
    
    original = getattr(error, 'original', error)
    if isinstance(original, discord.Forbidden):
        error_msg = (
            "❌ **Discord権限エラー (403 Forbidden: Missing Permissions)**\n"
            "Botに必要な権限がないか、またはBotのロール順位が不足しています。\n"
            "・サーバー設定 > ロール でBotのロールを操作対象ロールより上位に移動してください。\n"
            "・必要な権限（ロールの管理、メッセージの管理、チャンネルの管理等）がBotに付与されているか確認してください。"
        )
    elif isinstance(error, app_commands.CommandNotFound):
        guild_cmds = list(interaction.client.tree._guild_commands.get(interaction.guild_id, {}).keys())
        global_cmds = list(interaction.client.tree._global_commands.keys())
        error_msg = f"❌ コマンドが見つかりませんでした: `{error}`\n\n[DEBUG DATA]\nGuild ID: {interaction.guild_id}\nGuild keys: {guild_cmds}\nGlobal keys: {global_cmds}"
    else:
        error_msg = f"❌ エラーが発生しました: `{error}`"
        
    try:
        if interaction.response.is_done():
            await interaction.followup.send(error_msg, ephemeral=True)
        else:
            await interaction.response.send_message(error_msg, ephemeral=True)
    except Exception as e:
        print(f"Failed to send error message: {e}")

@bot.tree.interaction_check
async def check_command_enabled(interaction: discord.Interaction):
    if interaction.guild_id is None:
        return True # DMs are allowed
    
    if interaction.command is None:
        return True

    # ダッシュボード未設定チェック
    if not hasattr(bot, 'bot_settings') or interaction.guild_id not in bot.bot_settings:
        await interaction.response.send_message(
            "❌ このサーバーはまだダッシュボードで初期設定がされていません。\n"
            "先にダッシュボードからサーバーの設定を行ってください。",
            ephemeral=True
        )
        return False
    
    cmd_name = interaction.command.qualified_name
    is_enabled = await database.is_command_enabled(interaction.guild_id, cmd_name)
    if not is_enabled:
        await interaction.response.send_message("❌ このコマンドはOFFになっています！", ephemeral=True)
        return False
        
    return True

@bot.event
async def on_guild_join(guild: discord.Guild):
    """新規サーバーに参加した際、自動的にスラッシュコマンドを同期します"""
    try:
        bot.tree.copy_global_to(guild=guild)
        synced = await bot.tree.sync(guild=guild)
        print(f"[OK] Automatically synced {len(synced)} commands to new guild: {guild.name} ({guild.id})")
    except Exception as e:
        print(f"[ERROR] Failed to auto-sync commands to new guild {guild.name} ({guild.id}): {e}")

@bot.event
async def on_ready():
    # on_readyは再接続のたびに複数回呼ばれ得るため、プロセス起動中は一度だけ実行する
    if getattr(bot, "_all_guilds_synced", False):
        return
    bot._all_guilds_synced = True

    # VC通貨の付与ループと、起動時点で通話にいる人の滞在時間の記録開始
    if not vc_coin_loop.is_running():
        vc_coin_loop.start()
    now = datetime.datetime.now(JST)
    for guild in bot.guilds:
        for vc in list(guild.voice_channels) + list(guild.stage_channels):
            for m in vc.members:
                if not m.bot:
                    bot.vc_duration_sessions.setdefault(m.id, now)

    print(f"[OK] Bot is ready! Logged in as {bot.user} (ID: {bot.user.id})")

    # setup_hook時点では未参加guildの一覧が取得できないため、
    # ここで改めて【現在参加している全サーバー】にコマンドを同期する。
    guild_count = len(bot.guilds)
    print(f"[OK] Syncing slash commands to all {guild_count} joined guilds...")
    synced_count = 0
    for guild in bot.guilds:
        try:
            bot.tree.copy_global_to(guild=guild)
            await bot.tree.sync(guild=guild)
            synced_count += 1
        except Exception as e:
            print(f"[ERROR] Failed to sync commands to guild {guild.name} ({guild.id}): {e}")
        await asyncio.sleep(1)  # レート制限回避のため1秒間隔

    print(f"[OK] Synced commands to {synced_count}/{guild_count} guilds. Persistent views are ready.")

# --- 中央集権イベント (メインハンドラ) ---
@bot.event
async def on_message(message):
    if message.author.bot:
        return
    await bot.process_commands(message)

# VC滞在で通貨を付与する（1分ごと）。
# 以前は「参加時刻を覚えておき、退出時にまとめて付与」だったが、
# ・ranking.py の VC経験値ループが同じ bot.vc_sessions の時刻を毎分進めるため、退出時の滞在時間がほぼ0分になる
# ・退出時に ranking.py 側が先にセッションを取り出すと、こちらは何も付与しない
# ・Botを再起動すると通話中の人のセッションが消える
# という理由でほとんど付与されていなかった。いま通話にいる人へ毎分付与する方式にする。
@tasks.loop(minutes=1)
async def vc_coin_loop():
    for guild in bot.guilds:
        try:
            enabled = get_setting(bot, "ENABLE_VC_COINS", guild.id)
            if enabled is False or str(enabled).lower() == "false":
                continue
            channels = list(guild.voice_channels) + list(guild.stage_channels)
            for vc in channels:
                for member in vc.members:
                    if member.bot:
                        continue
                    rate = get_effective_vc_coins_rate(bot, member, vc)
                    if rate <= 0:
                        continue
                    # 1分あたりが小数（例: 10分で25 → 2.5/分）のときは端数を持ち越す
                    key = (guild.id, member.id)
                    total = bot.vc_coin_carry.get(key, 0.0) + rate
                    whole = int(total)
                    bot.vc_coin_carry[key] = total - whole
                    if whole > 0:
                        await database.add_balance(guild.id, member.id, whole)
        except Exception as e:
            print(f"[ERROR] vc_coin_loop ({guild.id}): {e}")

@vc_coin_loop.before_loop
async def before_vc_coin_loop():
    await bot.wait_until_ready()

@bot.event
async def on_voice_state_update(member, before, after):
    """カテゴリ別のVC滞在時間を記録する（経験値は cogs/ranking.py、通貨は vc_coin_loop が担当）"""
    try:
        if member.bot: return
        user_id = member.id
        now_aware = datetime.datetime.now(JST)

        # 退出・移動時: 直前にいたVCのカテゴリへ滞在時間を記録
        if before.channel is not None and (after.channel is None or before.channel != after.channel):
            join_time = bot.vc_duration_sessions.pop(user_id, None)
            if join_time and before.channel.category:
                duration_seconds = int((now_aware - join_time).total_seconds())
                if duration_seconds > 0:
                    await database.add_vc_duration(member.guild.id, user_id, before.channel.category.id, duration_seconds)

        # 参加・移動時
        if after.channel is not None and (before.channel is None or before.channel.id != after.channel.id):
            bot.vc_duration_sessions[user_id] = now_aware
    except Exception as global_e:
        print(f"CRITICAL ERROR in on_voice_state_update: {global_e}")

@bot.command()
@commands.has_permissions(administrator=True)
async def sync_guild(ctx):
    """【運営用】スラッシュコマンドを現在のサーバー限定で即時同期します"""
    try:
        bot.tree.copy_global_to(guild=ctx.guild)
        synced = await bot.tree.sync(guild=ctx.guild)
        await ctx.send(f"✅ このサーバー限定でコマンドを {len(synced)} 個同期しました。\n（※すぐに使えるようになります。念のためCtrl+Rで再読み込みしてください）")
    except Exception as e:
        await ctx.send(f"❌ エラーが発生しました: {e}")

@bot.command()
@commands.has_permissions(administrator=True)
async def clear_sync(ctx):
    """【運営用】現在のサーバーに登録されている重複したスラッシュコマンドを削除します"""
    try:
        bot.tree.clear_commands(guild=ctx.guild)
        await bot.tree.sync(guild=ctx.guild)
        await ctx.send("✅ このサーバーに登録されていた古いコマンドを削除しました。Discordを再読み込み（Ctrl+R）すると重複が解消されます。")
    except Exception as e:
        await ctx.send(f"❌ エラーが発生しました: {e}")

if __name__ == "__main__":
    if TOKEN:
        discord.utils.setup_logging()
        keep_alive()
        bot.run(TOKEN)
    else:
        print("Error: DISCORD_BOT_TOKEN is not set in .env")