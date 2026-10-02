'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Bot, Flag, Loader2 } from 'lucide-react';
import { memberFetch } from '@/lib/memberClient';

/**
 * ポーカー（テキサスホールデム）の AI 対戦テーブル。カード・AI の行動・勝敗はサーバー（lib/casino/poker.ts）で決まり、
 * ここでは見せ方と操作だけをする。AI の手札はショーダウンになるまで届かない。
 */

type PCard = [number, number];
interface Seat { stack: number; bet: number; folded: boolean; all_in: boolean; dealer: boolean }
interface Options { to_call: number; can_check: boolean; can_raise: boolean; min_raise_to: number; max_raise_to: number; current_bet: number }
export interface PokerView {
  id: string | null;
  bet: number;
  mult: number;
  level: number;
  level_name: string;
  start_chips: number;
  max_hands: number;
  hand_no: number;
  street: string;
  sb: number;
  bb: number;
  blind_up_now: boolean;
  board: PCard[];
  pot: number;
  me: Seat & { hole: PCard[]; hand_name: string };
  ai: Seat & { hole: PCard[] | null };
  my_turn: boolean;
  options: Options | null;
  log: string[];
  hand_result: {
    showdown: boolean;
    pots: { amount: number; winners: ('me' | 'ai')[]; hand: string | null }[];
    my_hand: string | null;
    ai_hand: string | null;
  } | null;
  finished: boolean;
  final: { result: 'win' | 'lose' | 'draw'; resigned: boolean; payout: number; my_stack: number; ai_stack: number; hands: number } | null;
  events: string[];
}
export interface PokerInfo {
  start_chips: number;
  sb: number;
  bb: number;
  blind_up: number;
  max_hands: number;
  bet_enabled: boolean;
  bet_min_level: number;
  ai_mult: Record<string, number>;
  ai_max_bet: Record<string, number>;
  level_names: Record<string, string>;
}

const RANK = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);
const SUIT = ['♠', '♥', '♦', '♣'];
const STREET: Record<string, string> = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン', done: '結果' };
const fmt = (n: number) => n.toLocaleString('ja-JP');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function PlayingCard({ card, small = false, dim = false }: { card: PCard | null; small?: boolean; dim?: boolean }) {
  const size = small ? 'w-10 h-14 text-sm' : 'w-14 h-20 text-lg';
  if (!card) {
    return (
      <div className={`${size} rounded-lg bg-gradient-to-br from-red-800 to-rose-950 border-2 border-red-200/30 shadow-md flex items-center justify-center`}>
        <div className="w-3/4 h-3/4 rounded border border-red-200/20 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.06)_4px,rgba(255,255,255,0.06)_8px)]" />
      </div>
    );
  }
  const red = card[1] === 1 || card[1] === 2;
  return (
    <div
      className={`${size} rounded-lg bg-gradient-to-br from-white to-zinc-200 border border-zinc-300 shadow-md flex flex-col items-center justify-center font-black leading-none ${
        red ? 'text-red-600' : 'text-zinc-900'
      } ${dim ? 'opacity-40' : ''}`}
    >
      <span>{RANK(card[0])}</span>
      <span className={small ? 'text-base' : 'text-xl'}>{SUIT[card[1]]}</span>
    </div>
  );
}

function EmptySlot() {
  return <div className="w-14 h-20 rounded-lg border-2 border-dashed border-emerald-200/15" />;
}

function SeatInfo({ label, seat, cur }: { label: React.ReactNode; seat: Seat; cur?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-1.5 font-semibold">
        {label}
        {seat.dealer && <span className="w-5 h-5 rounded-full bg-white text-zinc-900 text-[10px] font-black flex items-center justify-center">D</span>}
        {seat.folded && <span className="text-[11px] text-zinc-400">（フォールド）</span>}
        {seat.all_in && <span className="text-[11px] text-amber-300">（オールイン）</span>}
      </div>
      <div className="text-right">
        <span className="text-amber-200 font-bold">💰 {fmt(seat.stack)}</span>
        {cur && <span className="text-[11px] text-emerald-200/60 ml-1">{cur}</span>}
      </div>
    </div>
  );
}

function BetChip({ amount }: { amount: number }) {
  if (!amount) return <div className="h-6" />;
  return (
    <div className="h-6 flex justify-center">
      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/90 text-zinc-900 text-xs font-bold shadow">{fmt(amount)}</span>
    </div>
  );
}

