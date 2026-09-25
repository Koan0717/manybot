'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, MonitorSmartphone, Save } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import type { RoleOption } from '@/components/RoleSelect';

// lib/casino/settings.ts の WEB_GAMES と同じ並び・同じキー
const GAMES = [
  { key: 'coinflip', label: '🪙 コイントス', desc: '表か裏かを当てる' },
  { key: 'slot', label: '🎰 スロット', desc: '絵柄をそろえる' },
  { key: 'roulette', label: '🎡 ルーレット', desc: '赤黒・偶奇・ダズン・数字に賭ける' },
  { key: 'blackjack', label: '🃏 ブラックジャック', desc: 'カードを引いてディーラーと勝負' },
  { key: 'chinchiro', label: '🎲 チンチロリン', desc: 'サイコロの役でBotと勝負' },
  { key: 'horse', label: '🏇 競馬', desc: '単勝・複勝で馬券を買う' },
] as const;
type GameKey = (typeof GAMES)[number]['key'];
type Enabled = Record<GameKey, boolean>;

const allOff = (): Enabled => Object.fromEntries(GAMES.map((g) => [g.key, false])) as Enabled;

// lib/webAccess.ts の WEB_ROLE_ACCESS と同じ形。未設定は「使える」
type RoleAccess = Record<'downgrade' | 'violator', Record<'casino' | 'shop' | 'gacha', boolean>>;
const allAllowed = (): RoleAccess => ({
  downgrade: { casino: true, shop: true, gacha: true },
  violator: { casino: true, shop: true, gacha: true },
});
const ROLE_GROUPS = [
  { key: 'downgrade', label: '評価落ち', desc: '「基本・評価設定」の評価落ちロールを持つメンバー' },
  { key: 'violator', label: '違反者', desc: '「基本・評価設定」の違反者ロールを持つメンバー' },
] as const;
// lib/memberRoles.ts の ROLE_SETTING_KEYS と同じ
const BASE_ROLE_SETTINGS = [
  { key: 'MAIN_MEMBER_ROLE_IDS', label: '本メンバーロール', use: '昇格のお祝い（黄色の枠）' },
  { key: 'SUB_MEMBER_ROLE_IDS', label: '準メンバーロール', use: '昇格のお祝い（黄色の枠）' },
  { key: 'DOWNGRADE_ROLE_ID', label: '評価落ちロール', use: '励まし（赤の枠）・利用制限' },
  { key: 'GAMBLE_VIOLATOR_ROLE_IDS', label: '違反者ロール', use: '反省のメッセージ（赤の枠）・利用制限' },
] as const;

const FEATURES = [
  { key: 'casino', label: '🎰 ギャンブル（カジノ）' },
  { key: 'shop', label: '🛒 ショップ' },
  { key: 'gacha', label: '🎁 ガチャ' },
] as const;

