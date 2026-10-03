import { NextResponse } from 'next/server';
import { addonError, findLinkByName, getBalance, getCurrencyName, normalizePlayerName, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * GET /api/minecraft/balance?player=<ゲーマータグ>
 * 連携済みプレイヤーの残高（＝Discordサーバーの通貨残高）を返す。
 */
export async function GET(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const player = normalizePlayerName(new URL(request.url).searchParams.get('player'));
  if (!player) return addonError('プレイヤー名が不正です', 400);

  try {
    const link = await findLinkByName(pool, guildId, player);
    const currency_name = await getCurrencyName(pool, guildId);
    if (!link) return NextResponse.json({ ok: true, linked: false, currency_name });
    const balance = await getBalance(pool, guildId, link.user_id);
    return NextResponse.json({ ok: true, linked: true, balance, currency_name, discord_id: link.user_id });
  } catch (e) {
    console.error('minecraft balance failed:', e);
    return addonError('残高を取得できませんでした', 500);
  }
}
