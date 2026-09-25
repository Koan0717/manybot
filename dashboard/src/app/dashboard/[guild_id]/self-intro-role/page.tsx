'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Eye, Shield, Hash, Bell, UserPlus, Plus, Trash2, Split } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

interface Channel { id: string; name: string; type: number; }
interface Role { id: string; name: string; color: number; }
interface ChannelRoleRule { channel_id: string; role_ids: string[]; enabled: boolean; }

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
    </label>
  );
}

function extractKeywords(template: string): string[] {
  const keywords: string[] = [];
  for (const rawLine of template.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const bracketMatch = line.match(/^(【[^】]+】)/);
    if (bracketMatch) { keywords.push(bracketMatch[1]); continue; }
    const colonMatch = line.match(/^([^：:]+[：:])/);
    if (colonMatch) { keywords.push(colonMatch[1]); continue; }
    keywords.push(line);
  }
  return keywords;
}

export default function SelfIntroRolePage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [welcomeChannelId, setWelcomeChannelId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [template, setTemplate] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [channelRolesEnabled, setChannelRolesEnabled] = useState(false);
  const [channelRoles, setChannelRoles] = useState<ChannelRoleRule[]>([]);
  const updateRule = (i: number, patch: Partial<ChannelRoleRule>) =>
    setChannelRoles(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const textChannels = channels.filter(c => c.type === 0);
  const keywords = extractKeywords(template);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/self-intro-role`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/channels`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/roles`).then(r => r.json()),
    ]).then(([settings, ch, ro]) => {
      if (settings && !settings.error) {
        setIsEnabled(settings.is_enabled ?? false);
        setChannelIds(Array.isArray(settings.channel_ids) ? settings.channel_ids.map(String) : settings.channel_id ? [String(settings.channel_id)] : []);
        setWelcomeChannelId(settings.welcome_channel_id ?? '');
        setRoleId(settings.role_id ?? '');
        setTemplate(settings.template ?? '');
        setChannelRolesEnabled(settings.channel_roles_enabled ?? false);
        setChannelRoles(Array.isArray(settings.channel_roles) ? settings.channel_roles : []);
      }
      if (ch && !ch.error && Array.isArray(ch)) setChannels(ch);
      if (ro && !ro.error && Array.isArray(ro)) setRoles(ro.filter((r: Role) => r.name !== '@everyone'));
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    const rules = channelRoles.filter(r => r.channel_id);
    if (channelRoles.some(r => !r.channel_id || !r.role_ids.length)) {
      toast.error('チャンネルごとのロール付与で、チャンネルかロールが未選択の行があります。');
      return;
    }
    const activeRules = channelRolesEnabled ? rules.filter(r => r.enabled) : [];
    if (isEnabled && ((!channelIds.length && !activeRules.length) || (!roleId && !activeRules.length))) {
      toast.error('有効にする場合は「自己紹介チャンネル」と「付与するロール」を選択してください（チャンネルごとのロール付与を使う場合は共通のロールは省略できます）。');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/self-intro-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_ids: channelIds,
          welcome_channel_id: welcomeChannelId || null,
          role_id: roleId || null,
          template: template || '',
          is_enabled: isEnabled,
          channel_roles_enabled: channelRolesEnabled,
          channel_roles: rules,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP Error ${res.status}`);
      }
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
      <PageHeader icon={UserPlus} title="条件ロール付与設定" subtitle="入室時の自己紹介テンプレートに応じて自動でロールを付与します" guildId={guildId} healthKey="self-intro-role" />

      {/* 有効/無効 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-white">機能を有効にする</div>
            <div className="text-sm text-zinc-400 mt-1">OFFにすると入室案内もロール付与も行われません</div>
          </div>
          <Toggle checked={isEnabled} onChange={setIsEnabled} />
        </div>
      </div>

      {/* チャンネル・ロール設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2"><Hash size={18} className="text-red-500" />チャンネル・ロール設定</h2>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            自己紹介チャンネル <span className="text-red-400">*</span>
            <span className="ml-2 text-xs text-zinc-500 font-normal">(複数選択可)</span>
          </label>
          <p className="text-xs text-zinc-500 mb-2">テンプレートの記入を監視するチャンネルです。どれか1つのチャンネルでテンプレートを埋めて投稿するとロールが付与されます。</p>
          <ChannelSelect
            label="自己紹介チャンネル"
            placeholder="チャンネルを選択..."
            channels={textChannels}
            value={channelIds}
            onChange={(ids: any) => setChannelIds(Array.isArray(ids) ? ids.map(String) : ids ? [String(ids)] : [])}
            multiple
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Bell size={14} className="inline mr-1 text-zinc-400" />入室案内の送信先チャンネル（任意）</label>
          <p className="text-xs text-zinc-500 mb-2">入室時のメンション案内を送るチャンネルです。未選択の場合は自己紹介チャンネル（複数あるときは1つ目）に直接送ります。</p>
          <ChannelSelect
            label="入室案内の送信先チャンネル"
            placeholder="未設定（自己紹介チャンネルに送る）"
            channels={textChannels}
            value={welcomeChannelId}
            onChange={(id: any) => setWelcomeChannelId(id || '')}
            multiple={false}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Shield size={14} className="inline mr-1 text-zinc-400" />付与するロール（全員共通）</label>
          <p className="text-xs text-zinc-500 mb-2">どのチャンネルで自己紹介しても付与するロールです。下の「チャンネルごとのロール付与」だけを使う場合は未選択でもかまいません。</p>
          <RoleSelect
            label="付与するロール"
            placeholder="ロールを選択..."
            roles={roles}
            value={roleId}
            onChange={(id: any) => setRoleId(id || '')}
            multiple={false}
          />
        </div>
      </div>

      {/* チャンネルごとのロール付与 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><Split size={18} className="text-red-500" />チャンネルごとのロール付与</h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              自己紹介を書いたチャンネルに応じて、追加でロールを付与します。<br />
              例: 「自己紹介♂」チャンネル → 男性ロール、「自己紹介♀」チャンネル → 女性ロール<br />
              ここで選んだチャンネルも自己紹介チャンネルとして監視します（上の共通ロールも一緒に付与されます）。
            </p>
          </div>
          <Toggle checked={channelRolesEnabled} onChange={setChannelRolesEnabled} />
        </div>

        <div className={`space-y-3 ${channelRolesEnabled ? '' : 'opacity-50'}`}>
          {!channelRolesEnabled && <p className="text-xs text-zinc-500">OFFのあいだは、下の設定があってもチャンネルごとのロールは付与されません。</p>}
          {channelRoles.map((rule, i) => (
            <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <Toggle checked={rule.enabled} onChange={v => updateRule(i, { enabled: v })} />
                  <span>{rule.enabled ? 'ON' : 'OFF'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setChannelRoles(rs => rs.filter((_, j) => j !== i))}
                  className="text-zinc-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800"
                  aria-label="この行を削除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">このチャンネルで自己紹介したら</label>
                  <ChannelSelect
                    label="チャンネル"
                    placeholder="チャンネルを選択..."
                    channels={textChannels}
                    value={rule.channel_id}
                    onChange={(id: any) => updateRule(i, { channel_id: id ? String(id) : '' })}
                    multiple={false}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">このロールを付与（複数可）</label>
                  <RoleSelect
                    label="ロール"
                    placeholder="ロールを選択..."
                    roles={roles}
                    value={rule.role_ids}
                    onChange={(ids: any) => updateRule(i, { role_ids: Array.isArray(ids) ? ids.map(String) : ids ? [String(ids)] : [] })}
                    multiple
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setChannelRoles(rs => [...rs, { channel_id: '', role_ids: [], enabled: true }])}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-zinc-700 hover:border-red-500 text-zinc-400 hover:text-white rounded-lg py-2.5 text-sm transition-colors"
          >
            <Plus size={16} /> チャンネルとロールの組み合わせを追加
          </button>
        </div>
      </div>

      {/* テンプレート設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">自己紹介テンプレート</h2>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 bg-zinc-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Eye size={14} />
            {showPreview ? '編集に戻る' : '判定キーワードを確認'}
          </button>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          ユーザーが入室した際に送信されるテンプレートです。<br />
          行頭の <code className="bg-zinc-800 px-1 py-0.5 rounded text-red-400">【項目名】</code> または <code className="bg-zinc-800 px-1 py-0.5 rounded text-red-400">項目名：</code> が自動で<strong>必須キーワード</strong>として抽出されます。<br />
          ユーザーがすべての項目を書いて送信した時のみ、指定ロールが付与されます。
        </p>

        {showPreview ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="text-xs text-zinc-400 font-semibold">検出された必須キーワード ({keywords.length}個):</div>
            {keywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {keywords.map((kw, i) => (
                  <span key={i} className="text-xs bg-red-950/60 border border-red-800 text-red-300 px-2.5 py-1 rounded-md font-mono">
                    {kw}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">キーワードが見つかりませんでした。【項目名】の形式で行頭に記入してください。</p>
            )}
          </div>
        ) : (
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            rows={8}
            placeholder={"【名前】\n【一言】\n【好きなゲーム】"}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-red-500 leading-relaxed"
          />
        )}
      </div>

      {/* 保存ボタン */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          設定を保存
        </button>
      </div>
    </div>
  );
}