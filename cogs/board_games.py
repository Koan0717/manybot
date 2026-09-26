# -*- coding: utf-8 -*-
"""
cogs/board_games.py
チェス・将棋の Cog（オセロ cogs/othello.py と同じ流れ）
パネル → PvP（相手を選んで招待）/ AI対戦（DM・5段階）→ 盤面画像 → 手を選ぶ → 終局・賭け精算・戦績
"""
import asyncio
import datetime
import io
import random
import time

import discord
from discord.ext import commands, tasks

import database
import chess_engine as ce
import shogi_engine as se
import board_images
from helpers import get_setting, create_game_stats_embed, AI_BET_MIN_LEVEL, ai_bet_multiplier, format_mult

_bot_instance = None
# key: (game, guild_id, channel_id) または (game, "dm", user_id)
sessions: dict = {}

LEVEL_NAMES = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関"}
IDLE_LIMIT_SEC = 10 * 60  # これだけ手が進まなければ、手番の人の時間切れ負け


def _truthy(v) -> bool:
    return v is True or str(v).lower() == "true"


# ============================================================
# ゲームごとの違い
# ============================================================
CHESS_NAMES = {"k": "キング", "q": "クイーン", "r": "ルーク", "b": "ビショップ", "n": "ナイト", "p": "ポーン"}
CHESS_PROMO = {"q": "クイーン", "r": "ルーク", "b": "ビショップ", "n": "ナイト"}


