# -*- coding: utf-8 -*-
"""
オセロのレベル6（超難関）AI（dashboard/src/lib/boardgames/othello.ts の aiMoveStrong と対応）。

盤面を64ビットの整数2つ（自分の石・相手の石）で持つ「ビットボード」で高速に読み、
  ・評価: 隅 / 隅の隣（X・C打ち）/ 着手可能数（機動力）/ 開放度（石の周りの空き）/ 辺
  ・探索: 反復深化＋置換表の αβ 探索（時間いっぱい）
  ・終盤: 残り ENDGAME_EMPTIES マス以下は最後まで読み切って、石数で最善の手を打つ
マス番号は row * 8 + col（cogs/othello.py の board[row][col] と同じ並び）。
"""
import time

FULL = 0xFFFFFFFFFFFFFFFF
NOT_A = 0xFEFEFEFEFEFEFEFE  # 0列目（左端）以外
NOT_H = 0x7F7F7F7F7F7F7F7F  # 7列目（右端）以外
# (ずらす量, 左シフトか, 端をまたがないためのマスク)
SHIFTS = ((1, True, NOT_A), (9, True, NOT_A), (7, True, NOT_H), (8, True, FULL),
          (1, False, NOT_H), (9, False, NOT_H), (7, False, NOT_A), (8, False, FULL))

CORNERS = (0, 7, 56, 63)
CORNER_MASK = (1 << 0) | (1 << 7) | (1 << 56) | (1 << 63)
# 隅ごとの X打ち（斜め隣）と C打ち（横・縦の隣）
X_SQ = {0: 9, 7: 14, 56: 49, 63: 54}
C_SQ = {0: (1, 8), 7: (6, 15), 56: (48, 57), 63: (55, 62)}
EDGE_MASK = 0xFF818181818181FF & ~CORNER_MASK

ENDGAME_EMPTIES = 12
WIN = 100000


class _Timeout(Exception):
    pass


def _shift(b, d, left, m):
    return ((b << d) if left else (b >> d)) & m & FULL


def get_moves(P, O):
    empty = ~(P | O) & FULL
    moves = 0
    for d, left, m in SHIFTS:
        t = _shift(P, d, left, m) & O
        t |= _shift(t, d, left, m) & O
        t |= _shift(t, d, left, m) & O
        t |= _shift(t, d, left, m) & O
        t |= _shift(t, d, left, m) & O
        t |= _shift(t, d, left, m) & O
        moves |= _shift(t, d, left, m) & empty
    return moves


def flips(P, O, sq):
    x = 1 << sq
    f = 0
    for d, left, m in SHIFTS:
        line = 0
        cur = _shift(x, d, left, m)
        while cur & O:
            line |= cur
            cur = _shift(cur, d, left, m)
        if cur & P:
            f |= line
    return f


def _bits(b):
    while b:
        low = b & -b
        yield low.bit_length() - 1
        b ^= low


def _pop(b):
    return b.bit_count()


def evaluate(P, O) -> int:
    """手番側（P）から見た点数"""
    empty = ~(P | O) & FULL
    score = 0
    # 隅
    score += 80 * (_pop(P & CORNER_MASK) - _pop(O & CORNER_MASK))
    # 空いている隅の隣は危険
    for c in CORNERS:
        if empty >> c & 1:
            x = 1 << X_SQ[c]
            if P & x:
                score -= 40
            elif O & x:
                score += 40
            for cs in C_SQ[c]:
                b = 1 << cs
                if P & b:
                    score -= 12
                elif O & b:
                    score += 12
    # 機動力（置ける場所の多さ）
    mp, mo = _pop(get_moves(P, O)), _pop(get_moves(O, P))
    if mp + mo:
        score += 60 * (mp - mo) // (mp + mo + 2)
    score += 3 * (mp - mo)
    # 開放度（空きマスに接している石は相手に使われやすい）
    around_empty = 0
    for d, left, m in SHIFTS:
        around_empty |= _shift(empty, d, left, m)
    score -= 4 * (_pop(P & around_empty) - _pop(O & around_empty))
    # 辺
    score += 4 * (_pop(P & EDGE_MASK) - _pop(O & EDGE_MASK))
    # 終盤は石数も見る
    n_empty = _pop(empty)
    if n_empty < 20:
        score += (20 - n_empty) * (_pop(P) - _pop(O)) // 4
    return score


