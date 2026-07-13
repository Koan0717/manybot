import discord
from discord.ext import commands
from discord import app_commands
import datetime
import asyncio
import database
import json
import os
from helpers import (
    JST, get_setting, get_role_by_setting, has_admin_role, has_event_manager_role,
    EMBLEM_MANAGER_ROLE_NAME, EMBLEM_MASTER_ROLE_NAME, CONFESSION_PRIEST_ROLE_NAME,
    PRIEST_ROLE_NAME, ADMIN_ROLE_NAMES, load_events, save_events, parse_date
)

# --- チケット管理 (共通) ---
class TicketCloseConfirmView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=60)

    @discord.ui.button(label="閉じる", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("チケットを削除します...")
        await asyncio.sleep(2)
        await interaction.channel.delete()

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="キャンセルしました。", embed=None, view=None)

class TicketControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="チケットを閉じる", style=discord.ButtonStyle.danger, emoji="🔒", custom_id="persistent_close_ticket_btn")
    async def close_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = discord.Embed(title="確認", description="このチケットを閉じてもよろしいですか？", color=discord.Color.red())
        await interaction.response.send_message(embed=embed, view=TicketCloseConfirmView(), ephemeral=True)

# --- スタンプ依頼 ---
class EmblemRequestModal(discord.ui.Modal, title='スタンプ制作依頼'):
    details = discord.ui.TextInput(
        label='依頼内容の詳細',
        style=discord.TextStyle.paragraph,
        placeholder='例: 自分のアイコンを使った「了解」スタンプをお願いします！',
        required=True,
        max_length=500
    )

    def __init__(self, target_member):
        super().__init__()
        self.target_member = target_member

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        guild = interaction.guild
        
        current_ticket_nums = []
        for c in guild.channels:
            if c.name.startswith("ticket-"):
                try:
                    num = int(c.name.split("-")[1])
                    current_ticket_nums.append(num)
                except:
                    pass
        
        ticket_num = 1
        while ticket_num in current_ticket_nums:
            ticket_num += 1
            
        channel_name = f"ticket-{ticket_num:03d}"
        
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            self.target_member: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        roles_to_overwrite = []
        for role_name in ADMIN_ROLE_NAMES:
            role = discord.utils.get(guild.roles, name=role_name)
            if role:
                roles_to_overwrite.append(role)
        
        manager_role = get_role_by_setting(bot, guild, "EMBLEM_MANAGER_ROLE_ID", EMBLEM_MANAGER_ROLE_NAME)
        if manager_role and manager_role not in roles_to_overwrite:
            roles_to_overwrite.append(manager_role)
            
        for role in roles_to_overwrite:
            overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

        try:
            category = interaction.channel.category
            ticket_channel = await guild.create_text_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites,
                reason=f"Stamp request ticket for {interaction.user.display_name}"
            )
            
            embed = discord.Embed(
                title="🎨 スタンプ制作依頼チケット",
                description=(
                    f"**依頼者:** {interaction.user.mention}\n"
                    f"**担当者:** {self.target_member.mention}\n\n"
                    f"**【依頼内容】**\n{self.details.value}\n\n"
                    "内容の確認や相談はこちらのチャンネルで行ってください。\n"
                    "完了したら下のボタンでチケットを閉じることができます。"
                ),
                color=discord.Color.blue()
            )
            
            mentions = [interaction.user.mention, self.target_member.mention]
            if manager_role:
                mentions.append(manager_role.mention)
            
            mention_str = " ".join(mentions)
            await ticket_channel.send(content=mention_str, embed=embed, view=TicketControlView())
            await interaction.followup.send(f"✅ チケットを作成しました: {ticket_channel.mention}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"エラーが発生しました: {e}", ephemeral=True)

class EmblemSelectView(discord.ui.View):
    def __init__(self, bot, guild):
        super().__init__(timeout=60)
        master_role = get_role_by_setting(bot, guild, "EMBLEM_MASTER_ROLE_ID", EMBLEM_MASTER_ROLE_NAME)
        manager_role = get_role_by_setting(bot, guild, "EMBLEM_MANAGER_ROLE_ID", EMBLEM_MANAGER_ROLE_NAME)
        
        member_set = set()
        if master_role: member_set.update(master_role.members)
        if manager_role: member_set.update(manager_role.members)
        
        options = []
        for member in sorted(member_set, key=lambda m: m.display_name):
            options.append(discord.SelectOption(
                label=member.display_name,
                value=str(member.id),
                description=f"{member.name}"
            ))
        
        if not options:
            self.add_item(discord.ui.Button(label="現在、依頼可能な製作者がいません", disabled=True))
        else:
            select = discord.ui.Select(
                placeholder="担当する製作者を選択してください...",
                options=options[:25]
            )
            select.callback = self.select_callback
            self.add_item(select)

    async def select_callback(self, interaction: discord.Interaction):
        user_id = int(interaction.data['values'][0])
        target_member = interaction.guild.get_member(user_id)
        if not target_member:
            await interaction.response.send_message("メンバーが見つかりませんでした。", ephemeral=True)
            return
        await interaction.response.send_modal(EmblemRequestModal(target_member))

class EmblemRequestPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="スタンプを依頼する", style=discord.ButtonStyle.primary, emoji="🎨", custom_id="persistent_emblem_req_btn")
    async def request_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = EmblemSelectView(interaction.client, interaction.guild)
        await interaction.response.send_message("担当者を選択してください：", view=view, ephemeral=True)

