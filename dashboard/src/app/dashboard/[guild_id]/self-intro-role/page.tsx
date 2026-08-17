'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Eye, Shield, Hash, Bell, UserPlus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

interface Channel { id: string; name: string; type: number; }
interface Role { id: string; name: string; color: number; }

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
  const [channelId, setChannelId] = useState('');
  const [welcomeChannelId, setWelcomeChannelId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [template, setTemplate] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [showPreview, setShowPreview] = useState(false);

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
        setChannelId(settings.channel_id ?? '');
        setWelcomeChannelId(settings.welcome_channel_id ?? '');
        setRoleId(settings.role_id ?? '');
        setTemplate(settings.template ?? '');
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
    if (isEnabled && (!channelId || !roleId)) {
      toast.error('有効にする場合は「自己紹介チャンネル」と「付与するロール」を両方選択してください。');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/self-intro-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelId || null,
          welcome_channel_id: welcomeChannelId || null,
          role_id: roleId || null,
          template: template || '',
          is_enabled: isEnabled
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
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
            <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
          </label>
        </div>
      </div>

      {/* チャンネル・ロール設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2"><Hash size={18} className="text-red-500" />チャンネル・ロール設定</h2>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">自己紹介チャンネル <span className="text-red-400">*</span></label>
          <p className="text-xs text-zinc-500 mb-2">テンプレートの記入を監視するチャンネルです。</p>
          <ChannelSelect
            label="自己紹介チャンネル"
            placeholder="チャンネルを選択..."
            channels={textChannels}
            value={channelId}
            onChange={(id: any) => setChannelId(id || '')}
            multiple={false}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Bell size={14} className="inline mr-1 text-zinc-400" />入室案内の送信先チャンネル（任意）</label>
          <p className="text-xs text-zinc-500 mb-2">入室時のメンション案内を送るチャンネルです。未選択の場合は自己紹介チャンネルに直接送ります。</p>
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
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Shield size={14} className="inline mr-1 text-zinc-400" />付与するロール <span className="text-red-400">*</span></label>
          <p className="text-xs text-zinc-500 mb-2">自己紹介完成後に付与するロールです。</p>
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