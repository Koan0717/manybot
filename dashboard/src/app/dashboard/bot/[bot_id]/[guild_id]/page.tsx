'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import ChannelSelect from '@/components/ChannelSelect';
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
  Users,
  Key,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react';

interface Mission {
  id: number;
  title: string;
  description: string;
  target_rank: number;
  reward_miles: number;
  is_active: boolean;
  times_assigned: number;
  times_completed: number;
  completion_rate: number;
}

interface RankConfig {
  level: number;
  name: string;
  required_miles: number;
  color: string;
  role_name: string;
}

interface StatusData {
  settings: Record<string, any>;
  missionsMaster?: Mission[];
  missionStats?: any;
  ranksMaster?: RankConfig[];
  missionLogs: any[];
  mileLogs: any[];
  databaseUrl?: string;
  channels: Array<{ id: string; name: string; type: number }>;
  roles: Array<{ id: string; name: string; color: number }>;
}

const MISSION_TEMPLATES = [
  { title: "VC交流", desc: "VCに通算30分以上参加する", miles: 100 },
  { title: "雑談チャット", desc: "雑談チャンネルで3回以上メッセージを発言する", miles: 100 },
  { title: "魚釣り挑戦", desc: "`/釣り` で魚を1匹以上釣り上げる", miles: 100 },
  { title: "虫捕り挑戦", desc: "`/虫捕り` で虫を1匹以上捕まえる", miles: 100 },
  { title: "ショップ利用", desc: "`/ショップ` または `/両替` を1回利用する", miles: 100 },
  { title: "生き物売却", desc: "`/売却` で重複した生き物を売却してゼニーにする", miles: 100 },
  { title: "VC長時間滞在", desc: "VCに通算1時間以上参加してメンバーと交流する", miles: 100 },
  { title: "レア捕獲", desc: "レア度RARE以上の生き物を1匹捕獲する", miles: 100 },
  { title: "イベント参加", desc: "DIY作業台イベントや鯖内イベントに参加・告知する", miles: 100 },
];

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
  const [missionsMaster, setMissionsMaster] = useState<Mission[]>([]);
  const [missionStats, setMissionStats] = useState<any>(null);
  const [ranksMaster, setRanksMaster] = useState<RankConfig[]>([
    { level: 1, name: '🌱 新規住人', required_miles: 0, color: '#A8E6CF', role_name: '新規住人' },
    { level: 2, name: '🏠 住人', required_miles: 4000, color: '#3498DB', role_name: '住人' },
    { level: 3, name: '☕ 常連住人', required_miles: 15000, color: '#E67E22', role_name: '常連住人' },
    { level: 4, name: '🌟 人気住人', required_miles: 45000, color: '#FFD700', role_name: '人気住人' },
  ]);
  const [doumoriDatabaseUrl, setDoumoriDatabaseUrl] = useState('');
  const [showDbUrl, setShowDbUrl] = useState(false);
  const [savingDb, setSavingDb] = useState(false);

  // Mission Modal State
  const [isMissionModalOpen, setIsMissionModalOpen] = useState(false);
  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalRank, setModalRank] = useState(0);
  const [modalMiles, setModalMiles] = useState(100);
  const [savingMission, setSavingMission] = useState(false);
  const [filterRank, setFilterRank] = useState<number>(-1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRanks, setSavingRanks] = useState(false);

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

  // Dedicated Accounts State
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('botadmin');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<number | null>(null);
  const [showPasswordMap, setShowPasswordMap] = useState<Record<number, boolean>>({});

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot_id}/${guild_id}/accounts`);
      if (res.ok) {
        const json = await res.json();
        setAccounts(Array.isArray(json) ? json : []);
      }
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [bot_id, guild_id]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error('ユーザー名とパスワードを入力してください');
      return;
    }
    setCreatingAccount(true);
    try {
      const res = await fetch(`/api/bots/${bot_id}/${guild_id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword.trim(),
          role: newRole,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`専用アカウント「${json.username}」を作成しました！`);
        setNewUsername('');
        setNewPassword('');
        fetchAccounts();
      } else {
        toast.error(json.error || 'アカウント作成に失敗しました');
      }
    } catch (err: any) {
      toast.error(`作成エラー: ${err.message}`);
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleDeleteAccount = async (id: number, uname: string) => {
    if (!confirm(`専用アカウント「${uname}」を削除しますか？\nこのアカウントではログインできなくなります。`)) return;
    setDeletingAccountId(id);
    try {
      const res = await fetch(`/api/bots/${bot_id}/${guild_id}/accounts?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`アカウント「${uname}」を削除しました`);
        fetchAccounts();
      } else {
        const json = await res.json();
        toast.error(json.error || '削除に失敗しました');
      }
    } catch (err: any) {
      toast.error(`削除エラー: ${err.message}`);
    } finally {
      setDeletingAccountId(null);
    }
  };

  const fetchData = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const res = await fetch(`/api/guilds/${guild_id}/doumori`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData(json);
        setSettings(json.settings || {});
        if (Array.isArray(json.missionsMaster)) {
          setMissionsMaster(json.missionsMaster);
        }
        if (json.missionStats) {
          setMissionStats(json.missionStats);
        }
        if (Array.isArray(json.ranksMaster) && json.ranksMaster.length > 0) {
          setRanksMaster(json.ranksMaster);
        }
        if (json.databaseUrl !== undefined) {
          setDoumoriDatabaseUrl(json.databaseUrl);
        }
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

  const handleOpenCreateMission = () => {
    setEditingMission(null);
    setModalTitle('');
    setModalDesc('');
    setModalRank(0);
    setModalMiles(100);
    setIsMissionModalOpen(true);
  };

  const handleOpenEditMission = (m: Mission) => {
    setEditingMission(m);
    setModalTitle(m.title);
    setModalDesc(m.description);
    setModalRank(m.target_rank);
    setModalMiles(m.reward_miles);
    setIsMissionModalOpen(true);
  };

  const handleSaveMission = async () => {
    if (!modalTitle.trim() || !modalDesc.trim()) {
      toast.error('タイトルと達成条件を入力してください');
      return;
    }

    setSavingMission(true);
    try {
      const isEdit = !!editingMission;
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isEdit ? 'update_mission' : 'create_mission',
          mission: {
            id: editingMission?.id,
            title: modalTitle.trim(),
            description: modalDesc.trim(),
            target_rank: modalRank,
            reward_miles: modalMiles,
          },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'ミッションを保存しました！');
        setIsMissionModalOpen(false);
        fetchData();
      } else {
        toast.error(json.error || '保存に失敗しました');
      }
    } catch (err: any) {
      toast.error(`エラー: ${err.message}`);
    } finally {
      setSavingMission(false);
    }
  };

  const handleToggleMissionActive = async (m: Mission) => {
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_mission',
          mission: {
            id: m.id,
            is_active: !m.is_active,
          },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`ミッションを ${!m.is_active ? '有効化' : '停止'} しました`);
        fetchData();
      } else {
        toast.error(json.error || '切替に失敗しました');
      }
    } catch {
      toast.error('操作に失敗しました');
    }
  };

  const handleDeleteMission = async (id: number) => {
    if (!confirm('このミッションを削除しますか？')) return;
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_mission',
          mission: { id },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('ミッションを削除しました');
        fetchData();
      } else {
        toast.error(json.error || '削除に失敗しました');
      }
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  const updateRankField = (level: number, field: keyof RankConfig, value: any) => {
    setRanksMaster((prev) =>
      prev.map((r) => (r.level === level ? { ...r, [field]: value } : r))
    );
  };

  const handleSaveRanks = async () => {
    setSavingRanks(true);
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_ranks',
          ranks: ranksMaster,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || '階級・ランク設定を保存しました！Bot側に即座に反映されます。');
      } else {
        toast.error(json.error || '保存に失敗しました');
      }
    } catch (err: any) {
      toast.error(`エラー: ${err.message}`);
    } finally {
      setSavingRanks(false);
    }
  };

  const handleSaveDatabase = async () => {
    setSavingDb(true);
    try {
      const res = await fetch(`/api/guilds/${guild_id}/doumori`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_database',
          database_url: doumoriDatabaseUrl.trim(),
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'データベース設定を保存しました！');
      } else {
        toast.error(json.error || '保存に失敗しました');
      }
    } catch (err: any) {
      toast.error(`保存エラー: ${err.message}`);
    } finally {
      setSavingDb(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (currentTab === 'accounts' || currentTab === 'overview') {
      fetchAccounts();
    }
  }, [currentTab, fetchAccounts]);

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
                  <Coins className="w-3.5 h-3.5 text-purple-400" /> ゼニー・両替レート
                </span>
                <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/60 text-purple-300">
                  {settings.manybot_per_ticket || 500} ゼニー/枚
                </span>
              </div>
              <div className="font-mecha text-lg font-bold text-white">100 マイル = 1 枚</div>
              <div className="font-tech text-[11px] text-zinc-500 mt-1">Manybot通貨 (ゼニー) 連携</div>
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
                  title: '🪙 通貨・両替・売却 (/両替, /売却)',
                  desc: '重複生物のゼニー売却額（レア度別・色違い5倍）、マイル/ゼニー両替レート',
                  badge: 'ゼニー連携',
                },
                {
                  tab: 'missions',
                  icon: Camera,
                  title: '📸 デイリーミッション一覧・作成・統計',
                  desc: '1日3枠・100マイル報酬、新規ミッション作成（ワンクリックテンプレート）、受注統計・見直し',
                  badge: '1日3枠/300pt',
                },
                {
                  tab: 'resident-ranks',
                  icon: CreditCard,
                  title: '🃏 住民カード＆階級・ランクアップ設定',
                  desc: '4段階ランク（新規 ➔ 4,000pt ➔ 15,000pt ➔ 45,000pt）の必要マイル・ロール・カラー設定',
                  badge: '4段階昇格',
                },
                {
                  tab: 'database-health',
                  icon: Database,
                  title: '🗄️ データベース接続＆ヘルス',
                  desc: 'DOUMORI_DATABASE_URL の設定・表示切替・接続テスト・テーブル健全性確認',
                  badge: 'Supabase',
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
                {
                  tab: 'accounts',
                  icon: Users,
                  title: '👤 専用アカウント設定',
                  desc: 'このBot専用のログインID・パスワード作成＆限定アクセス権限管理',
                  badge: '限定アクセス',
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
              <ChannelSelect
                label="チケット通知先チャンネル"
                placeholder="発言したチャンネル / DM (デフォルト)"
                channels={textChannels}
                value={settings.ticket_notify_channel_id || ''}
                onChange={(id: any) => updateSetting('ticket_notify_channel_id', id || '')}
                multiple={false}
              />
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

      {/* 8. TAB: 🪙 通貨・両替・売却設定 */}
      {currentTab === 'economy-exchange' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Coins className="w-5 h-5 text-purple-400" />
                🪙 通貨・両替・売却設定 (/両替, /売却)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                重複して捕まえた生き物の売却換金額（レア度別）および、Manybot 鯖内通貨「ゼニー」と図鑑チケットの両替レートを設定します。
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
                <label className="font-tech text-xs text-zinc-400">1チケットあたりのゼニー換算額</label>
                <input
                  type="number"
                  value={settings.manybot_per_ticket ?? 500}
                  onChange={(e) => updateSetting('manybot_per_ticket', parseInt(e.target.value, 10))}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                />
                <p className="font-tech text-[10px] text-zinc-500">デフォルト: **500 ゼニー** = チケット1枚</p>
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

      {/* 9. TAB: 📸 ミッション設定・一覧・作成・統計管理 */}
      {currentTab === 'missions' && (
        <div className="space-y-6">
          <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-purple-900/30">
              <div>
                <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                  <Camera className="w-5 h-5 text-purple-400" />
                  📸 デイリーミッション一覧・作成・統計管理
                </h2>
                <p className="font-tech text-xs text-zinc-400 mt-1">
                  1日の受注数は **3枠**（1ミッション達成につき **100マイル** 付与 / 3つで **+300マイル**）です。<br />
                  ダッシュボード上で新しいミッションの追加、条件や報酬の設定、受注が少ないミッションの見直しが簡単に行えます。
                </p>
              </div>
              <button
                onClick={handleOpenCreateMission}
                className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mecha font-bold py-2.5 px-5 border border-purple-400/40 text-xs shadow-lg flex items-center gap-2 whitespace-nowrap self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                ＋ 新規ミッション作成
              </button>
            </div>

            {/* Overview Stats HUD */}
            {missionStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-black/50 border border-purple-900/50 rounded-lg">
                  <span className="font-tech text-[10px] text-zinc-500 block mb-0.5">TOTAL / ACTIVE</span>
                  <div className="font-mecha text-lg font-black text-white flex items-baseline gap-1">
                    <span className="text-purple-400">{missionStats.activeMissions}</span>
                    <span className="text-xs text-zinc-500">/ {missionStats.totalMissions} 件</span>
                  </div>
                </div>
                <div className="p-3 bg-black/50 border border-indigo-900/50 rounded-lg">
                  <span className="font-tech text-[10px] text-zinc-500 block mb-0.5">TOTAL ASSIGNED</span>
                  <div className="font-mecha text-lg font-black text-indigo-300">
                    {missionStats.totalAssigned.toLocaleString()} <span className="text-xs text-zinc-500">回受注</span>
                  </div>
                </div>
                <div className="p-3 bg-black/50 border border-amber-900/50 rounded-lg">
                  <span className="font-tech text-[10px] text-zinc-500 block mb-0.5">TOTAL COMPLETED</span>
                  <div className="font-mecha text-lg font-black text-amber-300">
                    {missionStats.totalCompleted.toLocaleString()} <span className="text-xs text-zinc-500">回達成</span>
                  </div>
                </div>
                <div className="p-3 bg-black/50 border border-emerald-900/50 rounded-lg">
                  <span className="font-tech text-[10px] text-zinc-500 block mb-0.5">COMPLETION RATE</span>
                  <div className="font-mecha text-lg font-black text-emerald-400">
                    {missionStats.overallCompletionRate}%
                  </div>
                </div>
              </div>
            )}

            {/* Filter bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-black/40 border border-purple-900/30 rounded-lg">
              <div className="flex flex-wrap items-center gap-2 text-xs font-tech text-zinc-400">
                <span>対象ランク絞り込み:</span>
                {[
                  { label: 'すべて', val: -1 },
                  { label: '全ランク共通 (0)', val: 0 },
                  { label: '🌱 新規 (1)', val: 1 },
                  { label: '🏠 住人 (2)', val: 2 },
                  { label: '☕ 常連 (3)', val: 3 },
                  { label: '🌟 人気 (4)', val: 4 },
                ].map((btn) => (
                  <button
                    key={btn.val}
                    type="button"
                    onClick={() => setFilterRank(btn.val)}
                    className={`px-2.5 py-1 rounded text-[11px] font-tech transition-colors ${
                      filterRank === btn.val
                        ? 'bg-purple-600 text-white font-bold'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <span className="text-xs font-tech text-zinc-500">
                表示中: {filterRank === -1 ? missionsMaster.length : missionsMaster.filter((m) => m.target_rank === filterRank).length} 件
              </span>
            </div>

            {/* Missions Table */}
            <div className="overflow-x-auto bg-black/50 border border-purple-900/40 rounded-lg">
              <table className="w-full text-left font-tech text-xs">
                <thead className="bg-purple-950/60 border-b border-purple-900/40 text-purple-300">
                  <tr>
                    <th className="p-3">状態</th>
                    <th className="p-3">ミッション名</th>
                    <th className="p-3">達成条件・内容</th>
                    <th className="p-3">対象ランク</th>
                    <th className="p-3">報酬マイル</th>
                    <th className="p-3">受注数 / 達成</th>
                    <th className="p-3">達成率</th>
                    <th className="p-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-900/20 text-zinc-300">
                  {(filterRank === -1 ? missionsMaster : missionsMaster.filter((m) => m.target_rank === filterRank)).map((m) => {
                    const isLowAssigned = missionStats && missionStats.averageAssigned > 5 && m.times_assigned < missionStats.averageAssigned * 0.4;

                    return (
                      <tr key={m.id} className={`hover:bg-purple-950/20 transition-colors ${!m.is_active ? 'opacity-50' : ''}`}>
                        <td className="p-3 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleMissionActive(m)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                              m.is_active
                                ? 'bg-purple-950/80 border-purple-500 text-purple-300'
                                : 'bg-zinc-900 border-zinc-700 text-zinc-500'
                            }`}
                          >
                            {m.is_active ? '● 有効' : '○ 停止'}
                          </button>
                        </td>
                        <td className="p-3 font-bold text-white whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{m.title}</span>
                            {isLowAssigned && m.is_active && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-950 border border-amber-600/80 text-amber-300 font-bold" title="受注が少ないミッションです。見直し候補です。">
                                ⚠️ 受注少
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-zinc-300 max-w-xs">{m.description}</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
                            {m.target_rank === 0 ? '全ランク共通' : `Rank ${m.target_rank}`}
                          </span>
                        </td>
                        <td className="p-3 whitespace-nowrap font-bold text-emerald-400">+{m.reward_miles} pt</td>
                        <td className="p-3 whitespace-nowrap text-zinc-400">
                          <span className="text-indigo-300 font-bold">{m.times_assigned}</span> 回 / <span className="text-amber-300 font-bold">{m.times_completed}</span> 達成
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-500" style={{ width: `${Math.min(100, m.completion_rate)}%` }} />
                            </div>
                            <span className="font-mono text-zinc-400">{m.completion_rate}%</span>
                          </div>
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEditMission(m)}
                              className="p-1 hover:bg-purple-900/40 text-zinc-400 hover:text-purple-300 rounded"
                              title="編集"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteMission(m.id)}
                              className="p-1 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 rounded"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {missionsMaster.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-zinc-500">
                        登録されているミッションがありません。「＋ 新規ミッション作成」から追加してください。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mission Logs Table */}
            <div className="space-y-3 pt-4 border-t border-purple-900/30">
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

          {/* Mission Create/Edit Modal */}
          {isMissionModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
              <div className="mecha-corners-purple bg-zinc-900 border border-purple-700/60 mecha-clip p-0 w-full max-w-xl shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-black/40">
                  <h3 className="font-mecha font-bold text-base text-purple-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    {editingMission ? 'ミッションの編集' : '新規ミッション作成'}
                  </h3>
                  <button onClick={() => setIsMissionModalOpen(false)} className="text-zinc-500 hover:text-white">✕</button>
                </div>

                <div className="p-6 space-y-4">
                  {!editingMission && (
                    <div>
                      <label className="font-tech text-xs text-zinc-400 block mb-1.5">
                        ⚡ クイックテンプレート（条件をワンクリック自動入力）:
                      </label>
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                        {MISSION_TEMPLATES.map((tmpl, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setModalTitle(tmpl.title);
                              setModalDesc(tmpl.desc);
                              setModalMiles(tmpl.miles);
                            }}
                            className="text-[11px] font-tech px-2.5 py-1 bg-zinc-800 hover:bg-purple-950 hover:border-purple-500 border border-zinc-700 text-zinc-300 hover:text-purple-300 rounded transition-all"
                          >
                            + {tmpl.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="font-tech text-xs text-zinc-400 block mb-1">ミッション名 / タイトル *</label>
                    <input
                      type="text"
                      className="w-full bg-black/70 border border-zinc-700 rounded px-3 py-2 text-white font-tech text-sm focus:border-purple-500 outline-none"
                      value={modalTitle}
                      onChange={(e) => setModalTitle(e.target.value)}
                      placeholder="例: VC交流、魚釣り挑戦など"
                    />
                  </div>

                  <div>
                    <label className="font-tech text-xs text-zinc-400 block mb-1">達成条件・内容の説明 *</label>
                    <textarea
                      rows={2}
                      className="w-full bg-black/70 border border-zinc-700 rounded px-3 py-2 text-white font-tech text-sm focus:border-purple-500 outline-none"
                      value={modalDesc}
                      onChange={(e) => setModalDesc(e.target.value)}
                      placeholder="例: VCに通算30分以上参加する"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="font-tech text-xs text-zinc-400 block mb-1">対象階級</label>
                      <select
                        className="w-full bg-black/70 border border-zinc-700 rounded px-3 py-2 text-white font-tech text-sm focus:border-purple-500 outline-none"
                        value={modalRank}
                        onChange={(e) => setModalRank(parseInt(e.target.value, 10))}
                      >
                        <option value={0}>全ランク共通 (全住民)</option>
                        <option value={1}>Rank 1 (🌱 新規専用)</option>
                        <option value={2}>Rank 2 (🏠 住人専用)</option>
                        <option value={3}>Rank 3 (☕ 常連専用)</option>
                        <option value={4}>Rank 4 (🌟 人気専用)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-tech text-xs text-zinc-400 block mb-1">報酬マイル (デフォルト 100pt)</label>
                      <input
                        type="number"
                        min={10}
                        step={10}
                        className="w-full bg-black/70 border border-zinc-700 rounded px-3 py-2 text-white font-tech text-sm focus:border-purple-500 outline-none"
                        value={modalMiles}
                        onChange={(e) => setModalMiles(parseInt(e.target.value, 10) || 100)}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-black/40">
                  <button
                    type="button"
                    onClick={() => setIsMissionModalOpen(false)}
                    className="px-4 py-2 text-xs font-tech text-zinc-400 hover:text-white"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMission}
                    disabled={savingMission}
                    className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-5 py-2 font-mecha text-xs font-bold border border-purple-400/40"
                  >
                    {savingMission ? '保存中...' : editingMission ? '変更を保存' : '作成する'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 10. TAB: 🃏 住民カード＆階級ステップアップ */}
      {currentTab === 'resident-ranks' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-purple-400" />
                🃏 住民カード＆階級・ランクアップ設定 (/住民カード, /ランクアップ)
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                各階級への昇格に必要なマイル数（新規 ➔ 住人: 4,000pt / 住人 ➔ 常連: 15,000pt / 常連 ➔ 人気: 45,000pt）やロール名を管理します。<br />
                ここで保存した設定は、Botの `/ランクアップ`, `/マイル`, `/住民カード` の判定に即座に反映されます。
              </p>
            </div>
            <button
              onClick={handleSaveRanks}
              disabled={savingRanks}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-lg whitespace-nowrap self-start sm:self-auto"
            >
              {savingRanks ? '保存中...' : '階級設定を保存 / EXECUTE'}
            </button>
          </div>

          {/* Visual Route */}
          <div className="p-4 bg-black/50 border border-purple-900/50 rounded-lg">
            <h3 className="font-mecha text-xs font-bold text-purple-300 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" /> 住民ステップアップ昇格ルート
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              {ranksMaster.map((r) => (
                <div key={r.level} className="p-2.5 bg-black/70 border rounded relative" style={{ borderColor: `${r.color}50` }}>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
                    <span>RANK {r.level}</span>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                  </div>
                  <div className="font-bold text-xs truncate" style={{ color: r.color }}>{r.name}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    必要: <strong className="text-white">{r.required_miles.toLocaleString()}</strong> pt
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rank Cards Editor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ranksMaster.map((r) => (
              <div
                key={r.level}
                className="p-4 bg-black/40 border rounded-lg space-y-3"
                style={{ borderColor: `${r.color}60` }}
              >
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded flex items-center justify-center font-bold text-xs text-black" style={{ backgroundColor: r.color }}>
                      {r.level}
                    </span>
                    <span className="font-mecha font-bold text-white text-sm">Rank {r.level}</span>
                  </div>
                  <input
                    type="color"
                    value={r.color}
                    onChange={(e) => updateRankField(r.level, 'color', e.target.value)}
                    className="w-6 h-6 bg-transparent cursor-pointer rounded"
                    title="テーマカラー選択"
                  />
                </div>

                <div className="space-y-2 font-tech text-xs">
                  <div>
                    <label className="text-zinc-400 block mb-1">階級表示名（絵文字込み）</label>
                    <input
                      type="text"
                      className="w-full bg-black/60 border border-zinc-700 rounded p-2 text-white font-tech outline-none focus:border-purple-400"
                      value={r.name}
                      onChange={(e) => updateRankField(r.level, 'name', e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-zinc-400 block mb-1">昇格に必要なマイル数 (pt)</label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      className="w-full bg-black/60 border border-zinc-700 rounded p-2 text-white font-mono outline-none focus:border-purple-400"
                      value={r.required_miles}
                      onChange={(e) => updateRankField(r.level, 'required_miles', parseInt(e.target.value, 10) || 0)}
                      disabled={r.level === 1}
                    />
                  </div>

                  <div>
                    <label className="text-zinc-400 block mb-1">自動付与ロール名</label>
                    <input
                      type="text"
                      className="w-full bg-black/60 border border-zinc-700 rounded p-2 text-white font-tech outline-none focus:border-purple-400"
                      value={r.role_name}
                      onChange={(e) => updateRankField(r.level, 'role_name', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveRanks}
              disabled={savingRanks}
              className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-mecha font-bold py-2.5 px-8 border border-purple-400/40 text-xs shadow-lg"
            >
              {savingRanks ? '保存中...' : '階級設定を保存 / EXECUTE'}
            </button>
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
                <label className="font-tech text-xs text-zinc-400">マイルポイント数量</label>
                <input
                  type="number"
                  min="1"
                  value={mileAmount}
                  onChange={(e) => setMileAmount(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-mono mecha-input-purple outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">操作タイプ</label>
                <select
                  value={mileOpType}
                  onChange={(e) => setMileOpType(e.target.value as 'grant' | 'revoke')}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2 text-xs text-white font-tech mecha-input-purple outline-none"
                >
                  <option value="grant">➕ マイル付与 (ボーナス・補填)</option>
                  <option value="revoke">➖ マイル没収 (ペナルティ・調整)</option>
                </select>
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

            <div className="flex justify-end pt-2">
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
              <ChannelSelect
                label="パネル送信先チャンネル"
                placeholder="チャンネルを選択してください..."
                channels={textChannels}
                value={panelChannelId}
                onChange={(id: any) => setPanelChannelId(id || '')}
                multiple={false}
              />
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

      {/* 13. TAB: 🗄️ データベース接続＆ヘルス */}
      {currentTab === 'database-health' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-400" />
                🗄️ データベース接続 ＆ ヘルス設定
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                どうぶつの森Bot専用のSupabaseデータベース接続URLを設定・テストし、テーブルスキーマの健全性を管理します。
              </p>
            </div>
          </div>

          <div className="p-5 bg-black/40 border border-purple-900/40 rounded-lg space-y-4">
            <div className="flex items-center gap-3 text-purple-300 font-tech text-sm">
              <CheckCircle2 className="w-5 h-5 text-purple-400" />
              <span>どうぶつの森Bot専用データベース（PostgreSQL / Supabase）接続設定</span>
            </div>

            <div className="flex flex-col gap-2 relative z-10">
              <label className="font-tech text-xs text-purple-300 font-bold uppercase">
                DOUMORI_DATABASE_URL
              </label>
              <div className="relative">
                <input
                  type={showDbUrl ? 'text' : 'password'}
                  className="w-full bg-black/70 border border-purple-900/60 rounded p-3 pr-11 text-xs text-purple-200 font-mono focus:border-purple-400 outline-none"
                  value={doumoriDatabaseUrl}
                  onChange={(e) => setDoumoriDatabaseUrl(e.target.value)}
                  placeholder="postgresql://postgres.[ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowDbUrl((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-purple-400 p-1.5"
                  tabIndex={-1}
                >
                  {showDbUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveDatabase}
                disabled={savingDb}
                className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 via-indigo-600 to-purple-800 hover:from-purple-600 hover:to-indigo-700 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-md flex items-center gap-2"
              >
                {savingDb ? 'UPLINK テスト中...' : '⚡ 接続テスト ＆ 設定保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 14. TAB: 👤 専用アカウント設定 (限定アクセス) */}
      {currentTab === 'accounts' && (
        <div className="mecha-corners-purple bg-neutral-900/80 border border-purple-900/40 mecha-clip p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <div>
              <h2 className="font-mecha text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                👤 専用アカウント設定（限定アクセス管理）
              </h2>
              <p className="font-tech text-xs text-zinc-400 mt-1">
                このBot（Guild: {guild_id}）専用のログインアカウントを作成・管理します。
              </p>
            </div>
          </div>

          {/* Purple Alert Notice Box */}
          <div className="p-4 bg-purple-950/40 border border-purple-800/60 rounded-lg flex items-start gap-3 shadow-inner">
            <Lock className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
            <div className="font-tech text-xs text-purple-200 space-y-1">
              <strong className="text-purple-300 font-bold block text-sm">🔒 専用アカウントのアクセス制限仕様</strong>
              <p className="leading-relaxed">
                ここで発行したIDとパスワードでダッシュボードにログインすると、<strong className="text-white underline">このBot・このサーバーのダッシュボード画面しか見れなくなります</strong>。
              </p>
              <p className="text-purple-400 text-[11px]">
                ※ サーバー一覧（/）や他のBot、他のサーバーの管理画面には一切アクセスできず、自動的にこのBot専用画面に固定されます。
              </p>
            </div>
          </div>

          {/* Create New Account Form */}
          <form onSubmit={handleCreateAccount} className="p-5 bg-black/50 border border-purple-900/40 rounded-lg space-y-4">
            <h3 className="font-mecha font-bold text-sm text-purple-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-purple-400" />
              新規専用アカウント作成
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">ユーザー名 (ログインID)</label>
                <input
                  type="text"
                  placeholder="例: doumori_admin"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">パスワード</label>
                <input
                  type="password"
                  placeholder="パスワードを入力"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-mono mecha-input-purple outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-tech text-xs text-zinc-400">権限種別</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full bg-black/60 border border-purple-900/60 rounded p-2.5 text-xs text-white font-tech mecha-input-purple outline-none"
                >
                  <option value="botadmin">専用Bot管理者 (フル設定・操作)</option>
                  <option value="subadmin">副管理者 (設定・ログ閲覧)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={creatingAccount}
                className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-purple-700 via-indigo-600 to-purple-800 hover:from-purple-600 hover:to-indigo-700 text-white font-mecha font-bold py-2.5 px-6 border border-purple-400/40 text-xs shadow-lg shadow-purple-900/40 flex items-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {creatingAccount ? '作成中...' : '⚡ 専用アカウントを発行'}
              </button>
            </div>
          </form>

          {/* Accounts List Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mecha font-bold text-sm text-purple-300 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-purple-400" />
                登録済み専用アカウント一覧 ({accounts.length} 件)
              </h3>
              <button
                onClick={fetchAccounts}
                disabled={accountsLoading}
                className="font-tech text-xs text-purple-400 hover:text-purple-200 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${accountsLoading ? 'animate-spin' : ''}`} /> 再読み込み
              </button>
            </div>

            <div className="overflow-x-auto bg-black/40 border border-purple-900/40 rounded-lg">
              <table className="w-full text-left font-tech text-xs">
                <thead className="bg-purple-950/60 border-b border-purple-900/40 text-purple-300">
                  <tr>
                    <th className="p-3">ユーザー名</th>
                    <th className="p-3">パスワード</th>
                    <th className="p-3">権限</th>
                    <th className="p-3">作成日時</th>
                    <th className="p-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-900/20 text-zinc-300">
                  {accounts && accounts.length > 0 ? (
                    accounts.map((acc) => {
                      const isShown = !!showPasswordMap[acc.id];
                      return (
                        <tr key={acc.id} className="hover:bg-purple-950/20">
                          <td className="p-3 font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-400" />
                            {acc.username}
                          </td>
                          <td className="p-3 font-mono text-purple-300">
                            <div className="flex items-center gap-2">
                              <span>{isShown ? acc.password : '••••••••'}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowPasswordMap((prev) => ({ ...prev, [acc.id]: !prev[acc.id] }))
                                }
                                className="text-zinc-500 hover:text-purple-300"
                              >
                                {isShown ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="font-tech text-[10px] px-2 py-0.5 rounded bg-purple-950/80 border border-purple-700 text-purple-300">
                              {acc.role}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-500">
                            {new Date(acc.created_at).toLocaleString('ja-JP')}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleDeleteAccount(acc.id, acc.username)}
                              disabled={deletingAccountId === acc.id}
                              className="px-2.5 py-1 bg-red-950/60 hover:bg-red-900/80 border border-red-800/80 text-red-300 hover:text-white rounded transition-colors text-[11px] inline-flex items-center gap-1"
                            >
                              <Trash2 size={12} />
                              {deletingAccountId === acc.id ? '削除中...' : '削除'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-zinc-500">
                        {accountsLoading ? '読み込み中...' : '専用アカウントはまだ作成されていません。上のフォームから発行できます。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
