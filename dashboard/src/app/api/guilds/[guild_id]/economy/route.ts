import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const SETTINGS_KEYS = [
    'CURRENCY_NAME',
    'INITIAL_COINS',
    'MSG_COOLDOWN',
    'TC_XP_REWARD',
    'TC_XP_COOLDOWN',
    'VC_XP_PER_MIN'
];

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    

    const pool = await getPool(guildId);
    
    // Default values
    const data: any = {
      CURRENCY_NAME: 'Rune',
      INITIAL_COINS: 30000,
      MSG_COOLDOWN: 60,
      TC_XP_REWARD: 10,
      TC_XP_COOLDOWN: 10,
      VC_XP_PER_MIN: 15
    };

    const res = await pool.query(
        'SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1',
        [guildId]
    );

    for (const row of res.rows) {
        if (SETTINGS_KEYS.includes(row.setting_key)) {
            // Check if it should be number or string
            if (row.setting_key === 'CURRENCY_NAME') {
                data[row.setting_key] = row.setting_value;
            } else {
                data[row.setting_key] = Number(row.setting_value);
            }
        }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    

    const pool = await getPool(guildId);
    const body = await request.json();

    for (const key of SETTINGS_KEYS) {
        if (body[key] !== undefined) {
            await pool.query(
                'INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, $2, $3) ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
                [guildId, key, String(body[key])]
            );
        }
    }

    // Tell the bot to reload settings via database IPC flag
    const reqResult = await pool.query(
        'INSERT INTO panel_requests (guild_id, channel_id, panel_type, processed) VALUES ($1, $2, $3, false) RETURNING id',
        [guildId, 0, 'reload_bot_settings']
    );

    return NextResponse.json({ success: true, sync_request_id: reqResult.rows[0]?.id ?? null });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
