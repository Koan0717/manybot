'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Eye, Shield, Hash, Bell, UserPlus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';

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

  const roleColor = (color: number) => color ? `#${color.toString(16).padStart(6, '0')}` : '#99aab5';

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
          <select value={channelId} onChange={e => setChannelId(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500">
            <option value="">-- 選択してください --</option>
            {textChannels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Bell size={14} className="inline mr-1 text-zinc-400" />入室案内の送信先チャンネル（任意）</label>
          <p className="text-xs text-zinc-500 mb-2">入室時のメンション案内を送るチャンネルです。未選択の場合は自己紹介チャンネルに直接送ります。</p>
          <select value={welcomeChannelId} onChange={e => setWelcomeChannelId(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500">
            <option value="">-- 未設定（自己紹介チャンネルに送る）--</option>
            {textChannels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2"><Shield size={14} className="inline mr-1 text-zinc-400" />付与するロール <span className="text-red-400">*</span></label>
          <p className="text-xs text-zinc-500 mb-2">自己紹介完成後に付与するロールです。</p>
          <select value={roleId} onChange={e => setRoleId(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500">
            <option value="">-- 選択してください --</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {roleId && (
            <div className="mt-2 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: roleColor(roles.find(r => r.id === roleId)?.color ?? 0) }} />
              <span className="text-sm text-zinc-300">{roles.find(r => r.id === roleId)?.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* テンプレート設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">自己紹介テンプレート</h2>
          <button onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
            <Eye size={15} />{showPreview ? 'テンプレートを編集' : 'チェック項目プレビュー'}
          </button>
        </div>
        <p className="text-xs text-zinc-500">【〇〇】 や 〇〇： 形式で書いた各行がチェック項目になります。<br />例: 【名前】、【年齢】、招待者：、趣味：</p>

        {showPreview ? (
          <div className="space-y-3">
            <div className="text-sm text-zinc-400 mb-2">抽出されるチェック項目：</div>
            {keywords.length === 0 ? (
              <div className="text-zinc-500 text-sm italic">テンプレートを入力してください</div>
            ) : (
              <div className="space-y-2">
                {keywords.map((kw, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                    <div className="w-5 h-5 rounded-full bg-red-600/20 border border-red-500/50 flex items-center justify-center text-xs text-red-400 font-bold flex-shrink-0">{i + 1}</div>
                    <code className="text-sm text-red-300 font-mono">{kw}</code>
                    <span className="text-xs text-zinc-500 ml-auto">がメッセージに含まれるかチェック</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 p-3 bg-blue-950/30 border border-blue-900/50 rounded-lg text-xs text-blue-300">
              💡 上記の全項目がメッセージ内に含まれていると自己紹介完成と判定されます。
            </div>
          </div>
        ) : (
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder={'例:\n【名前】\n【年齢】\n趣味：\n招待者：'}
            rows={8}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white font-mono text-sm focus:outline-none focus:border-red-500 resize-y"
          />
        )}
      </div>

      {/* 動作プレビュー */}
      {channelId && template && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-bold mb-4">入室時の案内メッセージプレビュー</h2>
          <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800 font-mono text-sm text-zinc-200 whitespace-pre-wrap">
            {`🎉 @新メンバー さん、ようこそ！\n\nまず #${textChannels.find(c => c.id === channelId)?.name ?? '自己紹介'} で以下のテンプレートを使って自己紹介をお願いします📝\n全ての項目を埋めて送信すると、ロールが付与されます！\n\n` + '```\n' + template + '\n```'}
          </div>
        </div>
      )}

      {/* 保存ボタン */}
      <div className="flex justify-end pb-8">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors">
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          設定を保存する
        </button>
      </div>
    </div>
  );
}