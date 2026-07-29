import discord
from discord.ext import commands, tasks
import datetime
import asyncio
import database
from helpers import (
    JST, get_setting, is_free_inn_member, is_main_or_sub_member,
    get_room_settings, get_circled_number, circled_to_int, send_log,
    has_admin_role, is_new_member, is_downgrade_member, get_role_by_setting,
    PENDING_MEMBER_ROLE_NAME, get_room_price
)

# --- モーダル ---
class RenameModal(discord.ui.Modal, title='チャンネル名の変更'):
    name_input = discord.ui.TextInput(label='新しいチャンネル名', max_length=100, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            await interaction.channel.edit(name=self.name_input.value)
            await interaction.response.send_message(f"チャンネル名を「{self.name_input.value}」に変更しました！", ephemeral=True)
        except:
            await interaction.response.send_message("変更に失敗しました。", ephemeral=True)

class LimitModal(discord.ui.Modal, title='人数制限の設定'):
    limit_input = discord.ui.TextInput(label='人数 (0 で無制限)', max_length=2, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            limit = int(self.limit_input.value)
            await interaction.channel.edit(user_limit=limit)
            await interaction.response.send_message(f"人数制限を {limit if limit > 0 else '無制限'} に変更しました！", ephemeral=True)
        except:
            await interaction.response.send_message("数字を正しく入力してください。", ephemeral=True)

# --- 延長選択View ---
class ExtendInnSelectView(discord.ui.View):
    def __init__(self, bot, is_free: bool, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, getattr(self, "member", None), "宿", 12)
        p24 = get_room_price(self.bot, getattr(self, "member", None), "宿", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four.label = f"24時間 ({p24:,} {currency_name})"
        if is_free:
            self.twelve.label = "12時間 (無料)"
            self.twenty_four.label = "24時間 (無料)"
            
    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success)
    async def twelve(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "宿", 12)
        await process_room_extension(self.bot, interaction, "宿", 12, price)
        
    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success)
    async def twenty_four(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "宿", 24)
        await process_room_extension(self.bot, interaction, "宿", 24, price)
        
    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class ExtendLuxuryInnSelectView(discord.ui.View):
    def __init__(self, bot, member: discord.Member):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, self.member, "高級宿", 12)
        p24 = get_room_price(self.bot, self.member, "高級宿", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four.label = f"24時間 ({p24:,} {currency_name})"
        
    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success)
    async def twelve(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, self.member, '高級宿', 12)
        await process_room_extension(self.bot, interaction, "高級宿", 12, price)
        
    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success)
    async def twenty_four(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, self.member, '高級宿', 24)
        await process_room_extension(self.bot, interaction, "高級宿", 24, price)
        
    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class ExtendGameVCSelectView(discord.ui.View):
    def __init__(self, bot, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, self.member, "ゲームVC", 12)
        p24 = get_room_price(self.bot, self.member, "ゲームVC", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four.label = f"24時間 ({p24:,} {currency_name})"
        
    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success)
    async def twelve(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "ゲームVC", 12)
        await process_room_extension(self.bot, interaction, "ゲームVC", 12, price)
        
    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success)
    async def twenty_four(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "ゲームVC", 24)
        await process_room_extension(self.bot, interaction, "ゲームVC", 24, price)
        
    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class ExtendGambleVCSelectView(discord.ui.View):
    def __init__(self, bot, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, self.member, "賭博VC", 12)
        p24 = get_room_price(self.bot, self.member, "賭博VC", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four.label = f"24時間 ({p24:,} {currency_name})"
        
    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success)
    async def twelve(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "賭博VC", 12)
        await process_room_extension(self.bot, interaction, "賭博VC", 12, price)
        
    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success)
    async def twenty_four(self, interaction: discord.Interaction, button: discord.ui.Button):
        price = get_room_price(self.bot, interaction.user, "賭博VC", 24)
        await process_room_extension(self.bot, interaction, "賭博VC", 24, price)
        
    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

