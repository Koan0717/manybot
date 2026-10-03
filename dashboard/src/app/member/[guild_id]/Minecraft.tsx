'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link2, Loader2, Pickaxe, Unlink } from 'lucide-react';
import { memberFetch } from '@/lib/memberClient';

interface McInfo {
  enabled: boolean;
  online?: boolean;
  server_name?: string | null;
  online_count?: number;
  link?: { mc_name: string; linked_at: string } | null;
}

/**
 * プロフィールに出す「マイクラ連携」カード。
 * ゲーム内の /manybot:link で出た6桁のコードを入れると、このDiscordアカウントとプレイヤーが紐付き、
 * マイクラ内の通貨がこのサーバーの通貨（所持金）と共通になる。サーバーで連携が無効なら何も出さない。
 */
export default function MinecraftLink({ guildId, currency }: { guildId: string; currency: string }) {
  const [info, setInfo] = useState<McInfo | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    memberFetch(`/api/member/guilds/${guildId}/minecraft`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setInfo(d))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [guildId]);

  if (!info?.enabled) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await memberFetch(`/api/member/guilds/${guildId}/minecraft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || '連携に失敗しました');
      setInfo({ ...info, link: d.link });
      setCode('');
      toast.success(`${d.link.mc_name} と連携しました`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm('マイクラとの連携を解除しますか？（所持金はそのまま残ります）')) return;
    setBusy(true);
    try {
      const res = await memberFetch(`/api/member/guilds/${guildId}/minecraft`, { method: 'DELETE' });
      if (!res.ok) throw new Error('連携の解除に失敗しました');
      setInfo({ ...info, link: null });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Pickaxe className="w-4 h-4 text-emerald-400" /> マイクラ連携
        </div>
        <span className={`text-xs ${info.online ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {info.online ? `● ${info.server_name || 'サーバー'} オンライン（${info.online_count ?? 0}人）` : '○ サーバー停止中'}
        </span>
      </div>
      {info.link ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold truncate">{info.link.mc_name}</div>
            <div className="text-xs text-zinc-500">マイクラ内の通貨はこの所持金（{currency}）と共通です</div>
          </div>
          <button
            onClick={unlink}
            disabled={busy}
            className="text-xs text-zinc-400 hover:text-red-300 flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
          >
            <Unlink className="w-3.5 h-3.5" /> 解除
          </button>
        </div>
      ) : (
        <>
          <div className="text-xs text-zinc-500">
            ゲーム内で <code className="text-emerald-300">/manybot:link</code> を実行し、表示された6桁のコードを入力してください。
            連携すると、マイクラ内で稼いだ通貨がこのサーバーの所持金になります。
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="123456"
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 tracking-[0.3em] text-center font-mono focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={submit}
              disabled={busy || code.length !== 6}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl text-sm font-semibold flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} 連携
            </button>
          </div>
        </>
      )}
    </div>
  );
}
