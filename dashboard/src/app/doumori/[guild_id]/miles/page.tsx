'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Wrench, Plus, Minus, RefreshCw } from 'lucide-react';
import Card from '@/components/doumori/Card';

export default function MilesPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/miles`, { cache: 'no-store' });
      const data = await res.json();
      setLogs(data.mileLogs || []);
    } catch {
      toast.error('取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleOperation = async (op_type: 'grant' | 'revoke') => {
    if (!userId || !amount) {
      toast.error('ユーザーIDとポイント数を入力してください');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/miles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, amount, op_type, reason }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setUserId('');
        setAmount('');
        setReason('');
        fetchLogs();
      } else {
        toast.error(data.error || '処理に失敗しました');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-20 space-y-6">
      <div>
        <h1 className="text-2xl font-black text-leaf-900 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-leaf-500" />
          マイル手動操作
        </h1>
        <p className="text-sm text-leaf-500 mt-1">管理者権限でユーザーのマイルポイントを付与・没収します。</p>
      </div>

      <Card title="マイル付与・没収">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">対象ユーザーID</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Discord User ID"
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">ポイント数</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-leaf-600 block mb-1">理由（任意）</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: イベント特別報酬"
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => handleOperation('grant')}
            disabled={submitting}
            className="flex-1 bg-leaf-600 hover:bg-leaf-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            付与する
          </button>
          <button
            onClick={() => handleOperation('revoke')}
            disabled={submitting}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          >
            <Minus className="w-4 h-4" />
            没収する
          </button>
        </div>
      </Card>

      <Card title="操作ログ">
        <div className="flex justify-end mb-2">
          <button onClick={fetchLogs} className="text-xs text-leaf-500 hover:text-leaf-700 flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            再読み込み
          </button>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="text-xs text-leaf-600 border-b border-leaf-100 pb-2">
              <span className="font-mono text-leaf-400">{new Date(log.created_at).toLocaleString('ja-JP')}</span>
              {' — '}
              User {log.user_id} に {log.action === 'grant' ? '+' : '-'}
              {log.amount} マイル ({log.reason})
            </div>
          ))}
          {logs.length === 0 && <p className="text-sm text-leaf-400 text-center py-4">ログがありません</p>}
        </div>
      </Card>
    </div>
  );
}
