'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, ShieldCheck, Trash2, UserX } from 'lucide-react';

interface Member {
  user_id: string;
  mc_name: string;
  linked_at: string;
  discord_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role_names: string[];
  is_staff: boolean;
  in_guild: boolean;
  check_error: boolean;
  op_status: 'granted' | 'revoked' | 'unsupported' | 'failed' | null;
  op_reported_at: string | null;
  online: boolean;
  last_seen: string | null;
}

interface Unlinked {
  mc_name: string;
  last_seen: string | null;
  online: boolean;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

/** OPの状態（運営なら付いているべき・運営でなければ付いていないべき）を表示用に */
function opBadge(m: Member) {
  if (!m.is_staff) {
    if (m.op_status === 'granted') return { text: 'OP（外す予定）', cls: 'text-amber-400' };
    return { text: '—', cls: 'text-zinc-600' };
  }
  switch (m.op_status) {
    case 'granted':
      return { text: 'OP 付与済み', cls: 'text-green-400' };
    case 'unsupported':
      return { text: 'OP 自動付与できず（手動で /op）', cls: 'text-amber-400' };
    case 'failed':
      return { text: 'OP 付与に失敗', cls: 'text-red-400' };
    default:
      return { text: '次のログインで付与', cls: 'text-zinc-400' };
  }
}

/**
 * マイクラメンバー一覧。マイクラのプレイヤー名とDiscordアカウントがきちんと紐付いているかを確認する。
 * 開くたびにDiscordからロール・在籍を取り直す。
 */
export default function MinecraftMembers({ guildId }: { guildId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [unlinked, setUnlinked] = useState<Unlinked[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/minecraft/members`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setMembers(d.members);
      setUnlinked(d.unlinked);
    } catch (e: any) {
      toast.error(`読み込みに失敗しました: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    load();
  }, [load]);

  const unlink = async (m: Member) => {
    if (!confirm(`${m.mc_name} と ${m.discord_name ?? m.user_id} の連携を解除しますか？`)) return;
    const res = await fetch(`/api/guilds/${guildId}/minecraft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlink', user_id: m.user_id }),
    });
    if (res.ok) {
      toast.success('連携を解除しました');
      load();
    } else toast.error('解除に失敗しました');
  };

  const q = filter.trim().toLowerCase();
  const shown = (members ?? []).filter(
    (m) => !q || m.mc_name.toLowerCase().includes(q) || (m.discord_name ?? '').toLowerCase().includes(q) || (m.username ?? '').toLowerCase().includes(q) || m.user_id.includes(q)
  );
  const okCount = (members ?? []).filter((m) => m.in_guild && !m.check_error).length;
  const leftCount = (members ?? []).filter((m) => !m.in_guild).length;
  const staffCount = (members ?? []).filter((m) => m.is_staff && m.in_guild).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '連携済み', value: members?.length ?? '—', cls: 'text-white' },
          { label: '正常に紐付け', value: members ? okCount : '—', cls: 'text-green-400' },
          { label: 'Discordを抜けた', value: members ? leftCount : '—', cls: leftCount ? 'text-red-400' : 'text-zinc-400' },
          { label: '未連携のプレイヤー', value: unlinked.length, cls: unlinked.length ? 'text-amber-400' : 'text-zinc-400' },
        ].map((c) => (
          <div key={c.label} className="mecha-clip-sm bg-black/40 border border-zinc-800 p-4">
            <div className="font-tech text-xs text-zinc-500">{c.label}</div>
            <div className={`text-2xl font-bold ${c.cls}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="text-sm font-bold text-zinc-200">
            マイクラ ⇄ Discord の紐付け
            <span className="font-tech text-xs text-zinc-500 font-normal ml-2">運営 {staffCount}人（運営管理者ロール持ち → OP）</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="プレイヤー名 / Discord名で検索"
              className="bg-black/60 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 w-56"
            />
            <button
              onClick={load}
              className="font-tech text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Discordから取り直す
            </button>
          </div>
        </div>

        {!members ? (
          <div className="py-10 flex justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="font-tech text-xs text-zinc-500">
            {members.length ? '一致するメンバーはいません' : 'まだいません。ゲーム内で /manybot:link を実行してもらってください。'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left font-tech text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-3 font-normal">マイクラ</th>
                  <th className="py-2 pr-3 font-normal">Discord</th>
                  <th className="py-2 pr-3 font-normal">紐付け</th>
                  <th className="py-2 pr-3 font-normal">ロール</th>
                  <th className="py-2 pr-3 font-normal">OP</th>
                  <th className="py-2 pr-3 font-normal">最終ログイン</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {shown.map((m) => {
                  const op = opBadge(m);
                  return (
                    <tr key={m.user_id} className="align-top">
                      <td className="py-2.5 pr-3">
                        <div className="text-white font-semibold flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${m.online ? 'bg-green-400' : 'bg-zinc-600'}`} title={m.online ? 'オンライン' : 'オフライン'} />
                          {m.mc_name}
                        </div>
                        <div className="font-tech text-[10px] text-zinc-600">{new Date(m.linked_at).toLocaleDateString('ja-JP')} 連携</div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          {m.avatar_url ? (
                            <img src={m.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-zinc-800" />
                          )}
                          <div className="min-w-0">
                            <div className="text-zinc-200 truncate">{m.discord_name ?? '（不明）'}</div>
                            <div className="font-tech text-[10px] text-zinc-600 truncate">
                              {m.username ? `@${m.username} ・ ` : ''}
                              {m.user_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {!m.in_guild ? (
                          <span className="text-red-400 flex items-center gap-1"><UserX className="w-3.5 h-3.5" /> Discordにいない</span>
                        ) : m.check_error ? (
                          <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 確認できず</span>
                        ) : (
                          <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> 正常</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {m.is_staff && (
                            <span className="inline-flex items-center gap-0.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 rounded px-1.5 py-0.5">
                              <ShieldCheck className="w-3 h-3" /> 運営
                            </span>
                          )}
                          {m.role_names.slice(0, 4).map((r) => (
                            <span key={r} className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-1.5 py-0.5">{r}</span>
                          ))}
                          {m.role_names.length > 4 && <span className="text-zinc-500">+{m.role_names.length - 4}</span>}
                          {m.role_names.length === 0 && !m.is_staff && <span className="text-zinc-600">—</span>}
                        </div>
                      </td>
                      <td className={`py-2.5 pr-3 whitespace-nowrap ${op.cls}`}>{op.text}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-400">{m.online ? <span className="text-green-400">オンライン</span> : fmtDate(m.last_seen)}</td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => unlink(m)} className="text-zinc-500 hover:text-red-400" title="連携解除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6">
        <div className="text-sm font-bold text-zinc-200 mb-1">未連携のプレイヤー（{unlinked.length}人）</div>
        <div className="font-tech text-[11px] text-zinc-500 mb-3">ワールドに来たことがあるのに、Discordと紐付いていないプレイヤー。ゲーム内で /manybot:link を案内してください。</div>
        {unlinked.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {unlinked.map((u) => (
              <span key={u.mc_name} className="font-tech text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 flex items-center gap-1.5">
                {u.online ? <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> : <XCircle className="w-3 h-3 text-zinc-600" />}
                {u.mc_name}
                <span className="text-zinc-500">{u.online ? 'オンライン' : fmtDate(u.last_seen)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="font-tech text-xs text-green-400">全員が紐付いています</div>
        )}
      </div>
    </div>
  );
}
