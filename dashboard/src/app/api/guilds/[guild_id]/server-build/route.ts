import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ROLE_SETTINGS } from '@/lib/roleSettings';
import { SERVER_BUILD_CATEGORIES } from '@/lib/serverBuild';

// Bot 側（bot/server_template.py）と同じキー
const TEMPLATE_KEY = 'SERVER_BUILD_TEMPLATE';
const PENDING_KEY = 'SERVER_BUILD_PENDING';
const STATUS_KEY = 'SERVER_BUILD_STATUS';
// Bot が書くテンプレート一覧（組み込み＋保存したテンプレートの中身）
const CATALOG_KEY = 'SERVER_TEMPLATE_CATALOG';
// この時間を過ぎても「作成中」のままなら Bot の再起動などで止まったとみなし、もう一度作成できるようにする
const STALE_MS = 20 * 60 * 1000;

async function readSetting(pool: any, guildId: string, key: string) {
  const res = await pool.query(
    'SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2',
    [guildId, key]
  );
  if (res.rows.length === 0) return null;
  try {
    return JSON.parse(res.rows[0].setting_value);
  } catch {
    return null;
  }
}

async function writeSetting(client: any, guildId: string, key: string, value: unknown) {
  await client.query(
    `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, setting_key)
     DO UPDATE SET setting_value = $3`,
    [guildId, key, JSON.stringify(value)]
  );
}

function isBusy(status: any): boolean {
  if (!status || (status.state !== 'queued' && status.state !== 'running')) return false;
  const since = Date.parse(status.started_at || status.requested_at || '');
  return !isNaN(since) && Date.now() - since < STALE_MS;
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    let template = null;
    let status = null;
    let catalog = null;
    try {
      template = await readSetting(pool, guildId, TEMPLATE_KEY);
      status = await readSetting(pool, guildId, STATUS_KEY);
      catalog = await readSetting(pool, guildId, CATALOG_KEY);
    } catch {
      // bot_settings がまだ無い（Bot 未起動の新規サーバー）
    }
    return NextResponse.json({ template, status, catalog });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const body = await request.json();
    const action = body?.action;
    // 「サーバー作成」か「テンプレ保存」のどちらかを必ず選ぶ
    if (action !== 'build' && action !== 'save') {
      return NextResponse.json({ error: '「サーバー作成」か「テンプレ保存」のどちらかを選んでください' }, { status: 400 });
    }

    const input = body?.template || {};
    const roles: Record<string, string> = {};
    for (const s of ROLE_SETTINGS) {
      const name = typeof input.roles?.[s.key] === 'string' ? input.roles[s.key].trim().slice(0, 100) : '';
      if (name) roles[s.key] = name;
    }
    if (Object.keys(roles).length === 0) {
      return NextResponse.json({ error: 'ロール名を1つ以上入力してください' }, { status: 400 });
    }
    const knownCategories = new Set(SERVER_BUILD_CATEGORIES.map(c => c.id));
    const categories: string[] = Array.isArray(input.categories)
      ? input.categories.filter((c: unknown) => typeof c === 'string' && knownCategories.has(c))
      : SERVER_BUILD_CATEGORIES.map(c => c.id);
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 50) : '';
    const template = { name, roles, categories, updated_at: new Date().toISOString() };

    const pool = await getPool(guildId);
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

    if (action === 'save') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await writeSetting(client, guildId, TEMPLATE_KEY, template);
        // テンプレート一覧（中身の表示）を Bot に作り直してもらう
        await client.query(
          `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_server_templates')`,
          [guildId]
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return NextResponse.json({ success: true, action, template });
    }

    if (isBusy(await readSetting(pool, guildId, STATUS_KEY))) {
      return NextResponse.json({ error: '現在サーバーを作成中です。完了するまでお待ちください' }, { status: 409 });
    }

    const applySettings = body?.apply_settings !== false;
    const syncPermissions = body?.sync_permissions === true;
    const status = { state: 'queued', requested_at: new Date().toISOString(), name, message: 'Bot の処理を待っています…' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeSetting(client, guildId, PENDING_KEY, template);
      await writeSetting(client, guildId, STATUS_KEY, status);
      await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, $2)`,
        [guildId, `build_server_custom:${applySettings ? 1 : 0}:${syncPermissions ? 1 : 0}`]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true, action, status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