# --- 告解室 ---
class ConfessionRequestModal(discord.ui.Modal, title='告解・相談依頼'):
    details = discord.ui.TextInput(
        label='依頼内容の詳細',
        style=discord.TextStyle.paragraph,
        placeholder='例: 告解をお願いしたいです。 / ○○について相談したいです。',
        required=True,
        max_length=500
    )

    def __init__(self, target_member):
        super().__init__()
        self.target_member = target_member

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        
        current_ticket_nums = []
        for c in guild.channels:
            if c.name.startswith("confess-"):
                try:
                    num = int(c.name.split("-")[1])
                    current_ticket_nums.append(num)
                except:
                    pass
        
        ticket_num = 1
        while ticket_num in current_ticket_nums:
            ticket_num += 1
            
        channel_name = f"confess-{ticket_num:03d}"
        
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            self.target_member: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        for role_name in ADMIN_ROLE_NAMES + [CONFESSION_PRIEST_ROLE_NAME, PRIEST_ROLE_NAME]:
            role = discord.utils.get(guild.roles, name=role_name)
            if role:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

        try:
            category = interaction.channel.category
            ticket_channel = await guild.create_text_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites,
                reason=f"Confession ticket for {interaction.user.display_name}"
            )
            
            embed = discord.Embed(
                title="⛪ 告解・相談チケット",
                description=(
                    f"**依頼者:** {interaction.user.mention}\n"
                    f"**担当者:** {self.target_member.mention}\n\n"
                    f"**【相談内容】**\n{self.details.value}\n\n"
                    "内容の確認や相談はこちらのチャンネルで行ってください。\n"
                    "完了したら下のボタンでチケットを閉じることができます。"
                ),
                color=discord.Color.purple()
            )
            
            mentions = []
            for role_name in ADMIN_ROLE_NAMES + [CONFESSION_PRIEST_ROLE_NAME, PRIEST_ROLE_NAME]:
                role = discord.utils.get(guild.roles, name=role_name)
                if role: mentions.append(role.mention)
            
            mention_str = " ".join(mentions)
            await ticket_channel.send(content=f"{interaction.user.mention} {self.target_member.mention} {mention_str}", embed=embed, view=TicketControlView())
            await interaction.followup.send(f"✅ チケットを作成しました: {ticket_channel.mention}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"エラーが発生しました: {e}", ephemeral=True)

class ConfessionSelectView(discord.ui.View):
    def __init__(self, bot, guild):
        super().__init__(timeout=60)
        priest1_role = get_role_by_setting(bot, guild, "CONFESSION_PRIEST_ROLE_ID", CONFESSION_PRIEST_ROLE_NAME)
        priest2_role = get_role_by_setting(bot, guild, "PRIEST_ROLE_ID", PRIEST_ROLE_NAME)
        
        member_set = set()
        if priest1_role: member_set.update(priest1_role.members)
        if priest2_role: member_set.update(priest2_role.members)
        
        options = []
        for member in sorted(member_set, key=lambda m: m.display_name):
            options.append(discord.SelectOption(
                label=member.display_name,
                value=str(member.id),
                description=f"{member.name}"
            ))
        
        if not options:
            self.add_item(discord.ui.Button(label="現在、対応可能な司祭がいません", disabled=True))
        else:
            select = discord.ui.Select(
                placeholder="担当する司祭を選択してください...",
                options=options[:25]
            )
            select.callback = self.select_callback
            self.add_item(select)

    async def select_callback(self, interaction: discord.Interaction):
        user_id = int(interaction.data['values'][0])
        target_member = interaction.guild.get_member(user_id)
        if not target_member:
            await interaction.response.send_message("メンバーが見つかりませんでした。", ephemeral=True)
            return
        await interaction.response.send_modal(ConfessionRequestModal(target_member))

class ConfessionRequestPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="告解・相談をする", style=discord.ButtonStyle.primary, emoji="⛪", custom_id="persistent_confession_req_btn")
    async def request_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = ConfessionSelectView(interaction.client, interaction.guild)
        await interaction.response.send_message("担当者を選択してください：", view=view, ephemeral=True)

