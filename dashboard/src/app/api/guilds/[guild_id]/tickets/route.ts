import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getPool } from '@/lib/db';

// 保存直後の変更が古いキャッシュで隠れないよう、常に動的に評価する
export const dynamic = 'force-dynamic';

// スキーマ保証済みのプール (プロセス内で1回だけ実行する)
const ensuredPools = new WeakSet<Pool>();

/**
 * テーブル/カラムを保証する。
 * 1チャンネルに複数のパネルを置けるよう、パネルID(id)を付与し、
 * channel_id の一意制約(旧PK・旧ユニークインデックス)を外す。
 */
async function ensureSchema(pool: Pool) {
  if (ensuredPools.has(pool)) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS custom_ticket_panels (
      channel_id BIGINT,
      guild_id BIGINT,
      panel_title TEXT NOT NULL,
      panel_description TEXT NOT NULL,
      button_label TEXT NOT NULL,
      button_emoji TEXT,
      mention_role_ids BIGINT[] NOT NULL,
      target_role_ids BIGINT[] NOT NULL,
      ticket_prefix TEXT NOT NULL,
      panel_type TEXT DEFAULT 'custom_ticket'
    )`,
    `ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS guild_id BIGINT`,
    `ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS id SERIAL`,
    `ALTER TABLE custom_ticket_panels ADD COLUMN IF NOT EXISTS staff_role_ids BIGINT[] DEFAULT '{}'::BIGINT[]`,
    `ALTER TABLE custom_ticket_panels DROP CONSTRAINT IF EXISTS custom_ticket_panels_pkey`,
    `DROP INDEX IF EXISTS idx_custom_ticket_panels_channel_id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_ticket_panels_id ON custom_ticket_panels (id)`,
    `CREATE TABLE IF NOT EXISTS panel_requests (
      id SERIAL PRIMARY KEY,
      guild_id BIGINT,
      channel_id BIGINT,
      panel_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE panel_requests ADD COLUMN IF NOT EXISTS panel_id BIGINT`,
  ];

  let ok = true;
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (e: any) {
      ok = false;
      console.warn('[Tickets] schema ensure warning:', e.message);
    }
  }
  if (ok) ensuredPools.add(pool);
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  const token = process.env.DISCORD_BOT_TOKEN;

  try {
    await ensureSchema(pool);

    // guild_id で紐づくパネルを主軸にする。
    // (guild_id が未記録の旧データ用に、Discordのチャンネル一覧に含まれるものも拾う)
    let channelIds: string[] = [];
    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${token}` },
        cache: 'no-store'
      });
      if (response.ok) {
        const channels = await response.json();
        channelIds = channels.map((c: any) => BigInt(c.id).toString());
      } else {
        console.warn(`[Tickets] Discord API error: ${response.status}`);
      }
    } catch (e: any) {
      console.warn('[Tickets] failed to fetch guild channels:', e.message);
    }

    const result = await pool.query(
      `SELECT id, channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, staff_role_ids, ticket_prefix, panel_type
       FROM custom_ticket_panels
       WHERE guild_id = $1::bigint OR channel_id = ANY($2::bigint[])
       ORDER BY id ASC`,
      [guildId, channelIds]
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    const body = await request.json();
    const { action } = body;

    if (action === 'save') {
      const panel = body.panel || body;
      const { panel_id, channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, staff_role_ids, ticket_prefix, panel_type } = panel;

      if (!channel_id) {
        return NextResponse.json({ error: 'channel_id is required' }, { status: 400 });
      }

      await ensureSchema(pool);

      const values = [
        panel_title,
        panel_description,
        button_label || 'チケット作成',
        button_emoji || '',
        mention_role_ids || [],
        target_role_ids || [],
        ticket_prefix || 'ticket',
        panel_type || 'custom_ticket',
        staff_role_ids || [],
      ];

      // panel_id があれば既存パネルの更新、なければ (同じチャンネルでも) 新規追加
      let savedId: number | null = null;
      if (panel_id) {
        const updateRes = await pool.query(
          `UPDATE custom_ticket_panels SET
            guild_id = $1, panel_title = $2, panel_description = $3, button_label = $4, button_emoji = $5,
            mention_role_ids = $6, target_role_ids = $7, ticket_prefix = $8, panel_type = $9, staff_role_ids = $11
           WHERE id = $10 AND (guild_id = $1 OR guild_id IS NULL)
           RETURNING id`,
          [guildId, ...values.slice(0, 8), panel_id, values[8]]
        );
        savedId = updateRes.rows[0]?.id ?? null;
      }

      if (savedId === null) {
        const insertRes = await pool.query(
          `INSERT INTO custom_ticket_panels (
            guild_id, channel_id, panel_title, panel_description, button_label, button_emoji, mention_role_ids, target_role_ids, ticket_prefix, panel_type, staff_role_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id`,
          [guildId, channel_id, ...values]
        );
        savedId = insertRes.rows[0].id;
      }

      // Also request the bot to spawn the panel
      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, $2, $3, $4)`,
        [guildId, channel_id, panel_type || 'custom_ticket', savedId]
      ).catch(() => {});

      return NextResponse.json({ success: true, id: savedId });
    }
    else if (action === 'delete') {
      const { panel_id, channel_id } = body;
      await ensureSchema(pool);
      if (panel_id) {
        await pool.query(
          'DELETE FROM custom_ticket_panels WHERE id = $1 AND (guild_id = $2 OR guild_id IS NULL)',
          [panel_id, guildId]
        );
      } else if (channel_id) {
        await pool.query('DELETE FROM custom_ticket_panels WHERE channel_id = $1', [channel_id]);
      } else {
        return NextResponse.json({ error: 'panel_id is required' }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }
    else if (action === 'deploy') {
      // 保存済みパネルをBotに再送信させる
      const { panel_id } = body;
      if (!panel_id) {
        return NextResponse.json({ error: 'panel_id is required' }, { status: 400 });
      }
      await ensureSchema(pool);
      const found = await pool.query(
        'SELECT channel_id FROM custom_ticket_panels WHERE id = $1 AND (guild_id = $2 OR guild_id IS NULL)',
        [panel_id, guildId]
      );
      if (found.rows.length === 0) {
        return NextResponse.json({ error: 'panel not found' }, { status: 404 });
      }
      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type, panel_id) VALUES ($1, $2, 'custom_ticket', $3)`,
        [guildId, found.rows[0].channel_id, panel_id]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
