'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Hammer, Save, Sparkles, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { ROLE_SETTINGS } from '@/lib/roleSettings';
import { SERVER_BUILD_CATEGORIES, SUGGESTED_ROLE_NAMES } from '@/lib/serverBuild';

type Action = 'build' | 'save';

interface BuildStatus {
  state: 'queued' | 'running' | 'done' | 'error';
  name?: string;
  message?: string;
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  result?: {
    created_roles: number; reused_roles: number;
    created_channels: number; reused_channels: number;
    synced: number; settings: number; logs: number;
    errors: string[];
  };
}

const POLL_MS = 3000;

export default function ServerBuildPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<string[]>(SERVER_BUILD_CATEGORIES.map(c => c.id));
  const [applySettings, setApplySettings] = useState(true);
  const [syncPermissions, setSyncPermissions] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [submitting, setSubmitting] = useState<Action | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/server-build`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) return;
      setStatus(data.status);
      if (!data.status || (data.status.state !== 'queued' && data.status.state !== 'running')) stopPolling();
    } catch {}
  }, [guildId, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(fetchStatus, POLL_MS);
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/server-build`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data.error) return;
        const t = data.template;
        if (t) {
          setName(t.name || '');
          setRoleNames(t.roles || {});
          if (Array.isArray(t.categories)) setCategories(t.categories);
          setSavedAt(t.updated_at || null);
        }
        setStatus(data.status);
        if (data.status && (data.status.state === 'queued' || data.status.state === 'running')) startPolling();
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    return stopPolling;
  }, [guildId, startPolling, stopPolling]);

  const filledKeys = ROLE_SETTINGS.filter(s => (roleNames[s.key] || '').trim()).map(s => s.key);
  const isAvailable = (requires: string[]) => requires.length === 0 || requires.some(k => filledKeys.includes(k));
  const busy = status?.state === 'queued' || status?.state === 'running';

  const fillSuggested = () => {
    setRoleNames(prev => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(SUGGESTED_ROLE_NAMES)) {
        if (!(next[k] || '').trim()) next[k] = v;
      }
      return next;
    });
  };

  const toggleCategory = (id: string) => {
    setCategories(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]));
  };

  const submit = async (action: Action) => {
    if (filledKeys.length === 0) {
      toast.error('ロール名を1つ以上入力してください');
      return;
    }
    if (action === 'build' && !window.confirm(
      'このサーバーにロール・カテゴリー・チャンネルを作成します。\n同じ名前のものが既にあれば作らずにそのまま使います。よろしいですか？'
    )) {
      return;
    }
    setSubmitting(action);
    try {
      const res = await fetch(`/api/guilds/${guildId}/server-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          template: { name, roles: roleNames, categories },
          apply_settings: applySettings,
          sync_permissions: syncPermissions,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'エラーが発生しました');
        return;
      }
      if (action === 'save') {
        setSavedAt(data.template?.updated_at || new Date().toISOString());
        toast.success('テンプレートを保存しました！ Discord で /運営 サーバー構築 → 「保存したテンプレート」を選ぶと作成できます');
      } else {
        setStatus(data.status);
        startPolling();
        toast.success('サーバーの作成を Bot に依頼しました');
      }
    } catch {
      toast.error('送信に失敗しました');
    } finally {
      setSubmitting(null);
    }
  };

  const inputClass = 'bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-red-500 focus:outline-none transition-colors';

  return (
    <div className="max-w-4xl mx-auto pb-32">
      <PageHeader
        icon={Hammer}
        title="サーバー作成"
        subtitle="基本設定のロール設定ごとにロール名を入れて、ロール・カテゴリー・チャンネルの土台を一括で作ります"
      />

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">テンプレート名</h2>
        <input
          type="text"
          value={name}
          maxLength={50}
          onChange={e => setName(e.target.value)}
          placeholder="例: 〇〇評価鯖"
          className={`${inputClass} w-full md:w-1/2`}
        />
      </div>

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4 border-b border-zinc-700 pb-2">
          <h2 className="text-xl font-bold text-white">ロール名</h2>
          <button
            type="button"
            onClick={fillSuggested}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 rounded text-zinc-300 hover:text-white hover:border-red-500 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            空欄におすすめの名前を入れる
          </button>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          作りたいロールの名前を入力してください（空欄の項目は作りません）。作ったロールは、それぞれの設定に自動で登録されます。
          同じ名前を複数の項目に入れると、1つのロールにまとめます。上の項目ほどロールの順番が上になります。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {ROLE_SETTINGS.map(s => (
            <div key={s.key} className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-300 font-bold">{s.label.replace(/ロール/, '')}</label>
              <input
                type="text"
                value={roleNames[s.key] || ''}
                maxLength={100}
                disabled={loading}
                onChange={e => setRoleNames(prev => ({ ...prev, [s.key]: e.target.value }))}
                placeholder={SUGGESTED_ROLE_NAMES[s.key] ? `例: ${SUGGESTED_ROLE_NAMES[s.key]}` : '名前を入力'}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">作るカテゴリー</h2>
        <p className="text-sm text-zinc-400 mb-6">
          入力したロールを元に、見える範囲を設定したカテゴリー・チャンネルを作ります。必要なロールが入力されていないカテゴリーは作りません。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SERVER_BUILD_CATEGORIES.map(c => {
            const available = isAvailable(c.requires);
            const checked = categories.includes(c.id);
            return (
              <label
                key={c.id}
                className={`flex items-start gap-3 p-3 border rounded transition-colors ${
                  available ? 'cursor-pointer border-zinc-700 hover:border-zinc-500' : 'border-zinc-800 opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-red-600"
                  checked={checked && available}
                  disabled={!available}
                  onChange={() => toggleCategory(c.id)}
                />
                <div>
                  <p className="text-sm font-bold text-white">{c.label}</p>
                  <p className="text-xs text-zinc-500">{c.description}</p>
                  {!available && (
                    <p className="text-xs text-amber-500 mt-1">
                      必要なロール: {c.requires.map(k => ROLE_SETTINGS.find(s => s.key === k)?.label.replace(/ロール/, '') || k).join(' / ')}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">実行</h2>
        <p className="text-sm text-zinc-400 mb-4">
          どちらかを選んでください。
        </p>
        <ul className="text-sm text-zinc-400 mb-6 space-y-1 list-disc pl-5">
          <li><strong className="text-zinc-200">サーバー作成</strong>: 今すぐ Bot がこのサーバーにロール・カテゴリー・チャンネルを作ります。</li>
          <li>
            <strong className="text-zinc-200">テンプレ保存</strong>: 作らずに保存だけします。Discord で
            <code className="mx-1 px-1 bg-black/40 rounded text-zinc-200">/運営 サーバー構築</code>
            を実行し、テンプレートに「保存したテンプレート」を選ぶと作成できます。
            {savedAt && <span className="ml-1 text-xs text-zinc-500">（最終保存: {new Date(savedAt).toLocaleString('ja-JP')}）</span>}
          </li>
        </ul>

        <div className="flex flex-col gap-2 mb-6">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" className="accent-red-600" checked={applySettings} onChange={e => setApplySettings(e.target.checked)} />
            作ったロール・チャンネルを Bot の設定に反映する（サーバー作成のみ）
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" className="accent-red-600" checked={syncPermissions} onChange={e => setSyncPermissions(e.target.checked)} />
            既にあるカテゴリー・チャンネルの見える範囲も更新する（サーバー作成のみ）
          </label>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <button
            onClick={() => submit('build')}
            disabled={loading || submitting !== null || busy}
            className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white transition-colors px-8 py-3 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting === 'build' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
            サーバー作成
          </button>
          <button
            onClick={() => submit('save')}
            disabled={loading || submitting !== null}
            className="font-mecha border border-zinc-600 hover:border-zinc-400 bg-zinc-900 text-white transition-colors px-8 py-3 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            テンプレ保存
          </button>
        </div>

        {status && (
          <div className="mt-6 border border-zinc-700 rounded p-4 text-sm">
            <p className="flex items-center gap-2 font-bold text-white mb-1">
              {busy && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
              {status.state === 'done' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
              {status.state === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
              {busy ? '作成中' : status.state === 'done' ? '作成が完了しました' : '作成に失敗しました'}
              {status.name && <span className="text-zinc-400 font-normal">「{status.name}」</span>}
            </p>
            {status.message && status.state !== 'done' && <p className="text-zinc-400">{status.message}</p>}
            {status.result && (
              <ul className="text-zinc-400 mt-2 space-y-0.5">
                <li>ロール: 新規 {status.result.created_roles} 個 / 既存を使用 {status.result.reused_roles} 個</li>
                <li>カテゴリー・チャンネル: 新規 {status.result.created_channels} 個 / 既存を使用 {status.result.reused_channels} 個</li>
                {status.result.synced > 0 && <li>権限を更新: {status.result.synced} 個</li>}
                {status.result.settings > 0 && <li>Bot の設定: {status.result.settings} 項目に反映 / ログの送信先: {status.result.logs} 種類を登録</li>}
              </ul>
            )}
            {status.result && status.result.errors.length > 0 && (
              <div className="mt-2 text-amber-400">
                <p className="font-bold">⚠️ 失敗したもの</p>
                <ul className="list-disc pl-5">
                  {status.result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {status.state === 'done' && (
              <p className="text-xs text-zinc-500 mt-2">Bot のロールは、作成したロールより上に置いてください。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
