'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowUp, ArrowDown, Trash2, Plus, Send, FileText } from 'lucide-react';
import ChannelSelect, { ChannelOption } from '@/components/ChannelSelect';
import { useSyncStatus, SyncBadge } from '@/lib/useSyncStatus';
import {
  EvalReportItem as Item,
  EvalReportSheet as Sheet,
  MAX_ITEMS,
  MIN_RATING_SCALE,
  MAX_RATING_SCALE,
  newSheetDraft,
} from '@/lib/evalReport';

const inputClass = 'w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors';
const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 評価シート記入パネルの設定。シートは複数作れて、パネルもシートごとに設置する。
 * 評価員がパネルから仮メンを選び、総評（あり・保留・なし）と、そのシートの項目ごとの内容を書いて、送信先チャンネルに送る。
 */
export default function EvalReportSettings({ guildId, channels }: { guildId: string; channels: ChannelOption[] }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  // 編集中のシート。sheets のどれか（id が同じ）か、未保存の新しいシート（id が null）
  const [settings, setSettings] = useState<Sheet | null>(null);
  const [panelChannel, setPanelChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const sync = useSyncStatus(guildId);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/eval-sheet/report`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          toast.error(data.error || '評価シートの取得に失敗しました');
          return;
        }
        setSheets(data);
        setSettings(data[0] ?? newSheetDraft());
      })
      .catch(() => toast.error('評価シートを取得できませんでした'));
  }, [guildId]);

  if (!sheets || !settings) {
    return <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-zinc-400">読み込み中...</div>;
  }

  const saved = settings.id ? sheets.find(s => s.id === settings.id) : undefined;
  const isDirty = !saved || JSON.stringify(saved) !== JSON.stringify(settings);
  const confirmLeave = () => !isDirty || confirm('保存していない変更があります。破棄して切り替えますか？');

  const selectSheet = (sheet: Sheet) => {
    if (sheet.id === settings.id || !confirmLeave()) return;
    setSettings(sheet);
    sync.reset();
  };
  const addSheet = () => {
    if (!confirmLeave()) return;
    setSettings(newSheetDraft(`評価シート${sheets.length + 1}`));
    sync.reset();
  };

  const update = (patch: Partial<Sheet>) => setSettings(prev => (prev ? { ...prev, ...patch } : prev));
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
  const addItem = () => update({ items: [...settings.items, { id: newItemId(), label: '', placeholder: '', required: true }] });

  /** 保存して、保存後のシートを返す（失敗したら null） */
  const save = async (): Promise<Sheet | null> => {
    const res = await fetch(`/api/guilds/${guildId}/eval-sheet/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '保存に失敗しました');
      return null;
    }
    const sheet: Sheet = data.sheet;
    setSheets(prev => {
      const list = prev ?? [];
      return list.some(s => s.id === sheet.id) ? list.map(s => (s.id === sheet.id ? sheet : s)) : [...list, sheet];
    });
    setSettings(sheet);
    return sheet;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (await save()) toast.success(`「${settings.name}」を保存しました`);
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!settings.id) {
      // 未保存のシートは破棄するだけ
      setSettings(sheets[0] ?? newSheetDraft());
      return;
    }
    if (!confirm(`「${settings.name}」を削除しますか？\n設置済みのこのシートのパネルは使えなくなります。`)) return;
    const res = await fetch(`/api/guilds/${guildId}/eval-sheet/report/${settings.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '削除に失敗しました');
      return;
    }
    toast.success('シートを削除しました');
    const rest = sheets.filter(s => s.id !== settings.id);
    setSheets(rest);
    setSettings(rest[0] ?? newSheetDraft());
    sync.reset();
  };

  const handlePostPanel = async () => {
    if (!panelChannel) {
      toast.error('パネルを設置するチャンネルを選択してください');
      return;
    }
    setPosting(true);
    sync.reset();
    try {
      // パネルの文言は保存済みの設定から作られるので、先に保存しておく（新しいシートはここでIDが決まる）
      const sheet = await save();
      if (!sheet) return;
      const res = await fetch(`/api/guilds/${guildId}/eval-sheet/report/${sheet.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post_panel', channel_id: panelChannel }),
      });
      const data = await res.json();
      if (!res.ok || data.error) toast.error(data.error || 'パネルの設置に失敗しました');
      else {
        toast.success(`「${sheet.name}」のパネルの設置をBotに依頼しました`);
        // Botが依頼を処理したか（またはオフラインか）をボタンの横に表示する
        sync.startPolling(data.sync_request_id ?? null);
      }
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setPosting(false);
    }
  };

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  const outputChannels = channels.filter(c => c.type === 0 || c.type === 5 || c.type === 15);
  // 段階ありは1項目で「段階」と「内容」の2欄を使うので1画面2項目、段階なしなら5項目まで（Bot側と同じ）
  const perModal = settings.rating_scale ? 2 : 5;
  const modalCount = Math.max(1, Math.ceil(settings.items.length / perModal));
  const tabs: Sheet[] = settings.id ? sheets : [...sheets, settings];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><FileText size={20} /> 評価シート記入パネル</h2>
        <p className="text-sm text-zinc-400 mt-1">
          シートは複数作れて、パネルもシートごとに設置できます。評価員がパネルのボタンから「仮メンを選択 → 総評（あり・保留・なし）を選択 → {settings.rating_scale
            ? `各項目の段階（保留・1〜${settings.rating_scale}、${settings.rating_scale}が最高）と内容を記入`
            : '各項目の内容を記入'}」して送信すると、
          送信先チャンネルに評価シートが投稿されます。投稿には相手のアイコンが右上に表示されます。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(s => {
          const active = s.id === settings.id;
          return (
            <button
              key={s.id ?? 'new'}
              type="button"
              onClick={() => selectSheet(s)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {(active ? settings.name : s.name) || '（名前なし）'}
              {active && isDirty && <span className="ml-1 text-amber-300">●</span>}
              {!s.id && <span className="ml-1 text-xs text-zinc-300">（未保存）</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={addSheet}
          disabled={!settings.id}
          title={settings.id ? undefined : '新しいシートを保存してから追加できます'}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-dashed border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          <Plus size={14} /> シートを追加
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2 flex-1 min-w-[200px]">
          <label className="block text-sm font-semibold text-white">シート名</label>
          <input
            className={inputClass}
            value={settings.name}
            maxLength={100}
            placeholder="例: 仮メン評価シート"
            onChange={e => update({ name: e.target.value })}
          />
          <p className="text-xs text-zinc-500">送信される評価シートのタイトルにもなります。</p>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center gap-1 px-3 py-2 mb-6 text-red-400 hover:bg-red-400/10 border border-red-500/30 text-sm rounded-lg"
        >
          <Trash2 size={16} /> {settings.id ? 'このシートを削除' : '作成をやめる'}
        </button>
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
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none md:col-span-2">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={e => updateItem(i, { required: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                記入欄を必須にする
                <span className="text-xs text-zinc-500">{item.required ? '（空欄では送信できません）' : '（任意：空欄のままでも送信できます）'}</span>
              </label>
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
        {settings.items.length > perModal && (
          <p className="text-xs text-zinc-500">
            Discordの入力画面は1回に{settings.rating_scale ? '2項目（段階と内容）' : '5項目'}までのため、記入画面は {modalCount} 回に分かれます。
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-white">段階の数</label>
        <p className="text-xs text-zinc-400">
          {settings.rating_scale
            ? `各項目で「保留」と 1〜${settings.rating_scale} から選んでもらいます（${settings.rating_scale} が最高）。このシートの全項目で共通です。`
            : '段階は使いません。記入画面にも評価シートにも段階は表示されません。'}
        </p>
        <select
          className={`${inputClass} md:w-48`}
          value={settings.rating_scale}
          onChange={e => update({ rating_scale: Number(e.target.value) })}
        >
          <option value={0}>段階なし</option>
          {Array.from({ length: MAX_RATING_SCALE - MIN_RATING_SCALE + 1 }, (_, i) => MIN_RATING_SCALE + i).map(n => (
            <option key={n} value={n}>{n}段階</option>
          ))}
        </select>
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
          {saving ? '保存中...' : 'このシートを保存'}
        </button>
      </div>

      <div className="space-y-3 pt-4 border-t border-zinc-800">
        <label className="block text-sm font-semibold text-white">「{settings.name || 'このシート'}」のパネルを設置</label>
        <ChannelSelect
          label="設置するチャンネル"
          placeholder="チャンネルを選択..."
          channels={textChannels}
          value={panelChannel}
          onChange={(id: any) => setPanelChannel(id)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handlePostPanel}
            disabled={posting}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg disabled:opacity-50"
          >
            <Send size={16} /> {posting ? '依頼中...' : '保存してパネルを設置'}
          </button>
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
        </div>
        <p className="text-xs text-zinc-500">
          パネルのボタンは評価員ロールを持つ人だけが使えます。項目を変更しても、設置済みのパネルからそのまま新しい項目で記入できます。
          同じシートのパネルを複数のチャンネルに置くこともできます。
        </p>
      </div>
    </div>
  );
}
