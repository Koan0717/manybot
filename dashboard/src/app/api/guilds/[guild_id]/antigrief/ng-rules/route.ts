import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureAntigriefNgRulesSchema } from '@/lib/migrations';

function toRule(row: any) {
  return {
    id: row.id,
    name: row.name || '',
    keywords: row.keywords || [],
    target_category_ids: (row.target_category_ids || []).map(String),
    target_channel_ids: (row.target_channel_ids || []).map(String),
    exempt_role_ids: (row.exempt_role_ids || []).map(String),
    enabled: row.enabled ?? true,
  };
}

function cleanIds(ids: any): string[] {
  return Array.isArray(ids) ? ids.map(String).filter(id => /^\d+$/.test(id)) : [];
}

// キーワード: 前後の空白を除去し、空・重複を取り除く
function cleanKeywords(keywords: any): string[] {
  if (!Array.isArray(keywords)) return [];
  return Array.from(new Set(keywords.map((k: any) => String(k).trim()).filter((k: string) => k.length > 0)));
}

// IPCでBotに設定再読み込みを通知
async function requestReload(pool: any, guildId: string): Promise<number | null> {
  const res = await pool.query(
    `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
     VALUES ($1, 0, 'reload_antigrief')
     RETURNING id`,
    [guildId]
  );
  return res.rows[0]?.id ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    await ensureAntigriefNgRulesSchema(pool);
    const res = await pool.query(
      'SELECT * FROM antigrief_ng_rules WHERE guild_id = $1 ORDER BY id',
      [guildId]
    );
    return NextResponse.json(res.rows.map(toRule));
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
    const pool = await getPool(guildId);
    await ensureAntigriefNgRulesSchema(pool);
    const body = await request.json();
    const { action } = body;

    if (action === 'delete') {
      await pool.query('DELETE FROM antigrief_ng_rules WHERE id = $1 AND guild_id = $2', [body.id, guildId]);
      const sync_request_id = await requestReload(pool, guildId);
      return NextResponse.json({ success: true, sync_request_id });
    }

    if (action === 'toggle') {
      const res = await pool.query(
        'UPDATE antigrief_ng_rules SET enabled = $3 WHERE id = $1 AND guild_id = $2 RETURNING *',
        [body.id, guildId, !!body.enabled]
      );
      if (res.rows.length === 0) {
        return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
      }
      const sync_request_id = await requestReload(pool, guildId);
      return NextResponse.json({ success: true, rule: toRule(res.rows[0]), sync_request_id });
    }

    if (action === 'save') {
      const rule = body.rule || {};
      const name = String(rule.name || '').trim();
      const keywords = cleanKeywords(rule.keywords);
      if (!name) {
        return NextResponse.json({ error: 'ルール名を入力してください' }, { status: 400 });
      }
      if (keywords.length === 0) {
        return NextResponse.json({ error: 'NGキーワードを1つ以上入力してください' }, { status: 400 });
      }
      const values = [
        guildId,
        name,
        keywords,
        cleanIds(rule.target_category_ids),
        cleanIds(rule.target_channel_ids),
        cleanIds(rule.exempt_role_ids),
        rule.enabled ?? true,
      ];

      let res;
      if (rule.id) {
        res = await pool.query(
          `UPDATE antigrief_ng_rules SET
             name = $2, keywords = $3::text[], target_category_ids = $4::bigint[],
             target_channel_ids = $5::bigint[], exempt_role_ids = $6::bigint[], enabled = $7
           WHERE id = $8 AND guild_id = $1
           RETURNING *`,
          [...values, rule.id]
        );
        if (res.rows.length === 0) {
          return NextResponse.json({ error: 'ルールが見つかりません' }, { status: 404 });
        }
      } else {
        res = await pool.query(
          `INSERT INTO antigrief_ng_rules
             (guild_id, name, keywords, target_category_ids, target_channel_ids, exempt_role_ids, enabled)
           VALUES ($1, $2, $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7)
           RETURNING *`,
          values
        );
      }
      const sync_request_id = await requestReload(pool, guildId);
      return NextResponse.json({ success: true, rule: toRule(res.rows[0]), sync_request_id });
    }

    return NextResponse.json({ error: '不明な操作です' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
