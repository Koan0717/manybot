'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import {
  Database,
  ShieldCheck,
  HardDrive,
  Gauge,
  Eye,
  EyeOff,
  Copy,
  Check,
  X,
  AlertTriangle,
  Loader2,
  CircleCheck,
  CircleAlert,
  Sparkles,
} from 'lucide-react';

export default function DatabaseSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/database`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setDatabaseUrl(data.database_url || '');
          setSavedUrl(data.database_url || '');
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  const isDedicated = !!savedUrl;
  const isDirty = savedUrl !== null && databaseUrl.trim() !== savedUrl;

  const handleCopy = async () => {
    if (!databaseUrl) return;
    try {
      await navigator.clipboard.writeText(databaseUrl);
      setCopied(true);
      toast.success('コピーしました');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('コピーに失敗しました');
    }
  };

  const requestSave = () => {
    // Only show the destructive-change confirmation when the effective value actually changes
    if (isDirty) {
      setShowConfirm(true);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    setShowConfirm(false);
    setSaving(true);

    try {
      const res = await fetch(`/api/guilds/${guildId}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database_url: databaseUrl.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setSavedUrl(databaseUrl.trim());
        toast.success('データベース設定を保存しました！新しいデータベースを使用するため、次回のBot操作時から適用されます。');
      } else {
        toast.error('エラーが発生しました: ' + data.error);
      }
    } catch (e) {
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow-lg shadow-red-900/40 flex-shrink-0">
          <Database className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">データベース設定</h1>
          <p className="text-sm text-zinc-500 mt-0.5">サーバー専用のデータ保存先を管理します</p>
        </div>
      </div>

      {/* Current status card */}
      <div className="mb-8 rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5 relative overflow-hidden">
        <div className={`absolute top-0 right-0 w-56 h-56 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none ${isDedicated ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}></div>
        <div className="flex items-center justify-between gap-4 relative z-10 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isDedicated ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isDedicated ? (
                <CircleCheck className="w-5 h-5" />
              ) : (
                <CircleAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">現在の状態</p>
              <p className={`font-bold ${isDedicated ? 'text-emerald-400' : 'text-amber-400'}`}>
                {loading ? '確認中...' : isDedicated ? '専用データベースに接続中' : 'デフォルトデータベースを使用中'}
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${isDedicated ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isDedicated ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`}></span>
            {isDedicated ? 'Supabase' : 'Managed DB'}
          </span>
        </div>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { icon: HardDrive, title: '容量制限を回避', desc: '専用ストレージで安心運用' },
          { icon: ShieldCheck, title: 'データを完全分離', desc: '他サーバーと混在しない' },
          { icon: Gauge, title: '大規模運用向け', desc: '負荷を独自DBに逃がせる' },
        ].map((f, i) => (
          <div key={i} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors">
            <f.icon className="w-5 h-5 text-red-400 mb-2" />
            <p className="text-sm font-bold text-white">{f.title}</p>
            <p className="text-xs text-zinc-500 mt-1">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-neutral-800/60 backdrop-blur rounded-xl p-6 shadow-xl border border-red-900/30 mb-8 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-red-600/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-red-600/5 rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none"></div>

        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-3 text-red-400 flex items-center gap-2 relative z-10">
          <Sparkles className="w-5 h-5" />
          専用データベース（Supabase）の設定
        </h2>
        <div className="text-sm text-zinc-300 mb-6 space-y-2 relative z-10">
          <p>
            このサーバーのデータを完全に分離し、専用のデータベース（Supabase）に保存することができます。<br/>
            容量制限を回避したい場合や、大規模なサーバーを運営する場合に設定してください。
          </p>
          <div className="bg-red-950/40 border border-red-900/50 p-4 rounded-lg mt-4">
            <h3 className="font-bold text-red-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              注意事項
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-red-200/80">
              <li>未設定（空欄）の場合は、Botのデフォルトのデータベースが使用されます。</li>
              <li>設定を変更すると、新しいデータベースを参照するため、<strong>これまでの設定やVCルームのデータはリセット</strong>された状態からのスタートになります。</li>
              <li>入力するURLは <code className="bg-red-950 px-1 py-0.5 rounded text-red-300">postgresql://...</code> で始まるSupabaseの接続URL（Transaction pooler等）を指定してください。</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-6 relative z-10">
          <div className="flex items-center justify-between">
            <label className="text-sm text-zinc-300 font-bold">DATABASE URL</label>
            {isDirty && (
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                未保存の変更があります
              </span>
            )}
          </div>

          {loading ? (
            <div className="h-[52px] rounded-lg bg-zinc-900/80 border border-zinc-800 animate-pulse"></div>
          ) : (
            <div className="relative group">
              <input
                type={showUrl ? 'text' : 'password'}
                className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 pr-28 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none text-white w-full transition-all font-mono text-sm tracking-tight"
                value={databaseUrl}
                onChange={(e) => setDatabaseUrl(e.target.value)}
                placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {databaseUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowUrl(v => !v)}
                      title={showUrl ? 'マスク表示にする' : 'URLを表示する'}
                      className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
                    >
                      {showUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      title="コピー"
                      className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDatabaseUrl('')}
                      title="クリア"
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded-md transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 border-t border-zinc-700 pt-6 relative z-10 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={requestSave}
            className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white transition-all shadow-lg shadow-red-900/20 px-8 py-3 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto flex items-center justify-center gap-2 hover:shadow-red-900/40 hover:-translate-y-0.5 active:translate-y-0"
            disabled={loading || saving || !isDirty}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                設定を保存
              </>
            )}
          </button>
          {!isDirty && !loading && (
            <span className="text-xs text-zinc-500">現在保存されている内容と同じです</span>
          )}
        </div>
      </div>

      {/* Confirmation modal for destructive change */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowConfirm(false)}
          ></div>
          <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-red-900/40 rounded-2xl p-6 shadow-2xl animate-modal-pop">
            <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">本当に変更しますか？</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-6">
              データベース設定を変更すると、新しい接続先を参照するため
              <strong className="text-red-400">これまでの設定やVCルームのデータがリセット</strong>
              された状態から開始されます。この操作は元に戻せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white font-bold shadow-lg shadow-red-900/30 transition-all flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                変更する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
