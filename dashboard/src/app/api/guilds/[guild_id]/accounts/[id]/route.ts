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
