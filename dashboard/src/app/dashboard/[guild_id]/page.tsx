'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { SlidersHorizontal, ImageIcon, Search, X, Check, ChevronsUpDown } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

/**
 * Googleドライブの共有リンク等を、画像として直接表示できるURLに変換する。
 * (Botサーバー側の helpers.normalize_image_url と同じロジックのフロント版。プレビュー表示専用)
 */
function normalizeImageUrlForPreview(url: string): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (trimmed.includes('drive.google.com')) {
    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/,
    ];
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400`;
    }
  }
  return trimmed;
}

function RoleSelect({ multiple, value, onChange, roles, loading }: { multiple: boolean, value: any, onChange: (val: any) => void, roles: any[], loading: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const valArray = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);

  // ドロップダウン外クリック時の非表示処理
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 開いた時に検索窓へフォーカス
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  if (loading) return <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-zinc-500 text-sm h-10 flex items-center">読み込み中...</div>;

  const handleToggleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // 画面下部のスペースが280px未満の場合、上に展開する
      setOpenUpward(spaceBelow < 280);
    }
    setIsOpen(!isOpen);
    setSearchTerm('');
  };

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

  const filteredRoles = roles.filter(r =>
    (r.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedRoles = roles.filter(r => valArray.includes(r.id));

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredRoles.map(r => r.id);
    const newSet = Array.from(new Set([...valArray, ...filteredIds]));
    onChange(newSet);
  };

  const handleDeselectAll = () => {
    onChange([]);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div 
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 cursor-pointer hover:border-zinc-500 transition-colors min-h-[42px] flex items-center justify-between gap-2"
        onClick={handleToggleOpen}
      >
        <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
          {selectedRoles.length === 0 ? (
            <span className="text-zinc-500 px-1 text-sm">未設定</span>
          ) : (
            selectedRoles.map(r => (
              <span 
                key={r.id} 
                className="bg-zinc-800 text-xs px-2 py-1 rounded border border-zinc-700 font-bold flex items-center gap-1.5" 
                style={{ color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'white' }}
              >
                <span 
                  className="w-2 h-2 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#a1a1aa' }}
                />
                @{r.name}
              </span>
            ))
          )}
        </div>
        <ChevronsUpDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
      </div>

      {isOpen && (
        <div 
          className={`absolute z-50 left-0 right-0 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{ maxHeight: '320px' }}
        >
          {/* 検索バーエリア */}
          <div className="p-2 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur sticky top-0 z-10 flex flex-col gap-2">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 pointer-events-none" />
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="ロール名で検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md pl-8 pr-7 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 transition-colors"
              />
              {searchTerm && (
                <button 
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSearchTerm(''); }}
                  className="absolute right-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 複数選択時の一括操作ボタン */}
            {multiple && (
              <div className="flex items-center justify-between text-[11px] px-1 text-zinc-400">
                <span>{selectedRoles.length} 件選択中</span>
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleSelectAllFiltered(); }}
                    className="hover:text-red-400 transition-colors font-medium"
                  >
                    全選択
                  </button>
                  <span>|</span>
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeselectAll(); }}
                    className="hover:text-red-400 transition-colors font-medium"
                  >
                    全解除
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ロール選択肢一覧 */}
          <div className="overflow-y-auto flex-1 p-1 space-y-0.5 max-h-60">
            {!multiple && (
              <div 
                onClick={() => { onChange(""); setIsOpen(false); }}
                className={`px-3 py-2 cursor-pointer rounded-md text-sm transition-colors flex items-center justify-between ${
                  !value ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:bg-zinc-800/60'
                }`}
              >
                <span>未設定</span>
                {!value && <Check className="w-4 h-4 text-red-500" />}
              </div>
            )}

            {filteredRoles.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">
                該当するロールが見つかりません
              </div>
            ) : (
              filteredRoles.map(r => {
                const isSelected = valArray.includes(r.id);
                const roleColor = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#ffffff';
                return (
                  <div 
                    key={r.id}
                    onClick={() => toggleOption(r.id)}
                    className={`flex items-center justify-between px-3 py-2 cursor-pointer rounded-md text-sm transition-colors ${
                      isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {multiple && (
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-red-600 border-red-600' : 'border-zinc-600 bg-zinc-950'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                        </div>
                      )}
                      <span 
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                        style={{ backgroundColor: roleColor }}
                      />
                      <span 
                        className="truncate"
                        style={{ color: roleColor, fontWeight: isSelected ? 'bold' : 'normal' }}
                      >
                        @{r.name}
                      </span>
                    </div>

                    {!multiple && isSelected && (
                      <Check className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_SETTINGS = [
  { key: 'NEW_MEMBER_ROLE_ID', label: '仮（新規）メンバーロール', multiple: false },
  { key: 'DOWNGRADE_ROLE_ID', label: '評価落ちロール', multiple: false },
  { key: 'PENDING_MEMBER_ROLE_ID', label: '入界待機者ロール', multiple: false },
  { key: 'EMBLEM_MANAGER_ROLE_ID', label: 'スタンプ統括ロール', multiple: false },
  { key: 'EMBLEM_MASTER_ROLE_IDS', label: 'スタンプ従業員ロール', multiple: true },
  { key: 'CONFESSION_PRIEST_ROLE_ID', label: '告解司祭ロール', multiple: false },
  { key: 'PRIEST_ROLE_ID', label: '司祭ロール', multiple: false },
  { key: 'ADMIN_ROLE_IDS', label: '運営管理者ロール', multiple: true },
  { key: 'INTERVIEWER_ROLE_IDS', label: '面接官ロール', multiple: true },
  { key: 'EVALUATOR_ROLE_IDS', label: '初級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER2_ROLE_IDS', label: '中級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER3_ROLE_IDS', label: '上級評価員ロール', multiple: true },
  { key: 'EVALUATOR_MENTION_ROLE_IDS', label: '評価員メンション用ロール', multiple: true },
  { key: 'FREE_INN_ROLE_IDS', label: '無料宿ロール', multiple: true },
  { key: 'MAIN_SUB_MEMBER_ROLE_IDS', label: '本・準メンバーロール', multiple: true },
  { key: 'EVENT_MANAGER_ROLE_IDS', label: 'イベンター統括ロール', multiple: true },
  { key: 'GAMBLE_EMPLOYEE_ROLE_IDS', label: '賭博従業員ロール', multiple: true },
  { key: 'GAMBLE_MANAGER_ROLE_IDS', label: '賭博統括ロール', multiple: true },
  { key: 'SHOP_EMPLOYEE_ROLE_ID', label: 'ショップ従業員ロール', multiple: false },
  { key: 'SHOP_MANAGER_ROLE_ID', label: 'ショップ統括ロール', multiple: false },
  { key: 'MINUS_TARGET_ROLE_IDS', label: '通貨マイナス落ち対象ロール', multiple: true },
  { key: 'BANKER_ROLE_IDS', label: '銀行員ロール', multiple: true },
  { key: 'GAMBLE_VIOLATOR_ROLE_IDS', label: '違反者ロール', multiple: true },
];

export default function GeneralSettings({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings state to hold the selected values for each key
  const [settings, setSettings] = useState<Record<string, any>>({});

  useEffect(() => {
    // 並列でデータ取得
    Promise.all([
      fetch(`/api/guilds/${guildId}/roles`).then(res => res.json()),
      fetch(`/api/guilds/${guildId}/settings`).then(res => res.json())
    ])
    .then(([rolesData, settingsData]) => {
      if (!rolesData.error) {
        setRoles(rolesData.filter((r: any) => r.id !== guildId));
      }
      if (!settingsData.error) {
        // 数値型の場合は文字列に変換してセレクトボックスと合わせる
        const formattedSettings: Record<string, any> = {};
        for (const [k, v] of Object.entries(settingsData)) {
          if (Array.isArray(v)) {
            formattedSettings[k] = v.map(String);
          } else if (v) {
            formattedSettings[k] = String(v);
          }
        }
        setSettings(formattedSettings);
      }
    })
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [guildId]);

  const handleChange = (key: string, value: any, multiple: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    
    const payload: Record<string, any> = {};
    for (const setting of ROLE_SETTINGS) {
      const val = settings[setting.key];
      if (val !== undefined && val !== null) {
        payload[setting.key] = val;
      }
    }
    
    if (settings['BOT_NICKNAME'] !== undefined) {
      payload['BOT_NICKNAME'] = settings['BOT_NICKNAME'];
    }

    if (settings['BOT_ICON_URL'] !== undefined) {
      payload['BOT_ICON_URL'] = settings['BOT_ICON_URL'];
    }
    
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        toast.success('設定を保存しました！');
      } else {
        toast.error('エラーが発生しました: ' + data.error);
      }
    } catch (e) {
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <PageHeader icon={SlidersHorizontal} title="基本・評価設定" subtitle="Botの基本動作と評価システムを設定します" />
      
      <div className="rounded-xl mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">ボットプロファイル設定</h2>
        <p className="text-sm text-zinc-400 mb-6">
          このサーバー内でのボットのニックネーム・アイコン（サーバー別アバター）を設定できます。（未設定の場合はデフォルトのまま）
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-300 font-bold">ボットのニックネーム</label>
            <input 
              type="text" 
              value={settings['BOT_NICKNAME'] || ''}
              onChange={(e) => handleChange('BOT_NICKNAME', e.target.value, false)}
              placeholder="例: サポートBot"
              className="bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-red-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-300 font-bold flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
              ボットのアイコン画像URL
              <span className="text-xs text-zinc-500 font-normal">(このサーバー限定)</span>
            </label>
            <div className="flex items-center gap-3">
              {settings['BOT_ICON_URL'] ? (
                <img
                  src={normalizeImageUrlForPreview(settings['BOT_ICON_URL'])}
                  alt="icon preview"
                  className="w-10 h-10 rounded-full border border-zinc-700 object-cover flex-shrink-0 bg-zinc-900"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  onLoad={(e) => { (e.target as HTMLImageElement).style.visibility = 'visible'; }}
                />
              ) : (
                <div className="w-10 h-10 rounded-full border border-dashed border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-600">
                  <ImageIcon className="w-4 h-4" />
                </div>
              )}
              <input
                type="text"
                value={settings['BOT_ICON_URL'] || ''}
                onChange={(e) => handleChange('BOT_ICON_URL', e.target.value, false)}
                placeholder="https://drive.google.com/file/d/xxxx/view など"
                className="bg-zinc-900 border border-zinc-700 rounded p-2 text-white focus:border-red-500 focus:outline-none transition-colors flex-1 min-w-0"
              />
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Googleドライブの共有リンク（「リンクを知っている全員が閲覧可」に設定したもの）にも対応しています。反映まで数秒〜数十秒かかる場合があります。
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">すべてのロール設定</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Botが使用する各種機能の対象ロールを一括で設定できます。検索窓でロールの絞り込みも可能です。
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ROLE_SETTINGS.map((setting) => (
            <div key={setting.key} className="flex flex-col gap-2">
              <label className="text-sm text-zinc-300 font-bold">
                {setting.label}
                {setting.multiple && <span className="ml-2 text-xs text-zinc-500 font-normal">(複数選択可)</span>}
              </label>
              <RoleSelect 
                multiple={setting.multiple}
                value={settings[setting.key] || (setting.multiple ? [] : '')}
                onChange={(val) => handleChange(setting.key, val, setting.multiple)}
                roles={roles}
                loading={loading}
              />
            </div>
          ))}
        </div>
        
        <div className="mt-8 border-t border-zinc-700 pt-4">
          <button 
            onClick={handleSave}
            className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white transition-colors px-8 py-3 rounded-lg font-bold disabled:opacity-50 w-full md:w-auto flex items-center justify-center gap-2" 
            disabled={loading || saving}
          >
            {saving ? '保存中...' : '設定を保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}

