import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

/**
 * GET /api/bots/[bot_id]/[guild_id]/accounts
 * 専用アカウント一覧を取得
 */
export async function GET(
  request: Request,
  { params }: { params: { bot_id: string; guild_id: string } }
) {
  const { bot_id, guild_id } = params;

  try {
    // テーブルが存在することを確認
    try {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          guild_id VARCHAR(50) NOT NULL,
          bot_id VARCHAR(50),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS bot_id VARCHAR(50);
      `);
    } catch (e) {}

    const res = await masterPool.query(
      `SELECT id, username, password, role, guild_id, bot_id, created_at
       FROM dashboard_users
       WHERE guild_id = $1 AND (bot_id = $2 OR bot_id IS NULL)
       ORDER BY created_at DESC`,
      [guild_id, bot_id]
    );

    return NextResponse.json(res.rows);
  } catch (error: any) {
    console.error('GET bot accounts error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/bots/[bot_id]/[guild_id]/accounts
 * 専用アカウントを新規作成
 */
export async function POST(
  request: Request,
  { params }: { params: { bot_id: string; guild_id: string } }
) {
  const { bot_id, guild_id } = params;

  try {
    const body = await request.json();
    const { username, password, role } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'ユーザー名とパスワードを入力してください。' }, { status: 400 });
    }

    const assignedRole = role || 'botadmin';

    const res = await masterPool.query(
      `INSERT INTO dashboard_users (username, password, role, guild_id, bot_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, password, role, guild_id, bot_id, created_at`,
      [username.trim(), password.trim(), assignedRole, guild_id, bot_id]
    );

    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (error: any) {
    console.error('POST bot account error:', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'このユーザー名は既に使用されています。' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/bots/[bot_id]/[guild_id]/accounts
 * 専用アカウントを削除
 */
export async function DELETE(
  request: Request,
  { params }: { params: { bot_id: string; guild_id: string } }
) {
  const { bot_id, guild_id } = params;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'アカウントIDを指定してください。' }, { status: 400 });
    }

    await masterPool.query(
      'DELETE FROM dashboard_users WHERE id = $1 AND guild_id = $2',
      [id, guild_id]
    );

    return NextResponse.json({ success: true, message: 'アカウントを削除しました。' });
  } catch (error: any) {
    console.error('DELETE bot account error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
