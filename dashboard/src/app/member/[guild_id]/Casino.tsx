'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { memberFetch } from '@/lib/memberClient';

/** GET /api/member/guilds/[guild_id]/casino の中身 */
export interface CasinoInfo {
  currency_name: string;
  games: { key: GameKey; label: string }[];
  limits: { max_bet: number; max_plays: number; daily_limit: number; tax_rate: number };
  status: { balance: number; plays_today: number; bet_today: number };
  multipliers: {
    coinflip: number;
    slot: { seven: number; star: number; three: number; two: number };
    roulette: { two: number; three: number; number: number };
    blackjack: { normal: number; bj: number };
    horse: { tan: number; fuku: number };
  };
  horses: { num: number; name: string; emoji: string }[];
  active_blackjack: BjView | null;
}
type GameKey = 'coinflip' | 'slot' | 'roulette' | 'blackjack' | 'chinchiro' | 'horse';

interface Card { suit: string; value: string }
interface BjView {
  id: string | null;
  bet: number;
  finished: boolean;
  outcome?: string;
  payout?: number;
  tax?: number;
  player: Card[];
  player_score: number;
  dealer: (Card | null)[];
  dealer_score: number;
}

const GAME_ICON: Record<GameKey, string> = {
  coinflip: '🪙', slot: '🎰', roulette: '🎡', blackjack: '🃏', chinchiro: '🎲', horse: '🏇',
};
const fmt = (n: number) => n.toLocaleString('ja-JP');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

interface Outcome { tone: 'win' | 'lose' | 'draw'; title: string; detail: string }

