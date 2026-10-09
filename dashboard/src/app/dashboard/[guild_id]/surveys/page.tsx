'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  ClipboardList, Plus, Trash2, Save, ArrowLeft, ArrowUp, ArrowDown, Pencil, BarChart3, Send, Download, X, Lock, Unlock,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { useSyncStatus, SyncBadge, SyncStatusCards } from '@/lib/useSyncStatus';
import ChannelSelect from '@/components/ChannelSelect';

type QuestionType = 'single' | 'multi' | 'text';

interface Question {
  id: string;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  options?: string[];
}

interface Survey {
  id?: number;
  title: string;
  description: string;
  questions: Question[];
  is_anonymous: boolean;
  allow_edit: boolean;
  is_open: boolean;
  closes_at: string | null;
  button_label: string;
  channel_id?: string | null;
  message_id?: string | null;
  created_at?: string | null;
  response_count?: number;
}

interface SurveyResponse {
  id: number;
  user_id: string | null;
  user_name: string;
  answers: Record<string, string | string[]>;
  created_at: string | null;
  updated_at: string | null;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  single: '単一選択',
  multi: '複数選択',
  text: '自由記述',
};

const newId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const newQuestion = (type: QuestionType): Question => ({
  id: newId(),
  type,
  title: '',
  description: '',
  required: true,
  options: type === 'text' ? undefined : ['', ''],
});

const emptySurvey = (): Survey => ({
  title: '',
  description: '',
  questions: [newQuestion('single')],
  is_anonymous: false,
  allow_edit: true,
  is_open: true,
  closes_at: null,
  button_label: '回答する',
});

/** ISO文字列 → datetime-local 入力用の値（ブラウザのローカル時刻） */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

const isAccepting = (s: Survey) => s.is_open && (!s.closes_at || new Date(s.closes_at) > new Date());

const answerText = (val: string | string[] | undefined) =>
  Array.isArray(val) ? val.join('、') : (val ?? '');

