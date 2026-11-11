import { NextResponse } from 'next/server';
import { getDoumoriPool, errorStatus } from '@/lib/doumori/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: { guild_id: string } };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const guildId = params.guild_id;
    const { pool } = await getDoumoriPool(guildId);
    let missionsRes = await pool
      .query(`SELECT * FROM doumori_missions_master WHERE guild_id = $1 ORDER BY is_active DESC, id ASC`, [guildId])
      .catch(() => ({ rows: [] as any[] }));

    // このサーバー専用のミッションが無ければ、共通テンプレート（guild_id = 0）を表示する
    if (!missionsRes.rows || missionsRes.rows.length === 0) {
      missionsRes = await pool
        .query(`SELECT * FROM doumori_missions_master WHERE guild_id = 0 OR guild_id IS NULL ORDER BY is_active DESC, id ASC`)
        .catch(() => ({ rows: [] as any[] }));
    }

    let totalAssigned = 0;
    let totalCompleted = 0;
    let activeMissions = 0;

    const missions = (missionsRes.rows || []).map((row: any) => {
      const assigned = parseInt(row.times_assigned || 0, 10);
      const completed = parseInt(row.times_completed || 0, 10);
      if (row.is_active) activeMissions++;
      totalAssigned += assigned;
      totalCompleted += completed;
      return {
        ...row,
        times_assigned: assigned,
        times_completed: completed,
        completion_rate: assigned > 0 ? Math.round((completed / assigned) * 100) : 0,
      };
    });

    const missionLogs = await pool
      .query(
        `SELECT id, user_id, staff_id, mission_desc, reward_miles, mission_count, created_at
         FROM doumori_mission_logs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [guildId]
      )
      .then((res) => res.rows)
      .catch(() => []);

    return NextResponse.json({
      missions,
      stats: {
        totalMissions: missions.length,
        activeMissions,
        totalAssigned,
        totalCompleted,
        overallCompletionRate: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
      },
      missionLogs,
    });
  } catch (error: any) {
    console.error('GET doumori/missions error:', error);
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const guildId = params.guild_id;
    const { pool } = await getDoumoriPool(guildId);
    const { action, mission } = await request.json();

    if (action === 'create' && mission) {
      const { title, description, target_rank = 0, reward_miles = 100 } = mission;
      if (!title || !description) {
        return NextResponse.json({ error: 'タイトルと達成条件は必須です' }, { status: 400 });
      }
      const res = await pool.query(
        `INSERT INTO doumori_missions_master (guild_id, title, description, target_rank, reward_miles, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
        [guildId, title, description, parseInt(target_rank, 10) || 0, parseInt(reward_miles, 10) || 100]
      );
      return NextResponse.json({ success: true, mission: res.rows[0], message: '新規ミッションを作成しました！' });
    }

    // 更新・削除は、このサーバーのミッションか共通テンプレート（guild_id = 0）だけ
    if (action === 'update' && mission) {
      const { id, title, description, target_rank, reward_miles, is_active } = mission;
      if (!id) return NextResponse.json({ error: 'ミッションIDが指定されていません' }, { status: 400 });

      const res = await pool.query(
        `UPDATE doumori_missions_master
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             target_rank = COALESCE($3, target_rank),
             reward_miles = COALESCE($4, reward_miles),
             is_active = COALESCE($5, is_active),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6 AND (guild_id = $7 OR guild_id = 0 OR guild_id IS NULL) RETURNING *`,
        [
          title || null,
          description || null,
          target_rank !== undefined ? parseInt(target_rank, 10) : null,
          reward_miles !== undefined ? parseInt(reward_miles, 10) : null,
          is_active !== undefined ? Boolean(is_active) : null,
          id,
          guildId,
        ]
      );
      return NextResponse.json({ success: true, mission: res.rows[0], message: 'ミッションを更新しました！' });
    }

    if (action === 'delete' && mission?.id) {
      await pool.query(
        'DELETE FROM doumori_missions_master WHERE id = $1 AND (guild_id = $2 OR guild_id = 0 OR guild_id IS NULL)',
        [mission.id, guildId]
      );
      return NextResponse.json({ success: true, message: 'ミッションを削除しました。' });
    }

    return NextResponse.json({ error: '無効なリクエストです' }, { status: 400 });
  } catch (error: any) {
    console.error('POST doumori/missions error:', error);
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}
