'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, FileText, Hash, Search, X, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

const LOG_TYPES = [
  { id: 'member_join_leave', label: 'メンバーの参加・退出・キック・BAN' },
  { id: 'message_edit', label: 'メッセージの編集' },
  { id: 'message_delete', label: 'メッセージの削除' },
  { id: 'vc_join_leave', label: 'VCの入退室' },
  { id: 'currency', label: '経済システム・通貨変動' },
  { id: 'shop', label: 'ショップアイテムの購入・使用' },
  { id: 'shop_extend', label: '評価期間延長の購入' },
  { id: 'gambling', label: '賭博・カジノ機能の利用' },
  { id: 'gacha', label: '福引ガチャの利用' },
  { id: 'evaluation_failure', label: '評価シートの浮上・不合格処理' },
  { id: 'interviewer', label: '面接官・入界処理' },
];

function LogChannelSelect({
  label,
  channels,
  value,
  onChange,
  disabled,
  loading,
}: {
  label: string;
  channels: DiscordChannel[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  loading: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (loading) {
    return <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-500 text-sm h-10 flex items-center">読み込み中...</div>;
  }

  const selectedChannel = channels.find(c => c.id === value);
  const filteredChannels = channels.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const modalContent = isOpen ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={() => setIsOpen(false)} />
      <div className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/90">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-emerald-500">●</span> {label}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">ログを出力するチャンネルを選択してください</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg w-8 h-8 flex items-center justify-center transition-colors text-sm font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-zinc-800 bg-zinc-950/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="🔍 チャンネル名で検索..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-12 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-zinc-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300"
              >
                クリア
              </button>
            )}
          </div>
        </div>
        <div className="overflow-y-auto p-3 flex-1 space-y-1 custom-scrollbar min-h-[200px]">
          <div
            onClick={() => { onChange(''); setIsOpen(false); }}
            className={`px-3.5 py-2.5 cursor-pointer rounded-lg text-sm transition-all flex items-center justify-between border ${
              !value
                ? 'bg-zinc-800 border-emerald-600/50 text-white font-bold'
                : 'hover:bg-zinc-800/60 border-transparent text-zinc-400'
            }`}
          >
            <span>未設定（出力しない）</span>
            {!value && <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">現在選択中</span>}
          </div>
          {filteredChannels.length === 0 ? (
            <div className="py-10 text-center text-zinc-500 text-sm">
              「{searchTerm}」に一致するチャンネルは見つかりませんでした
            </div>
          ) : (
            filteredChannels.map(c => {
              const isSelected = c.id === value;
              return (
                <div
                  key={c.id}
                  onClick={() => { onChange(c.id); setIsOpen(false); }}
                  className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer rounded-lg text-sm transition-all border ${
                    isSelected
                      ? 'bg-zinc-800/90 border-emerald-600/50 shadow-sm'
                      : 'hover:bg-zinc-800/40 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Hash className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className={`truncate ${isSelected ? 'text-white font-bold' : 'text-zinc-300'}`}>
                      {c.name}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1 flex-shrink-0">
                      <Check className="w-3 h-3" /> 選択中
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="p-3.5 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {selectedChannel ? <><Hash className="w-3 h-3 inline mr-1" />{selectedChannel.name}</> : '未設定'}
          </span>
          <button
            onClick={() => setIsOpen(false)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2 rounded-lg transition-colors"
          >
            決定して閉じる
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <div
        className="bg-gray-900 border border-gray-600 rounded-lg p-2.5 cursor-pointer hover:border-emerald-500 min-h-[44px] flex items-center justify-between gap-2 transition-all"
        onClick={() => { setIsOpen(true); setSearchTerm(''); }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedChannel ? (
            <span className="bg-gray-800 text-xs px-2.5 py-1 rounded border border-gray-700 font-bold flex items-center gap-1.5 text-white">
              <Hash className="w-3 h-3 text-emerald-400" />
              {selectedChannel.name}
            </span>
          ) : (
            <span className="text-gray-500 px-1 text-sm">未設定（出力しない）</span>
          )}
        </div>
        <div className="bg-gray-800 text-gray-400 hover:text-white px-2.5 py-1 rounded text-xs border border-gray-700 flex-shrink-0 flex items-center gap-1 font-bold">
          <span>選択</span>
        </div>
      </div>
      {mounted && modalContent && createPortal(modalContent, document.body)}
    </div>
  );
}

export default function LogSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  
  const [settings, setSettings] = useState<Record<string, { channel_id: string; is_enabled: boolean }>>({});
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/logs`).then(res => res.ok ? res.json() : {}),
      fetch(`/api/guilds/${guildId}/channels`).then(res => res.ok ? res.json() : [])
    ]).then(([settingsData, channelsData]: [any, any]) => {
      setSettings(settingsData || {});
      setDiscordChannels(channelsData);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setError('データの取得に失敗しました');
      setLoading(false);
    });
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('設定を保存しました！');
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleChannelChange = (logType: string, channelId: string) => {
    setSettings(prev => ({
      ...prev,
      [logType]: {
        ...(prev[logType] || { is_enabled: true }),
        channel_id: channelId
      }
    }));
  };

  const toggleEnabled = (logType: string) => {
    setSettings(prev => ({
      ...prev,
      [logType]: {
        ...(prev[logType] || { channel_id: '' }),
        is_enabled: !(prev[logType]?.is_enabled ?? true)
      }
    }));
  };

  const textChannels = discordChannels.filter(c => c.type === 0);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-green-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-600">
          ログ出力設定
        </h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-lg shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50"
        >
          <Save size={20} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-lg flex items-center space-x-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 border border-emerald-500/20 p-6 rounded-xl space-y-6">
        <div className="flex items-center space-x-3 text-xl font-semibold text-emerald-300 border-b border-emerald-500/20 pb-4">
          <FileText className="text-emerald-400" />
          <h2>ログ種類と出力先の指定</h2>
        </div>
        
        <p className="text-gray-400 text-sm">
          各種ログの出力先チャンネルを指定してください。OFFにした場合、チャンネルが指定されていてもログは出力されません。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {LOG_TYPES.map(log => {
            const conf = settings[log.id] || { channel_id: '', is_enabled: true };
            const isEnabled = conf.is_enabled ?? true;
            return (
              <div key={log.id} className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-3">
                  <label className="block text-sm font-medium text-gray-300">{log.label}</label>
                  <button
                    onClick={() => toggleEnabled(log.id)}
                    className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                      isEnabled 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {isEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <LogChannelSelect
                  label={log.label}
                  channels={textChannels}
                  value={conf.channel_id || ''}
                  onChange={(id) => handleChannelChange(log.id, id)}
                  disabled={!isEnabled}
                  loading={loading}
                />
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
