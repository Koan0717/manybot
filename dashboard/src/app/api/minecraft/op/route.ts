import { NextResponse } from 'next/server';
import { addonError, normalizePlayerName, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

const STATUSES = ['granted', 'revoked', 'unsupported', 'failed'] as const;

/**
 * POST /api/minecraft/op  { player, status: "granted" | "revoked" | "unsupported" | "failed" }
 * アドオンがOPを付けた・外した結果。ダッシュボードの「マイクラメンバー一覧」に表示する。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  const status = (STATUSES as readonly string[]).includes(body?.status) ? body.status : null;
  if (!player || !status) return addonError('リクエストが不正です', 400);
  try {
    await pool.query('UPDATE minecraft_links SET op_status = $3, op_reported_at = NOW() WHERE guild_id = $1 AND mc_name_lower = $2', [
      guildId,
      player.toLowerCase(),
      status,
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('minecraft op report failed:', e);
    return addonError('保存に失敗しました', 500);
  }
}
