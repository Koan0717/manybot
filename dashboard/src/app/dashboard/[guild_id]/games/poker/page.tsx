'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Save, AlertCircle, Send, Club } from 'lucide-react';
import ChannelSelect from '@/components/ChannelSelect';
import PageHeader from '@/components/PageHeader';
import { toast } from 'react-hot-toast';

const P = 'POKER';
const BET_LEVELS = [4, 5, 6] as const;
const LEVEL_NAME = { 4: '難しい', 5: '最難関', 6: '超難関' } as const;

/** 数値の項目: [設定キー, 初期値, 最小, 最大] （Bot の cogs/poker.py の table_config と同じ範囲） */
const NUMBER_FIELDS: Record<string, [number, number, number]> = {
  START_CHIPS: [1000, 10, 100_000_000],
  SMALL_BLIND: [10, 1, 1_000_000],
  BIG_BLIND: [20, 2, 1_000_000],
  BLIND_UP_HANDS: [0, 0, 1000],
  TURN_SECONDS: [60, 15, 600],
  MAX_PLAYERS: [10, 2, 10],
  AI_MAX_HANDS: [30, 0, 1000],
  PVP_MAX_HANDS: [0, 0, 1000],
  PVP_MAX_BUYIN: [0, 0, 1_000_000_000_000],
};

