import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureEvalReportSchema } from '@/lib/migrations';

const MAX_ITEMS = 20;
const DEFAULT_ITEMS = [
  { id: 'voice', label: '声', placeholder: '' },
  { id: 'communication', label: 'コミュニケーション', placeholder: '' },
  { id: 'server_understanding', label: 'サーバー理解度', placeholder: '' },
];
const DEFAULT_PANEL_TITLE = '📋 評価シート';
const DEFAULT_PANEL_DESCRIPTION = '評価員は下のボタンから仮メンの評価シートを記入できます。';
const DEFAULT_BUTTON_LABEL = '評価シートを書く';

const cleanItems = (raw: any): { items: any[]; error?: string } => {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : [];
  const items: any[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    // Discord のモーダルの入力欄ラベルは45文字まで
    const label = String(it?.label || '').trim().slice(0, 45);
    if (!label) return { items, error: `項目${i + 1} の名前を入力してください` };
    let id = /^[A-Za-z0-9_-]{1,40}$/.test(String(it?.id || '')) ? String(it.id) : `i${Date.now().toString(36)}${i}`;
    if (usedIds.has(id)) id = `${id}_${i}`;
    usedIds.add(id);
    items.push({ id, label, placeholder: String(it?.placeholder || '').trim().slice(0, 100) });
  }
  return { items };
};

const toJson = (row: any) => ({
  items: row ? (Array.isArray(row.items) ? row.items : []) : DEFAULT_ITEMS,
  output_channel_id: row?.output_channel_id ? String(row.output_channel_id) : '',
  panel_title: row?.panel_title || DEFAULT_PANEL_TITLE,
  panel_description: row?.panel_description || DEFAULT_PANEL_DESCRIPTION,
  button_label: row?.button_label || DEFAULT_BUTTON_LABEL,
});

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const res = await pool.query('SELECT * FROM eval_report_settings WHERE guild_id = $1', [guildId]);
    return NextResponse.json(toJson(res.rows[0]));
  } catch (error: any) {
    console.error('Eval report GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * action: 'save'（設定を保存） / 'post_panel'（記入パネルを指定チャンネルに投稿）
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureEvalReportSchema(pool);
    const body = await request.json();

    if (body.action === 'post_panel') {
      const channelId = String(body.channel_id || '');
      if (!/^\d{6,}$/.test(channelId)) {
        return NextResponse.json({ error: 'パネルを設置するチャンネルを選択してください' }, { status: 400 });
      }
      const req = await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, 'eval_report') RETURNING id`,
        [guildId, channelId]
      );
      return NextResponse.json({ success: true, sync_request_id: req.rows[0]?.id ?? null });
    }

    const { items, error } = cleanItems(body.items);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (items.length === 0) return NextResponse.json({ error: '評価項目を1つ以上追加してください' }, { status: 400 });
    const outputChannelId = /^\d{6,}$/.test(String(body.output_channel_id || '')) ? String(body.output_channel_id) : null;
    const panelTitle = String(body.panel_title || '').trim().slice(0, 256);
    const panelDescription = String(body.panel_description || '').slice(0, 2000);
    const buttonLabel = String(body.button_label || '').trim().slice(0, 80);

    const res = await pool.query(
      `INSERT INTO eval_report_settings (guild_id, items, output_channel_id, panel_title, panel_description, button_label)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6)
       ON CONFLICT (guild_id) DO UPDATE SET items = $2::jsonb, output_channel_id = $3, panel_title = $4,
         panel_description = $5, button_label = $6
       RETURNING *`,
      [guildId, JSON.stringify(items), outputChannelId, panelTitle, panelDescription, buttonLabel]
    );
    return NextResponse.json({ success: true, settings: toJson(res.rows[0]) });
  } catch (error: any) {
    console.error('Eval report POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
