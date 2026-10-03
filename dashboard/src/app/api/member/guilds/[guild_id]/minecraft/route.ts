import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { jsonError, requireGuildMember } from '@/lib/memberAuth';
import { discordStatusOf, ensureMinecraftGuildSchema, getMinecraftServer, isServerOnline, saveDiscordStatus } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * GET /api/member/guilds/[guild_id]/minecraft
 * このサーバーにマイクラ連携があるか、自分が連携済みか（どのプレイヤー名か）。
 */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session } = access;

  try {
    const server = await getMinecraftServer(guildId);
    if (!server || !server.is_enabled || !server.api_key_hint) return NextResponse.json({ enabled: false });
    const pool = await getPool(guildId);
    await ensureMinecraftGuildSchema(pool);
    const r = await pool.query('SELECT mc_name, linked_at FROM minecraft_links WHERE guild_id = $1 AND user_id = $2', [
      guildId,
      session.discord_id,
    ]);
    return NextResponse.json({
      enabled: true,
      online: isServerOnline(server),
      server_name: server.server_name,
      online_count: server.online_players.length,
      link: r.rows[0] ?? null,
    });
  } catch (e) {
    console.error('member minecraft GET failed:', e);
    return jsonError('マイクラ連携の情報を取得できませんでした', 500);
  }
}

/**
 * POST /api/member/guilds/[guild_id]/minecraft  { code: "123456" }
 * ゲーム内の /manybot:link で表示された6桁のコードで、ログイン中のDiscordアカウントとプレイヤーを紐付ける。
 * 以前の連携（自分の別プレイヤー・そのプレイヤーの別アカウント）は置き換える。
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session, member } = access;

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) return jsonError('6桁のコードを入力してください', 400);

  const server = await getMinecraftServer(guildId).catch(() => null);
  if (!server || !server.is_enabled) return jsonError('このサーバーではマイクラ連携が有効になっていません', 400);

  const pool = await getPool(guildId);
  await ensureMinecraftGuildSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      'DELETE FROM minecraft_link_codes WHERE guild_id = $1 AND code = $2 AND expires_at > NOW() RETURNING mc_name',
      [guildId, code]
    );
    const mcName: string | undefined = c.rows[0]?.mc_name;
    if (!mcName) {
      await client.query('ROLLBACK');
      return jsonError('コードが間違っているか、有効期限（10分）が切れています', 400);
    }
    await client.query('DELETE FROM minecraft_links WHERE guild_id = $1 AND (user_id = $2 OR mc_name_lower = $3)', [
      guildId,
      session.discord_id,
      mcName.toLowerCase(),
    ]);
    await client.query(
      'INSERT INTO minecraft_links (guild_id, user_id, mc_name, mc_name_lower) VALUES ($1, $2, $3, $4)',
      [guildId, session.discord_id, mcName, mcName.toLowerCase()]
    );
    await client.query('COMMIT');
    // 連携した時点のロールを記録する。運営管理者ロールがあれば、マイクラ側でOPが付く（アドオンのハートビートで反映）
    let isStaff = false;
    try {
      const st = await discordStatusOf(guildId, member);
      await saveDiscordStatus(pool, guildId, session.discord_id, st);
      isStaff = st.is_staff;
    } catch (e) {
      console.error('minecraft link role check failed:', e);
    }
    return NextResponse.json({ success: true, is_staff: isStaff, link: { mc_name: mcName, linked_at: new Date().toISOString() } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('member minecraft link failed:', e);
    return jsonError('連携に失敗しました', 500);
  } finally {
    client.release();
  }
}

/** DELETE /api/member/guilds/[guild_id]/minecraft — 自分の連携を解除する */
export async function DELETE(request: Request, { params }: { params: { guild_id: string } }) {
  const access = await requireGuildMember(request, params.guild_id);
  if (!access.ok) return access.response;
  const { guildId, session } = access;
  try {
    const pool = await getPool(guildId);
    await ensureMinecraftGuildSchema(pool);
    await pool.query('DELETE FROM minecraft_links WHERE guild_id = $1 AND user_id = $2', [guildId, session.discord_id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('member minecraft unlink failed:', e);
    return jsonError('連携の解除に失敗しました', 500);
  }
}
