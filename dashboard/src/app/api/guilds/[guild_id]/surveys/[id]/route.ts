import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureSurveySchema } from '@/lib/migrations';
import { toSurveyJson } from '@/lib/survey';

type Params = { params: { guild_id: string; id: string } };

/** アンケートの内容と回答一覧（匿名の場合は回答者を伏せる） */
export async function GET(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureSurveySchema(pool);
    const res = await pool.query('SELECT * FROM surveys WHERE id = $1 AND guild_id = $2', [id, guildId]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'アンケートが見つかりません' }, { status: 404 });
    const survey = res.rows[0];
    const respRes = await pool.query(
      'SELECT id, user_id, user_name, answers, created_at, updated_at FROM survey_responses WHERE survey_id = $1 ORDER BY created_at ASC',
      [id]
    );
    const anonymous = survey.is_anonymous === true;
    const responses = respRes.rows.map((r, i) => ({
      id: r.id,
      user_id: anonymous ? null : String(r.user_id),
      user_name: anonymous ? `回答者${i + 1}` : (r.user_name || String(r.user_id)),
      answers: r.answers && typeof r.answers === 'object' ? r.answers : {},
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }));
    return NextResponse.json({ survey: toSurveyJson(survey, responses.length), responses });
  } catch (error: any) {
    console.error('Survey GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Discord への投稿。
 * action: 'post_panel'（回答パネルを投稿） / 'post_results'（集計結果を投稿） / 'clear_responses'（回答を全削除）
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureSurveySchema(pool);
    const body = await request.json();
    const exists = await pool.query('SELECT id, message_id FROM surveys WHERE id = $1 AND guild_id = $2', [id, guildId]);
    if (exists.rows.length === 0) return NextResponse.json({ error: 'アンケートが見つかりません' }, { status: 404 });

    if (body.action === 'clear_responses') {
      await pool.query('DELETE FROM survey_responses WHERE survey_id = $1', [id]);
      return NextResponse.json({ success: true });
    }

    const panelType = body.action === 'post_results' ? 'survey_results' : body.action === 'post_panel' ? 'survey' : null;
    if (!panelType) return NextResponse.json({ error: '不明な操作です' }, { status: 400 });
    const channelId = String(body.channel_id || '');
    if (!/^\d{6,}$/.test(channelId)) {
      return NextResponse.json({ error: '送信先チャンネルを選択してください' }, { status: 400 });
    }
    const req = await pool.query(
      `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [guildId, channelId, panelType, id]
    );
    return NextResponse.json({ success: true, sync_request_id: req.rows[0]?.id ?? null });
  } catch (error: any) {
    console.error('Survey POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const guildId = params.guild_id;
    const id = Number(params.id);
    const pool = await getPool(guildId);
    await ensureSurveySchema(pool);
    const res = await pool.query('DELETE FROM surveys WHERE id = $1 AND guild_id = $2 RETURNING id', [id, guildId]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'アンケートが見つかりません' }, { status: 404 });
    await pool.query('DELETE FROM survey_responses WHERE survey_id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Survey DELETE error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
