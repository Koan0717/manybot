'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncStatusCards } from '@/lib/useSyncStatus';
import { Plus, Edit2, Trash2, CheckCircle2, AlertTriangle, Sparkles, Filter, RefreshCw, Power } from 'lucide-react';

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

interface MissionStats {
  totalMissions: number;
  activeMissions: number;
  totalAssigned: number;
  totalCompleted: number;
  overallCompletionRate: number;
  averageAssigned: number;
}

const TEMPLATES = [
  { title: "VC交流", desc: "VCに通算30分以上参加する", miles: 100 },
  { title: "雑談チャット", desc: "雑談チャンネルで3回以上メッセージを発言する", miles: 100 },
  { title: "魚釣り", desc: "`/釣り` で魚を1匹以上釣り上げる", miles: 100 },
  { title: "虫捕り", desc: "`/虫捕り` で虫を1匹以上捕まえる", miles: 100 },
  { title: "ショップ・両替", desc: "`/ショップ` または `/両替` を1回利用する", miles: 100 },
  { title: "ダブり売却", desc: "`/売却` で重複した生き物を売却してゼニーにする", miles: 100 },
  { title: "VC長時間滞在", desc: "VCに通算1時間以上参加してメンバーと交流する", miles: 100 },
  { title: "レア捕獲", desc: "レア度RARE以上の生き物を1匹捕獲する", miles: 100 },
  { title: "イベント告知・参加", desc: "DIY作業台イベントや鯖内イベントに参加・告知する", miles: 100 },
];

