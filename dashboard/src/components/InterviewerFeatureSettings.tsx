'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Save, Loader2, Send, Plus, X, ClipboardPen, MessageSquareQuote, Megaphone } from 'lucide-react';
import ChannelSelect, { ChannelOption } from '@/components/ChannelSelect';
import { useSyncStatus, SyncBadge } from '@/lib/useSyncStatus';

// Bot側 cogs/interview_announce.py の既定値と同じ
const DEFAULT_TIMES = ['20:30', '21:30', '22:30', '23:30'];
const DEFAULT_MESSAGE = [
  '# 📢 本日__**{time}より**__入店の儀を開催します。',
  '',
  '参加される方はVCへお越しください。',
  '',
  '尚、',
  '__**途中入退出・ミュートでの参加は禁止**__となっております。',
  '',
  '儀式最中に口頭でお答えしてもらう場面がございます。',
  '必ず環境が整った状態での参加をお願い致します。',
  '',
  '-# 5分前には会場に入室してください。',
].join('\n');
const DEFAULT_REMINDER_MESSAGE = '# 入店の儀5分前\n\n入店希望の方はVCへお集まりください。';
const MAX_TIMES = 20;
const TIME_PATTERN = /^[0-9]{1,2}:[0-5][0-9]$/;

const inputClass = 'w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
    </label>
  );
}

const toIdList = (v: any): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const toId = (v: any): string => (v ? String(v) : '');

/**
 * 面接官設定のうち、入界パネル（自己申告型）・自己紹介の転載・告知パネルの設定。
 * 値は bot_settings（/api/guilds/[guild_id]/settings）に保存し、パネルの設置は面接官APIからBotに依頼する。
 */
