import discord
from discord.ext import commands, tasks
import database
from helpers import send_log

class IPC(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.check_panel_requests.start()

    def cog_unload(self):
        self.check_panel_requests.cancel()

    @tasks.loop(seconds=5.0)
    async def check_panel_requests(self):
        try:
            requests = await database.get_panel_requests()
            for req in requests:
                req_id = req["id"]
                guild_id = req["guild_id"]
                channel_id = req["channel_id"]
                panel_type = req["panel_type"]

                guild = self.bot.get_guild(guild_id)
                if not guild:
                    await database.delete_panel_request(req_id)
                    continue

                channel = guild.get_channel(channel_id)
                if not channel:
                    await database.delete_panel_request(req_id)
                    continue

                embed = None
                view = None

                if panel_type == "shop":
                    from cogs.shop import ShopPanelView
                    embed = discord.Embed(title="🛒 ショップ", description="ポイントを使ってアイテムを購入できます。", color=discord.Color.gold())
                    view = ShopPanelView()
                elif panel_type == "custom_ticket":
                    from cogs.admin import CustomTicketPanelView
                    # パネルのタイトルなどはDB(custom_ticket_panels)からCustomTicketPanelViewが自動で読む、
                    # あるいはCustomTicketPanelViewが自身のチャンネルIDから読むか？
                    # 互換性のため、一旦そのまま設置
                    embed = discord.Embed(title="🎫 カスタムチケット", description="ボタンを押してチケットを作成できます。", color=discord.Color.blue())
                    view = CustomTicketPanelView()
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
                    embed = discord.Embed(title="🎮 ゲームVC / 🎲 賭博VC", description="ゲームVCや賭博VCの作成はこちらから。", color=discord.Color.orange())
                    view = GameRoomPanelView()
                elif panel_type == "custom_vc":
                    from cogs.rooms import CustomRoomView
                    embed = discord.Embed(title="✨ カスタムVC", description="任意の名前・人数のカスタムVCを作成できます。", color=discord.Color.teal())
                    view = CustomRoomView()
                elif panel_type == "inn_combined":
                    from cogs.rooms import InnCombinedView
                    embed = discord.Embed(title="🏨 宿・高級宿", description="宿の作成はこちらからどうぞ。", color=discord.Color.blurple())
                    view = InnCombinedView()

                if embed and view:
                    try:
                        await channel.send(embed=embed, view=view)
                    except discord.Forbidden:
                        print(f"Failed to send panel {panel_type} to {channel_id}: Forbidden")
                
                # リクエストを処理したら削除
                await database.delete_panel_request(req_id)

        except Exception as e:
            print(f"Error in IPC task: {e}")

    @check_panel_requests.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()

async def setup(bot):
    await bot.add_cog(IPC(bot))
