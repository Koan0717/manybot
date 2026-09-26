/**
 * チェスのルールとAI（Bot の chess_engine.py と同じ動き）。
 * 盤面: 64マス。index = row * 8 + col（row 0 = 8段目 = 黒側、row 7 = 1段目 = 白側）
 * 駒: 白は大文字 "PNBRQK"、黒は小文字、空きは "."
 */

export type Color = 'w' | 'b';
export interface ChessState {
  board: string[];
  turn: Color;
  castling: string;
  ep: number;
  halfmove: number;
  fullmove: number;
}
/** [from, to, promo] promo は 'q' | 'r' | 'b' | 'n' | null */
export type ChessMove = [number, number, string | null];

const FILES = 'abcdefgh';
const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const isUpper = (p: string) => p !== '.' && p === p.toUpperCase();
export const colorOf = (p: string): Color | null => (p === '.' ? null : isUpper(p) ? 'w' : 'b');
export const sqName = (i: number) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function fromFen(fen: string = START_FEN): ChessState {
  const parts = fen.split(' ');
  const board: string[] = [];
  for (const ch of parts[0]) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('.');
    else board.push(ch);
  }
  let ep = -1;
  if (parts[3] && parts[3] !== '-') ep = (8 - Number(parts[3][1])) * 8 + FILES.indexOf(parts[3][0]);
  return {
    board,
    turn: (parts[1] as Color) || 'w',
    castling: !parts[2] || parts[2] === '-' ? '' : parts[2],
    ep,
    halfmove: Number(parts[4] ?? 0),
    fullmove: Number(parts[5] ?? 1),
  };
}

