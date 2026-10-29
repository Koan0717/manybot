import asyncio
import re
import unicodedata

import discord
from discord.ext import commands
from discord import app_commands
import database
from helpers import (
    get_setting, get_role_by_setting, get_new_member_roles, has_interviewer_role,
    NEW_MEMBER_ROLE_NAME, PENDING_MEMBER_ROLE_NAME, send_log
)

# 入界パネル（自己申告型）: 入界待機者が自分で「名前・よみかた」を入力し、文字の種類と被りに問題がなければ
# その場でロールの付け替えと初期発行まで行う。ダッシュボードの面接官設定で ON/OFF できる。
# 入界した人の名前・よみかたは interview_entries に残し、よみかたの被りと出戻りの判定に使う。

# 名前・よみかたは NFKC で揃えてから判定する（半角カナ・全角数字なども同じ文字として扱う）
# 名前: 漢字・ひらがな・カタカナ（ー を含む）・数字・「・」 / よみかた: ひらがな（伸ばし棒「ー」も可）
NAME_PATTERN = re.compile(r"^[0-9々ぁ-ゖゝゞァ-ヾ㐀-䶿一-鿿豈-﫿]+$")
READING_PATTERN = re.compile(r"^[ぁ-ゖゝゞー]+$")
NAME_RULE_TEXT = (
    "・名前に使えるのは「漢字・ひらがな・カタカナ・数字・『・』」だけです。\n"
    "・よみかたに使えるのは「ひらがな」だけです。\n"
    "（記号・特殊文字・英字・ハングル・空白は使えません）\n"
    "例: 名前「東京都・世田谷区」 よみかた「とうきょうとせたがやく」"
)

_ensured_pools = set()
# 名前の被り確認から入界完了までをサーバーごとに直列化し、同時に同じ名前で通らないようにする
_entry_locks: dict[int, asyncio.Lock] = {}


