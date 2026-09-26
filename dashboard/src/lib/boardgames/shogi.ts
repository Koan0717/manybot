/**
 * 将棋のルールとAI（Bot の shogi_engine.py と同じ動き）。
 * 盤面: 81マス。index = row * 9 + col（row 0 = 一段目 = 後手側、col 0 = 9筋）
 * 駒: 先手は大文字、後手は小文字、成り駒は先頭に "+"。空きは null
 * 手番: 'b' = 先手、'w' = 後手
 */

export type Side = 'b' | 'w';
export type Hand = Record<string, number>;
export interface ShogiState {
  board: (string | null)[];
  turn: Side;
  hands: Record<Side, Hand>;
  ply: number;
}
/** [from, to, promote, drop]  持ち駒を打つときは from = -1, drop = 'P' など */
export type ShogiMove = [number, number, boolean, string | null];

export const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
export const KANJI: Record<string, string> = {
  K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
  '+R': '竜', '+B': '馬', '+S': '全', '+N': '圭', '+L': '杏', '+P': 'と',
};
/** 棋譜用（成銀などは2文字） */
const KANJI_LONG: Record<string, string> = { ...KANJI, '+S': '成銀', '+N': '成桂', '+L': '成香' };
const KANJI_NUM = '一二三四五六七八九';
const ZEN_NUM = '１２３４５６７８９';

const GOLD: number[][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
const STEPS: Record<string, number[][]> = {
  K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  G: GOLD, '+P': GOLD, '+L': GOLD, '+N': GOLD, '+S': GOLD,
  S: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]],
  N: [[-2, -1], [-2, 1]],
  P: [[-1, 0]],
  '+B': [[-1, 0], [1, 0], [0, -1], [0, 1]],
  '+R': [[-1, -1], [-1, 1], [1, -1], [1, 1]],
};
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const SLIDES: Record<string, number[][]> = { L: [[-1, 0]], B: DIAG, '+B': DIAG, R: ORTHO, '+R': ORTHO };
const PROMOTABLE = new Set(['P', 'L', 'N', 'S', 'B', 'R']);
const VALUES: Record<string, number> = {
  P: 100, L: 300, N: 350, S: 500, G: 550, B: 800, R: 1000, K: 0,
  '+P': 550, '+L': 550, '+N': 550, '+S': 550, '+B': 1100, '+R': 1300,
};
const HAND_VALUES: Record<string, number> = { P: 110, L: 330, N: 380, S: 550, G: 600, B: 880, R: 1100 };

export const START_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const MAX_PLIES = 400;

export const sideOf = (p: string | null): Side | null => (p === null ? null : p[p.length - 1] === p[p.length - 1].toUpperCase() ? 'b' : 'w');
export const kindOf = (p: string) => p.toUpperCase();
const makePiece = (kind: string, side: Side) => (side === 'b' ? kind : kind.toLowerCase());
const other = (s: Side): Side => (s === 'b' ? 'w' : 'b');
const forward = (s: Side) => (s === 'b' ? 1 : -1);
export const squareName = (i: number) => `${ZEN_NUM[8 - (i % 9)]}${KANJI_NUM[Math.floor(i / 9)]}`;

export function fromSfen(sfen: string = START_SFEN): ShogiState {
  const parts = sfen.split(' ');
  const board: (string | null)[] = [];
  let promo = false;
  for (const ch of parts[0]) {
    if (ch === '/') continue;
    if (ch === '+') {
      promo = true;
      continue;
    }
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(null);
    else {
      board.push((promo ? '+' : '') + ch);
      promo = false;
    }
  }
  const hands: Record<Side, Hand> = { b: {}, w: {} };
  if (parts[2] && parts[2] !== '-') {
    let n = '';
    for (const ch of parts[2]) {
      if (/\d/.test(ch)) {
        n += ch;
        continue;
      }
      const side: Side = ch === ch.toUpperCase() ? 'b' : 'w';
      const k = ch.toUpperCase();
      hands[side][k] = (hands[side][k] ?? 0) + (n ? Number(n) : 1);
      n = '';
    }
  }
  return { board, turn: (parts[1] as Side) || 'b', hands, ply: parts[3] ? Number(parts[3]) - 1 : 0 };
}

