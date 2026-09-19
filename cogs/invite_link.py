import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import get_setting, send_log

def format_duration(seconds: int) -> str:
    if not seconds or seconds <= 0:
        return '無期限'
    if seconds < 3600:
        return f'{seconds // 60}分'
    elif seconds < 86400:
        return f'{seconds // 3600}時間'
    else:
        return f'{seconds // 86400}日'

class InviteLinkPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label='招待リンクを発行する',
        style=discord.ButtonStyle.primary,
        emoji='🔗',
        custom_id='persistent_invite_link_btn'
    )
    async def generate_invite_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        if not guild:
            return await interaction.followup.send('❌ サーバー内で実行してください。', ephemeral=True)

        bot = interaction.client

        # 有効化チェック
        is_enabled = get_setting(bot, 'INVITE_LINK_ENABLED', guild.id)
        if str(is_enabled).lower() == 'false':
            return await interaction.followup.send('⚠️ 現在、このサーバーでは招待リンクの発行が無効化されています。', ephemeral=True)

        # 設定の取得
        max_uses_val = get_setting(bot, 'INVITE_LINK_MAX_USES', guild.id)
        max_age_val = get_setting(bot, 'INVITE_LINK_MAX_AGE', guild.id)
        channel_id_val = get_setting(bot, 'INVITE_LINK_CHANNEL_ID', guild.id)
        is_temp_val = get_setting(bot, 'INVITE_LINK_TEMPORARY', guild.id)

        try:
            max_uses = int(max_uses_val) if max_uses_val is not None else 0
        except (ValueError, TypeError):
            max_uses = 0

        try:
            max_age = int(max_age_val) if max_age_val is not None else 0
        except (ValueError, TypeError):
            max_age = 0

        temporary = str(is_temp_val).lower() == 'true'

        # 対象チャンネルの特定
        target_channel = None
        if channel_id_val:
            try:
                target_channel = guild.get_channel(int(channel_id_val))
            except (ValueError, TypeError):
                target_channel = None

        if not target_channel:
            target_channel = guild.system_channel

        if not target_channel and isinstance(interaction.channel, (discord.TextChannel, discord.VoiceChannel)):
            target_channel = interaction.channel

        if not target_channel:
            for ch in guild.text_channels:
                if ch.permissions_for(guild.me).create_instant_invite:
                    target_channel = ch
                    break

        if not target_channel:
            return await interaction.followup.send('❌ 招待を作成可能なチャンネルが見つかりませんでした。管理者にお問い合わせください。', ephemeral=True)

        # 権限チェック
        perms = target_channel.permissions_for(guild.me)
        if not perms.create_instant_invite:
            return await interaction.followup.send(f'❌ Botに #{target_channel.name} での招待リンク作成権限がありません。', ephemeral=True)

        # 招待URLの生成
        try:
            invite = await target_channel.create_invite(
                max_age=max_age,
                max_uses=max_uses,
                temporary=temporary,
                unique=True,
                reason=f'{interaction.user} (ID: {interaction.user.id}) による招待リンク発行'
            )
        except Exception as e:
            print(f'[InviteLink] Error creating invite for guild {guild.id}: {e}')
            return await interaction.followup.send(f'❌ 招待リンクの作成に失敗しました: {e}', ephemeral=True)

        # 参加ログで「誰のリンクか」を表示するため、発行者を記録する
        # (invite.inviter はBot自身になるため)
        try:
            await database.save_invite_issuer(guild.id, invite.code, interaction.user.id)
        except Exception as e:
            print(f'[InviteLink] Failed to save invite issuer for {invite.code}: {e}')

        # DM送信用のEmbed作成
        limit_text = f'{max_uses}回' if max_uses > 0 else '無制限'
        age_text = format_duration(max_age)

        dm_embed = discord.Embed(
            title=f'✉️ 【{guild.name}】招待リンク',
            description=f'サーバーへの招待リンクを発行しました。\n以下のリンクをコピーして共有してください。\n\n**{invite.url}**',
            color=discord.Color.blue()
        )
        dm_embed.add_field(name='📌 対象チャンネル', value=f'#{target_channel.name}', inline=True)
        dm_embed.add_field(name='⏳ 有効期限', value=age_text, inline=True)
        dm_embed.add_field(name='🔢 使用回数上限', value=limit_text, inline=True)
        if temporary:
            dm_embed.add_field(name='⚠️ メンバーシップ', value='一時的メンバー（ロール未付与で切断時にキック）', inline=False)
        dm_embed.set_footer(text=f'発行者: {interaction.user.display_name}')

        dm_sent = False
        try:
            await interaction.user.send(embed=dm_embed)
            dm_sent = True
        except discord.Forbidden:
            dm_sent = False
        except Exception as e:
            print(f'[InviteLink] Failed to send DM to {interaction.user.id}: {e}')
            dm_sent = False

        if dm_sent:
            await interaction.followup.send('✅ あなたのDMにサーバーの招待リンクをお送りしました！ご確認ください。', ephemeral=True)
        else:
            await interaction.followup.send(
                f'⚠️ DMを送信できませんでした。サーバーからのDM受信許可をご確認ください。\n\n'
                f'**発行された招待リンク:** {invite.url}\n'
                f'(有効期限: {age_text} / 使用回数: {limit_text})',
                ephemeral=True
            )


class InviteLinkCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.bot.add_view(InviteLinkPanelView())

    @app_commands.command(name='invite_panel', description='招待リンク発行パネルを設置します（管理者専用）')
    @app_commands.describe(channel='パネルを設置するチャンネル（指定しない場合は現在のチャンネル）')
    @app_commands.default_permissions(administrator=True)
    async def invite_panel(self, interaction: discord.Interaction, channel: discord.TextChannel = None):
        target_ch = channel or interaction.channel
        if not target_ch:
            return await interaction.response.send_message('❌ チャンネルが指定されていません。', ephemeral=True)

        embed = discord.Embed(
            title='🔗 サーバー招待リンク発行',
            description='下のボタンを押すと、あなた専用のサーバー招待リンクがDMに送られます。\nお友達をサーバーに招待する際にご利用ください！',
            color=discord.Color.blue()
        )
        embed.set_footer(text=f'{interaction.guild.name} 公式')

        view = InviteLinkPanelView()
        try:
            await target_ch.send(embed=embed, view=view)
            await interaction.response.send_message(f'✅ #{target_ch.name} に招待リンク発行パネルを設置しました！', ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message(f'❌ #{target_ch.name} への送信権限がありません。', ephemeral=True)
        except Exception as e:
            await interaction.response.send_message(f'❌ パネルの送信に失敗しました: {e}', ephemeral=True)


async def setup(bot):
    await bot.add_cog(InviteLinkCog(bot))
