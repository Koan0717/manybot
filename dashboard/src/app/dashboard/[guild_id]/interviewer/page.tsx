'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Plus, Trash2, UserCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';

export default function InterviewerPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoDetect, setAutoDetect] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [newInterviewerId, setNewInterviewerId] = useState('');
  const [newTotal, setNewTotal] = useState('');

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/interviewer`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setAutoDetect(data.autoDetect);
          setStats(data.stats || []);
        }
        setLoading(false);
      });
  }, [guildId]);

  const handleSaveSetting = async () => {
    setSaving(true);
    await fetch(`/api/guilds/${guildId}/interviewer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_setting', autoDetect })
    });
    setSaving(false);
    toast.success('設定を保存しました');
  };

  const handleUpdateStat = async (interviewer_id: string, total: number) => {
    await fetch(`/api/guilds/${guildId}/interviewer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_stat', interviewer_id, total_handled: total })
    });
    setStats(stats.map(s => s.interviewer_id === interviewer_id ? { ...s, total_handled: total } : s));
  };

  const handleDeleteStat = async (interviewer_id: string) => {
    if (!confirm('本当に削除しますか？')) return;
    await fetch(`/api/guilds/${guildId}/interviewer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_stat', interviewer_id })
    });
    setStats(stats.filter(s => s.interviewer_id !== interviewer_id));
  };

  const handleAddStat = async () => {
    if (!newInterviewerId || !newTotal) return;
    await fetch(`/api/guilds/${guildId}/interviewer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_stat', interviewer_id: newInterviewerId, total_handled: parseInt(newTotal) })
    });
    setStats([...stats, { interviewer_id: newInterviewerId, total_handled: parseInt(newTotal) }]);
    setNewInterviewerId('');
    setNewTotal('');
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-zinc-500" size={32} /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader icon={UserCheck} title="面接官設定" subtitle="手動での入界手続きの自動検知と、面接官ごとの対応人数を管理します" guildId={guildId} healthKey="interviewer" />

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4">自動検知設定</h2>
        <div className="flex items-center justify-between p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
          <div>
            <div className="font-medium">手動入界手続きの自動ログ検知</div>
            <div className="text-sm text-zinc-400 mt-1">手動で名前変更と仮メンロール付与が行われた際に、自動で面接官ログを送信します</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
            />
            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={handleSaveSetting} disabled={saving} className="flex items-center gap-2 mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-4 py-2 rounded-lg transition-colors">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            設定を保存
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4">面接官の対応人数管理</h2>
        <div className="space-y-4">
          {stats.map(stat => (
            <div key={stat.interviewer_id} className="flex items-center gap-4 p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
              <div className="flex-1">
                <div className="text-sm text-zinc-400">ユーザーID</div>
                <div className="font-mono">{stat.interviewer_id}</div>
              </div>
              <div className="w-32">
                <div className="text-sm text-zinc-400 mb-1">対応人数</div>
                <input
                  type="number"
                  value={stat.total_handled}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setStats(stats.map(s => s.interviewer_id === stat.interviewer_id ? { ...s, total_handled: val } : s));
                  }}
                  onBlur={(e) => handleUpdateStat(stat.interviewer_id, parseInt(e.target.value) || 0)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white"
                />
              </div>
              <button onClick={() => handleDeleteStat(stat.interviewer_id)} className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded mt-5">
                <Trash2 size={20} />
              </button>
            </div>
          ))}

          <div className="flex items-center gap-4 p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50 border-dashed">
            <div className="flex-1">
              <input
                type="text"
                placeholder="ユーザーIDを追加..."
                value={newInterviewerId}
                onChange={(e) => setNewInterviewerId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white font-mono"
              />
            </div>
            <div className="w-32">
              <input
                type="number"
                placeholder="人数"
                value={newTotal}
                onChange={(e) => setNewTotal(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-white"
              />
            </div>
            <button onClick={handleAddStat} disabled={!newInterviewerId || !newTotal} className="p-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