# --- 延長・削除処理 ---
async def process_room_extension(bot, interaction: discord.Interaction, room_type: str, duration: int, price: int):
    await interaction.response.defer(ephemeral=True)
    channel_id = interaction.channel_id
    room_data = await database.get_room(channel_id)
    if not room_data:
        return await interaction.edit_original_response(content="この部屋のデータが見つかりません。", view=None)
        
    if interaction.user.id != room_data["owner_id"] and not interaction.user.guild_permissions.administrator:
        return await interaction.edit_original_response(content="延長は作成者または管理者のみ可能です。", view=None)
        
    if room_type == "高級宿":
        price = get_room_price(bot, interaction.user, room_type, duration)
    elif room_type == "宿" and is_free_inn_member(bot, interaction.user):
        price = 0

    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    if await database.get_balance(interaction.guild.id, interaction.user.id) < price:
        return await interaction.edit_original_response(content=f"残高が不足しています！(必要: {price} {currency_name})", view=None)
        
    if price == 0 or await database.remove_balance(interaction.guild.id, interaction.user.id, price):
        new_expire = room_data["expire_at"] + datetime.timedelta(hours=duration)
        await database.extend_room(channel_id, new_expire)
        embed = discord.Embed(
            title="⏱️ 部屋の延長",
            description=f"**{price} {currency_name}** を支払い、部屋の時間を **{duration}時間** 延長しました！\n新しい終了予定時刻: <t:{int(new_expire.replace(tzinfo=JST).timestamp())}:F>",
            color=discord.Color.green()
        )
        await interaction.edit_original_response(content="✅ 延長手続きが完了しました！", view=None)
        await interaction.channel.send(embed=embed)

        # 通貨ログ送信
        if price > 0:
            embed_log = discord.Embed(
                title="⏱️ 部屋延長 (支払)",
                description="部屋の利用期限が延長されました。",
                color=discord.Color.orange(),
                timestamp=discord.utils.utcnow()
            )
            embed_log.add_field(name="支払者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
            embed_log.add_field(name="支払額", value=f"{price:,} {currency_name}", inline=True)
            embed_log.add_field(name="部屋の種類", value=f"{room_type}", inline=True)
            embed_log.add_field(name="延長時間", value=f"{duration}時間", inline=True)
            embed_log.add_field(name="対象チャンネル", value=f"{interaction.channel.mention} (ID: {channel_id})", inline=False)
            await send_log(bot, interaction.guild, "currency", embed_log)

async def handle_extend(bot, interaction: discord.Interaction):
    channel_id = interaction.channel_id
    room_data = await database.get_room(channel_id)
    if not room_data:
        await interaction.response.send_message("この部屋のデータが見つかりません。", ephemeral=True)
        return
    if interaction.user.id != room_data["owner_id"] and not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message("延長は作成者または管理者のみ可能です。", ephemeral=True)
        return
        
    room_type = room_data["room_type"]
    is_free_inn = room_type == "宿" and is_free_inn_member(bot, interaction.user)
    
    if room_type == "宿":
        view = ExtendInnSelectView(bot, is_free_inn)
        msg = "「一般宿」の延長期間を選択してください。"
        if is_free_inn:
            msg += "\nあなたは対象ロールのため **無料** で延長可能です。"
        await interaction.response.send_message(msg, view=view, ephemeral=True)
    elif room_type == "高級宿":
        if not (has_admin_role(bot, interaction.user) or is_main_or_sub_member(bot, interaction.user) or is_new_member(bot, interaction.user) or is_downgrade_member(bot, interaction.user)):
            await interaction.response.send_message("ロールがありません。", ephemeral=True)
            return
        view = ExtendLuxuryInnSelectView(bot, interaction.user)
        await interaction.response.send_message("「高級宿」の延長期間を選択してください。", view=view, ephemeral=True)
    elif room_type == "カスタムVC":
        price = get_room_price(bot, interaction.user, "カスタムVC", 24)
        await process_room_extension(bot, interaction, "カスタムVC", 24, price)
    elif room_type == "ゲームVC":
        view = ExtendGameVCSelectView(bot)
        await interaction.response.send_message("「ゲームVC」の延長期間を選択してください。", view=view, ephemeral=True)
    elif room_type == "賭博VC":
        view = ExtendGambleVCSelectView(bot)
        await interaction.response.send_message("「賭博VC」の延長期間を選択してください。", view=view, ephemeral=True)

async def handle_delete(interaction: discord.Interaction):
    room_data = await database.get_room(interaction.channel_id)
    if room_data and interaction.user.id != room_data["owner_id"] and not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message("削除は作成者または管理者のみ可能です。", ephemeral=True)
        return
    await interaction.response.send_message("部屋を削除します...")
    await asyncio.sleep(2)
    try:
        await interaction.channel.delete()
    except discord.NotFound:
        pass
    if room_data:
        await database.remove_room(interaction.channel_id)

# --- 共通ユーティリティ ---
async def check_room_owner(interaction: discord.Interaction) -> bool:
    room_data = await database.get_room(interaction.channel_id)
    if room_data and interaction.user.id != room_data["owner_id"] and not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message("作成者または管理者のみ可能です。", ephemeral=True)
        return False
    return True

class AccessManageView(discord.ui.View):
    def __init__(self, target_channel: discord.VoiceChannel):
        super().__init__(timeout=180)
        self.target_channel = target_channel
        self.selected_users = []
        
    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="ユーザーを選択してください", min_values=1, max_values=10)
    async def select_users(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        self.selected_users = select.values
        await interaction.response.defer()

    @discord.ui.button(label="許可する", style=discord.ButtonStyle.success)
    async def allow_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_users:
            return await interaction.response.send_message("ユーザーが選択されていません。", ephemeral=True)
        for user in self.selected_users:
            if isinstance(user, discord.Member):
                await self.target_channel.set_permissions(user, view_channel=True, connect=True)
        await interaction.response.send_message("✅ 選択したユーザーのアクセスを許可しました。", ephemeral=True)

    @discord.ui.button(label="拒否する", style=discord.ButtonStyle.danger)
    async def deny_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_users:
            return await interaction.response.send_message("ユーザーが選択されていません。", ephemeral=True)
        for user in self.selected_users:
            if isinstance(user, discord.Member):
                await self.target_channel.set_permissions(user, view_channel=False, connect=False)
                if user in self.target_channel.members:
                    await user.move_to(None)
        await interaction.response.send_message("🚫 選択したユーザーのアクセスを拒否し、退出させました。", ephemeral=True)

    @discord.ui.button(label="キック (切断)", style=discord.ButtonStyle.secondary)
    async def kick_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_users:
            return await interaction.response.send_message("ユーザーが選択されていません。", ephemeral=True)
        count = 0
        for user in self.selected_users:
            if isinstance(user, discord.Member) and user in self.target_channel.members:
                await user.move_to(None)
                count += 1
        await interaction.response.send_message(f"👞 {count}名のユーザーを切断しました。", ephemeral=True)
    
    @discord.ui.button(label="権限リセット", style=discord.ButtonStyle.secondary)
    async def reset_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_users:
            return await interaction.response.send_message("ユーザーが選択されていません。", ephemeral=True)
        for user in self.selected_users:
            if isinstance(user, discord.Member):
                await self.target_channel.set_permissions(user, overwrite=None)
        await interaction.response.send_message("🔄 選択したユーザーの個別権限をリセットしました。", ephemeral=True)

# --- コントロールパネルViews (永続的) ---
class InnControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="延長", style=discord.ButtonStyle.primary, emoji="⏱", custom_id="inn_extend_btn")
    async def extend_button(self, interaction, button):
        await handle_extend(interaction.client, interaction)
        
    @discord.ui.button(label="削除", style=discord.ButtonStyle.danger, emoji="🗑", custom_id="inn_delete_btn")
    async def delete_button(self, interaction, button):
        await handle_delete(interaction)
        
    @discord.ui.button(label="名前変更", style=discord.ButtonStyle.secondary, emoji="📝", custom_id="inn_rename_btn", row=1)
    async def rename_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_modal(RenameModal())

class RoomControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="延長", style=discord.ButtonStyle.primary, custom_id="persistent_extend_btn")
    async def extend_button(self, interaction, button):
        await handle_extend(interaction.client, interaction)
        
    @discord.ui.button(label="削除", style=discord.ButtonStyle.danger, custom_id="persistent_delete_btn")
    async def delete_button(self, interaction, button):
        await handle_delete(interaction)
        
    @discord.ui.button(label="名前変更", style=discord.ButtonStyle.secondary, custom_id="persistent_rename_btn", row=1)
    async def rename_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_modal(RenameModal())
        
    @discord.ui.button(label="人数制限", style=discord.ButtonStyle.secondary, custom_id="persistent_limit_btn", row=1)
    async def limit_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_modal(LimitModal())

    @discord.ui.button(label="メンバー管理", style=discord.ButtonStyle.secondary, custom_id="persistent_manage_btn", emoji="👥", row=2)
    async def manage_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_message("管理するユーザーを選択し、操作を選んでください。", view=AccessManageView(interaction.channel), ephemeral=True)

class CustomRoomControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="延長", style=discord.ButtonStyle.primary, custom_id="custom_extend_btn")
    async def extend_button(self, interaction, button):
        await handle_extend(interaction.client, interaction)
        
    @discord.ui.button(label="削除", style=discord.ButtonStyle.danger, custom_id="custom_delete_btn")
    async def delete_button(self, interaction, button):
        await handle_delete(interaction)
        
    @discord.ui.button(label="名前変更", style=discord.ButtonStyle.secondary, custom_id="custom_rename_btn", row=1)
    async def rename_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_modal(RenameModal())
        
    @discord.ui.button(label="人数制限", style=discord.ButtonStyle.secondary, custom_id="custom_limit_btn", row=1)
    async def limit_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_modal(LimitModal())

    @discord.ui.button(label="メンバー管理", style=discord.ButtonStyle.secondary, custom_id="custom_manage_btn", emoji="👥", row=2)
    async def manage_button(self, interaction, button):
        if not await check_room_owner(interaction): return
        await interaction.response.send_message("管理するユーザーを選択し、操作を選んでください。", view=AccessManageView(interaction.channel), ephemeral=True)

class VCInvitePanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="招待・アクセス管理", style=discord.ButtonStyle.success, emoji="📨", custom_id="persistent_vc_invite_panel_btn")
    async def invite_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.voice or not interaction.user.voice.channel:
            return await interaction.response.send_message("ボイスチャンネルに参加していません。", ephemeral=True)
        
        room_data = await database.get_room(interaction.user.voice.channel.id)
        if not room_data or room_data["owner_id"] != interaction.user.id:
            if not interaction.user.guild_permissions.administrator:
                return await interaction.response.send_message("自分が作成した（所有している）部屋ではありません。", ephemeral=True)
                
        await interaction.response.send_message("アクセスを許可（またはキック・拒否）するユーザーを選択してください。", view=AccessManageView(interaction.user.voice.channel), ephemeral=True)

class VCRenamePanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="VC名を変更", style=discord.ButtonStyle.primary, emoji="📝", custom_id="persistent_vc_rename_panel_btn")
    async def rename_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.voice or not interaction.user.voice.channel:
            return await interaction.response.send_message("ボイスチャンネルに参加していません。", ephemeral=True)
        
        room_data = await database.get_room(interaction.user.voice.channel.id)
        if not room_data or room_data["owner_id"] != interaction.user.id:
            if not interaction.user.guild_permissions.administrator:
                return await interaction.response.send_message("自分が作成した（所有している）部屋ではありません。", ephemeral=True)
        
        if room_data and room_data.get("trigger_channel_id"):
            cfg = interaction.client.auto_vc_configs.get(room_data["trigger_channel_id"])
            if cfg and not cfg.get("allow_rename", True):
                return await interaction.response.send_message("❌ この部屋は名前変更が禁止されています。", ephemeral=True)
        
        await interaction.response.send_modal(RenameModal())

    @discord.ui.button(label="人数制限を変更", style=discord.ButtonStyle.secondary, emoji="👥", custom_id="persistent_vc_limit_panel_btn")
    async def limit_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.user.voice or not interaction.user.voice.channel:
            return await interaction.response.send_message("ボイスチャンネルに参加していません。", ephemeral=True)
        
        room_data = await database.get_room(interaction.user.voice.channel.id)
        if not room_data or room_data["owner_id"] != interaction.user.id:
            if not interaction.user.guild_permissions.administrator:
                return await interaction.response.send_message("自分が作成した（所有している）部屋ではありません。", ephemeral=True)
        
        if room_data and room_data.get("trigger_channel_id"):
            cfg = interaction.client.auto_vc_configs.get(room_data["trigger_channel_id"])
            if cfg and not cfg.get("allow_limit_change", True):
                return await interaction.response.send_message("❌ この部屋は人数制限の変更が禁止されています。", ephemeral=True)
        
        await interaction.response.send_modal(LimitModal())

# --- 購入用Views & Modals ---
async def check_panel_permission(bot, guild, member, panel_id: str) -> bool:
    configs = get_setting(bot, "ROOM_PANEL_CONFIGS", guild.id)
    if not configs or not isinstance(configs, dict) or panel_id not in configs:
        return True # 設定がなければ全員許可
    
    config = configs[panel_id]
    allow_temp = config.get("allowTemp", True)
    allow_main_sub = config.get("allowMainSub", True)
    
    # 仮メン判定
    if is_new_member(bot, member):
        if not allow_temp: return False
        
    # 本・準メン判定
    if is_main_or_sub_member(bot, member):
        if not allow_main_sub: return False
        
    return True


