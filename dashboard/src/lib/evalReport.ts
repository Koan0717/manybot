/** 評価シート記入パネル（eval_report_sheets）の共通定義。Bot側 cogs/eval_report.py と範囲・既定値をそろえる */

export const MAX_ITEMS = 20;
// 各項目の段階の数（「保留」と 1〜N）。0 は段階なし
export const DEFAULT_RATING_SCALE = 5;
export const MIN_RATING_SCALE = 2;
export const MAX_RATING_SCALE = 10;
export const DEFAULT_SHEET_NAME = '評価シート';
export const DEFAULT_PANEL_TITLE = '📋 評価シート';
export const DEFAULT_PANEL_DESCRIPTION = '評価員は下のボタンから仮メンの評価シートを記入できます。';
export const DEFAULT_BUTTON_LABEL = '評価シートを書く';

export type EvalReportItem = { id: string; label: string; placeholder: string; required: boolean };
export type EvalReportSheet = {
  id: number | null; // 未保存の新しいシートは null
  name: string;
  items: EvalReportItem[];
  output_channel_id: string;
  panel_title: string;
  panel_description: string;
  button_label: string;
  rating_scale: number;
};

export const newSheetDraft = (name = DEFAULT_SHEET_NAME): EvalReportSheet => ({
  id: null,
  name,
  items: [
    { id: 'voice', label: '声', placeholder: '', required: true },
    { id: 'communication', label: 'コミュニケーション', placeholder: '', required: true },
    { id: 'server_understanding', label: 'サーバー理解度', placeholder: '', required: true },
  ],
  output_channel_id: '',
  panel_title: DEFAULT_PANEL_TITLE,
  panel_description: DEFAULT_PANEL_DESCRIPTION,
  button_label: DEFAULT_BUTTON_LABEL,
  rating_scale: DEFAULT_RATING_SCALE,
});

export const clampScale = (v: any) => {
  if (v === null || v === undefined || v === '') return DEFAULT_RATING_SCALE;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_RATING_SCALE;
  if (n <= 0) return 0;
  return Math.min(MAX_RATING_SCALE, Math.max(MIN_RATING_SCALE, n));
};

export const cleanItems = (raw: any): { items: EvalReportItem[]; error?: string } => {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : [];
  const items: EvalReportItem[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    // Discord のモーダルの入力欄ラベルは45文字まで
    const label = String(it?.label || '').trim().slice(0, 45);
    if (!label) return { items, error: `項目${i + 1} の名前を入力してください` };
    let id = /^[A-Za-z0-9_-]{1,40}$/.test(String(it?.id || '')) ? String(it.id) : `i${Date.now().toString(36)}${i}`;
    if (usedIds.has(id)) id = `${id}_${i}`;
    usedIds.add(id);
    items.push({ id, label, placeholder: String(it?.placeholder || '').trim().slice(0, 100), required: it?.required !== false });
  }
  return { items };
};

/** eval_report_sheets の行をダッシュボード向けの JSON に変換する */
export const toSheetJson = (row: any): EvalReportSheet => ({
  id: row.id,
  name: row.name || DEFAULT_SHEET_NAME,
  // required が無い古い項目は必須として扱う
  items: (Array.isArray(row.items) ? row.items : []).map((it: any) => ({ ...it, required: it?.required !== false })),
  output_channel_id: row.output_channel_id ? String(row.output_channel_id) : '',
  panel_title: row.panel_title || DEFAULT_PANEL_TITLE,
  panel_description: row.panel_description || DEFAULT_PANEL_DESCRIPTION,
  button_label: row.button_label || DEFAULT_BUTTON_LABEL,
  rating_scale: clampScale(row.rating_scale),
});