# --- お問い合わせ ---
class InquiryRequestModal(discord.ui.Modal, title="お問い合わせ"):
    subject = discord.ui.TextInput(
        label="件名",
        placeholder="例: ○○について質問",
        max_length=100,
        required=True
    )
    details = discord.ui.TextInput(
        label="内容",
        style=discord.TextStyle.paragraph,
        placeholder="お問い合わせ内容の具体的な詳細をご記入ください。",
        required=True,
        max_length=1000
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        
        role_ids = await database.get_inquiry_panel_roles(interaction.channel.id)
        mention_roles = [guild.get_role(rid) for rid in role_ids]
        mention_roles = [r for r in mention_roles if r is not None]
        
        current_ticket_nums = []
        for c in guild.channels:
            if c.name.startswith("inquiry-"):
                try:
                    num = int(c.name.split("-")[1])
                    current_ticket_nums.append(num)
                except:
                    pass
        
        ticket_num = 1
        while ticket_num in current_ticket_nums:
            ticket_num += 1
            
        channel_name = f"inquiry-{ticket_num:03d}"
        
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        for role_name in ADMIN_ROLE_NAMES:
            role = discord.utils.get(guild.roles, name=role_name)
            if role:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
        
        for m_role in mention_roles:
            overwrites[m_role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

        try:
            channel = interaction.channel
            category = getattr(channel, "category", None)
            if category is None and hasattr(channel, "parent"):
                category = getattr(channel.parent, "category", None)

            ticket_channel = await guild.create_text_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites,
                reason=f"Inquiry ticket for {interaction.user.display_name}"
            )
            
            embed = discord.Embed(
                title="✉️ お問い合わせチケット",
                description=(
                    f"**件名:** {self.subject.value}\n\n"
                    f"**内容:**\n{self.details.value}\n\n"
                    f"**作成者:** {interaction.user.mention}\n\n"
                    "内容の確認はこちらのチャンネルで行ってください。\n"
                    "完了したら下のボタンでチケットを閉じることができます。"
                ),
                color=discord.Color.blue()
            )
            
            mention_str = f"{interaction.user.mention}"
            if mention_roles:
                mention_str += " " + " ".join([r.mention for r in mention_roles])
            else:
                mentions = []
                for role_name in ADMIN_ROLE_NAMES:
                    role = discord.utils.get(guild.roles, name=role_name)
                    if role: mentions.append(role.mention)
                if mentions:
                    mention_str += " " + " ".join(mentions)

            await ticket_channel.send(content=mention_str, embed=embed, view=TicketControlView())
            await interaction.followup.send(f"✅ お問い合わせチケットを作成しました: {ticket_channel.mention}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"エラーが発生しました: {e}", ephemeral=True)

class InquiryRequestPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="お問い合わせチケットを作成", style=discord.ButtonStyle.primary, emoji="✉️", custom_id="persistent_inquiry_req_btn")
    async def request_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(InquiryRequestModal())

class InquirySetupRoleSelect(discord.ui.RoleSelect):
    def __init__(self):
        super().__init__(
            placeholder="通知先（メンション）ロールを選択...",
            min_values=1,
            max_values=10
        )

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        roles = self.values
        channel = interaction.channel
        
        await database.add_inquiry_panel(channel.id, [r.id for r in roles])
        
        embed = discord.Embed(
            title="✉️ お問い合わせ窓口",
            description=(
                "お問い合わせやご相談はこちらのボタンからチケットを作成してください。\n\n"
                "ボタンを押すと「件名」と「内容」の入力画面が開きます。"
            ),
            color=discord.Color.blue()
        )
        await channel.send(embed=embed, view=InquiryRequestPanelView())
        
        mentions_str = ", ".join([r.mention for r in roles])
        await interaction.followup.send(f"✅ お問い合わせパネルを設置し、通知先ロールを {mentions_str} に設定しました。", ephemeral=True)

class InquirySetupView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.add_item(InquirySetupRoleSelect())

# --- 匿名チャット ---
class AnonymousMessageModal(discord.ui.Modal, title="匿名メッセージ送信"):
    message_content = discord.ui.TextInput(
        label="メッセージ内容",
        style=discord.TextStyle.paragraph,
        placeholder="ここに書いたメッセージが匿名で送信されます。",
        required=True,
        max_length=2000
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        config = await database.get_anonymous_chat(interaction.channel.id)
        if not config:
            return await interaction.followup.send("❌ このチャンネルは匿名チャットに設定されていません。", ephemeral=True)
            
        dest_channel_id = config
        dest_channel = bot.get_channel(dest_channel_id) or await bot.fetch_channel(dest_channel_id)
        if not dest_channel:
            return await interaction.followup.send("❌ 送信先チャンネルが見つかりません。", ephemeral=True)
            
        try:
            import hashlib
            today_str = datetime.datetime.now(JST).strftime("%Y-%m-%d")
            salt = os.getenv("ANONYMOUS_SALT", "anon_default_salt_998")
            user_hash = hashlib.sha256(f"{interaction.user.id}-{today_str}-{salt}".encode()).hexdigest()
            anon_id = user_hash[:8].upper()

            embed = discord.Embed(
                description=self.message_content.value,
                color=0x2f3136
            )
            embed.set_author(
                name=f"匿名ユーザー (ID: {anon_id})",
                icon_url="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150"
            )
            embed.timestamp = discord.utils.utcnow()
            
            await dest_channel.send(embed=embed)
            await interaction.followup.send("✅ メッセージを匿名で送信しました！", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ 送信に失敗しました: {e}", ephemeral=True)

class AnonymousChatPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="匿名メッセージを送る", style=discord.ButtonStyle.secondary, emoji="💬", custom_id="persistent_anon_chat_btn")
    async def request_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(AnonymousMessageModal())

class AnonymousPanelChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(
            placeholder="パネルを設置するチャンネルを選択...",
            channel_types=[discord.ChannelType.text]
        )
    async def callback(self, interaction: discord.Interaction):
        self.view.panel_channel = self.values[0]
        await interaction.response.defer(ephemeral=True)
        self.view.update_buttons()
        await interaction.edit_original_response(view=self.view)

class AnonymousDestChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(
            placeholder="送信先チャンネルを選択...",
            channel_types=[discord.ChannelType.text]
        )
    async def callback(self, interaction: discord.Interaction):
        self.view.dest_channel = self.values[0]
        await interaction.response.defer(ephemeral=True)
        self.view.update_buttons()
        await interaction.edit_original_response(view=self.view)

class ConfirmAnonymousSetupButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="設定を確定して設置", style=discord.ButtonStyle.success, disabled=True)
        
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        p_chan = self.view.panel_channel
        d_chan = self.view.dest_channel
        
        await database.add_anonymous_chat(p_chan.id, d_chan.id)
        
        embed = discord.Embed(
            title="💬 匿名メッセージ送信窓口",
            description="このボタンからメッセージを送信すると、送信先のチャンネルに匿名で届きます。\n発信者の名前は表示されません。",
            color=discord.Color.light_grey()
        )
        await p_chan.send(embed=embed, view=AnonymousChatPanelView())
        await interaction.followup.send(f"✅ {p_chan.mention} に匿名チャットパネルを設置しました（送信先: {d_chan.mention}）", ephemeral=True)

class AnonymousChatSetupView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.panel_channel = None
        self.dest_channel = None
        self.add_item(AnonymousPanelChannelSelect())
        self.add_item(AnonymousDestChannelSelect())
        self.confirm_btn = ConfirmAnonymousSetupButton()
        self.add_item(self.confirm_btn)

    def update_buttons(self):
        if self.panel_channel and self.dest_channel:
            self.confirm_btn.disabled = False
        else:
            self.confirm_btn.disabled = True

# --- カスタムチケット ---
class CustomTicketSetupModal(discord.ui.Modal, title="カスタムチケットパネル設定"):
    panel_title = discord.ui.TextInput(label="パネルのタイトル", placeholder="例: スタンプ制作 依頼所", max_length=100, required=True)
    panel_description = discord.ui.TextInput(
        label="パネルの説明文",
        style=discord.TextStyle.paragraph,
        placeholder="例: ここからスタンプの制作を依頼できます。\n下のボタンを押して担当者を選択してください。",
        max_length=1000,
        required=True
    )
    button_label = discord.ui.TextInput(label="ボタンのテキスト", placeholder="例: スタンプを依頼する", max_length=20, default="チケットを作成する", required=True)
    button_emoji = discord.ui.TextInput(label="ボタンの絵文字 (任意 - 絵文字1つ)", placeholder="例: 🎨 / ✉️ / ⛪", max_length=10, required=False)
    ticket_prefix = discord.ui.TextInput(label="チケット接頭辞 (チャンネル名の頭につく英数字)", placeholder="例: ticket (ticket-001のようになります)", max_length=15, default="ticket", required=True)

    async def on_submit(self, interaction: discord.Interaction):
        view = CustomTicketMentionRoleSelectView(
            title=self.panel_title.value,
            description=self.panel_description.value,
            button_label=self.button_label.value,
            button_emoji=self.button_emoji.value or None,
            prefix=self.ticket_prefix.value
        )
        embed = discord.Embed(
            title="🎫 カスタムチケット設定 (1/2)",
            description="チケット作成時に**通知（メンション）するロール**を選択してください。",
            color=discord.Color.blue()
        )
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

class CustomTicketMentionRoleSelectView(discord.ui.View):
    def __init__(self, title, description, button_label, button_emoji, prefix):
        super().__init__(timeout=180)
        self.panel_title = title
        self.panel_description = description
        self.button_label = button_label
        self.button_emoji = button_emoji
        self.ticket_prefix = prefix
        self.add_item(CustomTicketMentionRoleSelect())

class CustomTicketMentionRoleSelect(discord.ui.RoleSelect):
    def __init__(self):
        super().__init__(placeholder="通知先（メンション）ロールを選択...", min_values=1, max_values=10)

    async def callback(self, interaction: discord.Interaction):
        roles = self.values
        mention_role_ids = [r.id for r in roles]
        
        view = CustomTicketTargetRoleSelectView(
            title=self.view.panel_title,
            description=self.view.panel_description,
            button_label=self.view.button_label,
            button_emoji=self.view.button_emoji,
            prefix=self.view.ticket_prefix,
            mention_role_ids=mention_role_ids
        )
        embed = discord.Embed(
            title="🎫 カスタムチケット設定 (2/2)",
            description=(
                "**依頼先となる人のロール**を選択してください。\n"
                "ここにロールを設定すると、チケット作成時にそのロールを持つメンバーのリストが選択肢として表示されます。\n"
                "設定しない（誰宛てでもない直接のお問い合わせ）場合は、「設定しない（直接作成）」を押してください。"
            ),
            color=discord.Color.blue()
        )
        await interaction.response.edit_message(embed=embed, view=view)

class CustomTicketTargetRoleSelectView(discord.ui.View):
    def __init__(self, title, description, button_label, button_emoji, prefix, mention_role_ids):
        super().__init__(timeout=180)
        self.panel_title = title
        self.panel_description = description
        self.button_label = button_label
        self.button_emoji = button_emoji
        self.ticket_prefix = prefix
        self.mention_role_ids = mention_role_ids
        self.add_item(CustomTicketTargetRoleSelect())

    @discord.ui.button(label="設定しない（直接作成）", style=discord.ButtonStyle.secondary, row=2)
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.save_and_send_panel(interaction, target_role_ids=[])

    async def save_and_send_panel(self, interaction: discord.Interaction, target_role_ids: list[int]):
        await interaction.response.defer(ephemeral=True)
        channel = interaction.channel
        
        await database.add_custom_ticket_panel(
            channel_id=channel.id,
            panel_title=self.panel_title,
            panel_description=self.panel_description,
            button_label=self.button_label,
            button_emoji=self.button_emoji,
            mention_role_ids=self.mention_role_ids,
            target_role_ids=target_role_ids,
            ticket_prefix=self.ticket_prefix
        )
        
        embed = discord.Embed(
            title=self.panel_title,
            description=self.panel_description,
            color=discord.Color.blue()
        )
        
        view = CustomTicketPanelView()
        button = view.children[0]
        button.label = self.button_label
        if self.button_emoji:
            button.emoji = self.button_emoji
            
        await channel.send(embed=embed, view=view)
        await interaction.followup.send("✅ カスタムチケットパネルを設置しました！", ephemeral=True)

class CustomTicketTargetRoleSelect(discord.ui.RoleSelect):
    def __init__(self):
        super().__init__(placeholder="依頼先（担当）ロールを選択...", min_values=1, max_values=10, row=1)

    async def callback(self, interaction: discord.Interaction):
        roles = self.values
        target_role_ids = [r.id for r in roles]
        await self.view.save_and_send_panel(interaction, target_role_ids)

class CustomTicketPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(style=discord.ButtonStyle.primary, custom_id="persistent_custom_ticket_panel_btn")
    async def request_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        panel = await database.get_custom_ticket_panel(interaction.channel.id)
        if not panel:
            return await interaction.response.send_message("❌ パネルの設定が見つかりません。設定が削除された可能性があります。", ephemeral=True)
            
        guild = interaction.guild
        target_role_ids = panel.get("target_role_ids", [])
        
        if target_role_ids:
            member_set = set()
            for rid in target_role_ids:
                role = guild.get_role(rid)
                if role:
                    member_set.update(role.members)
            
            options = []
            for member in sorted(member_set, key=lambda m: m.display_name):
                options.append(discord.SelectOption(
                    label=member.display_name,
                    value=str(member.id),
                    description=f"{member.name}"
                ))
                
            if not options:
                return await interaction.response.send_message("❌ 現在、対応可能な担当者がいません（指定されたロールを持つメンバーがいません）。", ephemeral=True)
            
            view = CustomTicketSelectView(options, panel)
            await interaction.response.send_message("担当者を選択してください：", view=view, ephemeral=True)
        else:
            modal = CustomTicketRequestModal(target_member=None, panel=panel)
            await interaction.response.send_modal(modal)

class CustomTicketSelectView(discord.ui.View):
    def __init__(self, options, panel):
        super().__init__(timeout=60)
        self.panel = panel
        select = discord.ui.Select(placeholder="担当者を選択してください...", options=options[:25])
        select.callback = self.select_callback
        self.add_item(select)

    async def select_callback(self, interaction: discord.Interaction):
        user_id = int(interaction.data['values'][0])
        target_member = interaction.guild.get_member(user_id)
        if not target_member:
            return await interaction.response.send_message("メンバーが見つかりませんでした。", ephemeral=True)
            
        modal = CustomTicketRequestModal(target_member=target_member, panel=self.panel)
        await interaction.response.send_modal(modal)

class CustomTicketRequestModal(discord.ui.Modal):
    details = discord.ui.TextInput(label="ご用件・相談内容の詳細", style=discord.TextStyle.paragraph, placeholder="内容を詳しく入力してください。", required=True, max_length=1000)

    def __init__(self, target_member, panel):
        title = panel["panel_title"]
        if len(title) > 45:
            title = title[:42] + "..."
        super().__init__(title=title)
        self.target_member = target_member
        self.panel = panel

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        bot = interaction.client
        prefix = self.panel.get("ticket_prefix") or "ticket"
        
        current_ticket_nums = []
        for c in guild.channels:
            if c.name.startswith(f"{prefix}-"):
                try:
                    num = int(c.name.split("-")[1])
                    current_ticket_nums.append(num)
                except:
                    pass
        
        ticket_num = 1
        while ticket_num in current_ticket_nums:
            ticket_num += 1
            
        channel_name = f"{prefix}-{ticket_num:03d}"
        
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }
        
        if self.target_member:
            overwrites[self.target_member] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
            
        for role_name in ADMIN_ROLE_NAMES:
            role = discord.utils.get(guild.roles, name=role_name)
            if role:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
                
        admin_role_ids = get_setting(bot, "ADMIN_ROLE_IDS") or []
        for rid in admin_role_ids:
            role = guild.get_role(rid)
            if role:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
                
        for rid in self.panel.get("mention_role_ids", []):
            role = guild.get_role(rid)
            if role:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)
                
        try:
            category = interaction.channel.category
            ticket_channel = await guild.create_text_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites,
                reason=f"Custom ticket ({prefix}) for {interaction.user.display_name}"
            )
            
            title_text = f"🎫 {self.panel['panel_title']} チケット"
            desc_text = f"**作成者:** {interaction.user.mention}\n"
            if self.target_member:
                desc_text += f"**担当者:** {self.target_member.mention}\n"
            desc_text += f"\n**【内容】**\n{self.details.value}\n\n"
            desc_text += "内容の確認や相談はこちらのチャンネルで行ってください。\n"
            desc_text += "完了したら下のボタンでチケットを閉じることができます。"
            
            embed = discord.Embed(title=title_text, description=desc_text, color=discord.Color.blue())
            
            mentions = [interaction.user.mention]
            if self.target_member:
                mentions.append(self.target_member.mention)
                
            for rid in self.panel.get("mention_role_ids", []):
                role = guild.get_role(rid)
                if role:
                    mentions.append(role.mention)
                    
            mention_str = " ".join(mentions)
            
            await ticket_channel.send(content=mention_str, embed=embed, view=TicketControlView())
            await interaction.followup.send(f"✅ チケットを作成しました: {ticket_channel.mention}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

# --- イベント管理 ---
class EventGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="イベント", description="イベントのスケジュール管理を行います")
        self.bot = bot

    @app_commands.command(name="help", description="イベント管理機能の使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="📅 イベントスケジュール管理機能の使い方",
            description="イベントや予定を簡単に登録・共有できます！",
            color=discord.Color.blue()
        )
        embed.add_field(name="1. /イベント 登録", value="新しいイベントを作成します。企画書のURLも登録可能です。", inline=False)
        embed.add_field(name="2. /イベント 一覧", value="登録されているイベントを一覧で表示します。リンクもクリックできます。", inline=False)
        embed.add_field(name="3. /イベント 修正", value="イベントの内容を修正したり、後から企画書を追加したりできます。", inline=False)
        embed.add_field(name="4. /イベント 削除", value="イベントを一覧から削除します。", inline=False)
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="登録", description="新しいイベントをスケジュールに登録します")
    @app_commands.describe(name="イベント名", start_date="開始日 (例: 5/10 21:00)", end_date="終了日（任意）", detail="詳細（任意）", proposal_url="企画書のURL（任意）")
    async def add_event(self, interaction: discord.Interaction, name: str, start_date: str, end_date: str = "", detail: str = "", proposal_url: str = ""):
        events = load_events()
        new_id = 1
        existing_ids = set(int(k) for k in events.keys() if k.isdigit())
        while new_id in existing_ids:
            new_id += 1
        
        events[str(new_id)] = {
            "name": name,
            "start_date": start_date,
            "end_date": end_date,
            "detail": detail,
            "proposal_url": proposal_url,
            "created_by": interaction.user.display_name
        }
        save_events(events)
        
        embed = discord.Embed(title="✅ イベントを登録しました", color=discord.Color.green())
        embed.add_field(name="ID", value=str(new_id), inline=False)
        embed.add_field(name="イベント名", value=name, inline=False)
        if end_date:
            embed.add_field(name="開始", value=start_date, inline=False)
            embed.add_field(name="終了", value=end_date, inline=False)
        else:
            embed.add_field(name="日時", value=f"{start_date}（1日のみ）", inline=False)
        if detail:
            embed.add_field(name="詳細", value=detail, inline=False)
        if proposal_url:
            embed.add_field(name="企画書", value=f"[リンク]({proposal_url})", inline=False)
            
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="一覧", description="登録されているイベントの一覧を表示します")
    async def list_events(self, interaction: discord.Interaction):
        events = load_events()
        if not events:
            await interaction.response.send_message("現在登録されているイベントはありません。")
            return
            
        embed = discord.Embed(title="📅 イベント一覧", color=discord.Color.blue())
        
        sorted_events = sorted(
            events.items(), 
            key=lambda item: parse_date(item[1].get("start_date", item[1].get("time", "未定")))
        )
        
        for event_id, info in sorted_events:
            name = info.get("name", "未定")
            start_date = info.get("start_date", info.get("time", "未定"))
            end_date = info.get("end_date", "")
            detail = info.get("detail", "")
            proposal_url = info.get("proposal_url", "")
            
            if end_date:
                value = f"**開始**: {start_date}\n**終了**: {end_date}"
            else:
                value = f"**日時**: {start_date}（1日のみ）"
            if detail:
                value += f"\n**詳細**: {detail}"
            if proposal_url:
                value += f"\n**企画書**: [リンク]({proposal_url})"
                
            embed.add_field(name=f"[ID: {event_id}] {name}", value=value, inline=False)
            
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="修正", description="登録済みのイベント内容を修正します")
    @app_commands.describe(event_id="修正するイベントのID", name="新しいイベント名（任意）", start_date="新しい開始日（任意）", end_date="新しい終了日（任意）", detail="新しい詳細（任意）", proposal_url="新しい企画書URL（任意）")
    async def edit_event(self, interaction: discord.Interaction, event_id: int, name: str = None, start_date: str = None, end_date: str = None, detail: str = None, proposal_url: str = None):
        if not has_event_manager_role(self.bot, interaction.user):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return
        events = load_events()
        eid_str = str(event_id)
        if eid_str not in events:
            await interaction.response.send_message(f"ID: {event_id} のイベントは見つかりませんでした。", ephemeral=True)
            return
            
        if name:
            events[eid_str]["name"] = name
        if start_date:
            events[eid_str]["start_date"] = start_date
        if end_date:
            events[eid_str]["end_date"] = end_date
        if detail:
            events[eid_str]["detail"] = detail
        if proposal_url:
            events[eid_str]["proposal_url"] = proposal_url
            
        save_events(events)
        await interaction.response.send_message(f"✅ ID: {event_id} のイベントを修正しました。")

    @app_commands.command(name="削除", description="登録済みのイベントを削除します")
    @app_commands.describe(event_id="削除するイベントのID")
    async def delete_event(self, interaction: discord.Interaction, event_id: int):
        if not has_event_manager_role(self.bot, interaction.user):
            await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
            return
        events = load_events()
        eid_str = str(event_id)
        if eid_str not in events:
            await interaction.response.send_message(f"ID: {event_id} のイベントは見つかりませんでした。", ephemeral=True)
            return
            
        deleted_name = events[eid_str].get("name", "")
        del events[eid_str]
        save_events(events)
        await interaction.response.send_message(f"🗑️ イベント「{deleted_name}」(ID: {event_id}) を削除しました。")

