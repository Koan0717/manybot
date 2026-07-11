import discord
from discord.ext import commands
from discord import app_commands
import os

class DashboardLauncher(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="launcher", description="ダッシュボード（設定画面）を開くためのランチャーパネルを設置します。")
    @app_commands.default_permissions(administrator=True)
    async def setup_launcher(self, interaction: discord.Interaction):
        # ActivityのURL (CLIENT_IDを設定するか、Web版URLを設定する)
        # 現在は仮のURLを入れています。実際のアクティビティURLやRenderのURLに置き換えてください。
        client_id = self.bot.user.id if self.bot.user else "1234567890"
        
        # もしDiscord Activityとして登録済みならこちらのURL形式になります
        activity_url = f"https://discord.com/activities/{client_id}"
        
        view = discord.ui.View(timeout=None)
        
        # ボタンを追加
        button = discord.ui.Button(
            label="設定ダッシュボードを開く",
            style=discord.ButtonStyle.link,
            url=activity_url,
            emoji="⚙️"
        )
        view.add_item(button)
        
        embed = discord.Embed(
            title="🛠️ Bot設定ダッシュボード",
            description="下のボタンをクリックすると、設定画面（ランチャー）が開きます。\\nロール設定や機能のオンオフなどを一括で管理できます。",
            color=discord.Color.blue()
        )
        
        await interaction.response.send_message(embed=embed, view=view)

async def setup(bot):
    await bot.add_cog(DashboardLauncher(bot))
