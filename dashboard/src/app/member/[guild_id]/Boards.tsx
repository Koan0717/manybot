'use client';

import { useMemo, useState } from 'react';
import * as C from '@/lib/boardgames/chess';
import * as S from '@/lib/boardgames/shogi';

/**
 * オセロ・チェス・将棋の盤面。指せる手（legal）はサーバーから受け取り、クリックで選んだ手を onMove で渡す。
 * 盤面は自分が下になるように表示する（チェスの黒・将棋の後手は反転）。
 */

interface BoardProps {
  state: any;
  you: 0 | 1 | 2;
  legal: string[];
  lastMove: any;
  disabled: boolean;
  onMove: (wire: string) => void;
}

// ---------------- オセロ ----------------

export function OthelloBoardView({ state, legal, lastMove, disabled, onMove }: BoardProps) {
  const board: number[][] = state.board;
  const legalSet = new Set(legal);
  const flipped = new Set<string>((lastMove?.flipped ?? []).map((p: number[]) => `${p[0]},${p[1]}`));
  const placed = lastMove?.at ? `${lastMove.at[0]},${lastMove.at[1]}` : '';
  return (
    <div className="w-full max-w-[420px] mx-auto">
      <style>{`
        @keyframes oth-flip { 0% { transform: rotateY(90deg) scale(1.1); } 100% { transform: rotateY(0deg) scale(1); } }
        @keyframes oth-drop { 0% { transform: scale(1.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
      <div className="grid grid-cols-8 gap-[2px] p-[3px] rounded-xl bg-emerald-950 border-4 border-emerald-900 shadow-2xl" style={{ perspective: 600 }}>
        {board.map((row, r) =>
          row.map((v, c) => {
            const key = `${r},${c}`;
            const can = !disabled && legalSet.has(key);
            return (
              <button
                key={key}
                onClick={() => can && onMove(key)}
                disabled={!can}
                className={`aspect-square bg-emerald-600 relative flex items-center justify-center ${can ? 'cursor-pointer hover:bg-emerald-500' : 'cursor-default'}`}
              >
                {v !== 0 && (
                  <span
                    key={`${key}-${v}`}
                    className={`w-[80%] h-[80%] rounded-full shadow-[0_3px_4px_rgba(0,0,0,0.5)] ${
                      v === 1 ? 'bg-gradient-to-br from-zinc-600 to-zinc-950' : 'bg-gradient-to-br from-white to-zinc-300'
                    } ${placed === key ? 'ring-2 ring-amber-400' : ''}`}
                    style={{ animation: placed === key ? 'oth-drop 0.3s ease-out' : flipped.has(key) ? 'oth-flip 0.45s ease-out' : undefined }}
                  />
                )}
                {v === 0 && can && <span className="w-[26%] h-[26%] rounded-full bg-black/25" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------- チェス ----------------

const CHESS_GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const idxOf = (name: string) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);

export function ChessBoardView({ state, you, legal, lastMove, disabled, onMove }: BoardProps) {
  const st = useMemo(() => C.fromFen(state.fen), [state.fen]);
  const [sel, setSel] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const flip = you === 2;
  const moves = useMemo(() => legal.map((u) => ({ u, from: idxOf(u.slice(0, 2)), to: idxOf(u.slice(2, 4)), promo: u[4] ?? null })), [legal]);
  const targets = new Set(sel === null ? [] : moves.filter((m) => m.from === sel).map((m) => m.to));
  const movable = new Set(moves.map((m) => m.from));
  const checkSq = C.inCheck(st) ? C.kingSquare(st.board, st.turn) : -1;

  const click = (sq: number) => {
    if (disabled) return;
    if (sel !== null && targets.has(sq)) {
      const cands = moves.filter((m) => m.from === sel && m.to === sq);
      if (cands.length > 1) setPromo({ from: sel, to: sq });
      else onMove(cands[0].u);
      setSel(null);
      return;
    }
    setSel(movable.has(sq) && sel !== sq ? sq : null);
  };

  const order = Array.from({ length: 64 }, (_, i) => (flip ? 63 - i : i));
  return (
    <div className="w-full max-w-[440px] mx-auto relative">
      <div className="grid grid-cols-8 rounded-lg overflow-hidden border-4 border-[#5b3a1e] shadow-2xl">
        {order.map((sq) => {
          const r = Math.floor(sq / 8);
          const c = sq % 8;
          const light = (r + c) % 2 === 0;
          const p = st.board[sq];
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const bg = sel === sq ? '#7fc97f' : isLast ? (light ? '#f6f682' : '#dac34a') : light ? '#f0d9b5' : '#b58863';
          return (
            <button key={sq} onClick={() => click(sq)} className="aspect-square relative flex items-center justify-center" style={{ background: bg }}>
              {sq === checkSq && <span className="absolute inset-[8%] rounded-full bg-red-500/70" />}
              {p !== '.' && (
                <span
                  className="relative leading-none select-none text-[min(9vw,44px)]"
                  style={{
                    color: p === p.toUpperCase() ? '#fafafa' : '#1a1a1a',
                    WebkitTextStroke: p === p.toUpperCase() ? '1.2px #1a1a1a' : '0.6px #e5e5e5',
                    textShadow: '0 2px 2px rgba(0,0,0,0.35)',
                  }}
                >
                  {CHESS_GLYPH[p.toLowerCase()]}
                </span>
              )}
              {targets.has(sq) && (
                <span className={`absolute rounded-full ${p !== '.' ? 'inset-[6%] border-4 border-black/30' : 'w-[28%] h-[28%] bg-black/25'}`} />
              )}
              {(flip ? r === 0 : r === 7) && <span className="absolute bottom-0 right-1 text-[9px] font-bold opacity-60 text-black">{'abcdefgh'[c]}</span>}
              {(flip ? c === 7 : c === 0) && <span className="absolute top-0 left-1 text-[9px] font-bold opacity-60 text-black">{8 - r}</span>}
            </button>
          );
        })}
      </div>
      {promo && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-2 text-center">
            <div className="text-sm font-bold">何に昇格しますか？</div>
            <div className="flex gap-2">
              {['q', 'r', 'b', 'n'].map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    const m = moves.find((x) => x.from === promo.from && x.to === promo.to && x.promo === k);
                    setPromo(null);
                    if (m) onMove(m.u);
                  }}
                  className="w-14 h-14 rounded-lg bg-zinc-100 text-4xl text-zinc-900 hover:bg-amber-200"
                >
                  {CHESS_GLYPH[k]}
                </button>
              ))}
            </div>
            <button onClick={() => setPromo(null)} className="text-xs text-zinc-400">やめる</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 将棋 ----------------

const usiSq = (s: string) => 'abcdefghi'.indexOf(s[1]) * 9 + (9 - Number(s[0]));

function ShogiPiece({ piece, rotate, small }: { piece: string; rotate: boolean; small?: boolean }) {
  const k = S.kindOf(piece);
  const label = S.KANJI[k];
  return (
    <span
      className={`relative flex items-center justify-center font-bold select-none ${small ? 'w-7 h-8 text-sm' : 'w-[88%] h-[92%] text-[min(4.6vw,22px)]'}`}
      style={{ transform: rotate ? 'rotate(180deg)' : undefined }}
    >
      <svg viewBox="0 0 40 44" className="absolute inset-0 w-full h-full drop-shadow">
        <polygon points="20,2 34,8 38,42 2,42 6,8" fill="#f5dca8" stroke="#8a5a26" strokeWidth="1.5" />
      </svg>
      <span className={`relative ${k.startsWith('+') ? 'text-red-600' : 'text-zinc-900'}`} style={{ marginTop: small ? 2 : '8%' }}>
        {label}
      </span>
    </span>
  );
}

export function ShogiBoardView({ state, you, legal, lastMove, disabled, onMove }: BoardProps) {
  const st = useMemo(() => S.fromSfen(state.sfen), [state.sfen]);
  const [sel, setSel] = useState<{ from: number; drop: string | null } | null>(null);
  const [promo, setPromo] = useState<{ wires: string[] } | null>(null);
  const flip = you === 2;
  const mySide: S.Side = you === 2 ? 'w' : 'b';
  const oppSide: S.Side = mySide === 'b' ? 'w' : 'b';
  const moves = useMemo(
    () =>
      legal.map((u) =>
        u.includes('*') ? { u, from: -1, drop: u[0], to: usiSq(u.slice(2, 4)), promote: false } : { u, from: usiSq(u.slice(0, 2)), drop: null as string | null, to: usiSq(u.slice(2, 4)), promote: u.endsWith('+') }
      ),
    [legal]
  );
  const selMoves = sel ? moves.filter((m) => (sel.drop ? m.drop === sel.drop : m.from === sel.from && !m.drop)) : [];
  const targets = new Set(selMoves.map((m) => m.to));
  const movable = new Set(moves.filter((m) => !m.drop).map((m) => m.from));
  const droppable = new Set(moves.filter((m) => m.drop).map((m) => m.drop!));
  const checkSq = S.inCheck(st) ? S.kingSquare(st.board, st.turn) : -1;

  const clickSquare = (sq: number) => {
    if (disabled) return;
    if (sel && targets.has(sq)) {
      const cands = selMoves.filter((m) => m.to === sq);
      if (cands.length > 1) setPromo({ wires: cands.map((m) => m.u) });
      else onMove(cands[0].u);
      setSel(null);
      return;
    }
    setSel(movable.has(sq) && !(sel && !sel.drop && sel.from === sq) ? { from: sq, drop: null } : null);
  };

  const Hand = ({ side }: { side: S.Side }) => {
    const hand = st.hands[side];
    const mine = side === mySide;
    const items = S.HAND_ORDER.filter((k) => hand[k]);
    return (
      <div className={`flex items-center gap-1 min-h-[40px] px-2 py-1 rounded-lg bg-[#3b2a18] ${mine ? '' : 'flex-row-reverse'}`}>
        <span className="text-[10px] text-amber-100/70 flex-shrink-0">{side === 'b' ? '☗先手' : '☖後手'}の持ち駒</span>
        <div className={`flex flex-wrap gap-1 flex-1 ${mine ? '' : 'justify-end'}`}>
          {items.length === 0 && <span className="text-[10px] text-amber-100/40">なし</span>}
          {items.map((k) => {
            const can = mine && !disabled && droppable.has(k);
            const active = sel?.drop === k;
            return (
              <button
                key={k}
                disabled={!can}
                onClick={() => setSel(active ? null : { from: -1, drop: k })}
                className={`relative flex items-center rounded ${active ? 'ring-2 ring-emerald-400 bg-emerald-400/30' : can ? 'hover:bg-white/10' : ''}`}
              >
                <ShogiPiece piece={side === 'b' ? k : k.toLowerCase()} rotate={!mine} small />
                {hand[k] > 1 && <span className="text-[10px] text-amber-100 font-bold ml-0.5">×{hand[k]}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const order = Array.from({ length: 81 }, (_, i) => (flip ? 80 - i : i));
  return (
    <div className="w-full max-w-[460px] mx-auto space-y-1.5 relative">
      <Hand side={oppSide} />
      <div className="grid grid-cols-9 border-[3px] border-[#6b4423] bg-[#deb26c] shadow-2xl rounded-sm">
        {order.map((sq) => {
          const p = st.board[sq];
          const isLast = lastMove && (lastMove.to === sq || lastMove.from === sq);
          const selected = sel && !sel.drop && sel.from === sq;
          return (
            <button
              key={sq}
              onClick={() => clickSquare(sq)}
              className="aspect-[10/11] relative flex items-center justify-center border-[0.5px] border-[#6b4423]/70"
              style={{ background: selected ? '#9fd99f' : sq === checkSq ? '#f08a8a' : isLast ? (lastMove.to === sq ? '#f5d65a' : '#ecc98a') : undefined }}
            >
              {p && <ShogiPiece piece={p} rotate={(S.sideOf(p) === 'w') !== flip} />}
              {targets.has(sq) && <span className={`absolute rounded-full ${p ? 'inset-[4%] border-4 border-emerald-700/50' : 'w-[26%] h-[26%] bg-emerald-800/40'}`} />}
            </button>
          );
        })}
      </div>
      <Hand side={mySide} />
      {promo && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3 text-center">
            <div className="text-sm font-bold">成りますか？</div>
            <div className="flex gap-2">
              {promo.wires
                .slice()
                .sort((a) => (a.endsWith('+') ? -1 : 1))
                .map((w) => (
                  <button
                    key={w}
                    onClick={() => {
                      setPromo(null);
                      onMove(w);
                    }}
                    className={`px-5 py-2.5 rounded-lg font-bold ${w.endsWith('+') ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                  >
                    {w.endsWith('+') ? '成る' : '成らない'}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