export default function Poker({
  guildId,
  info,
  initial,
  cur,
  balance,
  onBalance,
  onFinished,
  onLock,
}: {
  guildId: string;
  info: PokerInfo;
  initial: PokerView | null;
  cur: string;
  balance: number;
  onBalance: (balance: number) => void;
  onFinished: () => void;
  onLock: (locked: boolean) => void;
}) {
  const [game, setGame] = useState<PokerView | null>(initial);
  const [level, setLevel] = useState(3);
  const [betText, setBetText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const inGame = !!game && !game.finished;
  useEffect(() => onLock(inGame), [inGame, onLock]);

  // 自分の番になったらレイズ額を最小額に合わせる
  const opt = game?.options ?? null;
  useEffect(() => {
    if (opt) setRaiseTo(opt.min_raise_to);
  }, [opt?.min_raise_to, opt?.max_raise_to, game?.hand_no, game?.street]);

  const betting = info.bet_enabled && level >= info.bet_min_level;
  const maxBet = info.ai_max_bet[String(level)] || 0;
  const maxAllowed = Math.min(maxBet > 0 ? maxBet : Infinity, balance);
  const bet = Number(betText);
  const betValid = !betting || (Number.isInteger(bet) && bet >= 1 && bet <= maxAllowed);

  const post = async (body: object): Promise<PokerView & { balance: number; resumed?: boolean } | null> => {
    const res = await memberFetch(`/api/member/guilds/${guildId}/casino/poker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast.error(data.error || 'ゲームを進められませんでした');
      if (res.status === 409) setGame(null);
      return null;
    }
    return data;
  };

  /** 送って結果を反映する。AI が動いたときは少し考えているように見せてから出す */
  const send = async (body: object, aiMayAct: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (aiMayAct) setThinking(true);
      const [data] = await Promise.all([post(body), aiMayAct ? sleep(700) : Promise.resolve()]);
      if (!alive.current || !data) return;
      setGame(data);
      onBalance(data.balance);
      if (data.resumed) toast('進行中のゲームの続きです');
      if (data.finished) onFinished();
    } catch {
      toast.error('サーバーに接続できませんでした');
    } finally {
      if (alive.current) {
        setBusy(false);
        setThinking(false);
      }
    }
  };

  const start = () => send({ action: 'start', level, bet: betting ? bet : 0 }, true);
  const act = (move: string, amount = 0) => send({ action: 'act', id: game?.id, move, amount }, true);
  const next = () => send({ action: 'next', id: game?.id }, true);
  const resign = () => {
    if (!confirm(game?.bet ? `降参すると負けになり、賭け金 ${fmt(game.bet)} ${cur} は戻りません。降参しますか？` : '降参すると負けになります。降参しますか？')) return;
    send({ action: 'resign', id: game?.id }, false);
  };

  // ---------- 始める前 ----------
  if (!game) {
    const hands = info.max_hands
      ? `${info.max_hands}ハンド終了時にチップが多い方の勝ち（どちらかのチップがなくなったらその時点で終了）`
      : 'どちらかのチップがなくなるまで';
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-900/60 to-emerald-950/60 border border-emerald-800/60 text-sm text-emerald-100/90 leading-relaxed">
          🃏 テキサスホールデムで AI と 1対1。お互いチップ <b>{fmt(info.start_chips)}</b> から、{hands}。
          <div className="text-xs text-emerald-200/60 mt-1">
            ブラインド {fmt(info.sb)} / {fmt(info.bb)}
            {info.blind_up ? `（${info.blind_up}ハンドごとに2倍）` : ''}
          </div>
        </div>

        <div>
          <div className="text-sm text-zinc-400 mb-2 flex items-center gap-1.5"><Bot className="w-4 h-4" /> AIのレベル</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((lv) => {
              const canBet = info.bet_enabled && lv >= info.bet_min_level;
              return (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className={`py-2 rounded-lg text-sm border transition-colors ${
                    level === lv ? 'bg-emerald-600/30 border-emerald-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white'
                  }`}
                >
                  <div className="font-semibold">Lv{lv} {info.level_names[String(lv)]}</div>
                  {canBet && <div className="text-[11px] text-amber-300">勝つと ×{info.ai_mult[String(lv)]}</div>}
                </button>
              );
            })}
          </div>
          {info.bet_enabled && (
            <p className="text-[11px] text-zinc-500 mt-1.5">賭けられるのはレベル{info.bet_min_level}以上です（レベル{info.bet_min_level - 1}以下は賭けずに遊べます）</p>
          )}
        </div>

        {betting && (
          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              賭け金{maxBet > 0 ? `（上限 ${fmt(maxBet)}）` : ''}・勝つと ×{info.ai_mult[String(level)]}、引き分けは返金
            </label>
            <div className="flex items-center gap-2">
              <input
                value={betText}
                onChange={(e) => setBetText(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="0"
                className="flex-1 min-w-0 px-3 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              <span className="text-zinc-400 text-sm">{cur}</span>
            </div>
            <div className="flex gap-2 mt-2">
              {[100, 1000, 10000].map((n) => (
                <button
                  key={n}
                  onClick={() => setBetText(String(Math.min((Number(betText) || 0) + n, Math.max(0, maxAllowed))))}
                  className="flex-1 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg"
                >
                  +{fmt(n)}
                </button>
              ))}
              <button
                onClick={() => setBetText(String(Math.max(0, Math.floor(maxAllowed))))}
                className="flex-1 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg"
              >
                最大
              </button>
            </div>
            {betText && !betValid && (
              <p className="text-xs text-red-400 mt-1.5">1〜{fmt(Math.max(0, Math.floor(maxAllowed)))} の整数で入力してください</p>
            )}
          </div>
        )}

        <button
          onClick={start}
          disabled={busy || !betValid || (betting && !betText)}
          className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          🃏 レベル{level}（{info.level_names[String(level)]}）と対戦する
        </button>
      </div>
    );
  }

  // ---------- 卓 ----------
  const g = game;
  const handDone = g.street === 'done';
  const hr = g.hand_result;
  const o = g.options;
  const potNow = g.pot;
  const quick = o
    ? [
        { label: '½ポット', to: o.current_bet + Math.floor(Math.max(g.bb, (potNow + o.to_call) * 0.5)) },
        { label: 'ポット', to: o.current_bet + Math.max(g.bb, potNow + o.to_call) },
      ].map((q) => ({ ...q, to: Math.max(o.min_raise_to, Math.min(o.max_raise_to, q.to)) }))
    : [];
  const raiseVerb = o && o.current_bet === 0 ? 'ベット' : 'レイズ';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>
          ハンド #{g.hand_no}{g.max_hands ? ` / ${g.max_hands}` : ''}・{STREET[g.street] ?? ''}・ブラインド {fmt(g.sb)}/{fmt(g.bb)}
        </span>
        {g.bet > 0 && <span className="text-amber-300">賭け金 {fmt(g.bet)}（×{g.mult}）</span>}
      </div>

      <div className="rounded-[2rem] p-4 space-y-3 bg-[radial-gradient(ellipse_at_center,_#166534_0%,_#14532d_55%,_#052e16_100%)] border-4 border-amber-900/80 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]">
        {/* AI */}
        <SeatInfo label={<><Bot className="w-4 h-4" /> AI Lv{g.level}（{g.level_name}）</>} seat={g.ai} />
        <div className="flex justify-center gap-1.5">
          {g.ai.folded && !g.ai.hole ? null : (g.ai.hole ?? [null, null]).map((c, i) => <PlayingCard key={i} card={c} small />)}
        </div>
        {hr?.ai_hand && <div className="text-center text-xs text-emerald-100">{hr.ai_hand}</div>}
        <BetChip amount={g.ai.bet} />

        {/* 場 */}
        <div className="flex justify-center gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (g.board[i] ? <PlayingCard key={i} card={g.board[i]} /> : <EmptySlot key={i} />))}
        </div>
        <div className="text-center text-sm font-bold text-amber-200">💰 ポット {fmt(potNow)}</div>

        <BetChip amount={g.me.bet} />
        {/* 自分 */}
        <div className="flex justify-center gap-1.5">
          {g.me.hole.map((c, i) => <PlayingCard key={i} card={c} dim={g.me.folded} />)}
        </div>
        {g.me.hand_name && <div className="text-center text-xs text-emerald-100">{g.me.hand_name}</div>}
        <SeatInfo label="👤 あなた" seat={g.me} />
      </div>

      {thinking && (
        <div className="text-center text-sm text-zinc-400 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> AI が考えています…
        </div>
      )}

      {/* ハンドの結果 */}
      {handDone && hr && !thinking && (
        <div className="rounded-xl p-3 border border-amber-700/60 bg-amber-950/40 text-sm space-y-1">
          {hr.pots.map((p, i) => (
            <div key={i} className="font-semibold">
              🏆 {p.winners.length > 1 ? '引き分け（山分け）' : p.winners[0] === 'me' ? 'あなた' : 'AI'} が {fmt(p.amount)} を獲得
              {p.hand ? `（${p.hand}）` : ''}
            </div>
          ))}
          {!hr.showdown && <div className="text-xs text-zinc-400">相手がフォールドしました</div>}
          {g.blind_up_now && <div className="text-xs text-amber-300">⏫ 次のハンドからブラインドが {fmt(g.sb)} / {fmt(g.bb)} に上がります</div>}
        </div>
      )}

      {/* 最終結果 */}
      {g.final && (
        <div
          className={`rounded-xl p-4 border text-sm ${
            g.final.result === 'win'
              ? 'bg-amber-950/40 border-amber-700/60 text-amber-200'
              : g.final.result === 'lose'
                ? 'bg-red-950/40 border-red-900/60 text-red-200'
                : 'bg-zinc-800/60 border-zinc-700 text-zinc-200'
          }`}
        >
          <div className="font-bold text-base">
            {g.final.result === 'win' ? '🏆🎉 あなたの勝ち！' : g.final.result === 'lose' ? `🤖 AIの勝ち${g.final.resigned ? '（降参）' : ''}` : '🤝 引き分け'}
          </div>
          <div className="mt-1 opacity-90">
            最終チップ: あなた {fmt(g.final.my_stack)} ／ AI {fmt(g.final.ai_stack)}（{g.final.hands}ハンド）
          </div>
          {g.bet > 0 && (
            <div className="mt-1 opacity-90">
              {g.final.result === 'win'
                ? `💰 ${fmt(g.final.payout)} ${cur} を受け取りました（+${fmt(g.final.payout - g.bet)}）`
                : g.final.result === 'draw'
                  ? `💰 ${fmt(g.bet)} ${cur} が戻りました`
                  : `💰 ${fmt(g.bet)} ${cur} 没収`}
            </div>
          )}
        </div>
      )}

      {/* 操作 */}
      {g.final ? (
        <button
          onClick={() => setGame(null)}
          className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-semibold"
        >
          🃏 もう一度遊ぶ
        </button>
      ) : handDone ? (
        <button
          onClick={next}
          disabled={busy}
          className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 rounded-xl font-semibold flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          次のハンドへ
        </button>
      ) : g.my_turn && o && !thinking ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => act('fold')}
              disabled={busy}
              className="py-3 rounded-xl font-semibold bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50"
            >
              フォールド
            </button>
            <button
              onClick={() => act(o.can_check ? 'check' : 'call')}
              disabled={busy}
              className="py-3 rounded-xl font-semibold bg-sky-700 hover:bg-sky-600 disabled:opacity-50"
            >
              {o.can_check ? 'チェック' : `コール ${fmt(o.to_call)}`}
            </button>
          </div>
          {o.can_raise && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={o.min_raise_to}
                  max={o.max_raise_to}
                  step={Math.max(1, Math.floor(g.bb / 2))}
                  value={raiseTo}
                  onChange={(e) => setRaiseTo(Number(e.target.value))}
                  className="flex-1 accent-amber-500"
                />
                <input
                  value={raiseTo}
                  onChange={(e) => setRaiseTo(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
                  inputMode="numeric"
                  className="w-24 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-right"
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {quick.map((q) => (
                  <button key={q.label} onClick={() => setRaiseTo(q.to)} className="py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg">
                    {q.label}
                  </button>
                ))}
                <button onClick={() => setRaiseTo(o.max_raise_to)} className="py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg">
                  オールイン
                </button>
              </div>
              <button
                onClick={() => act(raiseTo >= o.max_raise_to ? 'allin' : 'raise', Math.max(o.min_raise_to, Math.min(o.max_raise_to, raiseTo)))}
                disabled={busy}
                className="w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50"
              >
                {raiseTo >= o.max_raise_to ? `オールイン ${fmt(o.max_raise_to)}` : `${raiseVerb} ${fmt(Math.max(o.min_raise_to, raiseTo))}`}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* 直前の行動 */}
      {g.log.length > 0 && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
          <div className="text-xs text-zinc-500 mb-1">直前の行動</div>
          <div className="space-y-0.5 text-xs text-zinc-300">
            {g.log.map((line, i) => (
              <div key={i} className={line.startsWith('—') ? 'text-emerald-300/80' : ''}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {!g.final && (
        <button
          onClick={resign}
          disabled={busy}
          className="w-full py-2 text-xs text-zinc-400 hover:text-red-300 flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Flag className="w-3.5 h-3.5" /> 降参する
        </button>
      )}
    </div>
  );
}
