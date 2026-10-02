# -*- coding: utf-8 -*-
"""
cogs/poker.py
ポーカー（テキサスホールデム）の Cog。ルールと AI は poker_engine.py。

パネル
 ├ 👥 みんなで遊ぶ: 募集（ロビー）を作る → VCにいる人・招待した人などが参加（自分を含めて最大10人）→ 開始
 │                   賭けONなら全員が同じ参加費を払い、それがそのままチップになる（終了時に残ったチップを通貨で受け取る）
 ├ 🤖 AIと1対1:    DM で AI と対戦（レベル1〜6）。賭けONでレベル4以上なら、持ち込んだ通貨がそのままチップになる
 │                   （AI も同じ額から始め、終了時・席を立ったときに残ったチップを通貨で受け取る）
 │                   賭けOFF・レベル3以下は設定のチップで遊び、通貨は動かない
 └ 📊 自分の戦績
"""
import asyncio
import time

import discord
from discord.ext import commands, tasks

import database
import poker_engine as pe
from helpers import get_setting, create_game_stats_embed, AI_BET_MIN_LEVEL, ai_bet_max, ai_bet_over_max_message

PREFIX = "POKER"
AI_UID = "ai"
AI_MAX_LEVEL = 6
LEVEL_NAMES = pe.AI_LEVEL_NAMES
LOBBY_LIMIT_SEC = 15 * 60
NEXT_HAND_DELAY = 4      # ハンドの結果を出してから次のハンドまで（秒）
AI_THINK_SEC = 1.5       # AI が考えているように見せる間（秒）
COLOR = discord.Color.from_rgb(26, 122, 70)

_bot = None
games: dict = {}    # key: (guild_id, channel_id) または ("dm", user_id)
lobbies: dict = {}  # key: (guild_id, channel_id)


def _truthy(v) -> bool:
    return v is True or str(v).lower() == "true"


def _int_setting(guild_id, key, default, lo, hi):
    raw = get_setting(_bot, f"{PREFIX}_{key}", guild_id) if _bot else None
    try:
        v = int(float(raw))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _currency(guild_id):
    return (get_setting(_bot, "CURRENCY_NAME", guild_id) if _bot else None) or "コイン"


