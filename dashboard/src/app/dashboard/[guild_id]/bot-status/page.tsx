'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import {
  Activity,
  RefreshCw,
  Database,
  Server,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldAlert,
  Zap,
  PhoneCall,
  Coins,
  ShoppingBag,
  Ticket,
  ScrollText,
  UserCheck,
  Check,
  RotateCw,
  SlidersHorizontal,
  DoorOpen,
  ShieldOff,
  Timer,
  Trophy,
  ClipboardCheck,
  Dices,
  Gift,
  Terminal,
  UserPlus,
  LayoutPanelTop,
  Users,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';

interface StatusData {
  db: {
    ok: boolean;
    latencyMs: number;
    isDedicated: boolean;
    databaseUrlMasked?: string | null;
    error?: string | null;
  };
  bot: {
    ok: boolean;
    latencyMs: number | null;
    secondsAgo: number | null;
    lastSeenAt: string | null;
    renderConfigured: boolean;
  };
  discord: {
    ok: boolean;
    guildName: string | null;
    guildIcon: string | null;
    memberCount: number | null;
    botInGuild: boolean;
    latencyMs: number;
    error?: string | null;
  };
  modules: Record<string, { configured: boolean; summary: string; detail?: any; error?: string }>;
  ipc: {
    pendingCount: number;
    synchronized: boolean;
  };
  checkedAt: string;
}

