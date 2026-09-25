'use client';

import { useEffect, useState } from 'react';

/**
 * チンチロリンのお椀とサイコロ3つ。rolling のあいだは転がって出目が入れ替わり、止まると dice の出目を見せる。
 * 出目はサーバーで決まったものを受け取るだけ（見せ方のみ）。
 */

// 1〜6 の目の位置（3x3 のマス: 0 左上 … 8 右下）
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, rolling, index }: { value: number; rolling: boolean; index: number }) {
  // 1の目は赤（本物のサイコロと同じ）
  const pipColor = value === 1 ? '#dc2626' : '#18181b';
  return (
    <div
      className="w-14 h-14 rounded-xl bg-zinc-50 shadow-[inset_0_-4px_0_rgba(0,0,0,0.15),0_4px_10px_rgba(0,0,0,0.5)] grid grid-cols-3 grid-rows-3 p-2 gap-0.5"
      style={{
        animation: rolling
          ? `dice-tumble-${index} 0.45s ease-in-out infinite`
          : 'dice-land 0.35s ease-out',
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="flex items-center justify-center">
          {PIPS[value]?.includes(i) && (
            <span className={`rounded-full flex-shrink-0 ${value === 1 ? 'w-4 h-4' : 'w-2.5 h-2.5'}`} style={{ backgroundColor: pipColor }} />
          )}
        </span>
      ))}
    </div>
  );
}

const randomFace = () => 1 + Math.floor(Math.random() * 6);

export default function DiceBowl({ dice, rolling, caption, hand }: { dice: number[] | null; rolling: boolean; caption: string; hand?: string | null }) {
  const [faces, setFaces] = useState<number[]>(dice ?? [1, 2, 3]);

  // 転がっているあいだは出目をどんどん入れ替え、止まったら決まった出目にする
  useEffect(() => {
    if (!rolling) {
      if (dice) setFaces(dice);
      return;
    }
    const timer = setInterval(() => setFaces([randomFace(), randomFace(), randomFace()]), 90);
    return () => clearInterval(timer);
  }, [rolling, dice]);

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <style>{`
        @keyframes dice-tumble-0 { 0% { transform: translate(-6px, 2px) rotate(-18deg); } 50% { transform: translate(5px, -8px) rotate(24deg); } 100% { transform: translate(-6px, 2px) rotate(-18deg); } }
        @keyframes dice-tumble-1 { 0% { transform: translate(4px, -6px) rotate(20deg); } 50% { transform: translate(-5px, 6px) rotate(-28deg); } 100% { transform: translate(4px, -6px) rotate(20deg); } }
        @keyframes dice-tumble-2 { 0% { transform: translate(-3px, 7px) rotate(-10deg); } 50% { transform: translate(6px, -4px) rotate(32deg); } 100% { transform: translate(-3px, 7px) rotate(-10deg); } }
        @keyframes dice-land { 0% { transform: scale(1.15) rotate(8deg); } 60% { transform: scale(0.95) rotate(-3deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes bowl-shake { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-2deg); } 75% { transform: rotate(2deg); } }
      `}</style>
      <div className="text-xs text-zinc-400">{caption}</div>
      {/* お椀 */}
      <div
        className="relative w-64 h-40 max-w-full rounded-[50%] flex items-center justify-center gap-3"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, #fafaf9 0%, #e7e5e4 45%, #a8a29e 80%, #57534e 100%)',
          boxShadow: 'inset 0 10px 25px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.5)',
          animation: rolling ? 'bowl-shake 0.25s linear infinite' : undefined,
        }}
      >
        {faces.map((v, i) => (
          <Die key={i} value={v} rolling={rolling} index={i} />
        ))}
      </div>
      <div className="h-7">
        {!rolling && hand && (
          <span className="inline-block px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/60 text-amber-200 text-sm font-bold">
            {hand}
          </span>
        )}
      </div>
    </div>
  );
}
