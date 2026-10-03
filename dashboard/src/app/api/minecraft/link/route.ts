import { NextResponse } from 'next/server';
import {
  LINK_CODE_TTL_SECONDS,
  addonError,
  findLinkByName,
  issueLinkCode,
  normalizePlayerName,
  requireAddon,
} from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/minecraft/link  { player }
 * ゲーム内の /manybot:link で呼ばれる。6桁の連携コードを発行し、
 * プレイヤーはそれをWebのメンバー画面（プロフィール → マイクラ連携）に入力して Discord アカウントと紐付ける。
 */
export async function POST(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const body = await request.json().catch(() => ({}));
  const player = normalizePlayerName(body?.player);
  if (!player) return addonError('プレイヤー名が不正です', 400);

  try {
    const existing = await findLinkByName(pool, guildId, player);
    const code = await issueLinkCode(pool, guildId, player);
    return NextResponse.json({
      ok: true,
      code,
      expires_in: LINK_CODE_TTL_SECONDS,
      already_linked_to: existing?.user_id ?? null,
    });
  } catch (e) {
    console.error('minecraft link code failed:', e);
    return addonError('連携コードを発行できませんでした', 500);
  }
}
