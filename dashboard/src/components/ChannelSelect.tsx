'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Volume2, Folder, Search, X, Check } from 'lucide-react';

export interface ChannelOption {
  id: string;
  name: string;
  type?: number;
  parent_id?: string | null;
}

interface ChannelSelectProps {
  label?: string;
  placeholder?: string;
  value: string | string[];
  onChange: (value: any) => void;
  channels: ChannelOption[];
  multiple?: boolean;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export default function ChannelSelect({
  label = 'チャンネル選択',
  placeholder = 'チャンネルを選択...',
  value,
  onChange,
  channels = [],
  multiple = false,
  loading = false,
  disabled = false,
  className = '',
}: ChannelSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const valArray = multiple
    ? Array.isArray(value)
      ? value.map(String)
      : []
    : value
    ? [String(value)]
    : [];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-zinc-500 text-sm h-11 flex items-center">
        チャンネル読み込み中...
      </div>
    );
  }

  const toggleOption = (id: string) => {
    if (multiple) {
      if (valArray.includes(id)) {
        onChange(valArray.filter((v: string) => v !== id));
      } else {
        onChange([...valArray, id]);
      }
    } else {
      onChange(id);
      setIsOpen(false);
    }
  };

  const selectedChannels = channels.filter((c) => valArray.includes(String(c.id)));
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getChannelIcon = (type?: number) => {
    if (type === 2) return <Volume2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
    if (type === 4) return <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />;
    return <Hash className="w-4 h-4 text-zinc-400 flex-shrink-0" />;
  };

  const modalContent = isOpen ? (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
      {/* バックドロップ */}
      <div className="absolute inset-0" onClick={() => setIsOpen(false)} />

      {/* モーダル本体 */}
      <div className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* モーダルヘッダー */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/90">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2 font-mecha">
              <span className="text-red-500">●</span> {label}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5 font-tech">
              {multiple
                ? '設定するチャンネルを選択してください（複数選択可）'
                : '送信・設定先のチャンネルを1つ選択してください'}
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg w-8 h-8 flex items-center justify-center transition-colors text-sm font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 検索バー */}
        <div className="p-3 border-b border-zinc-800 bg-zinc-950/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="🔍 チャンネル名でリアルタイム検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-12 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 transition-colors placeholder:text-zinc-500 font-tech"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300 font-tech"
              >
                クリア
              </button>
            )}
          </div>
        </div>

        {/* チャンネルリスト */}
        <div className="overflow-y-auto p-3 flex-1 space-y-1 custom-scrollbar min-h-[220px]">
          {!multiple && (
            <div
              onClick={() => {
                onChange('');
                setIsOpen(false);
              }}
              className={`px-3.5 py-2.5 cursor-pointer rounded-lg text-sm transition-all flex items-center justify-between border ${
                valArray.length === 0
                  ? 'bg-zinc-800 border-zinc-600 text-white font-bold'
                  : 'hover:bg-zinc-800/60 border-transparent text-zinc-400'
              }`}
            >
              <span className="font-tech text-zinc-400">未設定（選択を解除）</span>
              {valArray.length === 0 && (
                <span className="text-xs bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded font-tech">
                  現在選択中
                </span>
              )}
            </div>
          )}

          {filteredChannels.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-sm font-tech">
              「{searchTerm}」に一致するチャンネルは見つかりませんでした
            </div>
          ) : (
            filteredChannels.map((c) => {
              const isSelected = valArray.includes(String(c.id));
              return (
                <div
                  key={c.id}
                  onClick={() => toggleOption(String(c.id))}
                  className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer rounded-lg text-sm transition-all border ${
                    isSelected
                      ? 'bg-zinc-800/90 border-red-500/60 shadow-sm'
                      : 'hover:bg-zinc-800/40 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {getChannelIcon(c.type)}
                    <span className={`font-tech truncate ${isSelected ? 'text-white font-bold' : 'text-zinc-300'}`}>
                      {c.name}
                    </span>
                  </div>

                  {isSelected && (
                    <span className="text-xs bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded font-bold flex items-center gap-1 flex-shrink-0 font-tech">
                      <Check className="w-3 h-3" /> 選択中
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* モーダルフッター */}
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-900/90 flex items-center justify-between">
          <span className="text-xs text-zinc-400 font-tech">
            選択中: <strong className="text-white">{valArray.length}</strong> 個のチャンネル
          </span>
          <button
            onClick={() => setIsOpen(false)}
            className="mecha-btn-sheen bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-5 py-1.5 rounded-lg text-xs font-bold font-mecha shadow-lg transition-all"
          >
            決定して閉じる
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={className}>
      {/* トリガーボタン */}
      <div
        className={`bg-zinc-900 border rounded-lg p-2.5 min-h-[44px] flex flex-wrap gap-1.5 items-center justify-between transition-all ${
          disabled
            ? 'opacity-40 cursor-not-allowed border-zinc-800 pointer-events-none'
            : 'border-zinc-700 cursor-pointer hover:border-zinc-500'
        }`}
        onClick={() => {
          if (disabled) return;
          setIsOpen(true);
          setSearchTerm('');
        }}
      >
        <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-0">
          {selectedChannels.length === 0 ? (
            <span className="text-zinc-500 px-1 text-sm font-tech">{placeholder}</span>
          ) : (
            selectedChannels.map((c) => (
              <span
                key={c.id}
                className="bg-zinc-800 text-xs px-2.5 py-1 rounded border border-zinc-700 font-bold flex items-center gap-1.5 text-white font-tech"
              >
                {getChannelIcon(c.type)}
                {c.name}
              </span>
            ))
          )}
        </div>
        <div className="bg-zinc-800 text-zinc-400 hover:text-white px-2.5 py-1 rounded text-xs border border-zinc-700 flex-shrink-0 flex items-center gap-1 font-bold font-tech">
          <span>選択 / 変更</span>
        </div>
      </div>

      {/* モーダルダイアログ (createPortalで脱出描画) */}
      {mounted && modalContent && createPortal(modalContent, document.body)}
    </div>
  );
}