export function toSfen(s: ShogiState): string {
  const rows: string[] = [];
  for (let r = 0; r < 9; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = s.board[r * 9 + c];
      if (p === null) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let hand = '';
  for (const side of ['b', 'w'] as Side[]) {
    for (const k of HAND_ORDER) {
      const n = s.hands[side][k] ?? 0;
      if (n) hand += (n > 1 ? n : '') + (side === 'b' ? k : k.toLowerCase());
    }
  }
  return `${rows.join('/')} ${s.turn} ${hand || '-'} ${s.ply + 1}`;
}

const copy = (s: ShogiState): ShogiState => ({ board: s.board.slice(), turn: s.turn, hands: { b: { ...s.hands.b }, w: { ...s.hands.w } }, ply: s.ply });

export function pieceTargets(board: (string | null)[], sq: number): number[] {
  const p = board[sq]!;
  const k = kindOf(p);
  const f = forward(sideOf(p)!);
  const r = Math.floor(sq / 9);
  const c = sq % 9;
  const out: number[] = [];
  for (const [dr, dc] of STEPS[k] ?? []) {
    const rr = r + dr * f;
    const cc = c + dc;
    if (rr >= 0 && rr < 9 && cc >= 0 && cc < 9) out.push(rr * 9 + cc);
  }
  for (const [dr, dc] of SLIDES[k] ?? []) {
    let rr = r + dr * f;
    let cc = c + dc;
    while (rr >= 0 && rr < 9 && cc >= 0 && cc < 9) {
      out.push(rr * 9 + cc);
      if (board[rr * 9 + cc] !== null) break;
      rr += dr * f;
      cc += dc;
    }
  }
  return out;
}

export function isAttacked(board: (string | null)[], sq: number, by: Side): boolean {
  for (let i = 0; i < 81; i++) {
    const p = board[i];
    if (p !== null && sideOf(p) === by && pieceTargets(board, i).includes(sq)) return true;
  }
  return false;
}

export const kingSquare = (board: (string | null)[], side: Side) => board.indexOf(makePiece('K', side));

export function inCheck(s: ShogiState, side: Side = s.turn): boolean {
  const k = kingSquare(s.board, side);
  return k >= 0 && isAttacked(s.board, k, other(side));
}

export const inZone = (row: number, side: Side) => (side === 'b' ? row <= 2 : row >= 6);

export function mustPromote(kind: string, row: number, side: Side): boolean {
  if (kind === 'P' || kind === 'L') return row === (side === 'b' ? 0 : 8);
  if (kind === 'N') return side === 'b' ? row <= 1 : row >= 7;
  return false;
}

export function pseudoMoves(s: ShogiState, includeDrops = true): ShogiMove[] {
  const { board, turn: me } = s;
  const moves: ShogiMove[] = [];
  for (let sq = 0; sq < 81; sq++) {
    const p = board[sq];
    if (p === null || sideOf(p) !== me) continue;
    const k = kindOf(p);
    const fr = Math.floor(sq / 9);
    for (const t of pieceTargets(board, sq)) {
      const q = board[t];
      if (q !== null && sideOf(q) === me) continue;
      const tr = Math.floor(t / 9);
      if (PROMOTABLE.has(k) && (inZone(fr, me) || inZone(tr, me))) {
        moves.push([sq, t, true, null]);
        if (!mustPromote(k, tr, me)) moves.push([sq, t, false, null]);
      } else moves.push([sq, t, false, null]);
    }
  }
  if (includeDrops) {
    const hand = s.hands[me];
    const pawnFiles = new Set<number>();
    if (hand.P) {
      const own = makePiece('P', me);
      for (let i = 0; i < 81; i++) if (board[i] === own) pawnFiles.add(i % 9);
    }
    for (const [k, n] of Object.entries(hand)) {
      if (n <= 0) continue;
      for (let t = 0; t < 81; t++) {
        if (board[t] !== null) continue;
        if (mustPromote(k, Math.floor(t / 9), me)) continue;
        if (k === 'P' && pawnFiles.has(t % 9)) continue;
        moves.push([-1, t, false, k]);
      }
    }
  }
  return moves;
}

export function applyMove(state: ShogiState, move: ShogiMove): ShogiState {
  const [f, t, promote, drop] = move;
  const s = copy(state);
  const me = state.turn;
  if (drop) {
    s.board[t] = makePiece(drop, me);
    s.hands[me][drop] -= 1;
    if (s.hands[me][drop] <= 0) delete s.hands[me][drop];
  } else {
    const p = s.board[f]!;
    const cap = s.board[t];
    if (cap !== null) {
      const base = kindOf(cap).replace('+', '');
      s.hands[me][base] = (s.hands[me][base] ?? 0) + 1;
    }
    s.board[t] = promote ? makePiece('+' + kindOf(p), me) : p;
    s.board[f] = null;
  }
  s.turn = other(me);
  s.ply += 1;
  return s;
}

function hasLegal(s: ShogiState) {
  return pseudoMoves(s).some((m) => !inCheck(applyMove(s, m), s.turn));
}

export function legalMoves(s: ShogiState): ShogiMove[] {
  const out: ShogiMove[] = [];
  for (const m of pseudoMoves(s)) {
    const next = applyMove(s, m);
    if (inCheck(next, s.turn)) continue;
    if (m[3] === 'P' && inCheck(next) && !hasLegal(next)) continue; // 打ち歩詰め
    out.push(m);
  }
  return out;
}

export function gameResult(s: ShogiState, legal = legalMoves(s)): { winner: Side | null; reason: string } | null {
  if (!legal.length) return { winner: other(s.turn), reason: 'checkmate' };
  if (s.ply >= MAX_PLIES) return { winner: null, reason: 'max_moves' };
  return null;
}

export function moveToText(s: ShogiState, move: ShogiMove): string {
  const [f, t, promote, drop] = move;
  const mark = s.turn === 'b' ? '☗' : '☖';
  if (drop) return `${mark}${squareName(t)}${KANJI[drop]}打`;
  const k = kindOf(s.board[f]!);
  let text = `${mark}${squareName(t)}${KANJI_LONG[k]}`;
  if (promote) text += '成';
  else if (PROMOTABLE.has(k) && (inZone(Math.floor(f / 9), s.turn) || inZone(Math.floor(t / 9), s.turn))) text += '不成';
  return text;
}

export function moveToUsi([f, t, promote, drop]: ShogiMove): string {
  const sq = (i: number) => `${9 - (i % 9)}${'abcdefghi'[Math.floor(i / 9)]}`;
  if (drop) return `${drop}*${sq(t)}`;
  return sq(f) + sq(t) + (promote ? '+' : '');
}

// ---------------- AI ----------------

const MATE = 1000000;

function evaluate(s: ShogiState) {
  let score = 0;
  for (let sq = 0; sq < 81; sq++) {
    const p = s.board[sq];
    if (p === null) continue;
    const k = kindOf(p);
    let v = VALUES[k];
    const sente = sideOf(p) === 'b';
    if (k === 'P' || k === 'S' || k === 'G') {
      const r = Math.floor(sq / 9);
      v += (sente ? 8 - r : r) * 3;
    }
    score += sente ? v : -v;
  }
  for (const [side, sign] of [['b', 1], ['w', -1]] as [Side, number][]) {
    for (const [k, n] of Object.entries(s.hands[side])) score += sign * HAND_VALUES[k] * n;
    const ksq = kingSquare(s.board, side);
    if (ksq < 0) continue;
    const r = Math.floor(ksq / 9);
    const c = ksq % 9;
    let guard = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < 9 && cc >= 0 && cc < 9) {
          const q = s.board[rr * 9 + cc];
          if (q !== null && sideOf(q) === side) guard++;
        }
      }
    }
    score += sign * guard * 15;
  }
  return score;
}

