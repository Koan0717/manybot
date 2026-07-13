import discord
from discord.ext import commands, tasks
import database
from helpers import send_log, apply_bot_nicknames

class IPC(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.check_panel_requests.start()

    def cog_unload(self):
        self.check_panel_requests.cancel()

    @tasks.loop(seconds=5.0)
    async def check_panel_requests(self):
        try:
            guild_ids = [g.id for g in self.bot.guilds]
            requests = await database.get_panel_requests(guild_ids)
            for req in requests:
                try:
                    req_id = req["id"]
                    guild_id = req["guild_id"]
                    channel_id = req["channel_id"]
                    panel_type = req["panel_type"]

                    guild = self.bot.get_guild(guild_id)
                    if not guild:
                        await database.delete_panel_request(req_id, guild_id)
                        continue

                    if channel_id == 0:
                        # ... Reload logic ...
                        if panel_type == "reload_eval":
                            try:
                                db_eval_settings = await database.get_all_evaluation_settings()
                                for s in db_eval_settings:
                                    if s["guild_id"] == guild_id:
                                        self.bot.evaluation_settings[guild_id] = {
                                            "is_enabled": s.get("is_enabled", True),
                                            "forum_channel_ids": set(s["forum_channel_ids"]),
                                            "self_intro_channel_ids": set(s["self_intro_channel_ids"])
                                        }
                                print(f"[IPC] Reloaded evaluation settings for guild {guild_id}")
                            except Exception as e:
                                print(f"[IPC ERROR] Failed to reload evaluation settings: {e}")
                        
                        elif panel_type == "reload_bot_settings":
                            try:
                                self.bot.bot_settings = await database.load_settings()
                                await apply_bot_nicknames(self.bot)
                                print(f"[IPC] Reloaded bot_settings for all guilds")
                            except Exception as e:
                                print(f"[IPC ERROR] Failed to reload bot_settings: {e}")

                        elif panel_type == "reload_bot_and_role_prices":
                            try:
                                self.bot.bot_settings = await database.load_settings()
                                db_role_prices = await database.get_all_role_room_prices()
                                self.bot.role_room_prices.clear()
                                for g_id, prices in db_role_prices.items():
                                    if g_id not in self.bot.role_room_prices:
                                        self.bot.role_room_prices[g_id] = {}
                                    for rp in prices:
                                        self.bot.role_room_prices[g_id][(rp["role_key"], rp["room_type"], rp["duration"])] = rp["price"]
                                await apply_bot_nicknames(self.bot)
                                print(f"[IPC] Reloaded bot_settings and role_room_prices")
                            except Exception as e:
                                print(f"[IPC ERROR] Failed to reload bot and role prices: {e}")

                        elif panel_type == "reload_rank_and_bot_settings":
                            try:
                                self.bot.bot_settings = await database.load_settings()
                                db_rank_settings = await database.get_all_rank_settings()
                                for s in db_rank_settings:
                                    if s["guild_id"] == guild_id:
                                        self.bot.rank_settings_cache[guild_id] = {
                                            "whitelist": set(s["whitelist_channel_ids"]),
                                            "blacklist": set(s["blacklist_channel_ids"]),
                                            "categories": set(s["whitelist_category_ids"]),
                                            "blacklist_categories": set(s["blacklist_category_ids"])
                                        }
                                await apply_bot_nicknames(self.bot)
                                print(f"[IPC] Reloaded rank and bot_settings for guild {guild_id}")
                            except Exception as e:
                                print(f"[IPC ERROR] Failed to reload rank and bot settings: {e}")

                        elif panel_type == "reload_vc_triggers":
                            try:
                                self.bot.auto_vc_triggers = await database.get_auto_vc_triggers()
                                db_configs = await database.get_all_auto_vc_configs()
                                self.bot.auto_vc_configs = { c["channel_id"]: c for c in db_configs }
                                print(f"[IPC] Reloaded VC triggers: {len(self.bot.auto_vc_triggers)} triggers")
                            except Exception as e:
                                print(f"[IPC ERROR] Failed to reload vc triggers: {e}")

                        await database.delete_panel_request(req_id, guild_id)
                        continue

                    channel = guild.get_channel(channel_id)
                    if not channel:
                        try:
                            channel = await guild.fetch_channel(channel_id)
                        except discord.NotFound:
                            pass
                    
                    if not channel:
                        print(f"[IPC ERROR] Channel {channel_id} not found in guild {guild_id}.")
                        await database.delete_panel_request(req_id, guild_id)
                        continue

                    embed = None
                    view = None

                    if panel_type == "shop":
                        from cogs.shop import ShopPanelView
                        embed = discord.Embed(title="🛒 ショップ", description="ポイントを使ってアイテムを購入できます。", color=discord.Color.gold())
                        view = ShopPanelView()
                    elif panel_type == "custom_ticket":
                        panel = await database.get_custom_ticket_panel(channel_id)
                        if panel:
                            embed = discord.Embed(
                                title=panel.get("panel_title", "🎫 カスタムチケット"),
                                description=panel.get("panel_description", "ボタンを押してチケットを作成できます。"),
                                color=discord.Color.blue()
                            )
                            view = discord.ui.View(timeout=None)
                            
                            ptype = panel.get("panel_type", "custom_ticket")
                            custom_id_map = {
                                "custom_ticket": "persistent_custom_ticket_panel_btn",
                                "emblem_req": "persistent_emblem_req_btn",
                                "confession_req": "persistent_confession_req_btn",
                                "inquiry_req": "persistent_inquiry_req_btn",
                                "interview_req": "persistent_interview_btn",
                                "anonymous_chat": "persistent_anon_chat_btn"
                            }
                            cid = custom_id_map.get(ptype, "persistent_custom_ticket_panel_btn")
                            
                            emoji_str = panel.get("button_emoji")
                            btn = discord.ui.Button(
                                label=panel.get("button_label", "チケット作成"),
                                emoji=emoji_str if emoji_str else None,
                                custom_id=cid,
                                style=discord.ButtonStyle.primary
                            )
                            view.add_item(btn)
                    elif panel_type == "inn":
                        from cogs.rooms import RoomView
                        embed = discord.Embed(title="🏨 一般宿", description="一般宿の作成はこちらのボタンからどうぞ。", color=discord.Color.green())
                        view = RoomView()
                    elif panel_type == "luxury_inn":
                        from cogs.rooms import LuxuryRoomView
                        embed = discord.Embed(title="👑 高級宿", description="高級宿の作成はこちらのボタンからどうぞ。", color=discord.Color.purple())
                        view = LuxuryRoomView()
                    elif panel_type == "game_vc":
                        from cogs.rooms import GameRoomPanelView
                        embed = discord.Embed(title="🎮 ゲームVC", description="ゲームVCの作成はこちらから。", color=discord.Color.green())
                        view = GameRoomPanelView()
                    elif panel_type == "gamble_vc":
                        from cogs.rooms import GambleRoomPanelView
                        embed = discord.Embed(title="🎲 賭博VC", description="賭博VCの作成はこちらから。", color=discord.Color.orange())
                        view = GambleRoomPanelView()
                    elif panel_type == "custom_vc":
                        from cogs.rooms import CustomRoomView
                        embed = discord.Embed(title="✨ カスタムVC", description="任意の名前・人数のカスタムVCを作成できます。", color=discord.Color.teal())
                        view = CustomRoomView()
                    elif panel_type == "inn_combined":
                        from cogs.rooms import InnCombinedView
                        embed = discord.Embed(title="🏨 宿・高級宿", description="宿の作成はこちらからどうぞ。", color=discord.Color.blurple())
                        view = InnCombinedView()
                    elif panel_type == "main_inn":
                        from cogs.rooms import MainInnPanelView
                        embed = discord.Embed(title="🛖 一般宿 (本/準メン専用)", description="本/準メン専用の一般宿(無料・無制限)の作成はこちらのボタンからどうぞ。", color=discord.Color.green())
                        view = MainInnPanelView()
                    elif panel_type == "luxury_inn_single":
                        from cogs.rooms import LuxuryInnPanelView
                        embed = discord.Embed(title="🏰 高級宿", description="高級宿の作成はこちらのボタンからどうぞ。", color=discord.Color.purple())
                        view = LuxuryInnPanelView()

                    if embed and view:
                        try:
                            await channel.send(embed=embed, view=view)
                        except discord.Forbidden:
                            print(f"[IPC ERROR] Failed to send panel {panel_type} to {channel_id}: Forbidden (No permissions)")
                    
                    # リクエストを処理したら削除
                    await database.delete_panel_request(req_id, guild_id)
                except Exception as ex:
                    print(f"[IPC ERROR] Failed to process request {req}: {ex}")
                    # Even if it errors out (e.g. invalid emoji), delete it so it doesn't block the queue
                    await database.delete_panel_request(req["id"], req["guild_id"])

        except Exception as e:
            print(f"Error in IPC task: {e}")

    @check_panel_requests.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()

async def setup(bot):
    await bot.add_cog(IPC(bot))
