# -*- coding: utf-8 -*-
"""
チェスのルールとAI（Bot・Webで同じ動きになるよう dashboard/src/lib/boardgames/chess.ts と対応）。

盤面: 64マスのリスト。index = row * 8 + col（row 0 = 8段目 = 黒側、row 7 = 1段目 = 白側）
駒: 白は大文字 "PNBRQK"、黒は小文字、空きは "."
手: (from, to, promo)  promo は "q","r","b","n" または None
"""
import random

WHITE, BLACK = "w", "b"
FILES = "abcdefgh"

KNIGHT_STEPS = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
KING_STEPS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
ROOK_DIRS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
BISHOP_DIRS = [(-1, -1), (-1, 1), (1, -1), (1, 1)]

VALUES = {"p": 100, "n": 320, "b": 330, "r": 500, "q": 900, "k": 20000}

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def color_of(piece: str):
    if piece == ".":
        return None
    return WHITE if piece.isupper() else BLACK


def sq_name(i: int) -> str:
    return f"{FILES[i % 8]}{8 - i // 8}"


class ChessState:
    __slots__ = ("board", "turn", "castling", "ep", "halfmove", "fullmove")

    def __init__(self, board, turn=WHITE, castling="KQkq", ep=-1, halfmove=0, fullmove=1):
        self.board = board
        self.turn = turn
        self.castling = castling
        self.ep = ep
        self.halfmove = halfmove
        self.fullmove = fullmove

    @staticmethod
    def from_fen(fen: str = START_FEN) -> "ChessState":
        parts = fen.split()
        board = []
        for ch in parts[0]:
            if ch == "/":
                continue
            if ch.isdigit():
                board.extend(["."] * int(ch))
            else:
                board.append(ch)
        ep = -1
        if len(parts) > 3 and parts[3] != "-":
            ep = (8 - int(parts[3][1])) * 8 + FILES.index(parts[3][0])
        return ChessState(
            board,
            parts[1] if len(parts) > 1 else WHITE,
            "" if len(parts) < 3 or parts[2] == "-" else parts[2],
            ep,
            int(parts[4]) if len(parts) > 4 else 0,
            int(parts[5]) if len(parts) > 5 else 1,
        )

    def to_fen(self) -> str:
        rows = []
        for r in range(8):
            row, empty = "", 0
            for c in range(8):
                p = self.board[r * 8 + c]
                if p == ".":
                    empty += 1
                else:
                    if empty:
                        row += str(empty)
                        empty = 0
                    row += p
            if empty:
                row += str(empty)
            rows.append(row)
        ep = sq_name(self.ep) if self.ep >= 0 else "-"
        return f"{'/'.join(rows)} {self.turn} {self.castling or '-'} {ep} {self.halfmove} {self.fullmove}"

    def copy(self) -> "ChessState":
        return ChessState(self.board[:], self.turn, self.castling, self.ep, self.halfmove, self.fullmove)


def is_attacked(board, sq: int, by: str) -> bool:
    """sq が by 側の駒に利かされているか"""
    r, c = divmod(sq, 8)
    # ポーン
    if by == WHITE:
        for dc in (-1, 1):
            rr, cc = r + 1, c + dc
            if 0 <= rr < 8 and 0 <= cc < 8 and board[rr * 8 + cc] == "P":
                return True
    else:
        for dc in (-1, 1):
            rr, cc = r - 1, c + dc
            if 0 <= rr < 8 and 0 <= cc < 8 and board[rr * 8 + cc] == "p":
                return True
    knight, king = ("N", "K") if by == WHITE else ("n", "k")
    for dr, dc in KNIGHT_STEPS:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and board[rr * 8 + cc] == knight:
            return True
    for dr, dc in KING_STEPS:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and board[rr * 8 + cc] == king:
            return True
    rook, queen, bishop = ("R", "Q", "B") if by == WHITE else ("r", "q", "b")
    for dirs, sliders in ((ROOK_DIRS, (rook, queen)), (BISHOP_DIRS, (bishop, queen))):
        for dr, dc in dirs:
            rr, cc = r + dr, c + dc
            while 0 <= rr < 8 and 0 <= cc < 8:
                p = board[rr * 8 + cc]
                if p != ".":
                    if p in sliders:
                        return True
                    break
                rr += dr
                cc += dc
    return False


def king_square(board, color: str) -> int:
    k = "K" if color == WHITE else "k"
    try:
        return board.index(k)
    except ValueError:
        return -1


def in_check(state: ChessState, color: str = None) -> bool:
    color = color or state.turn
    ksq = king_square(state.board, color)
    return ksq >= 0 and is_attacked(state.board, ksq, BLACK if color == WHITE else WHITE)


