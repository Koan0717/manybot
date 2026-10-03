'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  Pickaxe,
  Server,
  Puzzle,
  ScrollText,
  Coins,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Save,
  Send,
  Plus,
  Trash2,
  RefreshCw,
  Users,
  Info,
  Hash,
  LogIn,
  LogOut,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import ChannelSelect from '@/components/ChannelSelect';

interface SellPrice {
  item: string;
  price: number;
}

interface McData {
  configured: boolean;
  has_api_key: boolean;
  settings: {
    is_enabled: boolean;
    join_leave_channel_id: string;
    trade_log_channel_id: string;
    allow_pay: boolean;
    allow_sell: boolean;
    sell_prices: SellPrice[];
    api_key_hint: string | null;
  } | null;
  status: {
    online: boolean;
    server_name: string | null;
    addon_version: string | null;
    addon_info: Record<string, any>;
    online_players: string[];
    max_players: number | null;
    last_heartbeat_at: string | null;
    last_event_at: string | null;
  } | null;
  latest_addon_version: string;
  currency_name: string;
  links: { user_id: string; mc_name: string; linked_at: string; display_name: string | null }[];
  events: { id: string; kind: string; mc_name: string; created_at: string }[];
  transactions: {
    id: string;
    user_id: string;
    mc_name: string;
    kind: string;
    amount: string;
    detail: string | null;
    balance_after: string | null;
    created_at: string;
  }[];
}

const KIND_LABEL: Record<string, string> = {
  sell: 'アイテム売却',
  pay_out: '送金（送った）',
  pay_in: '送金（受け取った）',
  adjust: 'アドオンからの増減',
};

type Level = 'ok' | 'warn' | 'error' | 'off';

const LEVEL_STYLE: Record<Level, { text: string; border: string; Icon: typeof CheckCircle2 }> = {
  ok: { text: 'text-green-400', border: 'border-green-900/50', Icon: CheckCircle2 },
  warn: { text: 'text-amber-400', border: 'border-amber-900/50', Icon: AlertTriangle },
  error: { text: 'text-red-400', border: 'border-red-900/50', Icon: XCircle },
  off: { text: 'text-zinc-500', border: 'border-zinc-800', Icon: XCircle },
};

function StatusCard({ icon: Icon, title, level, value, detail }: { icon: typeof Server; title: string; level: Level; value: string; detail?: string }) {
  const s = LEVEL_STYLE[level];
  return (
    <div className={`mecha-clip-sm bg-black/40 border ${s.border} p-4`}>
      <div className="flex items-center gap-2 font-tech text-xs text-zinc-500 mb-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <div className={`text-sm font-semibold flex items-center gap-1.5 ${s.text}`}>
        <s.Icon className="w-4 h-4 flex-shrink-0" /> {value}
      </div>
      {detail && <div className="font-tech text-[11px] text-zinc-500 mt-1 break-words">{detail}</div>}
    </div>
  );
}

function ago(iso: string | null): string {
  if (!iso) return 'なし';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  return new Date(iso).toLocaleString('ja-JP');
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="w-12 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-6 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
    </label>
  );
}

