'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Bot, Flag, Loader2, Search, Swords, Users } from 'lucide-react';
import { getActivityContext, memberFetch } from '@/lib/memberClient';
import { ChessBoardView, OthelloBoardView, ShogiBoardView } from './Boards';

type GameKey = 'othello' | 'chess' | 'shogi';

interface Player { id: string; name: string; avatar_url: string }
export interface BoardGameView {
  id: string;
  game: GameKey;
  mode: 'ai' | 'pvp';
  status: 'invited' | 'active' | 'finished' | 'declined' | 'cancelled';
  ai_level: number;
  bet: number;
  you: 0 | 1 | 2;
  first: Player | null;
  second: Player | null;
  inviter_id: string | null;
  state: any;
  turn: 1 | 2;
  my_turn: boolean;
  legal: string[];
  history: string[];
  last_move: any;
  notes: string[];
  winner: number | null;
  reason: string | null;
  /** 自分の精算（賭けがあった対局だけ）: 賭けた額・受け取った額・精算後の所持金 */
  settlement?: { bet: number; payout: number; balance: number } | null;
}
/** GET /api/member/guilds/[guild_id]/boardgames の中身（enabled: true のとき） */
export interface GamesInfo {
  enabled: true;
  currency_name: string;
  /** ai_mult: AI に勝ったときの倍率（キーはレベル。賭けられるのはレベル AI_BET_MIN_LEVEL 以上） */
  games: { key: GameKey; label: string; bet_enabled: boolean; ai_mult?: Record<string, number> }[];
  mine: BoardGameView[];
  /** アクティビティを通話で開いているとき、その通話にいる人 */
  voice_peers?: Player[];
}

const GAME_META: Record<GameKey, { icon: string; label: string; sides: [string, string]; color: string }> = {
  othello: { icon: '⚫', label: 'オセロ', sides: ['⚫ 黒', '⚪ 白'], color: 'from-emerald-700/40 to-emerald-950/40 border-emerald-700/60' },
  chess: { icon: '♟️', label: 'チェス', sides: ['⚪ 白', '⚫ 黒'], color: 'from-amber-700/40 to-stone-900/40 border-amber-700/60' },
  shogi: { icon: '☗', label: '将棋', sides: ['☗ 先手', '☖ 後手'], color: 'from-orange-700/40 to-amber-950/40 border-orange-700/60' },
};
const LEVELS = ['簡単', '普通', '中級', '難しい', '最難関'];
/** AI対戦で賭けられる最低レベル（lib/boardgames/web.ts と同じ） */
const AI_BET_MIN_LEVEL = 4;
const fmt = (n: number) => n.toLocaleString('ja-JP');

