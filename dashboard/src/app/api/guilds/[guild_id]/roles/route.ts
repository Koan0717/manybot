import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = params.guild_id;
  
  if (!token) {
    return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 500 });
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    const roles = await response.json();
    // Discord API returns roles sorted by position, but @everyone is always at the bottom (id == guild_id)
    // We can just return them all
    return NextResponse.json(roles);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