async def process_room_purchase(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    owner_id = interaction.user.id
    if not hasattr(bot, 'processing_rooms'):
        bot.processing_rooms = set()
    if owner_id in bot.processing_rooms:
        # 既にdeferされている可能性もあるため、応答を試みる
        try:
            if not interaction.response.is_done():
                await interaction.response.send_message("現在処理中です。少しお待ちください。", ephemeral=True)
        except:
            pass
        return
    bot.processing_rooms.add(owner_id)
    try:
        await _process_room_purchase_inner(bot, interaction, room_type, duration, panel_id)
    finally:
        bot.processing_rooms.discard(owner_id)

async def _process_room_purchase_inner(bot, interaction: discord.Interaction, room_type: str, duration: int, panel_id: str = None):
    await interaction.response.defer(ephemeral=True)
    owner_id = interaction.user.id
    
    if room_type in ["宿", "高級宿"] and await database.has_room_type(owner_id, ["宿", "高級宿"]):
        return await interaction.edit_original_response(content="既に「宿」を持っています！(1人1つまで)")
    if room_type == "カスタムVC" and await database.has_room_type(owner_id, ["カスタムVC"]):
        return await interaction.edit_original_response(content="既に「カスタムVC」を持っています！")
    if room_type == "ゲームVC" and await database.has_room_type(owner_id, ["ゲームVC"]):
        return await interaction.edit_original_response(content="既に「ゲームVC」を持っています！(1人1つまで)")
    if room_type == "賭博VC" and await database.has_room_type(owner_id, ["賭博VC"]):
        return await interaction.edit_original_response(content="既に「賭博VC」を持っています！(1人1つまで)")
    
    if room_type == "高級宿":
        price = get_room_price(bot, interaction.user, room_type, duration)
    elif room_type == "宿" and duration == 0:
        if is_main_or_sub_member(bot, interaction.user) or has_admin_role(bot, interaction.user):
            price = 0
        else:
            return await interaction.edit_original_response(content="無制限宿を作成する権限がありません。")
    else:
        price = get_room_price(bot, interaction.user, room_type, duration)
    
    if room_type == "宿" and is_free_inn_member(bot, interaction.user):
        price = 0

    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    if await database.get_balance(interaction.guild.id, owner_id) < price:
        return await interaction.edit_original_response(content="残高が不足しています。")
    
    if price == 0 or await database.remove_balance(interaction.guild.id, owner_id, price):
        try:
            if room_type == "高級宿":
                overwrites = {
                    interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False, connect=False),
                    interaction.user: discord.PermissionOverwrite(view_channel=True, connect=True, manage_channels=True, move_members=True, manage_permissions=True)
                }
            else:
                overwrites = {
                    interaction.guild.default_role: discord.PermissionOverwrite(connect=True),
                    interaction.user: discord.PermissionOverwrite(manage_channels=True, move_members=True)
                }
                pending_role = get_role_by_setting(bot, interaction.guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
                if pending_role:
                    overwrites[pending_role] = discord.PermissionOverwrite(view_channel=False, connect=False)
            target_category = interaction.channel.category
            if panel_id:
                configs = get_setting(bot, "ROOM_PANEL_CONFIGS", interaction.guild.id)
                if configs and isinstance(configs, dict) and panel_id in configs:
                    cat_id = configs[panel_id].get("categoryId")
                    if cat_id:
                        try:
                            cat = interaction.guild.get_channel(int(cat_id))
                            if cat: target_category = cat
                        except:
                            pass
            channel = await interaction.guild.create_voice_channel(name=f"{room_type}-{interaction.user.display_name}", category=target_category, overwrites=overwrites, user_limit=(2 if room_type=="宿" else 0))
            
            if duration == 0:
                expire_at = database.get_now_naive() + datetime.timedelta(days=36500) # 無制限
            else:
                expire_at = database.get_now_naive() + datetime.timedelta(hours=duration)
                
            await database.add_room(channel.id, owner_id, room_type, expire_at)
            await interaction.edit_original_response(content=f"✅ {channel.mention} を作成しました！", view=None)
            
            view = CustomRoomControlView() if room_type=="カスタムVC" else (RoomControlView() if room_type=="高級宿" else InnControlView())
            
            expire_str = "無制限" if duration == 0 else f"<t:{int(expire_at.replace(tzinfo=JST).timestamp())}:F>"
            embed = discord.Embed(title=f"🏠 {room_type}", description=f"作成者: {interaction.user.mention}\n利用期間: {f'{duration}時間' if duration > 0 else '無制限'}\n終了予定: {expire_str}", color=discord.Color.blue())
            await channel.send(content=f"{interaction.user.mention}", embed=embed, view=view)
            
            if interaction.user.voice and interaction.user.voice.channel:
                try:
                    await interaction.user.move_to(channel)
                except:
                    pass

            # 通貨ログ送信
            if price > 0:
                embed_log = discord.Embed(
                    title="🏠 部屋購入 (支払)",
                    description="新しい部屋が購入されました。",
                    color=discord.Color.blue(),
                    timestamp=discord.utils.utcnow()
                )
                embed_log.add_field(name="購入者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
                embed_log.add_field(name="支払額", value=f"{price:,} {currency_name}", inline=True)
                embed_log.add_field(name="部屋の種類", value=f"{room_type}", inline=True)
                embed_log.add_field(name="利用期間", value=f"{duration}時間" if duration > 0 else "無期限", inline=True)
                embed_log.add_field(name="作成チャンネル", value=f"{channel.mention} (ID: {channel.id})", inline=False)
                await send_log(bot, interaction.guild, "currency", embed_log)
        except Exception as e:
            if price > 0:
                await database.add_balance(interaction.guild.id, owner_id, price)
                # 返金ログ送信
                embed_log = discord.Embed(
                    title="↩️ 部屋購入エラー (返金)",
                    description="部屋の作成中にエラーが発生したため、支払われた金額が返金されました。",
                    color=discord.Color.red(),
                    timestamp=discord.utils.utcnow()
                )
                embed_log.add_field(name="返金先", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
                embed_log.add_field(name="返金額", value=f"{price:,} {currency_name}", inline=True)
                embed_log.add_field(name="エラー内容", value=str(e), inline=False)
                await send_log(bot, interaction.guild, "currency", embed_log)
            await interaction.edit_original_response(content=f"エラー: {e}")

class GameVCDurationSelectView(discord.ui.View):
    def __init__(self, bot, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, self.member, "ゲームVC", 12)
        p24 = get_room_price(self.bot, self.member, "ゲームVC", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve_hours.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four_hours.label = f"24時間 ({p24:,} {currency_name})"

    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success, emoji="🎮")
    async def twelve_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "ゲームVC", 12)

    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success, emoji="🎮")
    async def twenty_four_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "ゲームVC", 24)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class GambleVCDurationSelectView(discord.ui.View):
    def __init__(self, bot, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p12 = get_room_price(self.bot, self.member, "賭博VC", 12)
        p24 = get_room_price(self.bot, self.member, "賭博VC", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve_hours.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four_hours.label = f"24時間 ({p24:,} {currency_name})"

    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success, emoji="🎲")
    async def twelve_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "賭博VC", 12)

    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success, emoji="🎲")
    async def twenty_four_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "賭博VC", 24)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class GameRoomPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="ゲームVCを作成", style=discord.ButtonStyle.primary, emoji="🎮", custom_id="persistent_game_vc_btn")
    async def game_vc(self, it, btn):
        msg = "「ゲームVC」の利用期間を選択してください。"
        await it.response.send_message(msg, view=GameVCDurationSelectView(it.client, it.user), ephemeral=True)

class GambleRoomPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="賭博VCを作成", style=discord.ButtonStyle.primary, emoji="🎲", custom_id="persistent_gamble_vc_btn")
    async def gamble_vc(self, it, btn):
        msg = "「賭博VC」の利用期間を選択してください。"
        await it.response.send_message(msg, view=GambleVCDurationSelectView(it.client, it.user), ephemeral=True)

