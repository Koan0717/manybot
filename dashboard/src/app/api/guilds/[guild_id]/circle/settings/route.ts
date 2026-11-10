import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureCircleSchema, MAX_RECIPIENTS } from '@/lib/circle';

export const dynamic = 'force-dynamic';

/** サークル名と、進捗レポートの送信先（Discord ユーザーID） */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query(
      'SELECT circle_name, recipient_user_ids::text[] AS recipient_user_ids FROM circle_settings WHERE guild_id = $1',
      [guildId]
    );
    const row = res.rows[0];
    return NextResponse.json({
      circle_name: row?.circle_name || '',
      recipient_user_ids: (row?.recipient_user_ids || []).map(String),
    });
  } catch (error: any) {
    console.error('Circle settings GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const body = await request.json();
    const circleName = String(body.circle_name || '').trim().slice(0, 100);
    const ids: string[] = Array.from(new Set<string>(
      (Array.isArray(body.recipient_user_ids) ? body.recipient_user_ids : [])
        .map((v: any) => String(v))
        .filter((v: string) => /^\d{15,21}$/.test(v))
    ));
    if (ids.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `送信先は${MAX_RECIPIENTS}人までです` }, { status: 400 });
    }
    await pool.query(
      `INSERT INTO circle_settings (guild_id, circle_name, recipient_user_ids, updated_at)
       VALUES ($1, $2, $3::bigint[], NOW())
       ON CONFLICT (guild_id) DO UPDATE SET circle_name = $2, recipient_user_ids = $3::bigint[], updated_at = NOW()`,
      [guildId, circleName, ids]
    );
    return NextResponse.json({ success: true, circle_name: circleName, recipient_user_ids: ids });
  } catch (error: any) {
    console.error('Circle settings POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
