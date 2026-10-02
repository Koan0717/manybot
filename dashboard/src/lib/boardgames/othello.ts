/**
 * オセロのルールとAI（Bot の cogs/othello.py の OthelloBoard / OthelloAI と同じ動き）。
 * 盤面: 8×8。0 = 空、1 = 黒（先手）、2 = 白（後手）
 */

export type OthelloBoard = number[][];
export type OthelloMove = [number, number];

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const WEIGHT = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

export function newBoard(): OthelloBoard {
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  b[3][3] = 2;
  b[3][4] = 1;
  b[4][3] = 1;
  b[4][4] = 2;
  return b;
}

const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const copy = (b: OthelloBoard) => b.map((row) => row.slice());

function canPlace(b: OthelloBoard, row: number, col: number, color: number) {
  const opp = 3 - color;
  for (const [dr, dc] of DIRS) {
    let r = row + dr;
    let c = col + dc;
    let n = 0;
    while (inside(r, c) && b[r][c] === opp) {
      r += dr;
      c += dc;
      n++;
    }
    if (n > 0 && inside(r, c) && b[r][c] === color) return true;
  }
  return false;
}

export function validMoves(b: OthelloBoard, color: number): OthelloMove[] {
  const out: OthelloMove[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === 0 && canPlace(b, r, c, color)) out.push([r, c]);
  return out;
}

/** 石を置いてひっくり返した新しい盤面（置けないなら null）と、ひっくり返した石 */
export function applyMove(b: OthelloBoard, row: number, col: number, color: number): { board: OthelloBoard; flipped: OthelloMove[] } | null {
  if (b[row][col] !== 0 || !canPlace(b, row, col, color)) return null;
  const nb = copy(b);
  nb[row][col] = color;
  const opp = 3 - color;
  const flipped: OthelloMove[] = [];
  for (const [dr, dc] of DIRS) {
    let r = row + dr;
    let c = col + dc;
    const line: OthelloMove[] = [];
    while (inside(r, c) && nb[r][c] === opp) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }
    if (line.length && inside(r, c) && nb[r][c] === color) {
      for (const [fr, fc] of line) nb[fr][fc] = color;
      flipped.push(...line);
    }
  }
  return { board: nb, flipped };
}

export const isGameOver = (b: OthelloBoard) => !validMoves(b, 1).length && !validMoves(b, 2).length;

export function countStones(b: OthelloBoard): [number, number] {
  let black = 0;
  let white = 0;
  for (const row of b) for (const v of row) v === 1 ? black++ : v === 2 ? white++ : 0;
  return [black, white];
}

/** 0 = 引き分け、1 = 黒の勝ち、2 = 白の勝ち */
export function winner(b: OthelloBoard): 0 | 1 | 2 {
  const [black, white] = countStones(b);
  return black > white ? 1 : white > black ? 2 : 0;
}

// ---------------- AI（Bot と同じ6段階） ----------------

function evaluate(b: OthelloBoard, ai: number, useWeight: boolean) {
  const opp = 3 - ai;
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (b[r][c] === ai) score += useWeight ? WEIGHT[r][c] : 1;
      else if (b[r][c] === opp) score -= useWeight ? WEIGHT[r][c] : 1;
    }
  }
  return score;
}

function minimax(b: OthelloBoard, cur: number, ai: number, depth: number, alpha: number, beta: number, maximizing: boolean, ab: boolean, w: boolean): number {
  if (depth === 0 || isGameOver(b)) return evaluate(b, ai, w);
  const moves = validMoves(b, cur);
  if (!moves.length) return minimax(b, 3 - cur, ai, depth - 1, alpha, beta, !maximizing, ab, w);
  let best = maximizing ? -Infinity : Infinity;
  for (const [r, c] of moves) {
    const val = minimax(applyMove(b, r, c, cur)!.board, 3 - cur, ai, depth - 1, alpha, beta, !maximizing, ab, w);
    if (maximizing) {
      best = Math.max(best, val);
      if (ab) alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, val);
      if (ab) beta = Math.min(beta, best);
    }
    if (ab && beta <= alpha) break;
  }
  return best;
}

export function aiMove(b: OthelloBoard, color: number, level: number): OthelloMove | null {
  const moves = validMoves(b, color);
  if (!moves.length) return null;
  if (level <= 1) return moves[Math.floor(Math.random() * moves.length)];
  if (level >= 6) return aiMoveStrong(b, color);
  if (level === 2) {
    let best = moves[0];
    let bestCount = -1;
    for (const [r, c] of moves) {
      const nb = applyMove(b, r, c, color)!.board;
      const n = nb.flat().filter((v) => v === color).length;
      if (n > bestCount) {
        bestCount = n;
        best = [r, c];
      }
    }
    return best;
  }
  // レベル4は以前は石の数だけで評価していて弱かった（隅を簡単に取られる）ため、位置の重みで評価する
  const [depth, ab, w] = level === 3 ? [3, false, false] : level === 4 ? [5, true, true] : [7, true, true];
  let best = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const [r, c] of moves) {
    const score = minimax(applyMove(b, r, c, color)!.board, 3 - color, color, depth - 1, alpha, Infinity, false, ab, w);
    if (score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
    if (ab) alpha = Math.max(alpha, bestScore);
  }
  return best;
}

