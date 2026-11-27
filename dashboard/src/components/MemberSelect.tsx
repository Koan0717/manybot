'use client';
import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface MemberOption {
  id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
}

interface MemberSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  members: MemberOption[];
  loading?: boolean;
  error?: string | null;
  placeholder?: string;
}

// 候補の表示件数（大きなサーバーでも一覧が重くならないように絞る）
const MAX_RESULTS = 50;

/** サーバーメンバーを検索して複数選択する */
export default function MemberSelect({ value, onChange, members, loading = false, error = null, placeholder = '名前・IDで検索...' }: MemberSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 何も入力していなくても、入力欄を選んだ時点で候補を出す（名前順）
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = members.filter(m => !value.includes(m.id));
    const matched = q
      ? candidates.filter(m => m.display_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q) || m.id === q)
      : [...candidates].sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));
    return matched.slice(0, MAX_RESULTS);
  }, [members, query, value]);

  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  return (
    <div
      ref={rootRef}
      onBlur={e => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map(id => {
            const member = memberMap.get(id);
            return (
              <span
                key={id}
                title={`ID: ${id}`}
                className={`text-xs px-2.5 py-1 rounded border font-bold flex items-center gap-1 ${
                  member || loading || error ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-amber-950/60 border-amber-800 text-amber-300'
                }`}
              >
                {member ? member.display_name : loading || error ? id : `⚠ サーバーにいないユーザー (${id})`}
                <button
                  type="button"
                  aria-label="選択を解除"
                  onClick={() => onChange(value.filter(v => v !== id))}
                  className="-mr-1 ml-0.5 w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={loading ? 'メンバー読み込み中...' : placeholder}
          disabled={loading}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2.5 text-[16px] text-white focus:outline-none focus:border-red-500 transition-colors placeholder:text-zinc-500 disabled:opacity-50"
        />
      </div>

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      {open && !loading && !error && (
        <div className="mt-1 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg p-1 space-y-0.5">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-500">
              {members.length === 0 ? 'メンバーを取得できませんでした' : query.trim() ? '一致するメンバーが見つかりません' : '選べるメンバーがいません'}
            </p>
          ) : (
            results.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange([...value, m.id]);
                  setQuery('');
                }}
                onMouseDown={e => e.preventDefault()}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-left hover:bg-zinc-800"
              >
                {m.avatar_url && <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />}
                <span className="text-sm text-white truncate">{m.display_name}</span>
                <span className="text-xs text-zinc-500 truncate">@{m.username}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
