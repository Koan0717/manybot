import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import crypto from 'crypto';

/**
 * POST /api/webhooks/github/[bot_id]
 * GitHubからのpushイベントWebhookを受信。
 * - HMAC-SHA256 署名検証
 * - 最新コミット情報をDBに記録
 * - Render Deploy Hook URLが設定されていれば自動デプロイをトリガー
 */
export async function POST(
  request: Request,
  { params }: { params: { bot_id: string } }
) {
  const { bot_id } = params;

  // Bodyを生テキストで読む（署名検証のため）
  const rawBody = await request.text();

  // DBからBot情報取得
  let botRow: any;
  try {
    const result = await masterPool.query(
      'SELECT webhook_secret, render_deploy_hook_url, bot_name FROM registered_bots WHERE bot_id = $1',
      [bot_id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    botRow = result.rows[0];
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // HMAC-SHA256 署名検証
  const signature = request.headers.get('x-hub-signature-256');
  if (botRow.webhook_secret && signature) {
    const expectedSig =
      'sha256=' +
      crypto
        .createHmac('sha256', botRow.webhook_secret)
        .update(rawBody)
        .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else if (botRow.webhook_secret && !signature) {
    // シークレットが設定されているのに署名がない場合は拒否
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  const event = request.headers.get('x-github-event') || 'push';

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // コミット情報を抽出
  const headCommit = payload.head_commit;
  const commitSha: string | null = headCommit?.id?.slice(0, 8) || payload.after?.slice(0, 8) || null;
  const commitMessage: string | null = headCommit?.message?.split('\n')[0] || null;
  const branch: string | null = payload.ref ? payload.ref.replace('refs/heads/', '') : null;
  const pusher: string | null = payload.pusher?.name || null;

  let deployTriggered = false;

  // Render Deploy Hook URLへのデプロイ要求
  if (botRow.render_deploy_hook_url && event === 'push') {
    try {
      const deployRes = await fetch(botRow.render_deploy_hook_url, { method: 'POST' });
      deployTriggered = deployRes.ok;
    } catch {
      deployTriggered = false;
    }
  }

  // DBにログを記録し、last_commitも更新
  try {
    await Promise.all([
      masterPool.query(
        `INSERT INTO github_deploy_logs
           (bot_id, event_type, commit_sha, commit_message, branch, pusher, deploy_triggered)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [bot_id, event, commitSha, commitMessage, branch, pusher, deployTriggered]
      ),
      masterPool.query(
        `UPDATE registered_bots SET
           last_commit_sha = COALESCE($1, last_commit_sha),
           last_commit_message = COALESCE($2, last_commit_message),
           last_deploy_at = CASE WHEN $3 THEN NOW() ELSE last_deploy_at END,
           updated_at = NOW()
         WHERE bot_id = $4`,
        [commitSha, commitMessage, deployTriggered, bot_id]
      ),
    ]);
  } catch (error: any) {
    console.error('Failed to log GitHub webhook:', error);
  }

  return NextResponse.json({
    ok: true,
    event,
    commitSha,
    commitMessage,
    branch,
    deployTriggered,
  });
}
