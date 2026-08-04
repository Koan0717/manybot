'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import { SlidersHorizontal, ImageIcon, Search } from 'lucide-react';
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
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number, left: number, width: number, maxHeight: number, openUpward: boolean }>({ top: 0, left: 0, width: 0, maxHeight: 240, openUpward: false });
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const valArray = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);

  if (loading) return <div className="bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-500 text-sm h-10 flex items-center">読み込み中...</div>;

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

  const selectedRoles = roles.filter(r => valArray.includes(r.id));
  const filteredRoles = searchTerm
    ? roles.filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : roles;

  const computePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const desiredHeight = 288; // 検索欄 + リスト分の目安の高さ
    const openUpward = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(desiredHeight, (openUpward ? spaceAbove : spaceBelow) - 12));

    setDropdownStyle({
      top: openUpward ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight,
      openUpward,
    });
  };

  const openDropdown = () => {
    computePosition();
    setSearchTerm('');
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    computePosition();
    // フォーカスをすぐに検索欄へ
    const t = setTimeout(() => searchInputRef.current?.focus(), 0);

    const handleReposition = () => computePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div className="relative">
      <div 
        ref={triggerRef}
        className="bg-zinc-900 border border-zinc-700 rounded p-2 cursor-pointer hover:border-zinc-500 min-h-[42px] flex flex-wrap gap-1 items-center"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
      >
        {selectedRoles.length === 0 ? (
          <span className="text-zinc-500 px-1 text-sm">未設定</span>
        ) : (
          selectedRoles.map(r => (
            <span key={r.id} className="bg-zinc-800 text-xs px-2 py-1 rounded border border-zinc-700 font-bold" style={{ color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'white' }}>
              @ {r.name}
            </span>
          ))
        )}
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)}></div>
          <div
            className="fixed z-[101] bg-zinc-800 border border-zinc-700 rounded shadow-2xl flex flex-col"
            style={{
              left: dropdownStyle.left,
              width: dropdownStyle.width,
              maxHeight: dropdownStyle.maxHeight,
              ...(dropdownStyle.openUpward
                ? { bottom: window.innerHeight - dropdownStyle.top }
                : { top: dropdownStyle.top }),
            }}
          >
            <div className="p-1.5 border-b border-zinc-700 flex-shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="ロールを検索..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded pl-7 pr-2 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>
            </div>
            <div className="overflow-y-auto p-1 flex-1">
              {!multiple && (
                <div 
                  onClick={() => { onChange(""); setIsOpen(false); }}
                  className="px-3 py-2 cursor-pointer hover:bg-zinc-700 rounded text-sm text-zinc-400"
                >
                  未設定
                </div>
              )}
              {filteredRoles.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-zinc-500">該当するロールがありません</div>
              )}
              {filteredRoles.map(r => {
                const isSelected = valArray.includes(r.id);
                const roleColor = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'white';
                return (
                  <div 
                    key={r.id}
                    onClick={() => toggleOption(r.id)}
                    className={`flex items-center px-3 py-2 cursor-pointer rounded text-sm ${isSelected ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`}
                  >
                    {multiple && (
                      <div className={`w-4 h-4 rounded border flex items-center justify-center mr-3 flex-shrink-0 ${isSelected ? 'bg-red-600 border-red-600' : 'border-zinc-500'}`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                    )}
                    <span style={{ color: roleColor, fontWeight: isSelected ? 'bold' : 'normal' }}>@ {r.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body
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
      
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
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

      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl mb-8">
        <h2 className="text-xl font-bold mb-4 border-b border-zinc-700 pb-2 text-white">すべてのロール設定</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Botが使用する各種機能の対象ロールを一括で設定できます。複数選択が可能な項目もあります。
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