export default function BotStatusPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadingBot, setReloadingBot] = useState(false);

  const fetchStatus = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/bot-status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (isManual) {
        toast.success('最新の接続状況を取得しました！');
      }
    } catch (e: any) {
      console.error(e);
      if (isManual) {
        toast.error('接続状況の取得に失敗しました。');
      }
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, [guildId]);

  useEffect(() => {
    fetchStatus();
    // 15秒ごとに自動再診断
    const interval = setInterval(() => fetchStatus(), 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Bot全キャッシュ強制リロード
  const handleForceReload = async () => {
    setReloadingBot(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        toast.success('Botへ設定の強制再同期リクエストを送信しました！数秒内に反映されます。');
        setTimeout(() => fetchStatus(false), 3000);
      } else {
        toast.error('再同期リクエストの送信に失敗しました。');
      }
    } catch {
      toast.error('通信エラーが発生しました。');
    } finally {
      setReloadingBot(false);
    }
  };

  // 全21個の設定モジュールカテゴリ一覧
  const moduleCategories = [
    {
      category: '全般・基本設定',
      items: [
        {
          key: 'general',
          name: '基本・評価設定',
          path: `/dashboard/${guildId}`,
          icon: SlidersHorizontal,
          desc: '役職ロール設定・Botニックネーム・アイコン連携',
        },
      ],
    },
    {
      category: 'ボイスチャンネル機能',
      items: [
        {
          key: 'vc_triggers',
          name: '自動VCトリガー',
          path: `/dashboard/${guildId}/vc-triggers`,
          icon: Zap,
          desc: '入室時の一時ボイスチャンネル自動作成・管理',
        },
        {
          key: 'call_board',
          name: '通話募集掲示板',
          path: `/dashboard/${guildId}/call-board`,
          icon: PhoneCall,
          desc: 'ワンクリック通話募集とマッチングVC作成',
        },
        {
          key: 'vc_coins',
          name: 'VCコイン獲得制限',
          path: `/dashboard/${guildId}/vc-coins`,
          icon: Timer,
          desc: 'ボイスチャンネル滞在時間に応じた自動通貨付与',
        },
        {
          key: 'rooms',
          name: 'VCルーム設定',
          path: `/dashboard/${guildId}/rooms`,
          icon: DoorOpen,
          desc: '一般宿・高級宿・ゲームVC等の価格・時間設定',
        },
        {
          key: 'room_access',
          name: '評価落ちVCアクセス制御',
          path: `/dashboard/${guildId}/room-access`,
          icon: ShieldOff,
          desc: '評価落ち・違反者ロールの部屋閲覧・接続制限',
        },
      ],
    },
    {
      category: 'エンゲージメント・経済',
      items: [
        {
          key: 'shop',
          name: 'ショップ設定',
          path: `/dashboard/${guildId}/shop`,
          icon: ShoppingBag,
          desc: '獲得ポイントで購入可能なアイテム・ロール販売',
        },
        {
          key: 'tickets',
          name: 'チケット設定',
          path: `/dashboard/${guildId}/tickets`,
          icon: Ticket,
          desc: '問い合わせ・面接等の個別チケットチャンネル作成',
        },
        {
          key: 'rank',
          name: 'ランク設定',
          path: `/dashboard/${guildId}/rank`,
          icon: Trophy,
          desc: 'テキスト/VCの活動量に応じたランクアップ制御',
        },
        {
          key: 'eval_sheet',
          name: '評価関連設定',
          path: `/dashboard/${guildId}/eval-sheet`,
          icon: ClipboardCheck,
          desc: '評価シート・フォーラム投稿・自動生成連携',
        },
        {
          key: 'economy',
          name: '経済・レベリング設定',
          path: `/dashboard/${guildId}/economy`,
          icon: Coins,
          desc: 'ユーザーコイン残高・経験値・送金管理',
        },
        {
          key: 'gambling',
          name: 'ギャンブル設定',
          path: `/dashboard/${guildId}/gambling`,
          icon: Dices,
          desc: 'カジノゲーム・賭博VCの配当・ルール設定',
        },
        {
          key: 'level_rewards',
          name: 'レベル到達報酬',
          path: `/dashboard/${guildId}/level-rewards`,
          icon: Gift,
          desc: 'レベルアップ時に自動付与されるロール・コイン',
        },
      ],
    },
    {
      category: '運用・モデレーション',
      items: [
        {
          key: 'antigrief',
          name: '荒らし対策設定',
          path: `/dashboard/${guildId}/antigrief`,
          icon: ShieldAlert,
          desc: '連投スパム・不正操作の自動検知とミュート処理',
        },
        {
          key: 'commands',
          name: 'コマンド設定',
          path: `/dashboard/${guildId}/commands`,
          icon: Terminal,
          desc: 'スラッシュコマンドの有効/無効・権限管理',
        },
        {
          key: 'logs',
          name: 'ログ出力設定',
          path: `/dashboard/${guildId}/logs`,
          icon: ScrollText,
          desc: 'VC入退室・メッセージ削除等のDiscord監査ログ',
        },
        {
          key: 'interviewer',
          name: '面接官設定',
          path: `/dashboard/${guildId}/interviewer`,
          icon: UserCheck,
          desc: '面接ログ記録および合否判定ロールの付与管理',
        },
        {
          key: 'self_intro_role',
          name: '条件ロール付与設定',
          path: `/dashboard/${guildId}/self-intro-role`,
          icon: UserPlus,
          desc: '自己紹介投稿時の自動ロール付与・リアクションロール',
        },
        {
          key: 'other_panels',
          name: 'その他パネル設定',
          path: `/dashboard/${guildId}/other-panels`,
          icon: LayoutPanelTop,
          desc: '各種問い合わせ・追加機能パネルの設置',
        },
      ],
    },
    {
      category: 'システム・セキュリティ',
      items: [
        {
          key: 'database',
          name: 'データベース設定',
          path: `/dashboard/${guildId}/database`,
          icon: Database,
          desc: 'サーバー専用Supabase DBの接続・独立管理',
        },
        {
          key: 'accounts',
          name: 'アカウント設定',
          path: `/dashboard/${guildId}/accounts`,
          icon: Users,
          desc: 'ダッシュボード管理者の追加・権限ロール管理',
        },
      ],
    },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-28 space-y-8">
      {/* ページヘッダー & 右上の更新ボタン */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          icon={Activity}
          title="BOT機能接続状況"
          subtitle="Bot本体・データベース・Discord連携および全設定モジュールの稼働状況を総合診断します"
          eyebrow="System Diagnostics // Bot & Service Connectivity"
          tone="cyan"
        />

        {/* 右上の更新ボタン */}
        <div className="flex items-center gap-3 -mt-4 sm:-mt-8 self-end sm:self-auto">
          <button
            onClick={() => fetchStatus(true)}
            disabled={loading || refreshing}
            className="mecha-btn-sheen font-mecha flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-cyan-800 hover:from-cyan-500 hover:to-cyan-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-cyan-900/30 transition-all text-sm border border-cyan-400/30"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '診断中...' : '状況を再診断・更新'}
          </button>
        </div>
      </div>

      {/* 1. コアシステム稼働状況 (画像と同一デザインのメカHUDカード) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mecha text-sm font-bold tracking-wider text-cyan-400 uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            コアシステム稼働状況 (Core Services)
          </h2>
          {data?.checkedAt && (
            <span className="font-tech text-xs text-zinc-500">
              最終診断: {new Date(data.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* Supabase (Database) */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3.5 relative overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0 border border-zinc-800">
              <Database className="w-4 h-4 text-zinc-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500 flex items-center gap-1.5">
                {data?.db.isDedicated ? 'Supabase (サーバー専用DB)' : 'Supabase (共有DB)'}
                {data?.db.isDedicated && (
                  <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800 px-1.5 py-0.2 rounded font-bold">専用</span>
                )}
              </div>
              {loading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5 font-tech">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 診断中...
                </div>
              ) : data?.db.ok ? (
                <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  接続中 <span className="text-zinc-500 font-normal">({data.db.latencyMs}ms)</span>
                </div>
              ) : (
                <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5 font-tech" title={data?.db.error || ''}>
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" /> 接続失敗
                </div>
              )}
            </div>
          </div>

          {/* Render (Bot本体) */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3.5 relative overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0 border border-zinc-800">
              <Server className="w-4 h-4 text-zinc-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500">Render (Bot本体)</div>
              {loading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5 font-tech">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 診断中...
                </div>
              ) : data?.bot.ok ? (
                <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  稼働中{' '}
                  {data.bot.latencyMs !== null ? (
                    <span className="text-zinc-500 font-normal">({data.bot.latencyMs}ms)</span>
                  ) : data.bot.secondsAgo !== null ? (
                    <span className="text-zinc-500 font-normal">({data.bot.secondsAgo}秒前)</span>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-red-400 font-semibold flex items-center gap-1.5 font-tech">
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" /> 停止中 (オフライン)
                </div>
              )}
            </div>
          </div>

          {/* Discord Bot連携 */}
          <div className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4 flex items-center gap-3.5 relative overflow-hidden">
            <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0 border border-zinc-800">
              <Radio className="w-4 h-4 text-zinc-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-tech text-xs text-zinc-500">Discord サーバー連携</div>
              {loading ? (
                <div className="text-sm text-zinc-500 flex items-center gap-1.5 font-tech">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 診断中...
                </div>
              ) : data?.discord.ok ? (
                <div className="text-sm text-green-400 font-semibold flex items-center gap-1.5 font-tech">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  連携正常 <span className="text-zinc-500 font-normal">({data.discord.latencyMs}ms)</span>
                </div>
              ) : (
                <div className="text-sm text-amber-400 font-semibold flex items-center gap-1.5 font-tech" title={data?.discord.error || ''}>
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" /> 連携エラー
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. サーバー詳細 & 同期状態インフォパネル */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <h3 className="font-mecha text-base font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              対象Discordサーバー情報
            </h3>
            <p className="font-tech text-xs text-zinc-400 mt-1">
              ID: <span className="text-zinc-200 font-mono">{guildId}</span>
              {data?.discord.guildName && (
                <span className="ml-2">/ 名前: <strong className="text-white">{data.discord.guildName}</strong></span>
              )}
            </p>
          </div>

          {/* 強制再同期ボタン */}
          <button
            onClick={handleForceReload}
            disabled={reloadingBot}
            className="font-tech flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 hover:text-white px-4 py-2 rounded-lg text-xs font-bold border border-zinc-700 transition-colors self-start sm:self-auto"
            title="Bot本体のキャッシュを強制的に再読み込みします"
          >
            <RotateCw className={`w-3.5 h-3.5 text-cyan-400 ${reloadingBot ? 'animate-spin' : ''}`} />
            {reloadingBot ? '再同期中...' : 'Botへ全設定の強制再同期を要求'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-black/30 border border-zinc-800/80 p-3.5 rounded-lg">
            <div className="font-tech text-xs text-zinc-500 mb-1">データベース種別</div>
            <div className="font-mecha text-sm font-bold text-white">
              {data?.db.isDedicated ? (
                <span className="text-cyan-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> 専用 Supabase (独立運用)
                </span>
              ) : (
                <span className="text-amber-300">共有マスターDB (標準)</span>
              )}
            </div>
          </div>

          <div className="bg-black/30 border border-zinc-800/80 p-3.5 rounded-lg">
            <div className="font-tech text-xs text-zinc-500 mb-1">Bot生存確認 (Heartbeat)</div>
            <div className="font-mecha text-sm font-bold text-white">
              {data?.bot.ok ? (
                <span className="text-green-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> 正常受信中 ({data.bot.secondsAgo ?? 0}秒前)
                </span>
              ) : (
                <span className="text-red-400">応答なし (オフライン)</span>
              )}
            </div>
          </div>

          <div className="bg-black/30 border border-zinc-800/80 p-3.5 rounded-lg">
            <div className="font-tech text-xs text-zinc-500 mb-1">IPC 同期キュー</div>
            <div className="font-mecha text-sm font-bold text-white">
              {data?.ipc.synchronized ? (
                <span className="text-green-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> すべての設定が反映済み
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {data?.ipc.pendingCount}件の同期処理待機中
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. 全設定モジュール連携診断グリッド (カテゴリ別表示) */}
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="font-mecha text-sm font-bold tracking-wider text-cyan-400 uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            全機能モジュールの設定・連携状況 (All Feature Modules)
          </h2>
          <span className="font-tech text-xs text-zinc-500">カードをクリックすると各設定画面を開きます</span>
        </div>

        {moduleCategories.map((category) => (
          <div key={category.category} className="space-y-3">
            <h3 className="font-mecha text-xs font-bold text-zinc-400 tracking-wider uppercase border-l-2 border-cyan-500 pl-2.5">
              // {category.category}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {category.items.map((mod) => {
                const Icon = mod.icon;
                const status = data?.modules[mod.key];
                const isConfigured = status?.configured ?? false;
                const hasError = !!status?.error;

                return (
                  <Link
                    key={mod.key}
                    href={mod.path}
                    className={`mecha-clip-sm hover:bg-neutral-800/90 border hover:border-cyan-500/50 p-4 transition-all duration-200 group flex flex-col justify-between relative overflow-hidden ${
                      hasError
                        ? 'bg-red-950/30 border-red-800/60'
                        : 'bg-neutral-900/90 border-zinc-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            hasError
                              ? 'bg-red-950/80 border border-red-700/60 text-red-400'
                              : isConfigured
                              ? 'bg-cyan-950/80 border border-cyan-700/60 text-cyan-400'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <h4 className="font-mecha text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                            {mod.name}
                          </h4>
                        </div>

                        {loading ? (
                          <span className="font-tech text-xs text-zinc-500 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                          </span>
                        ) : hasError ? (
                          <span className="inline-flex items-center gap-1 font-tech text-xs text-red-400 bg-red-950/60 border border-red-700 px-2 py-0.5 rounded font-bold">
                            <XCircle className="w-3 h-3" /> エラー
                          </span>
                        ) : isConfigured ? (
                          <span className="inline-flex items-center gap-1 font-tech text-xs text-green-400 bg-green-950/60 border border-green-800 px-2 py-0.5 rounded font-bold">
                            <CheckCircle2 className="w-3 h-3" /> 連携中
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-tech text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded font-medium">
                            未設定
                          </span>
                        )}
                      </div>

                      <p className="font-tech text-xs text-zinc-400 mb-3 leading-relaxed">
                        {mod.desc}
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                      <span className={`font-tech truncate pr-2 ${
                        hasError ? 'text-red-400' : 'text-zinc-300'
                      }`} title={hasError ? status?.error : undefined}>
                        {loading ? '読み込み中...' : hasError ? `⚠ ${status?.error || 'エラーが発生しました'}` : (status?.summary || '状態確認済み')}
                      </span>
                      <span className="font-tech text-cyan-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1 flex-shrink-0 font-bold">
                        設定へ <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 画面下部の再診断ボタン（左下） */}
      <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between">
        <button
          onClick={() => fetchStatus(true)}
          disabled={loading || refreshing}
          className="font-tech flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 px-4 py-2.5 rounded-lg text-xs font-bold border border-zinc-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '接続状況を更新中...' : '接続状況を再更新'}
        </button>

        <span className="font-tech text-xs text-zinc-500">
          ※15秒ごとにバックグラウンドで自動診断されています
        </span>
      </div>
    </div>
  );
}
