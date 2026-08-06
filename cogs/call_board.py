import discord
from discord.ext import commands
import database
import asyncio
from helpers import get_setting

# --- モーダル (目的・一言入力) ---
class CallBoardModal(discord.ui.Modal, title='📞 通話募集の入力'):
    purpose_input = discord.ui.TextInput(
        label='目的',
        placeholder='例: 雑談 / ゲーム(APEX) / 作業雑談 など',
        max_length=100,
        required=True
    )
    comment_input = discord.ui.TextInput(
        label='一言',
        placeholder='例: 誰でもどうぞ！ / 初心者歓迎です',
        style=discord.TextStyle.paragraph,
        max_length=300,
        required=False
    )

    async def on_submit(self, interaction: discord.Interaction):
        purpose = self.purpose_input.value.strip()
        comment = self.comment_input.value.strip() if self.comment_input.value else "なし"

        # 確認用 Embed (エフェメラル)
        embed = discord.Embed(
            title="🔍 通話募集内容の確認",
            description="以下の内容で募集を投稿します。よろしいですか？",
            color=discord.Color.gold()
        )
        embed.add_field(name="📌 目的", value=purpose, inline=False)
        embed.add_field(name="💬 一言", value=comment, inline=False)
        embed.set_footer(text="内容を確認し、「確定」ボタンを押してください。")

        view = CallBoardConfirmView(purpose=purpose, comment=comment, recruiter=interaction.user)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


# --- 投稿確定 / キャンセル View ---
class CallBoardConfirmView(discord.ui.View):
    def __init__(self, purpose: str, comment: str, recruiter: discord.Member):
        super().__init__(timeout=120)
        self.purpose = purpose
        self.comment = comment
        self.recruiter = recruiter

    @discord.ui.button(label="確定して投稿", style=discord.ButtonStyle.success, emoji="✅")
    async def confirm_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)

        try:
            guild = interaction.guild
            if not guild:
                return await interaction.followup.send("❌ サーバー内で実行してください。", ephemeral=True)

            # 設定の取得
            settings = await database.get_call_board_settings(guild.id)
            board_channel_id = settings.get("board_channel_id")
            if not board_channel_id:
                return await interaction.followup.send("❌ 通話募集を表示するチャンネル（募集一覧掲載チャンネル）がダッシュボードで設定されていません。ダッシュボードで設定を保存してください。", ephemeral=True)

            board_channel = guild.get_channel(int(board_channel_id))
            if not board_channel:
                try:
                    board_channel = await guild.fetch_channel(int(board_channel_id))
                except Exception:
                    pass

            if not board_channel:
                return await interaction.followup.send(f"❌ 募集表示チャンネル (ID: `{board_channel_id}`) が見つかりませんでした。Botにチャンネル閲覧権限があるか確認してください。", ephemeral=True)

            # 性別ロールの確認
            male_role_id = get_setting(interaction.client, "MALE_ROLE_ID", guild.id)
            female_role_id = get_setting(interaction.client, "FEMALE_ROLE_ID", guild.id)

            user_role_ids = [r.id for r in self.recruiter.roles]
            embed_color = discord.Color.blurple()

            try:
                if male_role_id and int(male_role_id) in user_role_ids:
                    embed_color = discord.Color.blue()
                elif female_role_id and int(female_role_id) in user_role_ids:
                    embed_color = discord.Color(0xFF69B4) # Hot Pink
            except (ValueError, TypeError):
                pass

            # 募集Embed作成
            embed = discord.Embed(
                title=f"📞 通話募集 | {self.recruiter.display_name}",
                color=embed_color,
                timestamp=discord.utils.utcnow()
            )
            if self.recruiter.display_avatar:
                embed.set_thumbnail(url=self.recruiter.display_avatar.url)
            embed.add_field(name="👤 募集者", value=f"{self.recruiter.mention} (`{self.recruiter.id}`)", inline=True)
            embed.add_field(name="📌 目的", value=self.purpose, inline=False)
            embed.add_field(name="💬 一言", value=self.comment, inline=False)
            embed.set_footer(text="下の「参加する」ボタンを押すと、専用プライベートVCが作成されます。")

            join_view = CallBoardJoinView(recruiter_id=self.recruiter.id)
            await board_channel.send(embed=embed, view=join_view)

            # 確認用メッセージを完了表示に更新
            await interaction.edit_original_response(content="✅ 通話募集の投稿が完了しました！募集一覧チャンネルをご確認ください。", embed=None, view=None)
            self.stop()
        except discord.Forbidden:
            await interaction.followup.send("❌ 募集表示チャンネルへのメッセージ送信権限（埋め込みリンク権限含む）がBotにありません。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] Call board confirm error: {e}")
            await interaction.followup.send(f"❌ 投稿処理中にエラーが発生しました: {e}", ephemeral=True)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="❌")
    async def cancel_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="投稿をキャンセルしました。", embed=None, view=None)
        self.stop()


