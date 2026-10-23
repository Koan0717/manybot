import datetime
import json

import discord
from discord.ext import commands

import database
from helpers import JST, get_new_member_roles, has_evaluator_role

# 評価シート記入パネル: 評価員がパネルのボタンから仮メンを選び、総評とダッシュボードで設定した
# 各項目（声・コミュニケーションなど）の内容を書いて、指定チャンネルに送信する。
# 設定は eval_report_settings に1サーバー1行で保存する。

VERDICTS = [
    ("あり", "🟢", discord.Color.green()),
    ("保留", "🟡", discord.Color.gold()),
    ("なし", "🔴", discord.Color.red()),
]
# Discord のモーダルに置ける部品は5つまで。1項目で「段階」と「内容」の2つを使うので、1画面2項目ずつにする
ITEMS_PER_MODAL = 2
# 各項目の段階。5が最高
RATINGS = ["保留", "1", "2", "3", "4", "5"]
MAX_ITEMS = 20
DEFAULT_ITEMS = [
    {"id": "voice", "label": "声", "placeholder": ""},
    {"id": "communication", "label": "コミュニケーション", "placeholder": ""},
    {"id": "server_understanding", "label": "サーバー理解度", "placeholder": ""},
]
DEFAULT_PANEL_TITLE = "📋 評価シート"
DEFAULT_PANEL_DESCRIPTION = "評価員は下のボタンから仮メンの評価シートを記入できます。"
DEFAULT_BUTTON_LABEL = "評価シートを書く"

_ensured_pools = set()


