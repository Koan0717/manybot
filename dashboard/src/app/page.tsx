'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import {
  CircuitBoard,
  ChevronRight,
  ServerCrash,
  Loader2,
  Database,
  Server,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Bot,
  Trash2,
  GitBranch,
  RefreshCw,
  GitCommit,
} from 'lucide-react';
import AddBotModal from '@/components/AddBotModal';

const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '';
let discordSdk: DiscordSDK | null = null;

type ConnStatus = { ok: boolean; latencyMs?: number; error?: string; configured?: boolean };

interface RegisteredBot {
  id: number;
  bot_id: string;
  bot_name: string;
  github_repo: string | null;
  render_deploy_hook_url: string | null;
  has_dedicated_db: boolean;
  last_deploy_at: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  created_at: string;
}

export default function Home() {
  const router = useRouter();
  const [guilds, setGuilds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ supabase: ConnStatus; render: ConnStatus; clientId: string | null } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // 登録済みBot
  const [registeredBots, setRegisteredBots] = useState<RegisteredBot[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [isAddBotModalOpen, setIsAddBotModalOpen] = useState(false);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system/status')
      .then(res => res.json())
      .then(data => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  const inviteClientId = status?.clientId || clientId;

  // 登録済みBot一覧を取得
  const fetchBots = useCallback(async () => {
    try {
      const res = await fetch('/api/bots');
      if (res.ok) {
        const data = await res.json();
        setRegisteredBots(Array.isArray(data) ? data : []);
      }
    } catch {
      setRegisteredBots([]);
    } finally {
      setBotsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  useEffect(() => {
    // Check authentication status to handle sub-account redirection
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(authData => {
        if (authData.authenticated && authData.user && authData.user.guild_id) {
          // It's a sub-account bound to a specific guild, redirect them immediately
          router.push(`/dashboard/${authData.user.guild_id}`);
          return;
        }

        // Otherwise, it's a super admin, fetch guilds list
        fetch('/api/guilds')
          .then(res => res.json())
          .then(data => {
            if (data.error) {
              setError(data.error);
            } else {
              setGuilds(data);
            }
          })
          .catch(err => {
            setError('サーバー一覧の取得に失敗しました。');
          })
          .finally(() => setLoading(false));
      })
      .catch(() => setLoading(false));
  }, [router]);

  const handleSelectGuild = (guildId: string) => {
    router.push(`/dashboard/${guildId}`);
  };

  const handleDeleteBot = async (bot: RegisteredBot) => {
    if (!confirm(`「${bot.bot_name}」の登録を削除しますか？\nこの操作は取り消せません。`)) return;
    setDeletingBotId(bot.bot_id);
    try {
      const res = await fetch(`/api/bots/${bot.bot_id}`, { method: 'DELETE' });
      if (res.ok) {
        setRegisteredBots(prev => prev.filter(b => b.bot_id !== bot.bot_id));
      }
    } catch {}
    setDeletingBotId(null);
  };

  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-10 bg-zinc-950 text-white relative overflow-hidden mecha-grid-bg">
      {/* Background decoration */}
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-red-600/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-cyan-600/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl w-full mx-auto relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-10 mt-6">
          <div className="inline-flex items-center justify-center w-16 h-16 mecha-clip bg-gradient-to-br from-red-600 to-red-900 shadow-lg shadow-red-900/40 mb-5 border border-red-500/30">
            <CircuitBoard className="w-8 h-8 text-white" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-red-500 text-red-500"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-red-500/80 uppercase">System // Guild Select</span>
          </div>
          <h1 className="font-mecha text-3xl md:text-4xl font-black tracking-tight text-white">Many bot Dashboard</h1>
          <p className="font-tech text-zinc-500 mt-2 text-sm">管理するサーバーを選択してください</p>
        </div>

        {/* Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {/* Supabase */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
              <Database className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500">Supabase (Database)</div>
              {statusLoading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 確認中...</div>
              ) : status?.supabase.ok ? (
                <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> 接続中 {status.supabase.latencyMs !== undefined && <span className="text-zinc-500 font-normal">({status.supabase.latencyMs}ms)</span>}
                </div>
              ) : (
                <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5" title={status?.supabase.error}>
                  <XCircle className="w-4 h-4" /> 接続エラー
                </div>
              )}
            </div>
          </div>

          {/* Render / Bot */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
              <Server className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500">Render (Bot本体)</div>
              {statusLoading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 確認中...</div>
              ) : !status?.render.configured ? (
                <div className="text-sm text-zinc-500" title="Vercelの環境変数 RENDER_BOT_HEALTH_URL が未設定です">未設定</div>
              ) : status.render.ok ? (
                <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> 稼働中 {status.render.latencyMs !== undefined && <span className="text-zinc-500 font-normal">({status.render.latencyMs}ms)</span>}
                </div>
              ) : (
                <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5" title={status.render.error}>
                  <XCircle className="w-4 h-4" /> 接続エラー
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Invite Bot */}
        {inviteClientId ? (
          <a
            href={`https://discord.com/oauth2/authorize?client_id=${inviteClientId}&permissions=8&scope=bot%20applications.commands`}
            target="_blank"
            rel="noopener noreferrer"
            className="mecha-clip-sm mb-6 flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 transition-all text-white font-mecha font-bold py-3 px-4 border border-red-500/30 shadow-lg shadow-red-900/30"
          >
            <PlusCircle className="w-4 h-4" />
            新しいサーバーにBotを招待する
          </a>
        ) : !statusLoading && (
          <div className="mecha-clip-sm mb-6 flex items-center justify-center gap-2 bg-zinc-900 text-zinc-500 font-tech text-sm py-3 px-4 border border-zinc-800">
            招待リンクを取得できませんでした(DISCORD_BOT_TOKENを確認してください)
          </div>
        )}

        {/* Main Bot Guild List */}
        <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/80 border border-red-900/40 mecha-clip shadow-[0_0_35px_-10px_rgba(255,43,61,0.35)] p-6 md:p-8">
          <h2 className="font-mecha text-lg font-bold mb-6 pb-3 border-b border-red-900/30 flex items-center gap-2 text-zinc-200">
            <span className="mecha-led w-1.5 h-1.5 rounded-full bg-red-500 text-red-500" />
            サーバー一覧
          </h2>

          {error && (
            <div className="mecha-clip-sm bg-red-950/50 text-red-200 p-4 mb-4 border border-red-900/60 flex items-start gap-3">
              <ServerCrash className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
              <div className="font-tech text-sm">
                {error}
                <div className="mt-2 opacity-80">
                  Vercelの環境変数に「DISCORD_BOT_TOKEN」が正しく設定されているか確認してください。
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-14 text-zinc-500 flex flex-col items-center gap-3 font-tech text-sm">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
              読み込み中...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guilds.map((guild) => (
                <button
                  key={guild.id}
                  onClick={() => handleSelectGuild(guild.id)}
                  className="mecha-clip-sm group flex items-center gap-4 bg-black/40 hover:bg-red-950/20 transition-all p-4 border border-zinc-800 hover:border-red-800/60 text-left"
                >
                  {guild.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                      alt={guild.name}
                      className="w-12 h-12 rounded-full ring-2 ring-zinc-800 group-hover:ring-red-900/60 transition-all flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold flex-shrink-0 ring-2 ring-zinc-800 group-hover:ring-red-900/60 transition-all">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mecha font-bold text-base truncate group-hover:text-white transition-colors">{guild.name}</div>
                    <div className="font-tech text-xs text-zinc-500 truncate">ID: {guild.id}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>
              ))}

              {guilds.length === 0 && !error && (
                <div className="col-span-full text-center py-14 text-zinc-500 font-tech text-sm">
                  参加しているサーバーが見つかりません。
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============================================
            登録済みの別Bot セクション
        ============================================ */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-tech text-[10px] tracking-[0.2em] text-violet-400/80 uppercase mb-0.5">
                Bot Registry // Multi-Bot
              </div>
              <h2 className="font-mecha text-base font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse"></span>
                登録済みの別Bot
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchBots}
                className="font-tech text-xs text-zinc-500 hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
                title="更新"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 更新
              </button>
              <button
                onClick={() => setIsAddBotModalOpen(true)}
                className="font-mecha font-bold text-sm bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 text-white px-4 py-2 rounded-lg border border-violet-500/30 shadow-lg shadow-violet-900/20 transition-all flex items-center gap-2"
              >
                <PlusCircle className="w-4 h-4" />
                別のBotを追加
              </button>
            </div>
          </div>

          <div className="mecha-corners bg-neutral-900/80 border border-violet-900/30 mecha-clip shadow-[0_0_25px_-10px_rgba(139,92,246,0.3)] p-5">
            {botsLoading ? (
              <div className="text-center py-10 text-zinc-500 flex flex-col items-center gap-3 font-tech text-sm">
                <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                読み込み中...
              </div>
            ) : registeredBots.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto">
                  <Bot className="w-5 h-5 text-zinc-500" />
                </div>
                <div className="font-tech text-sm text-zinc-500">登録済みのBotはまだありません</div>
                <button
                  onClick={() => setIsAddBotModalOpen(true)}
                  className="font-tech text-xs text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1.5 mx-auto"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> 最初のBotを追加する
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {registeredBots.map((bot) => (
                  <div
                    key={bot.bot_id}
                    className="mecha-clip-sm bg-black/40 border border-zinc-800 hover:border-violet-700/40 transition-all group"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-700/60 to-violet-900/60 border border-violet-700/40 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-violet-300" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-mecha font-bold text-sm text-white truncate">
                              {bot.bot_name}
                            </div>
                            <div className="font-mono text-[10px] text-zinc-600">
                              {bot.bot_id}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {bot.has_dedicated_db && (
                            <span className="font-tech text-[10px] bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 px-1.5 py-0.5 rounded">
                              専用DB
                            </span>
                          )}
                          <button
                            onClick={() => handleDeleteBot(bot)}
                            disabled={deletingBotId === bot.bot_id}
                            className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-red-950/60 hover:border-red-800 border border-transparent flex items-center justify-center text-zinc-500 hover:text-red-400 transition-all"
                            title="削除"
                          >
                            {deletingBotId === bot.bot_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* GitHub情報 */}
                      {bot.github_repo && (
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <GitBranch className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                          <span className="font-tech text-[11px] text-zinc-500 truncate">{bot.github_repo}</span>
                        </div>
                      )}

                      {/* 最新コミット */}
                      {bot.last_commit_sha && (
                        <div className="flex items-center gap-1.5 mb-3">
                          <GitCommit className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                          <span className="font-mono text-[10px] text-zinc-600">{bot.last_commit_sha}</span>
                          <span className="font-tech text-[11px] text-zinc-500 truncate">{bot.last_commit_message}</span>
                        </div>
                      )}

                      {/* サーバー管理へボタン */}
                      <button
                        onClick={() => router.push(`/dashboard/bot/${bot.bot_id}`)}
                        className="w-full font-tech text-xs text-violet-400 hover:text-violet-300 bg-violet-950/30 hover:bg-violet-950/50 border border-violet-900/40 hover:border-violet-700/60 rounded-lg py-2 transition-all flex items-center justify-center gap-1.5"
                      >
                        サーバーを選択・管理
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AddBotModal */}
      <AddBotModal
        isOpen={isAddBotModalOpen}
        onClose={() => setIsAddBotModalOpen(false)}
        onSuccess={fetchBots}
      />
    </main>
  );
}