class InnDurationSelectView(discord.ui.View):
    def __init__(self, bot, is_free: bool, member=None, panel_id=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id
        p12 = get_room_price(self.bot, getattr(self, "member", None), "宿", 12)
        p24 = get_room_price(self.bot, getattr(self, "member", None), "宿", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve_hours.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four_hours.label = f"24時間 ({p24:,} {currency_name})"
        if is_free:
            self.twelve_hours.label = "12時間 (無料)"
            self.twenty_four_hours.label = "24時間 (無料)"

    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success, emoji="🛖")
    async def twelve_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "宿", 12, getattr(self, "panel_id", None))

    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success, emoji="🛖")
    async def twenty_four_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "宿", 24, getattr(self, "panel_id", None))

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class LuxuryInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member: discord.Member, panel_id=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id
        p12 = get_room_price(self.bot, self.member, "高級宿", 12)
        p24 = get_room_price(self.bot, self.member, "高級宿", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve_hours.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four_hours.label = f"24時間 ({p24:,} {currency_name})"

    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success, emoji="🏰")
    async def twelve_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "高級宿", 12, getattr(self, "panel_id", None))

    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success, emoji="🏰")
    async def twenty_four_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "高級宿", 24, getattr(self, "panel_id", None))

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class CustomRoomConfirmView(discord.ui.View):
    def __init__(self, bot, member=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        p24 = get_room_price(bot, getattr(self, "member", None), "カスタムVC", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.confirm.label = f"確定 (24時間 / {p24:,} {currency_name})"

    @discord.ui.button(label="確定", style=discord.ButtonStyle.success, emoji="✅")
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "カスタムVC", 24)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

# --- メッセージ設置用の購入ボタンパネル (永続的) ---
class RoomView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="一般宿", style=discord.ButtonStyle.primary, emoji="🛖", custom_id="persistent_inn_btn")
    async def inn(self, it, btn):
        if not await check_panel_permission(it.client, it.guild, it.user, "inn"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        is_free = is_free_inn_member(it.client, it.user)
        if is_free:
            msg = "「一般宿」を作成しますか？\nあなたは対象ロールのため **無料** で作成可能です。"
        else:
            msg = "「一般宿」の利用期間を選択してください。"
        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free, it.user, "inn"), ephemeral=True)

class LuxuryRoomView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="高級宿", style=discord.ButtonStyle.primary, emoji="🏰", custom_id="persistent_luxury_inn_btn")
    async def luxury(self, it, btn):
        bot = it.client
        member = it.user
        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        if not (has_admin_role(bot, member) or is_main_or_sub_member(bot, member) or is_new_member(bot, member) or is_downgrade_member(bot, member)):
            return await it.response.send_message("ロールがありません。", ephemeral=True)
        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "luxury_inn_single"), ephemeral=True)

class InnCombinedView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="一般宿", style=discord.ButtonStyle.primary, emoji="🛖", custom_id="persistent_combined_inn_btn")
    async def inn(self, it, btn):
        if not await check_panel_permission(it.client, it.guild, it.user, "inn_combined"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        is_free = is_free_inn_member(it.client, it.user)
        if is_free:
            msg = "「一般宿」を作成しますか？\nあなたは対象ロールのため **無料** で作成可能です。"
        else:
            msg = "「一般宿」の利用期間を選択してください。"
        await it.response.send_message(msg, view=InnDurationSelectView(it.client, is_free, it.user, "inn_combined"), ephemeral=True)

    @discord.ui.button(label="高級宿", style=discord.ButtonStyle.primary, emoji="🏰", custom_id="persistent_combined_luxury_inn_btn")
    async def luxury(self, it, btn):
        bot = it.client
        member = it.user
        if not await check_panel_permission(bot, it.guild, member, "inn_combined"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        if not (has_admin_role(bot, member) or is_main_or_sub_member(bot, member) or is_new_member(bot, member) or is_downgrade_member(bot, member)):
            return await it.response.send_message("ロールがありません。", ephemeral=True)
        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "inn_combined"), ephemeral=True)

class CustomRoomView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="カスタムVCを作成", style=discord.ButtonStyle.primary, emoji="✨", custom_id="persistent_custom_room_btn")
    async def custom(self, it, btn):
        await it.response.send_message("「カスタムVC」を購入しますか？", view=CustomRoomConfirmView(it.client), ephemeral=True)

class TempInnDurationSelectView(discord.ui.View):
    def __init__(self, bot, member=None, panel_id=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id
        p12 = get_room_price(self.bot, getattr(self, "member", None), "宿", 12)
        p24 = get_room_price(self.bot, getattr(self, "member", None), "宿", 24)
        currency_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        self.twelve_hours.label = f"12時間 ({p12:,} {currency_name})"
        self.twenty_four_hours.label = f"24時間 ({p24:,} {currency_name})"

    @discord.ui.button(label="12時間", style=discord.ButtonStyle.success, emoji="🛖")
    async def twelve_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "宿", 12, getattr(self, "panel_id", None))

    @discord.ui.button(label="24時間", style=discord.ButtonStyle.success, emoji="🛖")
    async def twenty_four_hours(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "宿", 24, getattr(self, "panel_id", None))

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class MainInnConfirmView(discord.ui.View):
    def __init__(self, bot, member=None, panel_id=None):
        super().__init__(timeout=60)
        self.bot = bot
        self.member = member
        self.panel_id = panel_id

    @discord.ui.button(label="作成する", style=discord.ButtonStyle.success, emoji="✅")
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        await process_room_purchase(self.bot, interaction, "宿", 0, getattr(self, "panel_id", None))

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="✖")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", view=None)

class MainInnPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="一般宿を作成 (無料・無制限)", style=discord.ButtonStyle.primary, emoji="🛖", custom_id="persistent_inn_main_btn")
    async def inn_main(self, it, btn):
        if not await check_panel_permission(it.client, it.guild, it.user, "main_inn"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        if not (is_main_or_sub_member(it.client, it.user) or has_admin_role(it.client, it.user)):
            return await it.response.send_message("このパネルは対象ロール(本・準メンバー)をお持ちの方のみ利用可能です。仮メンバーの方は有料の一般宿をご利用ください。", ephemeral=True)
        await it.response.send_message("「一般宿」を無料・時間無制限で作成しますか？", view=MainInnConfirmView(it.client), ephemeral=True)

class TempInnPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="一般宿を作成 (有料)", style=discord.ButtonStyle.primary, emoji="🛖", custom_id="persistent_inn_temp_btn")
    async def inn_temp(self, it, btn):
        if not await check_panel_permission(it.client, it.guild, it.user, "inn_temp"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        if is_main_or_sub_member(it.client, it.user):
            return await it.response.send_message("あなたは対象ロール(本・準メンバー)をお持ちのため、専用 of 無料パネルをご利用ください。", ephemeral=True)
        await it.response.send_message("「一般宿」の利用期間を選択してください。", view=TempInnDurationSelectView(it.client, it.user, "inn_temp"), ephemeral=True)

class LuxuryInnPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="高級宿を作成", style=discord.ButtonStyle.primary, emoji="🏰", custom_id="persistent_luxury_inn_panel_btn")
    async def luxury(self, it, btn):
        bot = it.client
        member = it.user
        if not await check_panel_permission(bot, it.guild, member, "luxury_inn_single"):
            return await it.response.send_message("こちらの宿はご利用になれません。", ephemeral=True)
        if not (has_admin_role(bot, member) or is_main_or_sub_member(bot, member) or is_new_member(bot, member) or is_downgrade_member(bot, member)):
            return await it.response.send_message("ロールがありません。", ephemeral=True)
        await it.response.send_message("「高級宿」の利用期間を選択してください。", view=LuxuryInnDurationSelectView(it.client, it.user, "luxury_inn_single"), ephemeral=True)

