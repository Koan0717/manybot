'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

/**
 * ルーレット盤のアニメーション（ヨーロピアン配列の 0〜36）。
 * 当たりの数字はサーバーで決まったものを受け取り、その数字が上の矢印の下で止まるように回すだけ（見せ方のみ）。
 */

// 盤の並び（時計回り、0 が一番上）
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const SLICE = 360 / WHEEL_ORDER.length;

const C = 110; // 中心（viewBox 0 0 220 220）
const R_OUTER = 100; // マスの外周
const R_INNER = 66; // マスの内周
const R_BALL_TRACK = 92; // 回っているときのボールの位置
const R_BALL_POCKET = 76; // マスに落ちたときのボールの位置

const SPIN_MS = 4200;
const EASE = 'cubic-bezier(0.15, 0.55, 0.12, 1)';

/** 上から時計回りに deg 度、中心から r の位置 */
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

export interface RouletteWheelHandle {
  /** 結果を待つあいだ回し始める */
  startSpin: () => void;
  /** n のマスが矢印の下で止まるように減速して止める。止まったら resolve */
  spinTo: (n: number) => Promise<void>;
  /** エラーなどで、その場でゆっくり止める */
  stop: () => void;
}

const RouletteWheel = forwardRef<RouletteWheelHandle>(function RouletteWheel(_, ref) {
  const [wheel, setWheel] = useState({ deg: 0, ms: 0, ease: 'linear' });
  const [ball, setBall] = useState({ deg: 0, ms: 0, ease: 'linear', r: R_BALL_POCKET, rMs: 0, rDelay: 0, visible: false });
  const wheelDeg = useRef(0);
  const ballDeg = useRef(0);

  useImperativeHandle(ref, () => ({
    startSpin() {
      // 結果が届くまで一定の速さで回す（届いたら spinTo が今の位置から減速させる）
      wheelDeg.current += 720;
      ballDeg.current -= 1080;
      setWheel({ deg: wheelDeg.current, ms: 2000, ease: 'linear' });
      setBall({ deg: ballDeg.current, ms: 2000, ease: 'linear', r: R_BALL_TRACK, rMs: 300, rDelay: 0, visible: true });
    },
    spinTo(n: number) {
      const index = Math.max(0, WHEEL_ORDER.indexOf(n));
      // 盤: 何周か回ってから、マス index が上（0度）に来る角度で止める
      const target = (((-index * SLICE) % 360) + 360) % 360;
      const now = ((wheelDeg.current % 360) + 360) % 360;
      wheelDeg.current += 360 * 4 + ((target - now + 360) % 360);
      // ボール: 逆回りに何周かして、最後は上（矢印の下）で止まる
      const ballNow = ((ballDeg.current % 360) + 360) % 360;
      ballDeg.current -= 360 * 6 + ballNow;
      setWheel({ deg: wheelDeg.current, ms: SPIN_MS, ease: EASE });
      setBall({
        deg: ballDeg.current,
        ms: SPIN_MS,
        ease: EASE,
        r: R_BALL_POCKET,
        rMs: 900,
        rDelay: SPIN_MS - 1500, // 減速してきたところでマスに落ちる
        visible: true,
      });
      return new Promise((resolve) => setTimeout(resolve, SPIN_MS + 150));
    },
    stop() {
      wheelDeg.current += 90;
      setWheel({ deg: wheelDeg.current, ms: 1200, ease: EASE });
      setBall((b) => ({ ...b, visible: false }));
    },
  }));

  return (
    <div className="relative w-64 h-64 max-w-full mx-auto select-none">
      <svg viewBox="0 0 220 220" className="w-full h-full drop-shadow-2xl">
        {/* 外枠 */}
        <circle cx={C} cy={C} r={108} fill="#78350f" />
        <circle cx={C} cy={C} r={104} fill="#451a03" />

        {/* 回る盤 */}
        <g style={{ transform: `rotate(${wheel.deg}deg)`, transformOrigin: `${C}px ${C}px`, transition: `transform ${wheel.ms}ms ${wheel.ease}` }}>
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
          {/* 中心の飾り */}
          <circle cx={C} cy={C} r={R_INNER} fill="#7c2d12" stroke="#d4a017" strokeWidth={1.2} />
          <circle cx={C} cy={C} r={44} fill="#9a3412" />
          {[0, 90, 180, 270].map((a) => {
            const [x, y] = point(a, 40);
            return <line key={a} x1={C} y1={C} x2={x} y2={y} stroke="#fbbf24" strokeWidth={3} strokeLinecap="round" />;
          })}
          <circle cx={C} cy={C} r={10} fill="#fbbf24" />
        </g>

        {/* ボール（盤と逆回り） */}
        {ball.visible && (
          <g style={{ transform: `rotate(${ball.deg}deg)`, transformOrigin: `${C}px ${C}px`, transition: `transform ${ball.ms}ms ${ball.ease}` }}>
            {/* 中心からの距離は transform で動かす（Safari は cy のアニメーションに対応していないため） */}
            <circle
              cx={C}
              cy={C}
              r={4.2}
              fill="#fafafa"
              stroke="#a1a1aa"
              strokeWidth={0.6}
              style={{ transform: `translateY(${-ball.r}px)`, transition: `transform ${ball.rMs}ms ease-in ${ball.rDelay}ms` }}
            />
          </g>
        )}

        {/* 矢印（固定） */}
        <path d={`M ${C - 7} 2 L ${C + 7} 2 L ${C} 16 Z`} fill="#fbbf24" stroke="#78350f" strokeWidth={1} />
      </svg>
    </div>
  );
});

export default RouletteWheel;
