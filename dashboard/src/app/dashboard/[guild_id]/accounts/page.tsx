'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Account {
  id: number;
  username: string;
  role: string;
  guild_id: string;
  created_at: string;
}

export default function AccountsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const router = useRouter();
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [isCreating, setIsCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('shop');

  useEffect(() => {
    fetchAccounts();
  }, [guildId]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/accounts`);
      const data = await res.json();
      if (res.ok) {
        setAccounts(data);
      } else {
        setError(data.error || 'アカウントの取得に失敗しました');
      }
    } catch (err) {
      setError('サーバーとの通信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;

    try {
      const res = await fetch(`/api/guilds/${guildId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        setIsCreating(false);
        fetchAccounts();
      } else {
        alert(data.error || 'アカウントの作成に失敗しました');
      }
    } catch (err) {
      alert('エラーが発生しました');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('本当にこのアカウントを削除しますか？')) return;

    try {
      const res = await fetch(`/api/guilds/${guildId}/accounts/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchAccounts();
      } else {
        const data = await res.json();
        alert(data.error || '削除に失敗しました');
      }
    } catch (err) {
      alert('エラーが発生しました');
    }
  };

  if (loading) return <div>読み込み中...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-red-500">アカウント設定 (サブアカウント管理)</h1>
      
      {error && (
        <div className="bg-red-900/50 text-red-200 p-4 rounded mb-6 border border-red-700">
          {error}
        </div>
      )}

      <div className="bg-neutral-800 rounded-lg shadow-xl border border-neutral-700 p-6 mb-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">このサーバーのサブアカウント一覧</h2>
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
          >
            {isCreating ? 'キャンセル' : '新規作成'}
          </button>
        </div>

        {isCreating && (
          <form onSubmit={handleCreate} className="bg-neutral-900 p-4 rounded-lg mb-6 border border-zinc-700">
            <h3 className="text-lg mb-4 text-red-400">新規アカウント作成</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1">ユーザーID</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">パスワード</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">権限 (ロール)</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white"
                >
                  <option value="shop">ショップ専用</option>
                  <option value="gambling">ギャンブル専用</option>
                  <option value="admin">通常の管理者 (全て)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded transition-colors">
                作成する
              </button>
            </div>
          </form>
        )}

        {accounts.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            このサーバーにはサブアカウントがまだありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="p-3 rounded-tl-lg">ID</th>
                  <th className="p-3">ユーザー名</th>
                  <th className="p-3">権限</th>
                  <th className="p-3">作成日時</th>
                  <th className="p-3 rounded-tr-lg">操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(acc => (
                  <tr key={acc.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                    <td className="p-3">{acc.id}</td>
                    <td className="p-3 font-bold text-white">{acc.username}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        acc.role === 'shop' ? 'bg-blue-900/50 text-blue-300' :
                        acc.role === 'gambling' ? 'bg-purple-900/50 text-purple-300' :
                        'bg-red-900/50 text-red-300'
                      }`}>
                        {acc.role}
                      </span>
                    </td>
                    <td className="p-3 text-zinc-400">{new Date(acc.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      <button
                        onClick={() => handleDelete(acc.id)}
                        className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded border border-red-900/50 hover:bg-red-900/20 transition-colors"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
