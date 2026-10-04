# -*- coding: utf-8 -*-
"""
チェス・将棋のレベル6（超難関）AI 用の探索（dashboard/src/lib/boardgames/search.ts と対応）。

レベル5までは決まった深さを読むだけだったが、レベル6は
  ・反復深化（時間いっぱい1手ずつ深く読む）
  ・静止探索（駒を取り合う途中で読みを打ち切らない＝読み抜けによる大悪手を防ぐ）
  ・置換表 / キラームーブ / ヒストリー（良い手から読んで枝刈りを効かせる）
  ・ヌルムーブ枝刈り / 後半の手の読みを浅くする（LMR）
で、同じ時間でもずっと深く・正確に読む。

ゲームごとの違いは game オブジェクト（下記メソッドを持つ）で渡す:
  moves(s)                全ての疑似合法手
  noisy(s)                駒を取る・成る手（静止探索用）
  apply(s, m)             手を指した後の局面
  leaves_in_check(s, n)   指した側の玉/キングが取られる状態か（反則手）
  in_check(s)             手番側が王手されているか
  evaluate(s)             手番側から見た点数
  key(s)                  置換表のキー
  order_score(s, m)       手の並べ替え用（駒を取る・成る手は正、それ以外は 0）
  no_moves_score(s, chk, ply)  指せる手がないときの点数
  can_null(s) / null(s)   ヌルムーブ（パスしたことにする）が使えるか / パスした局面
  check_extension         王手のときに1手延長するか
"""
import time

MATE = 1000000


class SearchTimeout(Exception):
    pass


class Searcher:
    def __init__(self, game, time_limit: float):
        self.g = game
        self.deadline = time.time() + time_limit
        self.tt = {}
        self.killers = {}
        self.history = {}
        self.nodes = 0
        self.can_timeout = False  # 深さ1を読み終えるまでは打ち切らない

    def _tick(self):
        self.nodes += 1
        if self.can_timeout and (self.nodes & 255) == 0 and time.time() > self.deadline:
            raise SearchTimeout

    def _ordered(self, s, moves, tt_move, ply):
        g = self.g
        killers = self.killers.get(ply, ())
        hist = self.history

        def key(m):
            if m == tt_move:
                return -10 ** 12
            sc = g.order_score(s, m)
            if sc > 0:
                return -(1_000_000 + sc)
            if m in killers:
                return -900_000
            return -min(hist.get(m, 0), 800_000)
        return sorted(moves, key=key)

    def qsearch(self, s, alpha, beta, ply, qd):
        self._tick()
        g = self.g
        chk = qd > -3 and g.in_check(s)
        if chk:
            # 王手されているときは逃げ方を全部読む（取り合いの途中で詰みを見落とさない）
            moves = g.moves(s)
            best = -MATE * 2
        else:
            stand = g.evaluate(s)
            if stand >= beta:
                return stand
            if stand > alpha:
                alpha = stand
            if qd <= -8:
                return stand
            moves = g.noisy(s)
            best = stand
        any_legal = False
        for m in sorted(moves, key=lambda m: -g.order_score(s, m)):
            nxt = g.apply(s, m)
            if g.leaves_in_check(s, nxt):
                continue
            any_legal = True
            sc = -self.qsearch(nxt, -beta, -alpha, ply + 1, qd - 1)
            if sc > best:
                best = sc
                if sc > alpha:
                    alpha = sc
                    if alpha >= beta:
                        break
        if chk and not any_legal:
            return g.no_moves_score(s, True, ply)
        return best

    def search(self, s, depth, alpha, beta, ply, allow_null=True):
        if depth <= 0:
            return self.qsearch(s, alpha, beta, ply, 0)
        self._tick()
        g = self.g
        key = g.key(s)
        ent = self.tt.get(key)
        tt_move = None
        if ent:
            e_depth, e_score, e_flag, tt_move = ent
            if e_depth >= depth:
                if e_flag == 0:
                    return e_score
                if e_flag == 1 and e_score >= beta:
                    return e_score
                if e_flag == 2 and e_score <= alpha:
                    return e_score
        chk = g.in_check(s)
        if chk and g.check_extension and ply < 16:
            depth += 1
        # ヌルムーブ: パスしても相手を上回るなら、この局面は十分良いので読みを省く
        if allow_null and not chk and depth >= 3 and g.can_null(s) and g.evaluate(s) >= beta:
            sc = -self.search(g.null(s), depth - 3, -beta, -beta + 1, ply + 1, False)
            if sc >= beta:
                return sc
        alpha0 = alpha
        best, best_move = -MATE * 2, None
        n = 0
        for m in self._ordered(s, g.moves(s), tt_move, ply):
            nxt = g.apply(s, m)
            if g.leaves_in_check(s, nxt):
                continue
            n += 1
            quiet = g.order_score(s, m) <= 0
            if n > 4 and depth >= 3 and quiet and not chk and m not in self.killers.get(ply, ()):
                # 後半の静かな手はまず浅く読み、良さそうなら読み直す
                sc = -self.search(nxt, depth - 2, -alpha - 1, -alpha, ply + 1)
                if sc > alpha:
                    sc = -self.search(nxt, depth - 1, -beta, -alpha, ply + 1)
            else:
                sc = -self.search(nxt, depth - 1, -beta, -alpha, ply + 1)
            if sc > best:
                best, best_move = sc, m
                if sc > alpha:
                    alpha = sc
                    if alpha >= beta:
                        if quiet:
                            k = self.killers.setdefault(ply, [])
                            if m not in k:
                                k.insert(0, m)
                                del k[2:]
                            self.history[m] = self.history.get(m, 0) + depth * depth
                        break
        if n == 0:
            return g.no_moves_score(s, chk, ply)
        flag = 1 if best >= beta else (2 if best <= alpha0 else 0)
        self.tt[key] = (depth, best, flag, best_move)
        return best


def best_move(game, state, legal: list, time_limit: float, max_depth: int = 64):
    """legal（合法手）の中から、時間いっぱい読んで一番良い手を返す"""
    if not legal:
        return None
    if len(legal) == 1:
        return legal[0]
    srch = Searcher(game, time_limit)
    ordered = sorted(legal, key=lambda m: -game.order_score(state, m))
    best = ordered[0]
    for depth in range(1, max_depth + 1):
        it_best, it_score = None, -MATE * 3
        alpha = -MATE * 3
        try:
            for m in ordered:
                sc = -srch.search(game.apply(state, m), depth - 1, -MATE * 3, -alpha, 1)
                if sc > it_score:
                    it_score, it_best = sc, m
                if sc > alpha:
                    alpha = sc
        except SearchTimeout:
            # 前回の最善手を最初に読んでいるので、途中まででも it_best はそれ以上に良い手
            if it_best is not None:
                best = it_best
            break
        best = it_best
        ordered = [best] + [m for m in ordered if m != best]
        srch.can_timeout = True
        if it_score >= MATE - 1000 or time.time() > srch.deadline:
            break
    return best
