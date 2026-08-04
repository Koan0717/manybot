'use client';
import { useState, useEffect } from 'react';
import { Save, Loader2, Shield, Lock, Unlock, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/components/PageHeader';

const ROOM_TYPES = [
  {
    key: 'inn',
    label: '一般宿',
    description: '通常の宿泊VCチャンネル',
    icon: '🏠',
  },
  {
    key: 'luxury_inn',
    label: '高級宿',
    description: 'プレミアムな宿泊VCチャンネル',
    icon: '🏰',
  },
  {
    key: 'gambling_vc',
    label: '賭博VC',
    description: 'ギャンブル・賭博専用VCチャンネル',
    icon: '🎲',
  },
  {
    key: 'game_vc',
    label: 'ゲームVC',
    description: 'ゲームプレイ用VCチャンネル',
    icon: '🎮',
  },
  {
    key: 'custom_vc',
    label: 'カスタムVC',
    description: 'ユーザーが自由に作成できるVCチャンネル',
    icon: '✨',
  },
];

export default function RoomAccessPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, boolean>>({
    inn: true,
    luxury_inn: true,
    gambling_vc: true,
    game_vc: true,
    custom_vc: true,
  });
  const [violatorSettings, setViolatorSettings] = useState<Record<string, boolean>>({
    inn: true,
    luxury_inn: true,
    gambling_vc: true,
    game_vc: true,
    custom_vc: true,
  });

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/room-access`)
      .then(r => r.json())
      .then(data => {
        if (!data.error) {
          if (data.lowEval) setSettings(prev => ({ ...prev, ...data.lowEval }));
          if (data.violator) setViolatorSettings(prev => ({ ...prev, ...data.violator }));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [guildId]);

  const toggle = (key: string) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleViolator = (key: string) => {
    setViolatorSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/room-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lowEval: settings, violator: violatorSettings }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('設定を保存しました');
    } catch (e: any) {
      toast.error(`保存に失敗しました: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="animate-spin text-zinc-500" size={32} />
      </div>
    );
  }

  const allAllowed = Object.values(settings).every(v => v === true);
  const allDenied = Object.values(settings).every(v => v === false);
  const violatorAllAllowed = Object.values(violatorSettings).every(v => v === true);
  const violatorAllDenied = Object.values(violatorSettings).every(v => v === false);

  const renderSection = (
    sectionSettings: Record<string, boolean>,
    onToggle: (key: string) => void,
    onSetAll: (val: boolean) => void,
    sectionAllAllowed: boolean,
    sectionAllDenied: boolean,
    deniedMessage: string
  ) => (
    <>
      {/* Quick Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => onSetAll(true)}
          className={`text-sm px-4 py-2 rounded-lg border transition-colors ${sectionAllAllowed ? 'bg-green-600/20 border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'}`}
        >
          ✅ 全てON（全部許可）
        </button>
        <button
          onClick={() => onSetAll(false)}
          className={`text-sm px-4 py-2 rounded-lg border transition-colors ${sectionAllDenied ? 'bg-red-600/20 border-red-600 text-red-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'}`}
        >
          🚫 全てOFF（全部制限）
        </button>
      </div>

      {/* Settings Cards */}
      <div className="space-y-3">
        {ROOM_TYPES.map(rt => {
          const isAllowed = sectionSettings[rt.key] !== false;
          return (
            <div
              key={rt.key}
              className={`bg-zinc-900 border rounded-xl p-5 transition-all ${isAllowed ? 'border-zinc-800' : 'border-red-900/60 bg-red-950/10'}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{rt.icon}</span>
                  <div>
                    <div className="font-semibold text-white flex items-center gap-2">
                      {rt.label}
                      {isAllowed ? (
                        <span className="text-xs text-green-400 bg-green-400/10 border border-green-400/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Unlock size={10} /> 許可
                        </span>
                      ) : (
                        <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Lock size={10} /> 制限中
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-400 mt-0.5">{rt.description}</div>
                  </div>
                </div>

                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={isAllowed}
                    onChange={() => onToggle(rt.key)}
                  />
                  <div className="w-12 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:bg-green-600 peer-not-checked:bg-red-800/70"></div>
                </label>
              </div>

              {!isAllowed && (
                <div className="mt-3 pt-3 border-t border-red-900/40 text-xs text-red-300/70 flex items-center gap-1.5">
                  <Lock size={11} />
                  {deniedMessage}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <PageHeader icon={Shield} title="評価落ちVCアクセス制御" />
      <p className="text-zinc-400 text-sm -mt-6">
        「評価落ちロール」「違反者ロール」が付与されているメンバーが、各VCチャンネルを利用できるかどうかを設定します。
        <br />
        ONにするとそのロールを持っていても利用できます。OFFにするとボタンを押しても弾かれます。
      </p>

      {/* Info Banner */}
      <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-200">
          <p className="font-semibold mb-1">評価落ちロール・違反者ロールについて</p>
          <p className="text-amber-200/70">
            「基本・評価設定」ページの <code className="bg-amber-900/50 px-1 rounded">評価落ちロール</code> / <code className="bg-amber-900/50 px-1 rounded">違反者ロール</code> に設定されたロールが判定に使用されます。
            ロールが未設定の場合、そのOFF設定は機能しません。
          </p>
        </div>
      </div>

      {/* 評価落ちセクション */}
      <div className="pt-2">
        <h2 className="text-white font-semibold text-lg mb-3">評価落ち</h2>
        {renderSection(
          settings,
          toggle,
          (val) => setSettings({ inn: val, luxury_inn: val, gambling_vc: val, game_vc: val, custom_vc: val }),
          allAllowed,
          allDenied,
          '評価落ちロールを持つメンバーはこのVCを利用できません'
        )}
      </div>

      {/* 違反者セクション */}
      <div className="pt-6 border-t border-zinc-800">
        <h2 className="text-white font-semibold text-lg mb-3">違反者</h2>
        {renderSection(
          violatorSettings,
          toggleViolator,
          (val) => setViolatorSettings({ inn: val, luxury_inn: val, gambling_vc: val, game_vc: val, custom_vc: val }),
          violatorAllAllowed,
          violatorAllDenied,
          '違反者ロールを持つメンバーはこのVCを利用できません'
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          設定を保存する
        </button>
      </div>
    </div>
  );
}