export default function WebActivitySettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const [enabled, setEnabled] = useState<Enabled>(allOff);
  const [shopEnabled, setShopEnabled] = useState(false);
  const [gachaEnabled, setGachaEnabled] = useState(false);
  const [roleAccess, setRoleAccess] = useState<RoleAccess>(allAllowed);
  // 「基本・評価設定」のロール（役職タブ・利用制限の判定に使う。ここでは表示だけ）
  const [baseRoles, setBaseRoles] = useState<Record<string, string[]>>({});
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/roles`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRoles(Array.isArray(data) ? data.filter((r: any) => r.id !== guildId) : []))
      .catch(() => setRoles([]));
    fetch(`/api/guilds/${guildId}/settings`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: any) => {
        const saved = data?.WEB_GAMES_ENABLED && typeof data.WEB_GAMES_ENABLED === 'object' ? data.WEB_GAMES_ENABLED : {};
        setEnabled(Object.fromEntries(GAMES.map((g) => [g.key, saved[g.key] === true])) as Enabled);
        setShopEnabled(data?.WEB_SHOP_ENABLED === true);
        setGachaEnabled(data?.WEB_GACHA_ENABLED === true);
        const toIds = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
        setBaseRoles(Object.fromEntries(BASE_ROLE_SETTINGS.map((b) => [b.key, toIds(data?.[b.key])])));
        const ra = data?.WEB_ROLE_ACCESS && typeof data.WEB_ROLE_ACCESS === 'object' ? data.WEB_ROLE_ACCESS : {};
        setRoleAccess({
          downgrade: { casino: ra.downgrade?.casino !== false, shop: ra.downgrade?.shop !== false, gacha: ra.downgrade?.gacha !== false },
          violator: { casino: ra.violator?.casino !== false, shop: ra.violator?.shop !== false, gacha: ra.violator?.gacha !== false },
        });
      })
      .catch(() => setError('設定の取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ WEB_GAMES_ENABLED: enabled, WEB_SHOP_ENABLED: shopEnabled, WEB_GACHA_ENABLED: gachaEnabled, WEB_ROLE_ACCESS: roleAccess,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        const msg = data.error || '保存に失敗しました';
        setError(`設定の保存に失敗しました: ${msg}`);
        toast.error(`保存に失敗しました: ${msg}`);
        return;
      }
      toast.success('設定を保存しました！');
    } catch (err: any) {
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-purple-400">Loading...</div>;
  }

  const onCount = GAMES.filter((g) => enabled[g.key]).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500 flex items-center gap-3">
            <MonitorSmartphone className="text-cyan-400" size={30} />
            Webアクティビティ設定
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            Discordアクティビティ・Webのメンバー画面で使える機能と表示を設定します。
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50 flex-shrink-0"
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-2"
      >
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-4 mb-2">
          <h2 className="text-xl font-semibold text-cyan-300">遊べるギャンブル</h2>
          <span className="text-sm text-gray-400">{onCount} / {GAMES.length} 個がON</span>
        </div>

        {GAMES.map((g) => (
          <div key={g.key} className="flex items-center justify-between gap-4 py-3 border-b border-gray-700/60 last:border-0">
            <div>
              <div className="font-medium text-white">{g.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.desc}</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={enabled[g.key]}
                onChange={(e) => setEnabled((prev) => ({ ...prev, [g.key]: e.target.checked }))}
              />
              <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-cyan-300">🛒 ショップ</h2>
            <p className="text-xs text-gray-500 mt-1">
              ONにすると、メンバー画面の「ショップ」タブから商品を購入できます。商品・価格・用途・対象ロール・効果は
              <Link href={`/dashboard/${guildId}/shop`} className="text-cyan-400 hover:underline mx-1">ショップ設定</Link>
              の内容がそのまま使われます。購入ログは「ショップアイテムの購入・使用」のチャンネルに送られます。
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={shopEnabled}
                onChange={(e) => setShopEnabled(e.target.checked)}
              />
              <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-cyan-300">🎁 ガチャ（福引）</h2>
            <p className="text-xs text-gray-500 mt-1">
              ONにすると、メンバー画面の「ガチャ」タブでガチャマシンを回して福引を引けます。景品・当たりやすさ・消費額・対象ロールは
              <Link href={`/dashboard/${guildId}/gacha`} className="text-cyan-400 hover:underline mx-1">福引ガチャ設定</Link>
              の内容がそのまま使われます（Discordのパネルと共通）。結果のログは「福引ガチャ」のログチャンネルに送られます。
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={gachaEnabled}
              onChange={(e) => setGachaEnabled(e.target.checked)}
            />
            <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
          </label>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-4"
      >
        <div className="border-b border-cyan-500/20 pb-4">
          <h2 className="text-xl font-semibold text-cyan-300">評価落ち・違反者の利用</h2>
          <p className="text-xs text-gray-500 mt-1">
            OFFにすると、そのメンバーの画面ではそのタブ（カジノ・ショップ・ガチャ）が表示されず、使うこともできません。
            評価落ちと違反者の両方に当てはまるメンバーは、どちらか一方でもOFFなら使えません。
          </p>
        </div>
        {ROLE_GROUPS.map((group) => (
          <div key={group.key} className="space-y-2">
            <div>
              <div className="font-medium text-white">{group.label}</div>
              <div className="text-xs text-gray-500">{group.desc}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {FEATURES.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 bg-gray-900/60 border border-gray-700/60 rounded-lg px-4 py-3">
                  <span className="text-sm text-gray-200">{f.label}</span>
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={roleAccess[group.key][f.key]}
                      onChange={(e) =>
                        setRoleAccess((prev) => ({ ...prev, [group.key]: { ...prev[group.key], [f.key]: e.target.checked } }))
                      }
                    />
                    <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-4"
      >
        <div className="border-b border-cyan-500/20 pb-4">
          <h2 className="text-xl font-semibold text-cyan-300">判定に使うロール</h2>
          <p className="text-xs text-gray-500 mt-1">
            メンバー画面の「役職」タブの表示と、上の評価落ち・違反者の利用制限は、
            <Link href={`/dashboard/${guildId}`} className="text-cyan-400 hover:underline mx-1">基本・評価設定</Link>
            で設定したロールで判定します。未設定のものは、当てはまるメンバーがいない扱いになります。
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {BASE_ROLE_SETTINGS.map((b) => {
            const ids = baseRoles[b.key] ?? [];
            const names = ids.map((id) => roles.find((r) => r.id === id)?.name ?? `不明なロール (${id})`);
            return (
              <div key={b.key} className="bg-gray-900/60 border border-gray-700/60 rounded-lg px-4 py-3">
                <div className="text-sm text-gray-200 font-medium">{b.label}</div>
                <div className={`text-sm mt-0.5 ${names.length ? 'text-cyan-300' : 'text-red-400 font-semibold'}`}>
                  {names.length ? names.join('、') : '未設定'}
                </div>
                <div className="text-[11px] text-gray-500 mt-1">{b.use}</div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <div className="text-sm text-gray-400 bg-gray-800/30 border border-gray-700/60 rounded-xl p-4 leading-relaxed">
        ギャンブルの確率・配当倍率・賭け金の上限・1日のプレイ回数・手数料は、Discordのパネルと同じく
        <Link href={`/dashboard/${guildId}/gambling`} className="text-cyan-400 hover:underline mx-1">ギャンブル設定</Link>
        の値を使います。1日の回数と賭け金の上限は、パネルで遊んだ分と合算されます。
        結果は「ログ出力設定」の「賭博・カジノ機能の利用」のチャンネルに送られます。
      </div>
    </div>
  );
}