def pseudo_moves(state: ChessState, captures_only: bool = False) -> list:
    board, me = state.board, state.turn
    opp = BLACK if me == WHITE else WHITE
    moves = []
    for sq in range(64):
        p = board[sq]
        if p == "." or color_of(p) != me:
            continue
        r, c = divmod(sq, 8)
        kind = p.lower()
        if kind == "p":
            d = -1 if me == WHITE else 1
            start_row = 6 if me == WHITE else 1
            last_row = 0 if me == WHITE else 7
            rr = r + d
            if 0 <= rr < 8:
                if not captures_only and board[rr * 8 + c] == ".":
                    _add_pawn(moves, sq, rr * 8 + c, rr == last_row)
                    if r == start_row and board[(r + 2 * d) * 8 + c] == ".":
                        moves.append((sq, (r + 2 * d) * 8 + c, None))
                for dc in (-1, 1):
                    cc = c + dc
                    if 0 <= cc < 8:
                        t = rr * 8 + cc
                        if (board[t] != "." and color_of(board[t]) == opp) or t == state.ep:
                            _add_pawn(moves, sq, t, rr == last_row)
        elif kind == "n" or kind == "k":
            for dr, dc in (KNIGHT_STEPS if kind == "n" else KING_STEPS):
                rr, cc = r + dr, c + dc
                if 0 <= rr < 8 and 0 <= cc < 8:
                    t = rr * 8 + cc
                    q = board[t]
                    if q == "." and not captures_only:
                        moves.append((sq, t, None))
                    elif q != "." and color_of(q) == opp:
                        moves.append((sq, t, None))
            if kind == "k" and not captures_only:
                _add_castles(state, moves, sq)
        else:
            dirs = ROOK_DIRS if kind == "r" else BISHOP_DIRS if kind == "b" else ROOK_DIRS + BISHOP_DIRS
            for dr, dc in dirs:
                rr, cc = r + dr, c + dc
                while 0 <= rr < 8 and 0 <= cc < 8:
                    t = rr * 8 + cc
                    q = board[t]
                    if q == ".":
                        if not captures_only:
                            moves.append((sq, t, None))
                    else:
                        if color_of(q) == opp:
                            moves.append((sq, t, None))
                        break
                    rr += dr
                    cc += dc
    return moves


def _add_pawn(moves, f, t, promote):
    if promote:
        for pr in ("q", "r", "b", "n"):
            moves.append((f, t, pr))
    else:
        moves.append((f, t, None))


def _add_castles(state, moves, ksq):
    board, me = state.board, state.turn
    opp = BLACK if me == WHITE else WHITE
    home = 60 if me == WHITE else 4
    if ksq != home:
        return
    rights = state.castling
    k_side, q_side = ("K", "Q") if me == WHITE else ("k", "q")
    rook = "R" if me == WHITE else "r"
    if k_side in rights and board[home + 1] == "." and board[home + 2] == "." and board[home + 3] == rook:
        if not is_attacked(board, home, opp) and not is_attacked(board, home + 1, opp) and not is_attacked(board, home + 2, opp):
            moves.append((home, home + 2, None))
    if q_side in rights and board[home - 1] == "." and board[home - 2] == "." and board[home - 3] == "." and board[home - 4] == rook:
        if not is_attacked(board, home, opp) and not is_attacked(board, home - 1, opp) and not is_attacked(board, home - 2, opp):
            moves.append((home, home - 2, None))


def apply_move(state: ChessState, move) -> ChessState:
    f, t, promo = move
    s = state.copy()
    board = s.board
    p = board[f]
    kind = p.lower()
    captured = board[t]
    me = state.turn
    # アンパッサン
    if kind == "p" and t == state.ep and captured == ".":
        board[t + (8 if me == WHITE else -8)] = "."
        captured = "p"
    board[t] = (promo.upper() if me == WHITE else promo) if promo else p
    board[f] = "."
    # キャスリングのルークを動かす
    if kind == "k" and abs(t - f) == 2:
        if t > f:
            board[t - 1], board[t + 1] = board[t + 1], "."
        else:
            board[t + 1], board[t - 2] = board[t - 2], "."
    # キャスリング権
    rights = s.castling
    if kind == "k":
        rights = rights.replace("K", "").replace("Q", "") if me == WHITE else rights.replace("k", "").replace("q", "")
    for sq, flag in ((63, "K"), (56, "Q"), (7, "k"), (0, "q")):
        if f == sq or t == sq:
            rights = rights.replace(flag, "")
    s.castling = rights
    s.ep = (f + t) // 2 if kind == "p" and abs(t - f) == 16 else -1
    s.halfmove = 0 if kind == "p" or captured != "." else state.halfmove + 1
    if me == BLACK:
        s.fullmove += 1
    s.turn = BLACK if me == WHITE else WHITE
    return s


def legal_moves(state: ChessState) -> list:
    out = []
    for m in pseudo_moves(state):
        nxt = apply_move(state, m)
        if not in_check(nxt, state.turn):
            out.append(m)
    return out