def table_config(guild_id) -> dict:
    """ダッシュボードの設定（未設定は初期値）"""
    bb = _int_setting(guild_id, "BIG_BLIND", 20, 2, 1_000_000)
    sb = _int_setting(guild_id, "SMALL_BLIND", max(1, bb // 2), 1, bb)
    return {
        "start_chips": _int_setting(guild_id, "START_CHIPS", 1000, 10, 100_000_000),
        "sb": sb,
        "bb": bb,
        "blind_up": _int_setting(guild_id, "BLIND_UP_HANDS", 0, 0, 1000),
        "turn_sec": _int_setting(guild_id, "TURN_SECONDS", 60, 15, 600),
        "max_players": _int_setting(guild_id, "MAX_PLAYERS", 10, 2, 10),
        "ai_max_hands": _int_setting(guild_id, "AI_MAX_HANDS", 30, 0, 1000),
        "pvp_max_hands": _int_setting(guild_id, "PVP_MAX_HANDS", 0, 0, 1000),
        "pvp_max_buyin": _int_setting(guild_id, "PVP_MAX_BUYIN", 0, 0, 10 ** 12),
        "bet_enabled": _truthy(get_setting(_bot, f"{PREFIX}_BET_ENABLED", guild_id)) if _bot else False,
    }


async def _reply(interaction: discord.Interaction, msg: str, **kw):
    if interaction.response.is_done():
        await interaction.followup.send(msg, ephemeral=True, **kw)
    else:
        await interaction.response.send_message(msg, ephemeral=True, **kw)


# ============================================================
# 1つの卓
# ============================================================
class PokerGame:
    def __init__(self, mode, guild_id, channel, players, cfg, buyin=0, host_id=None, ai_level=0):
        self.mode = mode                  # "ai" / "pvp"
        self.guild_id = guild_id
        self.channel = channel
        self.cfg = cfg
        # 1人あたりの持ち込み（参加費）。0 でなければチップ＝通貨（持ち込んだ額がそのままチップになる）
        self.buyin = buyin
        self.start = buyin or cfg["start_chips"]  # 最初のチップ
        self.host_id = host_id
        self.ai_level = ai_level
        self.table = pe.PokerTable(players, cfg["sb"], cfg["bb"])
        self.message = None
        self.deadline = 0.0
        self.lock = asyncio.Lock()
        self.finished = False
        self.end_requested = False
        self.timeouts = {}                # uid -> 連続で時間切れになった回数
        self.paid_out = {}                # uid -> 途中で抜けた人に払った額
        self.ai_task = None

    def key(self):
        if self.mode == "ai":
            return ("dm", self.human().uid)
        return (self.guild_id, self.channel.id)

    def human(self):
        return next(p for p in self.table.players if p.uid != AI_UID)

    def player(self, uid):
        i = self.table.seat_of(uid)
        return self.table.players[i] if i >= 0 else None

    @property
    def max_hands(self):
        return self.cfg["ai_max_hands"] if self.mode == "ai" else self.cfg["pvp_max_hands"]


def _player_line(game: PokerGame, idx: int, p: pe.Player) -> str:
    t = game.table
    tags = []
    if idx == t.dealer:
        tags.append("Ⓓ")
    if t.street != "done" and idx == getattr(t, "sb_seat", -1):
        tags.append("SB")
    if t.street != "done" and idx == getattr(t, "bb_seat", -1):
        tags.append("BB")
    status = ""
    if p.leaving and p.stack == 0 and not p.in_hand:
        status = "（退席）"
    elif not p.in_hand:
        status = "（休み）" if p.stack > 0 else "（チップなし）"
    elif p.folded:
        status = "（フォールド）"
    elif p.all_in:
        status = "（オールイン）"
    name = "🤖 AI" if p.uid == AI_UID else f"<@{p.uid}>"
    mark = "▶ " if (t.current == idx and t.street not in ("done", "showdown")) else "　 "
    bet = f" ／ 賭け {p.bet:,}" if p.bet else ""
    return f"{mark}{name} {' '.join(tags)}　💰 {p.stack:,}{bet}{status}"


def table_embed(game: PokerGame) -> discord.Embed:
    t = game.table
    street = pe.STREET_NAMES.get(t.street, "")
    embed = discord.Embed(title=f"🃏 ポーカー　ハンド #{t.hand_no}　{street}", color=COLOR)
    board = pe.cards_text(t.board) if t.board else "🂠 🂠 🂠 🂠 🂠"
    desc = f"**場のカード**\n# {board}\n💰 **ポット: {t.pot():,}**　（ブラインド {t.sb:,}/{t.bb:,}）"
    cur = t.current_player()
    if cur and t.street in ("preflop", "flop", "turn", "river"):
        o = t.options()
        who = "🤖 AI が考えています…" if cur.uid == AI_UID else f"<@{cur.uid}> の番です（<t:{int(game.deadline)}:R> に時間切れ）"
        need = f"　コールに必要: {o['to_call']:,}" if o["to_call"] else ""
        desc += f"\n\n⏳ {who}{need}"
    embed.description = desc
    lines = [_player_line(game, i, p) for i, p in enumerate(t.players) if not (p.leaving and p.stack == 0 and not p.in_hand)]
    embed.add_field(name="プレイヤー", value="\n".join(lines)[:1024] or "—", inline=False)
    if game.mode == "ai":
        me = game.human()
        if me.hole:
            embed.add_field(name="あなたの手札", value=f"## {pe.cards_text(me.hole)}\n{pe.best_hand_name(me.hole + t.board)}", inline=False)
    recent = [x for x in t.log if not x.startswith("—")][-5:]
    if recent:
        embed.add_field(name="直前の行動", value="\n".join(recent)[:1024], inline=False)
    footer = []
    if game.buyin:
        cur = _currency(game.guild_id)
        footer.append(f"チップ＝{cur}（{'持ち込み' if game.mode == 'ai' else '参加費'} {game.buyin:,} {cur}）")
    if game.max_hands:
        footer.append(f"{game.max_hands}ハンドで終了")
    if footer:
        embed.set_footer(text=" ／ ".join(footer))
    return embed


# ============================================================
# 卓の操作ボタン
# ============================================================
class RaiseModal(discord.ui.Modal):
    amount = discord.ui.TextInput(label="レイズ後の額", max_length=12)

    def __init__(self, game: PokerGame, o: dict):
        verb = "ベット" if o["current_bet"] == 0 else "レイズ"
        super().__init__(title=f"{verb}する額")
        self.game = game
        self.amount.label = f"{verb}後の額（{o['min_raise_to']:,}〜{o['max_raise_to']:,}）"
        self.amount.placeholder = str(o["min_raise_to"])

    async def on_submit(self, interaction: discord.Interaction):
        try:
            amt = int(str(self.amount.value).replace(",", "").strip())
        except ValueError:
            return await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        await do_action(interaction, self.game, "raise", amt)


class TableView(discord.ui.View):
    def __init__(self, game: PokerGame):
        super().__init__(timeout=None)
        self.game = game
        t = game.table
        cur = t.current_player()
        active = cur is not None and t.street in ("preflop", "flop", "turn", "river") and cur.uid != AI_UID
        o = t.options() if active else {}

        if game.mode == "pvp":
            self._btn("🂠 手札を見る", discord.ButtonStyle.secondary, 0, self.show_hand)
        self._btn("🚪 退席" if game.mode == "pvp" else ("🚪 席を立つ" if game.buyin else "🏳️ 降参"), discord.ButtonStyle.secondary, 0, self.leave)
        if game.mode == "pvp" and interaction_host_can_end(game):
            self._btn("⏹ このハンドで終了", discord.ButtonStyle.secondary, 0, self.end_after_hand)
        if not active:
            return
        self._btn("フォールド", discord.ButtonStyle.danger, 1, self._act("fold"))
        if o["can_check"]:
            self._btn("チェック", discord.ButtonStyle.primary, 1, self._act("check"))
        else:
            self._btn(f"コール {o['to_call']:,}", discord.ButtonStyle.primary, 1, self._act("call"))
        if o["can_raise"]:
            self._btn(f"オールイン {o['max_raise_to']:,}", discord.ButtonStyle.danger, 1, self._act("allin"))
            verb = "ベット" if o["current_bet"] == 0 else "レイズ"
            seen = set()
            for label, frac in (("最小", None), ("½ポット", 0.5), ("ポット", 1.0)):
                to = o["min_raise_to"] if frac is None else pe._raise_to(t, o, frac)
                if to in seen or to >= o["max_raise_to"]:
                    continue
                seen.add(to)
                self._btn(f"{verb} {to:,}（{label}）", discord.ButtonStyle.success, 2, self._act("raise", to))
            self._btn(f"{verb}額を入力…", discord.ButtonStyle.success, 2, self.raise_custom)

    def _btn(self, label, style, row, cb):
        b = discord.ui.Button(label=label[:80], style=style, row=row)
        b.callback = cb
        self.add_item(b)

    def _act(self, action, amount=0):
        async def cb(interaction: discord.Interaction):
            await do_action(interaction, self.game, action, amount)
        return cb

    async def raise_custom(self, interaction: discord.Interaction):
        g = self.game
        cur = g.table.current_player()
        if g.finished or not cur or cur.uid != interaction.user.id:
            return await interaction.response.send_message("今はあなたの番ではありません。", ephemeral=True)
        await interaction.response.send_modal(RaiseModal(g, g.table.options()))

    async def show_hand(self, interaction: discord.Interaction):
        p = self.game.player(interaction.user.id)
        if not p:
            return await interaction.response.send_message("この卓のプレイヤーではありません。", ephemeral=True)
        if not p.hole or not p.in_hand:
            return await interaction.response.send_message("このハンドには参加していません。", ephemeral=True)
        t = self.game.table
        text = f"## {pe.cards_text(p.hole)}\n今の役: **{pe.best_hand_name(p.hole + t.board)}**" + ("（フォールド済み）" if p.folded else "")
        await interaction.response.send_message(text, ephemeral=True)

    async def leave(self, interaction: discord.Interaction):
        g = self.game
        p = g.player(interaction.user.id)
        if not p or p.uid == AI_UID:
            return await interaction.response.send_message("この卓のプレイヤーではありません。", ephemeral=True)
        if g.mode == "ai":
            if g.buyin:
                return await interaction.response.send_message(
                    f"席を立ちますか？今のハンドに出したチップは失い、残りのチップをそのまま {_currency(g.guild_id)} で受け取ります。",
                    view=ConfirmView(g, interaction.user.id), ephemeral=True)
            return await interaction.response.send_message("本当に降参しますか？AIの勝ちになります。", view=ConfirmView(g, interaction.user.id), ephemeral=True)
        await interaction.response.send_message(
            "退席しますか？今のハンドはフォールド扱いになり、ハンドが終わった時点のチップで精算します。",
            view=ConfirmView(g, interaction.user.id), ephemeral=True)

    async def end_after_hand(self, interaction: discord.Interaction):
        g = self.game
        if interaction.user.id != g.host_id:
            return await interaction.response.send_message("卓を作った人だけが終了できます。", ephemeral=True)
        g.end_requested = True
        await interaction.response.send_message("⏹ このハンドが終わったら卓を終了して精算します。", ephemeral=True)


def interaction_host_can_end(game: PokerGame) -> bool:
    return game.mode == "pvp" and not game.end_requested


class ConfirmView(discord.ui.View):
    def __init__(self, game: PokerGame, uid: int):
        super().__init__(timeout=60)
        self.game = game
        self.uid = uid

    @discord.ui.button(label="はい", style=discord.ButtonStyle.danger)
    async def yes(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        g = self.game
        await interaction.response.edit_message(content="✅ 受け付けました。", view=None)
        if g.finished:
            return
        async with g.lock:
            if g.mode == "ai":
                await finish_game(g, resigned=True)
                return
            p = g.player(self.uid)
            if not p:
                return
            p.leaving = True
            t = g.table
            cur = t.current_player()
            if p.in_hand and not p.folded and t.street in ("preflop", "flop", "turn", "river"):
                if cur and cur.uid == p.uid:
                    t.act(p.uid, "fold")
                    await after_action(g)
                    return
                # 自分の番ではないときは、フォールドしたことにする（番が来たときに飛ばされる）
                p.folded = True
                t.log.append(f"{_name(g, p)} が退席（フォールド）")
                t._check_round(advance=False)
                await after_action(g)
                return
            # 今のハンドに賭けていない（フォールド済み・ハンドの合間）なら、すぐ精算して席を空ける
            await cash_out(g, p, note="退席")
            if t.street != "done":
                await refresh(g)

    @discord.ui.button(label="やめる", style=discord.ButtonStyle.secondary)
    async def no(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.stop()
        await interaction.response.edit_message(content="続けます。", view=None)


def _name(game, p):
    return "AI" if p.uid == AI_UID else p.name


async def do_action(interaction: discord.Interaction, game: PokerGame, action: str, amount: int = 0):
    if game.finished:
        return await _reply(interaction, "この卓は終わっています。")
    cur = game.table.current_player()
    if not cur or cur.uid != interaction.user.id:
        return await _reply(interaction, "今はあなたの番ではありません。")
    async with game.lock:
        cur = game.table.current_player()
        if game.finished or not cur or cur.uid != interaction.user.id:
            return await _reply(interaction, "今はあなたの番ではありません。")
        try:
            game.table.act(cur.uid, action, amount)
        except ValueError as e:
            return await _reply(interaction, f"❌ {e}")
        game.timeouts[cur.uid] = 0
        # ボタンを押したメッセージをそのまま更新する（無駄なメッセージを増やさない）
        if not interaction.response.is_done() and interaction.message and game.message and interaction.message.id == game.message.id:
            try:
                await interaction.response.defer()
            except Exception:
                pass
        else:
            try:
                await interaction.response.defer(ephemeral=True)
            except Exception:
                pass
        await after_action(game)


# ============================================================
# 進行
# ============================================================
async def refresh(game: PokerGame):
    """卓のメッセージを今の状態に更新し、手番の締め切りを決める"""
    t = game.table
    cur = t.current_player()
    if cur and t.street in ("preflop", "flop", "turn", "river"):
        game.deadline = time.time() + (game.cfg["turn_sec"] if cur.uid != AI_UID else 120)
    embed = table_embed(game)
    view = TableView(game)
    try:
        if game.message:
            await game.message.edit(embed=embed, view=view)
        else:
            game.message = await game.channel.send(embed=embed, view=view)
    except discord.NotFound:
        game.message = await game.channel.send(embed=embed, view=view)
    except Exception as e:
        print(f"[poker] refresh failed: {e}")
    if cur and cur.uid == AI_UID and t.street in ("preflop", "flop", "turn", "river"):
        # AI が続けて行動する（コール → 次のストリートで最初に行動）ときは、今動いている AI の処理自身から次を予約する
        running = game.ai_task and not game.ai_task.done() and game.ai_task is not asyncio.current_task()
        if not running:
            game.ai_task = asyncio.create_task(ai_turn(game))


async def ai_turn(game: PokerGame):
    await asyncio.sleep(AI_THINK_SEC)
    async with game.lock:
        t = game.table
        cur = t.current_player()
        if game.finished or not cur or cur.uid != AI_UID:
            return
        try:
            action, amount = await asyncio.to_thread(pe.ai_decide, t, AI_UID)
            if action == "check" and not t.options()["can_check"]:
                action = "call"
            t.act(AI_UID, action, amount)
        except Exception as e:
            print(f"[poker] AI error: {e}")
            o = t.options()
            t.act(AI_UID, "check" if o.get("can_check") else "fold")
        await after_action(game)


async def after_action(game: PokerGame):
    """行動のあと: ハンドが終わったら結果を出して次へ、続くなら卓を更新"""
    if game.table.street == "done":
        await hand_finished(game)
    else:
        await refresh(game)


def result_embed(game: PokerGame) -> discord.Embed:
    t = game.table
    res = t.result or {}
    embed = discord.Embed(title=f"🏁 ハンド #{t.hand_no} の結果", color=discord.Color.gold())
    lines = []
    for pr in res.get("pots", []):
        names = "・".join("🤖 AI" if u == AI_UID else f"<@{u}>" for u in pr["winners"])
        hand = f"（{pr['hand']}）" if pr.get("hand") else ""
        lines.append(f"🏆 {names} が **{pr['amount']:,}** を獲得{hand}")
    if not res.get("showdown"):
        lines.append("ほかの全員がフォールドしました。")
    embed.description = "\n".join(lines)
    if t.board:
        embed.add_field(name="場のカード", value=pe.cards_text(t.board), inline=False)
    if res.get("showdown"):
        shown = []
        for uid, (hole, name) in res["hands"].items():
            who = "🤖 AI" if uid == AI_UID else f"<@{uid}>"
            shown.append(f"{who}: {pe.cards_text(hole)}　{name}")
        embed.add_field(name="手札", value="\n".join(shown)[:1024], inline=False)
    return embed


async def hand_finished(game: PokerGame):
    t = game.table
    # 卓のメッセージは消して、結果だけを残す（ハンドごとにメッセージが増えすぎないように）
    try:
        if game.message:
            await game.message.delete()
    except Exception:
        pass
    game.message = None
    try:
        await game.channel.send(embed=result_embed(game))
    except Exception as e:
        print(f"[poker] result send failed: {e}")

    # 退席した人を精算
    if game.mode == "pvp":
        for p in t.players:
            if p.leaving and p.stack > 0:
                await cash_out(game, p, note="退席")
    # 終わりかどうか
    alive = [p for p in t.players if p.stack > 0 and not p.leaving]
    over = len(alive) < 2 or game.end_requested or (game.max_hands and t.hand_no >= game.max_hands)
    if over:
        await finish_game(game)
        return
    # ブラインドを上げる
    up = game.cfg["blind_up"]
    if up and t.hand_no % up == 0:
        t.sb *= 2
        t.bb *= 2
        t.last_raise = t.bb
        try:
            await game.channel.send(f"⏫ ブラインドが **{t.sb:,} / {t.bb:,}** に上がりました。")
        except Exception:
            pass
    asyncio.create_task(_next_hand_later(game))


async def _next_hand_later(game: PokerGame):
    await asyncio.sleep(NEXT_HAND_DELAY)
    async with game.lock:
        if game.finished:
            return
        if not game.table.start_hand():
            await finish_game(game)
            return
        await after_action(game)  # ブラインドだけで全員オールインならそのまま決着する


async def cash_out(game: PokerGame, p: pe.Player, note: str = ""):
    """PvP: 残ったチップをそのまま通貨に戻す（参加費なしならチップを消すだけ）"""
    chips = p.stack
    p.stack = 0
    payout = chips if game.buyin else 0
    game.paid_out[p.uid] = game.paid_out.get(p.uid, 0) + payout
    if payout:
        try:
            await database.add_balance(game.guild_id, p.uid, payout)
        except Exception as e:
            print(f"[poker] cash_out failed: {e}")
    await _record(game, p.uid, chips, payout)
    if note:
        try:
            cur = _currency(game.guild_id)
            money = f"（{payout:,} {cur} を受け取り）" if game.buyin else ""
            await game.channel.send(f"🚪 <@{p.uid}> が{note}しました。チップ {chips:,}{money}")
        except Exception:
            pass


async def _record(game: PokerGame, uid, chips: int, payout: int):
    if not game.guild_id or uid == AI_UID:
        return
    start = game.start
    is_win, is_draw = chips > start, chips == start
    mode = "ai" if game.mode == "ai" else "pvp"
    try:
        await database.record_game_result(game.guild_id, uid, "poker", is_win=is_win, is_draw=is_draw,
                                          bet=game.buyin, payout=payout,
                                          custom_extra={f"{mode}_{'draws' if is_draw else 'wins' if is_win else 'losses'}": 1})
    except Exception as e:
        print(f"[poker] record_game_result failed: {e}")


async def finish_game(game: PokerGame, resigned: bool = False):
    if game.finished:
        return
    game.finished = True
    games.pop(game.key(), None)
    t = game.table
    cur = _currency(game.guild_id)
    try:
        if game.message:
            await game.message.edit(view=None)
    except Exception:
        pass
    embed = discord.Embed(title="🃏 ポーカー終了", color=discord.Color.gold())

    if game.mode == "ai":
        me = game.human()
        ai = game.player(AI_UID)
        if t.street not in ("done", "waiting"):
            if resigned and game.buyin:
                # 通貨チップで席を立った: 今のハンドに出したチップはフォールドしたものとして AI のもの
                ai.stack += t.pot()
            else:
                # 途中のハンドで出していたチップは、出した人に戻して比べる
                for p in t.players:
                    p.stack += p.total_in
            for p in t.players:
                p.total_in = 0
        if game.buyin:
            # 通貨チップ: 持ち込んだ額より増えたら勝ち
            result = "win" if me.stack > game.buyin else "lose" if me.stack < game.buyin else "draw"
        elif resigned:
            result = "lose"
        elif me.stack > ai.stack:
            result = "win"
        elif me.stack < ai.stack:
            result = "lose"
        else:
            result = "draw"
        lv = f"Lv{game.ai_level}（{LEVEL_NAMES.get(game.ai_level)}）"
        left = "（途中で席を立ちました）" if resigned and game.buyin else "（降参）" if resigned else ""
        embed.description = {
            "win": f"🏆🎉 **<@{me.uid}> の勝ち！** AI {lv} に勝利しました{left}",
            "lose": f"🤖 **AI {lv} の勝ち**{left}\n次回のリベンジをお待ちしています！",
            "draw": f"🤝 **引き分け**{left}",
        }[result]
        embed.add_field(name="最終チップ", value=f"あなた {me.stack:,} ／ AI {ai.stack:,}（{t.hand_no}ハンド）", inline=False)
        payout = 0
        if game.buyin:
            # チップ＝通貨: 残ったチップをそのまま受け取る
            payout = me.stack
            diff = payout - game.buyin
            embed.add_field(name="💰 精算", value=f"持ち込み **{game.buyin:,}** → **{payout:,} {cur}**（{'+' if diff >= 0 else ''}{diff:,}）", inline=False)
            if payout:
                try:
                    await database.add_balance(game.guild_id, me.uid, payout)
                except Exception as e:
                    print(f"[poker] AI payout failed: {e}")
            await _record(game, me.uid, me.stack, payout)
        else:
            start = game.start
            chips_for_record = start + 1 if result == "win" else (start if result == "draw" else start - 1)
            await _record(game, me.uid, chips_for_record, payout)
    else:
        # 途中のハンドがあれば出したチップを戻す（強制終了のとき）
        if t.street not in ("done", "waiting"):
            for p in t.players:
                p.stack += p.total_in
                p.total_in = 0
        standings = []
        for p in t.players:
            if p.uid in game.paid_out and p.stack == 0:
                continue
            chips = p.stack
            await cash_out(game, p)
            standings.append((chips, p.uid, game.paid_out.get(p.uid, 0)))
        standings.sort(reverse=True)
        lines = []
        for i, (chips, uid, paid) in enumerate(standings):
            medal = ["🥇", "🥈", "🥉"][i] if i < 3 else f"{i + 1}."
            money = f"　→ {paid:,} {cur}" if game.buyin else ""
            lines.append(f"{medal} <@{uid}>　チップ {chips:,}{money}")
        embed.description = f"{t.hand_no}ハンドで終了しました。\n\n" + "\n".join(lines)
        if game.buyin:
            embed.set_footer(text=f"参加費 {game.buyin:,} {cur}。チップ＝{cur}なので、残ったチップをそのまま受け取りました")
    try:
        await game.channel.send(embed=embed)
    except Exception as e:
        print(f"[poker] finish send failed: {e}")


# ============================================================
# AI 対戦の開始
# ============================================================
class BetModal(discord.ui.Modal):
    bet_input = discord.ui.TextInput(label="持ち込む金額（そのままチップになります）", placeholder="例: 1000", max_length=12, required=True)

    def __init__(self, level: int, max_bet: int):
        super().__init__(title="ポーカー：持ち込む金額（チップ＝通貨）")
        self.level = level
        if max_bet:
            self.bet_input.label = f"持ち込む金額（上限 {max_bet:,}・そのままチップに）"

    async def on_submit(self, interaction: discord.Interaction):
        try:
            bet = int(str(self.bet_input.value).replace(",", "").strip())
        except ValueError:
            return await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        if bet <= 0:
            return await interaction.response.send_message("1以上の金額を入力してください。", ephemeral=True)
        await start_ai_game(interaction, self.level, bet)


class DifficultyView(discord.ui.View):
    def __init__(self, user_id: int):
        super().__init__(timeout=120)
        self.user_id = user_id
        for lv in range(1, AI_MAX_LEVEL + 1):
            style = discord.ButtonStyle.secondary if lv <= 2 else discord.ButtonStyle.primary if lv <= 3 else discord.ButtonStyle.danger
            b = discord.ui.Button(label=f"レベル{lv}（{LEVEL_NAMES[lv]}）", style=style, row=0 if lv <= 3 else 1)
            b.callback = self._make(lv)
            self.add_item(b)

    def _make(self, level):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id != self.user_id:
                return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
            guild_id = interaction.guild.id if interaction.guild else None
            cfg = table_config(guild_id)
            if level >= AI_BET_MIN_LEVEL and cfg["bet_enabled"]:
                max_bet = ai_bet_max(interaction.client, PREFIX, guild_id, level)
                await interaction.response.send_modal(BetModal(level, max_bet))
            else:
                await interaction.response.defer(ephemeral=True)
                await start_ai_game(interaction, level, 0)
        return cb


async def start_ai_game(interaction: discord.Interaction, level: int, bet: int):
    guild_id = interaction.guild.id if interaction.guild else None
    user = interaction.user
    if level < AI_BET_MIN_LEVEL:
        bet = 0
    if ("dm", user.id) in games:
        return await _reply(interaction, "DMでポーカーのAI対戦がすでに進行中です。先に終わらせてください。")
    over = ai_bet_over_max_message(interaction.client, PREFIX, guild_id, level, bet)
    if over:
        return await _reply(interaction, over)
    cfg = table_config(guild_id)
    if bet and bet < cfg["bb"]:
        return await _reply(interaction, f"持ち込む金額はビッグブラインド（{cfg['bb']:,}）以上にしてください。")
    if bet > 0 and guild_id:
        if not await database.remove_balance(guild_id, user.id, bet):
            bal = await database.get_balance(guild_id, user.id)
            return await _reply(interaction, f"残高不足です。現在の残高: {bal:,} {_currency(guild_id)}")
    try:
        dm = await user.create_dm()
    except discord.HTTPException:
        if bet > 0 and guild_id:
            await database.add_balance(guild_id, user.id, bet)
        return await _reply(interaction, "DMを送れませんでした。BotからのDMを許可してください。")
    start = bet or cfg["start_chips"]  # 賭けるときは持ち込んだ額がそのままチップ（AI も同じ額）
    players = [
        pe.Player(user.id, getattr(user, "display_name", user.name), start),
        pe.Player(AI_UID, "AI", start, is_ai=True, ai_level=level),
    ]
    game = PokerGame("ai", guild_id, dm, players, cfg, buyin=bet, host_id=user.id, ai_level=level)
    games[game.key()] = game
    hands = f"{cfg['ai_max_hands']}ハンド終了時にチップが多い方の勝ち（どちらかのチップがなくなったらその時点で終了）" if cfg["ai_max_hands"] else "どちらかのチップがなくなるまで"
    cur = _currency(guild_id)
    bet_text = (f"\n💰 チップ＝{cur}：持ち込んだ {bet:,} {cur} がそのままチップです。終了時（または席を立ったとき）に残ったチップを {cur} で受け取ります。"
                if bet else "\n（賭けなし：チップは通貨に影響しません）")
    await _reply(interaction, f"✅ ポーカーのAI対戦（レベル{level}: {LEVEL_NAMES[level]}）を始めます！DMを確認してください。")
    try:
        await dm.send(f"🃏 **ポーカー AI対戦**（レベル{level}: {LEVEL_NAMES[level]}）\n"
                      f"お互いチップ {start:,} から、{hands}。{bet_text}")
    except discord.HTTPException:
        games.pop(game.key(), None)
        if bet > 0 and guild_id:
            await database.add_balance(guild_id, user.id, bet)
        return await _reply(interaction, "DMを送れませんでした。BotからのDMを許可してください。")
    async with game.lock:
        game.table.start_hand()
        await after_action(game)  # ブラインドだけで全員オールインならそのまま決着する


# ============================================================
# みんなで遊ぶ（ロビー）
# ============================================================
class Lobby:
    def __init__(self, guild_id, channel, host_id, buyin, cfg):
        self.guild_id = guild_id
        self.channel = channel
        self.host_id = host_id
        self.buyin = buyin
        self.cfg = cfg
        self.players = [host_id]
        self.invited = set()
        self.message = None
        self.created = time.time()
        self.closed = False

    def key(self):
        return (self.guild_id, self.channel.id)


def lobby_embed(lb: Lobby) -> discord.Embed:
    cfg = lb.cfg
    cur = _currency(lb.guild_id)
    e = discord.Embed(title="🃏 ポーカー参加者募集", color=COLOR)
    e.description = (f"<@{lb.host_id}> がポーカーの卓を開きました！「✋ 参加する」で参加できます。\n"
                     f"（自分を含めて最大 {cfg['max_players']} 人。<t:{int(lb.created + LOBBY_LIMIT_SEC)}:R> に締め切り）")
    e.add_field(name=f"参加者（{len(lb.players)}/{cfg['max_players']}）", value="\n".join(f"・<@{u}>" + (" 👑" if u == lb.host_id else "") for u in lb.players), inline=False)
    rules = f"チップ {lb.buyin or cfg['start_chips']:,} から ／ ブラインド {cfg['sb']:,}/{cfg['bb']:,}"
    if cfg["blind_up"]:
        rules += f"（{cfg['blind_up']}ハンドごとに2倍）"
    if cfg["pvp_max_hands"]:
        rules += f" ／ {cfg['pvp_max_hands']}ハンドで終了"
    rules += f" ／ 持ち時間 {cfg['turn_sec']}秒"
    e.add_field(name="ルール", value=rules, inline=False)
    if lb.buyin:
        e.add_field(name="💰 参加費（チップ＝通貨）", value=f"**{lb.buyin:,} {cur}**（開始時に払い、そのままチップになります。終了時・退席時に残ったチップを {cur} で受け取ります）", inline=False)
    else:
        e.add_field(name="賭けなし", value="チップは通貨に影響しません", inline=False)
    return e


class LobbyView(discord.ui.View):
    def __init__(self, lb: Lobby):
        super().__init__(timeout=None)
        self.lb = lb

    async def _update(self, interaction: discord.Interaction):
        await interaction.response.edit_message(embed=lobby_embed(self.lb), view=self)

    @discord.ui.button(label="✋ 参加する", style=discord.ButtonStyle.success, row=0)
    async def join(self, interaction: discord.Interaction, button: discord.ui.Button):
        lb = self.lb
        if lb.closed:
            return await interaction.response.send_message("この募集は終わっています。", ephemeral=True)
        uid = interaction.user.id
        if uid in lb.players:
            return await interaction.response.send_message("すでに参加しています。", ephemeral=True)
        if len(lb.players) >= lb.cfg["max_players"]:
            return await interaction.response.send_message("満員です。", ephemeral=True)
        if lb.buyin and await database.get_balance(lb.guild_id, uid) < lb.buyin:
            return await interaction.response.send_message(f"参加費 {lb.buyin:,} {_currency(lb.guild_id)} に残高が足りません。", ephemeral=True)
        lb.players.append(uid)
        await self._update(interaction)

    @discord.ui.button(label="🚪 抜ける", style=discord.ButtonStyle.secondary, row=0)
    async def leave(self, interaction: discord.Interaction, button: discord.ui.Button):
        lb = self.lb
        uid = interaction.user.id
        if uid == lb.host_id:
            return await interaction.response.send_message("募集した人は抜けられません。やめるときは「✖ 解散」を押してください。", ephemeral=True)
        if uid not in lb.players:
            return await interaction.response.send_message("参加していません。", ephemeral=True)
        lb.players.remove(uid)
        await self._update(interaction)

    @discord.ui.button(label="📨 招待する", style=discord.ButtonStyle.primary, row=1)
    async def invite(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.lb.host_id:
            return await interaction.response.send_message("募集した人だけが招待できます。", ephemeral=True)
        await interaction.response.send_message("招待する人を選んでください（複数可）。", view=InviteSelectView(self.lb), ephemeral=True)

    @discord.ui.button(label="🔊 VCの人を呼ぶ", style=discord.ButtonStyle.primary, row=1)
    async def call_vc(self, interaction: discord.Interaction, button: discord.ui.Button):
        lb = self.lb
        if interaction.user.id != lb.host_id:
            return await interaction.response.send_message("募集した人だけが呼べます。", ephemeral=True)
        member = interaction.guild.get_member(lb.host_id) if interaction.guild else None
        vc = member.voice.channel if member and member.voice else None
        if not vc:
            return await interaction.response.send_message("あなたは今VCに入っていません。", ephemeral=True)
        targets = [m for m in vc.members if not m.bot and m.id not in lb.players]
        if not targets:
            return await interaction.response.send_message("VCにいる人はみんな参加済みです。", ephemeral=True)
        await interaction.response.send_message(f"🔊 {vc.mention} の {len(targets)} 人に声をかけました。", ephemeral=True)
        await lb.channel.send(" ".join(m.mention for m in targets) + f"\n🃏 <@{lb.host_id}> がポーカーに誘っています！上の募集の「✋ 参加する」から参加できます。",
                              allowed_mentions=discord.AllowedMentions(users=True))

    @discord.ui.button(label="▶ 開始", style=discord.ButtonStyle.success, row=2)
    async def start(self, interaction: discord.Interaction, button: discord.ui.Button):
        lb = self.lb
        if interaction.user.id != lb.host_id:
            return await interaction.response.send_message("募集した人だけが開始できます。", ephemeral=True)
        if len(lb.players) < 2:
            return await interaction.response.send_message("2人以上集まったら開始できます。", ephemeral=True)
        if lb.key() in games:
            return await interaction.response.send_message("このチャンネルではすでにポーカーの卓が進行中です。", ephemeral=True)
        lb.closed = True
        lobbies.pop(lb.key(), None)
        self.stop()
        await interaction.response.edit_message(content="✅ 開始しました！", embed=lobby_embed(lb), view=None)
        await start_pvp_game(lb)

    @discord.ui.button(label="✖ 解散", style=discord.ButtonStyle.danger, row=2)
    async def disband(self, interaction: discord.Interaction, button: discord.ui.Button):
        lb = self.lb
        if interaction.user.id != lb.host_id:
            return await interaction.response.send_message("募集した人だけが解散できます。", ephemeral=True)
        lb.closed = True
        lobbies.pop(lb.key(), None)
        self.stop()
        await interaction.response.edit_message(content="✖ 募集を解散しました。", embed=None, view=None)


class InviteSelectView(discord.ui.View):
    def __init__(self, lb: Lobby):
        super().__init__(timeout=120)
        self.lb = lb

    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="招待する人を選ぶ…", min_values=1, max_values=9)
    async def pick(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        lb = self.lb
        targets = [u for u in select.values if not u.bot and u.id not in lb.players]
        if not targets:
            return await interaction.response.edit_message(content="招待できる人がいません（Botや参加済みの人は招待できません）。", view=None)
        lb.invited.update(u.id for u in targets)
        await interaction.response.edit_message(content=f"📨 {len(targets)} 人を招待しました。", view=None)
        jump = lb.message.jump_url if lb.message else lb.channel.mention
        await lb.channel.send(" ".join(u.mention for u in targets) + f"\n📨 <@{lb.host_id}> からポーカーの招待です！ {jump} の「✋ 参加する」から参加できます。",
                              allowed_mentions=discord.AllowedMentions(users=True))
        for u in targets:
            try:
                await u.send(f"📨 **{interaction.guild.name}** で <@{lb.host_id}> からポーカーに招待されました！\n{jump} の「✋ 参加する」から参加できます。")
            except Exception:
                pass


class LobbyBuyinModal(discord.ui.Modal):
    buyin_input = discord.ui.TextInput(label="参加費（全員同じ額・そのままチップに）", placeholder="空欄・0 で賭けなし", max_length=12, required=False)

    def __init__(self, max_buyin: int):
        super().__init__(title="ポーカー：参加費を決める")
        self.max_buyin = max_buyin
        if max_buyin:
            self.buyin_input.label = f"参加費（上限 {max_buyin:,}・空欄で賭けなし）"

    async def on_submit(self, interaction: discord.Interaction):
        raw = (self.buyin_input.value or "").replace(",", "").strip()
        try:
            buyin = int(raw) if raw else 0
        except ValueError:
            return await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        if buyin < 0:
            return await interaction.response.send_message("0以上の金額を入力してください。", ephemeral=True)
        if self.max_buyin and buyin > self.max_buyin:
            return await interaction.response.send_message(f"参加費の上限は {self.max_buyin:,} です。", ephemeral=True)
        bb = table_config(interaction.guild.id)["bb"]
        if buyin and buyin < bb:
            return await interaction.response.send_message(f"参加費はビッグブラインド（{bb:,}）以上にしてください。", ephemeral=True)
        await open_lobby(interaction, buyin)


def _pick_channel(interaction: discord.Interaction):
    """通話中ならその通話のチャット → プレイ進行チャンネル → 今のチャンネル"""
    guild = interaction.guild
    member = guild.get_member(interaction.user.id) if guild else None
    if member and member.voice and member.voice.channel:
        return member.voice.channel
    raw = get_setting(interaction.client, f"{PREFIX}_GAME_CHANNEL", guild.id)
    if raw:
        try:
            ch = guild.get_channel(int(raw))
            if ch:
                return ch
        except (TypeError, ValueError):
            pass
    return interaction.channel


async def open_lobby(interaction: discord.Interaction, buyin: int):
    guild = interaction.guild
    cfg = table_config(guild.id)
    if buyin and await database.get_balance(guild.id, interaction.user.id) < buyin:
        return await _reply(interaction, "残高が足りません。")
    channel = _pick_channel(interaction)
    key = (guild.id, channel.id)
    if key in games:
        return await _reply(interaction, f"{channel.mention} ではすでにポーカーの卓が進行中です。")
    if key in lobbies and not lobbies[key].closed:
        return await _reply(interaction, f"{channel.mention} ではすでに参加者を募集中です。")
    lb = Lobby(guild.id, channel, interaction.user.id, buyin, cfg)
    lobbies[key] = lb
    await _reply(interaction, f"✅ {channel.mention} で参加者の募集を始めました！")
    content = None
    if isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
        others = [m for m in channel.members if not m.bot and m.id != interaction.user.id]
        if others:
            content = " ".join(m.mention for m in others) + "\n🔊 この通話でポーカーを始めます！"
    try:
        lb.message = await channel.send(content=content, embed=lobby_embed(lb), view=LobbyView(lb),
                                        allowed_mentions=discord.AllowedMentions(users=True))
    except Exception as e:
        lobbies.pop(key, None)
        print(f"[poker] lobby send failed: {e}")
        await _reply(interaction, f"{channel.mention} にメッセージを送れませんでした。")


async def start_pvp_game(lb: Lobby):
    guild = _bot.get_guild(lb.guild_id)
    cur = _currency(lb.guild_id)
    paid, failed = [], []
    for uid in lb.players:
        if lb.buyin:
            if await database.remove_balance(lb.guild_id, uid, lb.buyin):
                paid.append(uid)
            else:
                failed.append(uid)
        else:
            paid.append(uid)
    if failed:
        await lb.channel.send(" ".join(f"<@{u}>" for u in failed) + f" は参加費 {lb.buyin:,} {cur} が足りないため参加できませんでした。")
    if len(paid) < 2:
        for uid in paid:
            if lb.buyin:
                await database.add_balance(lb.guild_id, uid, lb.buyin)
        await lb.channel.send("参加できる人が2人未満のため、開始できませんでした。（参加費は返しました）")
        return
    cfg = lb.cfg
    players = []
    for uid in paid:
        m = guild.get_member(uid) if guild else None
        players.append(pe.Player(uid, m.display_name if m else str(uid), lb.buyin or cfg["start_chips"]))
    game = PokerGame("pvp", lb.guild_id, lb.channel, players, cfg, buyin=lb.buyin, host_id=lb.host_id)
    games[game.key()] = game
    await lb.channel.send(f"🃏 **ポーカー開始！** {len(players)}人　（自分の手札は「🂠 手札を見る」で確認できます）")
    async with game.lock:
        game.table.start_hand()
        await after_action(game)  # ブラインドだけで全員オールインならそのまま決着する


# ============================================================
# パネル
# ============================================================
def panel_embed() -> discord.Embed:
    return discord.Embed(
        title="🃏 ポーカー（テキサスホールデム）",
        description=("**👥 みんなで遊ぶ**: VCにいる人や招待した人と、自分を含めて最大10人で遊べます。\n"
                     "**🤖 AIと1対1**: DM で AI（6段階）と1対1で対戦します。\n\n"
                     "手札2枚と場のカード5枚で一番強い役を作ります。"
                     "自分の番に「フォールド / チェック・コール / ベット・レイズ / オールイン」を選びます。"),
        color=COLOR,
    )


class PokerPanelView(discord.ui.View):
    def __init__(self, show_stats: bool = True):
        super().__init__(timeout=None)
        if not show_stats:
            self.remove_item(self.stats)

    @discord.ui.button(label="👥 みんなで遊ぶ", style=discord.ButtonStyle.primary, custom_id="poker_panel_pvp")
    async def pvp(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.guild:
            return await interaction.response.send_message("サーバー内で使ってください。", ephemeral=True)
        cfg = table_config(interaction.guild.id)
        if cfg["bet_enabled"]:
            return await interaction.response.send_modal(LobbyBuyinModal(cfg["pvp_max_buyin"]))
        await open_lobby(interaction, 0)

    @discord.ui.button(label="🤖 AIと1対1", style=discord.ButtonStyle.secondary, custom_id="poker_panel_ai")
    async def ai(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("🤖 **ポーカー AI対戦**\nAIの強さを選んでください。（AI対戦はDMで行います）",
                                                view=DifficultyView(interaction.user.id), ephemeral=True)

    @discord.ui.button(label="📊 自分の戦績", style=discord.ButtonStyle.secondary, custom_id="poker_panel_stats")
    async def stats(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild_id = interaction.guild.id if interaction.guild else None
        if not guild_id:
            return await interaction.response.send_message("サーバー内でのみ戦績を確認できます。", ephemeral=True)
        if get_setting(interaction.client, f"{PREFIX}_SHOW_STATS", guild_id) is False:
            return await interaction.response.send_message("⚠️ 現在このサーバーではポーカーの戦績表示が無効です。", ephemeral=True)
        stats = await database.get_user_game_stats(guild_id, interaction.user.id, "poker")
        await interaction.response.send_message(embed=create_game_stats_embed(interaction.user, "poker", stats, _currency(guild_id)), ephemeral=True)


# ============================================================
# Cog
# ============================================================
class PokerCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        global _bot
        _bot = bot

    async def cog_load(self):
        self.bot.add_view(PokerPanelView())
        self.watch.start()

    def cog_unload(self):
        self.watch.cancel()

    @tasks.loop(seconds=3)
    async def watch(self):
        """持ち時間切れ（チェックできればチェック、できなければフォールド）と、古い募集の片付け"""
        now = time.time()
        for g in list(games.values()):
            t = g.table
            cur = t.current_player()
            if g.finished or not cur or cur.uid == AI_UID or t.street not in ("preflop", "flop", "turn", "river") or now < g.deadline:
                continue
            try:
                async with g.lock:
                    cur = t.current_player()
                    if g.finished or not cur or cur.uid == AI_UID or now < g.deadline:
                        continue
                    n = g.timeouts.get(cur.uid, 0) + 1
                    g.timeouts[cur.uid] = n
                    if n >= 3 and g.mode == "ai":
                        await g.channel.send("⌛ 3回続けて時間切れになったため、降参扱いになりました。")
                        await finish_game(g, resigned=True)
                        continue
                    o = t.options()
                    # 3回続けて時間切れの人は席を離れたとみなして、フォールドして退席
                    check = o["can_check"] and n < 3
                    t.act(cur.uid, "check" if check else "fold")
                    if n >= 3:
                        cur.leaving = True
                    try:
                        msg = f"⌛ <@{cur.uid}> が時間切れのため{'チェック' if check else 'フォールド'}しました。"
                        if n >= 3:
                            msg += "（3回続けて時間切れのため、このハンドの後で退席になります）"
                        await g.channel.send(msg, delete_after=60)
                    except Exception:
                        pass
                    await after_action(g)
            except Exception as e:
                print(f"[poker] watch error: {e}")
        for key, lb in list(lobbies.items()):
            if lb.closed or now - lb.created > LOBBY_LIMIT_SEC:
                lobbies.pop(key, None)
                if not lb.closed:
                    lb.closed = True
                    try:
                        if lb.message:
                            await lb.message.edit(content="⌛ 募集の期限が切れました。", embed=None, view=None)
                    except Exception:
                        pass

    @watch.before_loop
    async def before_watch(self):
        await self.bot.wait_until_ready()

    @commands.command(name="poker_end")
    async def force_end(self, ctx: commands.Context):
        """管理者: このチャンネルのポーカーを強制終了（その時点のチップで精算）"""
        if not ctx.guild or not ctx.author.guild_permissions.administrator:
            return await ctx.send("このコマンドは管理者専用です。", delete_after=5)
        g = games.get((ctx.guild.id, ctx.channel.id))
        if not g:
            return await ctx.send("このチャンネルで進行中のポーカーはありません。")
        async with g.lock:
            await finish_game(g)
        await ctx.send("🛑 ポーカーを強制終了しました。")


async def setup(bot):
    await bot.add_cog(PokerCog(bot))
