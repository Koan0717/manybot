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
                return await interaction.followup.send("❌ 通話募集を表示するチャンネル（募集一覧掲載チャンネル）がダッシュボードで設定されていません。", ephemeral=True)

            board_channel = guild.get_channel(int(board_channel_id))
            if not board_channel:
                try:
                    board_channel = await guild.fetch_channel(int(board_channel_id))
                except Exception:
                    pass

            if not board_channel:
                return await interaction.followup.send(f"❌ 募集表示チャンネル (ID: `{board_channel_id}`) が見つかりませんでした。", ephemeral=True)

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
            embed.set_footer(text="下の「参加申請する」ボタンを押すと募集者に申請が届きます。")

            join_view = CallBoardJoinView(recruiter_id=self.recruiter.id)
            await board_channel.send(embed=embed, view=join_view)

            await interaction.edit_original_response(content="✅ 通話募集の投稿が完了しました！募集一覧チャンネルをご確認ください。", embed=None, view=None)
            self.stop()
        except discord.Forbidden:
            await interaction.followup.send("❌ 募集表示チャンネルへのメッセージ送信権限がBotにありません。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] Call board confirm error: {e}")
            await interaction.followup.send(f"❌ 投稿処理中にエラーが発生しました: {e}", ephemeral=True)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary, emoji="❌")
    async def cancel_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(content="投稿をキャンセルしました。", embed=None, view=None)
        self.stop()


# --- 募集者DMに送られる「承諾 / 拒否」承認 View ---
class CallBoardApprovalView(discord.ui.View):
    def __init__(self, applicant_id: int, guild_id: int, board_channel_id: int, board_message_id: int):
        super().__init__(timeout=86400) # 24時間有効
        self.applicant_id = applicant_id
        self.guild_id = guild_id
        self.board_channel_id = board_channel_id
        self.board_message_id = board_message_id

    @discord.ui.button(label="✅ 承諾してVC作成", style=discord.ButtonStyle.success)
    async def accept_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()

        guild = interaction.client.get_guild(self.guild_id)
        if not guild:
            try:
                guild = await interaction.client.fetch_guild(self.guild_id)
            except Exception:
                pass

        if not guild:
            return await interaction.followup.send("❌ 該当サーバーが見つかりませんでした。", ephemeral=True)

        recruiter = interaction.user
        applicant = guild.get_member(self.applicant_id)
        if not applicant:
            try:
                applicant = await guild.fetch_member(self.applicant_id)
            except Exception:
                pass

        if not applicant:
            return await interaction.followup.send("❌ 申請者のメンバーが見つかりませんでした（脱退済みの可能性があります）。", ephemeral=True)

        # VCの作成処理
        settings = await database.get_call_board_settings(guild.id)
        vc_category_id = settings.get("vc_category_id")

        category = None
        if vc_category_id:
            category = guild.get_channel(int(vc_category_id))

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False, connect=False),
            recruiter: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True),
            applicant: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True),
        }

        # 管理者権限追加
        admin_role_ids = get_setting(interaction.client, "ADMIN_ROLE_IDS", guild.id)
        if admin_role_ids and isinstance(admin_role_ids, list):
            for r_id in admin_role_ids:
                try:
                    r = guild.get_role(int(r_id))
                    if r:
                        overwrites[r] = discord.PermissionOverwrite(view_channel=True, connect=True)
                except (ValueError, TypeError):
                    pass

        channel_name = f"📞 {recruiter.display_name} × {applicant.display_name}"
        try:
            vc = await guild.create_voice_channel(
                name=channel_name,
                category=category if isinstance(category, discord.CategoryChannel) else None,
                overwrites=overwrites,
                reason=f"通話募集マッチング: {recruiter.display_name} & {applicant.display_name}"
            )
        except Exception as e:
            return await interaction.followup.send(f"❌ VC作成に失敗しました: {e}", ephemeral=True)

        # 募集表示メッセージのボタンを「募集終了」に更新
        try:
            b_channel = guild.get_channel(self.board_channel_id)
            if b_channel:
                b_msg = await b_channel.fetch_message(self.board_message_id)
                if b_msg:
                    new_view = discord.ui.View()
                    dis_btn = discord.ui.Button(label="募集終了 (マッチング済み)", style=discord.ButtonStyle.secondary, disabled=True)
                    new_view.add_item(dis_btn)
                    await b_msg.edit(view=new_view)
        except Exception:
            pass

        # 作成されたプライベートVC内に案内送信
        try:
            await vc.send(
                f"🔔 {recruiter.mention} {applicant.mention}\n"
                f"**通話募集の申請が承諾されマッチングしました！**\n"
                f"このボイスチャンネルは当事者2人（と管理者）だけにしか見えないプライベート空間です。ご自由にお話しください！"
            )
        except Exception:
            pass

        # 申請者のDMに通知送信
        try:
            await applicant.send(
                f"🎉 **{recruiter.display_name}** さんがあなたの通話募集への参加申請を承諾しました！\n"
                f"専用プライベートVCが作成されました ➜ {vc.mention}"
            )
        except Exception:
            pass

        # DMメッセージの表示を完了に更新
        for item in self.children:
            item.disabled = True
        button.label = "✅ 承諾済み (VC作成完了)"
        await interaction.edit_original_response(content=f"✅ **{applicant.display_name}** さんの申請を承諾しました。専用VCを作成しました ➜ {vc.mention}", view=self)
        self.stop()

    @discord.ui.button(label="❌ 辞退・拒否", style=discord.ButtonStyle.danger)
    async def reject_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer()

        guild = interaction.client.get_guild(self.guild_id)
        applicant = None
        if guild:
            try:
                applicant = await guild.fetch_member(self.applicant_id)
            except Exception:
                pass

        if applicant:
            try:
                await applicant.send(f"✉️ 通話募集の申請につきまして、募集者の意向により今回は見送られました。")
            except Exception:
                pass

        for item in self.children:
            item.disabled = True
        button.label = "❌ 辞退済み"
        await interaction.edit_original_response(content="❌ 申請を辞退しました（募集はそのまま継続されます）。", view=self)
        self.stop()