def insufficient_material(board) -> bool:
    pieces = [p for p in board if p != "." and p.lower() != "k"]
    if not pieces:
        return True
    if len(pieces) == 1 and pieces[0].lower() in ("n", "b"):
        return True
    return False


def game_result(state: ChessState, legal=None):
    """
    対局が終わっていれば (勝者 "w"/"b"/None=引き分け, 理由) を返す。続くなら None。
    """
    legal = legal if legal is not None else legal_moves(state)
    if not legal:
        if in_check(state):
            return (BLACK if state.turn == WHITE else WHITE, "checkmate")
        return (None, "stalemate")
    if state.halfmove >= 100:
        return (None, "fifty")
    if insufficient_material(state.board):
        return (None, "material")
    return None


def move_to_san(state: ChessState, move, legal=None) -> str:
    f, t, promo = move
    p = state.board[f]
    kind = p.lower()
    if kind == "k" and abs(t - f) == 2:
        san = "O-O" if t > f else "O-O-O"
    else:
        capture = state.board[t] != "." or (kind == "p" and t == state.ep)
        if kind == "p":
            san = (FILES[f % 8] + "x" if capture else "") + sq_name(t)
            if promo:
                san += "=" + promo.upper()
        else:
            legal = legal if legal is not None else legal_moves(state)
            others = [m for m in legal if m[1] == t and m[0] != f and state.board[m[0]] == p]
            dis = ""
            if others:
                if all(m[0] % 8 != f % 8 for m in others):
                    dis = FILES[f % 8]
                elif all(m[0] // 8 != f // 8 for m in others):
                    dis = str(8 - f // 8)
                else:
                    dis = sq_name(f)
            san = kind.upper() + dis + ("x" if capture else "") + sq_name(t)
    nxt = apply_move(state, move)
    if in_check(nxt):
        san += "#" if not legal_moves(nxt) else "+"
    return san


def move_to_uci(move) -> str:
    f, t, promo = move
    return sq_name(f) + sq_name(t) + (promo or "")


def uci_to_move(uci: str):
    f = (8 - int(uci[1])) * 8 + FILES.index(uci[0])
    t = (8 - int(uci[3])) * 8 + FILES.index(uci[2])
    return (f, t, uci[4] if len(uci) > 4 else None)


# ============================================================
# AI
# ============================================================
# 位置の点数（白から見た値。黒は上下反転して使う）
PST = {
    "p": [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
          0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    "n": [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
          -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    "b": [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
          -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    "r": [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
          -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    "q": [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
          0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    "k": [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
          -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
}

MATE = 1000000


def evaluate(board, use_pst: bool) -> int:
    """白から見た点数"""
    score = 0
    for sq, p in enumerate(board):
        if p == ".":
            continue
        kind = p.lower()
        v = VALUES[kind]
        if use_pst:
            v += PST[kind][sq if p.isupper() else (7 - sq // 8) * 8 + sq % 8]
        score += v if p.isupper() else -v
    return score


def _order(state, moves):
    board = state.board

    def key(m):
        cap = board[m[1]]
        s = 0
        if cap != ".":
            s += 10 * VALUES[cap.lower()] - VALUES[board[m[0]].lower()] // 10
        if m[2]:
            s += VALUES[m[2]]
        return -s
    return sorted(moves, key=key)


def _search(state, depth, alpha, beta, use_pst):
    """ネガマックス（手番側から見た点数）。王を取れる手があれば即勝ち扱い（疑似合法手で高速化）"""
    sign = 1 if state.turn == WHITE else -1
    if depth == 0:
        return sign * evaluate(state.board, use_pst)
    moves = pseudo_moves(state)
    opp_king = "k" if state.turn == WHITE else "K"
    for m in moves:
        if state.board[m[1]] == opp_king:
            return MATE
    best = -MATE * 2
    any_legal = False
    for m in _order(state, moves):
        nxt = apply_move(state, m)
        if in_check(nxt, state.turn):
            continue
        any_legal = True
        score = -_search(nxt, depth - 1, -beta, -alpha, use_pst)
        if score > best:
            best = score
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    if not any_legal:
        return -MATE + (10 - depth) if in_check(state) else 0
    return best


AI_LEVEL_NAMES = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関"}


def ai_move(state: ChessState, level: int):
    legal = legal_moves(state)
    if not legal:
        return None
    if level <= 1:
        return random.choice(legal)
    depth, use_pst, noise = {2: (1, False, 30), 3: (2, True, 10), 4: (3, True, 0), 5: (4, True, 0)}.get(level, (4, True, 0))
    best_score, best = -MATE * 3, []
    alpha = -MATE * 3
    for m in _order(state, legal):
        nxt = apply_move(state, m)
        score = -_search(nxt, depth - 1, -MATE * 3, -alpha + noise, use_pst) + (random.randint(-noise, noise) if noise else 0)
        if score > best_score:
            best_score, best = score, [m]
        elif score == best_score:
            best.append(m)
        if best_score > alpha:
            alpha = best_score
    return random.choice(best)
