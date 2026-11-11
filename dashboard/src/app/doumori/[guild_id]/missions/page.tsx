'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, RefreshCw, Sparkles } from 'lucide-react';
import Card from '@/components/doumori/Card';

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

const RANK_LABELS: Record<number, string> = { 0: '全階級共通', 1: '新規住人', 2: '住人', 3: '常連住人', 4: '人気住人' };

export default function MissionsPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [missionLogs, setMissionLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMission, setNewMission] = useState({ title: '', description: '', target_rank: 0, reward_miles: 100 });
  const [creating, setCreating] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/missions`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.error) {
        setMissions(data.missions || []);
        setStats(data.stats);
        setMissionLogs(data.missionLogs || []);
      }
    } catch {
      toast.error('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async () => {
    if (!newMission.title || !newMission.description) {
      toast.error('タイトルと達成条件は必須です');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', mission: newMission }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('ミッションを作成しました！');
        setNewMission({ title: '', description: '', target_rank: 0, reward_miles: 100 });
        fetchData();
      } else {
        toast.error(data.error || '作成に失敗しました');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (mission: Mission, patch: Partial<Mission>) => {
    const res = await fetch(`/api/guilds/${guildId}/doumori/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', mission: { ...mission, ...patch } }),
    });
    const data = await res.json();
    if (data.success) {
      fetchData();
    } else {
      toast.error(data.error || '更新に失敗しました');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('このミッションを削除しますか？')) return;
    const res = await fetch(`/api/guilds/${guildId}/doumori/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', mission: { id } }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success('削除しました');
      fetchData();
    } else {
      toast.error(data.error || '削除に失敗しました');
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-20 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-leaf-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-leaf-500" />
            デイリーミッション管理
          </h1>
          <p className="text-sm text-leaf-500 mt-1">住民がデイリーミッションとして受注できるミッションの一覧です。</p>
        </div>
        <button onClick={fetchData} className="bg-white border border-leaf-200 hover:bg-leaf-50 text-leaf-700 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          再読み込み
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-leaf-200 rounded-xl p-4">
            <p className="text-xs text-leaf-500">登録ミッション数</p>
            <p className="text-xl font-black text-leaf-900">{stats.totalMissions}</p>
          </div>
          <div className="bg-white border border-leaf-200 rounded-xl p-4">
            <p className="text-xs text-leaf-500">有効ミッション</p>
            <p className="text-xl font-black text-leaf-900">{stats.activeMissions}</p>
          </div>
          <div className="bg-white border border-leaf-200 rounded-xl p-4">
            <p className="text-xs text-leaf-500">累計受注数</p>
            <p className="text-xl font-black text-leaf-900">{stats.totalAssigned}</p>
          </div>
          <div className="bg-white border border-leaf-200 rounded-xl p-4">
            <p className="text-xs text-leaf-500">全体達成率</p>
            <p className="text-xl font-black text-leaf-900">{stats.overallCompletionRate}%</p>
          </div>
        </div>
      )}

      <Card title="新規ミッション作成">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="text-xs text-leaf-600 block mb-1">タイトル</label>
            <input
              type="text"
              value={newMission.title}
              onChange={(e) => setNewMission({ ...newMission, title: e.target.value })}
              placeholder="例: VC交流"
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-leaf-600 block mb-1">達成条件</label>
            <input
              type="text"
              value={newMission.description}
              onChange={(e) => setNewMission({ ...newMission, description: e.target.value })}
              placeholder="例: VCに通算30分以上参加する"
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">対象階級</label>
            <select
              value={newMission.target_rank}
              onChange={(e) => setNewMission({ ...newMission, target_rank: parseInt(e.target.value, 10) })}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            >
              {Object.entries(RANK_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">報酬マイル</label>
            <input
              type="number"
              value={newMission.reward_miles}
              onChange={(e) => setNewMission({ ...newMission, reward_miles: parseInt(e.target.value, 10) || 0 })}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 bg-leaf-600 hover:bg-leaf-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {creating ? '作成中...' : 'ミッションを作成'}
        </button>
      </Card>

      <Card title={`ミッション一覧 (${missions.length}件)`}>
        <div className="space-y-3">
          {missions.map((m) => (
            <div key={m.id} className="border border-leaf-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-leaf-900">{m.title}</span>
                    <span className="text-[11px] bg-leaf-100 text-leaf-700 px-2 py-0.5 rounded-full">
                      {RANK_LABELS[m.target_rank] || '全階級共通'}
                    </span>
                    <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      {m.reward_miles} マイル
                    </span>
                  </div>
                  <p className="text-sm text-leaf-600 mt-1">{m.description}</p>
                  <p className="text-[11px] text-leaf-400 mt-1">
                    受注 {m.times_assigned} / 達成 {m.times_completed} ({m.completion_rate}%)
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleUpdate(m, { is_active: !m.is_active })}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${
                      m.is_active ? 'bg-leaf-100 text-leaf-700' : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {m.is_active ? '有効' : '無効'}
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {missions.length === 0 && <p className="text-sm text-leaf-400 text-center py-6">ミッションがありません</p>}
        </div>
      </Card>

      <Card title="最近の承認ログ">
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {missionLogs.map((log) => (
            <div key={log.id} className="text-xs text-leaf-600 border-b border-leaf-100 pb-2">
              <span className="font-mono text-leaf-400">{new Date(log.created_at).toLocaleString('ja-JP')}</span>
              {' — '}
              User {log.user_id} が「{log.mission_desc}」を達成 (+{log.reward_miles}マイル, 承認者: {log.staff_id})
            </div>
          ))}
          {missionLogs.length === 0 && <p className="text-sm text-leaf-400 text-center py-4">ログがありません</p>}
        </div>
      </Card>
    </div>
  );
}
