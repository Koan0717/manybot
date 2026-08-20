'use client';

import { useParams, useRouter } from 'next/navigation';
import { Gamepad2, Disc3, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

const games = [
  {
    id: 'othello',
    name: 'オセロ',
    description: '2人対戦のオセロゲーム。VCまたはテキストチャンネルでプレイ。賭けにも対応。',
    icon: Disc3,
    iconBg: 'bg-cyan-600/15',
    iconBorder: 'border-cyan-700/50',
    iconText: 'text-cyan-300',
    badgeBg: 'bg-cyan-900/40 border-cyan-700/50 text-cyan-300',
    cardBorder: 'border-zinc-700/60 hover:border-cyan-600/50',
    chevronColor: 'text-cyan-400',
  },
];

export default function GamesIndexPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  const router = useRouter();

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <PageHeader
        icon={Gamepad2}
        title="ゲーム設定"
        subtitle="Botが提供するゲーム機能の設定・パネル管理"
        eyebrow="System // Games Module"
        tone="cyan"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map((game) => {
          const Icon = game.icon;
          return (
            <button
              key={game.id}
              onClick={() => router.push(`/dashboard/${guildId}/games/${game.id}`)}
              className={`group relative w-full text-left bg-zinc-900/80 border ${game.cardBorder} rounded-xl p-5 transition-all duration-200 hover:bg-zinc-800/70 shadow-lg focus:outline-none focus:ring-2 focus:ring-cyan-500/40`}
            >
              <div className={`w-12 h-12 mecha-clip-sm ${game.iconBg} border ${game.iconBorder} flex items-center justify-center mb-4`}>
                <Icon className={`w-6 h-6 ${game.iconText}`} strokeWidth={2} />
              </div>

              <h2 className="font-mecha text-lg font-black text-white mb-1 flex items-center gap-2">
                {game.name}
                <span className={`text-[10px] font-tech px-2 py-0.5 rounded border ${game.badgeBg}`}>
                  AVAILABLE
                </span>
              </h2>
              <p className="font-tech text-xs text-zinc-400 leading-relaxed">{game.description}</p>

              <div className={`absolute right-4 top-1/2 -translate-y-1/2 ${game.chevronColor} opacity-0 group-hover:opacity-100 transition-opacity`}>
                <ChevronRight className="w-5 h-5" />
              </div>
            </button>
          );
        })}

        {/* 将来のゲーム追加用プレースホルダー */}
        <div className="w-full bg-zinc-900/30 border border-dashed border-zinc-700/40 rounded-xl p-5 flex flex-col items-center justify-center gap-3 opacity-40 cursor-default min-h-[160px]">
          <Gamepad2 className="w-8 h-8 text-zinc-600" />
          <p className="font-tech text-xs text-zinc-600 text-center">
            今後のゲームが<br />ここに追加されます
          </p>
        </div>
      </div>
    </div>
  );
}
