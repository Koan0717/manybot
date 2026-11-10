/** 評価シート記入パネル（eval_report_sheets）の共通定義。Bot側 cogs/eval_report.py と範囲・既定値をそろえる */

export const MAX_ITEMS = 20;
// 各項目の段階の数（「保留」と 1〜N）。項目ごとに決め、0 は段階なし。
// シートの rating_scale は、scale が無い古い項目の段階数として使う
export const DEFAULT_RATING_SCALE = 5;
export const MIN_RATING_SCALE = 2;
export const MAX_RATING_SCALE = 10;
export const DEFAULT_SHEET_NAME = '評価シート';
export const DEFAULT_PANEL_TITLE = '📋 評価シート';
export const DEFAULT_PANEL_DESCRIPTION = '評価員は下のボタンから仮メンの評価シートを記入できます。';
export const DEFAULT_BUTTON_LABEL = '評価シートを書く';

export type EvalReportItem = { id: string; label: string; placeholder: string; required: boolean; scale: number };
export type EvalReportSheet = {
  id: number | null; // 未保存の新しいシートは null
  name: string;
  items: EvalReportItem[];
  output_channel_id: string;
  panel_title: string;
  panel_description: string;
  button_label: string;
  rating_scale: number; // 古い項目用の既定値
};

export const newSheetDraft = (name = DEFAULT_SHEET_NAME): EvalReportSheet => ({
  id: null,
  name,
  items: [
    { id: 'voice', label: '声', placeholder: '', required: true, scale: DEFAULT_RATING_SCALE },
    { id: 'communication', label: 'コミュニケーション', placeholder: '', required: true, scale: DEFAULT_RATING_SCALE },
    { id: 'server_understanding', label: 'サーバー理解度', placeholder: '', required: true, scale: DEFAULT_RATING_SCALE },
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

export const cleanItems = (raw: any, defaultScale = DEFAULT_RATING_SCALE): { items: EvalReportItem[]; error?: string } => {
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
    items.push({
      id,
      label,
      placeholder: String(it?.placeholder || '').trim().slice(0, 100),
      required: it?.required !== false,
      scale: it?.scale === undefined || it?.scale === null ? defaultScale : clampScale(it.scale),
    });
  }
  return { items };
};

/**
 * Discord のモーダルに置ける部品は5つまで。段階ありの項目は「段階」と「内容」の2つ、段階なしは1つ使うので、
 * 順番を保ったまま5つに収まるだけ詰めて画面を分ける（Bot側 chunk_items と同じ）。記入画面の数を返す。
 */
export const countModals = (items: EvalReportItem[]) => {
  let count = 0;
  let used = 5;
  for (const it of items) {
    const cost = it.scale ? 2 : 1;
    if (used + cost > 5) {
      count++;
      used = 0;
    }
    used += cost;
  }
  return Math.max(1, count);
};

/** eval_report_sheets の行をダッシュボード向けの JSON に変換する */
export const toSheetJson = (row: any): EvalReportSheet => {
  const sheetScale = clampScale(row.rating_scale);
  return {
    id: row.id,
    name: row.name || DEFAULT_SHEET_NAME,
    // required が無い古い項目は必須として扱う。scale が無い古い項目はシートの段階数を使う
    items: (Array.isArray(row.items) ? row.items : []).map((it: any) => ({
      ...it,
      required: it?.required !== false,
      scale: it?.scale === undefined || it?.scale === null ? sheetScale : clampScale(it.scale),
    })),
    output_channel_id: row.output_channel_id ? String(row.output_channel_id) : '',
    panel_title: row.panel_title || DEFAULT_PANEL_TITLE,
    panel_description: row.panel_description || DEFAULT_PANEL_DESCRIPTION,
    button_label: row.button_label || DEFAULT_BUTTON_LABEL,
    rating_scale: sheetScale,
  };
};
