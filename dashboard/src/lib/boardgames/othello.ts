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

// ---------------- AI（Bot と同じ5段階） ----------------

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
  const [depth, ab, w] = level === 3 ? [3, false, false] : level === 4 ? [5, true, false] : [7, true, true];
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
