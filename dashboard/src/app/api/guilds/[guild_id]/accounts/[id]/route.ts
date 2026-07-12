import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

export async function DELETE(request: Request, { params }: { params: { guild_id: string, id: string } }) {
  const payload = await isAuthenticated();
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // Ensure we only delete accounts belonging to this guild
    const res = await masterPool.query(
      'DELETE FROM dashboard_users WHERE id = $1 AND guild_id = $2 RETURNING id',
      [params.id, params.guild_id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { guild_id: string, id: string } }) {
  const payload = await isAuthenticated();
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, password, role } = body;

    if (!username || !password || !role) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const res = await masterPool.query(
      'UPDATE dashboard_users SET username = $1, password = $2, role = $3 WHERE id = $4 AND guild_id = $5 RETURNING id, username, password, role, guild_id, created_at',
      [username, password, role, params.id, params.guild_id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    console.error(error);
    if (error.code === '23505') { // unique violation
      return NextResponse.json({ error: 'ユーザー名が既に使用されています' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

