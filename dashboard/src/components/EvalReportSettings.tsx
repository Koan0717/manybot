'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowUp, ArrowDown, Trash2, Plus, Send, FileText } from 'lucide-react';
import ChannelSelect, { ChannelOption } from '@/components/ChannelSelect';

type Item = { id: string; label: string; placeholder: string };
type Settings = {
  items: Item[];
  output_channel_id: string;
  panel_title: string;
  panel_description: string;
  button_label: string;
};

const MAX_ITEMS = 20;
const inputClass = 'w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors';
const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 評価シート記入パネルの設定。評価員がパネルから仮メンを選び、総評（あり・保留・なし）と
 * ここで設定した項目ごとの内容を書いて、送信先チャンネルに送る。
 */
export default function EvalReportSettings({ guildId, channels }: { guildId: string; channels: ChannelOption[] }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [panelChannel, setPanelChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/eval-sheet/report`)
      .then(res => res.json())
      .then(data => {
        if (data.error) toast.error(data.error);
        else setSettings(data);
      })
      .catch(() => toast.error('評価シート記入パネルの設定を取得できませんでした'));
  }, [guildId]);

  if (!settings) {
    return <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-zinc-400">読み込み中...</div>;
  }

  const update = (patch: Partial<Settings>) => setSettings(prev => (prev ? { ...prev, ...patch } : prev));
  const updateItem = (index: number, patch: Partial<Item>) =>
    update({ items: settings.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  const moveItem = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= settings.items.length) return;
    const items = [...settings.items];
    [items[index], items[target]] = [items[target], items[index]];
    update({ items });
  };
  const removeItem = (index: number) => update({ items: settings.items.filter((_, i) => i !== index) });
  const addItem = () => update({ items: [...settings.items, { id: newItemId(), label: '', placeholder: '' }] });

  const save = async (): Promise<boolean> => {
    const res = await fetch(`/api/guilds/${guildId}/eval-sheet/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', ...settings }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '保存に失敗しました');
      return false;
    }
    setSettings(data.settings);
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (await save()) toast.success('評価シート記入パネルの設定を保存しました');
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePostPanel = async () => {
    if (!panelChannel) {
      toast.error('パネルを設置するチャンネルを選択してください');
      return;
    }
    setPosting(true);
    try {
      // パネルの文言は保存済みの設定から作られるので、先に保存しておく
      if (!(await save())) return;
      const res = await fetch(`/api/guilds/${guildId}/eval-sheet/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post_panel', channel_id: panelChannel }),
      });
      const data = await res.json();
      if (!res.ok || data.error) toast.error(data.error || 'パネルの設置に失敗しました');
      else toast.success('パネルの設置をBotに依頼しました');
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setPosting(false);
    }
  };

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  const outputChannels = channels.filter(c => c.type === 0 || c.type === 5 || c.type === 15);
  const modalCount = Math.max(1, Math.ceil(settings.items.length / 5));

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><FileText size={20} /> 評価シート記入パネル</h2>
        <p className="text-sm text-zinc-400 mt-1">
          評価員がパネルのボタンから「仮メンを選択 → 総評（あり・保留・なし）を選択 → 各項目の内容を記入」して送信すると、
          送信先チャンネルに評価シートが投稿されます。投稿には相手のアイコンが右上に表示されます。
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-white">評価項目（{settings.items.length} / {MAX_ITEMS}）</label>
          <span className="text-xs text-zinc-500">総評は固定で入ります</span>
        </div>
        {settings.items.map((item, i) => (
          <div key={item.id} className="flex gap-2 items-start p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
            <span className="text-zinc-500 text-sm pt-2 w-6 text-right flex-shrink-0">{i + 1}</span>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className={inputClass}
                value={item.label}
                maxLength={45}
                placeholder="項目名（例: 声）"
                onChange={e => updateItem(i, { label: e.target.value })}
              />
              <input
                className={inputClass}
                value={item.placeholder}
                maxLength={100}
                placeholder="入力欄のヒント（任意）"
                onChange={e => updateItem(i, { placeholder: e.target.value })}
              />
            </div>
            <div className="flex flex-shrink-0">
              <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="p-2 text-zinc-400 hover:text-white disabled:opacity-30"><ArrowUp size={16} /></button>
              <button type="button" onClick={() => moveItem(i, 1)} disabled={i === settings.items.length - 1} className="p-2 text-zinc-400 hover:text-white disabled:opacity-30"><ArrowDown size={16} /></button>
              <button type="button" onClick={() => removeItem(i)} className="p-2 text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          disabled={settings.items.length >= MAX_ITEMS}
          className="flex items-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg disabled:opacity-40"
        >
          <Plus size={16} /> 項目を追加
        </button>
        {settings.items.length > 5 && (
          <p className="text-xs text-zinc-500">Discordの入力画面は1回に5項目までのため、記入画面は {modalCount} 回に分かれます。</p>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-white">送信先チャンネル</label>
        <p className="text-xs text-zinc-400">記入された評価シートがここに投稿されます（フォーラムを選ぶと1件ずつスレッドになります）。</p>
        <ChannelSelect
          label="送信先チャンネル"
          placeholder="チャンネルを選択..."
          channels={outputChannels}
          value={settings.output_channel_id}
          onChange={(id: any) => update({ output_channel_id: id })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-white">パネルのタイトル</label>
          <input className={inputClass} value={settings.panel_title} maxLength={256} onChange={e => update({ panel_title: e.target.value })} />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-white">ボタンの文字</label>
          <input className={inputClass} value={settings.button_label} maxLength={80} onChange={e => update({ button_label: e.target.value })} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="block text-sm font-semibold text-white">パネルの説明文</label>
          <textarea className={`${inputClass} min-h-[80px]`} value={settings.panel_description} maxLength={2000} onChange={e => update({ panel_description: e.target.value })} />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600"
        >
          {saving ? '保存中...' : 'パネル設定を保存'}
        </button>
      </div>

      <div className="space-y-3 pt-4 border-t border-zinc-800">
        <label className="block text-sm font-semibold text-white">パネルを設置</label>
        <ChannelSelect
          label="設置するチャンネル"
          placeholder="チャンネルを選択..."
          channels={textChannels}
          value={panelChannel}
          onChange={(id: any) => setPanelChannel(id)}
        />
        <button
          onClick={handlePostPanel}
          disabled={posting}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg disabled:opacity-50"
        >
          <Send size={16} /> {posting ? '依頼中...' : '保存してパネルを設置'}
        </button>
        <p className="text-xs text-zinc-500">パネルのボタンは評価員ロールを持つ人だけが使えます。項目を変更しても、設置済みのパネルからそのまま新しい項目で記入できます。</p>
      </div>
    </div>
  );
}
