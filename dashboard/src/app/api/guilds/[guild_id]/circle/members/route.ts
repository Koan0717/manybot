import { NextResponse } from 'next/server';
import { fetchAllGuildMembers, memberAvatarUrl, memberDisplayName } from '@/lib/discordApi';

export const dynamic = 'force-dynamic';

/** 送信先を選ぶためのメンバー一覧（Bot は除く） */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = params.guild_id;
  try {
    const all = await fetchAllGuildMembers(guildId);
    const members = all
      .filter((m) => !m.user.bot)
      .map((m) => ({
        id: m.user.id,
        display_name: memberDisplayName(m),
        username: m.user.username,
        avatar_url: memberAvatarUrl(guildId, m),
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));
    return NextResponse.json({ members });
  } catch (e: any) {
    console.error('Circle members GET error:', e);
    const msg = e?.status === 403
      ? 'Botにメンバー一覧を読む権限がありません（Server Members Intent を確認してください）'
      : 'メンバー一覧を取得できませんでした';
    return NextResponse.json({ error: msg, members: [] }, { status: 500 });
  }
}