function order(s: ShogiState, moves: ShogiMove[]) {
  const key = (m: ShogiMove) => {
    let v = 0;
    const cap = s.board[m[1]];
    if (cap !== null && !m[3]) v += 10 * VALUES[kindOf(cap)] + 50;
    if (m[2]) v += 300;
    if (m[3]) v -= 20;
    return v;
  };
  return moves.map((m) => [key(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function search(s: ShogiState, depth: number, alpha: number, beta: number): number {
  const sign = s.turn === 'b' ? 1 : -1;
  if (depth === 0) return sign * evaluate(s);
  const moves = pseudoMoves(s, depth > 1);
  const oppKing = makePiece('K', other(s.turn));
  if (moves.some((m) => !m[3] && s.board[m[1]] === oppKing)) return MATE;
  let best = -MATE * 2;
  let anyLegal = false;
  for (const m of order(s, moves)) {
    const next = applyMove(s, m);
    if (inCheck(next, s.turn)) continue;
    anyLegal = true;
    const score = -search(next, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (!anyLegal) return -MATE + (10 - depth);
  return best;
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export function aiMove(s: ShogiState, level: number): ShogiMove | null {
  const legal = legalMoves(s);
  if (!legal.length) return null;
  if (level <= 1) return legal[Math.floor(Math.random() * legal.length)];
  const [depth, noise] = ({ 2: [1, 60], 3: [1, 15], 4: [2, 5], 5: [3, 0] } as Record<number, [number, number]>)[level] ?? [3, 0];
  let bestScore = -MATE * 3;
  let best: ShogiMove[] = [];
  let alpha = -MATE * 3;
  for (const m of order(s, legal)) {
    const score = -search(applyMove(s, m), depth - 1, -MATE * 3, -alpha + noise) + (noise ? randInt(-noise, noise) : 0);
    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) best.push(m);
    if (bestScore > alpha) alpha = bestScore;
  }
  return best[Math.floor(Math.random() * best.length)];
}