class _Search:
    def __init__(self, time_limit):
        self.deadline = time.time() + time_limit
        self.nodes = 0
        self.tt = {}
        self.can_timeout = False

    def _tick(self):
        self.nodes += 1
        if self.can_timeout and (self.nodes & 1023) == 0 and time.time() > self.deadline:
            raise _Timeout

    def _order(self, P, O, moves, tt_move):
        out = []
        for sq in _bits(moves):
            if sq == tt_move:
                pri = -1000
            elif sq in CORNERS:
                pri = -500
            else:
                f = flips(P, O, sq)
                nP, nO = P | f | (1 << sq), O & ~f
                # 相手の置ける場所が少なくなる手を先に
                pri = _pop(get_moves(nO, nP)) * 10
                if sq in (9, 14, 49, 54):
                    pri += 200
            out.append((pri, sq))
        out.sort()
        return [sq for _, sq in out]

    def negamax(self, P, O, depth, alpha, beta, passed=False):
        self._tick()
        moves = get_moves(P, O)
        if not moves:
            if passed or not get_moves(O, P):
                diff = _pop(P) - _pop(O)
                return WIN + diff if diff > 0 else (-WIN + diff if diff < 0 else 0)
            return -self.negamax(O, P, depth, -beta, -alpha, True)
        if depth <= 0:
            return evaluate(P, O)
        key = (P, O)
        ent = self.tt.get(key)
        tt_move = None
        if ent:
            e_depth, e_score, e_flag, tt_move = ent
            if e_depth >= depth:
                if e_flag == 0 or (e_flag == 1 and e_score >= beta) or (e_flag == 2 and e_score <= alpha):
                    return e_score
        alpha0 = alpha
        best, best_sq = -WIN * 2, None
        for sq in self._order(P, O, moves, tt_move) if depth >= 2 else _bits(moves):
            f = flips(P, O, sq)
            sc = -self.negamax(O & ~f, P | f | (1 << sq), depth - 1, -beta, -alpha)
            if sc > best:
                best, best_sq = sc, sq
                if sc > alpha:
                    alpha = sc
                    if alpha >= beta:
                        break
        self.tt[key] = (depth, best, 1 if best >= beta else (2 if best <= alpha0 else 0), best_sq)
        return best

    def solve(self, P, O, alpha, beta, passed=False):
        """最後まで読み切る（石数の差を返す）"""
        self._tick()
        moves = get_moves(P, O)
        if not moves:
            if passed or not get_moves(O, P):
                return _pop(P) - _pop(O)
            return -self.solve(O, P, -beta, -alpha, True)
        n_empty = 64 - _pop(P | O)
        order = self._order(P, O, moves, None) if n_empty > 6 else _bits(moves)
        best = -65
        for sq in order:
            f = flips(P, O, sq)
            sc = -self.solve(O & ~f, P | f | (1 << sq), -beta, -alpha)
            if sc > best:
                best = sc
                if sc > alpha:
                    alpha = sc
                    if alpha >= beta:
                        break
        return best


def strong_move(board, color: int, time_limit: float = 5.0):
    """board: 8×8（0=空, 1=黒, 2=白）、color: AI の色。置けなければ None"""
    P = O = 0
    for r in range(8):
        for c in range(8):
            v = board[r][c]
            if v == color:
                P |= 1 << (r * 8 + c)
            elif v:
                O |= 1 << (r * 8 + c)
    moves = get_moves(P, O)
    if not moves:
        return None
    squares = list(_bits(moves))
    if len(squares) == 1:
        return divmod(squares[0], 8)
    srch = _Search(time_limit)
    best = srch._order(P, O, moves, None)[0]
    n_empty = 64 - _pop(P | O)

    def root(fn):
        nonlocal best
        order = [best] + [s for s in srch._order(P, O, moves, None) if s != best]
        it_best, it_score, alpha = None, -WIN * 3, -WIN * 3
        try:
            for sq in order:
                f = flips(P, O, sq)
                sc = -fn(O & ~f, P | f | (1 << sq), -WIN * 3, -alpha)
                if sc > it_score:
                    it_score, it_best = sc, sq
                if sc > alpha:
                    alpha = sc
        except _Timeout:
            if it_best is not None:
                best = it_best
            return None
        best = it_best
        return it_score

    # まず中盤の読みで手を決める（深さ1は必ず読み終える）
    for depth in range(1, 61):
        if root(lambda a, b, al, be: srch.negamax(a, b, depth - 1, al, be)) is None:
            break
        srch.can_timeout = True
        if depth >= n_empty or time.time() > srch.deadline:
            break
    # 残りが少なければ最後まで読み切る（時間内に終われば、こちらの答えを使う）
    if n_empty <= ENDGAME_EMPTIES and time.time() < srch.deadline:
        root(lambda a, b, al, be: srch.solve(a, b, al, be))
    return divmod(best, 8)
