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
    get_setting, is_rank_eligible, is_vc_coins_eligible, send_log
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
                "forum_channel_ids": set(forum_ids),
                "self_intro_channel_ids": set(get_setting(self, "SELF_INTRO_CHANNEL_IDS") or [])
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
            return {"whitelist": set(), "blacklist": set(), "categories": set(), "blacklist_categories": set(), "enable_exclude_rank_role": False, "exclude_rank_role_ids": set()}
        return self.vc_coins_settings_cache[guild_id]

    async def fetch_and_cache_vc_coins_config(self, guild_id: int) -> dict:
        data = await database.get_vc_coins_settings(guild_id)
        self.vc_coins_settings_cache[guild_id] = {
            "whitelist": set(data.get("whitelist", [])),
            "blacklist": set(data.get("blacklist", [])),
            "categories": set(data.get("categories", [])),
            "blacklist_categories": set(data.get("blacklist_categories", [])),
            "enable_exclude_rank_role": data.get("enable_exclude_rank_role", False),
            "exclude_rank_role_ids": set(data.get("exclude_rank_role_ids", []))
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
                    "whitelist": set(r.get("whitelist", [])),
                    "blacklist": set(r.get("blacklist", [])),
                    "categories": set(r.get("categories", [])),
                    "blacklist_categories": set(r.get("blacklist_categories", []))
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
        ]
        for cog in cogs_to_load:
            try:
                await self.load_extension(cog)
                print(f"[OK] Loaded Cog: {cog}")
            except Exception as e:
                print(f"[ERROR] Failed to load Cog {cog}: {e}")

        try:
            # Sync to the specific guild to avoid the 50240 Entry Point global error
            # 同期先ギルドIDは .env の SYNC_GUILD_ID で指定（未設定時は従来の値をフォールバック）
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
    
    error_msg = f"❌ エラーが発生しました: `{error}`"
    if isinstance(error, app_commands.CommandNotFound):
        guild_cmds = list(interaction.client.tree._guild_commands.get(interaction.guild_id, {}).keys())
        global_cmds = list(interaction.client.tree._global_commands.keys())
        error_msg += f"\n\n[DEBUG DATA]\nGuild ID: {interaction.guild_id}\nGuild keys: {guild_cmds}\nGlobal keys: {global_cmds}"
        
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

    print(f"[OK] Bot is ready! Logged in as {bot.user} (ID: {bot.user.id})")

    # setup_hook時点では未参加guildの一覧が取得できないため、
    # ここで改めて【現在参加している全サーバー】にコマンドを同期する。
    # (以前は起動時に固定の1サーバーのみへ同期しており、それ以外のサーバーは
    #  新規参加時にしかコマンドが更新されず、後からコマンドを追加・変更しても
    #  反映されないままになる不具合があった)
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

@bot.event
async def on_voice_state_update(member, before, after):
    try:
        if member.bot: return
        # VCログはcogs/logging_cog.pyで処理するため削除
        if member.bot: return
        user_id = member.id
        now_aware = datetime.datetime.now(JST)

        # 参加・移動時
        if after.channel is not None:
            is_join = before.channel is None or before.channel.id != after.channel.id
            if is_join:
                in_correct_category = is_rank_eligible(bot, after.channel)
                eval_category_id = get_setting(bot, "EVALUATION_CATEGORY_ID")
                is_eval_category = (after.channel.category and after.channel.category.id == eval_category_id)
                
                enable_vc_coins = get_setting(bot, "ENABLE_VC_COINS")
                if enable_vc_coins is None: enable_vc_coins = True
                in_coins_eligible = is_vc_coins_eligible(bot, after.channel) and enable_vc_coins
                
                if in_correct_category or is_eval_category or in_coins_eligible:
                    print(f"[VC XP/Coins] Started session for {member.display_name} (rank={in_correct_category}, eval={is_eval_category}, coins={in_coins_eligible})")
                    bot.vc_sessions[user_id] = now_aware
        
        # 退出・移動時
        if before.channel is not None and (after.channel is None or before.channel != after.channel):
            join_time = bot.vc_sessions.pop(user_id, None)
            if join_time:
                duration_seconds = int((now_aware - join_time).total_seconds())
                if before.channel.category:
                    await database.add_vc_duration(member.guild.id, user_id, before.channel.category.id, duration_seconds)
                
                duration_minutes = duration_seconds // 60
                if duration_minutes > 0:
                    if is_rank_eligible(bot, before.channel):
                        xp_reward = duration_minutes * (get_setting(bot, "VC_XP_PER_MIN", member.guild.id) or 15)
                        new_lv = await database.add_xp(member.guild.id, user_id, xp_reward, "vc")
                        if new_lv:
                            lv_channel = bot.get_channel(get_setting(bot, "LEVEL_UP_CHANNEL_ID", member.guild.id))
                            if lv_channel:
                                await lv_channel.send(f"🎊 {member.mention} が **VCレベルアップ！** (Lv.{new_lv-1} ➔ **{new_lv}**)")
                            await config.check_and_assign_level_roles(bot, member, "vc", new_lv)
                            
                    enable_vc_coins = get_setting(bot, "ENABLE_VC_COINS")
                    if enable_vc_coins is None: enable_vc_coins = True
                    if enable_vc_coins and is_vc_coins_eligible(bot, before.channel):
                        coins_per_min = get_setting(bot, "VC_COINS_PER_MIN")
                        if coins_per_min is None: coins_per_min = 12
                        coins_reward = duration_minutes * coins_per_min
                        if coins_reward > 0:
                            await database.add_balance(member.guild.id, user_id, coins_reward)
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