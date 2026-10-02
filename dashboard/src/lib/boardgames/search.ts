/**
 * チェス・将棋のレベル6（超難関）AI 用の探索（Bot の ai_search.py と対応）。
 * 反復深化・静止探索・置換表・キラームーブ・ヒストリー・ヌルムーブ・LMR で、時間いっぱい深く読む。
 */

export const MATE = 1000000;

export interface SearchGame<S, M> {
  moves(s: S): M[];
  /** 駒を取る・成る手（静止探索用） */
  noisy(s: S): M[];
  apply(s: S, m: M): S;
  /** 指した側の玉/キングが取られる状態か（反則手） */
  leavesInCheck(s: S, next: S): boolean;
  inCheck(s: S): boolean;
  /** 手番側から見た点数 */
  evaluate(s: S): number;
  key(s: S): string;
  /** 手の並べ替え用（駒を取る・成る手は正、それ以外は 0） */
  orderScore(s: S, m: M): number;
  moveKey(m: M): string;
  noMovesScore(s: S, inCheck: boolean, ply: number): number;
  canNull(s: S): boolean;
  nullMove(s: S): S;
  checkExtension: boolean;
}

class Timeout extends Error {}

class Searcher<S, M> {
  deadline: number;
  tt = new Map<string, [number, number, number, M | null]>();
  killers = new Map<number, string[]>();
  history = new Map<string, number>();
  nodes = 0;
  canTimeout = false;

  constructor(private g: SearchGame<S, M>, timeLimitMs: number) {
    this.deadline = Date.now() + timeLimitMs;
  }

  private tick() {
    this.nodes++;
    if (this.canTimeout && (this.nodes & 255) === 0 && Date.now() > this.deadline) throw new Timeout();
  }

  private ordered(s: S, moves: M[], ttMove: M | null, ply: number) {
    const g = this.g;
    const killers = this.killers.get(ply) ?? [];
    const ttKey = ttMove ? g.moveKey(ttMove) : null;
    const scored = moves.map((m) => {
      const k = g.moveKey(m);
      let sc: number;
      if (k === ttKey) sc = 1e12;
      else {
        const o = g.orderScore(s, m);
        if (o > 0) sc = 1_000_000 + o;
        else if (killers.includes(k)) sc = 900_000;
        else sc = Math.min(this.history.get(k) ?? 0, 800_000);
      }
      return [sc, m] as const;
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map((x) => x[1]);
  }

  qsearch(s: S, alpha: number, beta: number, ply: number, qd: number): number {
    this.tick();
    const g = this.g;
    const chk = qd > -3 && g.inCheck(s);
    let moves: M[];
    let best: number;
    if (chk) {
      moves = g.moves(s);
      best = -MATE * 2;
    } else {
      const stand = g.evaluate(s);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd <= -8) return stand;
      moves = g.noisy(s);
      best = stand;
    }
    let anyLegal = false;
    const sorted = moves.map((m) => [g.orderScore(s, m), m] as const).sort((a, b) => b[0] - a[0]);
    for (const [, m] of sorted) {
      const next = g.apply(s, m);
      if (g.leavesInCheck(s, next)) continue;
      anyLegal = true;
      const sc = -this.qsearch(next, -beta, -alpha, ply + 1, qd - 1);
      if (sc > best) {
        best = sc;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) break;
        }
      }
    }
    if (chk && !anyLegal) return g.noMovesScore(s, true, ply);
    return best;
  }

  search(s: S, depth: number, alpha: number, beta: number, ply: number, allowNull = true): number {
    if (depth <= 0) return this.qsearch(s, alpha, beta, ply, 0);
    this.tick();
    const g = this.g;
    const key = g.key(s);
    const ent = this.tt.get(key);
    let ttMove: M | null = null;
    if (ent) {
      const [eDepth, eScore, eFlag, eMove] = ent;
      ttMove = eMove;
      if (eDepth >= depth) {
        if (eFlag === 0) return eScore;
        if (eFlag === 1 && eScore >= beta) return eScore;
        if (eFlag === 2 && eScore <= alpha) return eScore;
      }
    }
    const chk = g.inCheck(s);
    if (chk && g.checkExtension && ply < 16) depth++;
    // ヌルムーブ: パスしても相手を上回るなら読みを省く
    if (allowNull && !chk && depth >= 3 && g.canNull(s) && g.evaluate(s) >= beta) {
      const sc = -this.search(g.nullMove(s), depth - 3, -beta, -beta + 1, ply + 1, false);
      if (sc >= beta) return sc;
    }
    const alpha0 = alpha;
    let best = -MATE * 2;
    let bestMove: M | null = null;
    let n = 0;
    const killers = this.killers.get(ply) ?? [];
    for (const m of this.ordered(s, g.moves(s), ttMove, ply)) {
      const next = g.apply(s, m);
      if (g.leavesInCheck(s, next)) continue;
      n++;
      const quiet = g.orderScore(s, m) <= 0;
      const mk = g.moveKey(m);
      let sc: number;
      if (n > 4 && depth >= 3 && quiet && !chk && !killers.includes(mk)) {
        sc = -this.search(next, depth - 2, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha) sc = -this.search(next, depth - 1, -beta, -alpha, ply + 1);
      } else {
        sc = -this.search(next, depth - 1, -beta, -alpha, ply + 1);
      }
      if (sc > best) {
        best = sc;
        bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (quiet) {
              const k = this.killers.get(ply) ?? [];
              if (!k.includes(mk)) this.killers.set(ply, [mk, ...k].slice(0, 2));
              this.history.set(mk, (this.history.get(mk) ?? 0) + depth * depth);
            }
            break;
          }
        }
      }
    }
    if (n === 0) return g.noMovesScore(s, chk, ply);
    this.tt.set(key, [depth, best, best >= beta ? 1 : best <= alpha0 ? 2 : 0, bestMove]);
    return best;
  }
}

/** legal（合法手）の中から、時間いっぱい読んで一番良い手を返す */
export function bestMove<S, M>(g: SearchGame<S, M>, state: S, legal: M[], timeLimitMs: number, maxDepth = 64): M | null {
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];
  const srch = new Searcher(g, timeLimitMs);
  let ordered = legal.map((m) => [g.orderScore(state, m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  let best = ordered[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let itBest: M | null = null;
    let itScore = -MATE * 3;
    let alpha = -MATE * 3;
    try {
      for (const m of ordered) {
        const sc = -srch.search(g.apply(state, m), depth - 1, -MATE * 3, -alpha, 1);
        if (sc > itScore) {
          itScore = sc;
          itBest = m;
        }
        if (sc > alpha) alpha = sc;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // 前回の最善手を最初に読んでいるので、途中まででも itBest はそれ以上に良い手
      if (itBest !== null) best = itBest;
      break;
    }
    best = itBest!;
    ordered = [best, ...ordered.filter((m) => m !== best)];
    srch.canTimeout = true;
    if (itScore >= MATE - 1000 || Date.now() > srch.deadline) break;
  }
  return best;
}