# --- 募集Embedに付く「参加する」View (永続) ---
class CallBoardJoinView(discord.ui.View):
    def __init__(self, recruiter_id: int = None):
        super().__init__(timeout=None)
        self.recruiter_id = recruiter_id

    @discord.ui.button(label="📞 参加する", style=discord.ButtonStyle.primary, custom_id="persistent_call_board_join_btn")
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        if not guild:
            return await interaction.followup.send("サーバー内で実行してください。", ephemeral=True)

        # Embedから募集者のIDを取得
        recruiter_id = self.recruiter_id
        if not recruiter_id and interaction.message and interaction.message.embeds:
            embed = interaction.message.embeds[0]
            for field in embed.fields:
                if field.name == "👤 募集者" and "`" in field.value:
                    try:
                        recruiter_id = int(field.value.split("`")[1])
                    except ValueError:
                        pass

        if not recruiter_id:
            return await interaction.followup.send("❌ 募集者の情報を取得できませんでした。", ephemeral=True)

        if interaction.user.id == recruiter_id:
            return await interaction.followup.send("❌ 自分の募集に参加することはできません。", ephemeral=True)

        recruiter = guild.get_member(recruiter_id)
        if not recruiter:
            try:
                recruiter = await guild.fetch_member(recruiter_id)
            except Exception:
                pass

        if not recruiter:
            return await interaction.followup.send("❌ 募集者がサーバー内に見つかりません。", ephemeral=True)

        joiner = interaction.user

        # 設定の取得
        settings = await database.get_call_board_settings(guild.id)
        vc_category_id = settings.get("vc_category_id")

        category = None
        if vc_category_id:
            category = guild.get_channel(int(vc_category_id))

        # 権限の設定 (自分・相手・管理者以外には非表示)
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False, connect=False),
            recruiter: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True),
            joiner: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True),
        }

        # 管理者ロール権限追加
        admin_role_ids = get_setting(interaction.client, "ADMIN_ROLE_IDS", guild.id)
        if admin_role_ids and isinstance(admin_role_ids, list):
            for r_id in admin_role_ids:
                try:
                    r = guild.get_role(int(r_id))
                    if r:
                        overwrites[r] = discord.PermissionOverwrite(view_channel=True, connect=True)
                except (ValueError, TypeError):
                    pass

        # VCの作成
        channel_name = f"📞 {recruiter.display_name} × {joiner.display_name}"
        try:
            vc = await guild.create_voice_channel(
                name=channel_name,
                category=category if isinstance(category, discord.CategoryChannel) else None,
                overwrites=overwrites,
                reason=f"通話募集マッチング: {recruiter.display_name} & {joiner.display_name}"
            )
        except discord.Forbidden:
            return await interaction.followup.send("❌ ボイスチャンネルを作成する権限がBotにありません。", ephemeral=True)
        except Exception as e:
            return await interaction.followup.send(f"❌ VCの作成に失敗しました: {e}", ephemeral=True)

        # ボタンを無効化
        try:
            button.disabled = True
            button.label = "募集終了 (マッチング済み)"
            await interaction.message.edit(view=self)
        except Exception:
            pass

        # 案内通知 (ボタンを押した本人へエフェメラル送信)
        await interaction.followup.send(f"✅ マッチングしました！プライベートVCを作成しました: {vc.mention}", ephemeral=True)

        # 作成されたプライベートVC内のテキストチャットに送信 (当事者2人と管理者のみ閲覧可能)
        try:
            await vc.send(
                f"🔔 {recruiter.mention} {joiner.mention}\n"
                f"**通話募集がマッチングしました！**\n"
                f"このチャンネルは募集者と参加者の2人にしか見えないプライベート空間です。ご自由にお話しください！"
            )
        except Exception as e:
            print(f"[ERROR] Failed to send matching message inside VC: {e}")

        # 募集者のDMにも非公開で通知（募集者が気づけるように）
        try:
            await recruiter.send(
                f"🔔 **通話募集がマッチングしました！**\n"
                f"{joiner.mention} さんがあなたの通話募集に参加しました！専用VCが作成されました ➜ {vc.mention}"
            )
        except Exception:
            pass


async def delete_message_after(msg: discord.Message, delay: int):
    await asyncio.sleep(delay)
    try:
        await msg.delete()
    except Exception:
        pass


# --- パネルに設置されるボタンView (永続) ---
class CallBoardPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="📞 通話を募集する", style=discord.ButtonStyle.success, custom_id="persistent_call_board_panel_btn")
    async def panel_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(CallBoardModal())


class CallBoard(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # 永続Viewの登録
        self.bot.add_view(CallBoardPanelView())
        self.bot.add_view(CallBoardJoinView())

    # VCが空になったら自動削除するイベントリスナー
    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if before.channel and before.channel != after.channel:
            ch = before.channel
            if ch.name.startswith("📞 ") and len(ch.members) == 0:
                try:
                    await ch.delete(reason="通話募集VCの全員退出による自動削除")
                except Exception:
                    pass


async def setup(bot):
    await bot.add_cog(CallBoard(bot))
