import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Discordのチャンネルを取得するヘルパー関数
async function getGuildChannels(guildId: string, token: string) {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
    next: { revalidate: 60 }
  });
  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status}`);
  }
  return await response.json();
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = params.guild_id;
  
  if (!token) return NextResponse.json({ error: "No token" }, { status: 500 });

  try {
    const channels = await getGuildChannels(guildId, token);
    const channelIds = channels.map((c: any) => c.id);

    const pool = await getPool(guildId); // DBプール取得 (Postgres)
    
    // DBから全トリガーを取得
    const triggersRes = await pool.query('SELECT channel_id FROM auto_vc_triggers');
    const dbTriggerIds = triggersRes.rows.map(r => r.channel_id.toString());
    
    // このサーバーに属するトリガーだけを抽出
    const guildTriggerIds = dbTriggerIds.filter(id => channelIds.includes(id));

    if (guildTriggerIds.length === 0) {
      return NextResponse.json([]);
    }

    // トリガーの詳細設定を取得
    const placeholders = guildTriggerIds.map((_, i) => `$${i + 1}`).join(',');
    const configsRes = await pool.query(
      `SELECT channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel 
       FROM auto_vc_config 
       WHERE channel_id::text IN (${placeholders})`,
      guildTriggerIds
    );

    const configsMap = new Map();
    configsRes.rows.forEach(r => {
      configsMap.set(r.channel_id.toString(), r);
    });

    const result = guildTriggerIds.map(id => {
      const c = configsMap.get(id);
      return {
        channel_id: id,
        base_name: c?.base_name || '',
        allow_rename: c?.allow_rename !== false,
        include_owner_name: c?.include_owner_name !== false,
        use_numbering: c?.use_numbering === true,
        allow_limit_change: c?.allow_limit_change !== false,
        show_panel: c?.show_panel !== false,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GET vc-triggers error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  
  try {
    const data = await request.json(); // Array of triggers
    const pool = await getPool(guildId);

    // 古いトリガーを削除するために、まずこのサーバーの現在のトリガーを取得
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 500 });
    const channels = await getGuildChannels(guildId, token);
    const channelIds = channels.map((c: any) => c.id);
    
    const triggersRes = await pool.query('SELECT channel_id FROM auto_vc_triggers');
    const dbTriggerIds = triggersRes.rows.map(r => r.channel_id.toString());
    const oldGuildTriggerIds = dbTriggerIds.filter(id => channelIds.includes(id));

    // 送信された新しいトリガーIDリスト
    const newTriggerIds = data.map((d: any) => d.channel_id);

    // 削除されるべきトリガー (oldにはあるがnewにはない)
    const toDelete = oldGuildTriggerIds.filter(id => !newTriggerIds.includes(id));
    
    // DB更新
    await pool.query('BEGIN');
    
    // 削除処理
    if (toDelete.length > 0) {
      const deletePlaceholders = toDelete.map((_, i) => `$${i + 1}`).join(',');
      // auto_vc_triggers から削除
      await pool.query(`DELETE FROM auto_vc_triggers WHERE channel_id::text IN (${deletePlaceholders})`, toDelete);
      await pool.query(`DELETE FROM auto_vc_config WHERE channel_id::text IN (${deletePlaceholders})`, toDelete);
    }

    // 追加・更新処理
    for (const item of data) {
      const cid = item.channel_id;
      // triggersに追加
      await pool.query(
        'INSERT INTO auto_vc_triggers (channel_id) VALUES ($1) ON CONFLICT (channel_id) DO NOTHING',
        [cid]
      );
      // configを更新
      await pool.query(
        `INSERT INTO auto_vc_config (channel_id, base_name, allow_rename, include_owner_name, use_numbering, allow_limit_change, show_panel)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (channel_id) DO UPDATE SET
         base_name = EXCLUDED.base_name,
         allow_rename = EXCLUDED.allow_rename,
         include_owner_name = EXCLUDED.include_owner_name,
         use_numbering = EXCLUDED.use_numbering,
         allow_limit_change = EXCLUDED.allow_limit_change,
         show_panel = EXCLUDED.show_panel`,
        [
          cid,
          item.base_name || '',
          item.allow_rename,
          item.include_owner_name,
          item.use_numbering,
          item.allow_limit_change,
          item.show_panel
        ]
      );
    }

    await pool.query('COMMIT');
    
    // IPCでBotに再読み込みを通知
    await pool.query(
      "INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, $2, $3)",
      [guildId, 0, "reload_vc_triggers"]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST vc-triggers error:", error);
    const pool = await getPool(params.guild_id);
    await pool.query('ROLLBACK');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