async def ensure_eval_report_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS eval_report_settings (
                guild_id BIGINT PRIMARY KEY,
                items JSONB NOT NULL DEFAULT '[]'::jsonb,
                output_channel_id BIGINT,
                panel_title TEXT NOT NULL DEFAULT '',
                panel_description TEXT NOT NULL DEFAULT '',
                button_label TEXT NOT NULL DEFAULT ''
            )
        ''')
    _ensured_pools.add(id(p))
    return p


async def get_eval_report_settings(guild_id: int) -> dict:
    p = await ensure_eval_report_schema(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow('SELECT * FROM eval_report_settings WHERE guild_id = $1', guild_id)
    if not row:
        return {
            "items": [dict(i) for i in DEFAULT_ITEMS],
            "output_channel_id": None,
            "panel_title": DEFAULT_PANEL_TITLE,
            "panel_description": DEFAULT_PANEL_DESCRIPTION,
            "button_label": DEFAULT_BUTTON_LABEL,
        }
    s = dict(row)
    items = s["items"]
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            items = []
    s["items"] = [i for i in (items or []) if isinstance(i, dict) and i.get("id") and i.get("label")][:MAX_ITEMS]
    s["panel_title"] = s.get("panel_title") or DEFAULT_PANEL_TITLE
    s["panel_description"] = s.get("panel_description") or DEFAULT_PANEL_DESCRIPTION
    s["button_label"] = s.get("button_label") or DEFAULT_BUTTON_LABEL
    return s


async def post_eval_report_panel(guild: discord.Guild, channel):
    """IPC から呼ばれる: 評価シート記入パネルを投稿する。"""
    s = await get_eval_report_settings(guild.id)
    embed = discord.Embed(title=s["panel_title"], description=s["panel_description"], color=discord.Color.blue())
    embed.add_field(name="記入する項目", value="総評、" + "、".join(i["label"] for i in s["items"]) if s["items"] else "総評", inline=False)
    view = EvalReportPanelView(button_label=s["button_label"])
    await channel.send(embed=embed, view=view)


def _verdict_meta(verdict: str):
    return next((v for v in VERDICTS if v[0] == verdict), (verdict, "⚪", discord.Color.light_grey()))


def format_rating(rating: str | None) -> str:
    if not rating:
        return "（未選択）"
    if rating == "保留":
        return "⏸️ 保留"
    n = int(rating)
    return f"{'★' * n}{'☆' * (5 - n)} {n} / 5"


def build_report_embeds(target: discord.Member, evaluator: discord.Member, verdict: str, items: list[dict], answers: dict, ratings: dict) -> list[discord.Embed]:
    """提出内容の Embed。1メッセージの合計 6000 文字制限を超えないよう、必要に応じて複数に分ける。"""
    _, emoji, color = _verdict_meta(verdict)
    first = discord.Embed(
        title="📋 評価シート",
        description=f"**対象者:** {target.mention}（{target.display_name}）\n**送信者:** {evaluator.mention}（{evaluator.display_name}）",
        color=color,
        timestamp=datetime.datetime.now(JST),
    )
    # 送信者を左上に、相手のアイコンを右上に表示する
    first.set_author(name=f"送信者: {evaluator.display_name}", icon_url=evaluator.display_avatar.url)
    first.set_thumbnail(url=target.display_avatar.url)
    first.add_field(name="総評", value=f"{emoji} **{verdict}**", inline=False)
    first.set_footer(text=f"送信者: {evaluator.display_name}（{evaluator.name}）")

    embeds = [first]
    for item in items:
        name = item["label"][:256]
        value = f"**段階:** {format_rating(ratings.get(item['id']))}\n{answers.get(item['id']) or '（未記入）'}"[:1024]
        current = embeds[-1]
        if len(current) + len(name) + len(value) > 5800 or len(current.fields) >= 25:
            current = discord.Embed(title="📋 評価シート（続き）", color=color)
            current.set_author(name=f"送信者: {evaluator.display_name}", icon_url=evaluator.display_avatar.url)
            embeds.append(current)
        current.add_field(name=name, value=value, inline=False)
    return embeds


class EvalReportModal(discord.ui.Modal):
    def __init__(self, form: "EvalReportFormView", chunk: list[dict]):
        super().__init__(title="評価内容の記入", timeout=900)
        self.form = form
        self.inputs: list[tuple[dict, discord.ui.Select, discord.ui.TextInput]] = []
        for item in chunk:
            current = form.ratings.get(item["id"])
            rating_select = discord.ui.Select(
                placeholder="段階を選択",
                options=[
                    discord.SelectOption(label=r if r == "保留" else f"{r}{'（最高）' if r == '5' else ''}", value=r, default=r == current)
                    for r in RATINGS
                ],
                required=True,
            )
            text_input = discord.ui.TextInput(
                placeholder=(item.get("placeholder") or "")[:100] or None,
                style=discord.TextStyle.paragraph,
                required=True,
                max_length=950,
                default=form.answers.get(item["id"]),
            )
            # 内容を書く欄の上に、5段階のどれかを選ぶ欄を置く
            self.add_item(discord.ui.Label(
                text=f"{item['label']}（5段階）"[:45],
                description="1〜5で選択（5が最高）。決めかねる場合は保留",
                component=rating_select,
            ))
            self.add_item(discord.ui.Label(text=item["label"][:45], component=text_input))
            self.inputs.append((item, rating_select, text_input))

    async def on_submit(self, interaction: discord.Interaction):
        for item, rating_select, text_input in self.inputs:
            if rating_select.values:
                self.form.ratings[item["id"]] = rating_select.values[0]
            text = text_input.value.strip()
            if text:
                self.form.answers[item["id"]] = text
            else:
                self.form.answers.pop(item["id"], None)
        await self.form.render(interaction)


class EvalReportTargetSelect(discord.ui.UserSelect):
    def __init__(self, form: "EvalReportFormView"):
        super().__init__(
            placeholder="評価する仮メンを選択",
            min_values=1,
            max_values=1,
            default_values=[form.target] if form.target else [],
            row=0,
        )
        self.form = form

    async def callback(self, interaction: discord.Interaction):
        picked = self.values[0]
        member = picked if isinstance(picked, discord.Member) else interaction.guild.get_member(picked.id)
        if member is None or member.bot:
            await self.form.render(interaction, notice="⚠️ そのユーザーは評価対象にできません。")
            return
        temp_roles = get_new_member_roles(self.form.bot, interaction.guild)
        if temp_roles and not any(r in member.roles for r in temp_roles):
            await self.form.render(interaction, notice=f"⚠️ {member.display_name} は仮メンではありません。")
            return
        self.form.target = member
        await self.form.render(interaction)


class EvalReportVerdictSelect(discord.ui.Select):
    def __init__(self, form: "EvalReportFormView"):
        super().__init__(
            placeholder="総評を選択",
            min_values=1,
            max_values=1,
            options=[
                discord.SelectOption(label=label, emoji=emoji, value=label, default=label == form.verdict)
                for label, emoji, _ in VERDICTS
            ],
            row=1,
        )
        self.form = form

    async def callback(self, interaction: discord.Interaction):
        self.form.verdict = self.values[0]
        await self.form.render(interaction)


class EvalReportFormView(discord.ui.View):
    """評価員だけに見えるメッセージで、仮メン・総評・各項目を記入してもらう。"""

    def __init__(self, bot, settings: dict, evaluator_id: int):
        super().__init__(timeout=1800)
        self.bot = bot
        self.settings = settings
        self.items: list[dict] = settings["items"]
        self.evaluator_id = evaluator_id
        self.target: discord.Member | None = None
        self.verdict: str | None = None
        self.answers: dict[str, str] = {}
        self.ratings: dict[str, str] = {}

    def _chunks(self) -> list[list[dict]]:
        return [self.items[i:i + ITEMS_PER_MODAL] for i in range(0, len(self.items), ITEMS_PER_MODAL)]

    def _is_item_done(self, item: dict) -> bool:
        return bool(self.answers.get(item["id"]) and self.ratings.get(item["id"]))

    def _is_complete(self) -> bool:
        return bool(self.target and self.verdict and all(self._is_item_done(i) for i in self.items))

    def _build(self) -> discord.Embed:
        self.clear_items()
        self.add_item(EvalReportTargetSelect(self))
        self.add_item(EvalReportVerdictSelect(self))

        chunks = self._chunks()
        for n, chunk in enumerate(chunks):
            filled = all(self._is_item_done(i) for i in chunk)
            if len(chunks) == 1:
                label = "内容を書く"
            else:
                start = n * ITEMS_PER_MODAL + 1
                names = "・".join(i["label"] for i in chunk)
                label = f"内容を書く（{names}）"[:80]
            btn = discord.ui.Button(
                label=label,
                emoji="✅" if filled else "✏️",
                style=discord.ButtonStyle.secondary if filled else discord.ButtonStyle.primary,
                row=2 + n // 5,  # 1行に置けるボタンは5つまで
            )
            btn.callback = self._make_write_handler(chunk)
            self.add_item(btn)

        submit = discord.ui.Button(label="送信する", emoji="📨", style=discord.ButtonStyle.success, disabled=not self._is_complete(), row=4)
        submit.callback = self.on_submit
        self.add_item(submit)
        cancel = discord.ui.Button(label="やめる", style=discord.ButtonStyle.danger, row=4)
        cancel.callback = self.on_cancel
        self.add_item(cancel)

        embed = discord.Embed(
            title="📋 評価シートの記入",
            description="仮メンを選び、総評と各項目の段階（保留・1〜5）・内容を書いてから「送信する」を押してください。",
            color=_verdict_meta(self.verdict)[2] if self.verdict else discord.Color.blue(),
        )
        if self.target:
            embed.set_thumbnail(url=self.target.display_avatar.url)
        embed.add_field(name="対象者", value=self.target.mention if self.target else "（未選択）", inline=True)
        embed.add_field(
            name="総評",
            value=f"{_verdict_meta(self.verdict)[1]} {self.verdict}" if self.verdict else "（未選択）",
            inline=True,
        )
        for item in self.items:
            text = self.answers.get(item["id"]) or "（未記入）"
            value = f"**段階:** {format_rating(self.ratings.get(item['id']))}\n{text}"
            embed.add_field(name=item["label"][:256], value=value[:1024], inline=False)
        return embed

    def _make_write_handler(self, chunk: list[dict]):
        async def handler(interaction: discord.Interaction):
            await interaction.response.send_modal(EvalReportModal(self, chunk))
        return handler

    async def render(self, interaction: discord.Interaction, notice: str | None = None):
        embed = self._build()
        await interaction.response.edit_message(content=notice, embed=embed, view=self)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.evaluator_id

    async def on_cancel(self, interaction: discord.Interaction):
        self.stop()
        await interaction.response.edit_message(content="評価シートの記入を中止しました。", embed=None, view=None)

    async def on_submit(self, interaction: discord.Interaction):
        if not self._is_complete():
            await self.render(interaction, notice="⚠️ 未入力の項目があります。")
            return
        settings = await get_eval_report_settings(interaction.guild_id)
        channel_id = settings.get("output_channel_id")
        channel = interaction.guild.get_channel(channel_id) if channel_id else None
        if channel is None:
            await self.render(interaction, notice="⚠️ 送信先チャンネルが設定されていません。管理者にダッシュボードでの設定を依頼してください。")
            return

        await interaction.response.defer()
        embeds = build_report_embeds(self.target, interaction.user, self.verdict, self.items, self.answers, self.ratings)
        try:
            if isinstance(channel, discord.ForumChannel):
                tags = [channel.available_tags[0]] if channel.flags.require_tag and channel.available_tags else []
                created = await channel.create_thread(
                    name=f"{self.target.display_name} の評価シート"[:100], embed=embeds[0], applied_tags=tags
                )
                dest, first_msg = created.thread, created.message
            else:
                dest = channel
                first_msg = await channel.send(embed=embeds[0])
            for extra in embeds[1:]:
                await dest.send(embed=extra)
        except discord.Forbidden:
            await interaction.edit_original_response(
                content=f"❌ {channel.mention} に送信する権限がBotにありません。", embed=self._build(), view=self
            )
            return
        except Exception as e:
            print(f"[EvalReport Error] Failed to send report: {e}")
            await interaction.edit_original_response(content=f"❌ 送信に失敗しました: {e}", embed=self._build(), view=self)
            return

        self.stop()
        await interaction.edit_original_response(
            content=f"✅ {self.target.mention} の評価シートを送信しました。\n{first_msg.jump_url}", embed=None, view=None
        )


class EvalReportPanelView(discord.ui.View):
    def __init__(self, button_label: str = DEFAULT_BUTTON_LABEL):
        super().__init__(timeout=None)
        self.open_form.label = button_label[:80]

    @discord.ui.button(label=DEFAULT_BUTTON_LABEL, emoji="📝", style=discord.ButtonStyle.primary, custom_id="eval_report:open")
    async def open_form(self, interaction: discord.Interaction, button: discord.ui.Button):
        try:
            bot = interaction.client
            if not has_evaluator_role(bot, interaction.user):
                await interaction.response.send_message("評価シートを記入する権限がありません（評価員ロールが必要です）。", ephemeral=True)
                return
            settings = await get_eval_report_settings(interaction.guild_id)
            if not settings["items"]:
                await interaction.response.send_message("評価項目が設定されていません。管理者にダッシュボードでの設定を依頼してください。", ephemeral=True)
                return
            view = EvalReportFormView(bot, settings, interaction.user.id)
            await interaction.response.send_message(embed=view._build(), view=view, ephemeral=True)
        except Exception as e:
            print(f"[EvalReport Error] {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ エラーが発生しました: {e}", ephemeral=True)


class EvalReport(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(EvalReportPanelView())


async def setup(bot):
    await bot.add_cog(EvalReport(bot))
