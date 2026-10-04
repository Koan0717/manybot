import { NextResponse } from 'next/server';
import { addonError, findLinkByName, getCurrencyName, listListings, normalizePlayerName, requireAddon } from '@/lib/minecraft';

export const dynamic = 'force-dynamic';

/**
 * GET /api/minecraft/market            … 出品中のもの全部（購入画面：出品者の一覧 → その人の出品）
 * GET /api/minecraft/market?seller=名前 … その人の出品だけ（出品後の「いま売っているもの」）
 */
export async function GET(request: Request) {
  const auth = await requireAddon(request);
  if (!auth.ok) return auth.response;
  const { guildId, pool } = auth;

  const sellerParam = new URL(request.url).searchParams.get('seller');
  try {
    let sellerUserId: string | undefined;
    if (sellerParam !== null) {
      const name = normalizePlayerName(sellerParam);
      if (!name) return addonError('プレイヤー名が不正です', 400);
      const link = await findLinkByName(pool, guildId, name);
      if (!link) return NextResponse.json({ ok: true, listings: [], currency_name: await getCurrencyName(pool, guildId) });
      sellerUserId = link.user_id;
    }
    const [listings, currency_name] = await Promise.all([listListings(pool, guildId, sellerUserId), getCurrencyName(pool, guildId)]);
    return NextResponse.json({ ok: true, listings, currency_name });
  } catch (e) {
    console.error('minecraft market list failed:', e);
    return addonError('出品一覧を取得できませんでした', 500);
  }
}
