'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Check, CheckCircle2, Hash, Loader2, Megaphone, MessagesSquare, Save, Search, Send, Volume2, X } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

// メッセージを送れるチャンネル: テキスト(0)・アナウンス(5)・ボイス(2)・ステージ(13)のチャット
const POSTABLE_TYPES = [0, 5, 2, 13];
// 一覧には出すが選べないもの: フォーラム(15)・メディア(16)は投稿（スレッド）を作らないと書き込めない
const UNPOSTABLE_TYPES: Record<number, string> = { 15: 'フォーラムには設置できません', 16: 'メディアチャンネルには設置できません' };

const channelIcon = (type: number) => {
  if (type === 2 || type === 13) return <Volume2 className="w-4 h-4 flex-shrink-0" />;
  if (type === 5) return <Megaphone className="w-4 h-4 flex-shrink-0" />;
  if (type === 15 || type === 16) return <MessagesSquare className="w-4 h-4 flex-shrink-0" />;
  return <Hash className="w-4 h-4 flex-shrink-0" />;
};

export default function CirclePanelPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'post' | null>(null);
  const [posted, setPosted] = useState<'pending' | 'done' | 'timeout' | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/circle/panel`).then((r) => r.json()),
      fetch(`/api/guilds/${guildId}/channels`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([panel, chs]) => {
        if (panel.error) throw new Error(panel.error);
        setTitle(panel.panel_title);
        setDescription(panel.panel_description);
        setButtonLabel(panel.panel_button_label);
        setChannels(Array.isArray(chs) ? chs : []);
      })
      .catch((e) => toast.error(`読み込めませんでした: ${e.message}`))
      .finally(() => setLoading(false));
  }, [guildId]);

  // 検索に一致するチャンネルをカテゴリごとに並べる（カテゴリ名で検索すると、その中のチャンネルが全部出る）
  const grouped = useMemo(() => {
    const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
    const q = query.trim().toLowerCase();
    const listed = channels.filter((c) => {
      if (!POSTABLE_TYPES.includes(c.type) && !(c.type in UNPOSTABLE_TYPES)) return false;
      if (!q) return true;
      const cat = c.parent_id ? categories.get(c.parent_id) : undefined;
      return c.name.toLowerCase().includes(q) || c.id === q || !!cat?.name.toLowerCase().includes(q);
    });
    const groups = new Map<string, { name: string; position: number; items: Channel[] }>();
    for (const c of listed) {
      const cat = c.parent_id ? categories.get(c.parent_id) : undefined;
      const key = cat?.id ?? '';
      if (!groups.has(key)) groups.set(key, { name: cat?.name ?? 'カテゴリなし', position: cat ? cat.position : -1, items: [] });
      groups.get(key)!.items.push(c);
    }
    return Array.from(groups.values())
      .sort((a, b) => a.position - b.position)
      // 同じカテゴリ内では Discord と同じく、テキスト系 → ボイス系の順
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => {
          const va = a.type === 2 || a.type === 13 ? 1 : 0;
          const vb = b.type === 2 || b.type === 13 ? 1 : 0;
          return va - vb || a.position - b.position;
        }),
      }));
  }, [channels, query]);

  const selected = channels.find((c) => c.id === channelId) || null;

  // Bot がパネルを置き終わるのを待つ（最大30秒）
  const waitForBot = async (requestId: number) => {
    setPosted('pending');
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/guilds/${guildId}/sync-status?request_id=${requestId}`, { cache: 'no-store' });
        const data = await res.json();
        if (data?.sync?.processed) {
          setPosted('done');
          return;
        }
      } catch {}
    }
    setPosted('timeout');
  };

  const submit = async (post: boolean) => {
    if (post && !channelId) {
      toast.error('設置先チャンネルを選んでください');
      return;
    }
    setBusy(post ? 'post' : 'save');
    setPosted(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panel_title: title,
          panel_description: description,
          panel_button_label: buttonLabel,
          channel_id: post ? channelId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (post) {
        toast.success('設置をBotに依頼しました');
        if (data.sync_request_id) waitForBot(data.sync_request_id);
      } else {
        toast.success('保存しました');
      }
    } catch (e: any) {
      toast.error(`${post ? '設置' : '保存'}できませんでした: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-400 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> 読み込み中...
      </div>
    );
  }

  const inputCls =
    'w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none px-3 py-2.5 text-[16px] md:text-sm placeholder:text-slate-600';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">パネル設置</h1>
        <p className="text-sm text-slate-400 mt-1">
          Discord のチャンネルに「報告書を書く」ボタンのパネルを置きます。部員はボタンから題名・内容・PDF を入力して報告書を提出でき、
          保存後に「送信する」を押すと送信先の人へ届きます。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h2 className="text-sm font-semibold">パネルの表示内容</h2>
          <div>
            <label className="block text-xs text-slate-400 mb-1">タイトル</label>
            <input value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">説明文</label>
            <textarea value={description} maxLength={2000} rows={4} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-y`} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">ボタンの文字</label>
            <input value={buttonLabel} maxLength={80} onChange={(e) => setButtonLabel(e.target.value)} className={inputCls} />
          </div>
          <button
            onClick={() => submit(false)}
            disabled={!!busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-50 text-sm px-4 py-2 transition-colors"
          >
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            表示内容だけ保存
          </button>
          <p className="text-xs text-slate-500">※ 設置済みのパネルの見た目は変わりません。変えたいときはもう一度設置してください。</p>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold mb-3">プレビュー</h2>
            <div className="rounded-md bg-[#2b2d31] p-3">
              <div className="border-l-4 border-sky-500 rounded-sm bg-[#232428] p-3">
                <div className="font-bold text-white text-sm break-words">{title || '（タイトル）'}</div>
                <div className="text-[13px] text-slate-300 mt-1 whitespace-pre-wrap break-words">{description}</div>
                <div className="text-[11px] text-slate-500 mt-2">入力した内容は、送るまで本人と運営にだけ見えます</div>
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-[#5865f2] text-white text-sm font-medium px-4 py-1.5">
                📝 {buttonLabel || '報告書を書く'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
            <h2 className="text-sm font-semibold">設置先チャンネル</h2>
            {selected ? (
              <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 ring-1 ring-sky-500/40 px-3 py-2.5 text-sm">
                <span className="text-sky-300">{channelIcon(selected.type)}</span>
                <span className="flex-1 truncate font-semibold">{selected.name}</span>
                <button
                  onClick={() => setChannelId('')}
                  aria-label="選択を解除"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">下の一覧から選んでください（チャンネル名・カテゴリ名で検索できます）</p>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="チャンネル名・カテゴリ名で検索"
                className={`${inputCls} pl-9`}
              />
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-1">
              {grouped.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6">
                  {channels.length === 0 ? 'チャンネルを取得できませんでした' : `「${query}」に一致するチャンネルはありません`}
                </div>
              ) : (
                grouped.map((g) => (
                  <div key={g.name + g.position} className="mb-1">
                    <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">{g.name}</div>
                    {g.items.map((c) => {
                      const blocked = UNPOSTABLE_TYPES[c.type];
                      const active = c.id === channelId;
                      return (
                        <button
                          key={c.id}
                          onClick={() => !blocked && setChannelId(c.id)}
                          disabled={!!blocked}
                          title={blocked || undefined}
                          className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                            active
                              ? 'bg-sky-500/20 text-sky-100'
                              : blocked
                                ? 'text-slate-600 cursor-not-allowed'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <span className={active ? 'text-sky-300' : 'text-slate-500'}>{channelIcon(c.type)}</span>
                          <span className="flex-1 truncate">{c.name}</span>
                          {blocked && <span className="text-[10px] text-slate-600 flex-shrink-0">{blocked}</span>}
                          {active && <Check className="w-4 h-4 text-sky-300 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => submit(true)}
              disabled={!!busy || !channelId}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm px-5 py-2.5 transition-colors"
            >
              {busy === 'post' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              このチャンネルに設置する
            </button>
            {posted === 'pending' && (
              <p className="text-xs text-amber-300 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Bot が設置しています...</p>
            )}
            {posted === 'done' && (
              <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> 設置しました（Discord を確認してください）</p>
            )}
            {posted === 'timeout' && (
              <p className="text-xs text-rose-300">Bot からの応答がありません。Bot が起動しているか確認してください。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
