'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useCircleSession } from '@/lib/useCircleSession';
import {
  CheckCircle2, Clock, Download, FileText, FileUp, Loader2, Paperclip,
  Pencil, Plus, Save, Send, Trash2, X, XCircle, AlertTriangle,
} from 'lucide-react';

type SendStatus = 'none' | 'pending' | 'sent' | 'partial' | 'failed';

interface SendResult {
  user_id: string;
  name?: string;
  ok: boolean;
  error?: string;
}

interface Report {
  id: number;
  title: string;
  content: string;
  pdf_name: string | null;
  pdf_size: number | null;
  send_status: SendStatus;
  send_results: SendResult[];
  last_sent_at: string | null;
  author_id: string | null;
  author_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Draft {
  id: number | null;
  title: string;
  content: string;
  file: File | null;
  existingPdf: { name: string; size: number | null } | null;
  removePdf: boolean;
}

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT = 4000;

const emptyDraft = (): Draft => ({ id: null, title: '', content: '', file: null, existingPdf: null, removePdf: false });

const formatSize = (n: number | null | undefined) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

function StatusBadge({ report }: { report: Report }) {
  const okCount = report.send_results.filter((r) => r.ok).length;
  const total = report.send_results.length;
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
  switch (report.send_status) {
    case 'pending':
      return <span className={`${base} bg-amber-500/15 text-amber-300`}><Loader2 className="w-3 h-3 animate-spin" /> 送信中</span>;
    case 'sent':
      return <span className={`${base} bg-emerald-500/15 text-emerald-300`}><CheckCircle2 className="w-3 h-3" /> 送信済み {okCount}人</span>;
    case 'partial':
      return <span className={`${base} bg-amber-500/15 text-amber-300`}><AlertTriangle className="w-3 h-3" /> 一部失敗 {okCount}/{total}</span>;
    case 'failed':
      return <span className={`${base} bg-rose-500/15 text-rose-300`}><XCircle className="w-3 h-3" /> 送信失敗</span>;
    default:
      return <span className={`${base} bg-slate-700/50 text-slate-400`}>未送信</span>;
  }
}

export default function CircleReportsPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const session = useCircleSession();
  // 一般メンバーは自分が書いた報告書だけ編集・送信・削除できる（APIでも同じ確認をしている）
  const canManage = (r: Report) => !session.isMember || (!!r.author_id && r.author_id === session.discordId);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openResults, setOpenResults] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/reports`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReports(data);
    } catch (e: any) {
      toast.error(`レポートを読み込めませんでした: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadReports();
    fetch(`/api/guilds/${guildId}/circle/settings`)
      .then((r) => r.json())
      .then((s) => setRecipientCount((s.recipient_user_ids || []).length))
      .catch(() => setRecipientCount(null));
  }, [guildId, loadReports]);

  // 送信中のレポートがあるあいだは、Bot の送信結果を待って更新する
  const hasPending = reports.some((r) => r.send_status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(loadReports, 4000);
    return () => clearInterval(t);
  }, [hasPending, loadReports]);

  const openEditor = (report?: Report) => {
    setDraft(
      report
        ? {
            id: report.id,
            title: report.title,
            content: report.content,
            file: null,
            existingPdf: report.pdf_name ? { name: report.pdf_name, size: report.pdf_size } : null,
            removePdf: false,
          }
        : emptyDraft()
    );
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const pickFile = (file: File | undefined | null) => {
    if (!file || !draft) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast.error('PDFファイルを選んでください');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error(`PDFは${MAX_PDF_BYTES / 1024 / 1024}MBまでです（${formatSize(file.size)}）`);
      return;
    }
    setDraft({ ...draft, file, removePdf: false });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error('題名を入力してください');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      if (draft.id) form.append('id', String(draft.id));
      form.append('title', draft.title);
      form.append('content', draft.content);
      if (draft.file) form.append('pdf', draft.file);
      if (draft.removePdf) form.append('remove_pdf', '1');
      const res = await fetch(`/api/guilds/${guildId}/circle/reports`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({ error: res.status === 413 ? 'PDFが大きすぎます' : `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(draft.id ? 'レポートを更新しました' : 'レポートを作成しました');
      setDraft(null);
      await loadReports();
    } catch (e: any) {
      toast.error(`保存できませんでした: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const send = async (report: Report) => {
    if (!recipientCount) {
      toast.error(session.isMember
        ? '送信先がまだ設定されていません。運営に「送信先設定」をお願いしてください'
        : '送信先が設定されていません。「送信先設定」で送る人を選んでください');
      return;
    }
    const again = report.send_status !== 'none' ? '（もう一度送ります）' : '';
    if (!confirm(`「${report.title}」を送信先の ${recipientCount} 人に Discord の DM で送信しますか？${again}`)) return;
    setBusyId(report.id);
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/reports/${report.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('送信を開始しました。Bot が順番に送ります');
      setOpenResults(report.id);
      await loadReports();
    } catch (e: any) {
      toast.error(`送信できませんでした: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (report: Report) => {
    if (!confirm(`「${report.title}」を削除しますか？（元に戻せません）`)) return;
    setBusyId(report.id);
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/reports/${report.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (draft?.id === report.id) setDraft(null);
      toast.success('削除しました');
      await loadReports();
    } catch (e: any) {
      toast.error(`削除できませんでした: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const downloadPdf = async (report: Report) => {
    try {
      const res = await fetch(`/api/guilds/${guildId}/circle/reports/${report.id}/pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = report.pdf_name || 'report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      toast.error(`PDFを取得できませんでした: ${e.message}`);
    }
  };

  const shownPdf = draft?.file
    ? { name: draft.file.name, size: draft.file.size, isNew: true }
    : draft?.existingPdf && !draft.removePdf
      ? { ...draft.existingPdf, isNew: false }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">サークル進捗状況</h1>
          <p className="text-sm text-slate-400 mt-1">
            題名・内容・PDF をまとめた報告書を作り、送信先の人へ Discord で送ります。
          </p>
        </div>
        {!draft && (
          <button
            onClick={() => openEditor()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm px-5 py-2.5 transition-colors"
          >
            <Plus className="w-4 h-4" /> 新しいレポート
          </button>
        )}
      </div>

      {recipientCount === 0 && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {session.isMember ? (
            <span>送信先がまだ設定されていません。報告書は書いて保存できます。送るには運営に「送信先設定」をお願いしてください。</span>
          ) : (
            <span>
              送信先がまだ設定されていません。
              <Link href={`/circle/${guildId}/recipients`} className="underline underline-offset-2 hover:text-white ml-1">送信先設定</Link>
              で受け取る人を選んでください。
            </span>
          )}
        </div>
      )}

      {/* ===== 編集フォーム ===== */}
      {draft && (
        <div ref={editorRef} className="rounded-2xl border border-sky-800/50 bg-slate-900/80 shadow-xl shadow-sky-950/30 p-5 md:p-6 scroll-mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold flex items-center gap-2">
              <Pencil className="w-4 h-4 text-sky-400" />
              {draft.id ? 'レポートを編集' : '新しいレポート'}
            </h2>
            <button onClick={() => setDraft(null)} aria-label="閉じる" className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">題名 <span className="text-rose-400">*</span></label>
              <input
                type="text"
                value={draft.title}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="例: 11月の活動報告"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none px-3 py-2.5 text-[16px] md:text-sm placeholder:text-slate-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-semibold">内容</label>
                <span className={`text-[11px] ${draft.content.length > MAX_CONTENT ? 'text-rose-400' : 'text-slate-500'}`}>
                  {draft.content.length} / {MAX_CONTENT}
                </span>
              </div>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={10}
                placeholder={'今月の活動内容、参加人数、今後の予定などを書いてください。'}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-sky-500 focus:outline-none px-3 py-2.5 text-[16px] md:text-sm leading-relaxed placeholder:text-slate-600 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5">PDF（任意・{MAX_PDF_BYTES / 1024 / 1024}MBまで）</label>
              {shownPdf ? (
                <div className="flex items-center gap-3 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5">
                  <div className="w-9 h-9 rounded-md bg-rose-500/15 text-rose-300 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{shownPdf.name}</div>
                    <div className="text-[11px] text-slate-500">{formatSize(shownPdf.size)}{shownPdf.isNew ? '・保存すると添付されます' : ''}</div>
                  </div>
                  <button
                    onClick={() => fileInput.current?.click()}
                    className="text-xs text-sky-300 hover:text-white rounded-md px-2 py-1.5 hover:bg-slate-800"
                  >
                    差し替え
                  </button>
                  <button
                    onClick={() => setDraft({ ...draft, file: null, removePdf: !!draft.existingPdf })}
                    aria-label="PDFを外す"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-300 hover:bg-slate-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                  className={`w-full rounded-lg border-2 border-dashed px-4 py-7 flex flex-col items-center gap-2 text-sm transition-colors ${
                    dragOver ? 'border-sky-400 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-400 hover:border-sky-600 hover:text-slate-200'
                  }`}
                >
                  <FileUp className="w-6 h-6" />
                  クリックして PDF を選ぶ / ここにドラッグ
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-slate-700 hover:bg-slate-800 text-sm px-5 py-2.5 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || draft.content.length > MAX_CONTENT}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm px-5 py-2.5 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== レポート一覧 ===== */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" /> 読み込み中...
        </div>
      ) : reports.length === 0 ? (
        !draft && (
          <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center">
            <FileText className="w-10 h-10 mx-auto text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">まだレポートがありません</p>
            <button onClick={() => openEditor()} className="mt-4 text-sm text-sky-300 hover:text-white underline underline-offset-4">
              最初のレポートを作る
            </button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <article key={r.id} className={`rounded-2xl border bg-slate-900/60 p-5 transition-colors ${draft?.id === r.id ? 'border-sky-600/60' : 'border-slate-800 hover:border-slate-700'}`}>
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-bold text-base break-words">{r.title}</h3>
                    <StatusBadge report={r} />
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> 作成 {formatDate(r.created_at)}</span>
                    {r.author_name && <span>作成者 {r.author_name}</span>}
                    {r.last_sent_at && <span>最終送信 {formatDate(r.last_sent_at)}</span>}
                  </div>
                  {r.content && (
                    <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap break-words line-clamp-4">{r.content}</p>
                  )}
                  {r.pdf_name && (
                    <button
                      onClick={() => downloadPdf(r)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-700 hover:border-sky-600 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors max-w-full"
                    >
                      <Paperclip className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{r.pdf_name}</span>
                      <span className="text-slate-500 flex-shrink-0">{formatSize(r.pdf_size)}</span>
                      <Download className="w-3.5 h-3.5 flex-shrink-0" />
                    </button>
                  )}
                </div>

                {canManage(r) && (
                <div className="flex md:flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => send(r)}
                    disabled={busyId === r.id || r.send_status === 'pending'}
                    className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs px-4 py-2 transition-colors"
                  >
                    {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {r.send_status === 'none' ? '送信' : '再送信'}
                  </button>
                  <button
                    onClick={() => openEditor(r)}
                    className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs px-4 py-2 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> 編集
                  </button>
                  <button
                    onClick={() => remove(r)}
                    disabled={busyId === r.id}
                    className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 hover:border-rose-700 hover:bg-rose-950/40 hover:text-rose-200 text-xs px-4 py-2 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 削除
                  </button>
                </div>
                )}
              </div>

              {r.send_results.length > 0 && (
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <button
                    onClick={() => setOpenResults(openResults === r.id ? null : r.id)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    {openResults === r.id ? '▼' : '▶'} 送信結果（{r.send_results.filter((x) => x.ok).length}/{r.send_results.length}人に届きました）
                  </button>
                  {openResults === r.id && (
                    <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {r.send_results.map((x) => (
                        <li key={x.user_id} className="flex items-start gap-2 rounded-md bg-slate-950/70 px-3 py-2 text-xs">
                          {x.ok
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                            : <XCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />}
                          <div className="min-w-0">
                            <div className="truncate">{x.name || x.user_id}</div>
                            {!x.ok && x.error && <div className="text-rose-300/80">{x.error}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