const Toggle = ({ checked, onChange, color = 'peer-checked:bg-teal-600' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) => (
  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
    <div className={`w-12 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${color}`}></div>
  </label>
);

const inputClass = 'w-full bg-[#111827] border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-teal-500 transition-colors';

export default function SurveysPage() {
  const params = useParams();
  const guildId = params.guild_id as string;
  const sync = useSyncStatus(guildId);

  const [view, setView] = useState<'list' | 'edit' | 'detail'>('list');
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Survey>(emptySurvey());
  const [detail, setDetail] = useState<{ survey: Survey; responses: SurveyResponse[] } | null>(null);
  const [postChannel, setPostChannel] = useState('');
  const [posting, setPosting] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/guilds/${guildId}/surveys`);
    const data = await res.json();
    if (Array.isArray(data)) setSurveys(data);
    else toast.error(data.error || 'アンケートの取得に失敗しました');
  }, [guildId]);

  useEffect(() => {
    Promise.all([
      loadList(),
      fetch(`/api/guilds/${guildId}/channels`).then(res => (res.ok ? res.json() : [])).then(d => setChannels(Array.isArray(d) ? d : [])),
    ]).finally(() => setLoading(false));
  }, [guildId, loadList]);

  const openDetail = async (id: number) => {
    const res = await fetch(`/api/guilds/${guildId}/surveys/${id}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '取得に失敗しました');
      return;
    }
    setDetail(data);
    setPostChannel(data.survey.channel_id || '');
    setView('detail');
  };

  const openEditor = (survey?: Survey) => {
    setDraft(survey ? JSON.parse(JSON.stringify(survey)) : emptySurvey());
    sync.reset();
    setView('edit');
  };

  const handleSave = async () => {
    setSaving(true);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/surveys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || '保存に失敗しました');
        return;
      }
      toast.success(draft.id ? 'アンケートを更新しました' : 'アンケートを作成しました');
      if (data.sync_request_id) sync.startPolling(data.sync_request_id);
      await loadList();
      await openDetail(data.survey.id);
    } catch (err: any) {
      toast.error(`保存に失敗しました: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Survey) => {
    if (!s.id || !confirm(`「${s.title}」を削除しますか？\n回答もすべて削除されます。`)) return;
    const res = await fetch(`/api/guilds/${guildId}/surveys/${s.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '削除に失敗しました');
      return;
    }
    toast.success('削除しました');
    setView('list');
    loadList();
  };

  const toggleOpen = async (s: Survey) => {
    const res = await fetch(`/api/guilds/${guildId}/surveys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, is_open: !s.is_open }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '更新に失敗しました');
      return;
    }
    toast.success(s.is_open ? '受付を終了しました' : '受付を再開しました');
    if (data.sync_request_id) sync.startPolling(data.sync_request_id);
    loadList();
    if (s.id) openDetail(s.id);
  };

  const postToDiscord = async (action: 'post_panel' | 'post_results') => {
    if (!detail?.survey.id) return;
    if (!postChannel) {
      toast.error('送信先チャンネルを選択してください');
      return;
    }
    setPosting(true);
    sync.reset();
    try {
      const res = await fetch(`/api/guilds/${guildId}/surveys/${detail.survey.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, channel_id: postChannel }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || '送信に失敗しました');
        return;
      }
      toast.success(action === 'post_panel' ? '回答パネルの投稿をBotに依頼しました' : '集計結果の投稿をBotに依頼しました');
      sync.startPolling(data.sync_request_id ?? null);
    } finally {
      setPosting(false);
    }
  };

  const clearResponses = async () => {
    if (!detail?.survey.id || !confirm('このアンケートの回答をすべて削除しますか？（元に戻せません）')) return;
    const res = await fetch(`/api/guilds/${guildId}/surveys/${detail.survey.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_responses' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || '削除に失敗しました');
      return;
    }
    toast.success('回答を削除しました');
    openDetail(detail.survey.id);
    loadList();
  };

  const downloadCsv = () => {
    if (!detail) return;
    const { survey, responses } = detail;
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['回答者', ...(survey.is_anonymous ? [] : ['ユーザーID']), '回答日時', ...survey.questions.map(q => q.title)];
    const rows = responses.map(r => [
      r.user_name,
      ...(survey.is_anonymous ? [] : [r.user_id || '']),
      formatDate(r.updated_at || r.created_at),
      ...survey.questions.map(q => answerText(r.answers[q.id])),
    ]);
    const csv = '﻿' + [header, ...rows].map(row => row.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey_${survey.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ===== 編集用ヘルパー =====
  const updateQuestion = (index: number, patch: Partial<Question>) =>
    setDraft(prev => {
      const questions = [...prev.questions];
      questions[index] = { ...questions[index], ...patch };
      return { ...prev, questions };
    });
  const moveQuestion = (index: number, dir: -1 | 1) =>
    setDraft(prev => {
      const questions = [...prev.questions];
      const target = index + dir;
      if (target < 0 || target >= questions.length) return prev;
      [questions[index], questions[target]] = [questions[target], questions[index]];
      return { ...prev, questions };
    });
  const removeQuestion = (index: number) =>
    setDraft(prev => ({ ...prev, questions: prev.questions.filter((_, i) => i !== index) }));
  const addQuestion = (type: QuestionType) =>
    setDraft(prev => ({ ...prev, questions: [...prev.questions, newQuestion(type)] }));
  const changeType = (index: number, type: QuestionType) => {
    const q = draft.questions[index];
    updateQuestion(index, { type, options: type === 'text' ? undefined : (q.options?.length ? q.options : ['', '']) });
  };

  const postableChannels = channels.filter(c => c.type === 0 || c.type === 5 || c.type === 15);

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-teal-400">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-gray-900/80 p-6 rounded-2xl border border-teal-500/20 backdrop-blur-sm sticky top-0 z-10 shadow-2xl">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-cyan-500 flex items-center gap-3">
            <ClipboardList className="text-teal-400" size={32} />
            アンケート
          </h1>
          <p className="text-gray-400 mt-2 text-sm">アンケートを作成してDiscordに投稿し、メンバーの回答を集計できます。</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncBadge state={sync.state} botOnline={sync.botOnline} />
          {view === 'list' && (
            <button
              onClick={() => openEditor()}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white rounded-xl font-bold transition-all"
            >
              <Plus size={20} />
              新規作成
            </button>
          )}
          {view === 'edit' && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white rounded-xl font-bold transition-all disabled:opacity-50"
            >
              <Save size={20} />
              {saving ? '保存中...' : '保存'}
            </button>
          )}
        </div>
      </div>

      <SyncStatusCards sync={sync} />

      {view !== 'list' && (
        <button onClick={() => { setView('list'); loadList(); }} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> 一覧に戻る
        </button>
      )}

      {/* ===== 一覧 ===== */}
      {view === 'list' && (
        <div className="space-y-3">
          {surveys.length === 0 && (
            <div className="text-center text-gray-500 py-16 border border-dashed border-gray-700 rounded-xl">
              アンケートがありません。「新規作成」から作成してください。
            </div>
          )}
          {surveys.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="bg-gray-800/50 border border-teal-500/20 p-5 rounded-xl flex flex-col md:flex-row md:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-white truncate">{s.title}</h2>
                  {isAccepting(s) ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">受付中</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-400 border border-gray-600/50">受付終了</span>
                  )}
                  {s.is_anonymous && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">匿名</span>}
                  {s.message_id && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">投稿済み</span>}
                </div>
                <p className="text-sm text-gray-400 mt-1">
                  質問 {s.questions.length}問 ・ 回答 <span className="text-teal-300 font-bold">{s.response_count ?? 0}</span>件
                  {s.closes_at && <> ・ 締切 {formatDate(s.closes_at)}</>}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => s.id && openDetail(s.id)} className="flex items-center gap-1 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm rounded-lg font-bold">
                  <BarChart3 size={16} /> 結果・投稿
                </button>
                <button onClick={() => openEditor(s)} className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
                  <Pencil size={16} /> 編集
                </button>
                <button onClick={() => handleDelete(s)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg" title="削除">
                  <Trash2 size={18} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ===== 作成・編集 ===== */}
      {view === 'edit' && (
        <div className="space-y-6">
          <div className="bg-gray-800/50 border border-teal-500/20 p-6 rounded-xl space-y-5">
            <h2 className="text-xl font-semibold text-teal-300 border-b border-teal-500/20 pb-3">基本設定</h2>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-400">タイトル</label>
              <input type="text" maxLength={200} value={draft.title} placeholder="例: 次のイベントについてのアンケート"
                onChange={(e) => setDraft(p => ({ ...p, title: e.target.value }))} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-400">説明（パネルに表示されます）</label>
              <textarea rows={3} maxLength={2000} value={draft.description} placeholder="例: ご意見をお聞かせください。所要時間は1分ほどです。"
                onChange={(e) => setDraft(p => ({ ...p, description: e.target.value }))} className={inputClass} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-400">ボタンの文字</label>
                <input type="text" maxLength={80} value={draft.button_label}
                  onChange={(e) => setDraft(p => ({ ...p, button_label: e.target.value }))} className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-400">締切（任意）</label>
                <div className="flex gap-2">
                  <input type="datetime-local" value={toLocalInput(draft.closes_at)}
                    onChange={(e) => setDraft(p => ({ ...p, closes_at: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                    className={inputClass} />
                  {draft.closes_at && (
                    <button type="button" onClick={() => setDraft(p => ({ ...p, closes_at: null }))} className="px-2 text-gray-400 hover:text-white" title="締切をなくす">
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {[
              { key: 'is_open' as const, title: '回答を受け付ける', desc: 'OFFにすると回答ボタンが押せなくなります（投稿済みのパネルにも反映されます）。' },
              { key: 'is_anonymous' as const, title: '匿名アンケート', desc: 'ONにすると、ダッシュボードの結果でも回答者が誰かは表示されません（1人1回の判定にのみ使います）。' },
              { key: 'allow_edit' as const, title: '回答の修正を許可する', desc: 'ONにすると、回答済みの人がもう一度ボタンを押して回答を修正できます。OFFなら1人1回のみです。' },
            ].map(opt => (
              <div key={opt.key} className="flex items-center justify-between bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
                <div className="pr-4">
                  <h3 className="text-sm font-semibold text-gray-200">{opt.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">{opt.desc}</p>
                </div>
                <Toggle checked={draft[opt.key]} onChange={(v) => setDraft(p => ({ ...p, [opt.key]: v }))} />
              </div>
            ))}
          </div>

          <div className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3">
              <h2 className="text-xl font-semibold text-cyan-300">質問（{draft.questions.length} / 25）</h2>
            </div>
            {draft.id && (detailResponsesCount(surveys, draft.id) > 0) && (
              <p className="text-xs text-yellow-400">※ すでに回答があります。選択肢の文字を変えると、変更前の選択肢への回答は集計に含まれなくなります。</p>
            )}

            {draft.questions.map((q, index) => (
              <div key={q.id} className="bg-gray-900/50 border border-gray-700/60 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-cyan-300 font-bold">Q{index + 1}</span>
                  <select value={q.type} onChange={(e) => changeType(index, e.target.value as QuestionType)}
                    className="bg-[#111827] border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500">
                    {(Object.keys(TYPE_LABELS) as QuestionType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(index, { required: e.target.checked })} />
                    必須
                  </label>
                  <div className="ml-auto flex gap-1">
                    <button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30" title="上へ"><ArrowUp size={16} /></button>
                    <button type="button" onClick={() => moveQuestion(index, 1)} disabled={index === draft.questions.length - 1} className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30" title="下へ"><ArrowDown size={16} /></button>
                    <button type="button" onClick={() => removeQuestion(index)} className="p-1.5 text-gray-500 hover:text-red-400" title="削除"><Trash2 size={16} /></button>
                  </div>
                </div>
                <input type="text" maxLength={200} value={q.title} placeholder="質問文"
                  onChange={(e) => updateQuestion(index, { title: e.target.value })} className={inputClass} />
                <input type="text" maxLength={500} value={q.description} placeholder="補足説明（任意）"
                  onChange={(e) => updateQuestion(index, { description: e.target.value })} className={`${inputClass} text-sm`} />
                {q.type !== 'text' && (
                  <div className="space-y-2 pl-2 border-l-2 border-cyan-500/30">
                    {(q.options || []).map((opt, oi) => (
                      <div key={oi} className="flex gap-2 items-center">
                        <span className="text-gray-500 text-sm w-5">{q.type === 'single' ? '○' : '□'}</span>
                        <input type="text" maxLength={100} value={opt} placeholder={`選択肢${oi + 1}`}
                          onChange={(e) => {
                            const options = [...(q.options || [])];
                            options[oi] = e.target.value;
                            updateQuestion(index, { options });
                          }}
                          className={`${inputClass} text-sm py-1.5`} />
                        <button type="button" onClick={() => updateQuestion(index, { options: (q.options || []).filter((_, i) => i !== oi) })}
                          className="p-1 text-gray-500 hover:text-red-400" title="選択肢を削除"><X size={16} /></button>
                      </div>
                    ))}
                    {(q.options?.length ?? 0) < 25 && (
                      <button type="button" onClick={() => updateQuestion(index, { options: [...(q.options || []), ''] })}
                        className="flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300">
                        <Plus size={14} /> 選択肢を追加
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {draft.questions.length < 25 && (
              <div className="flex flex-wrap gap-3">
                {(Object.keys(TYPE_LABELS) as QuestionType[]).map(t => (
                  <button key={t} type="button" onClick={() => addQuestion(t)}
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-bold rounded-lg">
                    <Plus size={16} /> {TYPE_LABELS[t]}を追加
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 結果・投稿 ===== */}
      {view === 'detail' && detail && (
        <div className="space-y-6">
          <div className="bg-gray-800/50 border border-teal-500/20 p-6 rounded-xl space-y-3">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">{detail.survey.title}</h2>
                {detail.survey.description && <p className="text-gray-400 text-sm mt-1 whitespace-pre-wrap">{detail.survey.description}</p>}
                <p className="text-sm text-gray-400 mt-2">
                  回答 <span className="text-teal-300 font-bold text-lg">{detail.responses.length}</span>件
                  ・ {isAccepting(detail.survey) ? '受付中' : '受付終了'}
                  {detail.survey.closes_at && <> ・ 締切 {formatDate(detail.survey.closes_at)}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button onClick={() => toggleOpen(detail.survey)} className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
                  {detail.survey.is_open ? <><Lock size={16} /> 受付を終了</> : <><Unlock size={16} /> 受付を再開</>}
                </button>
                <button onClick={() => openEditor(detail.survey)} className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">
                  <Pencil size={16} /> 編集
                </button>
              </div>
            </div>
          </div>

          <div className="bg-gray-800/50 border border-blue-500/20 p-6 rounded-xl space-y-4">
            <h2 className="text-xl font-semibold text-blue-300 flex items-center gap-2"><Send size={20} /> Discordに投稿</h2>
            <ChannelSelect
              label="送信先チャンネル"
              placeholder="チャンネルを選択..."
              channels={postableChannels}
              value={postChannel}
              onChange={(id: any) => setPostChannel(id)}
            />
            <div className="flex flex-wrap gap-3">
              <button onClick={() => postToDiscord('post_panel')} disabled={posting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg disabled:opacity-50">
                <Send size={16} /> 回答パネルを投稿
              </button>
              <button onClick={() => postToDiscord('post_results')} disabled={posting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg disabled:opacity-50">
                <BarChart3 size={16} /> 集計結果を投稿
              </button>
            </div>
            <p className="text-xs text-gray-500">
              回答パネルの「{detail.survey.button_label}」ボタンを押すと、本人にだけ見えるメッセージで1問ずつ回答できます。
              集計結果の投稿では選択式の質問の集計が表示されます（自由記述の内容は投稿されません）。
            </p>
          </div>

          <div className="bg-gray-800/50 border border-cyan-500/20 p-6 rounded-xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
              <h2 className="text-xl font-semibold text-cyan-300 flex items-center gap-2"><BarChart3 size={20} /> 集計</h2>
              <div className="flex gap-2">
                <button onClick={downloadCsv} disabled={detail.responses.length === 0}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg disabled:opacity-40">
                  <Download size={16} /> CSVダウンロード
                </button>
                <button onClick={clearResponses} disabled={detail.responses.length === 0}
                  className="flex items-center gap-1 px-3 py-2 text-red-400 hover:bg-red-400/10 border border-red-500/30 text-sm rounded-lg disabled:opacity-40">
                  <Trash2 size={16} /> 回答をリセット
                </button>
              </div>
            </div>

            {detail.survey.questions.map((q, qi) => {
              const total = detail.responses.length;
              return (
                <div key={q.id} className="space-y-2">
                  <h3 className="font-semibold text-white">
                    Q{qi + 1}. {q.title}
                    <span className="ml-2 text-xs text-gray-500">{TYPE_LABELS[q.type]}</span>
                  </h3>
                  {q.type !== 'text' ? (
                    <div className="space-y-1.5">
                      {(q.options || []).map(opt => {
                        const count = detail.responses.filter(r => {
                          const v = r.answers[q.id];
                          return Array.isArray(v) ? v.includes(opt) : v === opt;
                        }).length;
                        const pct = total ? (count / total) * 100 : 0;
                        return (
                          <div key={opt} className="flex items-center gap-3 text-sm">
                            <span className="w-40 md:w-56 truncate text-gray-300" title={opt}>{opt}</span>
                            <div className="flex-1 h-5 bg-gray-900 rounded overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-24 text-right text-gray-300">{count}票 ({pct.toFixed(0)}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-1.5">
                      {detail.responses.filter(r => answerText(r.answers[q.id]).trim()).length === 0 && (
                        <p className="text-sm text-gray-500">まだ回答がありません。</p>
                      )}
                      {detail.responses.filter(r => answerText(r.answers[q.id]).trim()).map(r => (
                        <div key={r.id} className="bg-gray-900/60 rounded-lg px-3 py-2 text-sm">
                          <span className="text-gray-500 text-xs mr-2">{r.user_name}</span>
                          <span className="text-gray-200 whitespace-pre-wrap">{answerText(r.answers[q.id])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/60 p-6 rounded-xl space-y-3">
            <h2 className="text-xl font-semibold text-gray-200">回答一覧</h2>
            {detail.responses.length === 0 ? (
              <p className="text-sm text-gray-500">まだ回答がありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="py-2 pr-4 whitespace-nowrap">回答者</th>
                      <th className="py-2 pr-4 whitespace-nowrap">回答日時</th>
                      {detail.survey.questions.map((q, i) => <th key={q.id} className="py-2 pr-4 whitespace-nowrap" title={q.title}>Q{i + 1}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.responses.map(r => (
                      <tr key={r.id} className="border-b border-gray-800 text-gray-200 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap">{r.user_name}</td>
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-400">{formatDate(r.updated_at || r.created_at)}</td>
                        {detail.survey.questions.map(q => (
                          <td key={q.id} className="py-2 pr-4 max-w-xs break-words">{answerText(r.answers[q.id]) || <span className="text-gray-600">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => handleDelete(detail.survey)} className="flex items-center gap-1 px-3 py-2 text-red-400 hover:bg-red-400/10 text-sm rounded-lg">
              <Trash2 size={16} /> このアンケートを削除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function detailResponsesCount(surveys: Survey[], id: number) {
  return surveys.find(s => s.id === id)?.response_count ?? 0;
}