async function api(path: string, body?: object) {
  const res = await memberFetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

// ---------------- 対局画面 ----------------

function GameScreen({ guildId, initial, onBack, onFinished }: { guildId: string; initial: BoardGameView; onBack: () => void; onFinished: () => void }) {
  const [g, setG] = useState<BoardGameView>(initial);
  const [sending, setSending] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const finishedRef = useRef(initial.status === 'finished');
  const meta = GAME_META[g.game];
  const base = `/api/member/guilds/${guildId}/boardgames/${g.id}`;

  const update = useCallback(
    (next: BoardGameView) => {
      setG(next);
      if (next.status === 'finished' && !finishedRef.current) {
        finishedRef.current = true;
        onFinished();
      }
    },
    [onFinished]
  );

  // 相手の番・招待中は数秒ごとに最新を取りに行く
  const waiting = (g.status === 'active' && !g.my_turn) || g.status === 'invited';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      try {
        const data = await api(base);
        update(data.game);
      } catch {}
    }, 2500);
    return () => clearInterval(timer);
  }, [waiting, base, update]);

  const act = async (body: object) => {
    setSending(true);
    try {
      const data = await api(base, body);
      update(data.game);
    } catch (e: any) {
      toast.error(e.message);
      try {
        update((await api(base)).game);
      } catch {}
    } finally {
      setSending(false);
    }
  };

  const boardProps = {
    state: g.state,
    you: g.you,
    legal: g.legal,
    lastMove: g.last_move,
    disabled: sending || !g.my_turn,
    onMove: (move: string) => act({ action: 'move', move }),
  };
  const opponent = g.you === 1 ? g.second : g.first;
  const oppName = g.mode === 'ai' ? `🤖 AI（Lv${g.ai_level}: ${LEVELS[g.ai_level - 1]}）` : opponent?.name ?? '相手';
  const PlayerBar = ({ side, name, avatar }: { side: 1 | 2; name: string; avatar?: string }) => {
    const turnNow = g.status === 'active' && g.turn === side;
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${turnNow ? 'border-amber-400/80 bg-amber-400/10 shadow-[0_0_12px_rgba(251,191,36,0.3)]' : 'border-zinc-800 bg-zinc-900/60'}`}>
        {avatar ? (
          <img src={avatar} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs">{g.mode === 'ai' && side === 2 ? '🤖' : '👤'}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-zinc-400">{meta.sides[side - 1]}</div>
          <div className="text-sm font-bold truncate">{name}</div>
        </div>
        {turnNow && <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">{sending && g.mode === 'ai' ? <Loader2 className="w-3 h-3 animate-spin" /> : '●'} 手番</span>}
      </div>
    );
  };
  const mySide = (g.you || 1) as 1 | 2;
  const oppSide = (3 - mySide) as 1 | 2;
  const resultText =
    g.status === 'finished'
      ? g.winner === 0
        ? '🤝 引き分け'
        : g.winner === g.you
          ? '🏆 あなたの勝ち！'
          : g.mode === 'ai'
            ? '🤖 AIの勝ち…'
            : `💀 ${oppName} の勝ち`
      : null;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> ゲーム一覧へ
      </button>
      <div className="flex items-center justify-between">
        <div className="font-bold text-lg">{meta.icon} {meta.label}{g.mode === 'ai' ? ' AI対戦' : ' 対局'}</div>
        {g.bet > 0 && <div className="text-xs text-amber-300">💰 賭け金 {fmt(g.bet)}</div>}
      </div>

      {g.status === 'invited' && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 text-center space-y-3">
          {g.inviter_id === (g.you === 1 ? g.first?.id : g.second?.id) ? (
            <>
              <div className="text-sm">{oppName} さんの返事を待っています…</div>
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-zinc-500" />
              <button onClick={() => act({ action: 'cancel' })} disabled={sending} className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm">
                申し込みを取り消す
              </button>
            </>
          ) : (
            <>
              <div className="text-sm">
                <b>{oppName}</b> さんから対局の申し込みです
                {g.bet > 0 && (
                  <div className="mt-2 text-amber-300 font-bold">💰 賭け金 {fmt(g.bet)}（あなたも同じ額を賭けます。勝つと {fmt(g.bet * 2)}）</div>
                )}
              </div>
              <div className="flex gap-2 justify-center">
                <button onClick={() => act({ action: 'accept' })} disabled={sending} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">
                  受ける
                </button>
                <button onClick={() => act({ action: 'decline' })} disabled={sending} className="px-5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700">
                  断る
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(g.status === 'active' || g.status === 'finished') && (
        <>
          <PlayerBar side={oppSide} name={oppName} avatar={g.mode === 'ai' ? undefined : opponent?.avatar_url} />
          <div className="relative">
            {g.game === 'othello' && <OthelloBoardView {...boardProps} />}
            {g.game === 'chess' && <ChessBoardView {...boardProps} />}
            {g.game === 'shogi' && <ShogiBoardView {...boardProps} />}
            {resultText && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="px-6 py-3 rounded-2xl bg-black/75 border border-amber-400/60 text-center" style={{ animation: 'hl-banner 0.4s ease-out' }}>
                  <div className="text-2xl font-black">{resultText}</div>
                  <div className="text-xs text-zinc-300 mt-1">{g.reason}</div>
                  {g.settlement && g.settlement.bet > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-sm space-y-0.5">
                      {g.settlement.payout > g.settlement.bet ? (
                        <div>
                          💰 元金 <b>{fmt(g.settlement.bet)}</b> → <b className="text-amber-300">{fmt(g.settlement.payout)}</b>
                          <span className="text-emerald-300 font-bold ml-1">（+{fmt(g.settlement.payout - g.settlement.bet)}）</span>
                        </div>
                      ) : g.settlement.payout === g.settlement.bet ? (
                        <div>💰 元金 <b>{fmt(g.settlement.bet)}</b> は返金されました</div>
                      ) : (
                        <div>💸 元金 <b>{fmt(g.settlement.bet)}</b> → <b className="text-red-400">0</b><span className="text-red-400 ml-1">（-{fmt(g.settlement.bet)}）</span></div>
                      )}
                      <div className="text-xs text-zinc-400">所持金: {fmt(g.settlement.balance)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <PlayerBar side={mySide} name={(g.you === 1 ? g.first : g.second)?.name ?? 'あなた'} avatar={(g.you === 1 ? g.first : g.second)?.avatar_url} />
          <style>{`@keyframes hl-banner { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }`}</style>
          {g.status === 'active' && (
            <div className="text-center text-sm min-h-[1.5rem]">
              {g.my_turn ? (
                <span className="font-bold text-amber-300">あなたの番です{g.game !== 'othello' ? '（駒をタップ → 移動先をタップ）' : ''}</span>
              ) : (
                <span className="text-zinc-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {g.mode === 'ai' ? 'AIが考えています…' : `${oppName} さんの番です`}
                </span>
              )}
            </div>
          )}
          {g.notes.length > 0 && <div className="text-xs text-center text-sky-300">{g.notes.join(' / ')}</div>}
          {g.history.length > 0 && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-300 max-h-28 overflow-y-auto">
              {g.history.map((t, i) => (
                <span key={i} className="inline-block mr-2">
                  <span className="text-zinc-500">{i + 1}.</span>
                  {t}
                </span>
              ))}
            </div>
          )}
          {g.status === 'active' &&
            (confirmResign ? (
              <div className="flex gap-2">
                <button onClick={() => { setConfirmResign(false); act({ action: 'resign' }); }} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 font-bold text-sm">
                  本当に投了する
                </button>
                <button onClick={() => setConfirmResign(false)} className="flex-1 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm">
                  やめる
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmResign(true)} disabled={sending} className="w-full py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 flex items-center justify-center gap-2">
                <Flag className="w-4 h-4" /> 投了する
              </button>
            ))}
        </>
      )}
    </div>
  );
}

// ---------------- 一覧・新しい対局 ----------------

export default function Games({
  guildId,
  info,
  onChanged,
  openGameId,
  onOpened,
}: {
  guildId: string;
  info: GamesInfo;
  onChanged: () => void;
  openGameId?: string | null;
  onOpened?: () => void;
}) {
  const [game, setGame] = useState<GameKey>(info.games[0]?.key ?? 'othello');
  const [mine, setMine] = useState<BoardGameView[]>(info.mine);
  const [open, setOpen] = useState<BoardGameView | null>(null);
  const [level, setLevel] = useState(3);
  const [betText, setBetText] = useState('');
  // 対人戦の賭け金（空欄なら既定の金額）
  const [pvpBetText, setPvpBetText] = useState('');
  const [peers, setPeers] = useState<Player[]>(info.voice_peers ?? []);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; display_name: string; avatar_url: string; is_bot: boolean }[]>([]);
  const g = info.games.find((x) => x.key === game);
  // 空欄・0 は賭けなし（申し込む人が決め、受ける人も同じ額を賭ける）
  const pvpBet = g?.bet_enabled && pvpBetText !== '' ? Number(pvpBetText) : 0;
  // AI対戦で賭けられるのはレベル4以上。勝つと設定の倍率で戻る
  const aiBetOk = !!g?.bet_enabled && level >= AI_BET_MIN_LEVEL;
  const aiMult = g?.ai_mult?.[String(level)] ?? 2;
  // ゲームを切り替えたら賭け金の入力は空に戻す（金額は申し込む人が毎回決める）
  useEffect(() => {
    setBetText('');
    setPvpBetText('');
  }, [g?.key]);

  const reload = useCallback(async () => {
    try {
      const ctx = getActivityContext();
      const data = await api(`/api/member/guilds/${guildId}/boardgames${ctx?.channelId ? `?channel_id=${ctx.channelId}` : ''}`);
      if (data.enabled) {
        setMine(data.mine);
        setPeers(data.voice_peers ?? []);
      }
    } catch {}
  }, [guildId]);

  // 招待から来たとき・お知らせの「参加する」を押したときは、その対局をすぐ開く
  useEffect(() => {
    if (!openGameId) return;
    (async () => {
      try {
        const data = await api(`/api/member/guilds/${guildId}/boardgames/${openGameId}`);
        setOpen(data.game);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        onOpened?.();
      }
    })();
  }, [openGameId, guildId, onOpened]);

  // 一覧を開いているあいだは招待・相手の手を数秒ごとに確認する
  useEffect(() => {
    if (open) return;
    const timer = setInterval(reload, 6000);
    return () => clearInterval(timer);
  }, [open, reload]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/member/guilds/${guildId}/members?q=${encodeURIComponent(q)}`);
        if (!cancelled) setResults((data.members ?? []).filter((m: any) => !m.is_bot));
      } catch {}
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, guildId]);

  const create = async (body: object) => {
    setBusy(true);
    try {
      const data = await api(`/api/member/guilds/${guildId}/boardgames`, { game, ...body });
      setOpen(data.game);
      onChanged();
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    return (
      <GameScreen
        key={open.id}
        guildId={guildId}
        initial={open}
        onBack={() => {
          setOpen(null);
          reload();
        }}
        onFinished={onChanged}
      />
    );
  }

  const incoming = mine.filter((m) => m.status === 'invited' && m.inviter_id !== (m.you === 1 ? m.first?.id : m.second?.id));
  const others = mine.filter((m) => !incoming.includes(m));
  const describe = (m: BoardGameView) => {
    const opp = m.mode === 'ai' ? `AI Lv${m.ai_level}` : (m.you === 1 ? m.second : m.first)?.name ?? '相手';
    if (m.status === 'invited') return { opp, text: '返事待ち', tone: 'text-zinc-400' };
    if (m.status === 'active') return { opp, text: m.my_turn ? 'あなたの番' : '相手の番', tone: m.my_turn ? 'text-amber-300 font-bold' : 'text-zinc-400' };
    if (m.status === 'finished') return { opp, text: m.winner === 0 ? '引き分け' : m.winner === m.you ? '勝ち' : '負け', tone: m.winner === m.you ? 'text-emerald-300' : 'text-zinc-500' };
    return { opp, text: m.status === 'declined' ? '断られました' : '取り消し', tone: 'text-zinc-500' };
  };

  return (
    <div className="space-y-4">
      {/* 届いた招待 */}
      {incoming.map((m) => (
        <button
          key={m.id}
          onClick={() => setOpen(m)}
          className="w-full text-left bg-amber-950/40 border border-amber-600/60 rounded-2xl p-4 flex items-center gap-3 animate-pulse"
        >
          <span className="text-2xl">{GAME_META[m.game].icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold">{(m.you === 1 ? m.second : m.first)?.name} さんから {GAME_META[m.game].label} の申し込み！</div>
            <div className="text-xs text-amber-200/80">タップして受ける・断る</div>
          </div>
        </button>
      ))}

      {/* ゲームを選ぶ */}
      {info.games.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {info.games.map((x) => (
            <button
              key={x.key}
              onClick={() => setGame(x.key)}
              className={`rounded-2xl border p-3 flex flex-col items-center gap-1 transition-all bg-gradient-to-br ${
                game === x.key ? `${GAME_META[x.key].color} ring-2 ring-white/40` : 'from-zinc-900 to-zinc-900 border-zinc-800 opacity-70'
              }`}
            >
              <span className="text-3xl leading-none">{GAME_META[x.key].icon}</span>
              <span className="text-sm font-bold">{x.label}</span>
            </button>
          ))}
        </div>
      )}

      {g && (
        <>
          {/* AI対戦 */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="font-semibold flex items-center gap-2"><Bot className="w-4 h-4" /> AIと対戦</div>
            <div className="grid grid-cols-5 gap-1.5">
              {LEVELS.map((name, i) => (
                <button
                  key={name}
                  onClick={() => setLevel(i + 1)}
                  className={`py-2 rounded-lg text-xs font-bold border ${level === i + 1 ? 'bg-red-600/30 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                >
                  Lv{i + 1}
                  <div className="text-[10px] font-normal">{name}</div>
                </button>
              ))}
            </div>
            {aiBetOk && (
              <div className="flex items-center gap-2">
                <input
                  value={betText}
                  onChange={(e) => setBetText(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder="賭け金（空欄・0 で賭けなし）"
                  className="flex-1 min-w-0 px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm"
                />
                <span className="text-xs text-zinc-400">{info.currency_name}</span>
              </div>
            )}
            <button
              onClick={() => create({ action: 'ai', level, bet: aiBetOk && betText ? Number(betText) : 0 })}
              disabled={busy}
              className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />} AI対戦を始める
            </button>
            {aiBetOk && Number(betText) > 0 && (
              <p className="text-[11px] text-zinc-500 text-center">
                勝つと {fmt(Math.floor(Number(betText) * aiMult))}（賭け金の{aiMult}倍）、引き分けは返金、負けると没収です
              </p>
            )}
            {g.bet_enabled && !aiBetOk && (
              <p className="text-[11px] text-zinc-500 text-center">
                AI対戦で賭けられるのはレベル{AI_BET_MIN_LEVEL}以上です（Lv4 ×{g.ai_mult?.['4'] ?? 2}・Lv5 ×{g.ai_mult?.['5'] ?? 3}）
              </p>
            )}
          </div>

          {/* 対人戦 */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="font-semibold flex items-center gap-2"><Users className="w-4 h-4" /> メンバーと対戦</div>
            {g.bet_enabled && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 flex-shrink-0">賭け金（各自）</span>
                <input
                  value={pvpBetText}
                  onChange={(e) => setPvpBetText(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder="金額を入力（空欄・0 で賭けなし）"
                  className="flex-1 min-w-0 px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm"
                />
                <span className="text-xs text-zinc-400">{info.currency_name}</span>
              </div>
            )}
            {/* 同じ通話にいる人（アクティビティを通話で開いているとき） */}
            {peers.length > 0 && (
              <div className="bg-indigo-950/40 border border-indigo-700/60 rounded-xl p-3 space-y-2">
                <div className="font-semibold text-sm">🎧 この通話にいる人と対戦</div>
                {peers.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 bg-zinc-900/60 rounded-xl px-3 py-2">
                    {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-7 h-7 rounded-full" /> : <span className="w-7 h-7 rounded-full bg-zinc-700" />}
                    <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                    <button
                      onClick={() => create({ action: 'invite', opponent_id: p.id, bet: pvpBet })}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-bold"
                    >
                      {GAME_META[game].label}を申し込む
                    </button>
                  </div>
                ))}
                <p className="text-[11px] text-zinc-400">相手がこの通話でアクティビティを開いていれば、すぐ「参加する」のお知らせが出ます。</p>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前で検索して申し込む"
                className="w-full pl-9 pr-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm"
              />
            </div>
            {results.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-zinc-800/50 rounded-xl px-3 py-2">
                <img src={m.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                <span className="flex-1 min-w-0 truncate text-sm">{m.display_name}</span>
                <button
                  onClick={() => {
                    setQuery('');
                    create({ action: 'invite', opponent_id: m.id, bet: pvpBet });
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
                >
                  申し込む
                </button>
              </div>
            ))}
            <p className="text-[11px] text-zinc-500">
              相手にはDiscordのDMでお知らせが届きます。先手はランダムで決まります。{pvpBet > 0 ? `賭け金は各自 ${fmt(pvpBet)} ${info.currency_name}（相手も同じ額を賭けます。勝った人が ${fmt(pvpBet * 2)} を受け取ります）。` : ''}
            </p>
          </div>
        </>
      )}

      {/* 自分の対局 */}
      {others.length > 0 && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4">
          <div className="font-semibold mb-2">📋 あなたの対局</div>
          <div className="space-y-1.5">
            {others.map((m) => {
              const d = describe(m);
              return (
                <button key={m.id} onClick={() => setOpen(m)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-left">
                  <span className="text-xl w-7 text-center">{GAME_META[m.game].icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">vs {d.opp}</div>
                    <div className="text-[11px] text-zinc-500">{GAME_META[m.game].label}{m.bet ? ` ・ 賭け ${fmt(m.bet)}` : ''}</div>
                  </div>
                  <span className={`text-xs ${d.tone}`}>{d.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