class ChessSpec:
    key = "chess"
    name = "チェス"
    emoji = "♟️"
    prefix = "CHESS"
    color = discord.Color.dark_gold()
    side_names = ("⚪ 白", "⚫ 黒")
    filename = "chess_board.png"

    def new_state(self):
        return ce.ChessState.from_fen()

    def first_to_move(self, state) -> bool:
        return state.turn == ce.WHITE

    def legal(self, state):
        return ce.legal_moves(state)

    def apply(self, state, move):
        return ce.apply_move(state, move)

    def result(self, state, legal):
        r = ce.game_result(state, legal)
        if r is None:
            return None
        winner, reason = r
        return (None if winner is None else (1 if winner == ce.WHITE else 2), reason)

    def move_text(self, state, move, legal):
        return ce.move_to_san(state, move, legal)

    def ai(self, state, level):
        return ce.ai_move(state, level)

    def render(self, state, last_move, flip=False):
        return board_images.render_chess(state, last_move, flip)

    def in_check(self, state):
        return ce.in_check(state)

    def reason_text(self, reason):
        return {"checkmate": "チェックメイト", "stalemate": "ステイルメイト（引き分け）", "fifty": "50手ルール（引き分け）",
                "material": "駒不足（引き分け）"}.get(reason, reason)

    # --- 手の選び方 ---
    def piece_options(self, state, legal):
        """[(key, label, description)] 動かせる駒"""
        by_from = {}
        for m in legal:
            by_from.setdefault(m[0], []).append(m)
        out = []
        for f in sorted(by_from, key=lambda x: (x // 8 * -1, x % 8)):
            p = state.board[f]
            out.append((f"m{f}", f"{ce.sq_name(f)} の{CHESS_NAMES[p.lower()]}", f"動ける場所: {len({m[1] for m in by_from[f]})}か所"))
        return out

    def dest_options(self, state, legal, piece_key):
        f = int(piece_key[1:])
        seen, out = set(), []
        for m in legal:
            if m[0] != f or m[1] in seen:
                continue
            seen.add(m[1])
            cap = state.board[m[1]]
            desc = f"{CHESS_NAMES[cap.lower()]}を取る" if cap != "." else ("アンパッサン" if state.board[f].lower() == "p" and m[1] == state.ep else "")
            if state.board[f].lower() == "k" and abs(m[1] - f) == 2:
                desc = "キャスリング"
            out.append((str(m[1]), f"{ce.sq_name(m[1])} へ", desc or None))
        return out

    def finish_options(self, state, legal, piece_key, dest_key):
        """同じ移動先で選択肢が複数ある（成り）ときの [(label, move)]。1つなら [(None, move)]"""
        f, t = int(piece_key[1:]), int(dest_key)
        moves = [m for m in legal if m[0] == f and m[1] == t]
        if len(moves) <= 1:
            return [(None, moves[0])] if moves else []
        return [(f"{CHESS_PROMO[m[2]]}に昇格", m) for m in moves]


SHOGI_NAMES = {**se.KANJI, "+S": "成銀", "+N": "成桂", "+L": "成香"}


class ShogiSpec:
    key = "shogi"
    name = "将棋"
    emoji = "☗"
    prefix = "SHOGI"
    color = discord.Color.from_rgb(222, 178, 108)
    side_names = ("☗ 先手", "☖ 後手")
    filename = "shogi_board.png"

    def new_state(self):
        return se.ShogiState.from_sfen()

    def first_to_move(self, state) -> bool:
        return state.turn == se.SENTE

    def legal(self, state):
        return se.legal_moves(state)

    def apply(self, state, move):
        return se.apply_move(state, move)

    def result(self, state, legal):
        r = se.game_result(state, legal)
        if r is None:
            return None
        winner, reason = r
        return (None if winner is None else (1 if winner == se.SENTE else 2), reason)

    def move_text(self, state, move, legal):
        return se.move_to_text(state, move)

    def ai(self, state, level):
        return se.ai_move(state, level)

    def render(self, state, last_move, flip=False):
        return board_images.render_shogi(state, last_move)

    def in_check(self, state):
        return se.in_check(state)

    def reason_text(self, reason):
        return {"checkmate": "詰み", "max_moves": f"{se.MAX_PLIES}手に達したため引き分け"}.get(reason, reason)

    def piece_options(self, state, legal):
        by_from, drops = {}, {}
        for m in legal:
            if m[3]:
                drops[m[3]] = drops.get(m[3], 0) + 1
            else:
                by_from.setdefault(m[0], set()).add(m[1])
        out = []
        for f in sorted(by_from, key=lambda x: (-(x // 9), -(x % 9)) if state.turn == se.SENTE else (x // 9, x % 9)):
            k = se.kind_of(state.board[f])
            out.append((f"m{f}", f"{se.square_name(f)} の{SHOGI_NAMES[k]}", f"動ける場所: {len(by_from[f])}か所"))
        for k in se.HAND_ORDER:
            if k in drops:
                out.append((f"d{k}", f"持ち駒の {se.KANJI[k]} を打つ", f"打てる場所: {drops[k]}か所"))
        return out

    def dest_options(self, state, legal, piece_key):
        seen, out = set(), []
        if piece_key[0] == "d":
            kind = piece_key[1:]
            for m in legal:
                if m[3] == kind and m[1] not in seen:
                    seen.add(m[1])
                    out.append((str(m[1]), f"{se.square_name(m[1])} に打つ", None))
            return out
        f = int(piece_key[1:])
        for m in legal:
            if m[3] or m[0] != f or m[1] in seen:
                continue
            seen.add(m[1])
            cap = state.board[m[1]]
            out.append((str(m[1]), f"{se.square_name(m[1])} へ", f"{SHOGI_NAMES[se.kind_of(cap)]}を取る" if cap else None))
        return out

    def finish_options(self, state, legal, piece_key, dest_key):
        t = int(dest_key)
        if piece_key[0] == "d":
            moves = [m for m in legal if m[3] == piece_key[1:] and m[1] == t]
        else:
            f = int(piece_key[1:])
            moves = [m for m in legal if not m[3] and m[0] == f and m[1] == t]
        if len(moves) <= 1:
            return [(None, moves[0])] if moves else []
        return [("成る" if m[2] else "成らない", m) for m in sorted(moves, key=lambda m: not m[2])]


SPECS = {"chess": ChessSpec(), "shogi": ShogiSpec()}


# ============================================================
# セッション
# ============================================================
class BoardSession:
    def __init__(self, spec, first_id, second_id, channel_id, guild_id, bet=0, is_dm=False, is_ai=False, ai_level=1, ai_mult=2.0):
        self.spec = spec
        self.state = spec.new_state()
        self.first_id = first_id      # 白 / 先手
        self.second_id = second_id    # 黒 / 後手（AI対戦は None）
        self.channel_id = channel_id
        self.guild_id = guild_id
        self.bet = bet
        self.is_dm = is_dm
        self.is_ai = is_ai
        self.ai_level = ai_level
        self.ai_mult = ai_mult        # AI に勝ったときの倍率（開始時の設定で固定）
        self.board_message_ids = []
        self.history = []             # 棋譜（表示用の文字）
        self.last_move = None
        self.last_activity = time.time()
        self.lock = asyncio.Lock()
        self.finished = False

    def key(self):
        return (self.spec.key, "dm", self.first_id) if self.is_dm else (self.spec.key, self.guild_id, self.channel_id)

    @property
    def current_is_first(self):
        return self.spec.first_to_move(self.state)

    @property
    def current_player_id(self):
        if self.current_is_first:
            return self.first_id
        return None if self.is_ai else self.second_id

    def players(self):
        return [self.first_id] + ([] if self.is_ai or not self.second_id else [self.second_id])


def _currency(guild_id):
    return (get_setting(_bot_instance, "CURRENCY_NAME", guild_id) if _bot_instance else None) or "コイン"


async def show_board(channel, session: BoardSession, note: str = None):
    spec = session.spec
    legal = spec.legal(session.state)
    png = await asyncio.to_thread(spec.render, session.state, session.last_move)
    file = discord.File(io.BytesIO(png), filename=spec.filename)
    first_turn = session.current_is_first
    side = spec.side_names[0 if first_turn else 1]
    if session.is_ai and not first_turn:
        turn_text = f"🤖 AI（Lv{session.ai_level}: {LEVEL_NAMES.get(session.ai_level)}）が考えています…"
    else:
        turn_text = f"{side} <@{session.current_player_id}> の番です"
    desc = turn_text
    if spec.in_check(session.state):
        desc += "\n⚠️ **王手！**" if spec.key == "shogi" else "\n⚠️ **チェック！**"
    if note:
        desc = f"{note}\n\n{desc}"
    embed = discord.Embed(title=f"{spec.emoji} {spec.name}対戦", description=desc, color=spec.color)
    embed.add_field(name=spec.side_names[0], value=f"<@{session.first_id}>", inline=True)
    embed.add_field(name=spec.side_names[1], value="🤖 AI" if session.is_ai else f"<@{session.second_id}>", inline=True)
    if session.bet > 0:
        embed.add_field(name="💰 賭け金", value=f"{session.bet:,} {_currency(session.guild_id)}" + (f"（勝つと ×{format_mult(session.ai_mult)}）" if session.is_ai else "（各自）"), inline=True)
    if session.history:
        recent = session.history[-8:]
        start = len(session.history) - len(recent) + 1
        embed.add_field(name="📜 最近の手", value="\n".join(f"{start + i}. {t}" for i, t in enumerate(recent)), inline=False)
    embed.set_image(url=f"attachment://{spec.filename}")
    view = None if (session.is_ai and not first_turn) else MoveRequestView(session)
    msg = await channel.send(embed=embed, file=file, view=view)
    session.board_message_ids.append(msg.id)
    while len(session.board_message_ids) > 2:
        old = session.board_message_ids.pop(0)
        try:
            await (await channel.fetch_message(old)).delete()
        except Exception:
            pass
    return legal


async def start_game(channel, session: BoardSession):
    sessions[session.key()] = session
    await show_board(channel, session)


async def play_move(channel, session: BoardSession, move, actor_text: str):
    """手を指して、終局判定 → 次の盤面（AIの番なら AI も指す）"""
    spec = session.spec
    legal = spec.legal(session.state)
    if move not in legal:
        return False
    text = spec.move_text(session.state, move, legal)
    session.history.append(text)
    session.state = spec.apply(session.state, move)
    session.last_move = move
    session.last_activity = time.time()
    nxt_legal = spec.legal(session.state)
    res = spec.result(session.state, nxt_legal)
    if res:
        await end_game(channel, session, res[0], spec.reason_text(res[1]))
        return True
    if session.is_ai and not session.current_is_first:
        await show_board(channel, session, note=f"{actor_text}: **{text}**")
        ai_mv = await asyncio.to_thread(spec.ai, session.state, session.ai_level)
        if ai_mv is None:
            res = spec.result(session.state, [])
            await end_game(channel, session, res[0] if res else 1, spec.reason_text(res[1]) if res else "")
            return True
        return await play_move(channel, session, ai_mv, "🤖 AI")
    await show_board(channel, session, note=f"{actor_text}: **{text}**")
    return True


async def end_game(channel, session: BoardSession, winner, reason: str):
    """winner: 1 = 白/先手, 2 = 黒/後手, None = 引き分け"""
    if session.finished:
        return
    session.finished = True
    sessions.pop(session.key(), None)
    spec = session.spec
    for mid in session.board_message_ids:
        try:
            await (await channel.fetch_message(mid)).delete()
        except Exception:
            pass
    session.board_message_ids.clear()

    png = await asyncio.to_thread(spec.render, session.state, session.last_move)
    file = discord.File(io.BytesIO(png), filename=spec.filename)
    embed = discord.Embed(title=f"{spec.emoji} {spec.name} 終局", color=discord.Color.gold())
    if winner is None:
        embed.description = f"🤝 **引き分け**（{reason}）"
        embed.color = discord.Color.light_grey()
    else:
        win_id = session.first_id if winner == 1 else session.second_id
        side = spec.side_names[winner - 1]
        if session.is_ai and winner == 2:
            embed.description = f"🤖 **AI の勝ち**（{reason}）\n次回のリベンジをお待ちしています！"
        else:
            embed.description = f"🏆🎉 **{side} <@{win_id}> の勝ち！**（{reason}）"
    embed.add_field(name="手数", value=f"{len(session.history)}手", inline=True)

    cur = _currency(session.guild_id)
    if session.bet > 0 and session.guild_id:
        try:
            if winner is None:
                for uid in session.players():
                    await database.add_balance(session.guild_id, uid, session.bet)
                embed.add_field(name="💰 賭け精算", value=f"引き分けのため各 **{session.bet:,} {cur}** 返金", inline=False)
            elif session.is_ai:
                if winner == 1:
                    prize = int(session.bet * session.ai_mult)
                    await database.add_balance(session.guild_id, session.first_id, prize)
                    embed.add_field(name="💰 賭け精算", value=f"<@{session.first_id}> 元金 **{session.bet:,}** → **{prize:,} {cur}**（×{format_mult(session.ai_mult)}、+{prize - session.bet:,}）", inline=False)
                else:
                    embed.add_field(name="💰 賭け精算", value=f"AI の勝ち。**{session.bet:,} {cur}** 没収。", inline=False)
            else:
                win_id = session.first_id if winner == 1 else session.second_id
                lose_id = session.second_id if winner == 1 else session.first_id
                await database.add_balance(session.guild_id, win_id, session.bet * 2)
                # 送金履歴に「負けた人 → 勝った人」へ賭け金分を残す
                await database.log_transfer(session.guild_id, lose_id, win_id, session.bet, spec.key)
                embed.add_field(name="💰 賭け精算", value=f"<@{win_id}> 元金 **{session.bet:,}** → **{session.bet * 2:,} {cur}**（+{session.bet:,}）", inline=False)
        except Exception as e:
            print(f"[ERROR] board_games 賭け精算: {e}")

    if session.guild_id:
        try:
            for idx, uid in enumerate(session.players()):
                me = idx + 1
                is_draw = winner is None
                is_win = winner == me
                win_payout = int(session.bet * session.ai_mult) if session.is_ai else session.bet * 2
                payout = win_payout if is_win else (session.bet if is_draw else 0)
                mode = "ai" if session.is_ai else "pvp"
                extra = {f"{mode}_{'draws' if is_draw else 'wins' if is_win else 'losses'}": 1}
                await database.record_game_result(session.guild_id, uid, spec.key, is_win=is_win, is_draw=is_draw,
                                                  bet=session.bet, payout=payout, custom_extra=extra)
        except Exception as e:
            print(f"[ERROR] record_game_result ({spec.key}): {e}")

    embed.set_image(url=f"attachment://{spec.filename}")
    if session.history:
        text = " ".join(f"{i + 1}.{t}" for i, t in enumerate(session.history))
        embed.add_field(name="📜 棋譜", value=(text[:1000] + "…") if len(text) > 1000 else text, inline=False)
    try:
        await channel.send(embed=embed, file=file)
    except Exception as e:
        print(f"[ERROR] board_games end send: {e}")


def _get_session(game, guild_id, channel):
    if isinstance(channel, discord.DMChannel):
        for s in sessions.values():
            if s.spec.key == game and s.is_dm and s.channel_id == channel.id:
                return s
        return None
    return sessions.get((game, guild_id, channel.id))


# ============================================================
# 手を選ぶ（本人だけに見える画面）
# ============================================================
class MoveSelectView(discord.ui.View):
    def __init__(self, session: BoardSession):
        super().__init__(timeout=180)
        self.session = session
        self.piece_key = None
        self.dest_key = None
        self.build_piece_step()

    def _legal(self):
        return self.session.spec.legal(self.session.state)

    def _add_selects(self, options, placeholder, callback):
        """25件ずつ選択メニューに分けて並べる（最大4つ）"""
        chunks = [options[i:i + 25] for i in range(0, len(options), 25)][:4]
        for n, chunk in enumerate(chunks):
            sel = discord.ui.Select(
                placeholder=placeholder + (f"（{n + 1}/{len(chunks)}）" if len(chunks) > 1 else ""),
                options=[discord.SelectOption(label=label[:100], value=value, description=(desc[:100] if desc else None)) for value, label, desc in chunk],
                row=n,
            )
            sel.callback = callback(sel)
            self.add_item(sel)

    def build_piece_step(self):
        self.clear_items()
        legal = self._legal()
        self._add_selects(self.session.spec.piece_options(self.session.state, legal), "動かす駒を選ぶ", self._on_piece)

    def build_dest_step(self):
        self.clear_items()
        legal = self._legal()
        self._add_selects(self.session.spec.dest_options(self.session.state, legal, self.piece_key), "どこへ？", self._on_dest)
        back = discord.ui.Button(label="↩ 駒を選び直す", style=discord.ButtonStyle.secondary, row=4)
        back.callback = self._on_back
        self.add_item(back)

    def _on_piece(self, sel):
        async def cb(interaction: discord.Interaction):
            if not await self._check(interaction):
                return
            self.piece_key = sel.values[0]
            self.build_dest_step()
            await interaction.response.edit_message(content=f"✅ {self._label_of_piece()} を選びました。移動先を選んでください。", view=self)
        return cb

    def _label_of_piece(self):
        for value, label, _ in self.session.spec.piece_options(self.session.state, self._legal()):
            if value == self.piece_key:
                return label
        return "駒"

    def _on_dest(self, sel):
        async def cb(interaction: discord.Interaction):
            if not await self._check(interaction):
                return
            self.dest_key = sel.values[0]
            choices = self.session.spec.finish_options(self.session.state, self._legal(), self.piece_key, self.dest_key)
            if not choices:
                return await interaction.response.edit_message(content="その手は指せません。もう一度選んでください。", view=self)
            if len(choices) == 1:
                return await self._commit(interaction, choices[0][1])
            self.clear_items()
            for label, move in choices:
                btn = discord.ui.Button(label=label, style=discord.ButtonStyle.primary)
                btn.callback = self._make_commit(move)
                self.add_item(btn)
            back = discord.ui.Button(label="↩ 選び直す", style=discord.ButtonStyle.secondary)
            back.callback = self._on_back
            self.add_item(back)
            await interaction.response.edit_message(content="成りますか？" if self.session.spec.key == "shogi" else "何に昇格しますか？", view=self)
        return cb

    def _make_commit(self, move):
        async def cb(interaction: discord.Interaction):
            if not await self._check(interaction):
                return
            await self._commit(interaction, move)
        return cb

    async def _on_back(self, interaction: discord.Interaction):
        if not await self._check(interaction):
            return
        self.piece_key = self.dest_key = None
        self.build_piece_step()
        await interaction.response.edit_message(content="動かす駒を選んでください。", view=self)

    async def _check(self, interaction):
        s = self.session
        if s.finished or sessions.get(s.key()) is not s:
            await interaction.response.edit_message(content="この対局は終わっています。", view=None)
            return False
        if interaction.user.id != s.current_player_id:
            await interaction.response.send_message("今はあなたの番ではありません。", ephemeral=True)
            return False
        return True

    async def _commit(self, interaction: discord.Interaction, move):
        s = self.session
        self.stop()
        await interaction.response.edit_message(content="✅ 指しました。", view=None)
        channel = interaction.channel if not s.is_dm else (_bot_instance.get_channel(s.channel_id) or interaction.channel)
        async with s.lock:
            if s.finished or interaction.user.id != s.current_player_id:
                return
            side = s.spec.side_names[0 if s.current_is_first else 1]
            ok = await play_move(channel, s, move, f"{side} <@{interaction.user.id}>")
            if not ok:
                await interaction.followup.send("その手は指せませんでした（盤面が変わった可能性があります）。", ephemeral=True)


class ConfirmResignView(discord.ui.View):
    def __init__(self, session: BoardSession, user_id: int):
        super().__init__(timeout=60)
        self.session = session
        self.user_id = user_id

    @discord.ui.button(label="🏳️ 投了する", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        s = self.session
        if interaction.user.id != self.user_id:
            return await interaction.response.send_message("あなた専用の確認画面ではありません。", ephemeral=True)
        self.stop()
        if s.finished:
            return await interaction.response.edit_message(content="この対局は終わっています。", view=None)
        await interaction.response.edit_message(content="🏳️ 投了しました。", view=None)
        winner = 2 if (s.is_ai or self.user_id == s.first_id) else 1
        channel = interaction.channel if not s.is_dm else (_bot_instance.get_channel(s.channel_id) or interaction.channel)
        async with s.lock:
            await end_game(channel, s, winner, "投了")

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.user_id:
            return await interaction.response.send_message("あなた専用の確認画面ではありません。", ephemeral=True)
        self.stop()
        await interaction.response.edit_message(content="対局を続けます。", view=None)


class MoveRequestView(discord.ui.View):
    def __init__(self, session: BoardSession):
        super().__init__(timeout=None)
        self.session = session

    @discord.ui.button(label="♟️ 手を選ぶ", style=discord.ButtonStyle.primary)
    async def select_move(self, interaction: discord.Interaction, button: discord.ui.Button):
        s = self.session
        if s.finished or sessions.get(s.key()) is not s:
            return await interaction.response.send_message("この対局は終わっています。", ephemeral=True)
        if interaction.user.id != s.current_player_id:
            return await interaction.response.send_message("今はあなたの番ではありません。", ephemeral=True)
        await interaction.response.send_message("動かす駒を選んでください。", view=MoveSelectView(s), ephemeral=True)

    @discord.ui.button(label="🏳️ 投了", style=discord.ButtonStyle.danger)
    async def resign(self, interaction: discord.Interaction, button: discord.ui.Button):
        s = self.session
        if s.finished:
            return await interaction.response.send_message("この対局は終わっています。", ephemeral=True)
        if interaction.user.id not in s.players():
            return await interaction.response.send_message("この対局のプレイヤーではありません。", ephemeral=True)
        text = "本当に投了しますか？" + ("\n※賭け金は没収されます。" if s.bet else "") if s.is_ai else "本当に投了しますか？相手の勝ちになります。"
        await interaction.response.send_message(text, view=ConfirmResignView(s, interaction.user.id), ephemeral=True)


# ============================================================
# AI対戦
# ============================================================
class BetModal(discord.ui.Modal):
    bet_input = discord.ui.TextInput(label="賭ける金額", placeholder="例: 1000", max_length=10, required=True)

    def __init__(self, spec, next_callback, mult: float = 2.0):
        super().__init__(title=f"{spec.name}：賭け金入力（勝つと×{format_mult(mult)}）")
        self.next_callback = next_callback

    async def on_submit(self, interaction: discord.Interaction):
        try:
            bet = int(self.bet_input.value)
        except ValueError:
            return await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        if bet <= 0:
            return await interaction.response.send_message("1以上の金額を入力してください。", ephemeral=True)
        await self.next_callback(interaction, bet)


class DifficultyView(discord.ui.View):
    def __init__(self, spec, initiator_id):
        super().__init__(timeout=60)
        self.spec = spec
        self.initiator_id = initiator_id
        for lv in range(1, 6):
            style = discord.ButtonStyle.secondary if lv <= 2 else discord.ButtonStyle.primary if lv <= 4 else discord.ButtonStyle.danger
            btn = discord.ui.Button(label=f"レベル{lv}（{LEVEL_NAMES[lv]}）", style=style, row=(lv - 1) // 2)
            btn.callback = self._make(lv)
            self.add_item(btn)

    def _make(self, level):
        async def cb(interaction: discord.Interaction):
            if interaction.user.id != self.initiator_id:
                return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
            guild_id = interaction.guild.id if interaction.guild else None
            # AI 対戦で賭けられるのはレベル4以上
            if level >= AI_BET_MIN_LEVEL and _truthy(get_setting(interaction.client, f"{self.spec.prefix}_BET_ENABLED", guild_id)):
                async def on_bet(it, bet):
                    await _start_ai(it, self.spec, level, bet)
                mult = ai_bet_multiplier(interaction.client, self.spec.prefix, guild_id, level)
                await interaction.response.send_modal(BetModal(self.spec, on_bet, mult))
            else:
                await interaction.response.defer(ephemeral=True)
                await _start_ai(interaction, self.spec, level, 0)
        return cb


async def _reply(interaction, msg):
    if interaction.response.is_done():
        await interaction.followup.send(msg, ephemeral=True)
    else:
        await interaction.response.send_message(msg, ephemeral=True)


async def _start_ai(interaction: discord.Interaction, spec, level: int, bet: int):
    guild_id = interaction.guild.id if interaction.guild else None
    if level < AI_BET_MIN_LEVEL:
        bet = 0  # AI 対戦で賭けられるのはレベル4以上
    user = interaction.user
    if (spec.key, "dm", user.id) in sessions:
        return await _reply(interaction, f"DMで{spec.name}のAI対戦がすでに進行中です。先に終わらせてください。")
    if bet > 0 and guild_id:
        if not await database.remove_balance(guild_id, user.id, bet):
            bal = await database.get_balance(guild_id, user.id)
            return await _reply(interaction, f"残高不足です。現在の残高: {bal:,} {_currency(guild_id)}")
    try:
        dm = await user.create_dm()
    except discord.Forbidden:
        if bet > 0 and guild_id:
            await database.add_balance(guild_id, user.id, bet)
        return await _reply(interaction, "DMを送れませんでした。BotからのDMを許可してください。")
    mult = ai_bet_multiplier(interaction.client, spec.prefix, guild_id, level)
    session = BoardSession(spec, user.id, None, dm.id, guild_id, bet=bet, is_dm=True, is_ai=True, ai_level=level, ai_mult=mult)
    side = spec.side_names[0]
    await _reply(interaction, f"✅ {spec.name}のAI対戦（レベル{level}: {LEVEL_NAMES[level]}）を始めます！DMを確認してください。\nあなたは {side} です。")
    await start_game(dm, session)


# ============================================================
# PvP
# ============================================================
class OpponentSelectView(discord.ui.View):
    def __init__(self, spec, initiator_id):
        super().__init__(timeout=120)
        self.spec = spec
        self.initiator_id = initiator_id
        self.selected = None

    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="対戦相手を選択...", min_values=1, max_values=1)
    async def user_select(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
        self.selected = select.values[0]
        await interaction.response.defer()

    @discord.ui.button(label="✅ この人を招待", style=discord.ButtonStyle.success)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
        opp = self.selected
        if not opp:
            return await interaction.response.send_message("対戦相手を先に選んでください。", ephemeral=True)
        if opp.id == self.initiator_id:
            return await interaction.response.send_message("自分自身とは対戦できません。", ephemeral=True)
        if opp.bot:
            return await interaction.response.send_message("Botとは対戦できません。AI対戦を選んでください。", ephemeral=True)
        self.stop()
        spec = self.spec
        if _truthy(get_setting(interaction.client, f"{spec.prefix}_BET_ENABLED", interaction.guild.id)):
            # 賭け金は申し込む人が決める（空欄・0 は賭けなし）。受ける人も同じ額を賭ける
            async def on_bet(it, bet):
                channel = await _pick_game_channel(it, spec)
                await _send_invitation(it, spec, opp, channel, bet)
            return await interaction.response.send_modal(InviteBetModal(spec, on_bet))
        channel = await _pick_game_channel(interaction, spec)
        await _send_invitation(interaction, spec, opp, channel, 0)


async def _pick_game_channel(interaction: discord.Interaction, spec):
    """通話中ならその通話のチャット → 専用VCを作る設定ならVC → プレイ進行チャンネル → 今のチャンネル"""
    guild = interaction.guild
    member = guild.get_member(interaction.user.id) if guild else None
    if member and member.voice and member.voice.channel:
        return member.voice.channel
    bot = interaction.client
    if _truthy(get_setting(bot, f"{spec.prefix}_AUTO_VC_ENABLED", guild.id)):
        try:
            cat_raw = get_setting(bot, f"{spec.prefix}_VC_CATEGORY_ID", guild.id)
            category = guild.get_channel(int(cat_raw)) if cat_raw else None
            name = get_setting(bot, f"{spec.prefix}_VC_NAME", guild.id) or f"{spec.name}対戦"
            return await guild.create_voice_channel(name=name, category=category, reason=f"{spec.name}対戦用VC")
        except Exception as e:
            print(f"[ERROR] {spec.key} 専用VC作成失敗: {e}")
    raw = get_setting(bot, f"{spec.prefix}_GAME_CHANNEL", guild.id)
    if raw:
        try:
            ch = guild.get_channel(int(raw))
            if ch:
                return ch
        except Exception:
            pass
    return interaction.channel


class InviteBetModal(discord.ui.Modal):
    bet_input = discord.ui.TextInput(label="賭け金（相手も同じ額を賭けます）", placeholder="空欄・0 で賭けなし", max_length=10, required=False)

    def __init__(self, spec, next_callback):
        super().__init__(title=f"{spec.name}：賭け金を決める")
        self.next_callback = next_callback

    async def on_submit(self, interaction: discord.Interaction):
        raw = (self.bet_input.value or "").strip().replace(",", "")
        try:
            bet = int(raw) if raw else 0
        except ValueError:
            return await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        if bet < 0:
            return await interaction.response.send_message("0以上の金額を入力してください。", ephemeral=True)
        if bet > 0 and await database.get_balance(interaction.guild.id, interaction.user.id) < bet:
            return await interaction.response.send_message("残高が足りません。", ephemeral=True)
        await self.next_callback(interaction, bet)


async def _send_invitation(interaction, spec, opponent, channel, bet: int = 0):
    guild_id = interaction.guild.id
    if (spec.key, guild_id, channel.id) in sessions:
        return await interaction.response.edit_message(content=f"❌ {channel.mention} ではすでに{spec.name}の対局中です。", view=None)
    view = InvitationView(spec, interaction.user.id, opponent.id, channel, guild_id, bet)
    bet_text = f"\n💰 賭け金: **{bet:,} {_currency(guild_id)}**（あなたも同じ額を賭けます。勝つと {bet * 2:,}）" if bet > 0 else ""
    content = (f"{spec.emoji} **{spec.name}対戦の招待**\n{interaction.user.mention} から {opponent.mention} へ対戦の申し込みです！{bet_text}\n"
               f"対局場所: {channel.mention}\n\n5分以内に返事をしてください。")
    await interaction.response.edit_message(content=f"✅ {channel.mention} に招待を送りました！", view=None)
    try:
        await channel.send(content=content, view=view)
    except Exception as e:
        print(f"[ERROR] {spec.key} invitation: {e}")


class InvitationView(discord.ui.View):
    def __init__(self, spec, initiator_id, opponent_id, channel, guild_id, bet):
        super().__init__(timeout=300)
        self.spec = spec
        self.initiator_id = initiator_id
        self.opponent_id = opponent_id
        self.channel = channel
        self.guild_id = guild_id
        self.bet = bet

    @discord.ui.button(label="✅ 受ける", style=discord.ButtonStyle.success)
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.opponent_id:
            return await interaction.response.send_message("あなた宛ての招待ではありません。", ephemeral=True)
        key = (self.spec.key, self.guild_id, self.channel.id)
        if key in sessions:
            self.stop()
            return await interaction.response.edit_message(content=f"❌ このチャンネルではすでに{self.spec.name}の対局中です。", view=None)
        if self.bet > 0:
            if not await database.remove_balance(self.guild_id, self.initiator_id, self.bet):
                self.stop()
                return await interaction.response.edit_message(content="❌ 招待した人の残高が足りないため、始められません。", view=None)
            if not await database.remove_balance(self.guild_id, self.opponent_id, self.bet):
                await database.add_balance(self.guild_id, self.initiator_id, self.bet)
                return await interaction.response.send_message("残高が足りません。", ephemeral=True)
        # 先手（白）はランダム
        first, second = (self.initiator_id, self.opponent_id) if random.random() < 0.5 else (self.opponent_id, self.initiator_id)
        session = BoardSession(self.spec, first, second, self.channel.id, self.guild_id, bet=self.bet)
        self.stop()
        await interaction.response.edit_message(
            content=f"✅ 対局開始！ {self.spec.side_names[0]}: <@{first}>  vs  {self.spec.side_names[1]}: <@{second}>", view=None)
        await start_game(self.channel, session)

    @discord.ui.button(label="❌ 断る", style=discord.ButtonStyle.danger)
    async def decline(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id not in (self.opponent_id, self.initiator_id):
            return await interaction.response.send_message("あなた宛ての招待ではありません。", ephemeral=True)
        self.stop()
        await interaction.response.edit_message(content=f"❌ {interaction.user.mention} が対戦を取り消しました。", view=None)


# ============================================================
# パネル
# ============================================================
def make_panel_view(game: str, show_stats: bool = True):
    return ChessPanelView(show_stats) if game == "chess" else ShogiPanelView(show_stats)


def panel_embed(game: str) -> discord.Embed:
    spec = SPECS[game]
    return discord.Embed(
        title=f"{spec.emoji} {spec.name}対戦",
        description=f"{spec.name}で対戦しましょう！\n「PvP対戦」でメンバーと、「AI対戦」でAI（5段階）と対戦できます。\n"
                    f"盤面の「♟️ 手を選ぶ」から、動かす駒 → 移動先 の順に選んで指します。",
        color=spec.color,
    )


async def _panel_pvp(interaction, game):
    spec = SPECS[game]
    await interaction.response.send_message(f"{spec.emoji} **{spec.name} PvP対戦**\n対戦相手を選んでください。",
                                            view=OpponentSelectView(spec, interaction.user.id), ephemeral=True)


async def _panel_ai(interaction, game):
    spec = SPECS[game]
    await interaction.response.send_message(f"🤖 **{spec.name} AI対戦**\nAIの強さを選んでください。（AI対戦はDMで行います）",
                                            view=DifficultyView(spec, interaction.user.id), ephemeral=True)


async def _panel_stats(interaction, game):
    spec = SPECS[game]
    guild_id = interaction.guild.id if interaction.guild else None
    if not guild_id:
        return await interaction.response.send_message("サーバー内でのみ戦績を確認できます。", ephemeral=True)
    if get_setting(interaction.client, f"{spec.prefix}_SHOW_STATS", guild_id) is False:
        return await interaction.response.send_message(f"⚠️ 現在このサーバーでは{spec.name}の戦績表示が無効です。", ephemeral=True)
    stats = await database.get_user_game_stats(guild_id, interaction.user.id, game)
    await interaction.response.send_message(embed=create_game_stats_embed(interaction.user, game, stats, _currency(guild_id)), ephemeral=True)


class ChessPanelView(discord.ui.View):
    def __init__(self, show_stats: bool = True):
        super().__init__(timeout=None)
        if not show_stats:
            self.remove_item(self.stats)

    @discord.ui.button(label="👥 PvP対戦", style=discord.ButtonStyle.primary, custom_id="chess_panel_pvp")
    async def pvp(self, interaction, button):
        await _panel_pvp(interaction, "chess")

    @discord.ui.button(label="🤖 AI対戦", style=discord.ButtonStyle.secondary, custom_id="chess_panel_ai")
    async def ai(self, interaction, button):
        await _panel_ai(interaction, "chess")

    @discord.ui.button(label="📊 自分の戦績", style=discord.ButtonStyle.secondary, custom_id="chess_panel_stats")
    async def stats(self, interaction, button):
        await _panel_stats(interaction, "chess")


class ShogiPanelView(discord.ui.View):
    def __init__(self, show_stats: bool = True):
        super().__init__(timeout=None)
        if not show_stats:
            self.remove_item(self.stats)

    @discord.ui.button(label="👥 PvP対戦", style=discord.ButtonStyle.primary, custom_id="shogi_panel_pvp")
    async def pvp(self, interaction, button):
        await _panel_pvp(interaction, "shogi")

    @discord.ui.button(label="🤖 AI対戦", style=discord.ButtonStyle.secondary, custom_id="shogi_panel_ai")
    async def ai(self, interaction, button):
        await _panel_ai(interaction, "shogi")

    @discord.ui.button(label="📊 自分の戦績", style=discord.ButtonStyle.secondary, custom_id="shogi_panel_stats")
    async def stats(self, interaction, button):
        await _panel_stats(interaction, "shogi")


# ============================================================
# Cog
# ============================================================
class BoardGamesCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        global _bot_instance
        _bot_instance = bot

    async def cog_load(self):
        self.bot.add_view(ChessPanelView())
        self.bot.add_view(ShogiPanelView())
        self.idle_check.start()
        self._presence_synced = False

    # ------------------------------------------------------------
    # アクティビティ・Web のボードゲーム連携
    #  - voice_presence: 誰がどの通話にいるか（アクティビティで「この通話にいる人」を出すため）
    #  - activity_join_intents: 招待の「アクティビティで参加」を押した人を、起動後にその対局へ案内するため
    # ------------------------------------------------------------
    async def _ensure_tables(self, guild_id: int):
        pool = await database.get_pool(guild_id)
        async with pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS voice_presence (
                    guild_id BIGINT NOT NULL,
                    user_id BIGINT NOT NULL,
                    channel_id BIGINT NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS activity_join_intents (
                    guild_id BIGINT NOT NULL,
                    user_id BIGINT NOT NULL,
                    game_id TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (guild_id, user_id)
                )
            """)
        return pool

    @commands.Cog.listener()
    async def on_ready(self):
        if self._presence_synced:
            return
        self._presence_synced = True
        for guild in self.bot.guilds:
            try:
                pool = await self._ensure_tables(guild.id)
                async with pool.acquire() as conn:
                    await conn.execute("DELETE FROM voice_presence WHERE guild_id = $1", guild.id)
                    for vc in list(guild.voice_channels) + list(guild.stage_channels):
                        for m in vc.members:
                            if not m.bot:
                                await conn.execute(
                                    "INSERT INTO voice_presence (guild_id, user_id, channel_id) VALUES ($1, $2, $3) "
                                    "ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = NOW()",
                                    guild.id, m.id, vc.id)
            except Exception as e:
                print(f"[board_games] voice_presence sync failed ({guild.id}): {e}")

    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before, after):
        if member.bot or before.channel == after.channel:
            return
        try:
            pool = await self._ensure_tables(member.guild.id)
            async with pool.acquire() as conn:
                if after.channel:
                    await conn.execute(
                        "INSERT INTO voice_presence (guild_id, user_id, channel_id) VALUES ($1, $2, $3) "
                        "ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = NOW()",
                        member.guild.id, member.id, after.channel.id)
                else:
                    await conn.execute("DELETE FROM voice_presence WHERE guild_id = $1 AND user_id = $2", member.guild.id, member.id)
        except Exception as e:
            print(f"[board_games] voice_presence update failed: {e}")

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        """Web の招待メッセージの「アクティビティで参加」ボタン（custom_id: bgjoin:<guild_id>:<game_id>）"""
        if interaction.type != discord.InteractionType.component:
            return
        custom_id = (interaction.data or {}).get("custom_id", "")
        if not custom_id.startswith("bgjoin:"):
            return
        try:
            _, guild_id, game_id = custom_id.split(":", 2)
            guild_id = int(guild_id)
        except ValueError:
            return
        try:
            pool = await self._ensure_tables(guild_id)
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO activity_join_intents (guild_id, user_id, game_id) VALUES ($1, $2, $3) "
                    "ON CONFLICT (guild_id, user_id) DO UPDATE SET game_id = EXCLUDED.game_id, created_at = NOW()",
                    guild_id, interaction.user.id, game_id)
        except Exception as e:
            print(f"[board_games] join intent save failed: {e}")
        # その場でアクティビティを起動する（起動できない場所ではやり方を案内する）
        try:
            await interaction.response.launch_activity()
        except Exception as e:
            print(f"[board_games] launch_activity failed: {e}")
            try:
                if not interaction.response.is_done():
                    await interaction.response.send_message(
                        "ここではアクティビティを起動できませんでした。\n"
                        "サーバーのボイスチャンネルに入って、アプリ（🚀 アクティビティ）からこのBotを起動してください。"
                        "起動すると、そのまま対局に参加できます。",
                        ephemeral=True,
                    )
            except Exception:
                pass

    def cog_unload(self):
        self.idle_check.cancel()

    @tasks.loop(minutes=1)
    async def idle_check(self):
        """10分間手が進まない対局は、手番の人の時間切れ負け（AI対戦は投了扱い）"""
        now = time.time()
        for s in list(sessions.values()):
            if s.finished or now - s.last_activity < IDLE_LIMIT_SEC:
                continue
            channel = self.bot.get_channel(s.channel_id)
            if channel is None:
                try:
                    channel = await self.bot.fetch_channel(s.channel_id)
                except Exception:
                    sessions.pop(s.key(), None)
                    continue
            winner = 2 if s.current_is_first else 1
            try:
                async with s.lock:
                    await end_game(channel, s, winner, "時間切れ")
            except Exception as e:
                print(f"[ERROR] board_games idle_check: {e}")

    @idle_check.before_loop
    async def before_idle(self):
        await self.bot.wait_until_ready()

    @commands.command(name="boardgame_end")
    async def force_end(self, ctx: commands.Context):
        """管理者: このチャンネルのチェス・将棋の対局を強制終了（賭け金は返金）"""
        if not ctx.author.guild_permissions.administrator:
            return await ctx.send("このコマンドは管理者専用です。", delete_after=5)
        ended = 0
        for game in SPECS:
            s = sessions.pop((game, ctx.guild.id, ctx.channel.id), None)
            if not s:
                continue
            s.finished = True
            ended += 1
            if s.bet > 0:
                for uid in s.players():
                    try:
                        await database.add_balance(ctx.guild.id, uid, s.bet)
                    except Exception as e:
                        print(f"[ERROR] boardgame_end 返金: {e}")
        await ctx.send("🛑 対局を強制終了しました。賭け金は返金しました。" if ended else "このチャンネルで進行中の対局はありません。")


async def setup(bot):
    await bot.add_cog(BoardGamesCog(bot))
