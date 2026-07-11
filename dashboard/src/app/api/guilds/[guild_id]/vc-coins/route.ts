import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    

    const pool = await getPool(guildId);
    
    const res = await pool.query(
        'SELECT is_enabled, whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories FROM vc_coins_settings WHERE guild_id = ',
        [guildId]
    );

    if (res.rows.length > 0) {
        const row = res.rows[0];
        // In python, it used string lists for IDs. Let's parse JSON if they are JSON, else assume comma separated or split.
        // Wait, bot uses TEXT for these fields in setupDbSchema!
        const parseList = (val: string) => {
            if (!val) return [];
            try { return JSON.parse(val); } catch(e) { return val.split(',').filter(Boolean); }
        };

        const is_whitelist = parseList(row.whitelist_channels).length > 0 || parseList(row.whitelist_categories).length > 0 || parseList(row.blacklist_channels).length === 0;

        return NextResponse.json({
            is_whitelist_mode: is_whitelist,
            channels: is_whitelist ? parseList(row.whitelist_channels) : parseList(row.blacklist_channels),
            categories: is_whitelist ? parseList(row.whitelist_categories) : parseList(row.blacklist_categories)
        });
    }

    return NextResponse.json({
        is_whitelist_mode: true,
        channels: [],
        categories: []
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    

    const pool = await getPool(guildId);
    const body = await request.json();

    const is_whitelist = body.is_whitelist_mode ?? true;
    const channels = JSON.stringify(body.channels || []);
    const categories = JSON.stringify(body.categories || []);

    const w_ch = is_whitelist ? channels : '[]';
    const b_ch = !is_whitelist ? channels : '[]';
    const w_cat = is_whitelist ? categories : '[]';
    const b_cat = !is_whitelist ? categories : '[]';

    await pool.query(
        'INSERT INTO vc_coins_settings (guild_id, whitelist_channels, blacklist_channels, whitelist_categories, blacklist_categories) VALUES (, , , , ) ON CONFLICT (guild_id) DO UPDATE SET whitelist_channels = EXCLUDED.whitelist_channels, blacklist_channels = EXCLUDED.blacklist_channels, whitelist_categories = EXCLUDED.whitelist_categories, blacklist_categories = EXCLUDED.blacklist_categories',
        [guildId, w_ch, b_ch, w_cat, b_cat]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
