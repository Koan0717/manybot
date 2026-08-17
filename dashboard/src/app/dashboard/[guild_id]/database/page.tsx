'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncStatusCards } from '@/lib/useSyncStatus';

function StatusChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'red' | 'cyan' | 'amber';
}) {
  const toneMap = {
    red: { text: 'text-red-400', dot: 'text-red-500 bg-red-500', border: 'border-red-900/50' },
    cyan: { text: 'text-cyan-300', dot: 'text-cyan-400 bg-cyan-400', border: 'border-cyan-900/50' },
    amber: { text: 'text-amber-300', dot: 'text-amber-400 bg-amber-400', border: 'border-amber-900/50' },
  }[tone];

  return (
    <div className={`mecha-clip-sm mecha-grid-bg flex-1 min-w-[180px] bg-black/40 border ${toneMap.border} px-4 py-3 flex items-center gap-3 relative`}>
      <span className={`mecha-led w-2 h-2 rounded-full flex-shrink-0 ${toneMap.dot}`}></span>
      <div className="min-w-0">
        <p className="font-tech text-[10px] tracking-widest text-zinc-500 leading-none mb-1">{label}</p>
        <p className={`font-mecha text-sm font-bold truncate ${toneMap.text}`}>{value}</p>
      </div>
    </div>
  );
}

