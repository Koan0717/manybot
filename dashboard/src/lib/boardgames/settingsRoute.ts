import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * 管理ダッシュボードの「ゲーム設定」（オセロ・チェス・将棋）の保存と、Discord パネル送信。
 * 設定キーは OTHELLO_ / CHESS_ / SHOGI_ で始まる同じ8項目。
 */
const KEYS = ['BET_ENABLED', 'DEFAULT_BET', 'SHOW_STATS', 'PANEL_CHANNEL', 'AUTO_VC_ENABLED', 'VC_CATEGORY_ID', 'VC_NAME', 'GAME_CHANNEL'];

export function boardGameSettingsHandlers(game: 'othello' | 'chess' | 'shogi') {
  const prefix = game.toUpperCase();
  const settingKeys = KEYS.map((k) => `${prefix}_${k}`);

  async function GET(request: Request, { params }: { params: { guild_id: string } }) {
    const guildId = params.guild_id;
    try {
      const pool = await getPool(guildId);
      const res = await pool.query('SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = ANY($2)', [
        guildId,
        settingKeys,
      ]);
      const settings: Record<string, any> = {};
      for (const row of res.rows) {
        const val = row.setting_value;
        if (val === 'true' || val === 'false') settings[row.setting_key] = val === 'true';
        else if (!isNaN(Number(val)) && val !== '' && !/^\d{15,}$/.test(String(val))) settings[row.setting_key] = Number(val);
        else settings[row.setting_key] = val;
      }
      return NextResponse.json(settings);
    } catch (error: any) {
      console.error(`Failed to fetch ${game} settings:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  async function POST(request: Request, { params }: { params: { guild_id: string } }) {
    const guildId = params.guild_id;
    try {
      const pool = await getPool(guildId);
      const body = await request.json();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const key of settingKeys) {
          if (body[key] !== undefined) {
            await client.query(
              'INSERT INTO bot_settings (guild_id, setting_key, setting_value) VALUES ($1, $2, $3) ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value',
              [guildId, key, String(body[key])]
            );
          }
        }
        // Bot の設定キャッシュを読み直してもらう
        await client.query("INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_othello_settings')", [guildId]);
        await client.query('COMMIT');
        return NextResponse.json({ success: true });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error(`Failed to save ${game} settings:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  async function PANEL(request: Request, { params }: { params: { guild_id: string } }) {
    const guildId = params.guild_id;
    try {
      const pool = await getPool(guildId);
      const res = await pool.query('SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2', [guildId, `${prefix}_PANEL_CHANNEL`]);
      const channelId = res.rows[0]?.setting_value;
      if (!channelId || channelId === '0') return NextResponse.json({ error: 'パネル設置チャンネルが設定されていません' }, { status: 400 });
      await pool.query('INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, $3)', [guildId, channelId, game]);
      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error(`Failed to send ${game} panel:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return { GET, POST, PANEL };
}
