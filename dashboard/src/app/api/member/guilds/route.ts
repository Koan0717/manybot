import { NextResponse } from 'next/server';
import { DiscordApiError, botRequest, listBotGuilds } from '@/lib/discordApi';
import { getMemberSession, jsonError } from '@/lib/memberAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds
 * ログイン中のメンバーが今参加している、Manybot のいるサーバーの一覧。
 * サーバー一覧はログイン時に保存しているが、ログインは30日続くので、その後に参加したサーバーや
 * Bot が後から入ったサーバーが出てこない。そのため画面を開くたびにここで取り直す。
 * ユーザーのアクセストークンは持っていないので、Bot の参加サーバーごとに「この人がメンバーか」を Bot で確かめる。
 */
export async function GET(request: Request) {
  const session = await getMemberSession(request);
  if (!session) return jsonError('ログインが必要です', 401);
  try {
    const botGuilds = await listBotGuilds();
    const guilds: typeof botGuilds = [];
    // 確かめられなかったサーバー（混雑による一時的なエラーなど）。画面側は保存済みの一覧にあればそのまま残す
    const unknown: string[] = [];
    await Promise.all(
      botGuilds.map(async (g) => {
        try {
          await botRequest(`/guilds/${g.id}/members/${session.discord_id}`);
          guilds.push(g);
        } catch (e) {
          if (e instanceof DiscordApiError && (e.status === 404 || e.status === 403)) return;
          unknown.push(g.id);
        }
      })
    );
    // 並び順は Discord の一覧と同じ（ID順）にそろえる
    const order = new Map(botGuilds.map((g, i) => [g.id, i]));
    guilds.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return NextResponse.json({ guilds, unknown });
  } catch (e) {
    console.error('member guilds refresh failed:', e);
    return jsonError('サーバー一覧を取得できませんでした', 502);
  }
}
