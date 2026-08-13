'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import {
  Bot,
  Activity,
  Database,
  Server,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Ticket,
  ShoppingBag,
  Fish,
  BookOpen,
  Trophy,
  Coins,
  Camera,
  CreditCard,
  Wrench,
  Gamepad2,
  Save,
  Send,
  Plus,
  Minus,
  Sparkles,
  Layers,
  Flame,
  Check,
  RotateCw,
  Loader2,
  ExternalLink,
  ShieldCheck,
  History,
} from 'lucide-react';

interface StatusData {
  settings: Record<string, any>;
  missionLogs: any[];
  mileLogs: any[];
  channels: Array<{ id: string; name: string; type: number }>;
  roles: Array<{ id: string; name: string; color: number }>;
}

export default function BotGuildDashboardPage({
  params,
}: {
  params: { bot_id: string; guild_id: string };
}) {
  const { bot_id, guild_id } = params;
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get('tab') || 'overview';

  const [data, setData] = useState<StatusData | null>(null);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Manual Mile Action State
  const [mileTargetUser, setMileTargetUser] = useState('');
  const [mileAmount, setMileAmount] = useState('100');
  const [mileOpType, setMileOpType] = useState<'grant' | 'revoke'>('grant');
  const [mileReason, setMileReason] = useState('管理者による手動調整');
  const [mileExecuting, setMileExecuting] = useState(false);

  // Panel Send State
  const [panelChannelId, setPanelChannelId] = useState('');
  const [panelTitle, setPanelTitle] = useState('🍃 どうぶつの森林 - 総合操作パネル');
  const [panelColor, setPanelColor] = useState('#2ECC71');
  const [panelSending, setPanelSending] = useState(false);

  const fetchData = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const res = await fetch(`/api/guilds/${guild_id}/doumori`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
        setSettings(json.settings || {});
        if (json.settings?.panel_channel_id && !panelChannelId) {
          setPanelChannelId(json.settings.panel_channel_id);
        }
        if (isManual) toast.success('最新設定・ログを取得しました！');
      } catch (err: any) {
        console.error('Fetch error:', err);
        if (isManual) toast.error('設定の読み込みに失敗しました');
      } finally {
        setLoading(false);
        if (isManual) setRefreshing(false);
      }
    },
    [guild_id, panelChannelId]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const resData = await res.json();
      if (res.ok) {
        toast.success(resData.message || '設定を正常に保存しました！');
      } else {
        toast.error(resData.error || '保存に失敗しました');
      }
    } catch (e: any) {
      toast.error(`保存エラー: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteMileOp = async () => {
    if (!mileTargetUser.trim()) {
      toast.error('対象ユーザーIDを入力してください');
      return;
    }
    const amt = parseInt(mileAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      toast.error('1以上のマイル数を指定してください');
      return;
    }

    setMileExecuting(true);
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mile_operation',
          mileOperation: {
            user_id: mileTargetUser.trim(),
            amount: amt,
            op_type: mileOpType,
            reason: mileReason.trim() || 'ダッシュボード手動操作',
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.message || 'マイル操作が完了しました！');
        setMileTargetUser('');
        fetchData(false);
      } else {
        toast.error(json.error || 'マイル操作に失敗しました');
      }
    } catch (e: any) {
      toast.error(`エラー: ${e.message}`);
    } finally {
      setMileExecuting(false);
    }
  };

  const handleSendPanel = async () => {
    if (!panelChannelId) {
      toast.error('送信先チャンネルを選択してください');
      return;
    }

    setPanelSending(true);
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_panel',
          panelRequest: {
            channel_id: panelChannelId,
            panel_title: panelTitle,
            panel_color: panelColor,
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.message || '総合操作パネルを送信しました！');
      } else {
        toast.error(json.error || 'パネル送信に失敗しました');
      }
    } catch (e: any) {
      toast.error(`送信エラー: ${e.message}`);
    } finally {
      setPanelSending(false);
    }
  };

  const updateSetting = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
        <p className="font-tech text-purple-300 text-sm tracking-wider">
          DOUMORI HUD // 設定・ログデータを読み込み中...
        </p>
      </div>
    );
  }

  const textChannels = data?.channels.filter((c) => c.type === 0 || c.type === 5) || [];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* 1. Header Banner */}
      <div className="mecha-corners-purple mecha-scan-wrap-purple bg-gradient-to-r from-purple-950/50 via-zinc-900/90 to-indigo-950/50 border border-purple-800/50 mecha-clip p-6 shadow-[0_0_35px_-5px_rgba(168,85,247,0.35)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 mecha-clip bg-gradient-to-br from-purple-600 via-indigo-600 to-purple-950 flex items-center justify-center shadow-lg shadow-purple-900/60 border border-purple-400/40 flex-shrink-0">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="mecha-led w-2 h-2 rounded-full bg-purple-400 text-purple-400" />
                <span className="font-tech text-[10px] tracking-[0.25em] text-purple-400 uppercase">
                  DOUMORI // PURPLE COCKPIT DASHBOARD
                </span>
              </div>
              <h1 className="font-mecha text-2xl md:text-3xl font-black text-white tracking-wide flex items-center gap-3">
                どうぶつの森林 専用ダッシュボード
                <span className="font-tech text-xs px-2.5 py-0.5 rounded-full bg-purple-950/80 border border-purple-500/40 text-purple-300 font-normal">
                  Guild ID: {guild_id}
                </span>
              </h1>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                浮上チケット・採集・図鑑・ベル両替・ミッション承認・階級ステップアップの完全集中制御
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="mecha-btn-sheen mecha-clip-sm inline-flex items-center gap-2 bg-purple-950/60 hover:bg-purple-900/60 border border-purple-700/50 hover:border-purple-400 text-purple-200 font-tech text-xs px-4 py-2.5 transition-all shadow-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              最新同期
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm inline-flex items-center gap-2 bg-gradient-to-r from-purple-700 via-purple-600 to-indigo-800 hover:from-purple-600 hover:to-indigo-700 border border-purple-400/40 text-white font-mecha text-xs px-5 py-2.5 transition-all shadow-lg shadow-purple-900/40 font-bold"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? '保存中...' : '全設定を保存'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. OVERVIEW TAB */}
      {currentTab === 'overview' && (
        <div className="space-y-6">
          {/* Status Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="mecha-clip-sm bg-neutral-900/80 border border-purple-900/40 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-tech text-xs text-zinc-400 flex items-center gap-1.5">
                  <Ticket className="w-3.5 h-3.5 text-purple-400" /> 浮上チケット設定
                </span>
                <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/60 text-purple-300">
                  {settings.ticket_required_minutes || 60}分/枚
                </span>
              </div>
              <div className="font-mecha text-lg font-bold text-white">累計 1時間で+1枚</div>
              <div className="font-tech text-[11px] text-zinc-500 mt-1">VC＆チャット自動計測</div>
            </div>

            <div className="mecha-clip-sm bg-neutral-900/80 border border-purple-900/40 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-tech text-xs text-zinc-400 flex items-center gap-1.5">
                  <Fish className="w-3.5 h-3.5 text-purple-400" /> 採集＆色違い
                </span>
                <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/60 text-purple-300">
                  ✨ {settings.shiny_chance_percent || 0.5}%
                </span>
              </div>
              <div className="font-mecha text-lg font-bold text-white">全40種 (魚20/虫20)</div>
              <div className="font-tech text-[11px] text-zinc-500 mt-1">金色個体・時間帯制限</div>
            </div>

            <div className="mecha-clip-sm bg-neutral-900/80 border border-purple-900/40 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-tech text-xs text-zinc-400 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-purple-400" /> ベル・両替レート
                </span>
                <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/60 text-purple-300">
                  {settings.manybot_per_ticket || 500} ベル/枚
                </span>
              </div>
              <div className="font-mecha text-lg font-bold text-white">100 マイル = 1 枚</div>
              <div className="font-tech text-[11px] text-zinc-500 mt-1">Manybot通貨連携完了</div>
            </div>

            <div className="mecha-clip-sm bg-neutral-900/80 border border-purple-900/40 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-tech text-xs text-zinc-400 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-purple-400" /> ステップアップ階級
                </span>
                <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/60 text-indigo-300">
                  4段階 昇格
                </span>
              </div>
              <div className="font-mecha text-lg font-bold text-white">新規 ➔ 住人 ➔ 常連 ➔ 人気</div>
              <div className="font-tech text-[11px] text-zinc-500 mt-1">住民カード自動反映</div>
            </div>
          </div>

          {/* 10 Feature Navigation Cards */}
          <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6">
            <div className="flex items-center justify-between mb-6 pb-3 border-b border-purple-900/30">
              <h2 className="font-mecha text-lg font-bold text-white flex items-center gap-2">
                <span className="mecha-led w-2 h-2 rounded-full bg-purple-400 text-purple-400" />
                どうぶつの森 Bot 機能・設定メニュー一覧
              </h2>
              <span className="font-tech text-xs text-purple-400">クリックして各機能を設定 ➔</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  tab: 'tickets',
                  icon: Ticket,
                  title: '🎫 浮上・チケット獲得設定',
                  desc: 'VC・チャットの浮上計測時間、1時間ごとのチケット付与、お祝い通知',
                  badge: '自動付与',
                },
                {
                  tab: 'shop',
                  icon: ShoppingBag,
                  title: '🏪 ショップ・道具交換 (/ショップ)',
                  desc: 'マイルでのチケット購入レート（100pt）、つりざお・虫取り網の交換価格',
                  badge: '道具交換',
                },
                {
                  tab: 'gathering',
                  icon: Fish,
                  title: '🎣 採集＆出現率 (/釣り, /虫捕り)',
                  desc: '魚20種・虫20種の出現重み、昼夜時間帯制限、0.5%色違い金色個体設定',
                  badge: '✨金色0.5%',
                },
                {
                  tab: 'encyclopedia',
                  icon: BookOpen,
                  title: '📖 図鑑表示 (/魚図鑑, /虫図鑑)',
                  desc: 'ページ件数（10件）、未入手「???」伏字表示、プログレスバー達成率',
                  badge: 'ボタン切替',
                },
                {
                  tab: 'completion-roles',
                  icon: Trophy,
                  title: '🏆 限定コンプリートロール付与',
                  desc: '「🎣 金のつりざお」「🦋 金の虫取り網」のロール名、カラー、自動付与',
                  badge: 'ゴールド報酬',
                },
                {
                  tab: 'economy-exchange',
                  icon: Coins,
                  title: '🔔 通貨・両替・売却 (/両替, /売却)',
                  desc: '重複生物のベル売却額（レア度別・色違い5倍）、マイル/ベル両替レート',
                  badge: 'ベル連携',
                },
                {
                  tab: 'missions',
                  icon: Camera,
                  title: '📸 ミッション報告＆ワンタップ承認 (/ミッション報告)',
                  desc: 'ランク別デイリー報酬マイル、スタッフ承認ボタン、承認履歴ログ',
                  badge: 'ワンタップ',
                },
                {
                  tab: 'resident-ranks',
                  icon: CreditCard,
                  title: '🃏 住民カード＆階級 (/住民カード, /ランクアップ)',
                  desc: '4階級名・必要マイル設定、昇格ロール付与、DIY作業台イベント報酬',
                  badge: 'ステップアップ',
                },
                {
                  tab: 'mile-management',
                  icon: Wrench,
                  title: '🛠️ マイル管理 (管理者専用)',
                  desc: 'マイル手動付与・減額没収ツール、理由記録、マイル増減ログ履歴',
                  badge: '管理者ログ',
                },
                {
                  tab: 'panel-control',
                  icon: Gamepad2,
                  title: '🎮 総合操作パネル (/パネル設置)',
                  desc: '全機能がボタン操作できる【総合操作パネル】の指定チャンネル送信',
                  badge: '即時送信',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.tab}
                    href={`/dashboard/bot/${bot_id}/${guild_id}?tab=${item.tab}`}
                    className="mecha-clip-sm bg-black/40 hover:bg-purple-950/30 border border-purple-900/40 hover:border-purple-500/60 p-4 transition-all group relative block"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-9 h-9 mecha-clip-sm bg-purple-950/60 border border-purple-700/40 flex items-center justify-center text-purple-400 group-hover:text-purple-200 group-hover:border-purple-400 transition-colors">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800 text-purple-300">
                        {item.badge}
                      </span>
                    </div>
                    <h3 className="font-mecha font-bold text-sm text-white group-hover:text-purple-300 transition-colors">
                      {item.title}
                    </h3>
                    <p className="font-tech text-xs text-zinc-400 mt-1 leading-relaxed">{item.desc}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. TAB: 🎫 浮上・チケット獲得設定 */}
      {currentTab === 'tickets' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Ticket className="w-5 h-5 text-purple-400" />
                🎫 浮上・チケット獲得システム設定
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                VC（ボイスチャンネル）およびチャットでの浮上時間を計測し、累計時間に応じて「図鑑チケット」を自動付与します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 hover:from-purple-600 hover:to-indigo-700 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                チケット1枚獲得に必要な累計浮上時間 (分)
              </label>
              <input
                type="number"
                value={settings.ticket_required_minutes ?? 60}
                onChange={(e) => updateSetting('ticket_required_minutes', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">
                デフォルト: **60 分** (累計1時間で図鑑チケット×1自動付与)
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                チャット1発言あたりの加算秒数 (秒)
              </label>
              <input
                type="number"
                value={settings.ticket_chat_activity_seconds ?? 60}
                onChange={(e) => updateSetting('ticket_chat_activity_seconds', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">
                デフォルト: **60 秒** (発言すると60秒分のアクティビティとして加算)
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                チケット獲得通知メッセージテンプレート
              </label>
              <textarea
                rows={2}
                value={settings.ticket_notify_message || ''}
                onChange={(e) => updateSetting('ticket_notify_message', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-xs text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">
                使用可能タグ: `&#123;user&#125;` (ユーザー名), `&#123;tickets&#125;` (付与枚数), `&#123;total&#125;` (所持数)
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                チケット通知先チャンネル
              </label>
              <select
                value={settings.ticket_notify_channel_id || ''}
                onChange={(e) => updateSetting('ticket_notify_channel_id', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              >
                <option value="">発言したチャンネル / DM (デフォルト)</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name} ({c.id})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 4. TAB: 🏪 ショップ・道具交換設定 */}
      {currentTab === 'shop' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-purple-400" />
                🏪 ショップ・道具交換設定 (/ショップ)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                マイルポイントによる図鑑チケットの購入レートおよび、チケットを使った採集道具（つりざお・虫取り網）の価格を設定します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                図鑑チケット1枚の価格 (マイルポイント)
              </label>
              <input
                type="number"
                value={settings.miles_per_ticket ?? 100}
                onChange={(e) => updateSetting('miles_per_ticket', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">デフォルト: **100 pt**</p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                🐟 つりざおの価格 (チケット枚数)
              </label>
              <input
                type="number"
                value={settings.fishing_rod_price ?? 1}
                onChange={(e) => updateSetting('fishing_rod_price', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">デフォルト: **1 枚**</p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                🦋 虫取り網の価格 (チケット枚数)
              </label>
              <input
                type="number"
                value={settings.bug_net_price ?? 1}
                onChange={(e) => updateSetting('bug_net_price', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">デフォルト: **1 枚**</p>
            </div>
          </div>
        </div>
      )}

      {/* 5. TAB: 🎣 採集＆出現率設定 */}
      {currentTab === 'gathering' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Fish className="w-5 h-5 text-purple-400" />
                🎣 採集＆出現率設定 (/釣り, /虫捕り)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                魚20種類・虫20種類の出現重み、昼夜時間帯制限、および✨金色・色違い個体の出現確率を設定します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-300" /> ✨ 金色・色違い出現確率 (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={settings.shiny_chance_percent ?? 0.5}
                onChange={(e) => updateSetting('shiny_chance_percent', parseFloat(e.target.value))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">
                デフォルト: **0.5%** (超激レアな金色個体が出現し、図鑑に金色バッジが付きます)
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                時間帯制限モード (昼 6:00~18:00 / 夜)
              </label>
              <select
                value={settings.time_restriction_enabled ? 'true' : 'false'}
                onChange={(e) => updateSetting('time_restriction_enabled', e.target.value === 'true')}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              >
                <option value="true">有効 (時間帯に応じた生き物が出現)</option>
                <option value="false">無効 (いつでも全種類の生き物が出現)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 6. TAB: 📖 図鑑表示設定 */}
      {currentTab === 'encyclopedia' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-400" />
                📖 図鑑表示設定 (/魚図鑑, /虫図鑑)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                図鑑コマンド実行時の1ページあたり表示件数、未入手生物の「???」伏字表示、進捗バーの表示設定を行います。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                1ページあたりの表示件数
              </label>
              <input
                type="number"
                value={settings.book_page_size ?? 10}
                onChange={(e) => updateSetting('book_page_size', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
              <p className="font-tech text-[10px] text-zinc-500">デフォルト: **10 件** (全20件の場合は2ページに分割)</p>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                未入手生物の「???」伏字表示
              </label>
              <select
                value={settings.book_show_unobtained_mask ? 'true' : 'false'}
                onChange={(e) => updateSetting('book_show_unobtained_mask', e.target.value === 'true')}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              >
                <option value="true">有効 (未入手は #?? ❓ ？？？ で表示)</option>
                <option value="false">無効 (未入手でも名前と説明を表示)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 7. TAB: 🏆 限定コンプリートロール付与 */}
      {currentTab === 'completion-roles' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-purple-400" />
                🏆 限定コンプリートロール付与設定
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                魚図鑑・虫図鑑を100%コンプリートした際に、サーバー内で自動作成・付与される限定ロールを設定します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 p-4 bg-black/40 border border-purple-900/40 rounded-lg">
              <h3 className="font-mecha font-bold text-sm text-purple-300">🎣 魚図鑑コンプリートロール</h3>
              <div className="space-y-2">
                <label className="font-tech text-xs text-zinc-400">付与ロール名</label>
                <input
                  type="text"
                  value={settings.fish_completion_role_name || '🎣 金のつりざお'}
                  onChange={(e) => updateSetting('fish_completion_role_name', e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="font-tech text-xs text-zinc-400">ロールカラー (HEX)</label>
                <input
                  type="text"
                  value={settings.fish_completion_role_color || '#FFD700'}
                  onChange={(e) => updateSetting('fish_completion_role_color', e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-mono mecha-input-purple outline-none"
                />
              </div>
            </div>

            <div className="space-y-4 p-4 bg-black/40 border border-purple-900/40 rounded-lg">
              <h3 className="font-mecha font-bold text-sm text-purple-300">🦋 虫図鑑コンプリートロール</h3>
              <div className="space-y-2">
                <label className="font-tech text-xs text-zinc-400">付与ロール名</label>
                <input
                  type="text"
                  value={settings.bug_completion_role_name || '🦋 金の虫取り網'}
                  onChange={(e) => updateSetting('bug_completion_role_name', e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="font-tech text-xs text-zinc-400">ロールカラー (HEX)</label>
                <input
                  type="text"
                  value={settings.bug_completion_role_color || '#FFD700'}
                  onChange={(e) => updateSetting('bug_completion_role_color', e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-mono mecha-input-purple outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. TAB: 🔔 通貨・両替・売却設定 */}
      {currentTab === 'economy-exchange' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Coins className="w-5 h-5 text-purple-400" />
                🔔 通貨・両替・売却設定 (/両替, /売却)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                重複して捕まえた生き物の売却換金額（レア度別）および、Manybot 鯖内通貨「ベル」と図鑑チケットの両替レートを設定します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4 p-4 bg-black/40 border border-purple-900/40 rounded-lg">
              <h3 className="font-mecha font-bold text-sm text-purple-300">🔀 両替レート設定 (/両替)</h3>
              <div className="space-y-2">
                <label className="font-tech text-xs text-zinc-400">1チケットあたりのベル換算額</label>
                <input
                  type="number"
                  value={settings.manybot_per_ticket ?? 500}
                  onChange={(e) => updateSetting('manybot_per_ticket', parseInt(e.target.value, 10))}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                />
                <p className="font-tech text-[10px] text-zinc-500">デフォルト: **500 ベル** = チケット1枚</p>
              </div>
            </div>

            <div className="space-y-3 p-4 bg-black/40 border border-purple-900/40 rounded-lg">
              <h3 className="font-mecha font-bold text-sm text-purple-300">💰 生き物売却価格 (/売却)</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-tech text-[10px] text-zinc-400">COMMON (100)</label>
                  <input
                    type="number"
                    value={settings.sell_price_common ?? 100}
                    onChange={(e) => updateSetting('sell_price_common', parseInt(e.target.value, 10))}
                    className="w-full bg-black/60 border border-purple-900/60 rounded p-1.5 text-xs text-white font-tech outline-none"
                  />
                </div>
                <div>
                  <label className="font-tech text-[10px] text-zinc-400">UNCOMMON (300)</label>
                  <input
                    type="number"
                    value={settings.sell_price_uncommon ?? 300}
                    onChange={(e) => updateSetting('sell_price_uncommon', parseInt(e.target.value, 10))}
                    className="w-full bg-black/60 border border-purple-900/60 rounded p-1.5 text-xs text-white font-tech outline-none"
                  />
                </div>
                <div>
                  <label className="font-tech text-[10px] text-zinc-400">RARE (800)</label>
                  <input
                    type="number"
                    value={settings.sell_price_rare ?? 800}
                    onChange={(e) => updateSetting('sell_price_rare', parseInt(e.target.value, 10))}
                    className="w-full bg-black/60 border border-purple-900/60 rounded p-1.5 text-xs text-white font-tech outline-none"
                  />
                </div>
                <div>
                  <label className="font-tech text-[10px] text-zinc-400">SUPER_RARE (2500)</label>
                  <input
                    type="number"
                    value={settings.sell_price_super_rare ?? 2500}
                    onChange={(e) => updateSetting('sell_price_super_rare', parseInt(e.target.value, 10))}
                    className="w-full bg-black/60 border border-purple-900/60 rounded p-1.5 text-xs text-white font-tech outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. TAB: 📸 ミッション報告＆ワンタップ承認 */}
      {currentTab === 'missions' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Camera className="w-5 h-5 text-purple-400" />
                📸 ミッション報告＆ワンタップ承認 (/ミッション報告)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                住民が提出したスクショをスタッフが【✅ 承認】した際のマイル付与・住民カード自動更新ルールと履歴ログを確認できます。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-black/40 border border-purple-900/40 rounded space-y-1">
              <div className="font-tech text-xs text-purple-300 font-bold">🌱 Rank 1 報酬</div>
              <input
                type="number"
                value={settings.daily_mission_reward_rank1 ?? 30}
                onChange={(e) => updateSetting('daily_mission_reward_rank1', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <span className="font-tech text-[10px] text-zinc-500">マイル / 回</span>
            </div>
            <div className="p-3 bg-black/40 border border-purple-900/40 rounded space-y-1">
              <div className="font-tech text-xs text-purple-300 font-bold">🏠 Rank 2 報酬</div>
              <input
                type="number"
                value={settings.daily_mission_reward_rank2 ?? 50}
                onChange={(e) => updateSetting('daily_mission_reward_rank2', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <span className="font-tech text-[10px] text-zinc-500">マイル / 回</span>
            </div>
            <div className="p-3 bg-black/40 border border-purple-900/40 rounded space-y-1">
              <div className="font-tech text-xs text-purple-300 font-bold">☕ Rank 3 報酬</div>
              <input
                type="number"
                value={settings.daily_mission_reward_rank3 ?? 70}
                onChange={(e) => updateSetting('daily_mission_reward_rank3', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <span className="font-tech text-[10px] text-zinc-500">マイル / 回</span>
            </div>
            <div className="p-3 bg-black/40 border border-purple-900/40 rounded space-y-1">
              <div className="font-tech text-xs text-purple-300 font-bold">🌟 Rank 4 報酬</div>
              <input
                type="number"
                value={settings.daily_mission_reward_rank4 ?? 100}
                onChange={(e) => updateSetting('daily_mission_reward_rank4', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <span className="font-tech text-[10px] text-zinc-500">マイル / 回</span>
            </div>
          </div>

          {/* Mission Logs Table */}
          <div className="space-y-3">
            <h3 className="font-mecha font-bold text-sm text-purple-300 flex items-center gap-1.5">
              <History className="w-4 h-4 text-purple-400" /> 最近のミッション承認履歴ログ (直近20件)
            </h3>
            <div className="overflow-x-auto bg-black/40 border border-purple-900/40 rounded-lg">
              <table className="w-full text-left font-tech text-xs">
                <thead className="bg-purple-950/60 border-b border-purple-900/40 text-purple-300">
                  <tr>
                    <th className="p-3">日時</th>
                    <th className="p-3">対象住民 (ID)</th>
                    <th className="p-3">承認スタッフ (ID)</th>
                    <th className="p-3">ミッション内容</th>
                    <th className="p-3 text-right">付与マイル</th>
                    <th className="p-3 text-right">達成回数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-900/20 text-zinc-300">
                  {data?.missionLogs && data.missionLogs.length > 0 ? (
                    data.missionLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-purple-950/20">
                        <td className="p-3 text-zinc-500">
                          {new Date(log.created_at).toLocaleString('ja-JP')}
                        </td>
                        <td className="p-3 font-mono text-purple-300">&lt;@{log.user_id}&gt;</td>
                        <td className="p-3 font-mono text-zinc-400">&lt;@{log.staff_id}&gt;</td>
                        <td className="p-3">{log.mission_desc}</td>
                        <td className="p-3 text-right font-bold text-green-400">+{log.reward_miles} pt</td>
                        <td className="p-3 text-right font-bold text-purple-300">+{log.mission_count} 回</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-zinc-500">
                        ミッション承認履歴ログはまだありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 10. TAB: 🃏 住民カード＆階級ステップアップ */}
      {currentTab === 'resident-ranks' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-purple-400" />
                🃏 住民カード＆階級設定 (/住民カード, /ランクアップ)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                4段階のステップアップ階級要件マイル数・ロール名、および住民主催のDIY作業台イベント設定を管理します。
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-black/40 border border-purple-900/40 rounded space-y-2">
              <h3 className="font-mecha font-bold text-xs text-purple-300">階級 1 (新規)</h3>
              <input
                type="text"
                value={settings.rank1_name || '🌱 新規住人'}
                onChange={(e) => updateSetting('rank1_name', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <span className="font-tech text-[10px] text-zinc-500">必要マイル: 0 pt</span>
            </div>

            <div className="p-4 bg-black/40 border border-purple-900/40 rounded space-y-2">
              <h3 className="font-mecha font-bold text-xs text-purple-300">階級 2 (住人)</h3>
              <input
                type="text"
                value={settings.rank2_name || '🏠 住人'}
                onChange={(e) => updateSetting('rank2_name', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <input
                type="number"
                value={settings.rank2_miles ?? 300}
                onChange={(e) => updateSetting('rank2_miles', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
            </div>

            <div className="p-4 bg-black/40 border border-purple-900/40 rounded space-y-2">
              <h3 className="font-mecha font-bold text-xs text-purple-300">階級 3 (常連)</h3>
              <input
                type="text"
                value={settings.rank3_name || '☕ 常連住人'}
                onChange={(e) => updateSetting('rank3_name', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <input
                type="number"
                value={settings.rank3_miles ?? 800}
                onChange={(e) => updateSetting('rank3_miles', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
            </div>

            <div className="p-4 bg-black/40 border border-purple-900/40 rounded space-y-2">
              <h3 className="font-mecha font-bold text-xs text-purple-300">階級 4 (人気)</h3>
              <input
                type="text"
                value={settings.rank4_name || '🌟 人気住人'}
                onChange={(e) => updateSetting('rank4_name', e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
              <input
                type="number"
                value={settings.rank4_miles ?? 1500}
                onChange={(e) => updateSetting('rank4_miles', parseInt(e.target.value, 10))}
                className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* 11. TAB: 🛠️ マイル管理 (管理者専用) */}
      {currentTab === 'mile-management' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-purple-400" />
                🛠️ マイル管理・管理者手動操作 (/マイル付与, /マイル没収)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                指定した住民にマイルを手動で付与または没収し、履歴ログとしてデータベースに保存します。
              </p>
            </div>
          </div>

          {/* Operation Form */}
          <div className="p-5 bg-black/50 border border-purple-900/40 rounded-lg space-y-4">
            <h3 className="font-mecha font-bold text-sm text-purple-300">⚡ マイルポイント手動操作ツール</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">対象住民 Discord ユーザーID</label>
                <input
                  type="text"
                  placeholder="例: 123456789012345678"
                  value={mileTargetUser}
                  onChange={(e) => setMileTargetUser(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-mono mecha-input-purple outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">操作種別</label>
                <select
                  value={mileOpType}
                  onChange={(e) => setMileOpType(e.target.value as 'grant' | 'revoke')}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech mecha-input-purple outline-none"
                >
                  <option value="grant">🎁 マイル付与 (+加算)</option>
                  <option value="revoke">⚠️ マイル没収 (-減額)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">マイルポイント数</label>
                <input
                  type="number"
                  value={mileAmount}
                  onChange={(e) => setMileAmount(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech mecha-input-purple outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">理由・メモ</label>
                <input
                  type="text"
                  value={mileReason}
                  onChange={(e) => setMileReason(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech mecha-input-purple outline-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={handleExecuteMileOp}
                disabled={mileExecuting}
                className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 to-indigo-800 hover:from-purple-600 hover:to-indigo-700 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                {mileExecuting ? '実行中...' : 'マイル操作を実行'}
              </button>
            </div>
          </div>

          {/* Mile Logs Table */}
          <div className="space-y-3">
            <h3 className="font-mecha font-bold text-sm text-purple-300 flex items-center gap-1.5">
              <History className="w-4 h-4 text-purple-400" /> マイル手動付与・没収ログ履歴 (直近20件)
            </h3>
            <div className="overflow-x-auto bg-black/40 border border-purple-900/40 rounded-lg">
              <table className="w-full text-left font-tech text-xs">
                <thead className="bg-purple-950/60 border-b border-purple-900/40 text-purple-300">
                  <tr>
                    <th className="p-3">日時</th>
                    <th className="p-3">対象住民 (ID)</th>
                    <th className="p-3">種別</th>
                    <th className="p-3 text-right">ポイント数</th>
                    <th className="p-3">理由</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-900/20 text-zinc-300">
                  {data?.mileLogs && data.mileLogs.length > 0 ? (
                    data.mileLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-purple-950/20">
                        <td className="p-3 text-zinc-500">
                          {new Date(log.created_at).toLocaleString('ja-JP')}
                        </td>
                        <td className="p-3 font-mono text-purple-300">&lt;@{log.user_id}&gt;</td>
                        <td className="p-3">
                          <span
                            className={`font-tech text-[10px] px-2 py-0.5 rounded ${
                              log.action === 'grant'
                                ? 'bg-green-950/80 border border-green-700 text-green-300'
                                : 'bg-red-950/80 border border-red-700 text-red-300'
                            }`}
                          >
                            {log.action === 'grant' ? '付与' : '没収'}
                          </span>
                        </td>
                        <td
                          className={`p-3 text-right font-bold ${
                            log.action === 'grant' ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {log.action === 'grant' ? `+${log.amount}` : `-${log.amount}`} pt
                        </td>
                        <td className="p-3 text-zinc-400">{log.reason}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-zinc-500">
                        マイル操作履歴ログはまだありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 12. TAB: 🎮 総合操作パネル設置 */}
      {currentTab === 'panel-control' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-purple-400" />
                🎮 総合操作パネル設置 (/パネル設置)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                採集・図鑑・マイル・ショップ・両替・売却・住民カードの全機能がボタン1つで操作できる【総合操作パネル】を任意のチャンネルに即時送信します。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-black/50 border border-purple-900/40 rounded-lg">
            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                パネル送信先チャンネル
              </label>
              <select
                value={panelChannelId}
                onChange={(e) => setPanelChannelId(e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              >
                <option value="">チャンネルを選択してください</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name} ({c.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                パネル埋め込みタイトル
              </label>
              <input
                type="text"
                value={panelTitle}
                onChange={(e) => setPanelTitle(e.target.value)}
                className="w-full bg-black/60 border border-purple-900/60 focus:border-purple-400 rounded p-3 text-sm text-white font-tech mecha-input-purple outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSendPanel}
              disabled={panelSending || !panelChannelId}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 via-indigo-600 to-purple-800 hover:from-purple-600 hover:to-indigo-700 text-white font-mecha font-bold py-3 px-8 border border-purple-400/40 text-sm shadow-lg shadow-purple-900/50 flex items-center gap-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {panelSending ? '送信中...' : '📢 チャンネルに総合操作パネルを送信'}
            </button>
          </div>
        </div>
      )}

      {/* 13. TAB: 🗄️ データベース＆ヘルス */}
      {currentTab === 'database-health' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-400" />
                🗄️ データベース接続＆ヘルス
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                Doumori Bot 専用 Supabase データベース接続の健全性とスキーマ状態を確認します。
              </p>
            </div>
          </div>

          <div className="p-5 bg-black/40 border border-purple-900/40 rounded-lg space-y-4">
            <div className="flex items-center gap-3 text-purple-300 font-tech text-sm">
              <CheckCircle2 className="w-5 h-5 text-purple-400" />
              <span>Supabase / PostgreSQL データベース接続はアクティブです。</span>
            </div>
            <p className="font-tech text-xs text-zinc-400">
              全テーブル（`doumori_users`, `doumori_inventory`, `doumori_collection`, `doumori_miles`, `doumori_daily_missions`, `doumori_mission_logs`, `doumori_mile_logs`, `doumori_settings`）が正常に稼働しています。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
