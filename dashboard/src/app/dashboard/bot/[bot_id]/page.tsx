'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  ChevronRight,
  ChevronLeft,
  Loader2,
  ServerCrash,
  GitBranch,
  GitCommit,
  Database,
  RefreshCw,
  CircuitBoard,
  Trash2,
} from 'lucide-react';

interface BotInfo {
  bot_id: string;
  bot_name: string;
  github_repo: string | null;
  render_deploy_hook_url: string | null;
  has_dedicated_db: boolean;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  last_deploy_at: string | null;
}

interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

export default function BotGuildSelectPage({ params }: { params: { bot_id: string } }) {
  const { bot_id } = params;
  const router = useRouter();

  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/bots/${bot_id}/guilds`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      // bot情報も一緒に取得
      const botRes = await fetch(`/api/bots/${bot_id}`);
      if (botRes.ok) {
        setBotInfo(await botRes.json());
      }
      setGuilds(data.guilds || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [bot_id]);

  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-10 bg-zinc-950 text-white relative overflow-hidden mecha-grid-bg">
      {/* Background decorations */}
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-violet-600/6 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-indigo-600/6 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl w-full mx-auto relative z-10">
        {/* Back button */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-tech text-xs text-zinc-500 hover:text-white transition-colors mb-8 group"
        >
          <ChevronLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          ホームに戻る
        </Link>

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 mecha-clip bg-gradient-to-br from-violet-600 to-violet-900 shadow-lg shadow-violet-900/40 mb-5 border border-violet-500/30">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-violet-500 text-violet-500"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-violet-500/80 uppercase">
              Bot Registry // Guild Select
            </span>
          </div>
          <h1 className="font-mecha text-3xl md:text-4xl font-black tracking-tight text-white">
            {botInfo?.bot_name || 'Bot'}
          </h1>
          <p className="font-tech text-zinc-500 mt-2 text-sm">
            管理するサーバーを選択してください
          </p>
        </div>

        {/* Bot Info Panel */}
        {botInfo && (
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
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
                <div className="font-tech text-xs text-zinc-400 truncate">{botInfo.github_repo}</div>
              </div>
            )}
            {botInfo.last_commit_sha && (
              <div>
                <div className="font-tech text-[10px] text-zinc-600 mb-0.5 flex items-center gap-1">
                  <GitCommit className="w-3 h-3" /> 最新コミット
                </div>
                <div className="font-mono text-xs text-violet-400">{botInfo.last_commit_sha}</div>
                {botInfo.last_commit_message && (
                  <div className="font-tech text-[10px] text-zinc-500 truncate">{botInfo.last_commit_message}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Guild List */}
        <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/80 border border-violet-900/40 mecha-clip shadow-[0_0_35px_-10px_rgba(139,92,246,0.35)] p-6 md:p-8">
          <div className="flex items-center justify-between mb-6 pb-3 border-b border-violet-900/30">
            <h2 className="font-mecha text-lg font-bold flex items-center gap-2 text-zinc-200">
              <span className="mecha-led w-1.5 h-1.5 rounded-full bg-violet-500 text-violet-500" />
              参加サーバー一覧
            </h2>
            <button
              onClick={fetchData}
              disabled={loading}
              className="font-tech text-xs text-zinc-500 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 更新
            </button>
          </div>

          {error && (
            <div className="mecha-clip-sm bg-red-950/50 text-red-200 p-4 mb-4 border border-red-900/60 flex items-start gap-3">
              <ServerCrash className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
              <div className="font-tech text-sm">
                {error}
                <div className="mt-2 opacity-80">
                  Botトークンが正しいか、Botが対象サーバーに参加しているか確認してください。
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-14 text-zinc-500 flex flex-col items-center gap-3 font-tech text-sm">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
              サーバー一覧を取得中...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guilds.map((guild) => (
                <button
                  key={guild.id}
                  onClick={() => router.push(`/dashboard/bot/${bot_id}/${guild.id}`)}
                  className="mecha-clip-sm group flex items-center gap-4 bg-black/40 hover:bg-violet-950/20 transition-all p-4 border border-zinc-800 hover:border-violet-800/60 text-left"
                >
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                      alt={guild.name}
                      className="w-12 h-12 rounded-full ring-2 ring-zinc-800 group-hover:ring-violet-900/60 transition-all flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-800/40 to-violet-900/60 flex items-center justify-center text-lg font-bold flex-shrink-0 ring-2 ring-zinc-800 group-hover:ring-violet-900/60 transition-all">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mecha font-bold text-base truncate group-hover:text-white transition-colors">
                      {guild.name}
                    </div>
                    <div className="font-tech text-xs text-zinc-500 truncate">ID: {guild.id}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>
              ))}

              {guilds.length === 0 && !error && (
                <div className="col-span-full text-center py-14 text-zinc-500 font-tech text-sm">
                  このBotが参加しているサーバーが見つかりません。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
