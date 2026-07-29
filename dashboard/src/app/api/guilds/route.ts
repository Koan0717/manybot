import { NextResponse } from 'next/server';

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token) {
    return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 500 });
  }

  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bot ${token}`,
      },
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    const guilds = await response.json();
    return NextResponse.json(guilds);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
