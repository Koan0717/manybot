'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * ルーレット盤のアニメーション（ヨーロピアン配列の 0〜36）。
 * 当たりの数字はサーバーで決まったものを受け取り、その数字が上の矢印の下で止まるように回すだけ（見せ方のみ）。
 *
 * 動画のようになめらかにするため、CSS の transition ではなく毎フレーム位置を計算して動かす。
 * - 結果待ちのあいだは一定の速さで回り続ける（通信に何秒かかっても止まらない）
 * - 結果が届いたら、その時点の速さからそのまま減速して狙った数字で止める（速さが途切れない）
 * - ボールは逆回りに減速し、跳ねながらマスに落ちて、その後は盤と一緒に回る
 */

// 盤の並び（時計回り、0 が一番上）
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SLICE = 360 / WHEEL_ORDER.length;

const C = 110; // 中心（viewBox 0 0 220 220）
const R_OUTER = 100; // マスの外周
const R_INNER = 66; // マスの内周
const R_BALL_TRACK = 93; // 回っているときのボールの位置
const R_BALL_POCKET = 76; // マスに落ちたときのボールの位置

const WHEEL_SPEED = 0.3; // 結果待ちの盤の速さ（度/ミリ秒、時計回り）
const BALL_SPEED = -0.75; // 結果待ちのボールの速さ（反時計回り）
const MIN_STOP_MS = 5200; // 結果が届いてから止まるまでのおおよその時間

const point = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)];
};

function wedgePath(i: number) {
  const a0 = (i - 0.5) * SLICE;
  const a1 = (i + 0.5) * SLICE;
  const [x0, y0] = point(a0, R_OUTER);
  const [x1, y1] = point(a1, R_OUTER);
  const [x2, y2] = point(a1, R_INNER);
  const [x3, y3] = point(a0, R_INNER);
  return `M ${x0} ${y0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${R_INNER} ${R_INNER} 0 0 0 ${x3} ${y3} Z`;
}

const pocketColor = (n: number) => (n === 0 ? '#047857' : RED.has(n) ? '#b91c1c' : '#18181b');
const mod360 = (d: number) => ((d % 360) + 360) % 360;
const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** 3次エルミート補間（始点・終点の位置と速さを指定して、なめらかにつなぐ） */
function hermite(p0: number, v0: number, p1: number, v1: number, T: number, t: number) {
  const s = t / T;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * v0 * T + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * v1 * T;
}

export interface RouletteWheelHandle {
  /** 結果を待つあいだ回し始める */
  startSpin: () => void;
  /** n のマスが矢印の下で止まるように減速して止める。止まったら resolve */
  spinTo: (n: number) => Promise<void>;
  /** エラーなどで、その場でゆっくり止める */
  stop: () => void;
}

/** 今の動き方。時刻 t（ミリ秒）から盤・ボールの角度とボールの半径を返す */
type Motion = (now: number) => { wheel: number; ball: number; r: number; done: boolean };

