'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Hash, BadgeCheck, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';

interface Channel { id: string; name: string; type: number; parent_id?: string | null; }

const DEFAULT_KEYWORD = '初期発行お願いします';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
    </label>
  );
}

export default function AutoInitialIssuePage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [initialCoins, setInitialCoins] = useState<number>(30000);
  const [currencyName, setCurrencyName] = useState('コイン');
  const [channels, setChannels] = useState<Channel[]>([]);

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/settings`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/channels`).then(r => r.json()),
    ]).then(([settings, ch]) => {
      if (settings && !settings.error) {
        setIsEnabled(settings.AUTO_INITIAL_ISSUE_ENABLED === true || settings.AUTO_INITIAL_ISSUE_ENABLED === 'true');
        const ids = settings.AUTO_INITIAL_ISSUE_CHANNEL_IDS;
        setChannelIds(Array.isArray(ids) ? ids.map(String) : ids ? [String(ids)] : []);
        setKeyword(settings.AUTO_INITIAL_ISSUE_KEYWORD || DEFAULT_KEYWORD);
        if (settings.INITIAL_COINS !== undefined) setInitialCoins(Number(settings.INITIAL_COINS));
        if (settings.CURRENCY_NAME) setCurrencyName(String(settings.CURRENCY_NAME));
      }
      if (ch && !ch.error && Array.isArray(ch)) setChannels(ch);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    if (isEnabled && !channelIds.length) {
      toast.error('有効にする場合は、受け付けるチャンネルを1つ以上選択してください。');
      return;
    }
    if (!keyword.trim()) {
      toast.error('反応する言葉を入力してください。');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          AUTO_INITIAL_ISSUE_ENABLED: isEnabled,
          AUTO_INITIAL_ISSUE_CHANNEL_IDS: channelIds,
          AUTO_INITIAL_ISSUE_KEYWORD: keyword.trim(),
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
      <PageHeader icon={BadgeCheck} title="初期発行自動" subtitle="指定チャンネルで「初期発行お願いします」と発言した人に自動で初期発行します" guildId={guildId} />

      {/* 有効/無効 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-white">機能を有効にする</div>
            <div className="text-sm text-zinc-400 mt-1">OFFにすると自動での初期発行は行われません（/初期発行 コマンドは引き続き使えます）</div>
          </div>
          <Toggle checked={isEnabled} onChange={setIsEnabled} />
        </div>
      </div>

      {/* チャンネル設定 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2"><Hash size={18} className="text-red-500" />受け付けるチャンネル</h2>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            監視するチャンネル <span className="text-red-400">*</span>
            <span className="ml-2 text-xs text-zinc-500 font-normal">(複数選択可)</span>
          </label>
          <p className="text-xs text-zinc-500 mb-2">ここで選んだチャンネル（とその中のスレッド）での発言だけを確認します。</p>
          <ChannelSelect
            label="監視するチャンネル"
            placeholder="チャンネルを選択..."
            value={channelIds}
            onChange={setChannelIds}
            channels={textChannels}
            multiple
          />
        </div>
      </div>

      {/* 反応する言葉 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2"><MessageSquare size={18} className="text-red-500" />反応する言葉</h2>
        <div>
          <input
            type="text"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={DEFAULT_KEYWORD}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500"
          />
          <p className="text-xs text-zinc-500 mt-2">
            発言にこの言葉が含まれていれば反応します（空白・全角半角の違いは無視します）。
          </p>
        </div>
      </div>

      {/* 動作説明 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-sm text-zinc-400 space-y-2">
        <div className="font-semibold text-white">動作</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>発言した人に初期発行額 <span className="text-white font-semibold">{initialCoins.toLocaleString()} {currencyName}</span> を付与し、その発言に ✅ のリアクションを付けます（金額は「経済・レベリング設定」で変更できます）。</li>
          <li>初期発行は1人1回だけです。すでに発行済みの人には「すでに初期発行済みです」と返信し、付与はしません。</li>
          <li>付与の記録は通貨ログに送られます。</li>
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
