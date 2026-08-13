import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';
import crypto from 'crypto';

/**
 * GET /api/bots
 * 登録済みBotの一覧を取得（トークンは除外）
 */
export async function GET() {
  try {
    const result = await masterPool.query(
      `SELECT id, bot_id, bot_name, github_repo, render_deploy_hook_url,
              last_deploy_at, last_commit_sha, last_commit_message,
              created_at, updated_at,
              CASE WHEN database_url IS NOT NULL THEN TRUE ELSE FALSE END AS has_dedicated_db
       FROM registered_bots
       ORDER BY created_at DESC`
    );
    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error('GET /api/bots error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/bots
 * 新しいBotを登録する
 * Body: { bot_name, token, github_repo?, render_deploy_hook_url?, database_url? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bot_name, token, github_repo, render_deploy_hook_url, database_url } = body;

    if (!bot_name || !token) {
      return NextResponse.json({ error: 'bot_name と token は必須です' }, { status: 400 });
    }

    // Discord APIでBotのIDを取得してトークンを検証
    let botDiscordId: string;
    try {
      const meRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!meRes.ok) {
        return NextResponse.json(
          { error: `Discordトークンが無効です (HTTP ${meRes.status})` },
          { status: 400 }
        );
      }
      const meData = await meRes.json();
      botDiscordId = meData.id;
    } catch (e: any) {
      return NextResponse.json(
        { error: `Discord API接続エラー: ${e.message}` },
        { status: 400 }
      );
    }

    // Webhook シークレットを自動生成
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    const result = await masterPool.query(
      `INSERT INTO registered_bots
         (bot_id, bot_name, token, github_repo, render_deploy_hook_url, database_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bot_id) DO UPDATE SET
         bot_name = EXCLUDED.bot_name,
         token = EXCLUDED.token,
         github_repo = EXCLUDED.github_repo,
         render_deploy_hook_url = EXCLUDED.render_deploy_hook_url,
         database_url = EXCLUDED.database_url,
         updated_at = NOW()
       RETURNING id, bot_id, bot_name, github_repo, render_deploy_hook_url, webhook_secret, created_at`,
      [botDiscordId, bot_name, token, github_repo || null, render_deploy_hook_url || null, database_url || null, webhookSecret]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: any) {
    console.error('POST /api/bots error:', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'このBotはすでに登録されています' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
