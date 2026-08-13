import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';

/**
 * GET /api/bots/[bot_id]
 * 特定のBotの情報を取得（トークンは除外）
 */
export async function GET(
  _request: Request,
  { params }: { params: { bot_id: string } }
) {
  const { bot_id } = params;
  try {
    const result = await masterPool.query(
      `SELECT id, bot_id, bot_name, github_repo, render_deploy_hook_url,
              last_deploy_at, last_commit_sha, last_commit_message,
              created_at, updated_at,
              CASE WHEN database_url IS NOT NULL THEN TRUE ELSE FALSE END AS has_dedicated_db
       FROM registered_bots WHERE bot_id = $1`,
      [bot_id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Botが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/bots/[bot_id]
 * Bot情報を更新
 */
export async function PATCH(
  request: Request,
  { params }: { params: { bot_id: string } }
) {
  const { bot_id } = params;
  try {
    const body = await request.json();
    const { bot_name, github_repo, render_deploy_hook_url, database_url } = body;

    const result = await masterPool.query(
      `UPDATE registered_bots SET
         bot_name = COALESCE($1, bot_name),
         github_repo = COALESCE($2, github_repo),
         render_deploy_hook_url = COALESCE($3, render_deploy_hook_url),
         database_url = COALESCE($4, database_url),
         updated_at = NOW()
       WHERE bot_id = $5
       RETURNING id, bot_id, bot_name, github_repo, render_deploy_hook_url, created_at, updated_at`,
      [bot_name || null, github_repo || null, render_deploy_hook_url || null, database_url || null, bot_id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Botが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/bots/[bot_id]
 * Botの登録を削除
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { bot_id: string } }
) {
  const { bot_id } = params;
  try {
    const result = await masterPool.query(
      'DELETE FROM registered_bots WHERE bot_id = $1 RETURNING bot_id, bot_name',
      [bot_id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Botが見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, ...result.rows[0] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