export function toFen(s: ChessState): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = s.board[r * 8 + c];
      if (p === '.') empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${s.turn} ${s.castling || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.halfmove} ${s.fullmove}`;
}

const copy = (s: ChessState): ChessState => ({ ...s, board: s.board.slice() });
const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

export function isAttacked(board: string[], sq: number, by: Color): boolean {
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  const pr = by === 'w' ? r + 1 : r - 1;
  const pawn = by === 'w' ? 'P' : 'p';
  for (const dc of [-1, 1]) if (inside(pr, c + dc) && board[pr * 8 + c + dc] === pawn) return true;
  const [knight, king] = by === 'w' ? ['N', 'K'] : ['n', 'k'];
  for (const [dr, dc] of KNIGHT_STEPS) if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === knight) return true;
  for (const [dr, dc] of KING_STEPS) if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === king) return true;
  const [rook, queen, bishop] = by === 'w' ? ['R', 'Q', 'B'] : ['r', 'q', 'b'];
  for (const [dirs, sliders] of [[ROOK_DIRS, [rook, queen]], [BISHOP_DIRS, [bishop, queen]]] as [number[][], string[]][]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr;
      let cc = c + dc;
      while (inside(rr, cc)) {
        const p = board[rr * 8 + cc];
        if (p !== '.') {
          if (sliders.includes(p)) return true;
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  }
  return false;
}

export function kingSquare(board: string[], color: Color) {
  return board.indexOf(color === 'w' ? 'K' : 'k');
}

export function inCheck(s: ChessState, color: Color = s.turn): boolean {
  const k = kingSquare(s.board, color);
  return k >= 0 && isAttacked(s.board, k, other(color));
}

function addPawn(moves: ChessMove[], f: number, t: number, promote: boolean) {
  if (promote) for (const p of ['q', 'r', 'b', 'n']) moves.push([f, t, p]);
  else moves.push([f, t, null]);
}

export function pseudoMoves(s: ChessState): ChessMove[] {
  const { board, turn: me } = s;
  const opp = other(me);
  const moves: ChessMove[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p === '.' || colorOf(p) !== me) continue;
    const r = Math.floor(sq / 8);
    const c = sq % 8;
    const kind = p.toLowerCase();
    if (kind === 'p') {
      const d = me === 'w' ? -1 : 1;
      const startRow = me === 'w' ? 6 : 1;
      const lastRow = me === 'w' ? 0 : 7;
      const rr = r + d;
      if (rr >= 0 && rr < 8) {
        if (board[rr * 8 + c] === '.') {
          addPawn(moves, sq, rr * 8 + c, rr === lastRow);
          if (r === startRow && board[(r + 2 * d) * 8 + c] === '.') moves.push([sq, (r + 2 * d) * 8 + c, null]);
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (cc < 0 || cc > 7) continue;
          const t = rr * 8 + cc;
          if ((board[t] !== '.' && colorOf(board[t]) === opp) || t === s.ep) addPawn(moves, sq, t, rr === lastRow);
        }
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const [dr, dc] of kind === 'n' ? KNIGHT_STEPS : KING_STEPS) {
        if (!inside(r + dr, c + dc)) continue;
        const t = (r + dr) * 8 + c + dc;
        if (board[t] === '.' || colorOf(board[t]) === opp) moves.push([sq, t, null]);
      }
      if (kind === 'k') addCastles(s, moves, sq);
    } else {
      const dirs = kind === 'r' ? ROOK_DIRS : kind === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          const t = rr * 8 + cc;
          if (board[t] === '.') moves.push([sq, t, null]);
          else {
            if (colorOf(board[t]) === opp) moves.push([sq, t, null]);
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return moves;
}

function addCastles(s: ChessState, moves: ChessMove[], ksq: number) {
  const { board, turn: me } = s;
  const opp = other(me);
  const home = me === 'w' ? 60 : 4;
  if (ksq !== home) return;
  const [kSide, qSide] = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
  const rook = me === 'w' ? 'R' : 'r';
  if (s.castling.includes(kSide) && board[home + 1] === '.' && board[home + 2] === '.' && board[home + 3] === rook) {
    if (!isAttacked(board, home, opp) && !isAttacked(board, home + 1, opp) && !isAttacked(board, home + 2, opp)) moves.push([home, home + 2, null]);
  }
  if (s.castling.includes(qSide) && board[home - 1] === '.' && board[home - 2] === '.' && board[home - 3] === '.' && board[home - 4] === rook) {
    if (!isAttacked(board, home, opp) && !isAttacked(board, home - 1, opp) && !isAttacked(board, home - 2, opp)) moves.push([home, home - 2, null]);
  }
}

export function applyMove(state: ChessState, move: ChessMove): ChessState {
  const [f, t, promo] = move;
  const s = copy(state);
  const b = s.board;
  const p = b[f];
  const kind = p.toLowerCase();
  let captured = b[t];
  const me = state.turn;
  if (kind === 'p' && t === state.ep && captured === '.') {
    b[t + (me === 'w' ? 8 : -8)] = '.';
    captured = 'p';
  }
  b[t] = promo ? (me === 'w' ? promo.toUpperCase() : promo) : p;
  b[f] = '.';
  if (kind === 'k' && Math.abs(t - f) === 2) {
    if (t > f) {
      b[t - 1] = b[t + 1];
      b[t + 1] = '.';
    } else {
      b[t + 1] = b[t - 2];
      b[t - 2] = '.';
    }
  }
  let rights = s.castling;
  if (kind === 'k') rights = me === 'w' ? rights.replace('K', '').replace('Q', '') : rights.replace('k', '').replace('q', '');
  for (const [sq, flag] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']] as [number, string][]) {
    if (f === sq || t === sq) rights = rights.replace(flag, '');
  }
  s.castling = rights;
  s.ep = kind === 'p' && Math.abs(t - f) === 16 ? (f + t) / 2 : -1;
  s.halfmove = kind === 'p' || captured !== '.' ? 0 : state.halfmove + 1;
  if (me === 'b') s.fullmove += 1;
  s.turn = other(me);
  return s;
}

export function legalMoves(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => !inCheck(applyMove(s, m), s.turn));
}

function insufficientMaterial(board: string[]) {
  const pieces = board.filter((p) => p !== '.' && p.toLowerCase() !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && ['n', 'b'].includes(pieces[0].toLowerCase()));
}

/** 終わっていれば { winner: 'w' | 'b' | null(引き分け), reason } */
export function gameResult(s: ChessState, legal = legalMoves(s)): { winner: Color | null; reason: string } | null {
  if (!legal.length) return inCheck(s) ? { winner: other(s.turn), reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  if (s.halfmove >= 100) return { winner: null, reason: 'fifty' };
  if (insufficientMaterial(s.board)) return { winner: null, reason: 'material' };
  return null;
}

export function moveToSan(s: ChessState, move: ChessMove, legal = legalMoves(s)): string {
  const [f, t, promo] = move;
  const p = s.board[f];
  const kind = p.toLowerCase();
  let san: string;
  if (kind === 'k' && Math.abs(t - f) === 2) san = t > f ? 'O-O' : 'O-O-O';
  else {
    const capture = s.board[t] !== '.' || (kind === 'p' && t === s.ep);
    if (kind === 'p') {
      san = (capture ? FILES[f % 8] + 'x' : '') + sqName(t) + (promo ? '=' + promo.toUpperCase() : '');
    } else {
      const others = legal.filter((m) => m[1] === t && m[0] !== f && s.board[m[0]] === p);
      let dis = '';
      if (others.length) {
        if (others.every((m) => m[0] % 8 !== f % 8)) dis = FILES[f % 8];
        else if (others.every((m) => Math.floor(m[0] / 8) !== Math.floor(f / 8))) dis = String(8 - Math.floor(f / 8));
        else dis = sqName(f);
      }
      san = kind.toUpperCase() + dis + (capture ? 'x' : '') + sqName(t);
    }
  }
  const next = applyMove(s, move);
  if (inCheck(next)) san += legalMoves(next).length ? '+' : '#';
  return san;
}

export const moveToUci = ([f, t, p]: ChessMove) => sqName(f) + sqName(t) + (p ?? '');

// ---------------- AI ----------------

const PST: Record<string, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const MATE = 1000000;

function evaluate(board: string[], usePst: boolean) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p === '.') continue;
    const kind = p.toLowerCase();
    let v = VALUES[kind];
    if (usePst) v += PST[kind][isUpper(p) ? sq : (7 - Math.floor(sq / 8)) * 8 + (sq % 8)];
    score += isUpper(p) ? v : -v;
  }
  return score;
}

function order(s: ChessState, moves: ChessMove[]) {
  const key = (m: ChessMove) => {
    let v = 0;
    const cap = s.board[m[1]];
    if (cap !== '.') v += 10 * VALUES[cap.toLowerCase()] - Math.floor(VALUES[s.board[m[0]].toLowerCase()] / 10);
    if (m[2]) v += VALUES[m[2]];
    return v;
  };
  return moves.map((m) => [key(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function search(s: ChessState, depth: number, alpha: number, beta: number, usePst: boolean): number {
  const sign = s.turn === 'w' ? 1 : -1;
  if (depth === 0) return sign * evaluate(s.board, usePst);
  const moves = pseudoMoves(s);
  const oppKing = s.turn === 'w' ? 'k' : 'K';
  if (moves.some((m) => s.board[m[1]] === oppKing)) return MATE;
  let best = -MATE * 2;
  let anyLegal = false;
  for (const m of order(s, moves)) {
    const next = applyMove(s, m);
    if (inCheck(next, s.turn)) continue;
    anyLegal = true;
    const score = -search(next, depth - 1, -beta, -alpha, usePst);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (!anyLegal) return inCheck(s) ? -MATE + (10 - depth) : 0;
  return best;
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export function aiMove(s: ChessState, level: number): ChessMove | null {
  const legal = legalMoves(s);
  if (!legal.length) return null;
  if (level <= 1) return legal[Math.floor(Math.random() * legal.length)];
  const [depth, usePst, noise] = ({ 2: [1, false, 30], 3: [2, true, 10], 4: [3, true, 0], 5: [4, true, 0] } as Record<number, [number, boolean, number]>)[level] ?? [4, true, 0];
  let bestScore = -MATE * 3;
  let best: ChessMove[] = [];
  let alpha = -MATE * 3;
  for (const m of order(s, legal)) {
    const score = -search(applyMove(s, m), depth - 1, -MATE * 3, -alpha + noise, usePst) + (noise ? randInt(-noise, noise) : 0);
    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) best.push(m);
    if (bestScore > alpha) alpha = bestScore;
  }
  return best[Math.floor(Math.random() * best.length)];
}
