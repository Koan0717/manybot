'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { memberFetch } from '@/lib/memberClient';

interface RoleTag { id: string; name: string; color: string | null }
type Rarity = 'SSR' | 'SR' | 'R' | 'N';

/** GET /api/member/guilds/[guild_id]/gacha の中身（enabled: true のとき） */
export interface GachaInfo {
  enabled: true;
  currency_name: string;
  is_open: boolean;
  pull_cost: number;
  can_pull: boolean;
  allowed_roles: RoleTag[];
  prizes: {
    prize_number: number;
    prize_name: string;
    rarity: Rarity;
    reward_coins: number;
    reward_role: RoleTag | null;
    reward_role_duration_days: number;
  }[];
  history: { prize_number: number; prize_name: string; at: string }[];
}

interface PullData {
  prize: { prize_number: number; prize_name: string; reward_coins: number };
  rarity: Rarity;
  cost: number;
  balance: number;
  role: { name: string; color: string | null; expires_text: string | null; duration_days: number } | null;
  role_failed: string | null;
}

const fmt = (n: number) => n.toLocaleString('ja-JP');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// レア度ごとのカプセルの色・表示
const RARITY: Record<Rarity, { top: string; glow: string; label: string; stars: number; text: string }> = {
  SSR: { top: 'linear-gradient(135deg, #fde047, #f59e0b 45%, #fbbf24 60%, #f97316)', glow: '#fbbf24', label: 'SSR', stars: 4, text: 'text-amber-300' },
  SR: { top: 'linear-gradient(135deg, #e879f9, #a855f7 55%, #7c3aed)', glow: '#c084fc', label: 'SR', stars: 3, text: 'text-fuchsia-300' },
  R: { top: 'linear-gradient(135deg, #7dd3fc, #3b82f6 55%, #1d4ed8)', glow: '#60a5fa', label: 'R', stars: 2, text: 'text-sky-300' },
  N: { top: 'linear-gradient(135deg, #d1fae5, #34d399 55%, #059669)', glow: '#6ee7b7', label: 'N', stars: 1, text: 'text-emerald-300' },
};

// ドームの中のカプセル（位置・色は固定。回すと揺れる）
const DOME_CAPSULES = [
  [78, 120, '#ef4444'], [104, 132, '#3b82f6'], [132, 128, '#f59e0b'], [160, 122, '#22c55e'], [90, 96, '#a855f7'],
  [118, 104, '#ec4899'], [146, 98, '#06b6d4'], [66, 94, '#eab308'], [172, 96, '#ef4444'], [102, 72, '#22c55e'],
  [132, 74, '#3b82f6'], [158, 70, '#f97316'], [80, 68, '#06b6d4'], [118, 50, '#a855f7'], [146, 46, '#ec4899'],
] as const;

type Phase = 'idle' | 'turning' | 'drop' | 'ready' | 'open' | 'result';

