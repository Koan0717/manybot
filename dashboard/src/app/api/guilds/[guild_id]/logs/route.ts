import { NextResponse } from 'next/server';

const API_BASE = 'http://127.0.0.1:8000';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const res = await fetch(`${API_BASE}/api/guilds/${guildId}/logs`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const body = await request.json();
    const res = await fetch(`${API_BASE}/api/guilds/${guildId}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to update settings');
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
