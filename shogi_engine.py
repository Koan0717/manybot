# -*- coding: utf-8 -*-
"""
将棋のルールとAI（Bot・Webで同じ動きになるよう dashboard/src/lib/boardgames/shogi.ts と対応）。

盤面: 81マスのリスト。index = row * 9 + col
  row 0 = 一段目（後手側）、row 8 = 九段目（先手側）
  col 0 = 9筋（先手から見て左）、col 8 = 1筋
駒: 先手は大文字、後手は小文字。成り駒は先頭に "+"（例: "+P" と金、"+r" 後手の竜）。空きは None
手番: "b" = 先手（▲）、"w" = 後手（△）
手: (from, to, promote, drop)  盤上の移動は drop=None、持ち駒を打つときは from=-1, drop="P" など（大文字）
"""
import random

SENTE, GOTE = "b", "w"
HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"]
KANJI = {
    "K": "玉", "R": "飛", "B": "角", "G": "金", "S": "銀", "N": "桂", "L": "香", "P": "歩",
    "+R": "竜", "+B": "馬", "+S": "成銀", "+N": "成桂", "+L": "成香", "+P": "と",
}
KANJI_NUM = "一二三四五六七八九"
ZEN_NUM = "１２３４５６７８９"

GOLD_STEPS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0)]
STEPS = {
    "K": [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)],
    "G": GOLD_STEPS, "+P": GOLD_STEPS, "+L": GOLD_STEPS, "+N": GOLD_STEPS, "+S": GOLD_STEPS,
    "S": [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 1)],
    "N": [(-2, -1), (-2, 1)],
    "P": [(-1, 0)],
    "+B": [(-1, 0), (1, 0), (0, -1), (0, 1)],
    "+R": [(-1, -1), (-1, 1), (1, -1), (1, 1)],
}
SLIDES = {
    "L": [(-1, 0)],
    "B": [(-1, -1), (-1, 1), (1, -1), (1, 1)], "+B": [(-1, -1), (-1, 1), (1, -1), (1, 1)],
    "R": [(-1, 0), (1, 0), (0, -1), (0, 1)], "+R": [(-1, 0), (1, 0), (0, -1), (0, 1)],
}
PROMOTABLE = {"P", "L", "N", "S", "B", "R"}
VALUES = {"P": 100, "L": 300, "N": 350, "S": 500, "G": 550, "B": 800, "R": 1000, "K": 0,
          "+P": 550, "+L": 550, "+N": 550, "+S": 550, "+B": 1100, "+R": 1300}
HAND_VALUES = {"P": 110, "L": 330, "N": 380, "S": 550, "G": 600, "B": 880, "R": 1100}

START_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"
MAX_PLIES = 400


def side_of(p):
    if p is None:
        return None
    return SENTE if p[-1].isupper() else GOTE


def kind_of(p) -> str:
    """先手・後手を区別しない駒の種類（"+P" など大文字）"""
    return p.upper()


def make_piece(kind: str, side: str) -> str:
    return kind if side == SENTE else kind.lower()


def square_name(i: int) -> str:
    r, c = divmod(i, 9)
    return f"{ZEN_NUM[8 - c]}{KANJI_NUM[r]}"


class ShogiState:
    __slots__ = ("board", "turn", "hands", "ply")

    def __init__(self, board, turn=SENTE, hands=None, ply=0):
        self.board = board
        self.turn = turn
        self.hands = hands or {SENTE: {}, GOTE: {}}
        self.ply = ply

    def copy(self) -> "ShogiState":
        return ShogiState(self.board[:], self.turn, {SENTE: dict(self.hands[SENTE]), GOTE: dict(self.hands[GOTE])}, self.ply)

    @staticmethod
    def from_sfen(sfen: str = START_SFEN) -> "ShogiState":
        parts = sfen.split()
        board = []
        promo = False
        for ch in parts[0]:
            if ch == "/":
                continue
            if ch == "+":
                promo = True
                continue
            if ch.isdigit():
                board.extend([None] * int(ch))
            else:
                board.append(("+" if promo else "") + ch)
                promo = False
        hands = {SENTE: {}, GOTE: {}}
        if len(parts) > 2 and parts[2] != "-":
            n = ""
            for ch in parts[2]:
                if ch.isdigit():
                    n += ch
                    continue
                side = SENTE if ch.isupper() else GOTE
                hands[side][ch.upper()] = hands[side].get(ch.upper(), 0) + (int(n) if n else 1)
                n = ""
        ply = int(parts[3]) - 1 if len(parts) > 3 else 0
        return ShogiState(board, parts[1] if len(parts) > 1 else SENTE, hands, ply)

    def to_sfen(self) -> str:
        rows = []
        for r in range(9):
            row, empty = "", 0
            for c in range(9):
                p = self.board[r * 9 + c]
                if p is None:
                    empty += 1
                else:
                    if empty:
                        row += str(empty)
                        empty = 0
                    row += p
            if empty:
                row += str(empty)
            rows.append(row)
        hand = ""
        for side in (SENTE, GOTE):
            for k in HAND_ORDER:
                n = self.hands[side].get(k, 0)
                if n:
                    hand += (str(n) if n > 1 else "") + (k if side == SENTE else k.lower())
        return f"{'/'.join(rows)} {self.turn} {hand or '-'} {self.ply + 1}"


