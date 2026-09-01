import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureRoleSalarySettingsSchema } from '@/lib/migrations';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);
  try {
    await ensureRoleSalarySettingsSchema(pool);
    const result = await pool.query(
      'SELECT payday, entries FROM role_salary_settings WHERE guild_id = $1',
      [guildId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ payday: 1, entries: [] });
    }
    const row = result.rows[0];
    return NextResponse.json({
      payday: row.payday ?? 1,
      entries: Array.isArray(row.entries) ? row.entries : [],
    });
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
    await ensureRoleSalarySettingsSchema(pool);
    const body = await request.json();

    // 即時払いアクション
    if (body.action === 'pay_now') {
      const roleId = body.role_id ? String(body.role_id) : null;
      const amount = body.amount !== undefined && !isNaN(Number(body.amount)) ? Math.max(0, Number(body.amount)) : 0;
      if (!roleId || amount <= 0) {
        return NextResponse.json({ error: 'role_id と amount が必要です' }, { status: 400 });
      }
      // panel_type に ロールID と 金額を埋め込む形式: "pay_role_salary:role_id:amount"
      const panelType = `pay_role_salary:${roleId}:${amount}`;
      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, 0, $2)`,
        [guildId, panelType]
      );
      return NextResponse.json({ success: true });
    }

    // 設定保存
    const payday = body.payday !== undefined && !isNaN(Number(body.payday))
      ? Math.min(28, Math.max(1, Number(body.payday)))
      : 1;

    const rawEntries = Array.isArray(body.entries) ? body.entries : [];
    const entries = rawEntries
      .filter((e: any) => e && e.role_id && !isNaN(Number(e.amount)) && Number(e.amount) >= 0)
      .map((e: any) => ({ role_id: String(e.role_id), amount: Number(e.amount) }));

    await pool.query(
      `INSERT INTO role_salary_settings (guild_id, payday, entries)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (guild_id)
       DO UPDATE SET payday = $2, entries = $3::jsonb`,
      [guildId, payday, JSON.stringify(entries)]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
