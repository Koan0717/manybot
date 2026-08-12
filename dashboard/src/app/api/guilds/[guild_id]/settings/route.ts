import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';



export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    const result = await pool.query(
      'SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1',
      [guildId]
    );
    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      try {
        let raw = row.setting_value;
        if (typeof raw === 'string' && raw) {
          const trimmed = raw.trim();
          if (/^\d{16,}$/.test(trimmed)) {
            raw = `"${trimmed}"`;
          } else {
            raw = raw.replace(/(:\s*|\[\s*|,\s*|^)(\d{16,})(?=\s*[,\]\}]|$)/g, '$1"$2"');
          }
        }
        settings[row.setting_key] = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        settings[row.setting_key] = row.setting_value;
      }
    }

    try {
      const shopResult = await pool.query('SELECT employee_role_id, manager_role_id FROM shop_settings WHERE guild_id = $1', [guildId]);
      if (shopResult.rows.length > 0) {
        settings['SHOP_EMPLOYEE_ROLE_ID'] = shopResult.rows[0].employee_role_id ? String(shopResult.rows[0].employee_role_id) : shopResult.rows[0].employee_role_id;
        settings['SHOP_MANAGER_ROLE_ID'] = shopResult.rows[0].manager_role_id ? String(shopResult.rows[0].manager_role_id) : shopResult.rows[0].manager_role_id;
      }
    } catch(e) {}

    return NextResponse.json(settings);
  } catch (error: any) {
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

    // テーブルが存在しない場合は自動作成（Botが未起動の新規サーバー対応）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        guild_id BIGINT,
        setting_key TEXT,
        setting_value TEXT,
        PRIMARY KEY (guild_id, setting_key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS panel_requests (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT,
        channel_id BIGINT,
        panel_type TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      let shopEmployee = null;
      let shopManager = null;
      let updateShop = false;

      for (const [key, value] of Object.entries(body)) {
        if (key === 'SHOP_EMPLOYEE_ROLE_ID') {
           shopEmployee = value;
           updateShop = true;
           continue;
        }
        if (key === 'SHOP_MANAGER_ROLE_ID') {
           shopManager = value;
           updateShop = true;
           continue;
        }

        const valueJson = JSON.stringify(value);
        await client.query(
          `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id, setting_key)
           DO UPDATE SET setting_value = $3`,
          [guildId, key, valueJson]
        );
      }
      
      if (updateShop) {
        try {
          const existing = await client.query('SELECT * FROM shop_settings WHERE guild_id = $1', [guildId]);
          if (existing.rows.length > 0) {
             await client.query(
               'UPDATE shop_settings SET employee_role_id = $1, manager_role_id = $2 WHERE guild_id = $3',
               [shopEmployee !== null ? shopEmployee : existing.rows[0].employee_role_id, shopManager !== null ? shopManager : existing.rows[0].manager_role_id, guildId]
             );
          } else {
             await client.query(
               'INSERT INTO shop_settings (guild_id, employee_role_id, manager_role_id, inquiry_mention_role_ids) VALUES ($1, $2, $3, $4)',
               [guildId, shopEmployee, shopManager, '[]']
             );
          }
        } catch(e) {}
      }

      // ボットのキャッシュ再読み込みをリクエスト（IPC経由）
      const reqResult = await client.query(`
        INSERT INTO panel_requests (guild_id, channel_id, panel_type)
        VALUES ($1, 0, 'reload_bot_settings') RETURNING id
      `, [guildId]);

      await client.query('COMMIT');
      return NextResponse.json({ success: true, sync_request_id: reqResult.rows[0]?.id ?? null });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
