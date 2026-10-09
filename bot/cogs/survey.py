import datetime
import json

import discord
from discord.ext import commands

import database
from helpers import JST

# アンケート: ダッシュボードで作成したアンケートをパネルとして投稿し、ボタンから回答してもらう。
# 質問の種類: single（単一選択） / multi（複数選択） / text（自由記述）
# 回答は survey_responses に1人1件で保存する（再回答を許可している場合は上書き）。

_ensured_pools = set()


async def ensure_survey_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS surveys (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                questions JSONB NOT NULL DEFAULT '[]'::jsonb,
                is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
                allow_edit BOOLEAN NOT NULL DEFAULT TRUE,
                is_open BOOLEAN NOT NULL DEFAULT TRUE,
                closes_at TIMESTAMPTZ,
                button_label TEXT NOT NULL DEFAULT '回答する',
                channel_id BIGINT,
                message_id BIGINT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS survey_responses (
                id SERIAL PRIMARY KEY,
                survey_id INT NOT NULL,
                guild_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                user_name TEXT NOT NULL DEFAULT '',
                answers JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (survey_id, user_id)
            )
        ''')
    _ensured_pools.add(id(p))
    return p


def _loads(raw, default):
    if raw is None:
        return default
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return default
    return raw


async def get_survey(guild_id: int, survey_id: int) -> dict | None:
    p = await ensure_survey_schema(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow('SELECT * FROM surveys WHERE id = $1 AND guild_id = $2', survey_id, guild_id)
    if not row:
        return None
    s = dict(row)
    s["questions"] = [q for q in _loads(s["questions"], []) if isinstance(q, dict)]
    return s


async def get_response(guild_id: int, survey_id: int, user_id: int) -> dict | None:
    p = await ensure_survey_schema(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT answers FROM survey_responses WHERE survey_id = $1 AND user_id = $2', survey_id, user_id
        )
    return _loads(row["answers"], {}) if row else None


async def get_responses(guild_id: int, survey_id: int) -> list[dict]:
    p = await ensure_survey_schema(guild_id)
    async with p.acquire() as conn:
        rows = await conn.fetch('SELECT answers FROM survey_responses WHERE survey_id = $1', survey_id)
    return [_loads(r["answers"], {}) for r in rows]


def is_accepting(survey: dict) -> bool:
    if not survey.get("is_open"):
        return False
    closes_at = survey.get("closes_at")
    if closes_at and closes_at <= datetime.datetime.now(datetime.timezone.utc):
        return False
    return True


def build_panel_embed(survey: dict, response_count: int | None = None) -> discord.Embed:
    accepting = is_accepting(survey)
    embed = discord.Embed(
        title=f"📋 {survey['title'] or 'アンケート'}",
        description=survey.get("description") or "下のボタンから回答できます。",
        color=discord.Color.teal() if accepting else discord.Color.dark_grey(),
    )
    embed.add_field(name="質問数", value=f"{len(survey['questions'])}問", inline=True)
    if survey.get("is_anonymous"):
        embed.add_field(name="回答形式", value="匿名", inline=True)
    if response_count is not None:
        embed.add_field(name="回答数", value=f"{response_count}件", inline=True)
    closes_at = survey.get("closes_at")
    if not accepting:
        embed.add_field(name="状態", value="🔒 受付終了", inline=False)
    elif closes_at:
        embed.add_field(name="締切", value=discord.utils.format_dt(closes_at, "f"), inline=False)
    return embed


def build_panel_view(survey: dict) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(SurveyAnswerButton(survey["id"], label=survey.get("button_label") or "回答する", disabled=not is_accepting(survey)))
    return view


def _bar(ratio: float, width: int = 12) -> str:
    filled = round(ratio * width)
    return "█" * filled + "░" * (width - filled)


def build_results_embed(survey: dict, responses: list[dict]) -> discord.Embed:
    total = len(responses)
    embed = discord.Embed(
        title=f"📊 アンケート結果: {survey['title'] or 'アンケート'}",
        description=f"回答数: **{total}件**",
        color=discord.Color.teal(),
    )
    for i, q in enumerate(survey["questions"][:25], start=1):
        qid = q.get("id")
        if q.get("type") in ("single", "multi"):
            counts = {opt: 0 for opt in q.get("options", [])}
            for ans in responses:
                val = ans.get(qid)
                for v in (val if isinstance(val, list) else [val] if val else []):
                    if v in counts:
                        counts[v] += 1
            lines = []
            for opt, c in counts.items():
                ratio = c / total if total else 0
                lines.append(f"`{_bar(ratio)}` {c}票 ({ratio * 100:.0f}%) {opt}")
            value = "\n".join(lines) or "選択肢なし"
        else:
            answered = sum(1 for ans in responses if str(ans.get(qid) or "").strip())
            value = f"自由記述 {answered}件（内容はダッシュボードで確認できます）"
        embed.add_field(name=f"Q{i}. {q.get('title', '')}"[:256], value=value[:1024], inline=False)
    embed.set_footer(text=f"集計日時: {datetime.datetime.now(JST).strftime('%Y/%m/%d %H:%M')}")
    return embed


async def _send_to_channel(channel, embed: discord.Embed, view: discord.ui.View | None = None) -> discord.Message:
    kwargs = {"embed": embed}
    if view is not None:
        kwargs["view"] = view
    if isinstance(channel, discord.ForumChannel):
        tags = [channel.available_tags[0]] if channel.flags.require_tag and channel.available_tags else []
        created = await channel.create_thread(name=(embed.title or "アンケート")[:100], applied_tags=tags, **kwargs)
        return created.message
    return await channel.send(**kwargs)


async def post_survey_panel(guild: discord.Guild, channel, survey_id: int):
    """IPC から呼ばれる: アンケートのパネルを投稿し、投稿先を記録する。"""
    survey = await get_survey(guild.id, survey_id)
    if not survey:
        print(f"[Survey] survey {survey_id} not found in guild {guild.id}")
        return
    msg = await _send_to_channel(channel, build_panel_embed(survey), build_panel_view(survey))
    p = await ensure_survey_schema(guild.id)
    async with p.acquire() as conn:
        await conn.execute(
            'UPDATE surveys SET channel_id = $1, message_id = $2 WHERE id = $3',
            msg.channel.id, msg.id, survey_id,
        )


async def post_survey_results(guild: discord.Guild, channel, survey_id: int):
    """IPC から呼ばれる: 集計結果を投稿する。"""
    survey = await get_survey(guild.id, survey_id)
    if not survey:
        return
    responses = await get_responses(guild.id, survey_id)
    await _send_to_channel(channel, build_results_embed(survey, responses))


async def refresh_survey_panel(guild: discord.Guild, survey_id: int):
    """IPC から呼ばれる: 受付状態の変更などを投稿済みパネルに反映する。"""
    survey = await get_survey(guild.id, survey_id)
    if not survey or not survey.get("channel_id") or not survey.get("message_id"):
        return
    channel = guild.get_channel_or_thread(survey["channel_id"])
    if channel is None:
        try:
            channel = await guild.fetch_channel(survey["channel_id"])
        except (discord.NotFound, discord.Forbidden):
            return
    try:
        msg = await channel.fetch_message(survey["message_id"])
        await msg.edit(embed=build_panel_embed(survey), view=build_panel_view(survey))
    except (discord.NotFound, discord.Forbidden):
        pass


class SurveyTextModal(discord.ui.Modal):
    def __init__(self, flow: "SurveyFlowView", question: dict):
        super().__init__(title=(question.get("title") or "回答")[:45], timeout=600)
        self.flow = flow
        self.question = question
        current = flow.answers.get(question["id"])
        self.input = discord.ui.TextInput(
            label=(question.get("title") or "回答")[:45],
            style=discord.TextStyle.paragraph,
            required=bool(question.get("required")),
            max_length=1000,
            default=current if isinstance(current, str) else None,
        )
        self.add_item(self.input)

    async def on_submit(self, interaction: discord.Interaction):
        text = self.input.value.strip()
        if text:
            self.flow.answers[self.question["id"]] = text
        else:
            self.flow.answers.pop(self.question["id"], None)
        self.flow.index += 1
        await self.flow.render(interaction)


class SurveyChoiceSelect(discord.ui.Select):
    def __init__(self, flow: "SurveyFlowView", question: dict):
        options_text = [str(o) for o in question.get("options", [])][:25]
        current = flow.answers.get(question["id"])
        selected = set(current if isinstance(current, list) else [current] if current else [])
        multi = question.get("type") == "multi"
        super().__init__(
            placeholder="複数選択できます" if multi else "1つ選んでください",
            min_values=1,
            max_values=len(options_text) if multi else 1,
            options=[
                discord.SelectOption(label=o[:100], value=str(i), default=o in selected)
                for i, o in enumerate(options_text)
            ],
        )
        self.flow = flow
        self.question = question
        self.options_text = options_text

    async def callback(self, interaction: discord.Interaction):
        picked = [self.options_text[int(v)] for v in self.values]
        if self.question.get("type") == "multi":
            self.flow.answers[self.question["id"]] = picked
        else:
            self.flow.answers[self.question["id"]] = picked[0]
        self.flow.index += 1
        await self.flow.render(interaction)


class SurveyFlowView(discord.ui.View):
    """回答者だけに見えるメッセージで、1問ずつ回答してもらう。"""

    def __init__(self, survey: dict, user_id: int, answers: dict | None = None):
        super().__init__(timeout=900)
        self.survey = survey
        self.questions = survey["questions"]
        self.user_id = user_id
        self.answers: dict = dict(answers or {})
        self.index = 0

    def _format_answer(self, q: dict) -> str:
        val = self.answers.get(q["id"])
        if isinstance(val, list):
            return "、".join(val) if val else "（未回答）"
        return str(val) if val else "（未回答）"

    def _build(self) -> discord.Embed:
        self.clear_items()
        total = len(self.questions)
        if self.index >= total:
            embed = discord.Embed(
                title=f"📋 {self.survey['title']} — 回答の確認",
                description="以下の内容で送信します。よろしければ「送信する」を押してください。",
                color=discord.Color.teal(),
            )
            for i, q in enumerate(self.questions[:25], start=1):
                embed.add_field(name=f"Q{i}. {q.get('title', '')}"[:256], value=self._format_answer(q)[:1024], inline=False)
            self._add_button("送信する", discord.ButtonStyle.success, self.on_submit, emoji="✅")
            if total:
                self._add_button("戻る", discord.ButtonStyle.secondary, self.on_back, emoji="◀")
            self._add_button("やめる", discord.ButtonStyle.danger, self.on_cancel)
            return embed

        q = self.questions[self.index]
        qtype = q.get("type")
        required = bool(q.get("required"))
        embed = discord.Embed(
            title=f"Q{self.index + 1} / {total}" + ("（必須）" if required else "（任意）"),
            description=f"**{q.get('title', '')}**",
            color=discord.Color.teal(),
        )
        if q.get("description"):
            embed.add_field(name="補足", value=str(q["description"])[:1024], inline=False)
        if q["id"] in self.answers:
            embed.add_field(name="現在の回答", value=self._format_answer(q)[:1024], inline=False)

        if qtype in ("single", "multi") and q.get("options"):
            self.add_item(SurveyChoiceSelect(self, q))
        else:
            self._add_button("回答を入力", discord.ButtonStyle.primary, self.on_text, emoji="✏️")
        if self.index > 0:
            self._add_button("戻る", discord.ButtonStyle.secondary, self.on_back, emoji="◀")
        if not required:
            self._add_button("スキップ", discord.ButtonStyle.secondary, self.on_skip)
        elif q["id"] in self.answers:
            self._add_button("次へ", discord.ButtonStyle.secondary, self.on_skip, emoji="▶")
        self._add_button("やめる", discord.ButtonStyle.danger, self.on_cancel)
        return embed

    def _add_button(self, label: str, style: discord.ButtonStyle, handler, emoji: str | None = None):
        btn = discord.ui.Button(label=label, style=style, emoji=emoji, row=1)
        btn.callback = handler
        self.add_item(btn)

    async def render(self, interaction: discord.Interaction):
        embed = self._build()
        await interaction.response.edit_message(content=None, embed=embed, view=self)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.user_id

    async def on_text(self, interaction: discord.Interaction):
        await interaction.response.send_modal(SurveyTextModal(self, self.questions[self.index]))

    async def on_back(self, interaction: discord.Interaction):
        self.index = max(0, self.index - 1)
        await self.render(interaction)

    async def on_skip(self, interaction: discord.Interaction):
        self.index += 1
        await self.render(interaction)

    async def on_cancel(self, interaction: discord.Interaction):
        self.stop()
        await interaction.response.edit_message(content="回答を中止しました。", embed=None, view=None)

    async def on_submit(self, interaction: discord.Interaction):
        guild_id = interaction.guild_id
        survey = await get_survey(guild_id, self.survey["id"])
        if not survey or not is_accepting(survey):
            self.stop()
            await interaction.response.edit_message(content="🔒 このアンケートは受付を終了しました。", embed=None, view=None)
            return

        # 設問が変更されていても、今ある設問の回答だけを保存する
        valid_ids = {q.get("id") for q in survey["questions"]}
        answers = {k: v for k, v in self.answers.items() if k in valid_ids}
        missing = [
            i for i, q in enumerate(survey["questions"])
            if q.get("required") and not answers.get(q.get("id"))
        ]
        if missing:
            self.questions = survey["questions"]
            self.index = missing[0]
            embed = self._build()
            await interaction.response.edit_message(content="⚠️ 必須の質問に回答してください。", embed=embed, view=self)
            return

        p = await ensure_survey_schema(guild_id)
        async with p.acquire() as conn:
            if survey.get("allow_edit"):
                await conn.execute(
                    '''INSERT INTO survey_responses (survey_id, guild_id, user_id, user_name, answers)
                       VALUES ($1, $2, $3, $4, $5::jsonb)
                       ON CONFLICT (survey_id, user_id) DO UPDATE SET
                         user_name = EXCLUDED.user_name, answers = EXCLUDED.answers, updated_at = NOW()''',
                    survey["id"], guild_id, interaction.user.id, interaction.user.display_name, json.dumps(answers, ensure_ascii=False),
                )
                inserted = True
            else:
                result = await conn.execute(
                    '''INSERT INTO survey_responses (survey_id, guild_id, user_id, user_name, answers)
                       VALUES ($1, $2, $3, $4, $5::jsonb)
                       ON CONFLICT (survey_id, user_id) DO NOTHING''',
                    survey["id"], guild_id, interaction.user.id, interaction.user.display_name, json.dumps(answers, ensure_ascii=False),
                )
                inserted = result.endswith(" 1")
        self.stop()
        if not inserted:
            await interaction.response.edit_message(content="このアンケートには回答済みです。", embed=None, view=None)
            return
        await interaction.response.edit_message(content="✅ 回答を送信しました。ご協力ありがとうございました！", embed=None, view=None)


class SurveyAnswerButton(discord.ui.DynamicItem[discord.ui.Button], template=r"survey:(?P<survey_id>[0-9]+)"):
    """アンケートごとに固有の custom_id を持つ回答ボタン。"""

    def __init__(self, survey_id: int, label: str = "回答する", disabled: bool = False):
        super().__init__(discord.ui.Button(
            label=label[:80],
            emoji="📝",
            style=discord.ButtonStyle.success,
            custom_id=f"survey:{survey_id}",
            disabled=disabled,
        ))
        self.survey_id = survey_id

    @classmethod
    async def from_custom_id(cls, interaction: discord.Interaction, item: discord.ui.Button, match, /):
        return cls(int(match["survey_id"]))

    async def callback(self, interaction: discord.Interaction):
        try:
            survey = await get_survey(interaction.guild_id, self.survey_id)
            if not survey:
                await interaction.response.send_message("このアンケートは削除されました。", ephemeral=True)
                return
            if not is_accepting(survey):
                await interaction.response.send_message("🔒 このアンケートは受付を終了しました。", ephemeral=True)
                return
            if not survey["questions"]:
                await interaction.response.send_message("このアンケートには質問がありません。", ephemeral=True)
                return
            previous = await get_response(interaction.guild_id, self.survey_id, interaction.user.id)
            if previous is not None and not survey.get("allow_edit"):
                await interaction.response.send_message("このアンケートには回答済みです。", ephemeral=True)
                return
            view = SurveyFlowView(survey, interaction.user.id, previous)
            note = "前回の回答を読み込みました。変更したい質問だけ選び直せます。" if previous is not None else None
            await interaction.response.send_message(content=note, embed=view._build(), view=view, ephemeral=True)
        except Exception as e:
            print(f"[Survey Error] {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message(f"❌ エラーが発生しました: {e}", ephemeral=True)


class Survey(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_dynamic_items(SurveyAnswerButton)

    async def cog_unload(self):
        self.bot.remove_dynamic_items(SurveyAnswerButton)


async def setup(bot):
    await bot.add_cog(Survey(bot))
