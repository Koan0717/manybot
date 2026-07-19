import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const SETTING_KEYS = [
  'GAMBLE_MAX_PLAYS',
  'GAMBLE_DAILY_LIMIT',
  'GAMBLE_MAX_BET',
  'GAMBLE_TAX_ENABLED',
  'GAMBLE_TAX_RATE',
  'GAMBLE_CHINCHIRO_RATE_PINZORO',
  'GAMBLE_CHINCHIRO_RATE_ARASHI',
  'GAMBLE_CHINCHIRO_RATE_SHIGORO',
  'GAMBLE_CHINCHIRO_RATE_NORMAL_WIN',
  'GAMBLE_CHINCHIRO_RATE_HIFUMI',
  'GAMBLE_CHINCHIRO_RATE_LOSE',
  'GAMBLE_CHINCHIRO_MUL_PINZORO',
  'GAMBLE_CHINCHIRO_MUL_ARASHI',
  'GAMBLE_CHINCHIRO_MUL_SHIGORO',
  'GAMBLE_CHINCHIRO_MUL_HIFUMI',
  'GAMBLE_CHINCHIRO_MUL_NORMAL',
  'GAMBLE_COINFLIP_RATE_WIN',
  'GAMBLE_COINFLIP_RATE_LOSE',
  'GAMBLE_COINFLIP_MUL',
  'GAMBLE_SLOT_RATE_7',
  'GAMBLE_SLOT_RATE_STAR',
  'GAMBLE_SLOT_RATE_THREE',
  'GAMBLE_SLOT_RATE_TWO',
  'GAMBLE_SLOT_MUL_7',
  'GAMBLE_SLOT_MUL_STAR',
  'GAMBLE_SLOT_MUL_THREE',
  'GAMBLE_SLOT_MUL_TWO',
  'GAMBLE_BLACKJACK_RATE_NORMAL_WIN',
  'GAMBLE_BLACKJACK_RATE_BJ_WIN',
  'GAMBLE_BLACKJACK_RATE_DRAW',
  'GAMBLE_BLACKJACK_RATE_LOSE',
  'GAMBLE_BLACKJACK_MUL_NORMAL',
  'GAMBLE_BLACKJACK_MUL_BJ',
  'GAMBLE_ROULETTE_WIN_RATE_2X',
  'GAMBLE_ROULETTE_WIN_RATE_3X',
  'GAMBLE_ROULETTE_WIN_RATE_36X',
  'GAMBLE_ROULETTE_MUL_2X',
  'GAMBLE_ROULETTE_MUL_3X',
  'GAMBLE_ROULETTE_MUL_36X'
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
      // Parse values according to expected types
      const val = row.setting_value;
      if (val === 'true' || val === 'false') {
        settings[row.setting_key] = val === 'true';
      } else if (!isNaN(Number(val))) {
        settings[row.setting_key] = Number(val);
      } else {
        settings[row.setting_key] = val;
      }
    });

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Failed to fetch gambling settings:', error);
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
          await client.query(`
            INSERT INTO bot_settings (guild_id, setting_key, setting_value)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, setting_key) 
            DO UPDATE SET setting_value = EXCLUDED.setting_value
          `, [guildId, key, String(body[key])]);
        }
      }

      // ボットのキャッシュ再読み込みをリクエスト（IPC経由）
      await client.query(`
        INSERT INTO panel_requests (guild_id, channel_id, panel_type)
        VALUES ($1, 0, 'reload_bot_settings')
      `, [guildId]);

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Failed to save gambling settings:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