# --- 募集Embedに付く「参加申請する」View (永続) ---
class CallBoardJoinView(discord.ui.View):
    def __init__(self, recruiter_id: int = None):
        super().__init__(timeout=None)
        self.recruiter_id = recruiter_id

    @discord.ui.button(label="📞 参加申請する", style=discord.ButtonStyle.primary, custom_id="persistent_call_board_join_btn")
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        if not guild:
            return await interaction.followup.send("❌ サーバー内で実行してください。", ephemeral=True)

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
            return await interaction.followup.send("❌ 自分の募集に申請することはできません。", ephemeral=True)

        recruiter = guild.get_member(recruiter_id)
        if not recruiter:
            try:
                recruiter = await guild.fetch_member(recruiter_id)
            except Exception:
                pass

        if not recruiter:
            return await interaction.followup.send("❌ 募集者がサーバー内に見つかりません。", ephemeral=True)

        applicant = interaction.user

        # 募集者のDMへ承認リクエストを送信
        approval_embed = discord.Embed(
            title="📩 通話募集の参加申請が届きました！",
            description=f"**{applicant.mention} (`{applicant.display_name}`)** さんがあなたの通話募集に参加を希望しています。",
            color=discord.Color.gold()
        )
        approval_embed.add_field(name="サーバー名", value=guild.name, inline=True)
        approval_embed.set_thumbnail(url=applicant.display_avatar.url if applicant.display_avatar else None)
        approval_embed.set_footer(text="「承諾」を押すと専用プライベートVCが自動作成されます。")

        approval_view = CallBoardApprovalView(
            applicant_id=applicant.id,
            guild_id=guild.id,
            board_channel_id=interaction.channel_id,
            board_message_id=interaction.message.id
        )

        dm_sent = False
        try:
            await recruiter.send(embed=approval_embed, view=approval_view)
            dm_sent = True
        except Exception:
            pass

        if dm_sent:
            await interaction.followup.send(
                f"✅ **{recruiter.display_name}** さんに参加申請を送信しました！\n"
                f"募集者が承諾するとプライベートVCが作成され、通知が届きます。",
                ephemeral=True
            )
        else:
            # DMが閉じられている場合のフォールバック: 募集チャンネルにメンション付き確認ボタン（エフェメラル）などを試みる
            await interaction.followup.send(
                f"⚠️ **{recruiter.display_name}** さんのDMが開かれていないためダイレクトメッセージで送れませんでした。\n"
                f"募集者のDM受信設定をご確認いただくか、直接声をおかけください。",
                ephemeral=True
            )


class CallBoard(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.deletion_tasks = {}  # {channel_id: asyncio.Task}
        # 永続Viewの登録
        self.bot.add_view(CallBoardPanelView())
        self.bot.add_view(CallBoardJoinView())

    async def delete_channel_after(self, channel: discord.VoiceChannel, delay: int = 180):
        try:
            await asyncio.sleep(delay)
            if len(channel.members) == 0:
                await channel.delete(reason="通話募集VC: 3分間誰も入っていないため自動削除")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[ERROR] Failed to auto-delete VC {channel.id}: {e}")
        finally:
            self.deletion_tasks.pop(channel.id, None)

    # VCの人数状態変更イベントリスナー (3分間無人で削除)
    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if before.channel and before.channel != after.channel:
            ch = before.channel
            if ch.name.startswith("📞 ") and len(ch.members) == 0:
                if ch.id not in self.deletion_tasks:
                    task = asyncio.create_task(self.delete_channel_after(ch, 180))
                    self.deletion_tasks[ch.id] = task

        if after.channel and after.channel != before.channel:
            ch = after.channel
            if ch.name.startswith("📞 ") and ch.id in self.deletion_tasks:
                task = self.deletion_tasks.pop(ch.id, None)
                if task:
                    task.cancel()


async def setup(bot):
    await bot.add_cog(CallBoard(bot))
