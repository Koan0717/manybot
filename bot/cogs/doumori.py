"""
どう森機能（doumori リポジトリの「どうぶつの森林 Bot」を ManyBot に移植したもの）

浮上（VC・チャット）でチケット → ショップで道具 → 釣り・虫捕りで図鑑 → ダブりを売却して鯖内通貨、
マイル・デイリーミッション・階級・住民カード・総合操作パネルなど。

- データはサーバーごとのDB（database.get_pool）。テーブルは doumori/db.py が自動作成する
- サーバーごとに「どう森機能」を ON にしたサーバーだけで動く（ダッシュボードの どう森BOT → 基本設定）
- 売却で得られる通貨は ManyBot の鯖内通貨（users.balance）
"""
import datetime
import random
import re
import time

import discord
from discord import app_commands
from discord.ext import commands

import database
from doumori import db
from doumori.data import BUG_LIST, FISH_LIST
from helpers import get_setting

FOOTER = "🍃 どうぶつの森林"
ALL_CREATURES = {c["id"]: c for c in FISH_LIST + BUG_LIST}
CATEGORY = {
    "fish": {"list": FISH_LIST, "name": "魚", "item": "fishing_rod", "item_name": "つりざお", "emoji": "🎣"},
    "bug": {"list": BUG_LIST, "name": "虫", "item": "bug_net", "item_name": "虫取り網", "emoji": "🦋"},
}
RARITY_COLORS = {"RARE": "#3498DB", "SUPER_RARE": "#9B59B6", "LEGENDARY": "#F1C40F"}
SLOT_EMOJIS = [
    "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟",
    "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
    "㉑", "㉒", "㉓", "㉔", "㉕", "㉖", "㉗", "㉘", "㉙", "㉚",
]
DISABLED_MESSAGE = (
    "🍃 このサーバーではどう森機能が有効になっていません。\n"
    "運営の方はダッシュボードの「どう森BOT」→ 基本設定で有効にしてください。"
)


# ───────────────────────── 共通ヘルパー ─────────────────────────

def color_of(hex_text: str, default: int = 0x2ECC71) -> discord.Color:
    try:
        return discord.Color(int(str(hex_text).lstrip("#"), 16))
    except (TypeError, ValueError):
        return discord.Color(default)


def base_embed(title: str, description: str = None, color: str = "#2ECC71") -> discord.Embed:
    embed = discord.Embed(title=title, description=description, color=color_of(color))
    embed.set_footer(text=FOOTER)
    embed.timestamp = discord.utils.utcnow()
    return embed


