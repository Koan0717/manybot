import { NextResponse } from 'next/server';
import { getDoumoriPool } from '@/lib/db';

/**
 * GET /api/guilds/[guild_id]/missions
 * ミッションマスター一覧と統計の取得
 */
export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const pool = await getDoumoriPool(guildId);

    // テーブル確保
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doumori_missions_master (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        target_rank INTEGER DEFAULT 0,
        reward_miles INTEGER DEFAULT 100,
        is_active BOOLEAN DEFAULT TRUE,
        times_assigned INTEGER DEFAULT 0,
        times_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {});

    // ミッション一覧取得（サーバー専用ミッションを最優先、未設定時のみデフォルトを取得）
    let result = await pool.query(
      `SELECT * FROM doumori_missions_master
       WHERE guild_id = $1
       ORDER BY is_active DESC, id ASC`,
      [guildId]
    );

    if (result.rows.length === 0) {
      result = await pool.query(
        `SELECT * FROM doumori_missions_master
         WHERE guild_id = 0 OR guild_id IS NULL
         ORDER BY is_active DESC, id ASC`
      );
    }

    // 全体統計の計算
    let totalMissions = result.rows.length;
    let activeMissions = 0;
    let totalAssigned = 0;
    let totalCompleted = 0;

    const missionsWithStats = result.rows.map((row) => {
      const assigned = parseInt(row.times_assigned || 0, 10);
      const completed = parseInt(row.times_completed || 0, 10);
      const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;

      if (row.is_active) activeMissions++;
      totalAssigned += assigned;
      totalCompleted += completed;

      return {
        ...row,
        times_assigned: assigned,
        times_completed: completed,
        completion_rate: completionRate,
      };
    });

    const averageAssigned = totalMissions > 0 ? Math.round(totalAssigned / totalMissions) : 0;

    // スロット設定を取得
    let slotCount = 3;
    try {
      const sRes = await pool.query(
        "SELECT setting_value FROM doumori_settings WHERE (guild_id = $1 OR guild_id = 0) AND setting_key = 'daily_mission_slot_count' ORDER BY guild_id DESC LIMIT 1",
        [guildId]
      );
      if (sRes.rows.length > 0) {
        let raw = sRes.rows[0].setting_value;
        let parsed;
        try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { parsed = raw; }
        const val = parseInt(parsed, 10);
        if (!isNaN(val) && val >= 1 && val <= 10) slotCount = val;
      }
    } catch {}

    return NextResponse.json({
      missions: missionsWithStats,
      slotCount,
      stats: {
        totalMissions,
        activeMissions,
        totalAssigned,
        totalCompleted,
        overallCompletionRate: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
        averageAssigned,
      },
    });
  } catch (error: any) {
    console.error('Missions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/guilds/[guild_id]/missions
 * 新規ミッションの作成
 */
export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const body = await request.json();

    // スロット設定の保存アクション
    if (body.action === 'save_slot_count' && body.slot_count !== undefined) {
      const pool = await getDoumoriPool(guildId);
      const count = Math.max(1, Math.min(10, parseInt(body.slot_count, 10) || 3));
      await pool.query(
        `INSERT INTO doumori_settings (guild_id, setting_key, setting_value)
         VALUES ($1, 'daily_mission_slot_count', $2)
         ON CONFLICT (guild_id, setting_key)
         DO UPDATE SET setting_value = $2`,
        [guildId, String(count)]
      );
      return NextResponse.json({ success: true, slotCount: count });
    }

    const { title, description, target_rank = 0, reward_miles = 100 } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'タイトルと達成条件の説明は必須です' }, { status: 400 });
    }

    const pool = await getDoumoriPool(guildId);

    const res = await pool.query(
      `INSERT INTO doumori_missions_master (guild_id, title, description, target_rank, reward_miles, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [guildId, title, description, parseInt(target_rank, 10) || 0, parseInt(reward_miles, 10) || 100]
    );

    return NextResponse.json({ success: true, mission: res.rows[0] });
  } catch (error: any) {
    console.error('Missions POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PUT /api/guilds/[guild_id]/missions
 * ミッションの更新 (編集または有効/無効切替)
 */
export async function PUT(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const { id, title, description, target_rank, reward_miles, is_active } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ミッションIDが指定されていません' }, { status: 400 });
    }

    const pool = await getDoumoriPool(guildId);

    const res = await pool.query(
      `UPDATE doumori_missions_master
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           target_rank = COALESCE($3, target_rank),
           reward_miles = COALESCE($4, reward_miles),
           is_active = COALESCE($5, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [
        title || null,
        description || null,
        target_rank !== undefined ? parseInt(target_rank, 10) : null,
        reward_miles !== undefined ? parseInt(reward_miles, 10) : null,
        is_active !== undefined ? Boolean(is_active) : null,
        id,
      ]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: '指定されたミッションが見つかりません' }, { status: 404 });
    }

    return NextResponse.json({ success: true, mission: res.rows[0] });
  } catch (error: any) {
    console.error('Missions PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/guilds/[guild_id]/missions
 * ミッションの削除
 */
export async function DELETE(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ミッションIDが指定されていません' }, { status: 400 });
    }

    const pool = await getDoumoriPool(guildId);
    await pool.query('DELETE FROM doumori_missions_master WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Missions DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
