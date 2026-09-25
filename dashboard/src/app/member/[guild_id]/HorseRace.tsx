'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 競馬のレース中継。着順・途中の位置はサーバーで決まったもの（frames / ranking）を受け取り、
 * そのあいだを滑らかにつないで走らせるだけ（見せ方のみ）。
 * カウントダウン → ゲートオープン → カメラが先頭を追いかける → ゴール → 表彰台 の順に進む。
 */

export interface RaceFrame {
  phase: string;
  commentary: string;
  positions: Record<number, number>;
}
export interface RaceData {
  frames: RaceFrame[];
  ranking: number[];
  track: number;
}
interface Horse { num: number; name: string; emoji: string }

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];
const colorOf = (num: number) => COLORS[(num - 1) % COLORS.length];

const COUNTDOWN_MS = 2400; // 3・2・1
const UNIT_MS = 9500; // 先頭がゴールするまでの時間
const RACE_METERS = 1600;
const DIST = 2.6; // コースの長さ（画面の幅の何倍か）
const LANE = 38;
const CROWD = 34;
const RAIL = 6;
const FRAME_AT = [0.22, 0.46, 0.7, 0.88]; // frames[0..3] の位置になる時刻（先頭のゴール = 1）
const PHASE_AT = [0, 0.3, 0.55, 0.75, 1]; // 実況が切り替わる時刻
const FINISH_GAP = 0.6; // 1馬身ぶんの差がゴールで何秒ずれるか（UNIT 比）

/** 単調な3次補間（Fritsch–Carlson）。スタートは止まった状態から加速する */
function monotoneSpline(xs: number[], ys: number[]) {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = 0;
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) {
      // ゴール後はゆっくり流して止まる
      const tau = 0.08;
      return ys[n - 1] + m[n - 1] * tau * (1 - Math.exp(-(x - xs[n - 1]) / tau));
    }
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

// 少しの揺らぎ（抜きつ抜かれつに見せる）。終盤は0にして着順を崩さない
function wobble(num: number, t: number) {
  if (t <= 0 || t >= 0.85) return 0;
  const env = Math.sin((Math.PI * t) / 0.85);
  return env * 0.012 * (Math.sin(t * 17 + num * 2.1) + 0.6 * Math.sin(t * 29 + num * 4.7));
}

