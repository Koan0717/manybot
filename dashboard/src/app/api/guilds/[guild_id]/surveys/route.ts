import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureSurveySchema } from '@/lib/migrations';
import { toSurveyJson } from '@/lib/survey';

const QUESTION_TYPES = ['single', 'multi', 'text'] as const;
const MAX_QUESTIONS = 25;
const MAX_OPTIONS = 25;

const cleanQuestions = (raw: any): { questions: any[]; error?: string } => {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_QUESTIONS) : [];
  const questions: any[] = [];
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || !QUESTION_TYPES.includes(q.type)) continue;
    const title = String(q.title || '').trim().slice(0, 200);
    if (!title) return { questions, error: `Q${i + 1} の質問文を入力してください` };
    const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(q.id || '')) ? String(q.id) : `q${Date.now().toString(36)}${i}`;
    const question: any = {
      id,
      type: q.type,
      title,
      description: String(q.description || '').trim().slice(0, 500),
      required: !!q.required,
    };
    if (q.type !== 'text') {
      const options = Array.from(new Set(
        (Array.isArray(q.options) ? q.options : []).map((o: any) => String(o || '').trim().slice(0, 100)).filter(Boolean)
      )).slice(0, MAX_OPTIONS);
      if (options.length < 2) return { questions, error: `Q${i + 1} の選択肢を2つ以上入力してください` };
      question.options = options;
    }
    questions.push(question);
  }
  return { questions };
};

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureSurveySchema(pool);
    const res = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id) AS response_count
       FROM surveys s WHERE s.guild_id = $1 ORDER BY s.id DESC`,
      [guildId]
    );
    return NextResponse.json(res.rows.map(r => toSurveyJson(r, Number(r.response_count) || 0)));
  } catch (error: any) {
    console.error('Surveys GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/** アンケートの作成（id なし）または更新（id あり） */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureSurveySchema(pool);
    const body = await request.json();

    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: 'タイトルを入力してください' }, { status: 400 });
    const description = String(body.description || '').slice(0, 2000);
    const { questions, error } = cleanQuestions(body.questions);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (questions.length === 0) return NextResponse.json({ error: '質問を1つ以上追加してください' }, { status: 400 });
    const is_anonymous = !!body.is_anonymous;
    const allow_edit = body.allow_edit !== false;
    const is_open = body.is_open !== false;
    const closesAt = body.closes_at ? new Date(body.closes_at) : null;
    const closes_at = closesAt && !isNaN(closesAt.getTime()) ? closesAt.toISOString() : null;
    const button_label = String(body.button_label || '').trim().slice(0, 80) || '回答する';

    const id = Number(body.id) || null;
    let row: any;
    let syncRequestId: number | null = null;
    if (id) {
      const res = await pool.query(
        `UPDATE surveys SET title = $3, description = $4, questions = $5::jsonb, is_anonymous = $6, allow_edit = $7,
           is_open = $8, closes_at = $9, button_label = $10
         WHERE id = $1 AND guild_id = $2 RETURNING *`,
        [id, guildId, title, description, JSON.stringify(questions), is_anonymous, allow_edit, is_open, closes_at, button_label]
      );
      if (res.rows.length === 0) return NextResponse.json({ error: 'アンケートが見つかりません' }, { status: 404 });
      row = res.rows[0];
      // 投稿済みのパネルがあれば、受付状態や締切の表示を更新してもらう
      if (row.message_id) {
        const req = await pool.query(
          `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, 0, 'refresh_survey', $2) RETURNING id`,
          [guildId, id]
        );
        syncRequestId = req.rows[0]?.id ?? null;
      }
    } else {
      const res = await pool.query(
        `INSERT INTO surveys (guild_id, title, description, questions, is_anonymous, allow_edit, is_open, closes_at, button_label)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) RETURNING *`,
        [guildId, title, description, JSON.stringify(questions), is_anonymous, allow_edit, is_open, closes_at, button_label]
      );
      row = res.rows[0];
    }
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM survey_responses WHERE survey_id = $1', [row.id]);
    return NextResponse.json({ success: true, survey: toSurveyJson(row, Number(countRes.rows[0]?.c) || 0), sync_request_id: syncRequestId });
  } catch (error: any) {
    console.error('Surveys POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
