import { NextResponse } from 'next/server';
import { getDoumoriPool, errorStatus } from '@/lib/doumori/db';
import { DEFAULT_RANKS } from '@/lib/doumori/settings';

export const dynamic = 'force-dynamic';

type Ctx = { params: { guild_id: string } };

// 階級マスタ（doumori_ranks_master）には guild_id が無いが、サーバー専用DBに置くのでサーバーごとの設定になる。

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { pool } = await getDoumoriPool(params.guild_id);
    const result = await pool.query(
      'SELECT level, name, required_miles, color, role_name FROM doumori_ranks_master ORDER BY level ASC'
    );
    return NextResponse.json({ ranks: result.rows.length === 0 ? DEFAULT_RANKS : result.rows });
  } catch (error: any) {
    console.error('GET doumori/ranks error:', error);
    return NextResponse.json({ error: error.message, ranks: DEFAULT_RANKS }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { pool } = await getDoumoriPool(params.guild_id);
    const { ranks } = await request.json();
    if (!Array.isArray(ranks)) {
      return NextResponse.json({ error: 'ranks配列が必要です' }, { status: 400 });
    }

    for (const r of ranks) {
      await pool.query(
        `INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (level)
         DO UPDATE SET name = EXCLUDED.name, required_miles = EXCLUDED.required_miles,
                       color = EXCLUDED.color, role_name = EXCLUDED.role_name, updated_at = CURRENT_TIMESTAMP`,
        [
          parseInt(r.level, 10),
          r.name || `Rank ${r.level}`,
          parseInt(r.required_miles, 10) || 0,
          r.color || '#3498DB',
          r.role_name || r.name,
        ]
      );
    }

    return NextResponse.json({ success: true, message: '階級・ランク設定を保存しました！' });
  } catch (error: any) {
    console.error('POST doumori/ranks error:', error);
    return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
  }
}