const RouletteWheel = forwardRef<RouletteWheelHandle>(function RouletteWheel(_, ref) {
  const wheelRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const ballDotRef = useRef<SVGCircleElement>(null);
  const state = useRef({ wheel: 0, ball: 0, r: R_BALL_TRACK, wheelVel: 0, ballVel: 0, visible: false });
  const motion = useRef<Motion | null>(null);
  const raf = useRef<number | null>(null);
  const onDone = useRef<(() => void) | null>(null);

  const draw = () => {
    const s = state.current;
    wheelRef.current?.setAttribute('transform', `rotate(${s.wheel} ${C} ${C})`);
    ballRef.current?.setAttribute('transform', `rotate(${s.ball} ${C} ${C})`);
    ballDotRef.current?.setAttribute('cy', String(C - s.r));
    if (ballRef.current) ballRef.current.style.opacity = s.visible ? '1' : '0';
  };

  const loop = (now: number) => {
    const m = motion.current;
    if (!m) {
      raf.current = null;
      return;
    }
    const s = state.current;
    const next = m(now);
    s.wheel = next.wheel;
    s.ball = next.ball;
    s.r = next.r;
    draw();
    if (next.done) {
      motion.current = null;
      raf.current = null;
      onDone.current?.();
      onDone.current = null;
      return;
    }
    raf.current = requestAnimationFrame(loop);
  };

  const run = (m: Motion) => {
    motion.current = m;
    if (raf.current === null) raf.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    draw();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    startSpin() {
      // 止まっている状態から 0.6 秒かけて加速し、その後は一定の速さで回り続ける
      const s = state.current;
      s.visible = true;
      const t0 = performance.now();
      const w0 = s.wheel;
      const b0 = s.ball;
      const r0 = s.r;
      const ACCEL = 600;
      run((now) => {
        const t = now - t0;
        // 加速区間は速さが 0 から直線的に上がる（位置は2次）
        const dist = (v: number) => (t < ACCEL ? (v * t * t) / (2 * ACCEL) : v * (t - ACCEL / 2));
        s.wheelVel = WHEEL_SPEED * Math.min(1, t / ACCEL);
        s.ballVel = BALL_SPEED * Math.min(1, t / ACCEL);
        return {
          wheel: w0 + dist(WHEEL_SPEED),
          ball: b0 + dist(BALL_SPEED),
          r: r0 + (R_BALL_TRACK - r0) * smoothstep(t / 400),
          done: false,
        };
      });
    },

    spinTo(n: number) {
      const s = state.current;
      s.visible = true;
      const index = Math.max(0, WHEEL_ORDER.indexOf(n));
      const t0 = performance.now();
      const w0 = s.wheel;
      const b0 = s.ball;
      const r0 = s.r;
      const wv0 = s.wheelVel || WHEEL_SPEED;
      const bv0 = s.ballVel || BALL_SPEED;

      // 盤: 今の速さから、3次の減速（速さ = v0(1-t/T)^2）で止める。距離 D = v0*T/3。
      // 止まる角度が「index のマスが上に来る角度」になるよう、D を少し伸ばして T を合わせる（速さは途切れない）
      const target = mod360(-index * SLICE);
      let D = (wv0 * MIN_STOP_MS) / 3;
      // 止まる位置合わせは ±180° の範囲で行い、止まるまでの時間のばらつきを抑える
      const adjust = mod360(target - (w0 + D));
      D += adjust > 180 ? adjust - 360 : adjust;
      const T = (3 * D) / wv0;
      const wheelAt = (t: number) => (t >= T ? w0 + D : w0 + D * (1 - Math.pow(1 - t / T, 3)));
      const wheelVelAt = (t: number) => (t >= T ? 0 : (3 * D * Math.pow(1 - t / T, 2)) / T);
      const wheelFinal = w0 + D;

      // ボール: 逆回りに減速し、Td でマスに捕まる。捕まった後は「盤の回転 - 最終角度」で盤と一緒に回り、最後は上で止まる
      const Td = T * 0.72;
      const DROP_START = Td - 700;
      const pocketAt = (t: number) => wheelAt(t) - wheelFinal; // 最後に 0（矢印の下）になる
      // 捕まる瞬間の位置（何周か回った先で、そのときのマスの位置と一致させる）
      const approx = b0 + ((bv0 + 0) / 2) * Td;
      const pCatch = pocketAt(Td);
      const bCatch = pCatch + 360 * Math.round((approx - pCatch) / 360);

      return new Promise<void>((resolve) => {
        onDone.current = resolve;
        run((now) => {
          const t = now - t0;
          const wheel = wheelAt(t);
          let ball: number;
          if (t < Td) {
            ball = hermite(b0, bv0, bCatch, wheelVelAt(Td), Td, t);
          } else {
            ball = bCatch + (pocketAt(t) - pCatch);
          }
          // ボールの半径: 外側を回ってから、跳ねながらマスに落ちる
          let r = r0 + (R_BALL_TRACK - r0) * smoothstep(t / 300);
          if (t > DROP_START) {
            const u = (t - DROP_START) / (Td + 500 - DROP_START);
            const fall = smoothstep(Math.min(1, u * 1.4));
            const bounce = u < 1 ? Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) * 7 : 0;
            r = R_BALL_TRACK + (R_BALL_POCKET - R_BALL_TRACK) * fall + bounce;
          }
          s.wheelVel = wheelVelAt(t);
          s.ballVel = 0;
          return { wheel, ball, r, done: t >= T };
        });
      });
    },

    stop() {
      // その場でゆっくり止め、ボールを消す
      const s = state.current;
      const t0 = performance.now();
      const w0 = s.wheel;
      const wv0 = s.wheelVel;
      const T = 1200;
      s.visible = false;
      run((now) => {
        const t = Math.min(now - t0, T);
        return { wheel: w0 + (wv0 * T) / 3 * (1 - Math.pow(1 - t / T, 3)), ball: s.ball, r: s.r, done: t >= T };
      });
    },
  }));

  return (
    <div className="relative w-64 h-64 max-w-full mx-auto select-none">
      <svg viewBox="0 0 220 220" className="w-full h-full drop-shadow-2xl">
        <defs>
          <radialGradient id="rw-ball" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#e4e4e7" />
            <stop offset="100%" stopColor="#71717a" />
          </radialGradient>
          <radialGradient id="rw-rim" cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="#92400e" />
            <stop offset="100%" stopColor="#451a03" />
          </radialGradient>
        </defs>

        {/* 外枠（ボールが回る溝） */}
        <circle cx={C} cy={C} r={109} fill="url(#rw-rim)" />
        <circle cx={C} cy={C} r={104} fill="#3f1d0b" />

        {/* 回る盤 */}
        <g ref={wheelRef}>
          {WHEEL_ORDER.map((n, i) => (
            <path key={n} d={wedgePath(i)} fill={pocketColor(n)} stroke="#d4a017" strokeWidth={0.6} />
          ))}
          {WHEEL_ORDER.map((n, i) => {
            const [x, y] = point(i * SLICE, (R_OUTER + R_INNER) / 2 + 6);
            return (
              <text
                key={`t${n}`}
                x={x}
                y={y}
                fill="#fafafa"
                fontSize={7.5}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${i * SLICE} ${x} ${y})`}
              >
                {n}
              </text>
            );
          })}
          <circle cx={C} cy={C} r={R_INNER} fill="#7c2d12" stroke="#d4a017" strokeWidth={1.2} />
          <circle cx={C} cy={C} r={44} fill="#9a3412" />
          {[0, 90, 180, 270].map((a) => {
            const [x, y] = point(a, 40);
            return <line key={a} x1={C} y1={C} x2={x} y2={y} stroke="#fbbf24" strokeWidth={3} strokeLinecap="round" />;
          })}
          <circle cx={C} cy={C} r={10} fill="#fbbf24" />
        </g>

        {/* ボール */}
        <g ref={ballRef} style={{ opacity: 0 }}>
          <circle ref={ballDotRef} cx={C} cy={C - R_BALL_TRACK} r={4.4} fill="url(#rw-ball)" stroke="#52525b" strokeWidth={0.4} />
        </g>

        {/* 矢印（固定） */}
        <path d={`M ${C - 7} 2 L ${C + 7} 2 L ${C} 16 Z`} fill="#fbbf24" stroke="#78350f" strokeWidth={1} />
      </svg>
    </div>
  );
});

export default RouletteWheel;