# --- Cogの定義 ---
class Rooms(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.check_expired_rooms.start()

    def cog_unload(self):
        self.check_expired_rooms.cancel()

    async def cog_load(self):
        # 永続ビューの登録
        self.bot.add_view(RoomView())
        self.bot.add_view(LuxuryRoomView())
        self.bot.add_view(InnCombinedView())
        self.bot.add_view(CustomRoomView())
        self.bot.add_view(InnControlView())
        self.bot.add_view(RoomControlView())
        self.bot.add_view(CustomRoomControlView())
        self.bot.add_view(VCRenamePanelView())
        self.bot.add_view(VCInvitePanelView())
        self.bot.add_view(MainInnPanelView())
        self.bot.add_view(TempInnPanelView())
        self.bot.add_view(LuxuryInnPanelView())
        self.bot.add_view(GameRoomPanelView())
        self.bot.add_view(GambleRoomPanelView())
        
    @tasks.loop(minutes=1)
    async def check_expired_rooms(self):
        # 1. 有効期限切れの部屋を削除
        expired_channel_ids = await database.get_expired_rooms()
        for channel_id in expired_channel_ids:
            channel = self.bot.get_channel(channel_id)
            if channel:
                try:
                    await channel.delete()
                except Exception:
                    pass
            try:
                await database.remove_room(channel_id)
            except Exception:
                pass
            self.bot.empty_custom_vcs.pop(channel_id, None)
        
        # 2. 無人のカスタムVCをチェックして削除 (10分経過)
        now = datetime.datetime.now(JST)
        to_delete = []
        for channel_id, empty_since in list(self.bot.empty_custom_vcs.items()):
            if (now - empty_since).total_seconds() >= 600: # 10分 = 600秒
                to_delete.append(channel_id)
        
        for channel_id in to_delete:
            channel = self.bot.get_channel(channel_id)
            if channel:
                try:
                    await channel.delete()
                except Exception:
                    pass
            try:
                await database.remove_room(channel_id)
            except Exception:
                pass
            self.bot.empty_custom_vcs.pop(channel_id, None)

    @check_expired_rooms.before_loop
    async def before_check_expired_rooms(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel):
        room_data = await database.get_room(channel.id)
        if room_data:
            await database.remove_room(channel.id)
            self.bot.empty_custom_vcs.pop(channel.id, None)

    @commands.Cog.listener()
    async def on_voice_state_update(self, member, before, after):
        if member.bot:
            return
        user_id = member.id
        now_aware = datetime.datetime.now(JST)

        if after.channel is not None:
            if after.channel.id in self.bot.auto_vc_triggers:
                trigger_id = after.channel.id
                try:
                    pool = await database.get_pool()
                    async with pool.acquire() as conn:
                        existing_room = await conn.fetchrow('SELECT channel_id FROM rooms WHERE owner_id = $1 AND room_type = $2 AND trigger_channel_id = $3', member.id, "一時部屋", trigger_id)
                    
                    if existing_room:
                        existing_channel = self.bot.get_channel(existing_room["channel_id"])
                        if not existing_channel:
                            try:
                                existing_channel = await self.bot.fetch_channel(existing_room["channel_id"])
                            except:
                                pass
                        
                        if existing_channel:
                            await asyncio.sleep(0.3)
                            if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                                await member.move_to(existing_channel)
                            return
                        else:
                            await database.remove_room(existing_room["channel_id"])

                    guild = member.guild
                    category = after.channel.category
                    
                    cfg = self.bot.auto_vc_configs.get(trigger_id)
                    if not cfg or not cfg.get("base_name"):
                        channel_name = f"🔊│{member.display_name}の部屋"
                    else:
                        base_name = cfg["base_name"].replace("{user}", member.display_name)
                        include_owner_name = cfg.get("include_owner_name", True)
                        use_numbering = cfg.get("use_numbering", False)
                        
                        if include_owner_name:
                            channel_name = f"{base_name}│{member.display_name}"
                        else:
                            channel_name = base_name
                        
                        if use_numbering:
                            existing_numbers = set()
                            if category:
                                prefix = channel_name + "ー"
                                for ch in category.voice_channels:
                                    if ch.name.startswith(prefix):
                                        suffix = ch.name[len(prefix):]
                                        num = circled_to_int(suffix)
                                        if num is not None:
                                            existing_numbers.add(num)
                            next_num = 1
                            while next_num in existing_numbers:
                                next_num += 1
                            circled_num = get_circled_number(next_num)
                            channel_name = f"{channel_name}ー{circled_num}"

                    if category:
                        for existing_ch in category.voice_channels:
                            if existing_ch.name == channel_name:
                                now_naive = database.get_now_naive()
                                far_future = now_naive + datetime.timedelta(days=36500)
                                await database.add_room(existing_ch.id, member.id, "一時部屋", far_future, trigger_channel_id=trigger_id)
                                await asyncio.sleep(0.3)
                                if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                                    await member.move_to(existing_ch)
                                return

                    new_channel = await guild.create_voice_channel(
                        name=channel_name,
                        category=category,
                        reason=f"Auto-VC for {member.display_name}"
                    )
                    
                    # 権限の適用
                    is_invite_only = cfg.get("is_invite_only", False) if cfg else False
                    invite_visible_role_ids = cfg.get("invite_visible_role_ids", []) if cfg else []
                    allowed_role_ids = cfg.get("allowed_role_ids", []) if cfg else []

                    # デフォルトで全員許可の前提で、制限がある場合のみ上書きする
                    if is_invite_only or allowed_role_ids:
                        overwrites = {
                            guild.default_role: discord.PermissionOverwrite(view_channel=False, connect=False),
                            member: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True)
                        }

                        if allowed_role_ids:
                            # 閲覧・接続を許可するロール
                            for rid in allowed_role_ids:
                                role = guild.get_role(rid)
                                if role:
                                    overwrites[role] = discord.PermissionOverwrite(view_channel=True, connect=True)
                        elif is_invite_only:
                            # 招待専用の場合、閲覧のみ許可するロール
                            for rid in invite_visible_role_ids:
                                role = guild.get_role(rid)
                                if role:
                                    # 元々の仕様（閲覧のみ許可）に合わせる（connect=True にするかは用途次第だが、ここでは以前の実装を踏襲）
                                    overwrites[role] = discord.PermissionOverwrite(view_channel=True, connect=True)
                        
                        await new_channel.edit(overwrites=overwrites)
                    
                    if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                        try:
                            await member.move_to(new_channel)
                        except:
                            pass
                    
                    now_naive = database.get_now_naive()
                    far_future = now_naive + datetime.timedelta(days=36500)
                    await database.add_room(new_channel.id, member.id, "一時部屋", far_future, trigger_channel_id=trigger_id)
                    print(f"[Auto-VC] Created room {new_channel.id} and registered in DB")
                    
                    if not cfg or cfg.get("show_panel", True):
                        embed = discord.Embed(
                            title="⚙️ 部屋の設定",
                            description="このボタンから部屋の名前や人数制限を変更できます。",
                            color=discord.Color.blue()
                        )
                        await new_channel.send(embed=embed, view=VCRenamePanelView())
                        
                    if is_invite_only:
                        embed_invite = discord.Embed(
                            title="📨 招待パネル",
                            description="この部屋は「招待専用」です。\n下のボタンから他のユーザーのアクセスを許可・管理できます。",
                            color=discord.Color.green()
                        )
                        await new_channel.send(embed=embed_invite, view=VCInvitePanelView())

                    # Move attempts are now done instantly above. We still keep a fallback just in case.
                    async def delayed_move():
                        for i in range(3):
                            await asyncio.sleep(0.5 if i == 0 else 1.0)
                            if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                                try:
                                    await member.move_to(new_channel)
                                    break
                                except:
                                    pass
                            else:
                                break
                    self.bot.loop.create_task(delayed_move())
                except Exception as e:
                    print(f"[Auto-VC] Error: {e}")

            self.bot.empty_custom_vcs.pop(after.channel.id, None)
        
        if before.channel is not None and (after.channel is None or before.channel != after.channel):
            humans = [m for m in before.channel.members if not m.bot]
            if len(humans) == 0:
                room_data = await database.get_room(before.channel.id)
                if room_data:
                    if room_data["room_type"] in ["一時部屋", "宿", "ゲームVC", "賭博VC"]:
                        # 期限設定あり(有料/無期限)は退出しても削除しない
                        if room_data["expire_at"] and room_data["room_type"] in ["宿", "ゲームVC", "賭博VC"]:
                            pass # 有料の部屋は退出しても保持される
                        else:
                            try:
                                print(f"[Auto-VC] Deleting empty room ({room_data['room_type']}): {before.channel.name}")
                                await before.channel.delete()
                                await database.remove_room(before.channel.id)
                            except Exception as del_e:
                                print(f"[Auto-VC] Delete error: {del_e}")
                    elif room_data["room_type"] == "カスタムVC":
                        self.bot.empty_custom_vcs[before.channel.id] = now_aware

async def setup(bot):
    await bot.add_cog(Rooms(bot))