// ============================================================
// レベル6（超難関）: 時間いっぱい読み、終盤は最後まで読み切る（Bot の othello_engine.py と対応）
// 盤面は 64 マスの配列（index = row * 8 + col）で、置く→戻す を繰り返して高速に読む
// ============================================================
const LEVEL6_TIME_MS = 2500;
const ENDGAME_EMPTIES = 14;
const WIN = 100000;
const RAYS: number[][][] = Array.from({ length: 64 }, (_, sq) => {
  const r0 = Math.floor(sq / 8);
  const c0 = sq % 8;
  return DIRS.map(([dr, dc]) => {
    const ray: number[] = [];
    for (let r = r0 + dr, c = c0 + dc; inside(r, c); r += dr, c += dc) ray.push(r * 8 + c);
    return ray;
  }).filter((ray) => ray.length > 1);
});
const NEIGHBORS: number[][] = Array.from({ length: 64 }, (_, sq) =>
  DIRS.map(([dr, dc]) => [Math.floor(sq / 8) + dr, (sq % 8) + dc])
    .filter(([r, c]) => inside(r, c))
    .map(([r, c]) => r * 8 + c)
);
const CORNER_SQ = [0, 7, 56, 63];
const X_OF: Record<number, number> = { 0: 9, 7: 14, 56: 49, 63: 54 };
const C_OF: Record<number, number[]> = { 0: [1, 8], 7: [6, 15], 56: [48, 57], 63: [55, 62] };
const IS_EDGE = Array.from({ length: 64 }, (_, sq) => {
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  return (r === 0 || r === 7 || c === 0 || c === 7) && !CORNER_SQ.includes(sq);
});

class OthelloTimeout extends Error {}

function flipsAt(b: Int8Array, sq: number, me: number): number[] {
  const opp = 3 - me;
  const out: number[] = [];
  for (const ray of RAYS[sq]) {
    let n = 0;
    while (n < ray.length && b[ray[n]] === opp) n++;
    if (n > 0 && n < ray.length && b[ray[n]] === me) for (let i = 0; i < n; i++) out.push(ray[i]);
  }
  return out;
}

function canFlip(b: Int8Array, sq: number, me: number) {
  const opp = 3 - me;
  for (const ray of RAYS[sq]) {
    let n = 0;
    while (n < ray.length && b[ray[n]] === opp) n++;
    if (n > 0 && n < ray.length && b[ray[n]] === me) return true;
  }
  return false;
}

function movesOf(b: Int8Array, me: number): number[] {
  const out: number[] = [];
  for (let sq = 0; sq < 64; sq++) if (b[sq] === 0 && canFlip(b, sq, me)) out.push(sq);
  return out;
}

/** 手番側（me）から見た点数 */
function evaluateStrong(b: Int8Array, me: number) {
  const opp = 3 - me;
  let score = 0;
  for (const c of CORNER_SQ) {
    if (b[c] === me) score += 80;
    else if (b[c] === opp) score -= 80;
    else {
      const x = b[X_OF[c]];
      if (x === me) score -= 40;
      else if (x === opp) score += 40;
      for (const cs of C_OF[c]) {
        if (b[cs] === me) score -= 12;
        else if (b[cs] === opp) score += 12;
      }
    }
  }
  const mp = movesOf(b, me).length;
  const mo = movesOf(b, opp).length;
  if (mp + mo) score += Math.trunc((60 * (mp - mo)) / (mp + mo + 2));
  score += 3 * (mp - mo);
  let empties = 0;
  let disc = 0;
  for (let sq = 0; sq < 64; sq++) {
    const v = b[sq];
    if (v === 0) {
      empties++;
      continue;
    }
    const s = v === me ? 1 : -1;
    disc += s;
    if (IS_EDGE[sq]) score += 4 * s;
    if (NEIGHBORS[sq].some((n) => b[n] === 0)) score -= 4 * s;
  }
  if (empties < 20) score += Math.trunc(((20 - empties) * disc) / 4);
  return score;
}

function discDiff(b: Int8Array, me: number) {
  let d = 0;
  for (let sq = 0; sq < 64; sq++) if (b[sq]) d += b[sq] === me ? 1 : -1;
  return d;
}

class OthelloSearch {
  deadline: number;
  nodes = 0;
  canTimeout = false;
  tt = new Map<string, [number, number, number, number]>();

  constructor(public b: Int8Array, timeMs: number) {
    this.deadline = Date.now() + timeMs;
  }

  private tick() {
    this.nodes++;
    if (this.canTimeout && (this.nodes & 1023) === 0 && Date.now() > this.deadline) throw new OthelloTimeout();
  }

  play(sq: number, me: number) {
    const f = flipsAt(this.b, sq, me);
    this.b[sq] = me;
    for (const x of f) this.b[x] = me;
    return f;
  }