export default function HorseRace({
  horses,
  race,
  myHorse,
  win,
  onFinish,
}: {
  horses: Horse[];
  race: RaceData;
  myHorse: number;
  win: boolean;
  onFinish?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [elapsed, setElapsed] = useState(0);
  const finishedRef = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // 各馬の走り（時刻 t → 0〜1 の位置。1 がゴール）
  const plan = useMemo(() => {
    const T = race.track;
    const last = race.frames[race.frames.length - 1];
    const paths = new Map<number, (t: number) => number>();
    let endT = 1;
    const keys = new Map<number, number[]>();
    for (const h of horses) {
      const ys: number[] = [];
      race.frames.slice(0, FRAME_AT.length).forEach((f) => {
        const prev = ys.length ? ys[ys.length - 1] : 0;
        ys.push(Math.min(0.97, Math.max(prev + 0.02, (f.positions[h.num] ?? 0) / T)));
      });
      keys.set(h.num, ys);
    }
    // 最後の直線に入ったところでは着順どおりに並べておく（ゴール前で順位が入れ替わって見えないように）
    let cap = Infinity;
    for (const num of race.ranking) {
      const ys = keys.get(num);
      if (!ys || !ys.length) continue;
      const i = ys.length - 1;
      ys[i] = Math.max(i > 0 ? ys[i - 1] + 0.005 : 0, Math.min(ys[i], cap - 0.015));
      cap = ys[i];
    }
    for (const h of horses) {
      const finalPos = (last?.positions[h.num] ?? T) / T;
      const finishT = 1 + (1 - Math.min(1, finalPos)) * FINISH_GAP;
      endT = Math.max(endT, finishT);
      const ys = keys.get(h.num)!;
      const xs = [0, ...FRAME_AT.slice(0, ys.length), finishT];
      paths.set(h.num, monotoneSpline(xs, [0, ...ys, 1]));
    }
    return { paths, endT };
  }, [horses, race]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 1.8 + Math.random() * 1.4,
        color: COLORS[i % COLORS.length],
        rot: Math.random() * 360,
        size: 5 + Math.random() * 5,
      })),
    []
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 360);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalMs = COUNTDOWN_MS + (plan.endT + 0.1) * UNIT_MS;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const e = now - start;
      setElapsed(e);
      if (e < totalMs + 1500) raf = requestAnimationFrame(tick);
      else if (!finishedRef.current) {
        finishedRef.current = true;
        onFinishRef.current?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalMs]);

  const t = (elapsed - COUNTDOWN_MS) / UNIT_MS; // 0 でゲートオープン、1 で先頭がゴール
  const W = width;
  const posOf = (num: number, at = t) => {
    if (at <= 0) return 0;
    const p = plan.paths.get(num)?.(at) ?? 0;
    return p + (p < 1 ? wobble(num, at) : 0);
  };
  const positions = horses.map((h) => ({ h, p: posOf(h.num), v: (posOf(h.num, t + 0.01) - posOf(h.num, t - 0.01)) / 0.02 }));
  const standings = [...positions].sort((a, b) => b.p - a.p);
  const leader = standings[0]?.p ?? 0;

  const xOf = (p: number) => W * (0.14 + p * DIST);
  const camMax = xOf(1) - 0.74 * W;
  const camX = Math.max(0, Math.min(camMax, xOf(leader) - 0.6 * W));

  const trackH = LANE * horses.length;
  const top = CROWD + RAIL;
  const height = top + trackH + RAIL;

  const phaseIdx = t < 0 ? -1 : PHASE_AT.reduce((acc, at, i) => (t >= at && race.frames[i] ? i : acc), 0);
  const frame = phaseIdx >= 0 ? race.frames[phaseIdx] : null;
  const showPodium = t >= plan.endT + 0.1;
  const flash = t >= 1 && t < 1.04 ? 1 - (t - 1) / 0.04 : 0;
  const countdown = t < 0 ? Math.ceil(-t * UNIT_MS / (COUNTDOWN_MS / 3)) : 0;
  const finishing = t > 0.75 && t < plan.endT + 0.1;
  const remain = Math.max(0, Math.round(((1 - Math.min(1, leader)) * RACE_METERS) / 10) * 10);
  const myRank = race.ranking.indexOf(myHorse) + 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between h-6">
        <span key={phaseIdx} className="text-sm font-bold text-white" style={{ animation: 'hr-fade 0.3s ease-out' }}>
          {showPodium ? '🏆 レース確定' : frame ? frame.phase : '🎺 発走前'}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-mono font-bold text-amber-300">
          {t <= 0 ? `${RACE_METERS}m` : remain > 0 ? `残り ${remain}m` : 'GOAL!'}
        </span>
      </div>
      <style>{`
        @keyframes hr-confetti { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(330px) rotate(720deg); opacity: 0.2; } }
        @keyframes hr-pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes hr-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @keyframes hr-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-xl border border-zinc-700 select-none"
        style={{ height, background: '#14532d' }}
      >
        {/* 観客席 */}
        <div
          className="absolute left-0 right-0 top-0"
          style={{
            height: CROWD,
            backgroundColor: '#1f2937',
            backgroundImage:
              'radial-gradient(circle at 6px 9px, #f87171 3px, transparent 3.5px), radial-gradient(circle at 18px 15px, #60a5fa 3px, transparent 3.5px), radial-gradient(circle at 30px 8px, #fbbf24 3px, transparent 3.5px), radial-gradient(circle at 12px 24px, #e5e7eb 3px, transparent 3.5px), radial-gradient(circle at 27px 25px, #a78bfa 3px, transparent 3.5px), linear-gradient(#111827, #374151)',
            backgroundSize: '36px 32px, 36px 32px, 36px 32px, 36px 32px, 36px 32px, 100% 100%',
            backgroundPositionX: `${-camX * 0.7}px`,
            transform: finishing ? `translateY(${Math.abs(Math.sin(elapsed / 90)) * -1.5}px)` : undefined,
          }}
        />
        {/* 芝（縞模様） */}
        <div
          className="absolute left-0 right-0"
          style={{
            top,
            height: trackH,
            backgroundImage: 'repeating-linear-gradient(90deg, #15803d 0 70px, #166534 70px 140px)',
            backgroundPositionX: `${-camX}px`,
          }}
        />
        {/* 内ラチ・外ラチ */}
        {[CROWD, top + trackH].map((y) => (
          <div
            key={y}
            className="absolute left-0 right-0"
            style={{
              top: y,
              height: RAIL,
              backgroundColor: '#f4f4f5',
              backgroundImage: 'repeating-linear-gradient(90deg, #a1a1aa 0 3px, transparent 3px 44px)',
              backgroundPositionX: `${-camX}px`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
            }}
          />
        ))}
        {/* 自分の馬のレーン */}
        {horses.map((h, i) =>
          h.num === myHorse ? (
            <div key={h.num} className="absolute left-0 right-0 bg-red-500/15" style={{ top: top + i * LANE, height: LANE }} />
          ) : null
        )}
        {/* レーンの区切り */}
        {horses.slice(1).map((h, i) => (
          <div
            key={h.num}
            className="absolute left-0 right-0 border-t border-dashed border-white/10"
            style={{ top: top + (i + 1) * LANE }}
          />
        ))}

        {/* 距離の標識 */}
        {Array.from({ length: 7 }, (_, k) => {
          const p = (k + 1) / 8;
          const x = xOf(p) - camX;
          if (x < -60 || x > W + 60) return null;
          return (
            <div key={k} className="absolute" style={{ left: x, top: CROWD - 16 }}>
              <div className="-translate-x-1/2 px-1 rounded bg-white text-[9px] font-bold text-zinc-900 whitespace-nowrap">
                {RACE_METERS - (k + 1) * 200}
              </div>
            </div>
          );
        })}

        {/* スタートゲート */}
        {(() => {
          const x = xOf(0) - camX + 4;
          if (x < -40) return null;
          const open = t > 0;
          return (
            <div className="absolute" style={{ left: x, top: top - 4, height: trackH + 8, width: 14 }}>
              <div className="absolute inset-0 rounded-sm bg-zinc-300 shadow-lg" />
              {horses.map((h, i) => (
                <div
                  key={h.num}
                  className="absolute left-0 w-full bg-zinc-500"
                  style={{
                    top: 4 + i * LANE + 3,
                    height: LANE - 6,
                    transformOrigin: 'top',
                    transform: open ? 'scaleY(0.1)' : 'scaleY(1)',
                    transition: 'transform 0.25s',
                  }}
                />
              ))}
            </div>
          );
        })()}

        {/* ゴール */}
        {(() => {
          const x = xOf(1) - camX;
          if (x > W + 40) return null;
          return (
            <>
              <div
                className="absolute"
                style={{
                  left: x - 4,
                  top,
                  width: 8,
                  height: trackH,
                  background: 'repeating-conic-gradient(#fafafa 0 25%, #18181b 0 50%) 0 0 / 8px 8px',
                }}
              />
              <div className="absolute" style={{ left: x, top: 2 }}>
                <div className="-translate-x-1/2 px-1.5 py-0.5 rounded bg-red-600 text-[10px] font-black text-white shadow">GOAL</div>
              </div>
            </>
          );
        })()}

        {/* 馬 */}
        {positions.map(({ h, p, v }, i) => {
          const rawX = xOf(p) - camX;
          const off = rawX < 18;
          const x = Math.max(18, rawX);
          const running = t > 0 && v > 0.05;
          const bob = running ? Math.abs(Math.sin(elapsed / 65 + h.num)) * 3.5 : 0;
          const tilt = running ? Math.sin(elapsed / 65 + h.num) * 4 : 0;
          const isMe = h.num === myHorse;
          const isLeader = standings[0]?.h.num === h.num && t > 0;
          return (
            <div key={h.num} className="absolute" style={{ left: x, top: top + i * LANE, height: LANE, width: 0 }}>
              {/* 砂けむり */}
              {running &&
                [0, 1, 2].map((k) => {
                  const ph = ((elapsed / 380 + k / 3 + h.num * 0.13) % 1 + 1) % 1;
                  return (
                    <span
                      key={k}
                      className="absolute rounded-full"
                      style={{
                        left: -34 - ph * 26,
                        top: LANE - 12 - ph * 6,
                        width: 6 + ph * 8,
                        height: 6 + ph * 8,
                        background: 'rgba(214, 211, 209, 0.55)',
                        opacity: (1 - ph) * Math.min(1, v),
                      }}
                    />
                  );
                })}
              {/* 追い込みのスピード線 */}
              {finishing && isLeader && running &&
                [0, 1, 2].map((k) => (
                  <span
                    key={`s${k}`}
                    className="absolute h-px bg-white/70"
                    style={{ left: -70 - ((elapsed / 4 + k * 23) % 40), top: 10 + k * 8, width: 26 }}
                  />
                ))}
              <div
                className="absolute"
                style={{
                  left: -34,
                  top: 2,
                  transform: `translateY(${-bob}px) rotate(${tilt}deg)`,
                  filter: isMe ? 'drop-shadow(0 0 5px rgba(248,113,113,0.95))' : 'drop-shadow(0 2px 2px rgba(0,0,0,0.5))',
                }}
              >
                <span className="block text-[28px] leading-none" style={{ transform: 'scaleX(-1)' }}>🏇</span>
                <span
                  className="absolute -top-0.5 left-2.5 w-4 h-4 rounded-full text-[10px] font-black text-white flex items-center justify-center border border-white/80"
                  style={{ backgroundColor: colorOf(h.num) }}
                >
                  {h.num}
                </span>
              </div>
              {isMe && (
                <span className="absolute -top-0.5 left-0 px-1 rounded bg-red-600 text-[9px] font-bold text-white whitespace-nowrap">あなた</span>
              )}
              {off && <span className="absolute left-[-16px] top-3 text-xs text-white/80">◀</span>}
            </div>
          );
        })}

        {/* カウントダウン */}
        {t < 0.06 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 pointer-events-none">
            {t < 0 ? (
              <>
                <div className="text-xs text-white/90 mb-1">🎺 各馬ゲートイン完了…</div>
                <div key={countdown} className="text-6xl font-black text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]" style={{ animation: 'hr-pop 0.4s ease-out' }}>
                  {countdown}
                </div>
              </>
            ) : (
              <div className="text-5xl font-black text-amber-300 drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]" style={{ animation: 'hr-pop 0.3s ease-out' }}>
                GO!!
              </div>
            )}
          </div>
        )}

        {/* ゴールの瞬間のフラッシュ */}
        {flash > 0 && <div className="absolute inset-0 bg-white pointer-events-none" style={{ opacity: flash * 0.8 }} />}

        {/* 表彰台 */}
        {showPodium && (
          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-end pb-3" style={{ animation: 'hr-fade 0.4s ease-out' }}>
            <div className="text-sm font-black text-amber-300 mb-2">🏆 確定！</div>
            <div className="flex items-end gap-2">
              {[1, 0, 2].map((rankIdx) => {
                const num = race.ranking[rankIdx];
                const h = horses.find((x) => x.num === num);
                if (!h) return null;
                const heights = [70, 48, 34];
                const medal = ['🥇', '🥈', '🥉'][rankIdx];
                return (
                  <div key={num} className="flex flex-col items-center w-24">
                    <div className="text-2xl" style={{ animation: `hr-pop 0.4s ease-out ${0.2 + rankIdx * 0.15}s both` }}>{medal}</div>
                    <div className={`text-[10px] font-bold text-center leading-tight mb-1 ${num === myHorse ? 'text-red-300' : 'text-white'}`}>
                      {num}番 {h.name}
                    </div>
                    <div
                      className="w-full rounded-t-md flex items-start justify-center pt-1 text-sm font-black text-white"
                      style={{
                        height: heights[rankIdx],
                        background: `linear-gradient(${colorOf(num)}, rgba(0,0,0,0.6))`,
                        transformOrigin: 'bottom',
                        animation: `hr-rise 0.5s ease-out ${rankIdx * 0.15}s both`,
                      }}
                    >
                      {rankIdx + 1}着
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-white/90">あなたの {myHorse}番 は <b className="text-amber-300">{myRank}着</b></div>
            {win &&
              confetti.map((c, i) => (
                <span
                  key={i}
                  className="absolute top-0 pointer-events-none"
                  style={{
                    left: `${c.left}%`,
                    width: c.size,
                    height: c.size * 0.5,
                    backgroundColor: c.color,
                    transform: `rotate(${c.rot}deg)`,
                    animation: `hr-confetti ${c.dur}s linear ${c.delay}s infinite`,
                  }}
                />
              ))}
          </div>
        )}
      </div>

      {/* 順位 */}
      <div className="flex items-center gap-1 text-[11px]">
        <span className="text-zinc-500 mr-1">順位</span>
        {(showPodium ? race.ranking.map((n) => standings.find((s) => s.h.num === n)!).filter(Boolean) : standings).map(({ h }, i) => (
          <span
            key={h.num}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all ${h.num === myHorse ? 'border-red-500 bg-red-500/20 text-white' : 'border-zinc-700 bg-zinc-800 text-zinc-300'}`}
          >
            <b>{i + 1}</b>
            <span className="w-3.5 h-3.5 rounded-full text-[9px] font-black text-white flex items-center justify-center" style={{ backgroundColor: colorOf(h.num) }}>
              {h.num}
            </span>
          </span>
        ))}
      </div>

      {/* ミニマップ */}
      <div className="relative h-3 rounded-full bg-zinc-800 border border-zinc-700">
        <div className="absolute right-0 top-0 bottom-0 w-1 rounded-r-full" style={{ background: 'repeating-linear-gradient(#fff 0 2px, #000 2px 4px)' }} />
        {positions.map(({ h, p }) => (
          <span
            key={h.num}
            className={`absolute top-1/2 w-3 h-3 rounded-full border ${h.num === myHorse ? 'border-white z-10' : 'border-black/40'}`}
            style={{ left: `calc(${Math.min(1, p) * 100}% - 6px)`, transform: 'translateY(-50%)', backgroundColor: colorOf(h.num) }}
          />
        ))}
      </div>

      {/* 実況 */}
      <div className="min-h-[1.5rem] text-xs text-zinc-300">
        {frame ? (
          <span key={phaseIdx} className="inline-block" style={{ animation: 'hr-fade 0.35s ease-out' }}>
            📢 {frame.commentary}
          </span>
        ) : (
          <span className="text-zinc-500">📢 まもなく発走です…</span>
        )}
      </div>
    </div>
  );
}

