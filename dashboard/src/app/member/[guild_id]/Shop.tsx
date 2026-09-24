'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, ShoppingCart } from 'lucide-react';
import { memberFetch } from '@/lib/memberClient';

interface RoleTag { id: string; name: string; color: string | null }

/** GET /api/member/guilds/[guild_id]/shop の中身（enabled: true のとき） */
export interface ShopInfo {
  enabled: true;
  currency_name: string;
  balance: number;
  evaluation_period: { end_text: string; end_unix: number } | null;
  items: {
    item_id: number;
    name: string;
    usage: string;
    price: number;
    targets: RoleTag[];
    is_target: boolean;
    is_eval_extend: boolean;
    extend_days: number | null;
    rewards: RoleTag[];
    duration_days: number | null;
  }[];
}

const fmt = (n: number) => n.toLocaleString('ja-JP');

function Roles({ roles }: { roles: RoleTag[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {roles.map((r) => (
        <span key={r.id} className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color ?? '#71717a' }} />
          {r.name}
        </span>
      ))}
    </span>
  );
}

export default function Shop({
  guildId,
  info,
  balance,
  onBought,
}: {
  guildId: string;
  info: ShopInfo;
  balance: number;
  onBought: (balance: number, evaluationPeriod?: ShopInfo['evaluation_period']) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState<{ title: string; lines: string[] } | null>(null);
  const cur = info.currency_name;

  const buy = async (itemId: number) => {
    setBuying(true);
    setResult(null);
    try {
      const res = await memberFetch(`/api/member/guilds/${guildId}/shop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        toast.error(data.error || '購入できませんでした');
        return;
      }
      const lines: string[] = [];
      if (data.new_end) {
        lines.push(`評価期間が ${data.item.extend_days}日間 延長されました。`);
        lines.push(`新しい終了予定: ${data.new_end.end_text}`);
      }
      if (data.granted?.length) {
        lines.push(`特典ロール「${data.granted.join('、')}」が付与されました！${data.expire_days ? `（有効期限: ${data.expire_days}日間）` : ''}`);
      }
      if (data.failed?.length) {
        lines.push(`特典ロール「${data.failed.join('、')}」の付与に失敗しました（Botの権限が不足しています）。管理者に連絡してください。`);
      }
      setResult({ title: `🎉 商品「${data.item.name}」を購入しました！`, lines });
      toast.success('購入しました');
      onBought(data.balance, data.new_end ?? undefined);
    } catch {
      toast.error('サーバーに接続できませんでした');
    } finally {
      setBuying(false);
      setConfirming(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
        <div className="text-sm text-zinc-500">所持金</div>
        <div className="text-3xl font-bold mt-1">
          {fmt(balance)} <span className="text-base font-normal text-zinc-400">{cur}</span>
        </div>
        {info.evaluation_period && (
          <div className="text-xs text-zinc-500 mt-2">評価期間の終了予定: {info.evaluation_period.end_text}</div>
        )}
      </div>

      {result && (
        <div className="border rounded-xl p-4 text-sm bg-amber-950/40 border-amber-700/60 text-amber-200">
          <div className="font-bold text-base">{result.title}</div>
          {result.lines.map((l, i) => (
            <div key={i} className="mt-1 opacity-90">{l}</div>
          ))}
        </div>
      )}

      {info.items.length === 0 ? (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center text-zinc-500 text-sm">
          現在販売中の商品はありません。
        </div>
      ) : (
        info.items.map((item) => {
          // Bot と同じ順で買えない理由を出す（対象ロール → 評価期間中か → 残高）
          const reason = !item.is_target
            ? '対象のロールを持っていないため購入できません'
            : item.is_eval_extend && !info.evaluation_period
              ? '評価期間中ではないため購入できません'
              : balance < item.price
                ? '所持金が足りません'
                : null;
          return (
            <div key={item.item_id} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="font-bold text-lg min-w-0 break-words">🛒 {item.name}</div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-amber-300">{fmt(item.price)}</div>
                  <div className="text-xs text-zinc-500">{cur}</div>
                </div>
              </div>
              <dl className="text-sm space-y-1.5">
                {item.usage && (
                  <div className="flex gap-2">
                    <dt className="text-zinc-500 flex-shrink-0 w-10">用途</dt>
                    <dd className="whitespace-pre-wrap break-words min-w-0">{item.usage}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-zinc-500 flex-shrink-0 w-10">対象</dt>
                  <dd>{item.targets.length ? <Roles roles={item.targets} /> : '誰でも'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-zinc-500 flex-shrink-0 w-10">効果</dt>
                  <dd>
                    {item.is_eval_extend ? (
                      `評価期間延長（${item.extend_days ?? 0}日間）`
                    ) : item.rewards.length ? (
                      <>
                        <Roles roles={item.rewards} />
                        {item.duration_days ? <span className="text-zinc-400 text-xs ml-1">（有効期限: {item.duration_days}日間）</span> : null}
                      </>
                    ) : (
                      'なし'
                    )}
                  </dd>
                </div>
              </dl>

              {confirming === item.item_id ? (
                <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-3 space-y-2">
                  <p className="text-sm">
                    <b>{item.name}</b> を <b>{fmt(item.price)} {cur}</b> で購入します。よろしいですか？
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirming(null)}
                      disabled={buying}
                      className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm font-semibold"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => buy(item.item_id)}
                      disabled={buying}
                      className="flex-1 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-60 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      {buying && <Loader2 className="w-4 h-4 animate-spin" />}
                      購入する
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => { setConfirming(item.item_id); setResult(null); }}
                    disabled={!!reason || buying}
                    className="w-full py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-semibold flex items-center justify-center gap-2 text-sm"
                  >
                    <ShoppingCart className="w-4 h-4" /> 購入する
                  </button>
                  {reason && <p className="text-xs text-zinc-500 text-center">{reason}</p>}
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
