'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, UserCog, UserPlus, UserMinus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';
import RoleSelect, { RoleOption } from '@/components/RoleSelect';

const toIdList = (v: any): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

/**
 * 入場許可ロール設定：入界パネル・/面接官 入界許可実行 で付与するロールと剥奪するロール。
 * Bot側（helpers.get_entry_grant_roles / get_entry_remove_roles）は、未設定なら
 * 付与＝仮メンバーロール、剥奪＝入界待機者ロールを使うので、未設定のときはそれを初期値として表示する。
 */
export default function EntryRolesPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [grantRoleIds, setGrantRoleIds] = useState<string[]>([]);
  const [removeRoleIds, setRemoveRoleIds] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/settings`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/roles`).then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([s, rl]) => {
      if (s && !s.error) {
        const grantIds = toIdList(s.ENTRY_GRANT_ROLE_IDS);
        setGrantRoleIds(grantIds.length > 0 ? grantIds : toIdList(s.NEW_MEMBER_ROLE_IDS ?? s.NEW_MEMBER_ROLE_ID));
        const removeIds = toIdList(s.ENTRY_REMOVE_ROLE_IDS);
        setRemoveRoleIds(removeIds.length > 0 ? removeIds : toIdList(s.PENDING_MEMBER_ROLE_ID));
      }
      if (Array.isArray(rl)) setRoles(rl.filter((r: any) => r.id !== guildId && !r.managed));
      setLoading(false);
    }).catch(err => {
      console.error(err);
      toast.error('設定を取得できませんでした');
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    const overlap = grantRoleIds.filter(id => removeRoleIds.includes(id));
    if (overlap.length > 0) {
      toast.error('同じロールを付与と剥奪の両方に設定することはできません');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ENTRY_GRANT_ROLE_IDS: grantRoleIds,
          ENTRY_REMOVE_ROLE_IDS: removeRoleIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP Error ${res.status}`);
      toast.success('設定を保存しました');
    } catch (e: any) {
      console.error('Save error:', e);
      toast.error(`保存に失敗しました: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-zinc-500" size={32} /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader icon={UserCog} title="入場許可ロール設定" subtitle="入界パネルと /面接官 入界許可実行 で付け替えるロールを設定します" guildId={guildId} />

      {/* 付与するロール */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <UserPlus size={18} className="text-red-500" />付与するロール
          <span className="text-xs text-zinc-500 font-normal">(複数選択可)</span>
        </h2>
        <RoleSelect
          label="付与するロール"
          placeholder="未設定（仮メンバーロールを付与）"
          roles={roles}
          value={grantRoleIds}
          onChange={(vals: string[]) => setGrantRoleIds(vals)}
          multiple
        />
        <p className="text-xs text-zinc-500">
          入界手続きが完了したときに付与するロールです。初期値は仮メンバーロールで、何も選ばずに保存した場合も仮メンバーロールを付与します。
        </p>
      </div>

      {/* 剥奪するロール */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <UserMinus size={18} className="text-red-500" />剥奪するロール
          <span className="text-xs text-zinc-500 font-normal">(複数選択可)</span>
        </h2>
        <RoleSelect
          label="剥奪するロール"
          placeholder="未設定（入界待機者ロールを剥奪）"
          roles={roles}
          value={removeRoleIds}
          onChange={(vals: string[]) => setRemoveRoleIds(vals)}
          multiple
        />
        <p className="text-xs text-zinc-500">
          入界手続きが完了したときに外すロールです。初期値は入界待機者ロールで、ほかのロールも追加できます。何も選ばずに保存した場合は入界待機者ロールを外します。ロールの付与に失敗したときは、どのロールも外しません。
        </p>
      </div>

      {/* 注意 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-sm text-zinc-400 space-y-2">
        <div className="font-semibold text-white">注意</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Discordのロール一覧で、Botのロールをここで選んだロール（付与・剥奪の両方）より上に置いてください。下にあると入界手続きが止まります。</li>
          <li>入界待機者かどうかの判定（/面接官 入界許可実行 で対象者を探すときなど）は、引き続き「入界待機者ロール」の設定を使います。</li>
          <li>評価・部屋などの「仮メンかどうか」の判定は、引き続き「仮（新規）メンバーロール」の設定を使います。</li>
        </ul>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}