function Capsule({ rarity, size = 64 }: { rarity: Rarity; size?: number }) {
  const r = RARITY[rarity];
  return (
    <div className="relative rounded-full overflow-hidden shadow-[0_6px_14px_rgba(0,0,0,0.5)]" style={{ width: size, height: size }}>
      <div className="absolute inset-x-0 top-0 h-1/2" style={{ background: r.top }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-zinc-100 to-zinc-300" />
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-zinc-500/70" />
      <div className="absolute left-[18%] top-[12%] w-[28%] h-[18%] rounded-full bg-white/60 blur-[1px]" />
    </div>
  );
}

function Machine({ phase, turns }: { phase: Phase; turns: number }) {
  const shaking = phase === 'turning';
  return (
    <svg viewBox="0 0 240 330" className="w-full h-auto drop-shadow-2xl" aria-hidden>
      <defs>
        <radialGradient id="gc-glass" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#e0f2fe" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
        </radialGradient>
        <linearGradient id="gc-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b91c1c" />
          <stop offset="45%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id="gc-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f4f5" />
          <stop offset="100%" stopColor="#a1a1aa" />
        </linearGradient>
        <clipPath id="gc-dome-clip">
          <circle cx="120" cy="92" r="84" />
        </clipPath>
      </defs>

      {/* ドーム（ガラス）と中のカプセル */}
      <circle cx="120" cy="92" r="86" fill="#0c4a6e" fillOpacity="0.25" stroke="#e4e4e7" strokeWidth="4" />
      <g clipPath="url(#gc-dome-clip)">
        {DOME_CAPSULES.map(([x, y, c], i) => (
          <g
            key={i}
            style={{
              transformBox: 'fill-box',
              transformOrigin: 'center',
              animation: shaking ? `gc-jiggle-${i % 3} ${0.28 + (i % 4) * 0.05}s ease-in-out ${(i % 5) * 0.04}s infinite` : undefined,
            }}
          >
            <circle cx={x} cy={y + 30} r="15" fill="#f4f4f5" />
            <path d={`M ${x - 15} ${y + 30} a 15 15 0 0 1 30 0 z`} fill={c} />
            <line x1={x - 15} y1={y + 30} x2={x + 15} y2={y + 30} stroke="#71717a" strokeWidth="1.5" />
            <circle cx={x - 5} cy={y + 23} r="3.5" fill="#fff" fillOpacity="0.6" />
          </g>
        ))}
      </g>
      <circle cx="120" cy="92" r="84" fill="url(#gc-glass)" />
      <path d="M 62 50 A 70 70 0 0 1 108 24" stroke="#fff" strokeOpacity="0.7" strokeWidth="6" strokeLinecap="round" fill="none" />

      {/* 首の部分 */}
      <rect x="54" y="168" width="132" height="16" rx="4" fill="url(#gc-metal)" />

      {/* 本体 */}
      <rect x="40" y="182" width="160" height="140" rx="18" fill="url(#gc-body)" stroke="#7f1d1d" strokeWidth="2" />
      <rect x="62" y="192" width="116" height="24" rx="6" fill="#fef3c7" stroke="#b45309" strokeWidth="1.5" />
      <text x="120" y="209" textAnchor="middle" fontSize="14" fontWeight="900" fill="#b91c1c" letterSpacing="3">GACHA</text>

      {/* コイン投入口 */}
      <rect x="160" y="228" width="22" height="30" rx="4" fill="url(#gc-metal)" />
      <rect x="169" y="233" width="4" height="20" rx="2" fill="#27272a" />

      {/* ハンドル（回すと2回転する） */}
      <g style={{ transformBox: 'view-box', transformOrigin: '110px 250px', transform: `rotate(${turns * 360}deg)`, transition: 'transform 1.6s cubic-bezier(0.45, 0, 0.3, 1)' }}>
        <circle cx="110" cy="250" r="26" fill="url(#gc-metal)" stroke="#71717a" strokeWidth="2" />
        <rect x="82" y="244" width="56" height="12" rx="6" fill="#fafafa" stroke="#71717a" strokeWidth="1.5" />
        <circle cx="110" cy="250" r="6" fill="#71717a" />
      </g>

      {/* 取り出し口 */}
      <rect x="66" y="284" width="88" height="30" rx="10" fill="#18181b" stroke="#52525b" strokeWidth="3" />
      <rect x="72" y="288" width="76" height="8" rx="4" fill="#3f3f46" />
    </svg>
  );
}

export default function Gacha({
  guildId,
  info,
  balance,
  onPulled,
}: {
  guildId: string;
  info: GachaInfo;
  balance: number;
  onPulled: (balance: number, entry: GachaInfo['history'][number]) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState(0);
  const [data, setData] = useState<PullData | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const cur = info.currency_name;

  const reason = !info.is_open
    ? '現在、福引ガチャは無効になっています'
    : !info.prizes.length
      ? '景品が設定されていません'
      : !info.can_pull
        ? '対象のロールを持っていないため引けません'
        : balance < info.pull_cost
          ? `所持${cur}が足りません`
          : null;
  const busy = phase === 'turning' || phase === 'drop' || phase === 'open';

  const spin = async () => {
    if (busy || reason) return;
    setData(null);
    setPhase('turning');
    setTurns((t) => t + 2);
    let res: PullData | null = null;
    try {
      const [r] = await Promise.all([
        memberFetch(`/api/member/guilds/${guildId}/gacha`, { method: 'POST' }).then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => ({})) })),
        sleep(1700),
      ]);
      if (!r.ok || !r.body.success) {
        toast.error(r.body.error || 'ガチャを引けませんでした');
      } else res = r.body;
    } catch {
      toast.error('サーバーに接続できませんでした');
    }
    if (!alive.current) return;
    if (!res) {
      setPhase('idle');
      return;
    }
    setData(res);
    setPhase('drop');
    await sleep(1100);
    if (alive.current) setPhase('ready');
  };

  const open = async () => {
    if (phase !== 'ready' || !data) return;
    setPhase('open');
    await sleep(950);
    if (!alive.current) return;
    setPhase('result');
    onPulled(data.balance, {
      prize_number: data.prize.prize_number,
      prize_name: data.prize.prize_name,
      at: new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }),
    });
  };

  const rar = data ? RARITY[data.rarity] : null;
  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 1.6 + Math.random() * 1.2,
        color: ['#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#c084fc', '#f87171'][i % 6],
        rot: Math.random() * 360,
      })),
    [data]
  );

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes gc-jiggle-0 { 0%,100% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(3px,-6px) rotate(25deg); } }
        @keyframes gc-jiggle-1 { 0%,100% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(-4px,-4px) rotate(-30deg); } }
        @keyframes gc-jiggle-2 { 0%,100% { transform: translate(0,0) rotate(0deg); } 50% { transform: translate(2px,-8px) rotate(15deg); } }
        @keyframes gc-drop { 0% { transform: translate(-10px,-60px) scale(0.5); opacity: 0; } 25% { opacity: 1; } 55% { transform: translate(0,0) scale(1); } 70% { transform: translate(8px,-22px) rotate(90deg); } 85% { transform: translate(14px,0) rotate(160deg); } 93% { transform: translate(17px,-6px) rotate(190deg); } 100% { transform: translate(18px,0) rotate(200deg); } }
        @keyframes gc-wobble { 0%,100% { transform: translateX(18px) rotate(200deg); } 25% { transform: translateX(18px) rotate(188deg); } 75% { transform: translateX(18px) rotate(212deg); } }
        @keyframes gc-top { to { transform: translate(-30px,-70px) rotate(-70deg); opacity: 0; } }
        @keyframes gc-bottom { to { transform: translate(30px,50px) rotate(50deg); opacity: 0; } }
        @keyframes gc-flash { 0% { opacity: 0; transform: scale(0.2); } 40% { opacity: 1; } 100% { opacity: 0; transform: scale(3); } }
        @keyframes gc-rays { to { transform: rotate(360deg); } }
        @keyframes gc-pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes gc-confetti { 0% { transform: translateY(-10px) rotate(0deg); opacity: 1; } 100% { transform: translateY(420px) rotate(600deg); opacity: 0.3; } }
        @keyframes gc-hint { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-sm text-zinc-500">所持金</div>
          <div className="text-3xl font-bold mt-1">
            {fmt(balance)} <span className="text-base font-normal text-zinc-400">{cur}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">1回</div>
          <div className="font-bold text-amber-300">{info.pull_cost > 0 ? `${fmt(info.pull_cost)} ${cur}` : '無料'}</div>
        </div>
      </div>

      <div className="relative bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-5 overflow-hidden">
        {/* ガチャマシンと出てくるカプセル */}
        <div className="relative mx-auto w-[240px] max-w-full mb-12">
          <Machine phase={phase} turns={turns} />
          {data && rar && (phase === 'drop' || phase === 'ready' || phase === 'open') && (
            <button
              type="button"
              onClick={open}
              disabled={phase !== 'ready'}
              aria-label="カプセルを開ける"
              className="absolute left-[34%] bottom-[-52px] z-10"
              style={{
                animation: phase === 'drop' ? 'gc-drop 1.1s cubic-bezier(0.3, 0.6, 0.4, 1) forwards' : phase === 'ready' ? 'gc-wobble 0.9s ease-in-out infinite' : undefined,
                transform: phase === 'open' ? 'translateX(18px)' : undefined,
                filter: data.rarity === 'SSR' || data.rarity === 'SR' ? `drop-shadow(0 0 14px ${rar.glow})` : undefined,
              }}
            >
              {phase === 'open' ? (
                <div className="relative w-16 h-16">
                  <div className="absolute inset-x-0 top-0 h-8 overflow-hidden" style={{ animation: 'gc-top 0.7s ease-out forwards' }}>
                    <Capsule rarity={data.rarity} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-8 overflow-hidden" style={{ animation: 'gc-bottom 0.7s ease-out forwards' }}>
                    <div className="-mt-8"><Capsule rarity={data.rarity} /></div>
                  </div>
                  <div className="absolute inset-[-40px] rounded-full" style={{ background: `radial-gradient(circle, #fff, ${rar.glow} 40%, transparent 70%)`, animation: 'gc-flash 0.9s ease-out forwards' }} />
                </div>
              ) : (
                <Capsule rarity={data.rarity} />
              )}
            </button>
          )}
        </div>
        <div className="h-8 mt-3 text-center text-sm">
          {phase === 'turning' && <span className="text-zinc-300">ガチャガチャ…</span>}
          {phase === 'ready' && (
            <span className="font-bold text-amber-200" style={{ animation: 'gc-hint 1s ease-in-out infinite' }}>
              👆 カプセルをタップして開けよう！
            </span>
          )}
        </div>

        {/* 結果 */}
        {phase === 'result' && data && rar && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 p-4">
            {(data.rarity === 'SSR' || data.rarity === 'SR') && (
              <>
                <div
                  className="absolute left-1/2 top-1/2 w-[640px] h-[640px] -ml-[320px] -mt-[320px] opacity-40 pointer-events-none"
                  style={{
                    background: `repeating-conic-gradient(${rar.glow} 0 8deg, transparent 8deg 24deg)`,
                    maskImage: 'radial-gradient(circle, black 20%, transparent 60%)',
                    WebkitMaskImage: 'radial-gradient(circle, black 20%, transparent 60%)',
                    animation: 'gc-rays 12s linear infinite',
                  }}
                />
                {confetti.map((c, i) => (
                  <span
                    key={i}
                    className="absolute top-0 w-2 h-1 pointer-events-none"
                    style={{ left: `${c.left}%`, backgroundColor: c.color, transform: `rotate(${c.rot}deg)`, animation: `gc-confetti ${c.dur}s linear ${c.delay}s infinite` }}
                  />
                ))}
              </>
            )}
            <div
              className="relative w-full max-w-xs bg-zinc-900 border-2 rounded-2xl p-5 text-center space-y-2"
              style={{ borderColor: rar.glow, boxShadow: `0 0 30px ${rar.glow}66`, animation: 'gc-pop 0.45s ease-out' }}
            >
              <div className={`text-2xl font-black tracking-widest ${rar.text}`}>{rar.label}</div>
              <div className="text-amber-300 text-sm">{'★'.repeat(rar.stars)}<span className="text-zinc-700">{'★'.repeat(4 - rar.stars)}</span></div>
              <div className="text-xs text-zinc-400">{data.prize.prize_number}番</div>
              <div className="text-xl font-bold break-words">{data.prize.prize_name}</div>
              <div className="text-sm space-y-1 pt-1">
                {data.prize.reward_coins > 0 && <div>💰 <b>{fmt(data.prize.reward_coins)}</b> {cur} 獲得！</div>}
                {data.role && (
                  <div>
                    🎗️ <b style={{ color: data.role.color ?? undefined }}>{data.role.name}</b> ロール
                    <div className="text-xs text-zinc-400">{data.role.expires_text ? `期限: ${data.role.expires_text}まで（${data.role.duration_days}日間）` : '無期限'}</div>
                  </div>
                )}
                {data.role_failed && <div className="text-xs text-red-300">ロール「{data.role_failed}」の付与に失敗しました。管理者に連絡してください。</div>}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setPhase('idle')}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm font-semibold"
                >
                  閉じる
                </button>
                <button
                  onClick={() => { setPhase('idle'); setTimeout(spin, 0); }}
                  disabled={!!reason}
                  className="flex-1 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
                >
                  もう1回
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={spin}
          disabled={busy || phase === 'ready' || !!reason}
          className="mt-2 w-full py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-bold flex items-center justify-center gap-2"
        >
          {phase === 'turning' && <Loader2 className="w-4 h-4 animate-spin" />}
          🎁 ガチャを回す{info.pull_cost > 0 ? `（${fmt(info.pull_cost)} ${cur}）` : '（無料）'}
        </button>
        {reason && <p className="text-xs text-zinc-500 text-center mt-2">{reason}</p>}
        {!!info.allowed_roles.length && (
          <p className="text-xs text-zinc-500 text-center mt-1">対象: {info.allowed_roles.map((r) => r.name).join('、')}</p>
        )}
      </div>

      {/* 景品一覧 */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
        <div className="font-semibold mb-3">📜 景品一覧</div>
        {info.prizes.length === 0 ? (
          <div className="text-sm text-zinc-500">景品が設定されていません。</div>
        ) : (
          <ul className="space-y-2">
            {info.prizes.map((p) => {
              const r = RARITY[p.rarity];
              return (
                <li key={p.prize_number} className="flex items-center gap-3 text-sm">
                  <Capsule rarity={p.rarity} size={26} />
                  <span className={`w-9 text-xs font-black ${r.text}`}>{r.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold break-words">{p.prize_number}番 {p.prize_name}</div>
                    <div className="text-xs text-zinc-400">
                      {[
                        p.reward_coins ? `${fmt(p.reward_coins)} ${cur}` : null,
                        p.reward_role ? `@${p.reward_role.name}（${p.reward_role_duration_days > 0 ? `${p.reward_role_duration_days}日間` : '無期限'}）` : null,
                      ]
                        .filter(Boolean)
                        .join(' / ') || '報酬なし'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 最近の結果 */}
      {info.history.length > 0 && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
          <div className="font-semibold mb-3">🕘 最近の結果</div>
          <ul className="space-y-1.5 text-sm">
            {info.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="break-words min-w-0">{h.prize_number}番 {h.prize_name}</span>
                <span className="text-xs text-zinc-500 flex-shrink-0">{h.at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
