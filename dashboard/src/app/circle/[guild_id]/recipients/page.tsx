'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Loader2, Save, Search, UserCheck, X } from 'lucide-react';

interface Member {
  id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
}

const MAX_RECIPIENTS = 25;

export default function CircleRecipientsPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [circleName, setCircleName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersError, setMembersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/circle/settings`)
      .then((r) => r.json())
      .then((s) => {
        if (s.error) throw new Error(s.error);
        setCircleName(s.circle_name || '');
        setSelected(s.recipient_user_ids || []);
      })
      .catch((e) => toast.error(`設定を読み込めませんでした: ${e.message}`))
      .finally(() => setLoading(false));

    fetch(`/api/guilds/${guildId}/circle/members`)
      .then(async (r) => {
        const data = await r.json();
        setMembers(data.members || []);
        if (!r.ok) setMembersError(data.error || 'メンバー一覧を取得できませんでした');
      })
      .catch(() => setMembersError('メンバー一覧を取得できませんでした'))
      .finally(() => setMembersLoading(false));
  }, [guildId]);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = members.filter((m) => !selected.includes(m.id));
    if (!q) return pool.slice(0, 30);
    return pool
      .filter((m) => m.display_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q) || m.id === q)
      .slice(0, 30);
  }, [members, query, selected]);

  const add = (id: string) => {
    if (selected.length >= MAX_RECIPIENTS) {
      toast.error(`送信先は${MAX_RECIPIENTS}人までです`);
      return;
    }
    setSelected((s) => (s.includes(id) ? s : [...s, id]));
    setDirty(true);
  };
  const remove = (id: string) => {
    setSelected((s) => s.filter((v) => v !== id));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circle_name: circleName, recipient_user_ids: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDirty(false);
      window.dispatchEvent(new CustomEvent('circle-name-changed', { detail: data.circle_name }));
      toast.success('保存しました');
    } catch (e: any) {
      toast.error(`保存できませんでした: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-400 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> 読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">送信先設定</h1>
          <p className="text-sm text-slate-400 mt-1">サークル進捗状況のレポートを Discord の DM で受け取る人を選びます。</p>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm px-5 py-2.5 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {dirty ? '保存する' : '保存済み'}
        </button>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <label className="block text-sm font-semibold mb-1.5">サークル名</label>
        <p className="text-xs text-slate-500 mb-2">レポートの送信時にタイトルの上に表示されます（空欄ならサーバー名）。</p>
        <input
          type="text"
          value={circleName}
          maxLength={100}
          onChange={(e) => { setCircleName(e.target.value); setDirty(true); }}
          placeholder="例: 〇〇大学 写真部"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none px-3 py-2.5 text-[16px] md:text-sm placeholder:text-slate-600"
        />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-sky-400" /> 送信先 ({selected.length}/{MAX_RECIPIENTS})
          </h2>
        </div>

        {selected.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 text-center text-sm text-slate-500 py-6 mb-4">
            まだ送信先がいません。下から選んでください。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {selected.map((id) => {
              const m = memberMap.get(id);
              return (
                <div key={id} className="flex items-center gap-3 rounded-lg bg-sky-500/10 ring-1 ring-sky-500/30 px-3 py-2">
                  {m?.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {m ? m.display_name : membersLoading ? id : '⚠ サーバーにいないユーザー'}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{m ? `@${m.username}` : id}</div>
                  </div>
                  <button
                    onClick={() => remove(id)}
                    aria-label="送信先から外す"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={membersLoading}
            placeholder={membersLoading ? 'メンバー読み込み中...' : '名前・ユーザー名・IDで検索して追加'}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none pl-9 pr-3 py-2.5 text-[16px] md:text-sm placeholder:text-slate-600 disabled:opacity-50"
          />
        </div>
        {membersError && <p className="text-xs text-amber-400 mt-2">{membersError}</p>}

        {!membersLoading && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
            {results.length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-4">該当するメンバーがいません</div>
            ) : (
              results.map((m) => (
                <button
                  key={m.id}
                  onClick={() => add(m.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-800/70 transition-colors"
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-800 flex-shrink-0" />
                  )}
                  <span className="text-sm truncate flex-1">{m.display_name}</span>
                  <span className="text-[11px] text-slate-500 truncate">@{m.username}</span>
                  <span className="text-xs text-sky-400 flex-shrink-0">＋ 追加</span>
                </button>
              ))
            )}
          </div>
        )}

        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          ※ Bot からの DM は、相手がこのサーバーのメンバーで「サーバーメンバーからの DM」を許可している必要があります。
          届かなかった人はレポートの送信結果に表示されます。
        </p>
      </section>
    </div>
  );
}
