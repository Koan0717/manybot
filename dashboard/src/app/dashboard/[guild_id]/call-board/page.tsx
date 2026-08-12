'use client';

import { useState, useEffect } from 'react';
import Select from 'react-select';
import { toast } from 'react-hot-toast';
import { PhoneCall, Send, Save, Info, Hash, FolderKanban } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useSyncStatus, SyncBadge } from '@/lib/useSyncStatus';

export default function CallBoardSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;

  const [textChannels, setTextChannels] = useState<any[]>([]);
  const [categoryChannels, setCategoryChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const sync = useSyncStatus(guildId);

  const [formData, setFormData] = useState({
    panel_channel_id: '',
    board_channel_id: '',
    vc_category_id: ''
  });

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : []),
      fetch(`/api/guilds/${guildId}/call-board`).then(res => res.ok ? res.json() : {})
    ])
      .then(([channelsData, settingsData]: [any, any]) => {
        if (!channelsData.error && Array.isArray(channelsData)) {
          setTextChannels(channelsData.filter((c: any) => c.type === 0)); // GUILD_TEXT
          setCategoryChannels(channelsData.filter((c: any) => c.type === 4)); // GUILD_CATEGORY
        }
        if (!settingsData.error) {
          setFormData({
            panel_channel_id: settingsData.panel_channel_id || '',
            board_channel_id: settingsData.board_channel_id || '',
            vc_category_id: settingsData.vc_category_id || ''
          });
        }
      })
      .catch(err => {
        console.error(err);
        toast.error('データの取得に失敗しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/call-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          ...formData
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('通話募集掲示板の設定を保存しました！');
        sync.startPolling(data.sync_request_id ?? null);
      } else {
        toast.error(`保存に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('通信エラーが発生しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    if (!formData.panel_channel_id) {
      toast.error('パネルを設置するチャンネルを選択してください。');
      return;
    }

    if (!confirm('指定したチャンネルに「通話募集パネル」を送信して設置しますか？')) return;

    setDeploying(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/call-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deploy',
          ...formData
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('パネルの設置リクエストを送信しました！数秒内にDiscordへ反映されます。');
      } else {
        toast.error(`設置に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch (e) {
      toast.error('通信エラーが発生しました。');
    } finally {
      setDeploying(false);
    }
  };

  const textChannelOptions = textChannels.map(c => ({
    value: c.id,
    label: `# ${c.name}`
  }));

  const categoryOptions = categoryChannels.map(c => ({
    value: c.id,
    label: `📁 ${c.name}`
  }));

  const customStyles = {
    control: (base: any) => ({ ...base, backgroundColor: '#18181b', borderColor: '#3f3f46', color: 'white', padding: '2px' }),
    menu: (base: any) => ({ ...base, backgroundColor: '#18181b', zIndex: 9999 }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? '#27272a' : '#18181b',
      color: 'white',
      ':active': { backgroundColor: '#3f3f46' }
    }),
    singleValue: (base: any) => ({ ...base, color: 'white' }),
    input: (base: any) => ({ ...base, color: 'white' })
  };

  if (loading) {
    return <div className="text-zinc-400 p-8">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-0">
        <PageHeader
          icon={PhoneCall}
          title="通話募集掲示板設定"
          subtitle="通話募集パネルの設置、募集掲載チャンネル、マッチング時作成VCカテゴリを設定します"
        />
        <SyncBadge state={sync.state} botOnline={sync.botOnline} className="mt-1" />
      </div>

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-8">
        
        {/* 説明カード */}
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 flex gap-3 items-start">
          <Info className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-zinc-400 space-y-1 leading-relaxed">
            <p className="font-bold text-zinc-200">通話募集機能について</p>
            <p>1. ユーザーが「通話を募集する」ボタンを押すと、目的と一言を入力する画面が表示されます。</p>
            <p>2. 入力・確定された募集は<strong>「募集掲載チャンネル」</strong>に投稿されます（性別ロールに応じて外枠が青/ピンク色になります）。</p>
            <p>3. 募集Embedの「参加する」ボタンを押した側と募集者だけにしか見えないプライベートVCが<strong>「VC作成カテゴリ」</strong>内に全自動作成されます。</p>
          </div>
        </div>

        {/* 設定フォーム */}
        <div className="space-y-6">
          {/* パネル設置チャンネル */}
          <div>
            <label className="block text-sm font-bold text-zinc-200 mb-2 flex items-center gap-2">
              <Hash className="w-4 h-4 text-red-400" />
              募集パネル設置チャンネル
              <span className="text-xs text-zinc-500 font-normal">（「通話を募集する」ボタンが設置される場所）</span>
            </label>
            <Select
              options={textChannelOptions}
              value={textChannelOptions.find(o => o.value === formData.panel_channel_id)}
              onChange={(val: any) => setFormData({ ...formData, panel_channel_id: val ? val.value : '' })}
              styles={customStyles}
              placeholder="チャンネルを選択または検索..."
              isClearable
            />
          </div>

          {/* 募集表示チャンネル */}
          <div>
            <label className="block text-sm font-bold text-zinc-200 mb-2 flex items-center gap-2">
              <Hash className="w-4 h-4 text-red-400" />
              募集一覧掲載チャンネル
              <span className="text-xs text-zinc-500 font-normal">（ユーザーの通話募集Embedが送信される場所）</span>
            </label>
            <Select
              options={textChannelOptions}
              value={textChannelOptions.find(o => o.value === formData.board_channel_id)}
              onChange={(val: any) => setFormData({ ...formData, board_channel_id: val ? val.value : '' })}
              styles={customStyles}
              placeholder="チャンネルを選択または検索..."
              isClearable
            />
          </div>

          {/* VC作成カテゴリ */}
          <div>
            <label className="block text-sm font-bold text-zinc-200 mb-2 flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-red-400" />
              マッチング時VC作成カテゴリ
              <span className="text-xs text-zinc-500 font-normal">（「参加する」ボタン押下時にプライベートVCが作られるカテゴリー）</span>
            </label>
            <Select
              options={categoryOptions}
              value={categoryOptions.find(o => o.value === formData.vc_category_id)}
              onChange={(val: any) => setFormData({ ...formData, vc_category_id: val ? val.value : '' })}
              styles={customStyles}
              placeholder="カテゴリを選択または検索..."
              isClearable
            />
          </div>
        </div>

        {/* ボタンアクション */}
        <div className="pt-6 border-t border-zinc-800 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto mecha-btn-sheen font-mecha bg-gradient-to-r from-zinc-700 to-zinc-900 hover:from-zinc-600 hover:to-zinc-800 disabled:opacity-50 text-white border border-zinc-600 px-6 py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 text-sm shadow-md"
          >
            <Save className="w-4 h-4 text-zinc-300" />
            {saving ? '保存中...' : '設定を保存する'}
          </button>

          <button
            onClick={handleDeploy}
            disabled={deploying || !formData.panel_channel_id}
            className="w-full sm:w-auto mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
          >
            <Send className="w-4 h-4 text-white" />
            {deploying ? '設置リクエスト送信中...' : '🚀 指定チャンネルに募集パネルを設置する'}
          </button>
        </div>

      </div>
    </div>
  );
}