  undo(sq: number, f: number[], me: number) {
    this.b[sq] = 0;
    for (const x of f) this.b[x] = 3 - me;
  }

  order(me: number, moves: number[], ttMove = -1) {
    const scored = moves.map((sq) => {
      if (sq === ttMove) return [-1000, sq];
      if (CORNER_SQ.includes(sq)) return [-500, sq];
      const f = this.play(sq, me);
      let pri = movesOf(this.b, 3 - me).length * 10;
      this.undo(sq, f, me);
      if (sq === 9 || sq === 14 || sq === 49 || sq === 54) pri += 200;
      return [pri, sq];
    });
    scored.sort((a, b) => a[0] - b[0]);
    return scored.map((x) => x[1]);
  }

  negamax(me: number, depth: number, alpha: number, beta: number, passed = false): number {
    this.tick();
    const moves = movesOf(this.b, me);
    if (!moves.length) {
      if (passed || !movesOf(this.b, 3 - me).length) {
        const d = discDiff(this.b, me);
        return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
      }
      return -this.negamax(3 - me, depth, -beta, -alpha, true);
    }
    if (depth <= 0) return evaluateStrong(this.b, me);
    const key = this.b.join('') + me;
    const ent = this.tt.get(key);
    let ttMove = -1;
    if (ent) {
      const [eDepth, eScore, eFlag, eMove] = ent;
      ttMove = eMove;
      if (eDepth >= depth && (eFlag === 0 || (eFlag === 1 && eScore >= beta) || (eFlag === 2 && eScore <= alpha))) return eScore;
    }
    const alpha0 = alpha;
    let best = -WIN * 2;
    let bestSq = -1;
    for (const sq of depth >= 2 ? this.order(me, moves, ttMove) : moves) {
      const f = this.play(sq, me);
      let sc: number;
      try {
        sc = -this.negamax(3 - me, depth - 1, -beta, -alpha);
      } finally {
        this.undo(sq, f, me);
      }
      if (sc > best) {
        best = sc;
        bestSq = sq;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) break;
        }
      }
    }
    this.tt.set(key, [depth, best, best >= beta ? 1 : best <= alpha0 ? 2 : 0, bestSq]);
    return best;
  }

  /** 最後まで読み切る（石数の差を返す） */
  solve(me: number, alpha: number, beta: number, passed = false): number {
    this.tick();
    const moves = movesOf(this.b, me);
    if (!moves.length) {
      if (passed || !movesOf(this.b, 3 - me).length) return discDiff(this.b, me);
      return -this.solve(3 - me, -beta, -alpha, true);
    }
    let empties = 0;
    for (let sq = 0; sq < 64; sq++) if (!this.b[sq]) empties++;
    let best = -65;
    for (const sq of empties > 6 ? this.order(me, moves) : moves) {
      const f = this.play(sq, me);
      let sc: number;
      try {
        sc = -this.solve(3 - me, -beta, -alpha);
      } finally {
        this.undo(sq, f, me);
      }
      if (sc > best) {
        best = sc;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }
}

/** レベル6の手（置けなければ null） */
export function aiMoveStrong(board: OthelloBoard, color: number, timeMs = LEVEL6_TIME_MS): OthelloMove | null {
  const b = Int8Array.from(([] as number[]).concat(...board));
  const moves = movesOf(b, color);
  if (!moves.length) return null;
  if (moves.length === 1) return [Math.floor(moves[0] / 8), moves[0] % 8];
  const srch = new OthelloSearch(b, timeMs);
  let best = srch.order(color, moves)[0];
  let empties = 0;
  for (let sq = 0; sq < 64; sq++) if (!b[sq]) empties++;

  // 1手ずつ読んで一番良い手を best に入れる。時間切れなら false
  const root = (fn: (alpha: number, beta: number) => number) => {
    const order = [best, ...srch.order(color, moves).filter((s) => s !== best)];
    let itBest = -1;
    let itScore = -WIN * 3;
    let alpha = -WIN * 3;
    try {
      for (const sq of order) {
        const f = srch.play(sq, color);
        let sc: number;
        try {
          sc = -fn(-WIN * 3, -alpha);
        } finally {
          srch.undo(sq, f, color);
        }
        if (sc > itScore) {
          itScore = sc;
          itBest = sq;
        }
        if (sc > alpha) alpha = sc;
      }
    } catch (e) {
      if (!(e instanceof OthelloTimeout)) throw e;
      if (itBest >= 0) best = itBest;
      return false;
    }
    best = itBest;
    return true;
  };

  for (let depth = 1; depth <= 60; depth++) {
    if (!root((a, be) => srch.negamax(3 - color, depth - 1, a, be))) break;
    srch.canTimeout = true;
    if (depth >= empties || Date.now() > srch.deadline) break;
  }
  // 残りが少なければ最後まで読み切る（時間内に終われば、こちらの答えを使う）
  if (empties <= ENDGAME_EMPTIES && Date.now() < srch.deadline) root((a, be) => srch.solve(3 - color, a, be));
  return [Math.floor(best / 8), best % 8];
}