async def ensure_interview_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS interview_entries (
                guild_id BIGINT,
                user_id BIGINT,
                name TEXT NOT NULL DEFAULT '',
                reading TEXT,
                interviewer_id BIGINT,
                entered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            )
        ''')
    _ensured_pools.add(id(p))
    return p


async def get_entries(guild_id: int) -> list[dict]:
    p = await ensure_interview_schema(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch('SELECT user_id, name, reading FROM interview_entries WHERE guild_id = $1', guild_id)
    return [dict(r) for r in rows]


async def has_entry(guild_id: int, user_id: int) -> bool:
    p = await ensure_interview_schema(guild_id)
    async with p.acquire() as conn:
        return await conn.fetchval('SELECT 1 FROM interview_entries WHERE guild_id = $1 AND user_id = $2', guild_id, user_id) is not None


async def save_entry(guild_id: int, user_id: int, name: str, reading: str | None, interviewer_id: int | None):
    p = await ensure_interview_schema(guild_id)
    async with p.acquire() as conn:
        await conn.execute('''
            INSERT INTO interview_entries (guild_id, user_id, name, reading, interviewer_id, entered_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET
                name = EXCLUDED.name,
                reading = COALESCE(EXCLUDED.reading, interview_entries.reading),
                interviewer_id = EXCLUDED.interviewer_id,
                entered_at = EXCLUDED.entered_at
        ''', guild_id, user_id, name, reading, interviewer_id)


def normalize_name(text: str | None) -> str:
    return unicodedata.normalize("NFKC", text or "").strip()


def _name_key(text: str | None) -> str:
    return normalize_name(text).casefold()


def _to_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _id_list(value) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    return [i for i in (_to_int(v) for v in value) if i]


def is_self_apply_enabled(bot, guild_id: int) -> bool:
    return get_setting(bot, "INTERVIEW_SELF_APPLY_ENABLED", guild_id) not in (False, "false", "False", 0)


async def find_name_conflict(guild: discord.Guild, user: discord.Member, name: str, reading: str | None = None, pending_role: discord.Role | None = None) -> str | None:
    """名前・よみかたが完全一致で既に使われていれば、その説明を返す。

    名前はサーバー内のメンバー（入界待機者は除く）の表示名と比べる。
    よみかたは入界時に登録されたものと比べる（サーバーにいない人の登録は空いたものとして扱う）。"""
    key = _name_key(name)
    for member in guild.members:
        if member.id == user.id or member.bot:
            continue
        if pending_role and pending_role in member.roles:
            continue
        if key in {_name_key(member.nick), _name_key(member.display_name), _name_key(member.global_name), _name_key(member.name)}:
            return f"名前「{name}」は、すでにサーバー内で {member.mention} が使っています。"

    if reading:
        reading_key = _name_key(reading)
        for entry in await get_entries(guild.id):
            if entry["user_id"] == user.id or not entry.get("reading"):
                continue
            holder = guild.get_member(entry["user_id"])
            if holder and _name_key(entry["reading"]) == reading_key:
                return f"よみかた「{reading}」は、すでにサーバー内で {holder.mention}（{entry['name']}）が使っています。"
    return None


def _intro_embeds(member: discord.Member, text: str, posted_at) -> list[discord.Embed]:
    header = f"**{member.mention}（{member.display_name}）の自己紹介**"
    body = f"{header}\n\n{text}" if text else header
    chunks = [body[i:i + 4000] for i in range(0, len(body), 4000)] or [header]
    embeds = []
    for i, chunk in enumerate(chunks):
        embed = discord.Embed(description=chunk, color=discord.Color.teal())
        if i == 0:
            embed.set_author(name=member.display_name, icon_url=member.display_avatar.url)
            embed.set_thumbnail(url=member.display_avatar.url)
        if i == len(chunks) - 1:
            embed.set_footer(text=f"{member.name} / ID: {member.id}")
            embed.timestamp = posted_at
        embeds.append(embed)
    return embeds


async def repost_self_intro(bot, guild: discord.Guild, member: discord.Member) -> str | None:
    """入界した人の自己紹介を、アイコン付きのログ形式で転載先チャンネルに出し、元のメッセージを消す。

    転載元・転載先のどちらかが未設定なら何もしない（None を返す）。"""
    source_ids = _id_list(get_setting(bot, "INTERVIEW_INTRO_SOURCE_CHANNEL_IDS", guild.id))
    output_id = _to_int(get_setting(bot, "INTERVIEW_INTRO_OUTPUT_CHANNEL_ID", guild.id))
    if not source_ids or not output_id:
        return None

    output = guild.get_channel(output_id)
    if not output:
        try:
            output = await guild.fetch_channel(output_id)
        except discord.HTTPException:
            return "⚠️ 転載先チャンネルが見つからないため、転載していません"

    messages: list[discord.Message] = []
    for channel_id in source_ids:
        channel = guild.get_channel_or_thread(channel_id)
        if not channel:
            continue
        try:
            async for msg in channel.history(limit=200):
                if msg.author.id == member.id and (msg.content.strip() or msg.attachments):
                    messages.append(msg)
        except discord.HTTPException as e:
            print(f"[Interview] Failed to read self-intro channel {channel_id}: {e}")
    if not messages:
        return "ℹ️ 自己紹介が見つからなかったため、転載していません"

    messages.sort(key=lambda m: m.created_at)
    text = "\n\n".join(m.content.strip() for m in messages if m.content.strip())
    files = []
    for msg in messages:
        for attachment in msg.attachments:
            if len(files) >= 10:
                break
            try:
                files.append(await attachment.to_file())
            except discord.HTTPException:
                pass

    embeds = _intro_embeds(member, text, messages[0].created_at)
    try:
        # Embed は1メッセージ合計6000文字までなので、長文は1つずつ送る
        for i, embed in enumerate(embeds):
            await output.send(embed=embed, files=files if i == 0 else [], allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as e:
        return f"❌ 転載に失敗しました: {e}"

    deleted = 0
    for msg in messages:
        try:
            await msg.delete()
            deleted += 1
        except discord.HTTPException:
            pass
    if deleted < len(messages):
        return f"⚠️ {output.mention} に転載しましたが、元のメッセージ {len(messages) - deleted} 件を消せませんでした（Botの「メッセージの管理」権限を確認してください）"
    return f"✅ {output.mention} に転載し、元のメッセージ {deleted} 件を消しました"


async def complete_entry(bot, guild: discord.Guild, member: discord.Member, *, name: str, reading: str | None = None, interviewer: discord.Member | None = None) -> dict:
    """入界手続きの本体（名前変更・ロール付け替え・初期発行・記録・面接官ログ・自己紹介の転載）。

    出戻り（初期発行済み、または以前に入界の記録がある人）には初期通貨を配らず、面接官ログに配布失敗として残す。"""
    new_roles = get_new_member_roles(bot, guild)
    pending_role = get_role_by_setting(bot, guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
    reason = f"面接官入界許可 (面接官: {interviewer.display_name})" if interviewer else "入界手続き（自己申告）"
    currency_name = get_setting(bot, "CURRENCY_NAME", guild.id) or "コイン"
    result = {"roles_ok": True, "issued": None, "returnee": False, "intro": None}

    try:
        await member.edit(nick=name, reason=reason)
        result["nick"] = f"✅ 「{name}」に変更"
    except discord.Forbidden:
        result["nick"] = "⚠️ 権限不足のため変更できませんでした（Botの「ニックネームの管理」権限と、対象者のロール順位を確認してください）"
    except discord.HTTPException as e:
        result["nick"] = f"❌ 変更に失敗しました: {e}"

    roles_to_add = [r for r in new_roles if r not in member.roles]
    if roles_to_add:
        try:
            await member.add_roles(*roles_to_add, reason=reason)
            result["roles"] = "✅ " + "、".join(r.name for r in roles_to_add) + " を付与"
        except discord.HTTPException:
            result["roles_ok"] = False
            result["roles"] = "❌ 付与できませんでした（Botのロール順位と「ロールの管理」権限を確認してください）"
    else:
        result["roles"] = "✅ 付与済み"

    if pending_role and pending_role in member.roles and result["roles_ok"]:
        try:
            await member.remove_roles(pending_role, reason=reason)
            result["pending"] = f"✅ 「{pending_role.name}」を外しました"
        except discord.HTTPException:
            result["pending"] = f"⚠️ 「{pending_role.name}」を外せませんでした（Botのロールを上に移動してください）"
    elif pending_role and pending_role in member.roles:
        result["pending"] = "⏸️ ロール付与に失敗したため外していません"
    else:
        result["pending"] = "✅ 付いていません"

    if result["roles_ok"]:
        result["returnee"] = await database.check_initial_issued(guild.id, member.id) or await has_entry(guild.id, member.id)
        if not result["returnee"]:
            initial_coins = get_setting(bot, "INITIAL_COINS", guild.id) or 30000
            await database.add_balance(guild.id, member.id, initial_coins)
            await database.mark_initial_issued(guild.id, member.id)
            result["issued"] = initial_coins

            embed_log = discord.Embed(
                title="🪙 初期給与 (面接官許可)" if interviewer else "🪙 初期給与 (自己入界)",
                description="面接官による入界許可に伴い、初期給与が発行されました。" if interviewer else "新規ユーザーの自己入界手続きに伴い、初期給与が発行されました。",
                color=discord.Color.gold(),
                timestamp=discord.utils.utcnow()
            )
            if interviewer:
                embed_log.add_field(name="面接官", value=f"{interviewer.mention} ({interviewer.id})", inline=True)
            embed_log.add_field(name="対象者", value=f"{member.mention} ({member.id})", inline=True)
            embed_log.add_field(name="発行額", value=f"{initial_coins:,} {currency_name}", inline=True)
            await send_log(bot, guild, "currency", embed_log)

        await save_entry(guild.id, member.id, name, reading, interviewer.id if interviewer else None)
        result["intro"] = await repost_self_intro(bot, guild, member)

    balance = await database.get_balance(guild.id, member.id)
    result["balance"] = balance

    # 面接官ログ（ロールの付け替えができたか・初期発行・残高）
    embed = discord.Embed(
        title="📝 面接官アクション: 入界許可" if interviewer else "📝 入界手続き（自己申告）",
        description=("面接官による入界許可アクションが実行されました。" if interviewer else "入界パネルから自己申告で入界手続きが行われました。")
                    + ("" if result["roles_ok"] else "\n⚠️ **ロールの付け替えに失敗したため、手続きは完了していません。**"),
        color=discord.Color.purple() if result["roles_ok"] else discord.Color.red(),
        timestamp=discord.utils.utcnow()
    )
    if interviewer:
        embed.add_field(name="面接官", value=f"{interviewer.mention} (ID: {interviewer.id})", inline=False)
        embed.add_field(name="許可されたユーザー", value=f"{member.mention} (ID: {member.id})", inline=False)
    else:
        embed.add_field(name="対象者", value=f"{member.mention} (ID: {member.id})", inline=False)
    embed.add_field(name="名前", value=name, inline=True)
    if reading:
        embed.add_field(name="よみかた", value=reading, inline=True)
    embed.add_field(name="名前変更", value=result["nick"], inline=False)
    embed.add_field(name="ロール付与", value=result["roles"], inline=False)
    embed.add_field(name="待機ロール", value=result["pending"], inline=False)
    if result["issued"] is not None:
        embed.add_field(name="初期発行", value=f"✅ {result['issued']:,} {currency_name} を発行", inline=False)
    elif result["returnee"]:
        embed.add_field(name="初期発行", value="❌ 配布失敗：出戻り（初期発行済み・入界済み）のため配布していません", inline=False)
    else:
        embed.add_field(name="初期発行", value="⏸️ 手続きが完了していないため配布していません", inline=False)
    embed.add_field(name="現在の残高", value=f"{balance:,} {currency_name}", inline=False)
    if result["intro"]:
        embed.add_field(name="自己紹介の転載", value=result["intro"], inline=False)

    if interviewer and result["roles_ok"]:
        await database.add_interviewer_log(interviewer.id, member.id, guild.id)
        interviewer_count = await database.get_interviewer_count(interviewer.id, guild_id=guild.id)
        vc_name = "❌ VC未接続"
        if interviewer.voice and interviewer.voice.channel:
            vc_name = f"🔊 {interviewer.voice.channel.name}"
        embed.add_field(name="実行場所", value=vc_name, inline=True)
        embed.add_field(name="対応実績", value=f"累計 {interviewer_count} 人目の対応", inline=True)

    await send_log(bot, guild, "interviewer", embed)
    return result


def _role_preflight_error(guild: discord.Guild, new_roles: list[discord.Role], pending_role: discord.Role | None) -> str | None:
    me = guild.me
    if not me.guild_permissions.manage_roles:
        return (
            "❌ **Botの権限不足エラー**:\n"
            "Botに「**ロールの管理**」権限が付与されていません。\n"
            "サーバー設定 > ロール > Botのロール で「ロールの管理」権限をONにしてください。"
        )
    higher_roles = [r for r in new_roles if r >= me.top_role]
    if higher_roles:
        role_names = "、".join([f"「**{r.name}**」" for r in higher_roles])
        return (
            f"❌ **ロール順位エラー (403 Forbidden)**:\n"
            f"付与対象のロール {role_names} がBotの最上位ロール（**{me.top_role.name}**）以上の位置にあります。\n"
            f"Discordの【サーバー設定】>【ロール】一覧で、**Botのロールを付与対象ロールよりも上にドラッグして移動**してください。"
        )
    if pending_role and pending_role >= me.top_role:
        return (
            f"❌ **ロール順位エラー (403 Forbidden)**:\n"
            f"剥奪対象のロール「**{pending_role.name}**」がBotの最上位ロール（**{me.top_role.name}**）以上の位置にあります。\n"
            f"Discordの【サーバー設定】>【ロール】一覧で、**Botのロールを「{pending_role.name}」よりも上にドラッグして移動**してください。"
        )
    return None


SELF_APPLY_DISABLED_TEXT = "⏸️ 現在、自己申告での入界手続きは停止しています。面接官の案内をお待ちください。"


class InterviewEntryModal(discord.ui.Modal, title='入界手続き'):
    name_input = discord.ui.TextInput(label='名前', placeholder='例: 東京都・世田谷区', max_length=32, required=True)
    reading_input = discord.ui.TextInput(label='よみかた（ひらがな）', placeholder='例: とうきょうとせたがやく', max_length=64, required=True)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        guild = interaction.guild
        user = interaction.user
        if not guild or not isinstance(user, discord.Member):
            return await interaction.followup.send("❌ サーバー内で使ってください。", ephemeral=True)
        if not is_self_apply_enabled(bot, guild.id):
            return await interaction.followup.send(SELF_APPLY_DISABLED_TEXT, ephemeral=True)

        name = normalize_name(self.name_input.value)
        reading = normalize_name(self.reading_input.value)
        if not NAME_PATTERN.match(name):
            return await interaction.followup.send(f"❌ 名前「{name}」に使えない文字が含まれています。\n{NAME_RULE_TEXT}", ephemeral=True)
        if not READING_PATTERN.match(reading):
            return await interaction.followup.send(f"❌ よみかた「{reading}」はひらがなだけで入力してください。\n{NAME_RULE_TEXT}", ephemeral=True)

        new_roles = get_new_member_roles(bot, guild)
        pending_role = get_role_by_setting(bot, guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)
        if not new_roles:
            return await interaction.followup.send(f"❌ エラー: ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。", ephemeral=True)
        if all(r in user.roles for r in new_roles):
            return await interaction.followup.send("ℹ️ 既に手続きは完了しています。", ephemeral=True)
        error = _role_preflight_error(guild, new_roles, pending_role)
        if error:
            return await interaction.followup.send(error + "\nサーバー管理者にお問い合わせください。", ephemeral=True)

        try:
            async with _entry_locks.setdefault(guild.id, asyncio.Lock()):
                conflict = await find_name_conflict(guild, user, name, reading, pending_role)
                if conflict:
                    return await interaction.followup.send(f"❌ {conflict}\n別の名前・よみかたで、もう一度ボタンから申請してください。", ephemeral=True)
                result = await complete_entry(bot, guild, user, name=name, reading=reading)
        except Exception as e:
            return await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

        if not result["roles_ok"]:
            return await interaction.followup.send(f"❌ ロールの付与に失敗しました。サーバー管理者にお問い合わせください。\n{result['roles']}", ephemeral=True)

        currency_name = get_setting(bot, "CURRENCY_NAME", guild.id) or "コイン"
        coin_text = f"{result['issued']:,} {currency_name} を発行しました。" if result["issued"] is not None else "初期通貨は以前に受け取り済みのため、今回は発行していません。"
        await interaction.followup.send(f"✅ 完了！名前を「{name}」（{reading}）で登録しました。{coin_text}\n名前変更: {result['nick']}", ephemeral=True)
        try:
            await interaction.channel.send(
                f"✅ {user.mention} さんの入界手続きが完了しました！（名前: {name}）",
                allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False)
            )
        except discord.HTTPException:
            pass


class InterviewPanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="入界手続きを開始", style=discord.ButtonStyle.success, emoji="📝", custom_id="persistent_interview_btn")
    async def start_button(self, interaction, button):
        try:
            if interaction.guild and not is_self_apply_enabled(interaction.client, interaction.guild.id):
                return await interaction.response.send_message(SELF_APPLY_DISABLED_TEXT, ephemeral=True)
            await interaction.response.send_modal(InterviewEntryModal())
        except Exception as e:
            print(f"[Interview Error] {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ エラーが発生しました: {e}", ephemeral=True)
            else:
                await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)


async def post_interview_entry_panel(guild: discord.Guild, channel):
    """IPC・コマンドから呼ばれる: 入界パネル（自己申告型）を投稿する。"""
    embed = discord.Embed(
        title="📝 入界手続き",
        description="下のボタンを押して、サーバーで使う「名前」と「よみかた」を入力してください。\n"
                    "名前・よみかたがサーバー内の人と被っていなければ、そのまま入界手続きが完了します。\n\n" + NAME_RULE_TEXT,
        color=discord.Color.green()
    )
    await channel.send(embed=embed, view=InterviewPanelView())


class InterviewerGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="面接官", description="面接官専用コマンド")
        self.bot = bot

    @app_commands.command(name="help", description="面接官コマンドの使い方を表示します")
    async def show_help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🎤 面接官用コマンドの使い方",
            description="新規メンバーの入界手続きの処理を行うことができます。",
            color=discord.Color.blue()
        )
        embed.add_field(name="1. /面接官 入界許可実行", value="このチャンネルに名前を書き込んだ待機メンバーの入界手続き（仮ロール付与、初期通貨付与、ログ出力など）を完了します。出戻りの人には初期通貨を配りません。", inline=False)
        embed.add_field(name="2. /面接官 チャット削除 <件数>", value="チャンネル内のメッセージを指定された件数分、一括削除します。", inline=False)
        embed.add_field(name="3. /面接官 入界パネル", value="入界待機者が自分で名前・よみかたを入力して入界できるパネルを、このチャンネルに設置します（自己申告型がONのときだけ使えます）。", inline=False)
        embed.add_field(name="4. /面接官 告知パネル", value="時刻のボタンで入店の儀などの告知を送信できるパネルを、このチャンネルに設置します。", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="チャット削除", description="【面接官専用】チャンネル内のメッセージを指定された件数分、一括削除します")
    @app_commands.describe(count="削除するメッセージの件数")
    async def clear_chat(self, interaction: discord.Interaction, count: int):
        bot = self.bot
        if not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)

        if count <= 0:
            return await interaction.response.send_message("1以上の件数を指定してください。", ephemeral=True)

        await interaction.response.defer(ephemeral=True)

        # 権限チェック
        ch_perms = interaction.channel.permissions_for(interaction.guild.me)
        if not ch_perms.manage_messages:
            return await interaction.followup.send(
                "❌ エラー: Botにこのチャンネルの「メッセージの管理」権限がありません。\nチャンネル設定でBotに権限を付与してください。",
                ephemeral=True
            )

        try:
            deleted = await interaction.channel.purge(limit=count)
            await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send("❌ エラー: メッセージの削除権限がありません。", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ メッセージ削除中にエラーが発生しました: {e}", ephemeral=True)

    @app_commands.command(name="入界パネル", description="【面接官専用】名前・よみかたを入力して入界できるパネルをこのチャンネルに設置します")
    async def entry_panel(self, interaction: discord.Interaction):
        if not interaction.guild or not has_interviewer_role(self.bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        try:
            await post_interview_entry_panel(interaction.guild, interaction.channel)
        except discord.HTTPException as e:
            return await interaction.followup.send(f"❌ パネルを設置できませんでした: {e}", ephemeral=True)
        note = "" if is_self_apply_enabled(self.bot, interaction.guild.id) else "\n⚠️ 自己申告型がOFFのため、ONにするまでパネルは使えません（ダッシュボードの面接官設定で切り替えられます）。"
        await interaction.followup.send(f"✅ 入界パネルを設置しました。{note}", ephemeral=True)

    @app_commands.command(name="告知パネル", description="【面接官専用】入店の儀などの告知を送信するパネルをこのチャンネルに設置します")
    async def announce_panel(self, interaction: discord.Interaction):
        if not interaction.guild or not has_interviewer_role(self.bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        from cogs.interview_announce import post_announce_panel
        try:
            await post_announce_panel(self.bot, interaction.guild, interaction.channel)
        except discord.HTTPException as e:
            return await interaction.followup.send(f"❌ パネルを設置できませんでした: {e}", ephemeral=True)
        await interaction.followup.send("✅ 告知パネルを設置しました。", ephemeral=True)

    @app_commands.command(name="入界許可実行", description="【面接官専用】このチャンネルで名前を記入した待機メンバーの入界手続きを完了します")
    async def execute_interview(self, interaction: discord.Interaction):
        bot = self.bot
        if not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)

        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        me = guild.me

        new_roles = get_new_member_roles(bot, guild)
        pending_role = get_role_by_setting(bot, guild, "PENDING_MEMBER_ROLE_ID", PENDING_MEMBER_ROLE_NAME)

        if not new_roles:
            return await interaction.followup.send(f"❌ エラー: 付与対象ロール「{NEW_MEMBER_ROLE_NAME}」が見つかりません。ダッシュボードまたは設定を確認してください。", ephemeral=True)
        if not pending_role:
            return await interaction.followup.send(f"❌ エラー: 待機ロール「{PENDING_MEMBER_ROLE_NAME}」が見つかりません。ダッシュボードまたは設定を確認してください。", ephemeral=True)

        # 1. Botの権限 / 2. ロール順位（ヒエラルキー）チェック
        error = _role_preflight_error(guild, new_roles, pending_role)
        if error:
            return await interaction.followup.send(error, ephemeral=True)

        # 3. チャンネル閲覧・メッセージ履歴読み取り権限チェック
        ch_perms = interaction.channel.permissions_for(me)
        if not ch_perms.read_message_history:
            return await interaction.followup.send(
                "❌ **チャンネル権限エラー**:\n"
                "Botにこのチャンネルの「**メッセージ履歴を読む**」権限がありません。\n"
                "チャンネル設定またはカテゴリー設定でBotの権限を許可してください。",
                ephemeral=True
            )

        try:
            # --- チャンネル履歴から入界待機者とその希望する名前を自動取得 ---
            user = None
            proposed_nick = None
            try:
                async for message in interaction.channel.history(limit=50):
                    if not message.author.bot:
                        # discord.User の場合は Member オブジェクトに解決
                        member = message.author if isinstance(message.author, discord.Member) else guild.get_member(message.author.id)
                        if not member:
                            try:
                                member = await guild.fetch_member(message.author.id)
                            except Exception:
                                member = None

                        if member and pending_role in member.roles:
                            content = message.clean_content.strip() if hasattr(message, 'clean_content') else message.content.strip()
                            if content:
                                user = member
                                proposed_nick = content
                                break
            except discord.Forbidden:
                return await interaction.followup.send("❌ チャンネルのメッセージ履歴を取得できませんでした（権限不足）。", ephemeral=True)
            except Exception as e:
                print(f"[WARNING] Failed to fetch channel history: {e}")

            if not user:
                return await interaction.followup.send(
                    f"⚠️ チャンネル履歴（直近50件）から「{pending_role.name}」ロールを持ち、名前を書き込んだ入界待機者を見つけることができませんでした。",
                    ephemeral=True
                )

            if all(r in user.roles for r in new_roles):
                role_names = "、".join([f"「{r.name}」" for r in new_roles])
                return await interaction.followup.send(f"ℹ️ {user.display_name} は既に {role_names} が付与されており、手続き完了済みです。", ephemeral=True)

            proposed_nick = proposed_nick[:32]

            async with _entry_locks.setdefault(guild.id, asyncio.Lock()):
                # 重複ユーザーの検索 (対象ユーザー自身と、入界待ちロールを持っている人は除く)
                conflict = await find_name_conflict(guild, user, proposed_nick, pending_role=pending_role)
                if conflict:
                    try:
                        await interaction.channel.send(
                            f"⚠️ {user.mention} さんの希望した名前「{proposed_nick}」は、すでに鯖内で使用されている名前です。\n別の名前をこのチャンネルに記入してください。\n（※名前が記入されたら、面接官の方は再度コマンドを実行してください）"
                        )
                    except Exception as e:
                        print(f"[WARNING] Failed to send duplicate warning message to channel: {e}")

                    return await interaction.followup.send(f"⚠️ 名前が重複しているため、処理を中断しました。対象ユーザーに別の名前を記入してもらってから再実行してください。\n{conflict}", ephemeral=True)

                result = await complete_entry(bot, guild, user, name=proposed_nick, interviewer=interaction.user)

            if not result["roles_ok"]:
                return await interaction.followup.send(
                    f"❌ **ロール付与に失敗しました (403 Forbidden)**:\n"
                    f"Botのロール順位または「ロールの管理」権限を確認してください。\n"
                    f"サーバー設定 > ロール でBotのロール順位を上げてから再実行してください。",
                    ephemeral=True
                )

            currency_name = get_setting(bot, "CURRENCY_NAME", guild.id) or "コイン"
            if result["issued"] is not None:
                coin_text = f"（{result['issued']:,} {currency_name} 発行済み）"
            else:
                coin_text = "\n❌ 初期通貨の配布失敗：出戻り（初期発行済み）のため配布していません。"
            details = f"\n名前変更: {result['nick']}\n待機ロール: {result['pending']}\n現在の残高: {result['balance']:,} {currency_name}"
            if result["intro"]:
                details += f"\n自己紹介の転載: {result['intro']}"
            await interaction.followup.send(f"✅ {user.mention} の入界手続きを完了しました！{coin_text}{details}", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

class Interview(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(InterviewPanelView())
        self.bot.tree.add_command(InterviewerGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("面接官")

async def setup(bot):
    await bot.add_cog(Interview(bot))
