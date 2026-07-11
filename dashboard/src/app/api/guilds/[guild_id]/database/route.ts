import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = parseInt(params.guild_id);
  if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

  const { data, error } = await supabase
    .from('guild_databases')
    .select('database_url')
    .eq('guild_id', guildId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ database_url: data?.database_url || '' });
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  const guildId = parseInt(params.guild_id);
  if (isNaN(guildId)) return NextResponse.json({ error: 'Invalid guild_id' }, { status: 400 });

  const { database_url } = await request.json();

  if (database_url) {
    const { error } = await supabase
      .from('guild_databases')
      .upsert({ guild_id: guildId, database_url }, { onConflict: 'guild_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('guild_databases')
      .delete()
      .eq('guild_id', guildId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