def forward(side: str) -> int:
    return 1 if side == SENTE else -1


def piece_targets(board, sq: int):
    """sq の駒が利いているマス（味方の駒があるマスも含む）"""
    p = board[sq]
    side = side_of(p)
    k = kind_of(p)
    f = forward(side)
    r, c = divmod(sq, 9)
    out = []
    for dr, dc in STEPS.get(k, []):
        rr, cc = r + dr * f, c + dc
        if 0 <= rr < 9 and 0 <= cc < 9:
            out.append(rr * 9 + cc)
    for dr, dc in SLIDES.get(k, []):
        rr, cc = r + dr * f, c + dc
        while 0 <= rr < 9 and 0 <= cc < 9:
            out.append(rr * 9 + cc)
            if board[rr * 9 + cc] is not None:
                break
            rr += dr * f
            cc += dc
    return out


def is_attacked(board, sq: int, by: str) -> bool:
    for i, p in enumerate(board):
        if p is not None and side_of(p) == by and sq in piece_targets(board, i):
            return True
    return False


def king_square(board, side: str) -> int:
    k = make_piece("K", side)
    try:
        return board.index(k)
    except ValueError:
        return -1


def in_check(state: ShogiState, side: str = None) -> bool:
    side = side or state.turn
    ksq = king_square(state.board, side)
    return ksq >= 0 and is_attacked(state.board, ksq, GOTE if side == SENTE else SENTE)


def in_zone(row: int, side: str) -> bool:
    return row <= 2 if side == SENTE else row >= 6


def _must_promote(kind: str, row: int, side: str) -> bool:
    if kind in ("P", "L"):
        return row == (0 if side == SENTE else 8)
    if kind == "N":
        return row in ((0, 1) if side == SENTE else (7, 8))
    return False


def pseudo_moves(state: ShogiState, include_drops: bool = True) -> list:
    board, me = state.board, state.turn
    moves = []
    for sq, p in enumerate(board):
        if p is None or side_of(p) != me:
            continue
        k = kind_of(p)
        fr = sq // 9
        for t in piece_targets(board, sq):
            q = board[t]
            if q is not None and side_of(q) == me:
                continue
            tr = t // 9
            if k in PROMOTABLE and (in_zone(fr, me) or in_zone(tr, me)):
                moves.append((sq, t, True, None))
                if not _must_promote(k, tr, me):
                    moves.append((sq, t, False, None))
            else:
                moves.append((sq, t, False, None))
    if include_drops:
        hand = state.hands[me]
        if hand:
            pawn_files = set()
            if hand.get("P"):
                own_pawn = make_piece("P", me)
                for i, p in enumerate(board):
                    if p == own_pawn:
                        pawn_files.add(i % 9)
            for k, n in hand.items():
                if n <= 0:
                    continue
                for t in range(81):
                    if board[t] is not None:
                        continue
                    tr = t // 9
                    if _must_promote(k, tr, me):
                        continue
                    if k == "P" and (t % 9) in pawn_files:
                        continue
                    moves.append((-1, t, False, k))
    return moves


def apply_move(state: ShogiState, move) -> ShogiState:
    f, t, promote, drop = move
    s = state.copy()
    me = state.turn
    if drop:
        s.board[t] = make_piece(drop, me)
        s.hands[me][drop] -= 1
        if s.hands[me][drop] <= 0:
            del s.hands[me][drop]
    else:
        p = s.board[f]
        cap = s.board[t]
        if cap is not None:
            base = kind_of(cap).lstrip("+")
            s.hands[me][base] = s.hands[me].get(base, 0) + 1
        k = kind_of(p)
        s.board[t] = make_piece("+" + k, me) if promote else p
        s.board[f] = None
    s.turn = GOTE if me == SENTE else SENTE
    s.ply += 1
    return s


def legal_moves(state: ShogiState) -> list:
    out = []
    me = state.turn
    for m in pseudo_moves(state):
        nxt = apply_move(state, m)
        if in_check(nxt, me):
            continue
        # 打ち歩詰めは反則
        if m[3] == "P" and in_check(nxt) and not _has_legal(nxt):
            continue
        out.append(m)
    return out


