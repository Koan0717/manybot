'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Activity,
  Database,
  Server,
  Radio,
  CheckCircle2,
  XCircle,
  RefreshCw,
  GitBranch,
  ExternalLink,
  Settings,
  Users,
  TerminalSquare,
} from 'lucide-react';

interface BotInfo {
  bot_id: string;
  bot_name: string;
  github_repo: string | null;
  has_dedicated_db: boolean;
  last_commit_sha: string | null;
  last_commit_message: string | null;
}

interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;
  approximate_member_count?: number;
}

export default function BotGuildPage({ params }: { params: { bot_id: string; guild_id: string } }) {
  const { bot_id, guild_id } = params;
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [guildInfo, setGuildInfo] = useState<GuildInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const botRes = await fetch(`/api/bots/${bot_id}`);
        if (botRes.ok) {
          const botData = await botRes.json();
          setBotInfo(botData);
        }
        // guildInfoはAPIから取得せず手動で設定
        setGuildInfo({ id: guild_id, name: guild_id, icon: null });
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [bot_id, guild_id]);


  const menuItems = [
    {
      icon: Activity,
      label: '接続状況',
      description: 'Bot本体・DB・Discordの稼働確認',
      href: `/dashboard/${guild_id}/bot-status`,
      color: 'cyan',
    },
    {
      icon: Settings,
      label: '基本設定',
      description: 'サーバーの基本設定・Bot設定',
      href: `/dashboard/${guild_id}`,
      color: 'zinc',
    },
    {
      icon: TerminalSquare,
      label: 'コマンド設定',
      description: 'スラッシュコマンドの権限・ON/OFF管理',
      href: `/dashboard/${guild_id}/commands`,
      color: 'zinc',
    },
    {
      icon: Database,
      label: 'データベース設定',
      description: '専用Supabase DBの接続管理',
      href: `/dashboard/${guild_id}/database`,
      color: 'zinc',
    },
    {
      icon: Users,
      label: 'アカウント設定',
      description: 'ダッシュボード管理者の権限管理',
      href: `/dashboard/${guild_id}/accounts`,
      color: 'zinc',
    },
  ];

  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-10 bg-zinc-950 text-white relative overflow-hidden mecha-grid-bg">
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-violet-600/6 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-indigo-600/6 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-3xl w-full mx-auto relative z-10">
        {/* Back */}
        <Link
          href={`/dashboard/bot/${bot_id}`}
          className="inline-flex items-center gap-1.5 font-tech text-xs text-zinc-500 hover:text-white transition-colors mb-8 group"
        >
          <ChevronLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          サーバー一覧に戻る
        </Link>

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 mecha-clip bg-gradient-to-br from-violet-600 to-violet-900 shadow-lg shadow-violet-900/40 mb-5 border border-violet-500/30">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-violet-500/80 uppercase">
              Bot Registry // Guild Dashboard
            </span>
          </div>
          <h1 className="font-mecha text-2xl md:text-3xl font-black tracking-tight text-white">
            {loading ? '読み込み中...' : botInfo?.bot_name || 'Bot'}
          </h1>
          <p className="font-tech text-zinc-500 mt-2 text-sm">
            Guild ID: <span className="text-zinc-300 font-mono">{guild_id}</span>
          </p>
        </div>

        {/* Bot Info */}
        {botInfo && (
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 mb-6 grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <div className="font-tech text-[10px] text-zinc-600 mb-0.5">Bot ID</div>
              <div className="font-mono text-xs text-zinc-400">{botInfo.bot_id}</div>
            </div>
            <div>
              <div className="font-tech text-[10px] text-zinc-600 mb-0.5">DB種別</div>
              <div className="font-tech text-xs">
                {botInfo.has_dedicated_db ? (
                  <span className="text-cyan-400">専用 Supabase</span>
                ) : (
                  <span className="text-amber-400">共有マスターDB</span>
                )}
              </div>
            </div>
            {botInfo.github_repo && (
              <div>
                <div className="font-tech text-[10px] text-zinc-600 mb-0.5 flex items-center gap-1">
                  <GitBranch className="w-3 h-3" /> リポジトリ
                </div>
                <a
                  href={`https://github.com/${botInfo.github_repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-tech text-xs text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1 truncate"
                >
                  {botInfo.github_repo}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Notice: These pages link to the main Bot's dashboard for this guild */}
        <div className="bg-violet-950/30 border border-violet-800/40 rounded-lg px-4 py-3 mb-6 font-tech text-xs text-violet-300">
          <strong>注意:</strong> 以下のリンクはこのサーバー (<code className="font-mono">{guild_id}</code>) のメインBotダッシュボードに移動します。
          「{botInfo?.bot_name || 'このBot'}」専用のダッシュボード機能は今後実装予定です。
        </div>

        {/* Quick Links */}
        <div className="mecha-corners bg-neutral-900/80 border border-violet-900/40 mecha-clip shadow-[0_0_25px_-10px_rgba(139,92,246,0.3)] p-6">
          <h2 className="font-mecha text-base font-bold text-zinc-200 flex items-center gap-2 mb-5 pb-3 border-b border-zinc-800">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            設定メニュー
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="mecha-clip-sm group flex items-center gap-3 bg-black/40 hover:bg-violet-950/20 transition-all p-4 border border-zinc-800 hover:border-violet-700/50"
                >
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 group-hover:bg-violet-950/60 border border-zinc-700 group-hover:border-violet-700/50 flex items-center justify-center flex-shrink-0 transition-all">
                    <Icon className="w-4 h-4 text-zinc-400 group-hover:text-violet-300 transition-colors" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mecha text-sm font-bold text-white group-hover:text-violet-200 transition-colors">
                      {item.label}
                    </div>
                    <div className="font-tech text-[11px] text-zinc-500 truncate">
                      {item.description}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