def progress_bar(current: int, total: int, length: int = 10) -> str:
    total = max(1, total)
    percent = max(0, min(100, current * 100 // total))
    filled = max(0, min(length, round(length * current / total)))
    return f"`[{'█' * filled}{'░' * (length - filled)}]` **{percent}%** ({current}/{total})"


def currency_name(bot, guild_id: int) -> str:
    try:
        return get_setting(bot, "CURRENCY_NAME", guild_id) or "コイン"
    except Exception:
        return "コイン"


def _strip_symbols(name: str) -> str:
    return re.sub(r"^[^\w]+", "", name.strip())


def resolve_rank(member, default_level: int, ranks: list[dict]) -> dict:
    """メンバーの「新規住人 / 住人 / 常連住人 / 人気住人」ロールから階級を判定する（ロールが無ければ DB の階級）"""
    if isinstance(member, discord.Member):
        names = [r.name for r in member.roles]

        def find(pred):
            return next((n for n in names if pred(n)), None)

        hit = find(lambda n: "人気住人" in n or "人気住民" in n)
        if hit:
            return {"level": 4, "name": "🌟 人気住人", "color": "#FFD700"}
        hit = find(lambda n: "常連住人" in n or "常連住民" in n)
        if hit:
            return {"level": 3, "name": "☕ 常連住人", "color": "#E67E22"}
        hit = find(lambda n: "新規住人" in n or "新規住民" in n)
        if hit:
            return {"level": 1, "name": "🌱 新規住人", "color": "#A8E6CF"}

        def is_citizen(n):
            if any(k in n for k in ("新規", "常連", "人気")) or ("住人" not in n and "住民" not in n):
                return False
            return _strip_symbols(n) in ("住人", "住民", "住人ロール", "住民ロール")

        if find(is_citizen):
            return {"level": 2, "name": "🏠 住人", "color": "#3498DB"}

    rank = next((r for r in ranks if r["level"] == default_level), ranks[0] if ranks else None)
    if not rank:
        return {"level": 1, "name": "🌱 新規住人", "color": "#A8E6CF"}
    return {"level": rank["level"], "name": rank["name"], "color": rank["color"]}


async def check_permission(member, guild_id: int, perm_type: str = "admin") -> bool:
    """サーバー管理者・管理者ロール、または機能ごとの担当ロールを持っているか"""
    if not isinstance(member, discord.Member):
        return False
    perms = member.guild_permissions
    if perms.administrator or perms.manage_guild:
        return True
    if perm_type == "mission_staff" and perms.manage_messages:
        return True
    settings = await db.get_settings(guild_id)
    role_ids = {str(r.id) for r in member.roles}

    def has(key):
        values = settings.get(key) or []
        return isinstance(values, list) and any(str(v) in role_ids for v in values)

    if has("admin_role_ids"):
        return True
    key = {"mile_grant": "mile_grant_role_ids", "ticket_grant": "ticket_grant_role_ids",
           "mission_staff": "mission_staff_role_ids"}.get(perm_type)
    return bool(key and has(key))


async def defer(interaction: discord.Interaction, ephemeral: bool):
    if not interaction.response.is_done():
        await interaction.response.defer(ephemeral=ephemeral, thinking=True)


async def send(interaction: discord.Interaction, ephemeral: bool = False, **kwargs):
    if interaction.response.is_done():
        return await interaction.followup.send(ephemeral=ephemeral, wait=True, **kwargs)
    await interaction.response.send_message(ephemeral=ephemeral, **kwargs)
    return await interaction.original_response()


async def resident_card_embed(guild: discord.Guild, user: discord.abc.User, member=None) -> discord.Embed:
    miles = await db.get_user_miles(guild.id, user.id)
    ranks = await db.get_ranks(guild.id)
    rank = resolve_rank(member, miles["rank_level"] or 1, ranks)
    embed = base_embed("🃏 住民カード", "━━━━━━━━━━━━━━━━━━", rank["color"])
    embed.set_thumbnail(url=user.display_avatar.url)
    embed.add_field(name="👤 名前", value=f"**{user.display_name}**", inline=True)
    embed.add_field(name="⭐ 階級", value=f"**{rank['name']}**", inline=True)
    embed.add_field(name="📈 ミッション達成", value=f"**＋{miles['mission_count'] or 0}** 回", inline=True)
    embed.add_field(name="💰 ポイント (マイル)", value=f"**{(miles['miles'] or 0):,}** pt", inline=True)
    embed.add_field(name="🏆 累計ミッション", value=f"**{miles['total_mission_count'] or 0}** 回", inline=True)
    embed.set_footer(text=f"ステップアップ住民証 | 住民ID: {user.id}")
    return embed


async def award_completion_role(guild: discord.Guild, member, category: str, settings: dict) -> str | None:
    """図鑑を全種そろえたら限定ロールを作成・付与する。付与したロール名を返す"""
    if not isinstance(member, discord.Member):
        return None
    caught = {c["creature_id"] for c in await db.get_collection(guild.id, member.id, category)}
    if len(caught) < len(CATEGORY[category]["list"]):
        return None
    name = str(settings.get(f"{category}_completion_role_name") or db.DEFAULT_SETTINGS[f"{category}_completion_role_name"])
    try:
        role = discord.utils.get(guild.roles, name=name)
        if role is None:
            role = await guild.create_role(
                name=name, color=color_of(settings.get(f"{category}_completion_role_color"), 0xFFD700),
                hoist=True, reason=f"図鑑コンプリート自動報酬ロール ({category})",
            )
        if role not in member.roles:
            await member.add_roles(role, reason="図鑑コンプリート")
            return name
    except discord.HTTPException as e:
        print(f"[Doumori] completion role failed ({category}): {e}")
    return None


# ───────────────────────── 操作パネル・承認ボタン ─────────────────────────

PANEL_BUTTONS = [
    # (key, label, style, row)
    ("fish", "🎣 魚を釣る", discord.ButtonStyle.primary, 0),
    ("bug", "🦋 虫を捕まえる", discord.ButtonStyle.success, 0),
    ("shop", "🏪 タヌキショップ", discord.ButtonStyle.secondary, 0),
    ("miles", "🌟 マイル確認", discord.ButtonStyle.primary, 1),
    ("mission", "📅 ミッション", discord.ButtonStyle.success, 1),
    ("diy", "🛠️ DIY作業台", discord.ButtonStyle.secondary, 1),
    ("rankup", "⬆️ 階級アップ", discord.ButtonStyle.danger, 1),
    ("fishbook", "📖 魚図鑑", discord.ButtonStyle.primary, 2),
    ("bugbook", "📖 虫図鑑", discord.ButtonStyle.success, 2),
    ("exchange", "🔀 両替", discord.ButtonStyle.secondary, 2),
    ("sell", "💰 ダブり売却", discord.ButtonStyle.danger, 2),
    ("card", "🃏 住民カード", discord.ButtonStyle.primary, 3),
    ("profile", "📊 プロフィール", discord.ButtonStyle.secondary, 3),
    ("leaderboard", "🏆 ランキング", discord.ButtonStyle.secondary, 3),
    ("help", "❓ ヘルプ", discord.ButtonStyle.secondary, 3),
]
PANEL_CUSTOM_ID = "doumori:panel:{}"


class DoumoriPanelView(discord.ui.View):
    """総合操作パネル。Bot が再起動してもボタンが動くよう custom_id を固定する"""

    def __init__(self):
        super().__init__(timeout=None)
        for key, label, style, row in PANEL_BUTTONS:
            button = discord.ui.Button(label=label, style=style, row=row, custom_id=PANEL_CUSTOM_ID.format(key))
            button.callback = self._make_callback(key)
            self.add_item(button)

    @staticmethod
    def _make_callback(key: str):
        async def callback(interaction: discord.Interaction):
            cog = interaction.client.get_cog("Doumori")
            if cog:
                await cog.run_panel_action(interaction, key)
        return callback


def build_panel_embed(title: str, color: str) -> discord.Embed:
    embed = base_embed(
        title or db.DEFAULT_SETTINGS["panel_title"],
        "下のボタンを押すだけで、採集・図鑑・マイルポイント・ランクアップなどの全機能が手軽に使えます！",
        color or "#2ECC71",
    )
    embed.add_field(name="🎣 🦋 採集＆ショップ", value=(
        "・**【魚を釣る】**: つりざおを消費して釣る\n"
        "・**【虫を捕まえる】**: 虫取り網を消費して捕まえる\n"
        "・**【タヌキショップ】**: マイルでチケット購入＆道具交換"), inline=False)
    embed.add_field(name="🌟 📅 🛠️ ⬆️ マイル＆階級ステップアップ", value=(
        "・**【マイル確認】**: 現在のマイルと階級状態を確認\n"
        "・**【ミッション】**: 今日の階級別デイリーミッションを確認\n"
        "・**【DIY作業台】**: 週1回のイベント開催告知でマイル獲得\n"
        "・**【階級アップ】**: マイルを消費して次の階級に昇格！"), inline=False)
    embed.add_field(name="📖 🔀 💰 図鑑・両替・売却", value=(
        "・**【魚図鑑】/【虫図鑑】**: 各図鑑と完成率を確認\n"
        "・**【両替】**: マイルを図鑑チケットに両替\n"
        "・**【ダブり売却】**: 重複した生き物をまとめて鯖内通貨に換金"), inline=False)
    embed.add_field(name="🃏 📊 🏆 ❓ 住民カード・プロフ・ランキング・ヘルプ", value=(
        "・**【住民カード】**: 階級・ミッション達成回数・ポイント証を表示\n"
        "・**【プロフィール】**: 自分の持ち物や図鑑完成率を確認\n"
        "・**【ランキング】**: サーバー内完成率 Top 10\n"
        "・**【ヘルプ】**: 遊び方ガイドを表示"), inline=False)
    return embed


class ApproveMissionButton(discord.ui.DynamicItem[discord.ui.Button], template=r"doumori:approve:(?P<uid>\d+):(?P<date>\d{4}-\d{2}-\d{2}):(?P<slot>\d+)"):
    """ミッション報告の承認ボタン。Bot が再起動しても押せるよう、対象を custom_id に持たせる"""

    def __init__(self, user_id: int, date_key: str, slot: int, label: str = "✅ 承認する"):
        super().__init__(discord.ui.Button(
            label=label, style=discord.ButtonStyle.success,
            custom_id=f"doumori:approve:{user_id}:{date_key}:{slot}",
        ))
        self.user_id, self.date_key, self.slot = user_id, date_key, slot

    @classmethod
    async def from_custom_id(cls, interaction, item, match: re.Match):
        return cls(int(match["uid"]), match["date"], int(match["slot"]))

    async def callback(self, interaction: discord.Interaction):
        cog = interaction.client.get_cog("Doumori")
        if cog:
            await cog.approve_mission(interaction, self.user_id, self.date_key, self.slot)


def done_button(label: str) -> discord.ui.View:
    view = discord.ui.View()
    view.add_item(discord.ui.Button(label=label, style=discord.ButtonStyle.secondary, disabled=True))
    return view


# ───────────────────────── 本人だけが押せるビュー ─────────────────────────

class OwnerView(discord.ui.View):
    def __init__(self, owner_id: int, timeout: float):
        super().__init__(timeout=timeout)
        self.owner_id = owner_id
        self.message: discord.Message | None = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await interaction.response.send_message("⚠️ コマンドを実行した本人だけが操作できます。", ephemeral=True)
            return False
        return True

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass


class BookView(OwnerView):
    def __init__(self, owner_id: int, pages: list[discord.Embed]):
        super().__init__(owner_id, timeout=120)
        self.pages, self.page = pages, 0
        self._sync()

    def _sync(self):
        self.prev.disabled = self.page == 0
        self.next.disabled = self.page >= len(self.pages) - 1

    @discord.ui.button(label="◀️ 前のページ", style=discord.ButtonStyle.secondary)
    async def prev(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.page = max(0, self.page - 1)
        self._sync()
        await interaction.response.edit_message(embed=self.pages[self.page], view=self)

    @discord.ui.button(label="次のページ ▶️", style=discord.ButtonStyle.secondary)
    async def next(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.page = min(len(self.pages) - 1, self.page + 1)
        self._sync()
        await interaction.response.edit_message(embed=self.pages[self.page], view=self)


class ShopView(OwnerView):
    def __init__(self, cog: "Doumori", owner_id: int, guild_id: int):
        super().__init__(owner_id, timeout=60)
        self.cog, self.guild_id = cog, guild_id

    async def refresh(self, interaction: discord.Interaction, notice: str = ""):
        embed, state = await self.cog.shop_state(self.guild_id, self.owner_id, notice)
        rate, rod_price, net_price = state["rate"], state["rod_price"], state["net_price"]
        self.buy1.label = f"🎫 チケット×1購入 ({rate}pt)"
        self.buy5.label = f"🎫 チケット×5購入 ({rate * 5}pt)"
        self.rod.label = f"🐟 つりざおを交換 ({rod_price}枚)"
        self.net.label = f"🦋 虫取り網を交換 ({net_price}枚)"
        self.buy1.disabled = state["miles"] < rate
        self.buy5.disabled = state["miles"] < rate * 5
        self.rod.disabled = state["tickets"] < rod_price
        self.net.disabled = state["tickets"] < net_price
        if interaction.response.is_done():
            await interaction.edit_original_response(embed=embed, view=self)
        else:
            await interaction.response.edit_message(embed=embed, view=self)
        return embed

    async def _buy_tickets(self, interaction: discord.Interaction, count: int):
        rate = (await self.cog.shop_prices(self.guild_id))[0]
        result = await db.buy_tickets_with_miles(self.guild_id, self.owner_id, count, rate)
        if not result["success"]:
            await interaction.response.send_message(
                f"⚠️ マイルポイントが不足しています！（必要: {result['needed']}pt / 所持: {result['current']}pt）", ephemeral=True)
            return
        await self.refresh(interaction, f"✅ **{result['spent']}** pt を消費して **図鑑チケット ×{result['count']}** を購入しました！")

    async def _buy_item(self, interaction: discord.Interaction, item_id: str):
        _, rod_price, net_price = await self.cog.shop_prices(self.guild_id)
        price = rod_price if item_id == "fishing_rod" else net_price
        if await db.spend_tickets(self.guild_id, self.owner_id, price) is None:
            await interaction.response.send_message("⚠️ 図鑑チケットが不足しています！", ephemeral=True)
            return
        await db.add_item(self.guild_id, self.owner_id, item_id, 1)
        name = "🐟 つりざお" if item_id == "fishing_rod" else "🦋 虫取り網"
        await self.refresh(interaction, f"✅ **{name}** を1つ交換しました！")

    @discord.ui.button(label="🎫 チケット×1購入", style=discord.ButtonStyle.secondary, row=0)
    async def buy1(self, interaction, button):
        await self._buy_tickets(interaction, 1)

    @discord.ui.button(label="🎫 チケット×5購入", style=discord.ButtonStyle.secondary, row=0)
    async def buy5(self, interaction, button):
        await self._buy_tickets(interaction, 5)

    @discord.ui.button(label="🐟 つりざおを交換", style=discord.ButtonStyle.primary, row=1)
    async def rod(self, interaction, button):
        await self._buy_item(interaction, "fishing_rod")

    @discord.ui.button(label="🦋 虫取り網を交換", style=discord.ButtonStyle.success, row=1)
    async def net(self, interaction, button):
        await self._buy_item(interaction, "bug_net")


class ExchangeView(OwnerView):
    def __init__(self, cog: "Doumori", owner_id: int, guild_id: int, rate: int, miles: int):
        super().__init__(owner_id, timeout=60)
        self.cog, self.guild_id, self.rate = cog, guild_id, rate
        for count, style in ((1, discord.ButtonStyle.primary), (5, discord.ButtonStyle.primary), (10, discord.ButtonStyle.secondary)):
            button = discord.ui.Button(label=f"🎫 チケット×{count}に両替 ({rate * count:,}pt)", style=style)
            button.callback = self._make(count)
            self.add_item(button)
        self._sync(miles)

    def _sync(self, miles: int):
        for button, count in zip(self.children, (1, 5, 10)):
            button.disabled = miles < self.rate * count

    def _make(self, count: int):
        async def callback(interaction: discord.Interaction):
            result = await db.buy_tickets_with_miles(self.guild_id, self.owner_id, count, self.rate)
            if result["success"]:
                notice = f"✅ **{result['spent']:,}** pt を両替して **図鑑チケット ×{result['count']}** を入手しました！"
            else:
                notice = f"⚠️ **マイルが不足しています**（必要: {result['needed']:,}pt / 所持: {result['current']:,}pt）"
            embed, miles = await self.cog.exchange_embed(self.guild_id, self.owner_id, self.rate, notice)
            self._sync(miles)
            await interaction.response.edit_message(embed=embed, view=self)
        return callback


class DiyModal(discord.ui.Modal, title="🛠️ DIY作業台 - イベント開催"):
    event_title = discord.ui.TextInput(label="イベントのタイトル", max_length=100)
    details = discord.ui.TextInput(label="開催日時・ルール・内容", style=discord.TextStyle.paragraph, max_length=1500)

    def __init__(self, cog: "Doumori"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        await self.cog.do_diy(interaction, str(self.event_title), str(self.details))


# ───────────────────────── 設定パネル（/設定パネル） ─────────────────────────

def _roles_text(ids) -> str:
    if not isinstance(ids, list) or not ids:
        return "*(未設定 - サーバー管理者のみ許可)*"
    return " ".join(f"<@&{i}>" for i in ids)


def _channel_text(cid) -> str:
    return f"<#{cid}>" if cid else "*(未設定)*"


DEST_LABELS = {"dm": "📩 メンバーのDM", "channel": "📢 指定チャンネル", "last_channel": "💬 最後に発言したチャンネル"}
ROLE_SETTINGS = {
    "admin_role_ids": ("👑 管理者ロール", "Botのすべての権限（設定変更、全コマンド操作）を持つロール"),
    "mile_grant_role_ids": ("🌟 マイル付与ロール", "`/マイル付与` `/マイル没収` を実行できるスタッフロール"),
    "ticket_grant_role_ids": ("🎫 チケット付与ロール", "`/チケット付与` `/チケット没収` を実行できるスタッフロール"),
    "mission_staff_role_ids": ("📸 ミッション承認スタッフロール", "ミッション報告の承認ボタンを押せるロール"),
}


class SettingsPanelView(OwnerView):
    def __init__(self, owner_id: int, guild_id: int):
        super().__init__(owner_id, timeout=900)
        self.guild_id = guild_id

    async def show_main(self, interaction: discord.Interaction, notice: str = None):
        await self._render(interaction, await self.build_main(), notice)

    async def build_main(self) -> discord.Embed:
        """メイン画面の表示内容とメニューを用意する"""
        s = await db.get_settings(self.guild_id)
        notify = "🔔 有効 (ON)" if db.as_bool(s.get("ticket_notify_enabled")) else "🔕 無効 (OFF)"
        dest = s.get("ticket_notify_destination") or "last_channel"
        dest_text = DEST_LABELS.get(dest, DEST_LABELS["last_channel"])
        if dest == "channel":
            dest_text += f" ({_channel_text(s.get('ticket_notify_channel_id'))})"
        embed = base_embed(
            "⚙️ どうぶつの森林 - サーバー設定パネル",
            "Botの各種ロール権限や浮上通知先を設定できます。下のメニューから設定したい項目を選んでください。\n"
            "*(※デイリーミッション枠数などはダッシュボードから設定できます)*",
        )
        for key, (label, _) in ROLE_SETTINGS.items():
            embed.add_field(name=label, value=_roles_text(s.get(key)), inline=False)
        embed.add_field(name="🎫 浮上特典通知設定", value=f"状態: **{notify}**\n送信先: **{dest_text}**", inline=True)
        embed.add_field(name="📸 ミッション報告受付チャンネル", value=_channel_text(s.get("mission_report_channel_id")), inline=True)

        self.clear_items()
        select = discord.ui.Select(placeholder="⚙️ 設定する項目を選択してください", options=[
            *(discord.SelectOption(label=label, value=key, description=desc[:100]) for key, (label, desc) in ROLE_SETTINGS.items()),
            discord.SelectOption(label="📢 通知・報告チャンネル設定", value="notify", description="チケット獲得通知やミッション報告のチャンネル"),
        ])
        select.callback = self._on_category
        self.add_item(select)
        return embed

    async def _render(self, interaction, embed, notice=None):
        if interaction.response.is_done():
            await interaction.edit_original_response(content=notice, embed=embed, view=self)
        else:
            await interaction.response.edit_message(content=notice, embed=embed, view=self)

    def _back_button(self):
        back = discord.ui.Button(label="🔙 メイン設定に戻る", style=discord.ButtonStyle.secondary, row=4)

        async def go_back(interaction):
            await self.show_main(interaction)
        back.callback = go_back
        return back

    async def _on_category(self, interaction: discord.Interaction):
        value = interaction.data["values"][0]
        if value == "notify":
            await self.show_notify(interaction)
            return
        s = await db.get_settings(self.guild_id)
        label, desc = ROLE_SETTINGS[value]
        embed = base_embed(label + "設定", f"**{desc}を設定します。**\n\n現在のロール: {_roles_text(s.get(value))}\n\n"
                           "※ 下のメニューから選んでください（すべて外すと未設定になります）。", "#F1C40F")
        self.clear_items()
        select = discord.ui.RoleSelect(placeholder=f"{label}を選択（複数選択可）", min_values=0, max_values=25)

        async def on_roles(i: discord.Interaction):
            await db.save_settings(self.guild_id, {value: [str(r.id) for r in select.values]})
            await self.show_main(i, "✅ **ロール設定を保存しました！**")
        select.callback = on_roles
        self.add_item(select)
        self.add_item(self._back_button())
        await self._render(interaction, embed)

    async def show_notify(self, interaction: discord.Interaction, notice: str = None):
        s = await db.get_settings(self.guild_id)
        enabled = db.as_bool(s.get("ticket_notify_enabled"))
        dest = s.get("ticket_notify_destination") or "last_channel"
        embed = base_embed(
            "📢 浮上通知＆報告チャンネル設定",
            "**浮上特典（図鑑チケット）の獲得通知やミッション報告チャンネルを設定します。**\n\n"
            f"・**通知の送信状態**: **{'🔔 有効' if enabled else '🔕 無効'}**\n"
            f"・**通知メッセージの送信先**: **{DEST_LABELS.get(dest, DEST_LABELS['last_channel'])}**"
            f"{' (' + _channel_text(s.get('ticket_notify_channel_id')) + ')' if dest == 'channel' else ''}\n"
            f"・**ミッション報告受付チャンネル**: {_channel_text(s.get('mission_report_channel_id'))}",
            "#34495E",
        )
        self.clear_items()

        toggle = discord.ui.Button(label="🔕 通知をOFFにする" if enabled else "🔔 通知をONにする",
                                   style=discord.ButtonStyle.danger if enabled else discord.ButtonStyle.success, row=0)

        async def on_toggle(i):
            await db.save_settings(self.guild_id, {"ticket_notify_enabled": not enabled})
            await self.show_notify(i, f"✅ **浮上特典通知を {'【無効 (OFF)】' if enabled else '【有効 (ON)】'} に変更しました！**")
        toggle.callback = on_toggle
        self.add_item(toggle)
        back = self._back_button()
        back.row = 0
        self.add_item(back)

        dest_select = discord.ui.Select(row=1, placeholder="送信先を選択", options=[
            discord.SelectOption(label=label, value=key, default=(key == dest)) for key, label in DEST_LABELS.items()
        ])

        async def on_dest(i):
            await db.save_settings(self.guild_id, {"ticket_notify_destination": i.data["values"][0]})
            await self.show_notify(i, "✅ **通知の送信先を更新しました！**")
        dest_select.callback = on_dest
        self.add_item(dest_select)

        types = [discord.ChannelType.text, discord.ChannelType.news]
        for row, key, placeholder in ((2, "ticket_notify_channel_id", "🎫 チケット獲得通知チャンネル（指定チャンネル用）"),
                                      (3, "mission_report_channel_id", "📸 ミッション報告受付チャンネル")):
            ch = discord.ui.ChannelSelect(row=row, placeholder=placeholder, channel_types=types)

            async def on_channel(i, ch=ch, key=key):
                await db.save_settings(self.guild_id, {key: str(ch.values[0].id)})
                await self.show_notify(i, "✅ **チャンネル設定を保存しました！**")
            ch.callback = on_channel
            self.add_item(ch)
        await self._render(interaction, embed, notice)


# ───────────────────────── Cog ─────────────────────────

class Doumori(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.vc_join_times: dict[tuple[int, int], float] = {}
        self.chat_cooldowns: dict[tuple[int, int], float] = {}
        self.last_channels: dict[tuple[int, int], int] = {}
        self._enabled_cache: dict[int, tuple[bool, float]] = {}

    async def cog_load(self):
        self.bot.add_view(DoumoriPanelView())
        self.bot.add_dynamic_items(ApproveMissionButton)

    async def cog_unload(self):
        self.bot.remove_dynamic_items(ApproveMissionButton)

    # ── 有効チェック ──
    async def enabled(self, guild_id: int, cached: bool = False) -> bool:
        if cached:
            hit = self._enabled_cache.get(guild_id)
            if hit and time.monotonic() - hit[1] < 60:
                return hit[0]
        value = await db.is_enabled(guild_id)
        self._enabled_cache[guild_id] = (value, time.monotonic())
        return value

    async def guard(self, interaction: discord.Interaction) -> bool:
        if not interaction.guild:
            await send(interaction, ephemeral=True, content="サーバー内で使ってください。")
            return False
        if not await self.enabled(interaction.guild.id):
            await send(interaction, ephemeral=True, content=DISABLED_MESSAGE)
            return False
        return True

    # ── パネルのボタン ──
    async def run_panel_action(self, interaction: discord.Interaction, key: str):
        if not await self.guard(interaction):
            return
        try:
            if key == "diy":
                await interaction.response.send_modal(DiyModal(self))
                return
            if key in ("fish", "bug"):
                await self.do_gather(interaction, key, ephemeral=True)
            elif key in ("fishbook", "bugbook"):
                await self.do_book(interaction, key[:-4])
            else:
                handler = {
                    "shop": self.do_shop, "miles": self.do_miles, "mission": self.do_mission,
                    "rankup": self.do_rankup, "exchange": self.do_exchange, "sell": self.do_sell,
                    "card": self.do_card, "profile": self.do_profile, "leaderboard": self.do_leaderboard,
                    "help": self.do_help,
                }[key]
                if key == "rankup":
                    await handler(interaction, ephemeral=True)
                elif key in ("card", "profile"):
                    await handler(interaction, None)
                elif key == "exchange":
                    await handler(interaction, None)
                elif key == "leaderboard":
                    await handler(interaction, ephemeral=True)
                else:
                    await handler(interaction)
        except Exception as e:
            print(f"[Doumori] panel action {key} failed: {e!r}")
            try:
                await send(interaction, ephemeral=True, content=f"❌ 操作処理中にエラーが発生しました: `{e}`")
            except discord.HTTPException:
                pass

    # ═════════════ 採集 ═════════════
    @app_commands.command(name="釣り", description="つりざおを1つ消費して魚を釣ります🎣")
    @app_commands.guild_only()
    async def fish_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_gather(interaction, "fish", ephemeral=True)

    @app_commands.command(name="虫捕り", description="虫取り網を1つ消費して虫を捕まえます🦋")
    @app_commands.guild_only()
    async def bug_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_gather(interaction, "bug", ephemeral=True)

    async def do_gather(self, interaction: discord.Interaction, category: str, ephemeral: bool):
        await defer(interaction, ephemeral)
        guild, user = interaction.guild, interaction.user
        meta = CATEGORY[category]
        if not await db.use_item(guild.id, user.id, meta["item"]):
            await send(interaction, ephemeral=ephemeral, embed=base_embed(
                f"{meta['emoji']} {meta['item_name']}がありません！",
                f"{meta['name']}を{'釣る' if category == 'fish' else '捕まえる'}には **{meta['item_name']}** が必要です。\n"
                f"`/ショップ`（または操作パネル）で図鑑チケットを使って{meta['item_name']}を交換してください！",
                "#E74C3C"))
            return

        settings = await db.get_settings(guild.id)
        hour = datetime.datetime.now(db.JST).hour
        time_filter = "day" if 6 <= hour < 18 else "night"
        candidates = [c for c in meta["list"] if c["time"] in ("all", time_filter)]
        caught = random.choices(candidates, weights=[c["weight"] for c in candidates], k=1)[0]
        shiny_percent = db.as_float(settings.get("shiny_chance_percent"), 0.5)
        is_shiny = random.random() < shiny_percent / 100
        is_new = await db.record_catch(guild.id, user.id, category, caught["id"], is_shiny)
        role_name = await award_completion_role(guild, interaction.user, category, settings)

        color = "#FFD700" if is_shiny else RARITY_COLORS.get(caught["rarity"], "#2ECC71")
        name = f"✨ 【金色・色違い】金色の{caught['name']}" if is_shiny else caught["name"]
        verb = "釣り上げました" if category == "fish" else "ゲットしました"
        embed = base_embed(
            f"{'🎣 魚が釣れました' if category == 'fish' else '🦋 虫を捕まえました'}！ {caught['emoji']}",
            f"**{name}** を{verb}！\n\n*{caught['desc']}*", color)
        embed.add_field(name="レア度", value=f"`{caught['rarity']}`", inline=True)
        embed.add_field(name="図鑑登録", value="🌟 **NEW! (初GET)**" if is_new else "✅ 登録済み", inline=True)
        if is_shiny:
            embed.add_field(name="✨ 超激レア！", value=f"{shiny_percent:g}% の確率で出現する金色個体です！大発見！", inline=False)
        extra = ""
        if role_name:
            extra = f"\n\n🏆 **【コンプリート達成！】** {meta['name']}図鑑をすべて埋めました！限定ロール **「{role_name}」** を付与しました！"
        await send(interaction, ephemeral=ephemeral,
                   content=f"{user.mention} さんの{'釣果' if category == 'fish' else '成果'}です！{extra}", embed=embed)

    # ═════════════ 図鑑 ═════════════
    @app_commands.command(name="魚図鑑", description="魚図鑑と図鑑達成率を確認します🐟")
    @app_commands.guild_only()
    async def fishbook_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_book(interaction, "fish")

    @app_commands.command(name="虫図鑑", description="虫図鑑と図鑑達成率を確認します🦋")
    @app_commands.guild_only()
    async def bugbook_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_book(interaction, "bug")

    async def do_book(self, interaction: discord.Interaction, category: str):
        await defer(interaction, True)
        guild, user = interaction.guild, interaction.user
        creatures = CATEGORY[category]["list"]
        caught = {c["creature_id"]: c for c in await db.get_collection(guild.id, user.id, category)}
        settings = await db.get_settings(guild.id)
        page_size = max(1, min(25, db.as_int(settings.get("book_page_size"), 10)))
        title = "📖 魚図鑑 (Fish Book)" if category == "fish" else "📖 虫図鑑 (Bug Book)"
        color = "#3498DB" if category == "fish" else "#2ECC71"
        total_pages = (len(creatures) + page_size - 1) // page_size

        pages = []
        for page in range(total_pages):
            embed = base_embed(title, f"収集状況: {progress_bar(len(caught), len(creatures))}", color)
            for idx, c in enumerate(creatures[page * page_size:(page + 1) * page_size], start=page * page_size + 1):
                data = caught.get(c["id"])
                if data:
                    shiny = " ✨ [金色]" if data["has_shiny"] else ""
                    embed.add_field(name=f"#{idx:02d} {c['emoji']} {c['name']}{shiny}",
                                    value=f"レア度: `{c['rarity']}` | 捕獲数: **{data['count']}** 匹\n*{c['desc']}*", inline=False)
                else:
                    embed.add_field(name=f"#{idx:02d} ❓ ？？？", value=f"レア度: `{c['rarity']}` | 未入手", inline=False)
            embed.set_footer(text=f"ページ {page + 1} / {total_pages} | {FOOTER}")
            pages.append(embed)

        if total_pages <= 1:
            await send(interaction, ephemeral=True, embed=pages[0])
            return
        view = BookView(user.id, pages)
        view.message = await send(interaction, ephemeral=True, embed=pages[0], view=view)

    # ═════════════ ショップ・両替・売却 ═════════════
    async def shop_prices(self, guild_id: int) -> tuple[int, int, int]:
        s = await db.get_settings(guild_id)
        return (max(1, db.as_int(s.get("miles_per_ticket"), 100)),
                max(1, db.as_int(s.get("fishing_rod_price"), 1)),
                max(1, db.as_int(s.get("bug_net_price"), 1)))

    async def shop_state(self, guild_id: int, user_id: int, notice: str = ""):
        rate, rod_price, net_price = await self.shop_prices(guild_id)
        user = await db.get_user(guild_id, user_id)
        miles = (await db.get_user_miles(guild_id, user_id))["miles"] or 0
        rods = await db.get_item_count(guild_id, user_id, "fishing_rod")
        nets = await db.get_item_count(guild_id, user_id, "bug_net")
        tickets = user["tickets"] or 0
        intro = ("所持している **マイルポイント** でチケットを購入したり、**図鑑チケット** を使って採集道具と交換できます！\n"
                 "※道具は1回使用すると消費されます。")
        embed = base_embed("🏪 タヌキ商店＆案内所 - ショップ", f"{notice}\n\n{intro}" if notice else intro)
        embed.add_field(name="💰 残高情報", value=f"・🌟 **所持マイル**: **{miles:,}** pt\n・🎫 **所持チケット**: **{tickets}** 枚", inline=False)
        embed.add_field(name="🎫 チケット購入 (マイル交換)", value=f"・図鑑チケット ×1 ({rate}pt)\n・図鑑チケット ×5 ({rate * 5}pt)", inline=True)
        embed.add_field(name="🎒 採集道具 (チケット交換)",
                        value=f"・🐟 つりざお ({rod_price}枚) [所持: **{rods}** 本]\n・🦋 虫取り網 ({net_price}枚) [所持: **{nets}** 本]", inline=True)
        return embed, {"rate": rate, "rod_price": rod_price, "net_price": net_price, "miles": miles, "tickets": tickets}

    @app_commands.command(name="ショップ", description="マイルでチケットを購入したり、チケットで道具（つりざお・虫取り網）を交換します🏪")
    @app_commands.guild_only()
    async def shop_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_shop(interaction)

    async def do_shop(self, interaction: discord.Interaction):
        await defer(interaction, True)
        view = ShopView(self, interaction.user.id, interaction.guild.id)
        embed, state = await self.shop_state(interaction.guild.id, interaction.user.id)
        view.buy1.label, view.buy5.label = f"🎫 チケット×1購入 ({state['rate']}pt)", f"🎫 チケット×5購入 ({state['rate'] * 5}pt)"
        view.rod.label, view.net.label = f"🐟 つりざおを交換 ({state['rod_price']}枚)", f"🦋 虫取り網を交換 ({state['net_price']}枚)"
        view.buy1.disabled = state["miles"] < state["rate"]
        view.buy5.disabled = state["miles"] < state["rate"] * 5
        view.rod.disabled = state["tickets"] < state["rod_price"]
        view.net.disabled = state["tickets"] < state["net_price"]
        view.message = await send(interaction, ephemeral=True, embed=embed, view=view)

    async def exchange_embed(self, guild_id: int, user_id: int, rate: int, notice: str = ""):
        miles = (await db.get_user_miles(guild_id, user_id))["miles"] or 0
        tickets = (await db.get_user(guild_id, user_id))["tickets"] or 0
        body = f"・🌟 **{rate} マイル** ➔ 🎫 **図鑑チケット ×1**\n\n下のボタンを押すと指定枚数に両替できます。"
        if not notice:
            body = "マイルポイントを図鑑チケットに両替します！\n\n" + body + "\n*(※任意の枚数は `/両替 amount:[枚数]`)*"
        embed = base_embed("🔀 案内所両替所 - マイル両替", f"{notice}\n\n{body}" if notice else body, "#3498DB")
        embed.add_field(name="🌟 所持マイル", value=f"**{miles:,}** pt", inline=True)
        embed.add_field(name="🎫 所持チケット", value=f"**{tickets}** 枚", inline=True)
        return embed, miles

    @app_commands.command(name="両替", description="マイルポイントを図鑑チケットに両替します🔀")
    @app_commands.describe(amount="両替するチケット枚数（省略するとボタンで選べます）")
    @app_commands.guild_only()
    async def exchange_cmd(self, interaction: discord.Interaction, amount: app_commands.Range[int, 1, 1000] = None):
        if await self.guard(interaction):
            await self.do_exchange(interaction, amount)

    async def do_exchange(self, interaction: discord.Interaction, amount: int | None):
        await defer(interaction, True)
        guild_id, user_id = interaction.guild.id, interaction.user.id
        rate = (await self.shop_prices(guild_id))[0]
        if amount:
            result = await db.buy_tickets_with_miles(guild_id, user_id, amount, rate)
            if not result["success"]:
                await send(interaction, ephemeral=True, embed=base_embed(
                    "⚠️ マイルポイント不足",
                    f"図鑑チケット **{amount}** 枚と両替するには **{result['needed']:,}** pt が必要です。\n"
                    f"（現在の所持マイル: **{result['current']:,}** pt）", "#E74C3C"))
                return
            embed = base_embed("🔀 マイル両替完了！",
                               f"**{result['spent']:,}** pt を両替して、**図鑑チケット ×{result['count']}** を入手しました！")
            embed.add_field(name="🎫 所持チケット", value=f"**{result['new_tickets']}** 枚", inline=True)
            embed.add_field(name="🌟 所持マイル", value=f"**{result['new_miles']:,}** pt", inline=True)
            await send(interaction, ephemeral=True, embed=embed)
            return
        embed, miles = await self.exchange_embed(guild_id, user_id, rate)
        view = ExchangeView(self, user_id, guild_id, rate, miles)
        view.message = await send(interaction, ephemeral=True, embed=embed, view=view)

    @app_commands.command(name="売却", description="重複した生き物（2匹目以降）を売却して鯖内通貨に換金します💰")
    @app_commands.guild_only()
    async def sell_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_sell(interaction)

    async def do_sell(self, interaction: discord.Interaction):
        await defer(interaction, True)
        guild_id, user_id = interaction.guild.id, interaction.user.id
        currency = currency_name(self.bot, guild_id)
        rows = await db.take_duplicates(guild_id, user_id)
        if not rows:
            await send(interaction, ephemeral=True, embed=base_embed(
                "💰 たぬき売却処 - 売却アイテムなし",
                "売却できる重複した生き物（2匹以上捕まえた生き物）がありません！\n`/釣り` や `/虫捕り` でたくさん採集しましょう！",
                "#E74C3C"))
            return
        s = await db.get_settings(guild_id)
        multiplier = db.as_int(s.get("sell_price_shiny_multiplier"), 5)
        total = sold = 0
        for r in rows:
            info = ALL_CREATURES.get(r["creature_id"])
            if not info:
                continue
            base = db.as_int(s.get(f"sell_price_{info['rarity'].lower()}"), 100)
            unit = base * multiplier if r["has_shiny"] else base
            excess = r["old_count"] - 1
            total += unit * excess
            sold += excess
        if total > 0:
            await database.add_balance(guild_id, user_id, total)
        balance = await database.get_balance(guild_id, user_id)
        embed = base_embed("💰 たぬき売却処 - 売却完了！",
                           f"重複した生き物 **合計 {sold} 匹** を売却し、**{total:,}** {currency} を手に入れました！🪙", "#F1C40F")
        embed.add_field(name=f"🪙 鯖内通貨 ({currency}残高)", value=f"**{balance:,}** {currency}", inline=False)
        await send(interaction, ephemeral=True, embed=embed)

    # ═════════════ プロフィール・カード・ランキング・ヘルプ ═════════════
    @app_commands.command(name="プロフィール", description="自分の図鑑収集状況・チケット・所持アイテムを確認します📊")
    @app_commands.describe(user="確認したいユーザー（省略時は自分）")
    @app_commands.guild_only()
    async def profile_cmd(self, interaction: discord.Interaction, user: discord.Member = None):
        if await self.guard(interaction):
            await self.do_profile(interaction, user)

    async def do_profile(self, interaction: discord.Interaction, target: discord.Member | None):
        await defer(interaction, True)
        guild_id = interaction.guild.id
        target = target or interaction.user
        data = await db.get_user(guild_id, target.id)
        miles = (await db.get_user_miles(guild_id, target.id))["miles"] or 0
        balance = await database.get_balance(guild_id, target.id)
        rods = await db.get_item_count(guild_id, target.id, "fishing_rod")
        nets = await db.get_item_count(guild_id, target.id, "bug_net")
        fish = await db.get_collection(guild_id, target.id, "fish")
        bugs = await db.get_collection(guild_id, target.id, "bug")
        currency = currency_name(self.bot, guild_id)
        embed = base_embed(f"📊 住民プロフィール - {target.display_name}", "どうぶつの森林の冒険者データです。")
        embed.set_thumbnail(url=target.display_avatar.url)
        embed.add_field(name="🌟 所持マイル", value=f"**{miles:,}** pt", inline=True)
        embed.add_field(name="🎫 所持チケット", value=f"**{data['tickets'] or 0}** 枚", inline=True)
        embed.add_field(name=f"🪙 鯖内通貨 ({currency})", value=f"**{balance:,}** {currency}", inline=True)
        embed.add_field(name="⏱️ 通算浮上時間", value=f"**{(data['vc_total_seconds'] or 0) / 3600:.1f}** 時間", inline=True)
        embed.add_field(name="🎒 所持道具", value=f"・つりざお: **{rods}** 本\n・虫取り網: **{nets}** 本", inline=False)
        embed.add_field(name="🐟 魚図鑑達成率", value=progress_bar(len(fish), len(FISH_LIST)), inline=False)
        embed.add_field(name="🦋 虫図鑑達成率", value=progress_bar(len(bugs), len(BUG_LIST)), inline=False)
        await send(interaction, ephemeral=True, embed=embed)

    @app_commands.command(name="住民カード", description="現在の階級・ミッション達成回数・ポイント等の【住民カード】を表示します🃏")
    @app_commands.describe(user="確認したい住民（省略時は自分）")
    @app_commands.guild_only()
    async def card_cmd(self, interaction: discord.Interaction, user: discord.Member = None):
        if await self.guard(interaction):
            await self.do_card(interaction, user)

    @app_commands.command(name="マイル残高", description="現在の所持マイルポイントや住民カード情報を確認します🌟")
    @app_commands.describe(user="確認したい住民（省略時は自分）")
    @app_commands.guild_only()
    async def mile_balance_cmd(self, interaction: discord.Interaction, user: discord.Member = None):
        if await self.guard(interaction):
            await self.do_card(interaction, user)

    async def do_card(self, interaction: discord.Interaction, target: discord.Member | None):
        await defer(interaction, True)
        target = target or interaction.user
        await send(interaction, ephemeral=True, embed=await resident_card_embed(interaction.guild, target, target))

    @app_commands.command(name="ランキング", description="サーバー内の図鑑完成率ランキングを表示します🏆")
    @app_commands.guild_only()
    async def leaderboard_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_leaderboard(interaction, ephemeral=False)

    async def do_leaderboard(self, interaction: discord.Interaction, ephemeral: bool):
        await defer(interaction, ephemeral)
        total = len(FISH_LIST) + len(BUG_LIST)
        rows = await db.get_leaderboard(interaction.guild.id)
        embed = base_embed("🏆 図鑑完成率 ランキング Top 10", None, "#FFD700")
        if not rows:
            embed.description = "まだ図鑑に登録された生き物がありません！最初に採集してみましょう！"
        else:
            medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
            embed.description = "\n".join(
                f"{medals[i]} <@{r['user_id']}> — **{r['caught_types']}** / {total} 種 (`{r['caught_types'] * 100 // total}%`)"
                for i, r in enumerate(rows)
            )
        await send(interaction, ephemeral=ephemeral, embed=embed)

    @app_commands.command(name="ヘルプ", description="どうぶつの森林のコマンド一覧と遊び方を表示します📖")
    @app_commands.guild_only()
    async def help_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_help(interaction)

    async def do_help(self, interaction: discord.Interaction):
        currency = currency_name(self.bot, interaction.guild.id)
        embed = base_embed("📖 どうぶつの森林 - ヘルプ＆ガイド",
                           "Discordサーバーで浮上してチケットを集め、魚や虫を捕まえて図鑑を完成させよう！")
        embed.add_field(name="🔄 ゲームの基本フロー", value=(
            "① **VCやチャットで浮上 / ミッション達成** ➔ チケットや「マイルポイント」を獲得！\n"
            "② **`/ショップ` / `/両替`** ➔ マイルで「図鑑チケット」を購入し、「つりざお」や「虫取り網」に交換\n"
            "③ **`/釣り` / `/虫捕り`** ➔ 生き物を採集（まれに✨金色個体が出現！）\n"
            f"④ **`/売却`** ➔ ダブった生き物を売却して鯖内通貨「{currency}」を獲得！\n"
            "⑤ **図鑑コンプ** ➔ 限定ゴールドロールを獲得！"), inline=False)
        embed.add_field(name="🎣 🦋 採集＆ショップ・売却", value=(
            "・`/釣り` `/虫捕り` — 道具を1つ消費して採集\n"
            "・`/ショップ` — マイルでチケット購入 ＆ 道具交換\n"
            "・`/両替` — マイルを図鑑チケットに両替\n"
            "・`/売却` — 重複した生き物を売却"), inline=False)
        embed.add_field(name="🃏 🌟 📅 ⬆️ 住民カード・マイル・階級", value=(
            "・`/住民カード` — 階級・ミッション達成回数・ポイント\n"
            "・`/マイル` / `/マイル残高` — 所持マイルと階級ステータス\n"
            "・`/デイリーミッション` — 本日のミッション\n"
            "・`/ミッション報告` — スクショで報告（スタッフ承認でマイル付与）\n"
            "・`/ランクアップ` — マイルを消費して次の階級へ\n"
            "・`/diy作業台` — 週1回のイベント告知でマイル獲得"), inline=False)
        embed.add_field(name="📖 📊 🏆 🛠️ 図鑑・プロフ・パネル・管理", value=(
            "・`/魚図鑑` `/虫図鑑` — 図鑑と完成率\n"
            "・`/プロフィール` — 所持品と完成率\n"
            "・`/ランキング` — 図鑑完成率 Top 10\n"
            "・`/パネル設置` — ボタンで操作できる【総合操作パネル】を設置\n"
            "・`/マイル付与` `/マイル没収` `/チケット付与` `/チケット没収` `/設定パネル` — 運営用"), inline=False)
        await send(interaction, ephemeral=True, embed=embed)

    # ═════════════ マイル・階級 ═════════════
    @app_commands.command(name="マイル", description="現在の所持マイルポイントと階級昇格状況を確認します🌟")
    @app_commands.guild_only()
    async def miles_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_miles(interaction)

    async def do_miles(self, interaction: discord.Interaction):
        await defer(interaction, True)
        guild_id, user = interaction.guild.id, interaction.user
        ranks = await db.get_ranks(guild_id)
        data = await db.get_user_miles(guild_id, user.id)
        miles = data["miles"] or 0
        current = resolve_rank(user, data["rank_level"] or 1, ranks)
        nxt = next((r for r in ranks if r["level"] == current["level"] + 1), None)
        embed = base_embed("🌟 マイルポイント & 階級ステータス", "ステップアップサーバーの現在の実績データです。", current["color"])
        embed.add_field(name="🏷️ 現在の階級", value=f"**{current['name']}**", inline=True)
        embed.add_field(name="🌟 所持マイルポイント", value=f"**{miles:,}** pt", inline=True)
        if nxt:
            need = nxt["required_miles"]
            embed.add_field(name=f"⬆️ 次のランク: {nxt['name']}",
                            value=f"必要マイル: **{need:,}** マイル (あと **{max(0, need - miles):,}** マイル)", inline=False)
            embed.add_field(name="昇格進捗", value=progress_bar(min(miles, need), need), inline=False)
        else:
            embed.add_field(name="🏆 ランクステータス", value="🎉 **最高ランクに到達しています！おめでとうございます！**", inline=False)
        await send(interaction, ephemeral=True, embed=embed)

    @app_commands.command(name="ランクアップ", description="貯まったマイルポイントを使って次の階級へ昇格します⬆️")
    @app_commands.guild_only()
    async def rankup_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_rankup(interaction, ephemeral=False)

    async def do_rankup(self, interaction: discord.Interaction, ephemeral: bool):
        await defer(interaction, ephemeral)
        guild, member = interaction.guild, interaction.user
        ranks = await db.get_ranks(guild.id)
        data = await db.get_user_miles(guild.id, member.id)
        miles = data["miles"] or 0
        current = resolve_rank(member, data["rank_level"] or 1, ranks)
        nxt = next((r for r in ranks if r["level"] == current["level"] + 1), None)
        if not nxt:
            await send(interaction, ephemeral=ephemeral, embed=base_embed("🏆 階級アップ不可", "すでに最高階級に到達しています！", "#F1C40F"))
            return
        if miles < nxt["required_miles"]:
            await send(interaction, ephemeral=ephemeral, embed=base_embed(
                "⚠️ マイルポイント不足",
                f"**{nxt['name']}** へ昇格するには **{nxt['required_miles']:,}** pt が必要です。\n"
                f"（現在の所持: **{miles:,}** pt / あと **{nxt['required_miles'] - miles:,}** pt 必要）\n\n"
                "デイリーミッションやイベントでマイルを貯めましょう！", "#E74C3C"))
            return

        await db.rank_up(guild.id, member.id, nxt["level"], nxt["required_miles"])
        granted = ""
        try:
            clean = re.sub(r"^\S+ ", "", nxt["name"])
            role = next((r for r in guild.roles if r.name in (nxt["name"], clean, f"{clean}ロール") or clean in r.name), None)
            if role is None:
                role = await guild.create_role(name=nxt["name"], color=color_of(nxt["color"]), hoist=True,
                                               reason=f"ステップアップ階級昇格報酬 ({nxt['name']})")
            if role not in member.roles:
                await member.add_roles(role, reason="階級アップ")
                granted = f"\n🏅 限定階級ロール **「{role.name}」** を付与しました！"
            # 下位の階級ロールが残ると判定がずれるので外す
            citizen = {"住人", "住民", "🏠 住人", "🏠 住民", "住人ロール", "住民ロール"}
            old = [r for r in member.roles if r.id != role.id and (
                (nxt["level"] >= 2 and ("新規住人" in r.name or "新規住民" in r.name))
                or (nxt["level"] >= 3 and r.name in citizen)
                or (nxt["level"] >= 4 and ("常連住人" in r.name or "常連住民" in r.name))
            )]
            if old:
                await member.remove_roles(*old, reason="階級アップ（旧階級ロールの整理）")
        except discord.HTTPException as e:
            print(f"[Doumori] rank role update failed: {e}")

        member = guild.get_member(member.id) or member
        success = base_embed("🎉 階級アップ成功！", f"{member.mention} さんが **{nxt['name']}** に昇格しました！{granted}", nxt["color"])
        await send(interaction, ephemeral=ephemeral, embeds=[success, await resident_card_embed(guild, member, member)])

    @app_commands.command(name="diy作業台", description="週1回、個人的なイベントを開催告知してマイルを獲得します🛠️")
    @app_commands.describe(title="開催するイベントのタイトル", details="イベントの開催日時・ルール・内容")
    @app_commands.guild_only()
    async def diy_cmd(self, interaction: discord.Interaction, title: str, details: str):
        if await self.guard(interaction):
            await self.do_diy(interaction, title, details)

    async def do_diy(self, interaction: discord.Interaction, title: str, details: str):
        guild_id, user = interaction.guild.id, interaction.user
        diff_days = await db.diy_days_since(guild_id, user.id)
        if diff_days is not None:
            diff_days = float(diff_days)
            if diff_days < db.DIY_COOLDOWN_DAYS:
                remain = int(-(-(db.DIY_COOLDOWN_DAYS - diff_days) // 1))
                await send(interaction, ephemeral=True, embed=base_embed(
                    "⚠️ クールダウン中",
                    f"DIY作業台でのイベント開催は **1週間に1回まで** です。\n（あと **{remain} 日** 後に再度開催できます）", "#E74C3C"))
                return
        await defer(interaction, False)
        await db.update_last_diy_at(guild_id, user.id)
        new_miles = await db.add_miles(guild_id, user.id, db.DIY_EVENT_REWARD_MILES)
        embed = base_embed("🛠️ DIY作業台 - 住民主催イベント告知！",
                           f"主催者: {user.mention}\n\n**【{title}】**\n\n*{details}*", "#9B59B6")
        embed.add_field(name="🎁 主催者特典",
                        value=f"イベント開催につき **+{db.DIY_EVENT_REWARD_MILES}** マイル獲得！ (現在の所持: **{new_miles:,}** マイル)", inline=False)
        await send(interaction, content="📢 **新しいイベントがDIY作業台から開催されました！**", embed=embed)

    # ═════════════ デイリーミッション ═════════════
    @app_commands.command(name="デイリーミッション", description="本日のデイリーミッション（全枠・進捗状況）を確認します📅")
    @app_commands.guild_only()
    async def mission_cmd(self, interaction: discord.Interaction):
        if await self.guard(interaction):
            await self.do_mission(interaction)

    async def do_mission(self, interaction: discord.Interaction):
        await defer(interaction, True)
        guild_id, user = interaction.guild.id, interaction.user
        data = await db.get_user_miles(guild_id, user.id)
        missions = await db.get_or_create_daily_missions(guild_id, user.id, data["rank_level"] or 1)
        done = [m for m in missions if m["status"] == "approved"]
        earned = sum(m["reward_miles"] or 100 for m in done)
        available = sum(m["reward_miles"] or 100 for m in missions)
        all_done = missions and len(done) == len(missions)
        color = "#2ECC71" if all_done else "#3498DB" if done else "#F1C40F"
        desc = (f"🎉 **本日の全ミッションを完全制覇しました！** (合計 **+{earned}マイル** 獲得済み)" if all_done else
                f"ミッションを達成してマイルを獲得しましょう（全達成で **+{available}マイル**）！\n"
                f"進捗状況: **{len(done)} / {len(missions)}** クリア済み")
        embed = base_embed(f"📅 本日のデイリーミッション (全{len(missions)}枠)", desc, color)
        for i, m in enumerate(missions):
            icon = SLOT_EMOJIS[i] if i < len(SLOT_EMOJIS) else f"[{i + 1}]"
            title = m["mission_title"] or f"ミッション {i + 1}"
            reward = m["reward_miles"] or 100
            if m["status"] == "submitted":
                name, badge = f"📨 {icon} 【{title}】 [確認待ち]", "📨 **報告中 (運営スタッフの確認待ち)**"
            elif m["status"] == "approved":
                name, badge = f"✅ {icon} 【{title}】 [クリア済み 🎉]", f"🎉 **クリア済み (+{reward}pt 獲得済み)**"
            else:
                name, badge = f"{icon} 【{title}】 (+{reward}pt)", "⏳ **未達成 (未報告)**"
            embed.add_field(name=name[:256], value=f"📝 {m['mission_desc']}\n状態: {badge}"[:1024], inline=False)
        embed.set_footer(text="🌟 明日になると新しいデイリーミッションが更新されます！" if all_done
                         else "💡 達成したら `/ミッション報告` で対象ミッションを指定してスクショを提出してください！")
        await send(interaction, ephemeral=True, embed=embed)

    @app_commands.command(name="ミッション報告", description="デイリーミッション達成のスクリーンショットを添えて報告します📸")
    @app_commands.describe(screenshot="ミッション達成のスクリーンショット画像", slot="報告するミッション枠番号（省略時はすべての未達成枠）")
    @app_commands.guild_only()
    async def mission_report_cmd(self, interaction: discord.Interaction, screenshot: discord.Attachment,
                                 slot: app_commands.Range[int, 0, 30] = 0):
        if not await self.guard(interaction):
            return
        if not (screenshot.content_type or "").startswith("image/"):
            await send(interaction, ephemeral=True, content="⚠️ 画像ファイル（スクリーンショット）を添付して報告してください！")
            return
        await defer(interaction, False)
        guild_id, user = interaction.guild.id, interaction.user
        data = await db.get_user_miles(guild_id, user.id)
        missions = await db.get_or_create_daily_missions(guild_id, user.id, data["rank_level"] or 1)
        targets = [m for m in missions if m["mission_slot"] == slot] if slot > 0 else [m for m in missions if m["status"] != "approved"]
        targets = [m for m in targets if m["status"] != "approved"]
        if not targets:
            await send(interaction, ephemeral=True, content="✅ 該当するミッションはすべて既に達成・承認済みです！")
            return
        date_key = targets[0]["date_key"]
        await db.submit_mission_report(guild_id, user.id, date_key, slot, screenshot.url)
        total = sum(m["reward_miles"] or 100 for m in targets)
        listing = "\n".join(f"・**[枠{m['mission_slot']}] {m['mission_title']}**: {m['mission_desc']} (+{m['reward_miles'] or 100}pt)" for m in targets)
        embed = base_embed(
            "📸 デイリーミッション達成報告",
            f"**報告者**: {user.mention}\n**報告枠**: {'すべての未達成ミッション' if slot == 0 else f'ミッション 枠{slot}'}\n\n"
            f"**【対象ミッション】**\n{listing}\n\n💰 **付与予定ポイント**: **+{total}** pt"[:4096], "#3498DB")
        embed.set_image(url=screenshot.url)
        embed.set_footer(text=f"提出日: {date_key} | 運営スタッフの承認をお待ちください")
        view = discord.ui.View(timeout=None)
        view.add_item(ApproveMissionButton(user.id, date_key, slot, label=f"✅ 承認する (+{total}pt / {len(targets)}枠)"))
        content = "📢 **新しいミッション達成報告が届きました！** (運営・スタッフはボタンを押して承認できます)"

        settings = await db.get_settings(guild_id)
        report_channel = interaction.guild.get_channel(db.as_int(settings.get("mission_report_channel_id"), 0))
        if report_channel and report_channel.id != interaction.channel_id:
            # 報告受付チャンネルが設定されていれば、そこへ承認用の報告を送る
            try:
                await report_channel.send(content=content, embed=embed, view=view)
                await send(interaction, content=f"📨 {user.mention} さんのミッション報告を {report_channel.mention} に送信しました。運営の承認をお待ちください！")
                return
            except discord.HTTPException as e:
                print(f"[Doumori] report channel send failed: {e}")
        await send(interaction, content=content, embed=embed, view=view)

    async def approve_mission(self, interaction: discord.Interaction, target_id: int, date_key: str, slot: int):
        guild, staff = interaction.guild, interaction.user
        if not guild or not await check_permission(staff, guild.id, "mission_staff"):
            await interaction.response.send_message("⚠️ 報告を承認する権限がありません（ミッション承認スタッフ・管理者専用）。", ephemeral=True)
            return
        await interaction.response.defer()
        try:
            result = await db.approve_missions(guild.id, target_id, date_key, slot, staff.id)
            if not result:
                await interaction.edit_original_response(view=done_button("✅ 承認済み"))
                await interaction.followup.send("⚠️ このミッション報告はすでに承認済みです。", ephemeral=True)
                return
            target = guild.get_member(target_id)
            if target is None:
                try:
                    target = await guild.fetch_member(target_id)
                except discord.HTTPException:
                    target = await self.bot.fetch_user(target_id)  # サーバーを抜けた人
            approved = base_embed(
                "🎉 ミッション承認完了＆自動反映！",
                f"**承認スタッフ**: {staff.mention}\n**対象者**: <@{target_id}>\n\n"
                f"💰 **獲得ポイント**: **+{result['reward_miles']}** pt\n"
                f"📈 **承認ミッション枠数**: **{result['approved_count']}** 枠\n"
                "📝 **処理履歴**: 記録完了\n🃏 **住民カード**: 最新情報に自動更新されました！")
            await interaction.edit_original_response(
                content=f"✅ <@{target_id}> さんのミッション報告が承認されました！",
                embeds=[approved, await resident_card_embed(guild, target, target)],
                attachments=[], view=done_button(f"✅ 承認完了 (by {staff.display_name})"),
            )
        except Exception as e:
            print(f"[Doumori] approve failed: {e!r}")
            await interaction.followup.send(f"❌ 承認処理中にエラーが発生しました: `{e}`", ephemeral=True)

    # ═════════════ 運営用 ═════════════
    async def _grant(self, interaction, kind: str, user: discord.Member, amount: int, reason: str | None, revoke: bool):
        guild_id = interaction.guild.id
        if not await check_permission(interaction.user, guild_id, "mile_grant" if kind == "mile" else "ticket_grant"):
            staff = "マイル付与スタッフ" if kind == "mile" else "チケット管理スタッフ"
            await send(interaction, ephemeral=True, content=f"⚠️ このコマンドを実行する権限がありません（{staff}専用）。")
            return
        await defer(interaction, False)
        action = "没収" if revoke else "付与"
        reason = reason or f"{'管理者' if kind == 'mile' else 'スタッフ'}による手動{action}{'・調整' if revoke else ''}"
        if kind == "mile":
            if revoke:
                new, changed = await db.admin_remove_miles(guild_id, user.id, amount, interaction.user.id, reason)
            else:
                new, changed = await db.admin_add_miles(guild_id, user.id, amount, interaction.user.id, reason), amount
            embed = base_embed(
                f"{'⚠️' if revoke else '🎁'} マイルポイント手動{action}完了",
                f"{interaction.user.mention} により、{user.mention} さんのマイルポイントが{action}されました。\n\n"
                f"{'➖' if revoke else '➕'} **{action}ポイント**: **{'-' if revoke else '+'}{changed:,}** pt\n"
                f"🌟 **現在のマイル残高**: **{new:,}** pt\n📝 **理由**: {reason}",
                "#E74C3C" if revoke else "#2ECC71")
            await send(interaction, embeds=[embed, await resident_card_embed(interaction.guild, user, user)])
        else:
            if revoke:
                current = (await db.get_user(guild_id, user.id))["tickets"] or 0
                changed = min(current, amount)
                new = await db.add_tickets(guild_id, user.id, -changed)
            else:
                changed, new = amount, await db.add_tickets(guild_id, user.id, amount)
            embed = base_embed(
                f"{'⚠️' if revoke else '🎫'} 図鑑チケット手動{action}完了",
                f"{interaction.user.mention} により、{user.mention} さんの図鑑チケットが{action}されました。\n\n"
                f"{'➖' if revoke else '➕'} **{action}枚数**: **{'-' if revoke else '+'}{changed:,}** 枚\n"
                f"🎫 **現在の所持チケット**: **{new:,}** 枚\n📝 **理由**: {reason}",
                "#E74C3C" if revoke else "#2ECC71")
            await send(interaction, embed=embed)

    @app_commands.command(name="マイル付与", description="【スタッフ専用】指定した住民にマイルポイントを手動で付与します🎁")
    @app_commands.describe(user="マイルを付与する対象住民", amount="付与するマイルポイント数", reason="付与の理由・メモ (任意)")
    @app_commands.guild_only()
    async def mile_grant_cmd(self, interaction: discord.Interaction, user: discord.Member, amount: app_commands.Range[int, 1, 10_000_000], reason: str = None):
        if await self.guard(interaction):
            await self._grant(interaction, "mile", user, amount, reason, revoke=False)

    @app_commands.command(name="マイル没収", description="【スタッフ専用】指定した住民からマイルポイントを減額・没収します⚠️")
    @app_commands.describe(user="マイルを没収する対象住民", amount="没収するマイルポイント数", reason="没収の理由・メモ (任意)")
    @app_commands.guild_only()
    async def mile_revoke_cmd(self, interaction: discord.Interaction, user: discord.Member, amount: app_commands.Range[int, 1, 10_000_000], reason: str = None):
        if await self.guard(interaction):
            await self._grant(interaction, "mile", user, amount, reason, revoke=True)

    @app_commands.command(name="チケット付与", description="【スタッフ専用】指定した住民に図鑑チケットを手動で付与します🎫")
    @app_commands.describe(user="チケットを付与する対象住民", amount="付与するチケット枚数", reason="付与の理由・メモ (任意)")
    @app_commands.guild_only()
    async def ticket_grant_cmd(self, interaction: discord.Interaction, user: discord.Member, amount: app_commands.Range[int, 1, 100_000], reason: str = None):
        if await self.guard(interaction):
            await self._grant(interaction, "ticket", user, amount, reason, revoke=False)

    @app_commands.command(name="チケット没収", description="【スタッフ専用】指定した住民から図鑑チケットを減額・没収します⚠️")
    @app_commands.describe(user="チケットを没収する対象住民", amount="没収するチケット枚数", reason="没収の理由・メモ (任意)")
    @app_commands.guild_only()
    async def ticket_revoke_cmd(self, interaction: discord.Interaction, user: discord.Member, amount: app_commands.Range[int, 1, 100_000], reason: str = None):
        if await self.guard(interaction):
            await self._grant(interaction, "ticket", user, amount, reason, revoke=True)

    @app_commands.command(name="パネル設置", description="このチャンネルに全機能がボタン操作できる【総合操作パネル】を設置します🎮")
    @app_commands.guild_only()
    async def panel_cmd(self, interaction: discord.Interaction):
        if not await self.guard(interaction):
            return
        member = interaction.user
        if not (await check_permission(member, interaction.guild.id, "admin") or member.guild_permissions.manage_messages):
            await send(interaction, ephemeral=True, content="⚠️ このコマンドを実行する権限がありません（管理者・モデレーター専用）。")
            return
        await defer(interaction, True)
        s = await db.get_settings(interaction.guild.id)
        await interaction.channel.send(embed=build_panel_embed(s.get("panel_title"), s.get("panel_color")), view=DoumoriPanelView())
        await send(interaction, ephemeral=True, content="✅ チャンネルに【総合操作パネル】を設置しました！")

    @app_commands.command(name="設定パネル", description="【管理者専用】どう森機能のロール権限や通知チャンネルを設定します⚙️")
    @app_commands.guild_only()
    async def settings_panel_cmd(self, interaction: discord.Interaction):
        if not await self.guard(interaction):
            return
        if not await check_permission(interaction.user, interaction.guild.id, "admin"):
            await send(interaction, ephemeral=True, content="⚠️ このコマンドを実行する権限がありません（管理者専用）。")
            return
        await defer(interaction, True)
        view = SettingsPanelView(interaction.user.id, interaction.guild.id)
        embed = await view.build_main()
        view.message = await send(interaction, ephemeral=True, embed=embed, view=view)

    # ═════════════ 浮上（VC・チャット）計測 ═════════════
    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if member.bot:
            return
        key = (member.guild.id, member.id)
        try:
            if before.channel is None and after.channel is not None:
                if await self.enabled(member.guild.id, cached=True):
                    self.vc_join_times[key] = time.monotonic()
            elif before.channel is not None and after.channel is None:
                start = self.vc_join_times.pop(key, None)
                if start is not None:
                    seconds = int(time.monotonic() - start)
                    if seconds > 0 and await self.enabled(member.guild.id, cached=True):
                        await self.add_activity(member, seconds)
        except Exception as e:
            print(f"[Doumori] voice tracker error: {e!r}")

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not message.guild or message.author.bot or not isinstance(message.author, discord.Member):
            return
        try:
            if not await self.enabled(message.guild.id, cached=True):
                return
            key = (message.guild.id, message.author.id)
            self.last_channels[key] = message.channel.id
            s = await db.get_settings(message.guild.id)
            cooldown = max(1, db.as_int(s.get("ticket_chat_cooldown_seconds"), 60))
            add_seconds = max(1, db.as_int(s.get("ticket_chat_activity_seconds"), 60))
            now = time.monotonic()
            if now - self.chat_cooldowns.get(key, 0) >= cooldown:
                self.chat_cooldowns[key] = now
                await self.add_activity(message.author, add_seconds, message.channel, s)
        except Exception as e:
            print(f"[Doumori] chat tracker error: {e!r}")

    async def add_activity(self, member: discord.Member, seconds: int, channel=None, settings: dict = None):
        """浮上時間を加算し、必要時間に達したら図鑑チケットを付与して通知する"""
        guild = member.guild
        s = settings or await db.get_settings(guild.id)
        required = max(1, db.as_int(s.get("ticket_required_minutes"), 60)) * 60
        given, total = await db.add_activity_seconds(guild.id, member.id, seconds, required)
        if not given or not db.as_bool(s.get("ticket_notify_enabled")):
            return
        template = s.get("ticket_notify_message") or db.DEFAULT_SETTINGS["ticket_notify_message"]
        msg = str(template).replace("{user}", member.display_name).replace("{tickets}", str(given)).replace("{total}", str(total))
        dest = s.get("ticket_notify_destination") or "last_channel"

        async def to_dm():
            try:
                await member.send(msg)
            except discord.HTTPException:
                pass

        if dest == "dm":
            await to_dm()
            return
        target = None
        if dest == "channel":
            target = guild.get_channel(db.as_int(s.get("ticket_notify_channel_id"), 0))
        if target is None:
            target = channel or guild.get_channel(self.last_channels.get((guild.id, member.id), 0))
        if isinstance(target, (discord.TextChannel, discord.Thread, discord.VoiceChannel)):
            try:
                await target.send(msg)
                return
            except discord.HTTPException:
                pass
        await to_dm()


async def setup(bot):
    await bot.add_cog(Doumori(bot))