const toInt = (raw: unknown, key: string) => {
  const [def, lo, hi] = NUMBER_FIELDS[key];
  const n = Math.floor(Number(raw));
  if (raw === '' || !Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};
const toMaxBet = (raw: unknown) => {
  const n = Math.floor(Number(raw));
  return raw === '' || !Number.isSafeInteger(n) || n < 0 ? 0 : n;
};

function Toggle({ on, onClick, labels = ['有効 (ON)', '無効 (OFF)'] }: { on: boolean; onClick: () => void; labels?: [string, string] }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 rounded-lg font-bold font-mecha text-sm transition-colors flex-shrink-0 ${
        on ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]' : 'bg-zinc-700 text-zinc-400'
      }`}
    >
      {on ? labels[0] : labels[1]}
    </button>
  );
}

/** ブラインドと「ブラインドを上げる間隔」の説明（開いたときだけ表示）。例は今の設定値で計算する */
function BlindHelp({ sb, bb, every }: { sb: number; bb: number; every: number }) {
  const n = every > 0 ? every : 5;
  const rows = [0, 1, 2, 3].map((i) => ({ hands: `${i * n + 1}〜${(i + 1) * n}`, sb: sb * 2 ** i, bb: bb * 2 ** i }));
  return (
    <details className="group bg-zinc-800/30 rounded-lg border border-zinc-700/50 text-xs font-tech text-zinc-400">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-zinc-300 hover:text-white list-none flex items-center gap-1.5">
        <span className="text-cyan-400 transition-transform group-open:rotate-90">▶</span>
        ブラインド・「ブラインドを上げる間隔」とは？
      </summary>
      <div className="px-4 pb-4 space-y-3 leading-relaxed">
        <div>
          <p className="text-zinc-300 font-medium">ブラインドとは</p>
          <p>
            ハンドごとに2人が、カードを見る前に必ず場に出すチップです。少ない方がスモールブラインド（SB）、多い方がビッグブラインド（BB）で、毎ハンド交代で回ってきます。
            何もしなくてもチップが減っていくので、ずっと降り続けることができなくなります。
          </p>
        </div>
        <div>
          <p className="text-zinc-300 font-medium">「ブラインドを上げる間隔」とは</p>
          <p>
            ここで決めたハンド数ごとに、SBとBBが2倍になります（0 なら最後まで変わりません）。
            {every > 0 ? `今の設定（${every}ハンドごと）だと次のようになります。` : `たとえば ${n} にすると次のようになります。`}
          </p>
          <table className="mt-2 w-full max-w-xs border border-zinc-700/60">
            <thead>
              <tr className="bg-zinc-800/60 text-zinc-300">
                <th className="px-2 py-1 text-left font-medium">ハンド</th>
                <th className="px-2 py-1 text-right font-medium">SB / BB</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.hands} className="border-t border-zinc-700/60">
                  <td className="px-2 py-1">{r.hands}</td>
                  <td className="px-2 py-1 text-right">{r.sb.toLocaleString()} / {r.bb.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-zinc-300 font-medium">何のための設定か</p>
          <p>
            序盤はブラインドが小さいのでじっくり遊べ、後半は大きくなって待っているだけでチップが減るため勝負せざるを得なくなります。
            ゲームが長引かずに決着しやすくなります。「みんなで遊ぶときのハンド数」を 0（無制限）にしているときに設定しておくと、ダラダラ続くのを防げます。
          </p>
        </div>
        <div>
          <p className="text-zinc-300 font-medium">チップ＝通貨のときの注意</p>
          <p>
            ブラインドは持ち込み額・参加費に関係なく、ここで設定した額です。間隔を短くすると、持ち込みが少ない人ほど早く追い込まれます
            （例: BB {bb.toLocaleString()} で持ち込み {(bb * 10).toLocaleString()} ならBB 10回分、BBが2倍になると5回分）。
          </p>
        </div>
      </div>
    </details>
  );
}

export default function PokerSettingsPage() {
  const params = useParams();
  const guildId = params.guild_id as string;

  const defaults = (data: any = {}) => ({
    [`${P}_BET_ENABLED`]: data[`${P}_BET_ENABLED`] ?? false,
    [`${P}_SHOW_STATS`]: data[`${P}_SHOW_STATS`] ?? true,
    [`${P}_PANEL_CHANNEL`]: data[`${P}_PANEL_CHANNEL`] ?? '',
    [`${P}_GAME_CHANNEL`]: data[`${P}_GAME_CHANNEL`] ?? '',
    // 入力中は文字列のまま持ち、保存時に数値へ直す
    ...Object.fromEntries(Object.entries(NUMBER_FIELDS).map(([k, [def]]) => [`${P}_${k}`, String(data[`${P}_${k}`] ?? def)])),
    ...Object.fromEntries(BET_LEVELS.map((lv) => [`${P}_AI_MAX_BET_${lv}`, String(data[`${P}_AI_MAX_BET_${lv}`] ?? 0)])),
  });
  const [settings, setSettings] = useState<Record<string, any>>(defaults());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingPanel, setSendingPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/games/poker`).then((res) => (res.ok ? res.json() : {})),
      fetch(`/api/guilds/${guildId}/channels`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([data, channelsData]: [any, any]) => {
        setSettings(defaults(data));
        if (Array.isArray(channelsData)) setChannels(channelsData);
      })
      .catch((err) => {
        console.error(err);
        setError('データの取得に失敗しました');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  const update = (key: string, value: any) => setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const bb = toInt(settings[`${P}_BIG_BLIND`], 'BIG_BLIND');
    const sb = toInt(settings[`${P}_SMALL_BLIND`], 'SMALL_BLIND');
    if (sb > bb) {
      toast.error('スモールブラインドはビッグブラインド以下にしてください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/games/poker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          ...Object.fromEntries(Object.keys(NUMBER_FIELDS).map((k) => [`${P}_${k}`, toInt(settings[`${P}_${k}`], k)])),
          ...Object.fromEntries(BET_LEVELS.map((lv) => [`${P}_AI_MAX_BET_${lv}`, toMaxBet(settings[`${P}_AI_MAX_BET_${lv}`])])),
        }),
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
      const msg = err?.message || String(err);
      setError(`設定の保存に失敗しました: ${msg}`);
      toast.error(`保存に失敗しました: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSendPanel = async () => {
    if (!settings[`${P}_PANEL_CHANNEL`]) {
      toast.error('パネル設置チャンネルを設定してください');
      return;
    }
    setSendingPanel(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/games/poker/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) toast.success('ポーカーパネルを送信しました！');
      else {
        const data = await res.json();
        toast.error(`送信に失敗しました: ${data.error || '不明なエラー'}`);
      }
    } catch {
      toast.error('エラーが発生しました');
    } finally {
      setSendingPanel(false);
    }
  };

  const textChannels = channels.filter((c: any) => c.type === 0);

  const numberInput = (key: string, label: string, help: string, unit = '') => (
    <label className="flex flex-col gap-1.5 bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
      <span className="text-sm font-tech text-zinc-300 font-medium">{label}</span>
      <span className="text-xs font-tech text-zinc-500">{help}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          inputMode="numeric"
          step="1"
          min={NUMBER_FIELDS[key][1]}
          max={NUMBER_FIELDS[key][2]}
          value={settings[`${P}_${key}`]}
          onChange={(e) => update(`${P}_${key}`, e.target.value)}
          onBlur={() => update(`${P}_${key}`, String(toInt(settings[`${P}_${key}`], key)))}
          className="w-40 bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-white font-tech focus:outline-none focus:border-cyan-500"
        />
        {unit && <span className="text-sm text-zinc-400 font-tech">{unit}</span>}
      </div>
    </label>
  );

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-cyan-400 font-tech">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-12">
      <PageHeader
        icon={Club}
        title="ポーカー設定"
        subtitle="テキサスホールデムのルール・賭け・チャンネルを管理します"
        eyebrow="System // Poker Module"
        tone="cyan"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle size={20} />
          <span className="font-tech text-sm">{error}</span>
        </div>
      )}

      {/* テーブルのルール */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">テーブルのルール</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {numberInput('START_CHIPS', '最初のチップ（賭けなしのとき）', '賭けなしの対戦は全員がこの枚数から始めます（通貨には影響しません）。賭けるときは持ち込んだ通貨がそのままチップになります', '枚')}
          {numberInput('MAX_PLAYERS', '最大人数（みんなで遊ぶ）', '卓を開いた人を含めた最大人数（2〜10人）', '人')}
          {numberInput('SMALL_BLIND', 'スモールブラインド', 'ハンドごとに強制で出すチップ（小）', '枚')}
          {numberInput('BIG_BLIND', 'ビッグブラインド', 'ハンドごとに強制で出すチップ（大）。最小ベット額にもなります', '枚')}
          {numberInput('BLIND_UP_HANDS', 'ブラインドを上げる間隔', 'このハンド数ごとにブラインドが2倍になります（0 で上げない）', 'ハンド')}
          {numberInput('TURN_SECONDS', '持ち時間', '自分の番の制限時間。過ぎるとチェック（できなければフォールド）になります。3回続けて時間切れになると退席（AI戦は降参）', '秒')}
        </div>
        <BlindHelp
          sb={toInt(settings[`${P}_SMALL_BLIND`], 'SMALL_BLIND')}
          bb={toInt(settings[`${P}_BIG_BLIND`], 'BIG_BLIND')}
          every={toInt(settings[`${P}_BLIND_UP_HANDS`], 'BLIND_UP_HANDS')}
        />
      </section>

      {/* 対戦の長さ */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">対戦の長さ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {numberInput('AI_MAX_HANDS', 'AI対戦のハンド数', 'このハンド数を終えた時点でチップが多い方の勝ち（0 でどちらかのチップがなくなるまで）', 'ハンド')}
          {numberInput('PVP_MAX_HANDS', 'みんなで遊ぶときのハンド数', 'このハンド数で終了して精算（0 で、1人になるか卓を開いた人が終了するまで）', 'ハンド')}
        </div>
      </section>

      {/* 賭け設定 */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">賭け設定</h2>

        <div className="flex items-center justify-between gap-4 bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">賭け ON/OFF</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">
              ONのときはチップ＝通貨になります。
              <br />
              みんなで遊ぶとき: 卓を開いた人が参加費を決め、全員が同じ額を払います。参加費がそのままチップになり、終了時・退席時に残ったチップを通貨で受け取ります（空欄・0 なら賭けなし）。
              <br />
              AI対戦: レベル4〜6のときだけ、持ち込んだ通貨がそのままチップになります（AIも同じ額から始めます）。レベル1〜3は通貨に影響しません。
              <br />
              OFFのときは、どの対戦も「最初のチップ」で遊び、通貨には影響しません。参加費・持ち込みはビッグブラインド以上が必要です。
            </p>
          </div>
          <Toggle on={!!settings[`${P}_BET_ENABLED`]} onClick={() => update(`${P}_BET_ENABLED`, !settings[`${P}_BET_ENABLED`])} />
        </div>

        {numberInput('PVP_MAX_BUYIN', '参加費の上限（みんなで遊ぶ）', '参加費＝最初のチップ。0 で上限なし')}

        <div className="bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50 space-y-3">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">AI対戦の持ち込み上限</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">レベルごとに1回で持ち込める（チップにできる）金額の上限です（0 で上限なし）</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BET_LEVELS.map((lv) => (
              <label key={lv} className="flex items-center gap-2">
                <span className="text-sm font-tech text-zinc-300 whitespace-nowrap">レベル{lv}（{LEVEL_NAME[lv]}）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  value={settings[`${P}_AI_MAX_BET_${lv}`]}
                  onChange={(e) => update(`${P}_AI_MAX_BET_${lv}`, e.target.value)}
                  onBlur={() => update(`${P}_AI_MAX_BET_${lv}`, String(toMaxBet(settings[`${P}_AI_MAX_BET_${lv}`])))}
                  className="w-32 bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-white font-tech focus:outline-none focus:border-cyan-500"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 bg-zinc-800/40 p-4 rounded-lg border border-zinc-700/50">
          <div>
            <p className="text-sm font-tech text-zinc-300 font-medium">戦績ボタン表示 ON/OFF</p>
            <p className="text-xs font-tech text-zinc-500 mt-0.5">ポーカーパネルに「自分の戦績」ボタンを表示します</p>
          </div>
          <Toggle on={!!settings[`${P}_SHOW_STATS`]} onClick={() => update(`${P}_SHOW_STATS`, !settings[`${P}_SHOW_STATS`])} labels={['表示 (ON)', '非表示 (OFF)']} />
        </div>
      </section>

      {/* チャンネル設定 */}
      <section className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl space-y-4">
        <h2 className="font-mecha text-base font-bold text-white border-b border-zinc-800 pb-2">チャンネル設定</h2>
        <div className="space-y-2">
          <label className="text-sm font-tech text-zinc-300 font-medium">パネル設置チャンネル</label>
          <ChannelSelect
            label="パネル設置チャンネル"
            placeholder="テキストチャンネルを選択..."
            value={settings[`${P}_PANEL_CHANNEL`]}
            onChange={(id) => update(`${P}_PANEL_CHANNEL`, id || '')}
            channels={textChannels}
            multiple={false}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-tech text-zinc-300 font-medium">プレイ進行チャンネル</label>
          <p className="text-xs font-tech text-zinc-500">
            「みんなで遊ぶ」を押した人がVCにいればその通話のチャットで、いなければこのチャンネルで卓を開きます（未設定の場合はパネルのチャンネル）
          </p>
          <ChannelSelect
            label="プレイ進行チャンネル"
            placeholder="テキストチャンネルを選択..."
            value={settings[`${P}_GAME_CHANNEL`]}
            onChange={(id) => update(`${P}_GAME_CHANNEL`, id || '')}
            channels={textChannels}
            multiple={false}
          />
        </div>
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all disabled:opacity-50 font-bold font-mecha"
        >
          <Save size={18} />
          <span>{saving ? '保存中...' : '設定を保存'}</span>
        </button>
        <button
          onClick={handleSendPanel}
          disabled={sendingPanel}
          className="flex items-center justify-center gap-2 px-8 py-3 bg-gradient-to-r from-zinc-700 to-zinc-600 hover:from-zinc-600 hover:to-zinc-500 text-white rounded-xl transition-all disabled:opacity-50 font-bold font-mecha border border-zinc-600"
        >
          <Send size={18} />
          <span>{sendingPanel ? '送信中...' : 'パネルを送信'}</span>
        </button>
      </div>
    </div>
  );
}
