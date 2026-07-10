"""
cogs/reaction_roles.py - ボタンによるロール付与・剥奪機能
マルチサーバー対応（ステートレスなDynamicItemを使用してDB依存を排除し安定化）
"""
import discord
from discord.ext import commands
from discord import app_commands
from helpers import has_admin_role


# ============================================================
# ステートレスボタン (DynamicItem) の定義
# Custom ID の形式: "role_btn:role_id"
# ============================================================
class RoleButton(discord.ui.Button):
    def __init__(self, role: discord.Role, label: str = None, emoji: str = None):
        super().__init__(
            style=discord.ButtonStyle.primary,
            label=label or role.name,
            emoji=emoji,
            custom_id=f"role_btn:{role.id}"
        )

    async def callback(self, interaction: discord.Interaction):
        # このコールバックは View を普通に送った時の動作用
        await handle_role_button(interaction, self.custom_id)


async def handle_role_button(interaction: discord.Interaction, custom_id: str):
    """ボタンが押された時のロール付与/剥奪ロジック"""
    try:
        role_id = int(custom_id.split(":")[1])
    except (IndexError, ValueError):
        return await interaction.response.send_message("❌ 無効なボタンです。", ephemeral=True)

    role = interaction.guild.get_role(role_id)
    if not role:
        return await interaction.response.send_message("❌ ロールが見つかりません。削除された可能性があります。", ephemeral=True)

    if role in interaction.user.roles:
        await interaction.user.remove_roles(role, reason="ロールパネルによる操作")
        await interaction.response.send_message(f"➖ {role.mention} を外しました。", ephemeral=True)
    else:
        await interaction.user.add_roles(role, reason="ロールパネルによる操作")
        await interaction.response.send_message(f"➕ {role.mention} を付与しました。", ephemeral=True)


# ============================================================
# /ロールパネル コマンドグループ
# ============================================================
class ReactionRolesGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="ロールパネル", description="【管理者専用】ボタン式ロール付与パネルを設置")
        self.bot = bot

    @app_commands.command(name="設置", description="【管理者専用】最大5つのロールを選択できるボタンパネルを設置します")
    @app_commands.describe(
        title="パネルのタイトル",
        description="パネルの説明文",
        role1="ロール1", label1="ボタン1のテキスト（省略でロール名）", emoji1="ボタン1の絵文字",
        role2="ロール2", label2="ボタン2のテキスト", emoji2="ボタン2の絵文字",
        role3="ロール3", label3="ボタン3のテキスト", emoji3="ボタン3の絵文字",
        role4="ロール4", label4="ボタン4のテキスト", emoji4="ボタン4の絵文字",
        role5="ロール5", label5="ボタン5のテキスト", emoji5="ボタン5の絵文字",
    )
    async def setup_panel(self, interaction: discord.Interaction,
                          title: str = "ロール選択",
                          description: str = "欲しいロールのボタンを押してください。（もう一度押すと外れます）",
                          role1: discord.Role = None, label1: str = None, emoji1: str = None,
                          role2: discord.Role = None, label2: str = None, emoji2: str = None,
                          role3: discord.Role = None, label3: str = None, emoji3: str = None,
                          role4: discord.Role = None, label4: str = None, emoji4: str = None,
                          role5: discord.Role = None, label5: str = None, emoji5: str = None):

        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("管理者専用です。", ephemeral=True)

        roles_data = [
            (role1, label1, emoji1),
            (role2, label2, emoji2),
            (role3, label3, emoji3),
            (role4, label4, emoji4),
            (role5, label5, emoji5),
        ]

        view = discord.ui.View(timeout=None)
        added = 0

        for role, label, emoji in roles_data:
            if role:
                # 絵文字のパース（失敗しても無視して追加）
                try:
                    btn = RoleButton(role=role, label=label, emoji=emoji)
                    view.add_item(btn)
                    added += 1
                except Exception as e:
                    return await interaction.response.send_message(f"❌ ボタンの作成に失敗しました: {e}", ephemeral=True)

        if added == 0:
            return await interaction.response.send_message("❌ 最低1つのロールを指定してください。", ephemeral=True)

        embed = discord.Embed(title=title, description=description, color=discord.Color.blue())
        await interaction.channel.send(embed=embed, view=view)
        await interaction.response.send_message("✅ パネルを設置しました。", ephemeral=True)


# ============================================================
# Cog 本体
# ============================================================
class ReactionRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.tree.add_command(ReactionRolesGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("ロールパネル")

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        # Bot再起動後でも動作するように、custom_idを検知して手動で処理する
        if interaction.type == discord.InteractionType.component:
            custom_id = interaction.data.get("custom_id", "")
            if custom_id.startswith("role_btn:"):
                await handle_role_button(interaction, custom_id)


async def setup(bot):
    await bot.add_cog(ReactionRoles(bot))