def _has_legal(state: ShogiState) -> bool:
    me = state.turn
    for m in pseudo_moves(state):
        if not in_check(apply_move(state, m), me):
            return True
    return False


def game_result(state: ShogiState, legal=None):
    """終わっていれば (勝者 "b"/"w"/None=引き分け, 理由)、続くなら None"""
    legal = legal if legal is not None else legal_moves(state)
    if not legal:
        return (GOTE if state.turn == SENTE else SENTE, "checkmate")
    if state.ply >= MAX_PLIES:
        return (None, "max_moves")
    return None


def move_to_text(state: ShogiState, move) -> str:
    """「▲７六歩」「△同銀」のような表記（同は使わず常にマス名）"""
    f, t, promote, drop = move
    mark = "☗" if state.turn == SENTE else "☖"
    if drop:
        return f"{mark}{square_name(t)}{KANJI[drop]}打"
    k = kind_of(state.board[f])
    text = f"{mark}{square_name(t)}{KANJI[k]}"
    if promote:
        text += "成"
    elif k in PROMOTABLE and (in_zone(f // 9, state.turn) or in_zone(t // 9, state.turn)):
        text += "不成"
    return text


def move_to_usi(move) -> str:
    f, t, promote, drop = move

    def sq(i):
        r, c = divmod(i, 9)
        return f"{9 - c}{'abcdefghi'[r]}"
    if drop:
        return f"{drop}*{sq(t)}"
    return sq(f) + sq(t) + ("+" if promote else "")


def usi_to_move(usi: str):
    def idx(s):
        return "abcdefghi".index(s[1]) * 9 + (9 - int(s[0]))
    if "*" in usi:
        return (-1, idx(usi[2:4]), False, usi[0].upper())
    return (idx(usi[0:2]), idx(usi[2:4]), usi.endswith("+"), None)


# ============================================================
# AI
# ============================================================
MATE = 1000000


def evaluate(state: ShogiState) -> int:
    """先手から見た点数"""
    score = 0
    for sq, p in enumerate(state.board):
        if p is None:
            continue
        k = kind_of(p)
        v = VALUES[k]
        # 前に出ている歩・銀・金を少し評価
        if k in ("P", "S", "G"):
            r = sq // 9
            v += (8 - r if p[-1].isupper() else r) * 3
        score += v if p[-1].isupper() else -v
    for side, sign in ((SENTE, 1), (GOTE, -1)):
        for k, n in state.hands[side].items():
            score += sign * HAND_VALUES[k] * n
    # 玉の周りの味方の駒
    for side, sign in ((SENTE, 1), (GOTE, -1)):
        ksq = king_square(state.board, side)
        if ksq < 0:
            continue
        r, c = divmod(ksq, 9)
        guard = 0
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if (dr or dc) and 0 <= rr < 9 and 0 <= cc < 9:
                    q = state.board[rr * 9 + cc]
                    if q is not None and side_of(q) == side:
                        guard += 1
        score += sign * guard * 15
    return score


def _order(state, moves):
    board = state.board

    def key(m):
        s = 0
        cap = board[m[1]]
        if cap is not None:
            s += 10 * VALUES[kind_of(cap)] + 50
        if m[2]:
            s += 300
        if m[3]:
            s -= 20
        return -s
    return sorted(moves, key=key)


def _search(state, depth, alpha, beta):
    sign = 1 if state.turn == SENTE else -1
    if depth == 0:
        return sign * evaluate(state)
    moves = pseudo_moves(state, include_drops=depth > 1)
    opp_king = make_piece("K", GOTE if state.turn == SENTE else SENTE)
    for m in moves:
        if m[3] is None and state.board[m[1]] == opp_king:
            return MATE
    best = -MATE * 2
    any_legal = False
    for m in _order(state, moves):
        nxt = apply_move(state, m)
        if in_check(nxt, state.turn):
            continue
        any_legal = True
        score = -_search(nxt, depth - 1, -beta, -alpha)
        if score > best:
            best = score
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    if not any_legal:
        return -MATE + (10 - depth)
    return best


AI_LEVEL_NAMES = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関"}


def ai_move(state: ShogiState, level: int):
    legal = legal_moves(state)
    if not legal:
        return None
    if level <= 1:
        return random.choice(legal)
    depth, noise = {2: (1, 60), 3: (1, 15), 4: (2, 5), 5: (3, 0)}.get(level, (3, 0))
    best_score, best = -MATE * 3, []
    alpha = -MATE * 3
    for m in _order(state, legal):
        nxt = apply_move(state, m)
        score = -_search(nxt, depth - 1, -MATE * 3, -alpha + noise) + (random.randint(-noise, noise) if noise else 0)
        if score > best_score:
            best_score, best = score, [m]
        elif score == best_score:
            best.append(m)
        if best_score > alpha:
            alpha = best_score
    return random.choice(best)