function ResultBox({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  const tone = {
    win: 'bg-amber-950/40 border-amber-700/60 text-amber-200',
    lose: 'bg-red-950/40 border-red-900/60 text-red-200',
    draw: 'bg-zinc-800/60 border-zinc-700 text-zinc-200',
  }[outcome.tone];
  return (
    <div className={`border rounded-xl p-4 text-sm ${tone}`}>
      <div className="font-bold text-base">{outcome.title}</div>
      {outcome.detail && <div className="mt-1 whitespace-pre-line opacity-90">{outcome.detail}</div>}
    </div>
  );
}

function PlayButton({ busy, disabled, onClick, children }: { busy: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

function CardView({ card }: { card: Card | null }) {
  if (!card) {
    return <div className="w-12 h-16 rounded-lg bg-gradient-to-br from-red-800 to-rose-900 border border-red-700/60 flex items-center justify-center text-lg">?</div>;
  }
  const red = card.suit === '♥️' || card.suit === '♦️';
  return (
    <div className={`w-12 h-16 rounded-lg bg-zinc-100 border border-zinc-300 flex flex-col items-center justify-center font-bold ${red ? 'text-red-600' : 'text-zinc-900'}`}>
      <span className="text-sm leading-none">{card.value}</span>
      <span className="text-base leading-none mt-1">{card.suit.replace('️', '')}</span>
    </div>
  );
}

interface GameStat {
  plays: number; wins: number; losses: number; draws: number;
  total_bet: number; total_payout: number; net_profit: number; max_win: number;
  extra: Record<string, number>;
}

// helpers.create_game_stats_embed と同じ内訳
const STAT_DETAILS: Partial<Record<GameKey, { title: string; rows: [string, string][] }>> = {
  chinchiro: { title: '🎲 役の履歴', rows: [['pinzoro', 'ピンゾロ'], ['arashi', 'アラシ'], ['shigoro', 'シゴロ'], ['normal', '通常出目'], ['hifumi', 'ヒフミ']] },
  slot: { title: '🎰 当選履歴', rows: [['slot_7', '7️⃣7️⃣7️⃣'], ['slot_star', '⭐⭐⭐'], ['slot_three', '絵柄3つ揃い'], ['slot_two', '絵柄2つ揃い']] },
  blackjack: { title: '🃏 詳細履歴', rows: [['bj_win', 'ブラックジャック勝利'], ['normal_win', '通常勝利'], ['bust', 'バスト']] },
  roulette: { title: '🎡 当選履歴', rows: [['win_36x', '数字1点的中'], ['win_3x', 'ダズン的中'], ['win_2x', '赤黒/偶奇等的中']] },
  horse: { title: '🏇 的中履歴', rows: [['tan_win', '単勝的中 (1着)'], ['fuku_win', '複勝的中 (1〜3着)']] },
};

function StatsCard({ game, label, stat, cur }: { game: GameKey; label: string; stat: GameStat; cur: string }) {
  const decisive = stat.wins + stat.losses;
  const rate = decisive > 0 ? ((stat.wins / decisive) * 100).toFixed(1) : '0.0';
  const profitColor = stat.net_profit > 0 ? 'text-amber-300' : stat.net_profit < 0 ? 'text-red-400' : 'text-zinc-200';
  const detail = STAT_DETAILS[game];
  const cell = (name: string, value: React.ReactNode, cls = '') => (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2">
      <div className="text-[11px] text-zinc-500">{name}</div>
      <div className={`font-bold text-sm ${cls}`}>{value}</div>
    </div>
  );
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-3">
      <div className="text-sm text-zinc-400">📊 {GAME_ICON[game]} {label} の戦績</div>
      <div className="grid grid-cols-3 gap-2">
        {cell('🎮 プレイ回数', `${fmt(stat.plays)} 回`)}
        {cell('🏆 勝敗', `${fmt(stat.wins)}勝 ${fmt(stat.losses)}敗${stat.draws > 0 ? ` ${fmt(stat.draws)}分` : ''}`)}
        {cell('📈 勝率', `${rate}%`)}
        {cell('💰 総ベット額', fmt(stat.total_bet))}
        {cell('🎁 総獲得額', fmt(stat.total_payout))}
        {cell('🌟 最高獲得額', fmt(stat.max_win))}
      </div>
      <div className="bg-zinc-800/50 rounded-lg px-3 py-2 flex items-baseline justify-between">
        <span className="text-xs text-zinc-500">純損益</span>
        <span className={`font-bold ${profitColor}`}>
          {stat.net_profit > 0 ? '+' : ''}{fmt(stat.net_profit)} <span className="text-xs font-normal text-zinc-500">{cur}</span>
        </span>
      </div>
      {detail && (
        <div>
          <div className="text-xs text-zinc-500 mb-1">{detail.title}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
            {detail.rows.map(([key, name]) => (
              <div key={key} className="flex justify-between">
                <span className="text-zinc-400">{name}</span>
                <span>{fmt(Number(stat.extra?.[key]) || 0)} 回</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-zinc-600">Discordのパネルで遊んだ分も含みます</p>
    </div>
  );
}

export default function Casino({
  guildId,
  info,
  onPlayed,
}: {
  guildId: string;
  info: CasinoInfo;
  onPlayed: (next: { balance: number; plays_today?: number; bet_delta?: number }) => void;
}) {
  const [game, setGame] = useState<GameKey>(info.active_blackjack ? 'blackjack' : info.games[0].key);
  const [betText, setBetText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // ゲームごとの表示状態
  const [coin, setCoin] = useState<{ side: string; spinning: boolean } | null>(null);
  const [reels, setReels] = useState<string[]>(['🍒', '🍋', '🔔']);
  const [rouletteType, setRouletteType] = useState<string>('red');
  const [rouletteNumber, setRouletteNumber] = useState('7');
  const [rouletteShown, setRouletteShown] = useState<number | null>(null);
  const [bj, setBj] = useState<BjView | null>(info.active_blackjack);
  const [chin, setChin] = useState<any>(null);
  const [chinShown, setChinShown] = useState({ player: 0, npc: 0 });
  const [horseNum, setHorseNum] = useState(1);
  const [horseType, setHorseType] = useState<'tan' | 'fuku'>('tan');
  const [race, setRace] = useState<{ frame: any; track: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // 戦績（遊ぶたびに取り直す）。ギャンブル設定で戦績表示がOFFのゲームは返ってこない
  const [stats, setStats] = useState<Partial<Record<GameKey, GameStat>>>({});
  const [statsKey, setStatsKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/casino/stats`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setStats(data.stats ?? {});
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [guildId, statsKey]);

  const cur = info.currency_name;
  const { balance, plays_today, bet_today } = info.status;
  const { max_bet, max_plays, daily_limit, tax_rate } = info.limits;
  const bet = Number(betText);
  const maxAllowed = Math.min(max_bet, balance, daily_limit > 0 ? Math.max(0, daily_limit - bet_today) : Infinity);
  const betValid = Number.isInteger(bet) && bet >= 1 && bet <= maxAllowed;
  const playsLeft = max_plays > 0 ? Math.max(0, max_plays - plays_today) : null;
  const canPlay = betValid && playsLeft !== 0;
  const taxNote = (tax: number | undefined) => (tax ? `\n※ カジノ手数料 ${(tax_rate * 100).toFixed(1)}% として ${fmt(tax)} ${cur} が引かれました` : '');

  const switchGame = (g: GameKey) => {
    if (busy || (bj && !bj.finished)) return;
    setGame(g);
    setOutcome(null);
  };

  /** POST して結果を返す。エラーはトーストで出して null */
  const post = async (path: GameKey, body: object): Promise<any | null> => {
    const res = await memberFetch(`/api/member/guilds/${guildId}/casino/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast.error(data.error || 'ゲームを開始できませんでした');
      return null;
    }
    return data;
  };

  const played = (data: any, betAmount: number) => {
    onPlayed({ balance: data.balance, plays_today: data.playNumber, bet_delta: betAmount });
    setStatsKey((k) => k + 1);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setOutcome(null);
    try {
      await fn();
    } catch {
      toast.error('サーバーに接続できませんでした');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // ---------- 各ゲーム ----------

  const playCoinflip = (choice: 'heads' | 'tails') =>
    run(async () => {
      setCoin({ side: '', spinning: true });
      const [data] = await Promise.all([post('coinflip', { bet, choice }), sleep(900)]);
      if (!data) return setCoin(null);
      setCoin({ side: data.result === 'heads' ? '表' : '裏', spinning: false });
      played(data, data.bet);
      setOutcome(
        data.win
          ? { tone: 'win', title: `🏆 当たり！ +${fmt(data.payout)} ${cur}`, detail: `結果: ${data.result === 'heads' ? '表' : '裏'}${taxNote(data.tax)}` }
          : { tone: 'lose', title: `💀 外れ… ${fmt(data.bet)} ${cur} 没収`, detail: `結果: ${data.result === 'heads' ? '表' : '裏'}` }
      );
    });

  const playSlot = () =>
    run(async () => {
      const symbols = ['🍒', '🍋', '🍉', '🔔', '⭐', '7️⃣', '💎', '🍀'];
      let spinning = true;
      const spin = (async () => {
        while (spinning && alive.current) {
          setReels([0, 1, 2].map(() => symbols[Math.floor(Math.random() * symbols.length)]));
          await sleep(80);
        }
      })();
      const [data] = await Promise.all([post('slot', { bet }), sleep(1200)]);
      spinning = false;
      await spin;
      if (!data) return;
      setReels(data.reels);
      played(data, data.bet);
      setOutcome(
        data.win
          ? { tone: 'win', title: `🏆 当たり！ +${fmt(data.payout)} ${cur}`, detail: `倍率 ${data.mul}倍${taxNote(data.tax)}` }
          : { tone: 'lose', title: `💀 ハズレ… ${fmt(data.bet)} ${cur} 没収`, detail: '' }
      );
    });

  const playRoulette = () =>
    run(async () => {
      const body: any = { bet, bet_type: rouletteType };
      if (rouletteType === 'number') body.number = Number(rouletteNumber);
      let spinning = true;
      const spin = (async () => {
        while (spinning && alive.current) {
          setRouletteShown(Math.floor(Math.random() * 37));
          await sleep(90);
        }
      })();
      const [data] = await Promise.all([post('roulette', body), sleep(1800)]);
      spinning = false;
      await spin;
      if (!data) return setRouletteShown(null);
      setRouletteShown(data.number);
      played(data, data.bet);
      setOutcome(
        data.win
          ? { tone: 'win', title: `🏆 的中！ +${fmt(data.payout)} ${cur}`, detail: `倍率 ${data.mul}倍${taxNote(data.tax)}` }
          : { tone: 'lose', title: `💀 ハズレ… ${fmt(data.bet)} ${cur} 没収`, detail: '' }
      );
    });

  const bjResult = (data: any) => {
    const map: Record<string, Outcome> = {
      bj: { tone: 'win', title: `🃏 ブラックジャック！ +${fmt(data.payout)} ${cur}`, detail: taxNote(data.tax).trim() },
      push: { tone: 'draw', title: '🤝 引き分け（双方ブラックジャック）', detail: `${fmt(data.bet)} ${cur} が戻りました` },
      bust: { tone: 'lose', title: '💀 バスト！', detail: `手札が21を超えました。${fmt(data.bet)} ${cur} 没収` },
      win: { tone: 'win', title: `🏆 勝ち！ +${fmt(data.payout)} ${cur}`, detail: `ディーラーを上回りました${taxNote(data.tax)}` },
      dealer_bust: { tone: 'win', title: `🏆 勝ち！ +${fmt(data.payout)} ${cur}`, detail: `ディーラーがバストしました${taxNote(data.tax)}` },
      lose: { tone: 'lose', title: '💀 負け…', detail: `${fmt(data.bet)} ${cur} 没収` },
      draw: { tone: 'draw', title: '🤝 引き分け', detail: `${fmt(data.bet)} ${cur} が戻りました` },
    };
    setOutcome(map[data.outcome] ?? null);
  };

  const bjAction = (action: 'start' | 'hit' | 'stand') =>
    run(async () => {
      const data = await post('blackjack', action === 'start' ? { action, bet } : { action, id: bj?.id });
      if (!data) {
        if (action !== 'start') setBj(null);
        return;
      }
      setBj(data);
      if (action === 'start' && !data.resumed) played(data, data.bet);
      else onPlayed({ balance: data.balance });
      if (data.resumed) toast('進行中のゲームの続きです');
      if (data.finished) {
        bjResult(data);
        setStatsKey((k) => k + 1);
      }
    });

  const playChinchiro = () =>
    run(async () => {
      const data = await post('chinchiro', { bet });
      if (!data) return;
      setChin(data);
      setChinShown({ player: 0, npc: 0 });
    });

  /** プレイヤーの出目を1回ずつ見せる。役が決まったらBotの番を自動で見せて結果を出す */
  const rollChinchiro = async () => {
    if (!chin || busy) return;
    setBusy(true);
    await sleep(500);
    const shown = chinShown.player + 1;
    setChinShown({ player: shown, npc: 0 });
    if (shown >= chin.player.length) {
      for (let i = 1; i <= chin.npc.length; i++) {
        await sleep(900);
        if (!alive.current) return;
        setChinShown({ player: shown, npc: i });
      }
      await sleep(400);
      played(chin, chin.bet);
      const vs = `あなた: ${chin.playerHand.name} ／ Bot: ${chin.npcHand.name}`;
      setOutcome(
        chin.status === 'player_win'
          ? { tone: 'win', title: `🏆 勝ち！ +${fmt(chin.winAmount)} ${cur}`, detail: `${vs}${taxNote(chin.tax)}` }
          : chin.status === 'draw'
            ? { tone: 'draw', title: '🤝 引き分け', detail: `${vs}\n${fmt(chin.bet)} ${cur} が戻りました` }
            : { tone: 'lose', title: `💀 負け… ${fmt(chin.loss)} ${cur} 没収`, detail: vs }
      );
    }
    if (alive.current) setBusy(false);
  };
  const chinDone = chin && chinShown.player >= chin.player.length && chinShown.npc >= chin.npc.length;

  const playHorse = () =>
    run(async () => {
      const data = await post('horse', { bet, horse: horseNum, bet_type: horseType });
      if (!data) return;
      for (const frame of data.frames) {
        if (!alive.current) return;
        setRace({ frame, track: data.track });
        await sleep(1300);
      }
      played(data, data.bet);
      const h = info.horses.find((x) => x.num === horseNum)!;
      setOutcome(
        data.win
          ? { tone: 'win', title: `🎉 的中！ +${fmt(data.payout)} ${cur}`, detail: `${h.name} は ${data.rank}着（倍率 ${data.mul}倍）${taxNote(data.tax)}` }
          : { tone: 'lose', title: `💀 不的中… ${fmt(data.bet)} ${cur} 没収`, detail: `${h.name} は ${data.rank}着でした` }
      );
    });

  // ---------- 画面 ----------

  const inGame = (bj && !bj.finished && game === 'blackjack') || (chin && !chinDone && game === 'chinchiro');
  const m = info.multipliers;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xs text-zinc-500">残高</div>
          <div className="font-bold">{fmt(balance)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">今日のプレイ</div>
          <div className="font-bold">{plays_today}{max_plays > 0 ? ` / ${max_plays}` : ''}回</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">今日の賭け金</div>
          <div className="font-bold">{fmt(bet_today)}{daily_limit > 0 ? ` / ${fmt(daily_limit)}` : ''}</div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {info.games.map((g) => (
          <button
            key={g.key}
            onClick={() => switchGame(g.key)}
            className={`flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${
              game === g.key ? 'bg-red-600/20 border-red-700/60 text-white' : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {GAME_ICON[g.key]} {g.label}
          </button>
        ))}
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        {!inGame && (
          <div>
            <label className="block text-sm text-zinc-400 mb-2">賭け金（1〜{fmt(max_bet)}）</label>
            <div className="flex items-center gap-2">
              <input
                value={betText}
                onChange={(e) => setBetText(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="0"
                className="flex-1 min-w-0 px-3 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50"
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
            {playsLeft === 0 && <p className="text-xs text-red-400 mt-1.5">本日のプレイ上限に達しました</p>}
          </div>
        )}

        {game === 'coinflip' && (
          <>
            <div className="flex justify-center py-2">
              <div
                className={`w-24 h-24 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 border-4 border-amber-200 flex items-center justify-center text-3xl font-black text-amber-900 ${coin?.spinning ? 'animate-spin' : ''}`}
              >
                {coin?.spinning ? '' : coin?.side || '?'}
              </div>
            </div>
            <p className="text-xs text-zinc-500 text-center">当たると賭け金の {m.coinflip}倍</p>
            <div className="grid grid-cols-2 gap-2">
              <PlayButton busy={busy} disabled={!canPlay} onClick={() => playCoinflip('heads')}>⚪ 表</PlayButton>
              <PlayButton busy={busy} disabled={!canPlay} onClick={() => playCoinflip('tails')}>⚫ 裏</PlayButton>
            </div>
          </>
        )}

        {game === 'slot' && (
          <>
            <div className="flex justify-center gap-2 py-2">
              {reels.map((r, i) => (
                <div key={i} className="w-20 h-20 rounded-xl bg-zinc-950 border border-zinc-700 flex items-center justify-center text-4xl">{r}</div>
              ))}
            </div>
            <p className="text-xs text-zinc-500 text-center">
              7️⃣そろい {m.slot.seven}倍 ／ ⭐そろい {m.slot.star}倍 ／ 3つそろい {m.slot.three}倍 ／ 2つそろい {m.slot.two}倍
            </p>
            <PlayButton busy={busy} disabled={!canPlay} onClick={playSlot}>🎰 スピン</PlayButton>
          </>
        )}

        {game === 'roulette' && (
          <>
            <div className="flex justify-center py-2">
              <div
                className={`w-24 h-24 rounded-full border-4 border-amber-600 flex items-center justify-center text-3xl font-black ${
                  rouletteShown === null ? 'bg-zinc-800' : rouletteShown === 0 ? 'bg-emerald-700' : RED.has(rouletteShown) ? 'bg-red-700' : 'bg-zinc-950'
                }`}
              >
                {rouletteShown ?? '?'}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['red', '🔴 赤', m.roulette.two], ['black', '⚫ 黒', m.roulette.two], ['even', '偶数', m.roulette.two],
                ['odd', '奇数', m.roulette.two], ['low', '1-18', m.roulette.two], ['high', '19-36', m.roulette.two],
                ['dozen1', '1-12', m.roulette.three], ['dozen2', '13-24', m.roulette.three], ['dozen3', '25-36', m.roulette.three],
              ].map(([key, label, mul]) => (
                <button
                  key={key as string}
                  onClick={() => setRouletteType(key as string)}
                  className={`py-2 rounded-lg text-sm border ${rouletteType === key ? 'bg-red-600/30 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
                >
                  {label} <span className="text-xs opacity-70">×{mul}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRouletteType('number')}
                className={`flex-1 py-2 rounded-lg text-sm border ${rouletteType === 'number' ? 'bg-red-600/30 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
              >
                🎯 数字1点賭け <span className="text-xs opacity-70">×{m.roulette.number}</span>
              </button>
              <select
                value={rouletteNumber}
                onChange={(e) => { setRouletteNumber(e.target.value); setRouletteType('number'); }}
                className="w-20 py-2 px-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm"
              >
                {Array.from({ length: 37 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <PlayButton busy={busy} disabled={!canPlay} onClick={playRoulette}>🎡 スピン</PlayButton>
          </>
        )}

        {game === 'blackjack' && (
          <>
            {bj ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-zinc-500 mb-1.5">🤖 ディーラー（{bj.dealer_score}{bj.finished ? '' : ' + ?'}）</div>
                  <div className="flex gap-1.5 flex-wrap">{bj.dealer.map((c, i) => <CardView key={i} card={c} />)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1.5">👤 あなた（{bj.player_score}）・賭け金 {fmt(bj.bet)} {cur}</div>
                  <div className="flex gap-1.5 flex-wrap">{bj.player.map((c, i) => <CardView key={i} card={c} />)}</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center">
                勝つと {m.blackjack.normal}倍・ブラックジャックなら {m.blackjack.bj}倍
              </p>
            )}
            {bj && !bj.finished ? (
              <div className="grid grid-cols-2 gap-2">
                <PlayButton busy={busy} onClick={() => bjAction('hit')}>🃏 カードを引く</PlayButton>
                <PlayButton busy={busy} onClick={() => bjAction('stand')}>🛑 勝負する</PlayButton>
              </div>
            ) : (
              <PlayButton busy={busy} disabled={!canPlay} onClick={() => { setBj(null); bjAction('start'); }}>🃏 カードを配る</PlayButton>
            )}
          </>
        )}

        {game === 'chinchiro' && (
          <>
            {chin && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">👤 あなた</div>
                  {chin.player.slice(0, chinShown.player).map((r: any, i: number) => (
                    <div key={i} className="font-mono">🎲 {r.dice.join(' ')} <span className="text-zinc-400">{r.name}</span></div>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">🤖 Bot</div>
                  {chin.npc.length === 0 && chinShown.player >= chin.player.length && <div className="text-zinc-500">出番なし</div>}
                  {chin.npc.slice(0, chinShown.npc).map((r: any, i: number) => (
                    <div key={i} className="font-mono">🎲 {r.dice.join(' ')} <span className="text-zinc-400">{r.name}</span></div>
                  ))}
                </div>
              </div>
            )}
            {chin && !chinDone ? (
              <PlayButton busy={busy} disabled={chinShown.player >= chin.player.length} onClick={rollChinchiro}>
                🎲 サイコロを振る（残り{3 - chinShown.player}回）
              </PlayButton>
            ) : (
              <PlayButton busy={busy} disabled={!canPlay} onClick={playChinchiro}>🎲 チンチロリンを始める</PlayButton>
            )}
            {!chin && <p className="text-xs text-zinc-500 text-center">役の強さでBotと勝負。ヒフミは負けると損失が増えます</p>}
          </>
        )}

        {game === 'horse' && (
          <>
            {race ? (
              <div className="space-y-1.5">
                <div className="text-sm font-semibold">{race.frame.phase}</div>
                {info.horses.map((h) => {
                  const p = race.frame.positions[h.num] ?? 0;
                  return (
                    <div key={h.num} className="flex items-center gap-2 text-xs">
                      <span className="w-5">{h.emoji}</span>
                      <div className="flex-1 h-5 bg-zinc-800 rounded-full relative overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${h.num === horseNum ? 'bg-red-600' : 'bg-zinc-600'}`}
                          style={{ width: `${(p / race.track) * 100}%` }}
                        />
                      </div>
                      <span className="w-4">{p >= race.track ? '🏆' : '🏇'}</span>
                    </div>
                  );
                })}
                <div className="text-xs text-zinc-400 italic">📢 {race.frame.commentary}</div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-1.5">
              {info.horses.map((h) => (
                <button
                  key={h.num}
                  disabled={busy}
                  onClick={() => setHorseNum(h.num)}
                  className={`text-left px-3 py-2 rounded-lg text-sm border ${horseNum === h.num ? 'bg-red-600/30 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
                >
                  {h.emoji} {h.num}号馬 {h.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['tan', 'fuku'] as const).map((t) => (
                <button
                  key={t}
                  disabled={busy}
                  onClick={() => setHorseType(t)}
                  className={`py-2 rounded-lg text-sm border ${horseType === t ? 'bg-red-600/30 border-red-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}
                >
                  {t === 'tan' ? `🥇 単勝（1着）×${m.horse.tan}` : `🥉 複勝（3着以内）×${m.horse.fuku}`}
                </button>
              ))}
            </div>
            <PlayButton busy={busy} disabled={!canPlay} onClick={playHorse}>🏇 レース開始</PlayButton>
          </>
        )}

        <ResultBox outcome={outcome} />
      </div>

      {stats[game] && (
        <StatsCard game={game} label={info.games.find((g) => g.key === game)?.label ?? ''} stat={stats[game]!} cur={cur} />
      )}
    </div>
  );
}
