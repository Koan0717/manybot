import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const SETTING_KEYS = [
  'OTHELLO_BET_ENABLED',
  'OTHELLO_DEFAULT_BET',
  'OTHELLO_PANEL_CHANNEL',
  'OTHELLO_AUTO_VC_ENABLED',
  'OTHELLO_VC_CATEGORY_ID',
  'OTHELLO_VC_NAME',
  'OTHELLO_GAME_CHANNEL',
];

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const res = await pool.query(
      'SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = ANY($2)',
      [guildId, SETTING_KEYS]
    );

    const settings: Record<string, any> = {};
    res.rows.forEach(row => {
      const val = row.setting_value;
      if (val === 'true' || val === 'false') {
        settings[row.setting_key] = val === 'true';
      } else if (!isNaN(Number(val)) && val !== '') {
        settings[row.setting_key] = Number(val);
      } else {
        settings[row.setting_key] = val;
      }
    });

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Failed to fetch othello settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const body = await request.json();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const key of SETTING_KEYS) {
        if (body[key] !== undefined) {
          await client.query(
            'INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, $2, $3) ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
            [guildId, key, String(body[key])]
          );
        }
      }

      // ボットのオセロ設定キャッシュ再読み込みをリクエスト
      await client.query(
        "INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_othello_settings')",
        [guildId]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Failed to save othello settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