# --- Cogの定義 ---
class Utility(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="help", description="Botのヘルプ・各種コマンドの使い方を表示します")
    async def main_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="ℹ️ ０番区bot ヘルプ",
            description="Botの主要なコマンドと、各役職向けヘルプコマンドの一覧です。",
            color=discord.Color.blue()
        )
        embed.add_field(name="💰 経済 / ユーザー用", value="・`/balance` - 所持金を確認します\n・`/pay <ユーザー> <金額>` - 他のユーザーにコインを送ります\n・`/rank` - レベル/経験値を確認します", inline=False)
        embed.add_field(name="📋 役職・役割向けヘルプ一覧", value="・`/評価員 help` - 評価の開始・確認方法など\n・`/面接官 help` - 面接官の入界手続きの処理について\n・`/賭博従業員 help` - ギャンブル設定・制限解除について\n・`/イベント help` - イベントの登録・修正・削除について", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    async def cog_load(self):
        self.bot.add_view(EmblemRequestPanelView())
        self.bot.add_view(ConfessionRequestPanelView())
        self.bot.add_view(TicketControlView())
        self.bot.add_view(InquiryRequestPanelView())
        self.bot.add_view(AnonymousChatPanelView())
        self.bot.add_view(CustomTicketPanelView())
        
        # コマンドグループの追加
        self.bot.tree.add_command(EventGroup(self.bot), override=True)

    async def cog_unload(self):
        self.bot.tree.remove_command("イベント")

    @commands.Cog.listener()
    async def on_guild_channel_delete(self, channel):
        await database.remove_inquiry_panel(channel.id)
        await database.remove_anonymous_chat(channel.id)
        await database.remove_custom_ticket_panel(channel.id)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        if not message.guild:
            return

        panel_channel_ids = await database.get_panel_channel_by_dest(message.channel.id)
        if panel_channel_ids:
            for panel_id in panel_channel_ids:
                panel_channel = self.bot.get_channel(panel_id) or await self.bot.fetch_channel(panel_id)
                if panel_channel:
                    embed = discord.Embed(
                        description=message.content,
                        color=discord.Color.green(),
                        timestamp=message.created_at
                    )
                    embed.set_author(name="運営メンバー")
                    
                    files = []
                    if message.attachments:
                        for att in message.attachments:
                            try:
                                file = await att.to_file()
                                files.append(file)
                            except:
                                pass
                                
                    await panel_channel.send(embed=embed, files=files)

async def setup(bot):
    await bot.add_cog(Utility(bot))
