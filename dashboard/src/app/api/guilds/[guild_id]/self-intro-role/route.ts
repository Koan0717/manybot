import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

async function ensureTable(pool: any) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS self_intro_role_settings (
        guild_id            BIGINT PRIMARY KEY,
        channel_id          BIGINT,
        welcome_channel_id  BIGINT,
        role_id             BIGINT,
        template            TEXT,
        is_enabled          BOOLEAN DEFAULT TRUE
      )
    `);
    // 自己紹介チャンネルを複数設定できるようにする（channel_id は1つ目のチャンネル。古いBotのために残す）
    await pool.query("ALTER TABLE self_intro_role_settings ADD COLUMN IF NOT EXISTS channel_ids BIGINT[] DEFAULT '{}'");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS self_intro_welcome_messages (
        guild_id    BIGINT,
        user_id     BIGINT,
        message_id  BIGINT,
        channel_id  BIGINT,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
  } catch (e: any) {
    console.error('[self-intro-role] ensureTable error:', e);
  }
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureTable(pool);
    const result = await pool.query(
      'SELECT channel_id, channel_ids::text[] AS channel_ids, welcome_channel_id, role_id, template, is_enabled FROM self_intro_role_settings WHERE guild_id = $1::bigint',
      [guildId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ channel_id: null, channel_ids: [], welcome_channel_id: null, role_id: null, template: '', is_enabled: false });
    }
    const row = result.rows[0];
    // 複数設定が無い（以前の設定）なら、1つだけの channel_id を使う
    const channelIds: string[] = row.channel_ids?.length ? row.channel_ids : row.channel_id ? [String(row.channel_id)] : [];
    return NextResponse.json({
      channel_id: channelIds[0] ?? null,
      channel_ids: channelIds,
      welcome_channel_id: row.welcome_channel_id ? String(row.welcome_channel_id) : null,
      role_id: row.role_id ? String(row.role_id) : null,
      template: row.template || '',
      is_enabled: row.is_enabled ?? false,
    });
  } catch (error: any) {
    console.error('[self-intro-role] GET error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureTable(pool);
    const body = await request.json();
    const { channel_id, welcome_channel_id, role_id, template, is_enabled } = body;
    const channelIds: string[] = Array.from(
      new Set(
        (Array.isArray(body.channel_ids) ? body.channel_ids : channel_id ? [channel_id] : [])
          .map((id: unknown) => String(id))
          .filter((id: string) => /^\d{15,25}$/.test(id))
      )
    );

    const sql = `
      INSERT INTO self_intro_role_settings (guild_id, channel_id, channel_ids, welcome_channel_id, role_id, template, is_enabled)
      VALUES ($1::bigint, $2::bigint, $7::bigint[], $3::bigint, $4::bigint, $5, $6)
      ON CONFLICT (guild_id) DO UPDATE
      SET channel_id = EXCLUDED.channel_id,
          channel_ids = EXCLUDED.channel_ids,
          welcome_channel_id = EXCLUDED.welcome_channel_id,
          role_id = EXCLUDED.role_id,
          template = EXCLUDED.template,
          is_enabled = EXCLUDED.is_enabled
    `;

    await pool.query(sql, [
      guildId,
      channelIds[0] ?? null,
      welcome_channel_id ? String(welcome_channel_id) : null,
      role_id ? String(role_id) : null,
      template || '',
      Boolean(is_enabled),
      channelIds,
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[self-intro-role] POST error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
