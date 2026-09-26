'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * High & Low のテーブル。カードの中身・当たり外れはサーバーで決まったものを受け取り、
 * 山札からめくる → 表に返す → 当たりなら左に移って次へ、という見せ方だけをする。
 */

export interface HlCard { value: number; suit: string }
export interface HlView {
  id: string | null;
  bet: number;
  card: HlCard;
  history: HlCard[];
  streak: number;
  max_streak: number;
  mul: number;
  muls?: number[];
  revealed: boolean;
  amount: number;
  next_amount: number | null;
  finished: boolean;
}
export interface HlResponse extends HlView {
  resumed: boolean;
  last: { guess: 'high' | 'low'; outcome: 'win' | 'draw' | 'lose'; from: HlCard } | null;
  result?: { reason: string; payout: number; tax: number; isWin: boolean; isDraw: boolean } | null;
  balance: number;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const fmt = (n: number) => n.toLocaleString('ja-JP');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRed = (suit: string) => suit.startsWith('♥') || suit.startsWith('♦');
const plainSuit = (suit: string) => suit.replace('️', '');

function Face({ card, big = true }: { card: HlCard; big?: boolean }) {
  const color = isRed(card.suit) ? 'text-red-600' : 'text-zinc-900';
  const rank = RANKS[card.value - 1];
  const suit = plainSuit(card.suit);
  return (
    <div className={`absolute inset-0 rounded-xl bg-gradient-to-br from-white to-zinc-200 border border-zinc-300 shadow-[0_8px_20px_rgba(0,0,0,0.45)] ${color}`} style={{ backfaceVisibility: 'hidden' }}>
      <div className={`absolute left-2 top-1.5 leading-none font-black ${big ? 'text-xl' : 'text-[10px]'}`}>
        {rank}
        <div className={big ? 'text-base' : 'text-[9px]'}>{suit}</div>
      </div>
      <div className={`absolute inset-0 flex items-center justify-center font-black ${big ? 'text-5xl' : 'text-lg'}`}>{big && ['J', 'Q', 'K'].includes(rank) ? rank : suit}</div>
      <div className={`absolute right-2 bottom-1.5 leading-none font-black rotate-180 ${big ? 'text-xl' : 'text-[10px]'}`}>
        {rank}
        <div className={big ? 'text-base' : 'text-[9px]'}>{suit}</div>
      </div>
    </div>
  );
}

function Back({ flipped = false }: { flipped?: boolean }) {
  return (
    <div
      className="absolute inset-0 rounded-xl border-2 border-white/80 shadow-[0_8px_20px_rgba(0,0,0,0.45)] overflow-hidden"
      style={{
        backfaceVisibility: 'hidden',
        transform: flipped ? 'rotateY(180deg)' : undefined,
        background: 'repeating-linear-gradient(45deg, #b91c1c 0 6px, #991b1b 6px 12px)',
      }}
    >
      <div className="absolute inset-2 rounded-lg border border-white/40 flex items-center justify-center text-white/80 text-2xl">🂠</div>
    </div>
  );
}

type Phase = 'idle' | 'waiting' | 'flip' | 'result' | 'slide';

export default function HighLow({
  session,
  cur,
  mul,
  muls,
  maxStreak,
  canStart,
  busy,
  onStart,
  onAction,
  onFinished,
}: {
  session: HlView | null;
  cur: string;
  mul: number;
  muls: number[];
  maxStreak: number;
  canStart: boolean;
  busy: boolean;
  onStart: () => Promise<void>;
  onAction: (action: 'guess' | 'cashout', guess?: 'high' | 'low') => Promise<HlResponse | null>;
  onFinished: (data: HlResponse) => void;
}) {
  // 画面に出している状態（アニメーションが終わるまでは前の状態のまま）
  const [shown, setShown] = useState<HlView | null>(session);
  const [phase, setPhase] = useState<Phase>('idle');
  const [next, setNext] = useState<HlCard | null>(null);
  const [guess, setGuess] = useState<'high' | 'low' | null>(null);
  const [outcome, setOutcome] = useState<'win' | 'draw' | 'lose' | null>(null);
  const [pop, setPop] = useState<number>(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // 新しく配られた・続きから始めたとき（めくった結果はアニメーションの最後に自分で反映する）
  useEffect(() => {
    setShown(session);
  }, [session]);

  const view = shown;
  // 連勝ごとの受け取り倍率（管理者が連勝ごとに決めた倍率。ゲーム中はそのゲームの値）
  const table = view?.muls?.length ? view.muls : muls.length ? muls : Array.from({ length: maxStreak }, (_, i) => Math.pow(mul, i + 1));
  const stepMul = (streak: number) => (streak <= 0 ? 1 : table[streak - 1] ?? Math.pow(mul, streak));
  const inGame = !!view && !view.finished;
  const animating = phase !== 'idle';

  const doGuess = async (g: 'high' | 'low') => {
    if (!view || animating || busy) return;
    setGuess(g);
    setOutcome(null);
    setPhase('waiting');
    const [data] = await Promise.all([onAction('guess', g), sleep(450)]);
    if (!alive.current) return;
    if (!data || !data.last) {
      setPhase('idle');
      setGuess(null);
      return;
    }
    setNext(data.card);
    setPhase('flip'); // 右のカードを表に返す
    await sleep(650);
    if (!alive.current) return;
    setOutcome(data.last.outcome);
    setPhase('result');
    if (data.last.outcome === 'win') setPop((p) => p + 1);
    await sleep(data.finished ? 1100 : 850);
    if (!alive.current) return;
    if (data.last.outcome !== 'lose') {
      setPhase('slide'); // 当たり・引き分けは、めくったカードが「今のカード」になる
      await sleep(420);
      if (!alive.current) return;
    }
    setShown(data);
    setNext(null);
    setPhase('idle');
    setGuess(null);
    if (data.last.outcome === 'lose') setOutcome('lose');
    else setOutcome(null);
    if (data.finished) onFinished(data);
  };

  const doCashout = async () => {
    if (!view || animating || busy) return;
    setPhase('waiting');
    const data = await onAction('cashout');
    if (!alive.current) return;
    setPhase('idle');
    if (data) {
      setShown(data);
      onFinished(data);
    }
  };

  // 今のカードより大きい・小さいカードが何種類あるか（考えるときのヒント）
  const counts = useMemo(() => (view ? { high: 13 - view.card.value, low: view.card.value - 1 } : null), [view]);

  const cardBox = 'relative w-[92px] h-[132px] sm:w-[104px] sm:h-[148px]';
  const result = outcome ?? (view?.finished ? (view as HlResponse).last?.outcome ?? null : null);

  return (
    <div className="space-y-3">
      <style>{`
        @keyframes hl-pop { 0% { transform: translate(-50%, 0) scale(0.6); opacity: 0; } 30% { opacity: 1; transform: translate(-50%, -8px) scale(1.1); } 100% { transform: translate(-50%, -40px) scale(1); opacity: 0; } }
        @keyframes hl-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px) rotate(-2deg); } 40% { transform: translateX(6px) rotate(2deg); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
        @keyframes hl-banner { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes hl-glow { 0%,100% { box-shadow: 0 0 0 rgba(251,191,36,0); } 50% { box-shadow: 0 0 28px rgba(251,191,36,0.8); } }
      `}</style>

      {/* テーブル */}
      <div
        className="relative rounded-2xl p-4 overflow-hidden border border-emerald-900/70"
        style={{ background: 'radial-gradient(ellipse at 50% 30%, #166534 0%, #14532d 55%, #052e16 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.5)' }}
      >
        {/* 連勝メーター */}
        <div className="flex items-center justify-center gap-1 mb-3 flex-wrap">
          {Array.from({ length: view?.max_streak ?? maxStreak }, (_, i) => {
            const reached = !!view && view.streak > i;
            const nextStep = !!view && view.streak === i && inGame;
            return (
              <div
                key={i}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                  reached ? 'bg-amber-400 text-zinc-900 border-amber-300' : nextStep ? 'bg-emerald-950/70 text-amber-200 border-amber-400/70' : 'bg-black/30 text-emerald-200/60 border-emerald-800'
                }`}
              >
                {i + 1}連 ×{Number(stepMul(i + 1).toFixed(2))}
              </div>
            );
          })}
        </div>

        <div className="flex items-end justify-center gap-6 sm:gap-10" style={{ perspective: 900 }}>
          {/* 今のカード */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-[11px] text-emerald-100/80">今のカード</div>
            <div
              className={cardBox}
              style={{
                animation: result === 'lose' && phase !== 'flip' ? 'hl-shake 0.45s ease-in-out' : undefined,
              }}
            >
              {view ? <Face card={view.card} /> : <Back />}
            </div>
          </div>

          <div className="pb-14 text-2xl font-black text-emerald-100/70 select-none">
            {guess === 'high' ? '⬆️' : guess === 'low' ? '⬇️' : '?'}
          </div>

          {/* 次のカード（山札） */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-[11px] text-emerald-100/80">次のカード</div>
            <div className={cardBox}>
              {/* 山札の厚み */}
              <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-xl bg-red-950 border border-white/30" />
              <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-xl bg-red-900 border border-white/40" />
              <div
                className="absolute inset-0"
                style={{
                  transformStyle: 'preserve-3d',
                  transition:
                    phase === 'idle'
                      ? 'none'
                      : phase === 'slide'
                        ? 'transform 0.42s cubic-bezier(0.4, 0, 0.2, 1)'
                        : 'transform 0.6s cubic-bezier(0.3, 0.7, 0.3, 1)',
                  transform:
                    phase === 'slide'
                      ? 'translateX(calc(-100% - 5.5rem)) rotateY(0deg)'
                      : phase === 'flip' || phase === 'result'
                        ? 'translateY(-10px) rotateY(0deg)'
                        : phase === 'waiting'
                          ? 'translateY(-12px) rotateY(180deg) rotateZ(-3deg)'
                          : 'rotateY(180deg)',
                  animation: phase === 'result' && outcome === 'win' ? 'hl-glow 0.8s ease-in-out' : undefined,
                  borderRadius: '0.75rem',
                }}
              >
                {next ? <Face card={next} /> : <div className="absolute inset-0 rounded-xl" style={{ backfaceVisibility: 'hidden' }} />}
                <Back flipped />
              </div>
            </div>
          </div>
        </div>

        {/* 当たり外れの表示 */}
        {phase === 'result' && outcome && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <div
              className={`px-5 py-2 rounded-2xl text-2xl font-black shadow-2xl border-2 ${
                outcome === 'win' ? 'bg-amber-400 text-zinc-900 border-amber-200' : outcome === 'draw' ? 'bg-zinc-200 text-zinc-800 border-white' : 'bg-red-600 text-white border-red-300'
              }`}
              style={{ animation: 'hl-banner 0.35s ease-out' }}
            >
              {outcome === 'win' ? '⭕ 当たり！' : outcome === 'draw' ? '🤝 同じ数字' : '💀 ハズレ…'}
            </div>
          </div>
        )}
        {pop > 0 && phase === 'result' && outcome === 'win' && (
          <div key={pop} className="absolute left-1/2 top-10 text-amber-300 font-black text-lg pointer-events-none" style={{ animation: 'hl-pop 0.9s ease-out forwards' }}>
            ×{Number(stepMul(view ? view.streak + 1 : 1).toFixed(2))}！
          </div>
        )}

        {/* これまでのカード */}
        {view && view.history.length > 1 && (
          <div className="mt-4 flex items-center justify-center gap-1 flex-wrap">
            {view.history.slice(-10).map((c, i) => (
              <div key={i} className="relative w-7 h-10">
                <Face card={c} big={false} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 金額 */}
      {view && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-800/50 rounded-xl py-2">
            <div className="text-[11px] text-zinc-500">賭け金</div>
            <div className="font-bold text-sm">{fmt(view.bet)}</div>
          </div>
          <div className="bg-zinc-800/50 rounded-xl py-2 border border-amber-700/40">
            <div className="text-[11px] text-zinc-500">受け取れる額</div>
            <div className="font-black text-amber-300">{fmt(view.amount)}</div>
          </div>
          <div className="bg-zinc-800/50 rounded-xl py-2">
            <div className="text-[11px] text-zinc-500">次に当てると</div>
            <div className="font-bold text-sm">{view.next_amount && inGame ? fmt(view.next_amount) : '—'}</div>
          </div>
        </div>
      )}

      {/* 操作 */}
      {inGame ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => doGuess('high')}
              disabled={animating || busy}
              className="py-3 rounded-xl font-black text-lg bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 disabled:opacity-50 shadow-lg"
            >
              ⬆️ HIGH
              {counts && <div className="text-[10px] font-normal opacity-80">大きいカード {counts.high}種</div>}
            </button>
            <button
              onClick={() => doGuess('low')}
              disabled={animating || busy}
              className="py-3 rounded-xl font-black text-lg bg-gradient-to-b from-sky-500 to-sky-700 hover:from-sky-400 hover:to-sky-600 disabled:opacity-50 shadow-lg"
            >
              ⬇️ LOW
              {counts && <div className="text-[10px] font-normal opacity-80">小さいカード {counts.low}種</div>}
            </button>
          </div>
          <button
            onClick={doCashout}
            disabled={animating || busy || !view!.revealed}
            className="w-full py-2.5 rounded-xl font-bold bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-zinc-900 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 flex items-center justify-center gap-2"
          >
            {phase === 'waiting' && !guess && <Loader2 className="w-4 h-4 animate-spin" />}
            💰 {fmt(view!.amount)} {cur} を受け取る
          </button>
          {!view!.revealed && <p className="text-xs text-zinc-500 text-center">1回以上めくると受け取れます。同じ数字は引き分け（そのまま続行）</p>}
        </>
      ) : (
        <>
          <button
            onClick={onStart}
            disabled={!canStart || busy}
            className="w-full py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-semibold flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            🃏 カードを配る
          </button>
          <p className="text-xs text-zinc-500 text-center">
            連勝するほど倍率アップ！ 最大 {maxStreak}連勝で ×{Number(stepMul(maxStreak).toFixed(2))}。いつでも受け取れます
          </p>
        </>
      )}
    </div>
  );
}
