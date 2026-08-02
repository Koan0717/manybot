import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const ROOM_TYPES = [
  { key: 'inn', label: '一般宿' },
  { key: 'luxury_inn', label: '高級宿' },
  { key: 'gambling_vc', label: '賭博VC' },
  { key: 'game_vc', label: 'ゲームVC' },
  { key: 'custom_vc', label: 'カスタムVC' },
];

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    const keys = ROOM_TYPES.map(r => `ROOM_ACCESS_LOW_EVAL_${r.key}`);
    const result = await pool.query(
      `SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = ANY($2)`,
      [guildId, keys]
    );

    const settings: Record<string, boolean> = {};
    // デフォルトは全部 true（許可）
    for (const rt of ROOM_TYPES) {
      settings[rt.key] = true;
    }
    for (const row of result.rows) {
      const key = row.setting_key.replace('ROOM_ACCESS_LOW_EVAL_', '');
      try {
        settings[key] = JSON.parse(row.setting_value);
      } catch {
        settings[key] = row.setting_value === 'true';
      }
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('[room-access] GET error:', error);
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
    const body = await request.json();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const rt of ROOM_TYPES) {
        const val = body[rt.key];
        if (val === undefined) continue;
        const settingKey = `ROOM_ACCESS_LOW_EVAL_${rt.key}`;
        await client.query(
          `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
          [guildId, settingKey, JSON.stringify(Boolean(val))]
        );
      }

      // Botのキャッシュ再読み込みをリクエスト
      await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_bot_settings')`,
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
    console.error('[room-access] POST error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
