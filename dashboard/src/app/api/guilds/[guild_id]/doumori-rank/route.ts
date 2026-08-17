import { NextResponse } from 'next/server';
import { getDoumoriPool } from '@/lib/db';

const DEFAULT_RANKS = [
  { level: 1, name: '🌱 新規住人', required_miles: 0, color: '#A8E6CF', role_name: '新規住人' },
  { level: 2, name: '🏠 住人', required_miles: 4000, color: '#3498DB', role_name: '住人' },
  { level: 3, name: '☕ 常連住人', required_miles: 15000, color: '#E67E22', role_name: '常連住人' },
  { level: 4, name: '🌟 人気住人', required_miles: 45000, color: '#FFD700', role_name: '人気住人' },
];

/**
 * GET /api/guilds/[guild_id]/doumori-rank
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
      CREATE TABLE IF NOT EXISTS doumori_ranks_master (
        level INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        required_miles INTEGER NOT NULL,
        color TEXT NOT NULL,
        role_name TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {});

    const result = await pool.query(
      'SELECT level, name, required_miles, color, role_name FROM doumori_ranks_master ORDER BY level ASC'
    );

    if (result.rows.length === 0) {
      // 初期シード
      for (const r of DEFAULT_RANKS) {
        await pool.query(
          `INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (level) DO NOTHING`,
          [r.level, r.name, r.required_miles, r.color, r.role_name]
        ).catch(() => {});
      }
      return NextResponse.json({ ranks: DEFAULT_RANKS });
    }

    return NextResponse.json({ ranks: result.rows });
  } catch (error: any) {
    console.error('Doumori Rank GET error:', error);
    return NextResponse.json({ error: error.message, ranks: DEFAULT_RANKS }, { status: 500 });
  }
}

/**
 * POST /api/guilds/[guild_id]/doumori-rank
 */
export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const { ranks } = await request.json();

    if (!Array.isArray(ranks)) {
      return NextResponse.json({ error: 'ranks配列が必要です' }, { status: 400 });
    }

    const pool = await getDoumoriPool(guildId);

    for (const r of ranks) {
      await pool.query(
        `INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (level)
         DO UPDATE SET
           name = EXCLUDED.name,
           required_miles = EXCLUDED.required_miles,
           color = EXCLUDED.color,
           role_name = EXCLUDED.role_name,
           updated_at = CURRENT_TIMESTAMP`,
        [
          parseInt(r.level, 10),
          r.name || `Rank ${r.level}`,
          parseInt(r.required_miles, 10) || 0,
          r.color || '#3498DB',
          r.role_name || r.name,
        ]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Doumori Rank POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
