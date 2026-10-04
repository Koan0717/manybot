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
  RefreshCw,
  Search,
  Pickaxe,
} from 'lucide-react';

const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || '';
let discordSdk: DiscordSDK | null = null;

type ConnStatus = { ok: boolean; latencyMs?: number; error?: string; configured?: boolean };

interface McOverview {
  latest_addon_version: string;
  servers: {
    guild_id: string;
    is_enabled: boolean;
    has_api_key: boolean;
    online: boolean;
    server_name: string | null;
    addon_version: string | null;
    online_players: string[];
    max_players: number | null;
    last_heartbeat_at: string | null;
    join_leave_log: boolean;
  }[];
}

export default function Home() {
  const router = useRouter();
  const [guilds, setGuilds] = useState<any[]>([]);
  const [guildSearchTerm, setGuildSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ supabase: ConnStatus; render: ConnStatus; clientId: string | null } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const filteredGuilds = guilds.filter((g) => {
    if (!guildSearchTerm.trim()) return true;
    const term = guildSearchTerm.toLowerCase();
    return (
      (g.name && g.name.toLowerCase().includes(term)) ||
      (g.id && String(g.id).includes(term))
    );
  });

  // マイクラシステム（選択すると全サーバーの接続状況を表示）
  const [mcOpen, setMcOpen] = useState(false);
  const [mcOverview, setMcOverview] = useState<McOverview | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState('');

  useEffect(() => {
    fetch('/api/system/status')
      .then(res => res.json())
      // 認証エラーなどで { error } が返ってきたときは「取得できなかった」扱いにする（そのまま入れると表示で落ちる）
      .then(data => setStatus(data?.supabase && data?.render ? data : null))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  const inviteClientId = status?.clientId || clientId;

  const fetchMcOverview = useCallback(async () => {
    setMcLoading(true);
    try {
      const res = await fetch('/api/minecraft-overview', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMcOverview(data);
      setMcError('');
    } catch (e: any) {
      setMcError(`接続状況を取得できませんでした: ${e.message}`);
    } finally {
      setMcLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mcOpen) return;
    fetchMcOverview();
    const t = setInterval(fetchMcOverview, 30_000);
    return () => clearInterval(t);
  }, [mcOpen, fetchMcOverview]);

  useEffect(() => {
    // Check authentication status to handle sub-account redirection
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(authData => {
        if (authData.authenticated && authData.user && authData.user.guild_id) {
          // It's a sub-account bound to a specific guild / bot, redirect them immediately
          if (authData.user.bot_id) {
            router.push(`/dashboard/bot/${authData.user.bot_id}/${authData.user.guild_id}`);
          } else {
            router.push(`/dashboard/${authData.user.guild_id}`);
          }
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

          {/* VPS / Bot */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0">
              <Server className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500">VPS接続状況（本体）</div>
              {statusLoading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 確認中...</div>
              ) : !status?.render.configured ? (
                <div className="text-sm text-zinc-500" title="Vercelの環境変数 VPS_BOT_HEALTH_URL または RENDER_BOT_HEALTH_URL が未設定です">未設定</div>
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-3 border-b border-red-900/30">
            <h2 className="font-mecha text-lg font-bold flex items-center gap-2 text-zinc-200">
              <span className="mecha-led w-1.5 h-1.5 rounded-full bg-red-500 text-red-500" />
              サーバー一覧 ({filteredGuilds.length}/{guilds.length})
            </h2>

            {/* リアルタイムサーバー検索バー */}
            <div className="relative min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="🔍 サーバー名 / IDで検索..."
                value={guildSearchTerm}
                onChange={(e) => setGuildSearchTerm(e.target.value)}
                className="w-full bg-black/60 border border-zinc-700 rounded-lg pl-9 pr-10 py-1.5 text-xs text-white focus:outline-none focus:border-red-500 transition-colors font-tech placeholder:text-zinc-500"
              />
              {guildSearchTerm && (
                <button
                  onClick={() => setGuildSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300 font-tech"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

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
              {filteredGuilds.map((guild) => (
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

              {filteredGuilds.length === 0 && !error && (
                <div className="col-span-full text-center py-14 text-zinc-500 font-tech text-sm">
                  {guildSearchTerm ? `「${guildSearchTerm}」に一致するサーバーは見つかりませんでした。` : '参加しているサーバーが見つかりません。'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============================================
            マイクラシステム セクション
        ============================================ */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-tech text-[10px] tracking-[0.2em] text-emerald-400/80 uppercase mb-0.5">
                Minecraft System // Bridge
              </div>
              <h2 className="font-mecha text-base font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                マイクラシステム
              </h2>
            </div>
            {mcOpen && (
              <button
                onClick={fetchMcOverview}
                className="font-tech text-xs text-zinc-500 hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
                title="更新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${mcLoading ? 'animate-spin' : ''}`} /> 更新
              </button>
            )}
          </div>

          <button
            onClick={() => setMcOpen((v) => !v)}
            className={`w-full mecha-clip-sm flex items-center gap-4 p-4 text-left border transition-all ${
              mcOpen
                ? 'bg-emerald-950/30 border-emerald-700/60'
                : 'bg-black/40 border-zinc-800 hover:border-emerald-800/60 hover:bg-emerald-950/20'
            }`}
          >
            <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-emerald-600/60 to-emerald-900/60 border border-emerald-700/40 flex items-center justify-center flex-shrink-0">
              <Pickaxe className="w-5 h-5 text-emerald-200" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mecha font-bold text-sm text-white">マイクラシステム（統合版 BDS 連携）</div>
              <div className="font-tech text-[11px] text-zinc-500">
                サーバー・アドオンの接続状況 / 入退出ログ / マイクラ内通貨 ＝ 鯖内通貨
              </div>
            </div>
            {mcOverview && (
              <div className="hidden sm:flex items-center gap-2 font-tech text-[11px]">
                <span className="text-green-400">接続中 {mcOverview.servers.filter((s) => s.online).length}</span>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-400">連携 {mcOverview.servers.length}</span>
              </div>
            )}
            <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${mcOpen ? 'rotate-90' : ''}`} />
          </button>

          {mcOpen && (
            <div className="mt-3 mecha-corners bg-neutral-900/80 border border-emerald-900/30 mecha-clip shadow-[0_0_25px_-10px_rgba(16,185,129,0.3)] p-5">
              {mcLoading && !mcOverview ? (
                <div className="text-center py-10 text-zinc-500 flex flex-col items-center gap-3 font-tech text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                  接続状況を確認中...
                </div>
              ) : mcError ? (
                <div className="font-tech text-sm text-red-300">{mcError}</div>
              ) : (
                <div className="space-y-3">
                  {(mcOverview?.servers ?? []).length === 0 && (
                    <div className="font-tech text-sm text-zinc-500 text-center py-4">
                      まだマイクラ連携しているサーバーはありません。下からサーバーを選んで設定してください。
                    </div>
                  )}
                  {(mcOverview?.servers ?? []).map((s) => {
                    const guild = guilds.find((g) => String(g.id) === s.guild_id);
                    const outdated = !!s.addon_version && s.addon_version !== mcOverview?.latest_addon_version;
                    return (
                      <button
                        key={s.guild_id}
                        onClick={() => router.push(`/dashboard/${s.guild_id}/minecraft`)}
                        className="w-full mecha-clip-sm bg-black/40 border border-zinc-800 hover:border-emerald-700/50 p-4 text-left transition-all group"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <div className="font-mecha font-bold text-sm text-white truncate">{guild?.name ?? s.guild_id}</div>
                            <div className="font-tech text-[10px] text-zinc-600 truncate">{s.server_name || 'Minecraft'}</div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 flex-shrink-0" />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-tech text-[11px]">
                          <div>
                            <div className="text-zinc-600">サーバー連携</div>
                            {!s.is_enabled ? (
                              <span className="text-zinc-500">OFF</span>
                            ) : !s.has_api_key ? (
                              <span className="text-zinc-500">APIキー未発行</span>
                            ) : s.online ? (
                              <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> 接続中</span>
                            ) : (
                              <span className="text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3" /> オフライン</span>
                            )}
                          </div>
                          <div>
                            <div className="text-zinc-600">アドオン</div>
                            {s.addon_version ? (
                              <span className={outdated ? 'text-amber-400' : 'text-zinc-300'}>
                                v{s.addon_version}{outdated ? '（更新あり）' : ''}
                              </span>
                            ) : (
                              <span className="text-zinc-500">未検出</span>
                            )}
                          </div>
                          <div>
                            <div className="text-zinc-600">プレイヤー</div>
                            <span className="text-zinc-300">
                              {s.online ? `${s.online_players.length}${s.max_players ? ` / ${s.max_players}` : ''}人` : '—'}
                            </span>
                          </div>
                          <div>
                            <div className="text-zinc-600">入退出ログ</div>
                            <span className={s.join_leave_log ? 'text-zinc-300' : 'text-zinc-500'}>{s.join_leave_log ? '設定済み' : '未設定'}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {guilds.some((g) => !mcOverview?.servers.some((s) => s.guild_id === String(g.id))) && (
                    <div className="pt-2">
                      <div className="font-tech text-[11px] text-zinc-500 mb-2">マイクラ連携を設定するサーバー</div>
                      <div className="flex flex-wrap gap-2">
                        {guilds
                          .filter((g) => !mcOverview?.servers.some((s) => s.guild_id === String(g.id)))
                          .map((g) => (
                            <button
                              key={g.id}
                              onClick={() => router.push(`/dashboard/${g.id}/minecraft`)}
                              className="font-tech text-xs text-emerald-300 hover:text-white bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-900/50 rounded-lg px-3 py-1.5 transition-colors"
                            >
                              + {g.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </main>
  );
}