export default function DatabaseSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const sync = useSyncStatus(guildId);
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [doumoriDatabaseUrl, setDoumoriDatabaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasDedicated, setHasDedicated] = useState<boolean | null>(null);
  const [hasDoumoriDedicated, setHasDoumoriDedicated] = useState<boolean>(false);
  const [guildName, setGuildName] = useState<string>('');
  const [showUrl, setShowUrl] = useState(false);
  const [showDoumoriUrl, setShowDoumoriUrl] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/database`).then(res => res.json()).catch(() => ({})),
      fetch(`/api/guilds/${guildId}/status`).then(res => res.json()).catch(() => ({})),
    ])
      .then(([dbData, statusData]) => {
        if (!dbData?.error) {
          setDatabaseUrl(dbData.database_url || '');
          setDoumoriDatabaseUrl(dbData.doumori_database_url || '');
          setHasDoumoriDedicated(!!dbData.doumori_database_url);
        }
        if (!statusData?.error) {
          setHasDedicated(!!statusData.has_dedicated_db);
          setGuildName(statusData.guild_name || '');
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);

    try {
      const res = await fetch(`/api/guilds/${guildId}/database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database_url: databaseUrl.trim(),
          doumori_database_url: doumoriDatabaseUrl.trim(),
        })
      });
      const data = await res.json();
      if (data.success) {
        setHasDedicated(!!databaseUrl.trim());
        setHasDoumoriDedicated(!!doumoriDatabaseUrl.trim());
        toast.success('データベース設定を保存しました！Botの次回の操作・起動時から新しい接続が適用されます。');
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
      {/* ==== Header / System readout ==== */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="mecha-led w-2 h-2 rounded-full bg-red-500 text-red-500"></span>
          <span className="font-tech text-[11px] tracking-[0.25em] text-red-500/80 uppercase">
            System // Data-Core Configuration{guildName ? ` :: ${guildName}` : ''}
          </span>
        </div>
        <h1 className="font-mecha text-2xl md:text-3xl font-black text-white flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center justify-center w-10 h-10 mecha-clip-sm bg-red-600/15 border border-red-700/50 text-red-400 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </span>
          データベース接続 ＆ ヘルス設定
        </h1>
      </div>

      <SyncStatusCards sync={sync} showSyncCard={false} />

      {/* ==== Status HUD strip ==== */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatusChip
          label="MANYBOT CORE"
          value={loading ? 'SCANNING...' : hasDedicated ? 'DEDICATED DB' : 'DEFAULT DB'}
          tone={hasDedicated ? 'cyan' : 'amber'}
        />
        <StatusChip
          label="DOUMORI CORE"
          value={loading ? 'SCANNING...' : hasDoumoriDedicated ? 'CONNECTED' : 'DEFAULT DB'}
          tone={hasDoumoriDedicated ? 'cyan' : 'amber'}
        />
        <StatusChip
          label="GUILD ID"
          value={guildId}
          tone="red"
        />
      </div>

      {/* ==== 1. Manybot DB Panel ==== */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/80 border border-red-900/40 mecha-clip p-0 shadow-[0_0_35px_-10px_rgba(255,43,61,0.35)] mb-8">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-red-900/40 bg-black/40">
          <div className="flex items-center gap-2 min-w-0">
            <span className="mecha-blink text-red-500 font-tech text-xs">●CORE 1</span>
            <h2 className="font-mecha text-sm md:text-base font-bold text-red-400 tracking-wide truncate">
              MANYBOT // SUPABASE LINK
            </h2>
          </div>
          <span className="font-tech text-[10px] text-zinc-500">通貨・VC・評価データ</span>
        </div>

        <div className="p-5 md:p-6">
          <p className="font-tech text-xs md:text-sm text-zinc-400 leading-relaxed mb-4">
            Manybot（通貨、VCルーム、評価シートなど）のSupabaseデータベース接続URLを設定します。
          </p>

          <div className="flex flex-col gap-2 relative z-10">
            <label className="font-tech text-xs text-cyan-400/90 font-bold tracking-widest flex items-center gap-2">
              <span className="text-zinc-600">$</span> MANYBOT_DATABASE_URL
            </label>
            <div className="relative">
              <input
                type={showUrl ? 'text' : 'password'}
                className="mecha-input font-tech bg-black/70 border border-zinc-700 mecha-clip-sm p-3 pr-11 focus:border-red-500 outline-none text-cyan-300 w-full transition-all placeholder:text-zinc-600 text-sm"
                value={databaseUrl}
                onChange={(e) => setDatabaseUrl(e.target.value)}
                placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowUrl(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-cyan-400 transition-colors p-1.5"
                tabIndex={-1}
              >
                {showUrl ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ==== 2. Doumori (どうぶつの森) DB Panel ==== */}
      <div className="mecha-corners mecha-scan-wrap mecha-grid-bg bg-neutral-900/80 border border-emerald-900/50 mecha-clip p-0 shadow-[0_0_35px_-10px_rgba(46,204,113,0.25)] mb-8">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-emerald-900/40 bg-black/40">
          <div className="flex items-center gap-2 min-w-0">
            <span className="mecha-blink text-emerald-400 font-tech text-xs">●CORE 2</span>
            <h2 className="font-mecha text-sm md:text-base font-bold text-emerald-400 tracking-wide truncate">
              🍃 DOUMORI // データベース接続 (ミッション・マイル・図鑑・階級)
            </h2>
          </div>
          <span className="font-tech text-[10px] text-emerald-500/80">どうぶつの森Bot専用DB</span>
        </div>

        <div className="p-5 md:p-6">
          <p className="font-tech text-xs md:text-sm text-zinc-400 leading-relaxed mb-4">
            どうぶつの森Bot（マイルポイント、ミッションマスター、階級マスター、採集図鑑など）のSupabaseデータベース接続URLを設定します。<br />
            設定を保存すると自動的にテーブルスキーマの接続確認・ヘルスチェックが行われます。
          </p>

          <div className="flex flex-col gap-2 relative z-10">
            <label className="font-tech text-xs text-emerald-400/90 font-bold tracking-widest flex items-center gap-2">
              <span className="text-zinc-600">$</span> DOUMORI_DATABASE_URL
            </label>
            <div className="relative">
              <input
                type={showDoumoriUrl ? 'text' : 'password'}
                className="mecha-input font-tech bg-black/70 border border-zinc-700 mecha-clip-sm p-3 pr-11 focus:border-emerald-500 outline-none text-emerald-300 w-full transition-all placeholder:text-zinc-600 text-sm"
                value={doumoriDatabaseUrl}
                onChange={(e) => setDoumoriDatabaseUrl(e.target.value)}
                placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowDoumoriUrl(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-emerald-400 transition-colors p-1.5"
                tabIndex={-1}
              >
                {showDoumoriUrl ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="border-t border-emerald-900/40 bg-black/30 px-5 md:px-6 py-5 relative z-10">
          <button
            onClick={handleSave}
            className="mecha-btn-sheen mecha-clip-sm bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-800 hover:from-emerald-600 hover:via-emerald-500 hover:to-emerald-700 text-white transition-all shadow-lg shadow-emerald-900/30 px-8 py-3 font-mecha font-bold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed w-full md:w-auto flex items-center justify-center gap-3 border border-emerald-400/30"
            disabled={loading || saving}
          >
            {saving ? (
              <>
                <svg className="animate-spin -ml-1 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                UPLINK 接続テスト＆保存中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                全データベース設定を保存 / EXECUTE
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