export default function MissionsDashboardPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);

  const [missions, setMissions] = useState<Mission[]>([]);
  const [stats, setStats] = useState<MissionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterRank, setFilterRank] = useState<number>(-1); // -1: 全て

  // モーダルステート
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalRank, setModalRank] = useState(0);
  const [modalMiles, setModalMiles] = useState(100);
  const [submitting, setSubmitting] = useState(false);

  const fetchMissions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/missions`);
      const data = await res.json();
      if (!data.error) {
        setMissions(data.missions || []);
        setStats(data.stats || null);
      } else {
        toast.error('ミッション一覧の取得に失敗しました: ' + data.error);
      }
    } catch (err) {
      toast.error('ネットワークエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissions();
  }, [guildId]);

  const openCreateModal = () => {
    setEditingMission(null);
    setModalTitle('');
    setModalDesc('');
    setModalRank(0);
    setModalMiles(100);
    setIsModalOpen(true);
  };

  const openEditModal = (m: Mission) => {
    setEditingMission(m);
    setModalTitle(m.title);
    setModalDesc(m.description);
    setModalRank(m.target_rank);
    setModalMiles(m.reward_miles);
    setIsModalOpen(true);
  };

  const applyTemplate = (tmpl: { title: string; desc: string; miles: number }) => {
    setModalTitle(tmpl.title);
    setModalDesc(tmpl.desc);
    setModalMiles(tmpl.miles);
  };

  const handleSaveModal = async () => {
    if (!modalTitle.trim() || !modalDesc.trim()) {
      toast.error('タイトルと達成条件を入力してください');
      return;
    }

    setSubmitting(true);
    try {
      if (editingMission) {
        // 更新
        const res = await fetch(`/api/guilds/${guildId}/missions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingMission.id,
            title: modalTitle.trim(),
            description: modalDesc.trim(),
            target_rank: modalRank,
            reward_miles: modalMiles,
          }),
        });
        const data = await res.json();
        if (data.success) {
          toast.success('ミッションを更新しました！');
          setIsModalOpen(false);
          fetchMissions();
        } else {
          toast.error('更新エラー: ' + data.error);
        }
      } else {
        // 新規作成
        const res = await fetch(`/api/guilds/${guildId}/missions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: modalTitle.trim(),
            description: modalDesc.trim(),
            target_rank: modalRank,
            reward_miles: modalMiles,
          }),
        });
        const data = await res.json();
        if (data.success) {
          toast.success('新規ミッションを作成しました！');
          setIsModalOpen(false);
          fetchMissions();
        } else {
          toast.error('作成エラー: ' + data.error);
        }
      }
    } catch (err) {
      toast.error('保存処理に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (m: Mission) => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/missions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: m.id,
          is_active: !m.is_active,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`ミッションを ${!m.is_active ? '有効化' : '無効化'} しました`);
        fetchMissions();
      } else {
        toast.error('切替エラー: ' + data.error);
      }
    } catch {
      toast.error('操作に失敗しました');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('このミッションを削除してもよろしいですか？')) return;

    try {
      const res = await fetch(`/api/guilds/${guildId}/missions?id=${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success('ミッションを削除しました');
        fetchMissions();
      } else {
        toast.error('削除エラー: ' + data.error);
      }
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  const filteredMissions = filterRank === -1
    ? missions
    : missions.filter((m) => m.target_rank === filterRank);

  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mecha-led w-2 h-2 rounded-full bg-emerald-400 text-emerald-400"></span>
            <span className="font-tech text-[11px] tracking-[0.25em] text-emerald-400/90 uppercase">
              Mission-Core // Daily 3-Slot Engine
            </span>
          </div>
          <h1 className="font-mecha text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 mecha-clip-sm bg-emerald-600/20 border border-emerald-500/50 text-emerald-400">
              🍃
            </span>
            デイリーミッション一覧・設定管理
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchMissions}
            className="mecha-btn-sheen mecha-clip-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 font-tech text-xs flex items-center gap-2 border border-zinc-700"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
          <button
            onClick={openCreateModal}
            className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-5 py-2.5 font-mecha text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 border border-emerald-400/40"
          >
            <Plus className="w-4 h-4" />
            新規ミッション作成
          </button>
        </div>
      </div>

      <SyncStatusCards sync={sync} showSyncCard={false} />

      {/* Overview Stats HUD */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="mecha-clip-sm bg-black/50 border border-emerald-900/50 p-4">
            <span className="font-tech text-[10px] text-zinc-500 block mb-1">TOTAL / ACTIVE</span>
            <div className="font-mecha text-xl font-black text-white flex items-baseline gap-1.5">
              <span className="text-emerald-400">{stats.activeMissions}</span>
              <span className="text-xs text-zinc-600">/ {stats.totalMissions} 種類</span>
            </div>
          </div>
          <div className="mecha-clip-sm bg-black/50 border border-cyan-900/50 p-4">
            <span className="font-tech text-[10px] text-zinc-500 block mb-1">TOTAL ASSIGNED</span>
            <div className="font-mecha text-xl font-black text-cyan-300">
              {stats.totalAssigned.toLocaleString()} <span className="text-xs text-zinc-600">回</span>
            </div>
          </div>
          <div className="mecha-clip-sm bg-black/50 border border-amber-900/50 p-4">
            <span className="font-tech text-[10px] text-zinc-500 block mb-1">TOTAL COMPLETED</span>
            <div className="font-mecha text-xl font-black text-amber-300">
              {stats.totalCompleted.toLocaleString()} <span className="text-xs text-zinc-600">回</span>
            </div>
          </div>
          <div className="mecha-clip-sm bg-black/50 border border-purple-900/50 p-4">
            <span className="font-tech text-[10px] text-zinc-500 block mb-1">COMPLETION RATE</span>
            <div className="font-mecha text-xl font-black text-purple-300">
              {stats.overallCompletionRate}%
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3 mb-4 p-3 bg-neutral-900/80 border border-zinc-800 mecha-clip-sm">
        <div className="flex items-center gap-2 text-xs font-tech text-zinc-400">
          <Filter className="w-4 h-4 text-emerald-400" />
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
              onClick={() => setFilterRank(btn.val)}
              className={`px-2.5 py-1 mecha-clip-sm font-tech transition-colors ${
                filterRank === btn.val
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <span className="text-xs font-tech text-zinc-500">
          該当: {filteredMissions.length} 件
        </span>
      </div>

      {/* Missions Table Panel */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/90 border border-emerald-900/40 mecha-clip p-0 shadow-xl mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-tech text-sm">
            <thead className="bg-black/60 border-b border-zinc-800 text-[11px] text-zinc-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3">ミッション名</th>
                <th className="px-4 py-3">達成条件・内容</th>
                <th className="px-4 py-3">対象ランク</th>
                <th className="px-4 py-3">報酬マイル</th>
                <th className="px-4 py-3">受注数 / 達成</th>
                <th className="px-4 py-3">達成率</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-zinc-500 font-tech">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-400" />
                    ミッションマスターをスキャン中...
                  </td>
                </tr>
              ) : filteredMissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-zinc-500 font-tech">
                    登録されているミッションがありません。「新規ミッション作成」から追加してください。
                  </td>
                </tr>
              ) : (
                filteredMissions.map((m) => {
                  const isLowAssigned = stats && stats.averageAssigned > 5 && m.times_assigned < stats.averageAssigned * 0.4;

                  return (
                    <tr
                      key={m.id}
                      className={`hover:bg-zinc-800/40 transition-colors ${
                        !m.is_active ? 'opacity-50 bg-black/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleActive(m)}
                          className={`mecha-clip-sm px-2.5 py-1 text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                            m.is_active
                              ? 'bg-emerald-950/80 border border-emerald-600 text-emerald-300'
                              : 'bg-zinc-900 border border-zinc-700 text-zinc-500'
                          }`}
                          title="クリックで有効/無効を切替"
                        >
                          <Power className="w-3 h-3" />
                          {m.is_active ? '有効' : '停止中'}
                        </button>
                      </td>
                      <td className="px-4 py-3.5 font-bold text-white whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{m.title}</span>
                          {isLowAssigned && m.is_active && (
                            <span className="mecha-clip-sm px-1.5 py-0.5 text-[9px] bg-amber-950 border border-amber-600/80 text-amber-300 font-bold" title="平均よりも受注数が少ないミッションです。見直し候補です。">
                              ⚠️ 受注少
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-zinc-300 text-xs min-w-[200px]">
                        {m.description}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                        <span className="mecha-clip-sm px-2 py-0.5 bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {m.target_rank === 0 ? '全ランク共通' : `Rank ${m.target_rank}`}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap font-mecha font-bold text-emerald-400">
                        +{m.reward_miles} pt
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-300">
                        <span className="text-cyan-300 font-bold">{m.times_assigned}</span> 回受注 / <span className="text-amber-300 font-bold">{m.times_completed}</span> 達成
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${Math.min(100, m.completion_rate)}%` }}
                            ></div>
                          </div>
                          <span className="text-xs font-mono text-zinc-400">{m.completion_rate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(m)}
                            className="p-1.5 hover:bg-zinc-700 text-zinc-400 hover:text-cyan-300 rounded transition-colors"
                            title="編集"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(m.id)}
                            className="p-1.5 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 rounded transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create / Edit Mission */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="mecha-corners mecha-grid-bg bg-zinc-900 border border-emerald-700/60 mecha-clip p-0 w-full max-w-xl shadow-2xl">
            {/* Title */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-black/40">
              <h3 className="font-mecha font-bold text-lg text-emerald-400 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                {editingMission ? 'ミッションの編集' : '新規ミッション作成'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Quick Template buttons (新規作成時のみ) */}
              {!editingMission && (
                <div>
                  <label className="font-tech text-xs text-zinc-400 block mb-2">
                    ⚡ クイックテンプレート（ワンクリックで条件を自動入力）:
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                    {TEMPLATES.map((tmpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => applyTemplate(tmpl)}
                        className="text-[11px] font-tech px-2.5 py-1 bg-zinc-800 hover:bg-emerald-950 hover:border-emerald-500 border border-zinc-700 text-zinc-300 hover:text-emerald-300 mecha-clip-sm transition-all"
                      >
                        + {tmpl.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="font-tech text-xs text-zinc-400 block mb-1.5">
                  ミッション名 / タイトル <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3.5 py-2.5 text-white font-tech text-sm focus:border-emerald-500 outline-none"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  placeholder="例: VC交流、魚釣り挑戦、あいさつなど"
                />
              </div>

              {/* Description */}
              <div>
                <label className="font-tech text-xs text-zinc-400 block mb-1.5">
                  達成条件・内容の説明 <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3.5 py-2.5 text-white font-tech text-sm focus:border-emerald-500 outline-none"
                  value={modalDesc}
                  onChange={(e) => setModalDesc(e.target.value)}
                  placeholder="例: VCに通算30分以上参加する、雑談チャットで3回発言するなど"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Target Rank */}
                <div>
                  <label className="font-tech text-xs text-zinc-400 block mb-1.5">
                    対象階級 (ターゲットランク)
                  </label>
                  <select
                    className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3.5 py-2.5 text-white font-tech text-sm focus:border-emerald-500 outline-none"
                    value={modalRank}
                    onChange={(e) => setModalRank(parseInt(e.target.value, 10))}
                  >
                    <option value={0}>全ランク共通 (全住民)</option>
                    <option value={1}>Rank 1 (🌱 新規住人専用)</option>
                    <option value={2}>Rank 2 (🏠 住人専用)</option>
                    <option value={3}>Rank 3 (☕ 常連住人専用)</option>
                    <option value={4}>Rank 4 (🌟 人気住人専用)</option>
                  </select>
                </div>

                {/* Reward Miles */}
                <div>
                  <label className="font-tech text-xs text-zinc-400 block mb-1.5">
                    達成報酬マイル (デフォルト 100pt)
                  </label>
                  <input
                    type="number"
                    min={10}
                    step={10}
                    className="w-full bg-black/70 border border-zinc-700 mecha-clip-sm px-3.5 py-2.5 text-white font-tech text-sm focus:border-emerald-500 outline-none"
                    value={modalMiles}
                    onChange={(e) => setModalMiles(parseInt(e.target.value, 10) || 100)}
                  />
                </div>
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-black/40">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-tech text-zinc-400 hover:text-white transition-colors"
                disabled={submitting}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-2.5 font-mecha text-sm font-bold border border-emerald-400/40 flex items-center gap-2"
                disabled={submitting}
              >
                {submitting ? '保存中...' : editingMission ? '変更を保存' : 'ミッションを作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
