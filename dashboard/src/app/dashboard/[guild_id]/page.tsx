'use client';

import { useState, useEffect } from 'react';

const ROLE_SETTINGS = [
  { key: 'NEW_MEMBER_ROLE_ID', label: '仮（新規）メンバーロール', multiple: false },
  { key: 'DOWNGRADE_ROLE_ID', label: '評価落ちロール', multiple: false },
  { key: 'PENDING_MEMBER_ROLE_ID', label: '入界待機者ロール', multiple: false },
  { key: 'EMBLEM_MANAGER_ROLE_ID', label: 'スタンプ統括ロール', multiple: false },
  { key: 'EMBLEM_MASTER_ROLE_ID', label: 'スタンプ制作ロール', multiple: false },
  { key: 'CONFESSION_PRIEST_ROLE_ID', label: '告解司祭ロール', multiple: false },
  { key: 'PRIEST_ROLE_ID', label: '司祭ロール', multiple: false },
  { key: 'ADMIN_ROLE_IDS', label: '運営管理者ロール', multiple: true },
  { key: 'INTERVIEWER_ROLE_IDS', label: '面接官ロール', multiple: true },
  { key: 'EVALUATOR_ROLE_IDS', label: '初級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER2_ROLE_IDS', label: '中級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER3_ROLE_IDS', label: '上級評価員ロール', multiple: true },
  { key: 'FREE_INN_ROLE_IDS', label: '無料宿ロール', multiple: true },
  { key: 'MAIN_SUB_MEMBER_ROLE_IDS', label: '本・準メンバーロール', multiple: true },
  { key: 'EVENT_MANAGER_ROLE_IDS', label: 'イベンター統括ロール', multiple: true },
  { key: 'GAMBLE_EMPLOYEE_ROLE_IDS', label: '賭博従業員ロール', multiple: true },
  { key: 'GAMBLE_MANAGER_ROLE_IDS', label: '賭博統括ロール', multiple: true },
  { key: 'MINUS_TARGET_ROLE_IDS', label: '通貨マイナス落ち対象ロール', multiple: true },
  { key: 'BANKER_ROLE_IDS', label: '銀行員ロール', multiple: true },
  { key: 'GAMBLE_VIOLATOR_ROLE_ID', label: '違反者ロール', multiple: false },
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
    
    // DBに保存する前に、数値を適切な型（number / number[]）に戻す
    const payload: Record<string, any> = {};
    for (const setting of ROLE_SETTINGS) {
      const val = settings[setting.key];
      if (!val) continue;
      
      if (setting.multiple) {
        if (Array.isArray(val) && val.length > 0) {
          payload[setting.key] = val.map(Number);
        }
      } else {
        payload[setting.key] = Number(val);
      }
    }
    
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        alert('設定を保存しました！');
      } else {
        alert('エラーが発生しました: ' + data.error);
      }
    } catch (e) {
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <h1 className="text-3xl font-bold mb-8 text-white">基本・評価設定</h1>
      
      <div className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700 mb-8">
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
              <select 
                multiple={setting.multiple}
                className={`bg-zinc-900 border border-zinc-700 rounded p-2 focus:border-red-500 outline-none text-white ${setting.multiple ? 'h-24' : ''}`}
                value={settings[setting.key] || (setting.multiple ? [] : '')}
                onChange={(e) => {
                  if (setting.multiple) {
                    const values = Array.from(e.target.selectedOptions, option => option.value);
                    handleChange(setting.key, values, true);
                  } else {
                    handleChange(setting.key, e.target.value, false);
                  }
                }}
              >
                {!setting.multiple && <option value="">未設定</option>}
                {loading ? (
                  <option disabled>読み込み中...</option>
                ) : (
                  roles.map(r => (
                    <option key={r.id} value={r.id} style={{ color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'white' }}>
                      @ {r.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          ))}
        </div>
        
        <div className="mt-8 border-t border-zinc-700 pt-4">
          <button 
            onClick={handleSave}
            className="bg-red-600 hover:bg-red-700 text-white transition-colors px-8 py-3 rounded-lg font-bold disabled:opacity-50 w-full md:w-auto flex items-center justify-center gap-2" 
            disabled={loading || saving}
          >
            {saving ? '保存中...' : '設定を保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}
