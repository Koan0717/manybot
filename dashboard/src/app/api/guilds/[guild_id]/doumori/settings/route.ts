import { NextResponse } from 'next/server';
import { getDoumoriPool, errorStatus } from '@/lib/doumori/db';
import { DEFAULT_SETTINGS } from '@/lib/doumori/settings';
import { fetchGuildChannels, fetchGuildRoles } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

type Ctx = { params: { guild_id: string } };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const guildId = params.guild_id;
    const pool = getDoumoriPool();
    const settingsRows = await pool
      .query('SELECT setting_key, setting_value FROM doumori_settings WHERE guild_id = $1', [guildId])
      .then((res) => res.rows)
      .catch(() => []);

    const customSettings: Record<string, any> = {};
    for (const r of settingsRows) {
      try {
        customSettings[r.setting_key] = JSON.parse(r.setting_value);
      } catch {
        customSettings[r.setting_key] = r.setting_value;
      }
    }

    const [channels, roles] = await Promise.all([fetchGuildChannels(guildId), fetchGuildRoles(guildId)]);

    return NextResponse.json({
      settings: { ...DEFAULT_SETTINGS, ...customSettings },
      channels,
      roles,
    });
  } catch (error: any) {
    console.error('GET doumori/settings error:', error);
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const guildId = params.guild_id;
    const pool = getDoumoriPool();
    const { settings } = await request.json();
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: '設定データが不正です' }, { status: 400 });
    }

    for (const [key, value] of Object.entries(settings)) {
      // 既定値に無いキーは保存しない（任意のキーを書き込ませない）
      if (!(key in DEFAULT_SETTINGS)) continue;
      const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await pool.query(
        `INSERT INTO doumori_settings (guild_id, setting_key, setting_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, setting_key)
         DO UPDATE SET setting_value = $3`,
        [guildId, key, strVal]
      );
    }

    return NextResponse.json({ success: true, message: '設定を保存しました！' });
  } catch (error: any) {
    console.error('POST doumori/settings error:', error);
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}
