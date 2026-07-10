"""
cogs/tickets.py - チケット機能（スレッド型）
"""
import discord
from discord.ext import commands
from discord import app_commands
from helpers import has_admin_role, get_setting


# ============================================================
# チケット作成用UI (ステートレス)
# ============================================================
class TicketCreateButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            style=discord.ButtonStyle.success,
            label="問い合わせを作成",
            emoji="🎫",
            custom_id="ticket_create_btn"
        )


class TicketCloseButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            style=discord.ButtonStyle.danger,
            label="チケットを閉じる",
            emoji="🔒",
            custom_id="ticket_close_btn"
        )


async def handle_ticket_create(interaction: discord.Interaction, bot):
    """問い合わせスレッドを作成する処理"""
    channel = interaction.channel
    user = interaction.user

    # スレッド名
    thread_name = f"ticket-{user.name}"

    # 既に開いているチケットがないか確認
    existing_thread = discord.utils.get(channel.threads, name=thread_name)
    if existing_thread and not existing_thread.archived:
        return await interaction.response.send_message(
            f"❌ 既にチケットが開かれています: {existing_thread.mention}",
            ephemeral=True
        )

    await interaction.response.defer(ephemeral=True)

    try:
        # スレッドの作成
        thread = await channel.create_thread(
            name=thread_name,
            type=discord.ChannelType.private_thread if "COMMUNITY" in interaction.guild.features else discord.ChannelType.public_thread,
            invitable=False,
            reason=f"チケット作成: {user.display_name}"
        )

        # プライベートスレッドの場合は対象ユーザーを追加
        if thread.type == discord.ChannelType.private_thread:
            await thread.add_user(user)

        # 管理者へのメンション準備
        admin_ids = get_setting(bot, interaction.guild.id, "ADMIN_ROLE_IDS") or []
        mentions = " ".join([f"<@&{rid}>" for rid in admin_ids]) if admin_ids else ""

        # 初期メッセージの送信
        embed = discord.Embed(
            title="🎫 チケット",
            description=(
                f"{user.mention} 問い合わせを作成しました。\n"
                f"運営からの返信をお待ちください。\n\n"
                f"問題が解決した場合は、下のボタンを押してチケットを閉じてください。"
            ),
            color=discord.Color.green()
        )
        view = discord.ui.View(timeout=None)
        view.add_item(TicketCloseButton())

        content = f"{user.mention} {mentions}"
        await thread.send(content=content, embed=embed, view=view)

        await interaction.followup.send(f"✅ チケットを作成しました: {thread.mention}", ephemeral=True)

    except Exception as e:
        print(f"[ERROR] Create Ticket: {e}")
        await interaction.followup.send(f"❌ チケットの作成に失敗しました: {e}", ephemeral=True)


async def handle_ticket_close(interaction: discord.Interaction, bot):
    """チケット（スレッド）を閉じる処理"""
    if not isinstance(interaction.channel, discord.Thread):
        return await interaction.response.send_message("❌ ここはスレッドではありません。", ephemeral=True)

    # 権限チェック：チケット作成者 or 管理者
    is_owner = str(interaction.user.name) in interaction.channel.name
    is_admin = has_admin_role(bot, interaction.user)

    if not (is_owner or is_admin):
        return await interaction.response.send_message("❌ このチケットを閉じる権限がありません。", ephemeral=True)

    await interaction.response.send_message("🔒 チケットを閉じます...")
    
    # 完全に誰も書き込めなくする（ロック＆アーカイブ）
    try:
        await interaction.channel.edit(archived=True, locked=True, reason=f"チケット終了: {interaction.user.display_name}")
    except Exception as e:
        print(f"[ERROR] Close Ticket: {e}")


# ============================================================
# /チケットパネル コマンドグループ
# ============================================================
class TicketsGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="チケットパネル", description="【管理者専用】チケットパネルを設置")
        self.bot = bot

    @app_commands.command(name="設置", description="【管理者専用】問い合わせ用チケットパネルを設置します")
    @app_commands.describe(
        title="パネルのタイトル",
        description="パネルの説明文"
    )
    async def setup_panel(self, interaction: discord.Interaction,
                          title: str = "🎫 お問い合わせ",
                          description: str = "質問や通報がある場合は、下のボタンからチケット（専用スレッド）を作成してください。"):
        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)

        embed = discord.Embed(title=title, description=description, color=discord.Color.green())
        view = discord.ui.View(timeout=None)
        view.add_item(TicketCreateButton())

        await interaction.channel.send(embed=embed, view=view)
        await interaction.response.send_message("✅ パネルを設置しました。", ephemeral=True)


# ============================================================
# Cog 本体
# ============================================================
class Tickets(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(TicketsGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("チケットパネル")

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        # Bot再起動後でも動作するように、custom_idを検知して手動で処理する
        if interaction.type == discord.InteractionType.component:
            custom_id = interaction.data.get("custom_id", "")
            if custom_id == "ticket_create_btn":
                await handle_ticket_create(interaction, self.bot)
            elif custom_id == "ticket_close_btn":
                await handle_ticket_close(interaction, self.bot)


async def setup(bot):
    await bot.add_cog(Tickets(bot))