export default function MinecraftSettingsPage({ params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  const [data, setData] = useState<McData | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  const [form, setForm] = useState({
    is_enabled: true,
    join_leave_channel_id: '',
    trade_log_channel_id: '',
    allow_pay: true,
    allow_sell: true,
    sell_prices: [] as { item: string; price: string }[],
  });

  const load = useCallback(
    async (initial = false) => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/minecraft`, { cache: 'no-store' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        setData(d);
        if (initial && d.settings) {
          setForm({
            is_enabled: d.settings.is_enabled,
            join_leave_channel_id: d.settings.join_leave_channel_id || '',
            trade_log_channel_id: d.settings.trade_log_channel_id || '',
            allow_pay: d.settings.allow_pay,
            allow_sell: d.settings.allow_sell,
            sell_prices: (d.settings.sell_prices || []).map((p: SellPrice) => ({ item: p.item, price: String(p.price) })),
          });
        }
      } catch (e: any) {
        if (initial) toast.error(`読み込みに失敗しました: ${e.message}`);
      }
    },
    [guildId]
  );

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([
      fetch(`/api/guilds/${guildId}/channels`)
        .then((r) => (r.ok ? r.json() : []))
        .then((c) => Array.isArray(c) && setChannels(c.filter((x: any) => x.type === 0 || x.type === 5))),
      load(true),
    ]).finally(() => setLoading(false));
    // 接続状況は30秒ごとに取り直す
    const t = setInterval(() => load(false), 30_000);
    return () => clearInterval(t);
  }, [guildId, load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/guilds/${guildId}/minecraft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await post({
        action: 'save',
        ...form,
        sell_prices: form.sell_prices
          .filter((p) => p.item.trim())
          .map((p) => ({ item: p.item.trim(), price: Number(p.price) })),
      });
      toast.success('マイクラ連携の設定を保存しました（アドオンには次のハートビートで反映されます）');
      await load(true);
    } catch (e: any) {
      toast.error(`保存に失敗しました: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (data?.has_api_key && !confirm('APIキーを再発行しますか？\n今のキーは使えなくなるので、BDSの secrets.json も書き換える必要があります。')) return;
    try {
      const d = await post({ action: 'regenerate_key' });
      setIssuedKey(d.api_key);
      toast.success('APIキーを発行しました。この画面を閉じると二度と表示されません。');
      await load(false);
    } catch (e: any) {
      toast.error(`発行に失敗しました: ${e.message}`);
    }
  };

  const handleTestLog = async (channelId: string) => {
    if (!channelId) return toast.error('チャンネルを選択してください');
    try {
      await post({ action: 'test_log', channel_id: channelId });
      toast.success('テストメッセージを送信しました');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUnlink = async (userId: string, mcName: string) => {
    if (!confirm(`${mcName} の連携を解除しますか？`)) return;
    try {
      await post({ action: 'unlink', user_id: userId });
      toast.success('連携を解除しました');
      await load(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('コピーしました'),
      () => toast.error('コピーできませんでした')
    );
  };

  if (loading) return <div className="text-zinc-400 p-8">読み込み中...</div>;

  const st = data?.status;
  const online = !!st?.online;
  const addonOutdated = !!st?.addon_version && st.addon_version !== data?.latest_addon_version;
  const info = st?.addon_info ?? {};

  const serverCard: { level: Level; value: string; detail: string } = !data?.has_api_key
    ? { level: 'off', value: '未設定', detail: 'APIキーを発行してBDSに設定してください' }
    : !st?.last_heartbeat_at
      ? { level: 'warn', value: '未接続', detail: 'まだアドオンから通信がありません' }
      : online
        ? { level: 'ok', value: '接続中', detail: `${st.server_name || 'Minecraft'} ・ 最終通信 ${ago(st.last_heartbeat_at)}` }
        : { level: 'error', value: 'オフライン', detail: `最終通信 ${ago(st.last_heartbeat_at)}` };

  const addonCard: { level: Level; value: string; detail: string } = !st?.addon_version
    ? { level: 'off', value: '未検出', detail: `最新版 v${data?.latest_addon_version}` }
    : addonOutdated
      ? { level: 'warn', value: `v${st.addon_version}（更新あり）`, detail: `最新版 v${data?.latest_addon_version}` }
      : {
          level: online ? 'ok' : 'warn',
          value: `v${st.addon_version}（最新）`,
          detail: [
            info.server_net !== undefined && `server-net: ${info.server_net ? 'OK' : 'NG'}`,
            info.server_admin !== undefined && `secrets: ${info.server_admin ? 'OK' : '未使用'}`,
            info.script_api && `@minecraft/server ${info.script_api}`,
          ]
            .filter(Boolean)
            .join(' ・ '),
        };

  const logCard: { level: Level; value: string; detail: string } = data?.settings?.join_leave_channel_id
    ? {
        level: 'ok',
        value: '送信先 設定済み',
        detail: `#${channels.find((c) => c.id === data.settings!.join_leave_channel_id)?.name ?? data.settings.join_leave_channel_id}・最終イベント ${ago(st?.last_event_at ?? null)}`,
      }
    : { level: 'off', value: '未設定', detail: '下の設定で入退出ログのチャンネルを選んでください' };

  const currencyCard: { level: Level; value: string; detail: string } =
    data?.settings?.is_enabled === false
      ? { level: 'off', value: '連携OFF', detail: '' }
      : {
          level: (data?.links.length ?? 0) > 0 ? 'ok' : 'warn',
          value: `${data?.currency_name ?? 'コイン'} を共有中`,
          detail: `連携済みプレイヤー ${data?.links.length ?? 0}人`,
        };

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          icon={Pickaxe}
          title="マイクラ連携"
          subtitle="統合版サーバー（BDS）とアドオンの接続状況、入退出ログ、マイクラ内通貨（＝鯖内通貨）を設定します"
          eyebrow="System // Minecraft Bridge"
          tone="cyan"
        />
        <button
          onClick={async () => {
            setRefreshing(true);
            await load(false);
            setRefreshing(false);
          }}
          className="font-tech text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> 状況を更新
        </button>
      </div>

      {/* 接続状況 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard icon={Server} title="サーバー連携" {...serverCard} />
        <StatusCard icon={Puzzle} title="アドオン" {...addonCard} />
        <StatusCard icon={ScrollText} title="入退出ログ" {...logCard} />
        <StatusCard icon={Coins} title="通貨連携" {...currencyCard} />
      </div>

      {/* オンラインのプレイヤー */}
      <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-200 mb-3">
          <Users className="w-4 h-4 text-cyan-400" />
          オンラインのプレイヤー
          <span className="font-tech text-xs text-zinc-500 font-normal">
            {online ? `${st?.online_players.length ?? 0}${st?.max_players ? ` / ${st.max_players}` : ''}人` : 'サーバーがオフラインです'}
          </span>
        </div>
        {online && st && st.online_players.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {st.online_players.map((p) => {
              const linked = data?.links.find((l) => l.mc_name.toLowerCase() === p.toLowerCase());
              return (
                <span key={p} className="font-tech text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
                  {p}
                  {linked && <span className="text-cyan-400 ml-1">（{linked.display_name ?? linked.user_id}）</span>}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="font-tech text-xs text-zinc-500">{online ? '誰もいません' : '—'}</div>
        )}
      </div>

      {/* APIキー・セットアップ */}
      <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <KeyRound className="w-4 h-4 text-amber-400" /> APIキーとアドオンの導入
          </div>
          <button
            onClick={handleRegenerate}
            className="font-mecha text-xs font-bold bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white px-4 py-2 rounded-lg border border-amber-500/30"
          >
            {data?.has_api_key ? 'APIキーを再発行' : 'APIキーを発行'}
          </button>
        </div>
        {data?.has_api_key && !issuedKey && (
          <div className="font-tech text-xs text-zinc-500">発行済み（末尾 …{data.settings?.api_key_hint}）。キーは発行時にしか表示されません。</div>
        )}
        {issuedKey && (
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-3">
            <div className="font-tech text-[11px] text-amber-300 mb-1">新しいAPIキー（この画面を離れると二度と表示されません）</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-xs text-white break-all flex-1">{issuedKey}</code>
              <button onClick={() => copy(issuedKey)} className="text-zinc-400 hover:text-white" title="コピー">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-400 space-y-2 leading-relaxed">
          <p className="font-bold text-zinc-200 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-cyan-400" /> 導入手順（統合版 Bedrock Dedicated Server）
          </p>
          <p>1. リポジトリの <code className="text-cyan-300">minecraft-addon/ManyBotBridge</code> を BDS の <code>behavior_packs/</code> に入れ、ワールドに適用します（ベータAPIをON）。</p>
          <p>2. <code>config/default/permissions.json</code> の allowed_modules に <code>@minecraft/server-net</code> と <code>@minecraft/server-admin</code> を追加します。</p>
          <p>3. <code>config/default/variables.json</code> と <code>config/default/secrets.json</code> を次の内容で作成し、サーバーを再起動します。</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { name: 'variables.json', body: JSON.stringify({ manybot_url: origin, manybot_server_name: 'My Server' }, null, 2) },
              { name: 'secrets.json', body: JSON.stringify({ manybot_api_key: issuedKey ?? '<発行したAPIキー>' }, null, 2) },
            ].map((f) => (
              <div key={f.name} className="relative">
                <div className="font-tech text-[10px] text-zinc-500 mb-1">{f.name}</div>
                <pre className="bg-black/60 border border-zinc-800 rounded p-2 font-mono text-[11px] text-zinc-200 overflow-x-auto">{f.body}</pre>
                <button onClick={() => copy(f.body)} className="absolute top-6 right-2 text-zinc-500 hover:text-white" title="コピー">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p>4. ゲーム内で <code className="text-cyan-300">/manybot:link</code> を実行すると6桁のコードが出ます。Webのメンバー画面（プロフィール → マイクラ連携）に入力するとDiscordアカウントと紐付きます。</p>
          <p>
            連携すると、マイクラ内の残高はこのサーバーの通貨（{data?.currency_name ?? 'コイン'}）と同じものになり、Discordの /pay・Webアクティビティのカジノやショップでもそのまま使えます。
            ゲーム内コマンド: <code>/manybot:balance</code>・<code>/manybot:pay</code>・<code>/manybot:sell</code>
          </p>
        </div>
      </div>

      {/* 設定 */}
      <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-zinc-200">マイクラ連携を有効にする</div>
            <div className="font-tech text-xs text-zinc-500">OFFにするとアドオンからのリクエストをすべて拒否します</div>
          </div>
          <Toggle checked={form.is_enabled} onChange={(v) => setForm({ ...form, is_enabled: v })} />
        </div>

        <div>
          <label className="block text-sm font-bold text-zinc-200 mb-2 flex items-center gap-2">
            <Hash className="w-4 h-4 text-cyan-400" /> ワールド参加・退出ログの送信チャンネル
          </label>
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <ChannelSelect
                label="入退出ログチャンネル"
                placeholder="チャンネルを選択（未選択なら送信しない）"
                value={form.join_leave_channel_id}
                onChange={(id) => setForm({ ...form, join_leave_channel_id: id })}
                channels={channels}
              />
            </div>
            <button
              onClick={() => handleTestLog(form.join_leave_channel_id)}
              className="font-tech text-xs text-zinc-300 hover:text-white flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" /> テスト送信
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-zinc-200 mb-2 flex items-center gap-2">
            <Hash className="w-4 h-4 text-cyan-400" /> マイクラ内取引ログの送信チャンネル
            <span className="text-xs text-zinc-500 font-normal">（任意・送金や売却の記録）</span>
          </label>
          <ChannelSelect
            label="取引ログチャンネル"
            placeholder="チャンネルを選択（未選択なら送信しない）"
            value={form.trade_log_channel_id}
            onChange={(id) => setForm({ ...form, trade_log_channel_id: id })}
            channels={channels}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-4 bg-black/30 border border-zinc-800 rounded-lg p-3">
            <div>
              <div className="text-sm text-zinc-200">ゲーム内送金（/manybot:pay）</div>
              <div className="font-tech text-[11px] text-zinc-500">連携済みプレイヤー同士で鯖内通貨を送れます</div>
            </div>
            <Toggle checked={form.allow_pay} onChange={(v) => setForm({ ...form, allow_pay: v })} />
          </div>
          <div className="flex items-center justify-between gap-4 bg-black/30 border border-zinc-800 rounded-lg p-3">
            <div>
              <div className="text-sm text-zinc-200">アイテム売却（/manybot:sell）</div>
              <div className="font-tech text-[11px] text-zinc-500">手に持ったアイテムを下の価格で通貨に換えます</div>
            </div>
            <Toggle checked={form.allow_sell} onChange={(v) => setForm({ ...form, allow_sell: v })} />
          </div>
        </div>

        <div>
          <div className="text-sm font-bold text-zinc-200 mb-2">売却価格（1個あたり・{data?.currency_name ?? 'コイン'}）</div>
          <div className="space-y-2">
            {form.sell_prices.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={p.item}
                  onChange={(e) => {
                    const next = [...form.sell_prices];
                    next[i] = { ...p, item: e.target.value };
                    setForm({ ...form, sell_prices: next });
                  }}
                  placeholder="minecraft:diamond"
                  className="flex-1 min-w-0 bg-black/60 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <input
                  value={p.price}
                  onChange={(e) => {
                    const next = [...form.sell_prices];
                    next[i] = { ...p, price: e.target.value.replace(/[^\d]/g, '') };
                    setForm({ ...form, sell_prices: next });
                  }}
                  inputMode="numeric"
                  placeholder="価格"
                  className="w-28 bg-black/60 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => setForm({ ...form, sell_prices: form.sell_prices.filter((_, j) => j !== i) })}
                  className="text-zinc-500 hover:text-red-400 px-2"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setForm({ ...form, sell_prices: [...form.sell_prices, { item: '', price: '' }] })}
              className="font-tech text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> アイテムを追加
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="mecha-btn-sheen font-mecha bg-gradient-to-r from-cyan-700 to-cyan-900 hover:from-cyan-600 hover:to-cyan-800 disabled:opacity-50 text-white border border-cyan-600/40 px-6 py-3 rounded-lg font-bold flex items-center gap-2 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? '保存中...' : '設定を保存する'}
          </button>
        </div>
      </div>

      {/* 連携済みプレイヤー */}
      <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6">
        <div className="text-sm font-bold text-zinc-200 mb-3">連携済みプレイヤー（{data?.links.length ?? 0}人）</div>
        {data && data.links.length > 0 ? (
          <div className="divide-y divide-zinc-800">
            {data.links.map((l) => (
              <div key={l.user_id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{l.mc_name}</div>
                  <div className="font-tech text-[11px] text-zinc-500 truncate">
                    {l.display_name ?? 'Discord'}（{l.user_id}）・{new Date(l.linked_at).toLocaleDateString('ja-JP')} 連携
                  </div>
                </div>
                <button onClick={() => handleUnlink(l.user_id, l.mc_name)} className="text-zinc-500 hover:text-red-400" title="連携解除">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="font-tech text-xs text-zinc-500">まだいません。ゲーム内で /manybot:link を実行してもらってください。</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6">
          <div className="text-sm font-bold text-zinc-200 mb-3">直近の参加・退出</div>
          {data && data.events.length > 0 ? (
            <div className="space-y-1.5">
              {data.events.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  {e.kind === 'join' ? <LogIn className="w-3.5 h-3.5 text-green-400" /> : <LogOut className="w-3.5 h-3.5 text-red-400" />}
                  <span className="text-zinc-200 truncate flex-1">{e.mc_name}</span>
                  <span className="font-tech text-zinc-500">{new Date(e.created_at).toLocaleString('ja-JP')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-tech text-xs text-zinc-500">記録はまだありません</div>
          )}
        </div>
        <div className="mecha-clip bg-neutral-900/80 border border-zinc-800/80 p-6">
          <div className="text-sm font-bold text-zinc-200 mb-3">直近のマイクラ内取引</div>
          {data && data.transactions.length > 0 ? (
            <div className="space-y-1.5">
              {data.transactions.map((t) => {
                const amount = Number(t.amount);
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-200 truncate flex-1">
                      {t.mc_name}・{KIND_LABEL[t.kind] ?? t.kind}
                      {t.detail && <span className="text-zinc-500">（{t.detail}）</span>}
                    </span>
                    <span className={amount >= 0 ? 'text-green-400' : 'text-amber-400'}>
                      {amount >= 0 ? '+' : ''}
                      {amount.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="font-tech text-xs text-zinc-500">取引はまだありません</div>
          )}
        </div>
      </div>
    </div>
  );
}