export default function InterviewerFeatureSettings({ guildId }: { guildId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [selfApply, setSelfApply] = useState(true);
  const [introSourceIds, setIntroSourceIds] = useState<string[]>([]);
  const [introOutputId, setIntroOutputId] = useState('');
  const [announceChannelId, setAnnounceChannelId] = useState('');
  const [notifyChannelId, setNotifyChannelId] = useState('');
  const [times, setTimes] = useState<string[]>(DEFAULT_TIMES);
  const [newTime, setNewTime] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [reminderMessage, setReminderMessage] = useState(DEFAULT_REMINDER_MESSAGE);
  const [hasManagerRole, setHasManagerRole] = useState(false);
  const [entryPanelChannel, setEntryPanelChannel] = useState('');
  const [announcePanelChannel, setAnnouncePanelChannel] = useState('');
  const [posting, setPosting] = useState<'' | 'interview_entry' | 'interview_announce'>('');
  const entrySync = useSyncStatus(guildId);
  const announceSync = useSyncStatus(guildId);

  useEffect(() => {
    Promise.all([
      fetch(`/api/guilds/${guildId}/settings`).then(r => r.json()),
      fetch(`/api/guilds/${guildId}/channels`).then(r => r.json()),
    ]).then(([s, ch]) => {
      if (s && !s.error) {
        setSelfApply(!(s.INTERVIEW_SELF_APPLY_ENABLED === false || s.INTERVIEW_SELF_APPLY_ENABLED === 'false'));
        setIntroSourceIds(toIdList(s.INTERVIEW_INTRO_SOURCE_CHANNEL_IDS));
        setIntroOutputId(toId(s.INTERVIEW_INTRO_OUTPUT_CHANNEL_ID));
        setAnnounceChannelId(toId(s.INTERVIEW_ANNOUNCE_CHANNEL_ID));
        setNotifyChannelId(toId(s.INTERVIEW_MANAGER_NOTIFY_CHANNEL_ID));
        if (Array.isArray(s.INTERVIEW_ANNOUNCE_TIMES)) setTimes(s.INTERVIEW_ANNOUNCE_TIMES.map(String));
        if (s.INTERVIEW_ANNOUNCE_MESSAGE) setMessage(String(s.INTERVIEW_ANNOUNCE_MESSAGE));
        if (s.INTERVIEW_ANNOUNCE_REMINDER_MESSAGE) setReminderMessage(String(s.INTERVIEW_ANNOUNCE_REMINDER_MESSAGE));
        setHasManagerRole(toIdList(s.INTERVIEW_MANAGER_ROLE_IDS).length > 0);
      }
      if (Array.isArray(ch)) setChannels(ch);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      toast.error('面接官設定を取得できませんでした');
      setLoading(false);
    });
  }, [guildId]);

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);

  const addTime = () => {
    const t = newTime.trim().replace('：', ':');
    if (!TIME_PATTERN.test(t)) {
      toast.error('時刻は「20:30」のように入力してください');
      return;
    }
    if (times.includes(t)) {
      toast.error('同じ時刻がすでにあります');
      return;
    }
    if (times.length >= MAX_TIMES) {
      toast.error(`時刻は${MAX_TIMES}個までです`);
      return;
    }
    setTimes([...times, t]);
    setNewTime('');
  };

  const save = async (): Promise<boolean> => {
    if (introSourceIds.length > 0 && !introOutputId) {
      toast.error('自己紹介の転載先チャンネルを選択してください');
      return false;
    }
    if (!message.trim() || !reminderMessage.trim()) {
      toast.error('告知の文章を入力してください');
      return false;
    }
    const res = await fetch(`/api/guilds/${guildId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        INTERVIEW_SELF_APPLY_ENABLED: selfApply,
        INTERVIEW_INTRO_SOURCE_CHANNEL_IDS: introSourceIds,
        INTERVIEW_INTRO_OUTPUT_CHANNEL_ID: introOutputId || null,
        INTERVIEW_ANNOUNCE_CHANNEL_ID: announceChannelId || null,
        INTERVIEW_MANAGER_NOTIFY_CHANNEL_ID: notifyChannelId || null,
        INTERVIEW_ANNOUNCE_TIMES: times,
        INTERVIEW_ANNOUNCE_MESSAGE: message.slice(0, 2000),
        INTERVIEW_ANNOUNCE_REMINDER_MESSAGE: reminderMessage.slice(0, 2000),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(`保存に失敗しました: ${data.error || `HTTP Error ${res.status}`}`);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (await save()) toast.success('設定を保存しました');
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePostPanel = async (panelType: 'interview_entry' | 'interview_announce') => {
    const channelId = panelType === 'interview_entry' ? entryPanelChannel : announcePanelChannel;
    const sync = panelType === 'interview_entry' ? entrySync : announceSync;
    if (!channelId) {
      toast.error('パネルを設置するチャンネルを選択してください');
      return;
    }
    setPosting(panelType);
    sync.reset();
    try {
      // 告知パネルのボタンは保存済みの時刻で並ぶので、先に保存しておく
      if (!(await save())) return;
      const res = await fetch(`/api/guilds/${guildId}/interviewer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post_panel', panel_type: panelType, channel_id: channelId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) toast.error(data.error || 'パネルの設置に失敗しました');
      else {
        toast.success('パネルの設置をBotに依頼しました');
        sync.startPolling(data.sync_request_id ?? null);
      }
    } catch {
      toast.error('通信エラーが発生しました');
    } finally {
      setPosting('');
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-zinc-500" size={32} /></div>;

  const saveButton = (
    <div className="flex justify-end">
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
        設定を保存
      </button>
    </div>
  );

  const panelPlacer = (panelType: 'interview_entry' | 'interview_announce', value: string, setValue: (v: string) => void, note: string) => {
    const sync = panelType === 'interview_entry' ? entrySync : announceSync;
    return (
      <div className="space-y-3 pt-4 border-t border-zinc-800">
        <label className="block text-sm font-semibold text-white">パネルを設置</label>
        <ChannelSelect label="設置するチャンネル" placeholder="チャンネルを選択..." channels={textChannels} value={value} onChange={(id: any) => setValue(id)} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handlePostPanel(panelType)}
            disabled={posting !== ''}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg disabled:opacity-50"
          >
            <Send size={16} /> {posting === panelType ? '依頼中...' : '保存してパネルを設置'}
          </button>
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
        </div>
        <p className="text-xs text-zinc-500">{note}</p>
      </div>
    );
  };

  return (
    <>
      {/* 入界パネル（自己申告型） */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ClipboardPen size={18} className="text-red-500" />入界パネル（自己申告型）</h2>
          <p className="text-sm text-zinc-400 mt-1">
            入界待機者がパネルのボタンから「名前・よみかた」を入力し、問題がなければその場で入界手続き（ロールの付け替え・初期発行）まで完了します。
          </p>
        </div>
        <div className="flex items-center justify-between p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/50">
          <div>
            <div className="font-medium">自己申告型を有効にする</div>
            <div className="text-sm text-zinc-400 mt-1">OFFにすると入界パネル（チケット設定の「面接チケット」も含む）は使えなくなり、/面接官 入界許可実行 だけで入界手続きを行います</div>
          </div>
          <Toggle checked={selfApply} onChange={setSelfApply} />
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-400">
          <li>名前に使えるのは「漢字・ひらがな・カタカナ・数字・・」だけ、よみかたは「ひらがな」だけです（記号・特殊文字・英字・ハングル・空白は不可）。</li>
          <li>名前がサーバー内の人の名前と完全一致、またはよみかたが入界時に登録された人と完全一致すると申請は通りません。</li>
          <li>完了するとパネルのチャンネルにメンション付きで完了のお知らせが出て、面接官ログにロールの付け替え結果と残高が残ります。</li>
          <li>出戻り（以前に初期発行を受けた人）には初期通貨を配らず、面接官ログに「配布失敗」として残します（/面接官 入界許可実行 も同じです）。</li>
        </ul>
        {saveButton}
        {panelPlacer('interview_entry', entryPanelChannel, setEntryPanelChannel, 'Discordで /面接官 入界パネル を実行しても、そのチャンネルに設置できます。')}
      </div>

      {/* 自己紹介の転載 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><MessageSquareQuote size={18} className="text-red-500" />自己紹介の転載</h2>
          <p className="text-sm text-zinc-400 mt-1">
            入界手続きが完了したとき、その人が転載元チャンネルに書いた自己紹介をアイコン付きのログ形式で転載先チャンネルに出し、元のメッセージを消します。
            転載元を選ばなければ転載はしません。
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">転載元チャンネル <span className="ml-2 text-xs text-zinc-500 font-normal">(複数選択可・直近200件から探します)</span></label>
          <ChannelSelect label="転載元チャンネル" placeholder="チャンネルを選択..." value={introSourceIds} onChange={setIntroSourceIds} channels={textChannels} multiple />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">転載先チャンネル</label>
          <ChannelSelect label="転載先チャンネル" placeholder="チャンネルを選択..." value={introOutputId} onChange={(id: any) => setIntroOutputId(id)} channels={textChannels} />
        </div>
        <p className="text-xs text-zinc-500">元のメッセージを消すには、Botに転載元チャンネルの「メッセージの管理」権限が必要です。</p>
        {saveButton}
      </div>

      {/* 告知パネル */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Megaphone size={18} className="text-red-500" />告知パネル（入店の儀）</h2>
          <p className="text-sm text-zinc-400 mt-1">
            面接官が時刻のボタンや「5分前告知」を押すと、ここで決めた文章を告知チャンネルに出し、面接官統括ロールへ通知チャンネルでメンション付きのお知らせを送ります。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">告知チャンネル</label>
            <ChannelSelect label="告知チャンネル" placeholder="チャンネルを選択..." value={announceChannelId} onChange={(id: any) => setAnnounceChannelId(id)} channels={textChannels} />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">面接官統括への通知チャンネル</label>
            <ChannelSelect label="通知チャンネル" placeholder="チャンネルを選択..." value={notifyChannelId} onChange={(id: any) => setNotifyChannelId(id)} channels={textChannels} />
          </div>
        </div>
        {!hasManagerRole && (
          <p className="text-xs text-amber-400">面接官統括ロールが未設定です。「基本・評価設定」のロール設定で「面接官統括ロール」を設定すると、通知でメンションされます。</p>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300">時刻のボタン（{times.length} / {MAX_TIMES}）</label>
          <div className="flex flex-wrap gap-2">
            {times.map(t => (
              <span key={t} className="flex items-center gap-1 pl-3 pr-1 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm">
                {t}
                <button type="button" onClick={() => setTimes(times.filter(x => x !== t))} className="p-1 text-zinc-400 hover:text-red-400"><X size={14} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 max-w-xs">
            <input
              type="text"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTime(); }}
              placeholder="例: 20:30"
              className={inputClass}
            />
            <button type="button" onClick={addTime} className="flex items-center gap-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg flex-shrink-0"><Plus size={16} />追加</button>
          </div>
          <p className="text-xs text-zinc-500">時刻を変えたら、パネルを設置し直すとボタンも変わります。</p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300">時刻のボタンで送る文章</label>
          <textarea className={`${inputClass} min-h-[220px] font-mono text-sm`} value={message} maxLength={2000} onChange={e => setMessage(e.target.value)} />
          <p className="text-xs text-zinc-500">{'{time}'} は押したボタンの時刻（例: 20:30）に置き換わります。</p>
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-zinc-300">「5分前告知」で送る文章</label>
          <textarea className={`${inputClass} min-h-[100px] font-mono text-sm`} value={reminderMessage} maxLength={2000} onChange={e => setReminderMessage(e.target.value)} />
        </div>
        {saveButton}
        {panelPlacer('interview_announce', announcePanelChannel, setAnnouncePanelChannel, 'パネルのボタンは面接官ロールを持つ人だけが使えます。Discordで /面接官 告知パネル を実行しても設置できます。')}
      </div>
    </>
  );
}
