import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const payload = await isAuthenticated();
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const res = await masterPool.query(
      'SELECT id, username, role, guild_id, created_at FROM dashboard_users WHERE guild_id = $1 ORDER BY created_at DESC',
      [params.guild_id]
    );
    return NextResponse.json(res.rows);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
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

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const res = await masterPool.query(
      'INSERT INTO dashboard_users (username, password, role, guild_id) VALUES ($1, $2, $3, $4) RETURNING id, username, role, guild_id, created_at',
      [username, hash, role, params.guild_id]
    );

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    console.error(error);
    if (error.code === '23505') { // unique violation
      return NextResponse.json({ error: 'ユーザー名が既に使用されています' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
