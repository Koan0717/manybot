import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);

    // テーブルが存在することを保証
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reaction_roles (
        message_id BIGINT,
        emoji TEXT,
        role_id BIGINT,
        PRIMARY KEY (message_id, emoji)
      );
    `);

    // 登録されているメッセージ一覧を取得
    const res = await pool.query(`
      SELECT message_id, emoji, role_id::text as role_id 
      FROM reaction_roles 
      ORDER BY message_id DESC
    `);

    // message_id ごとにグループ化
    const grouped: { [key: string]: any } = {};
    for (const row of res.rows) {
      const mid = row.message_id.toString();
      if (!grouped[mid]) {
        grouped[mid] = {
          message_id: mid,
          channel_id: '',
          panel_title: 'ロール付与パネル',
          panel_description: '',
          reaction_roles: []
        };
      }
      grouped[mid].reaction_roles.push({
        role_id: row.role_id,
        emoji: row.emoji
      });
    }

    const panels = Object.values(grouped);
    return NextResponse.json(panels);
  } catch (error: any) {
    console.error('Failed to get other panels:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    const body = await request.json();
    
    const channel_id = body.channel_id;
    const title = body.panel_title || body.title || 'ロール付与パネル';
    const description = body.panel_description !== undefined ? body.panel_description : (body.description || '');
    const reaction_roles = body.reaction_roles;
    const token = process.env.DISCORD_BOT_TOKEN;

    if (!channel_id || !title || !reaction_roles || reaction_roles.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!token) {
      return NextResponse.json({ error: 'DISCORD_BOT_TOKEN is not configured' }, { status: 500 });
    }

    // テーブルが存在することを保証
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reaction_roles (
        message_id BIGINT,
        emoji TEXT,
        role_id BIGINT,
        PRIMARY KEY (message_id, emoji)
      );
    `);

    // 1. Discord REST APIで埋め込みメッセージを送信
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [{
          title: title,
          description: description || '',
          color: 16766720 // gold color
        }]
      })
    });

    if (!messageResponse.ok) {
      const errData = await messageResponse.json().catch(() => ({}));
      throw new Error(`メッセージの送信に失敗しました: ${JSON.stringify(errData)}`);
    }

    const messageData = await messageResponse.json();
    const messageId = messageData.id;

    // 2. 各リアクションロールをDBに保存し、メッセージにリアクションを追加
    for (const rr of reaction_roles) {
      const { role_id, emoji } = rr;
      if (!role_id || !emoji) continue;
      
      let apiEmoji = emoji.trim();
      let dbEmoji = apiEmoji;
      
      const customMatch = apiEmoji.match(/<a?:([^:]+):(\d+)>/);
      if (customMatch) {
        apiEmoji = `${customMatch[1]}:${customMatch[2]}`;
        dbEmoji = customMatch[0];
      } else {
        const rawMatch = apiEmoji.match(/^([^:]+):(\d+)$/);
        if (rawMatch) {
          dbEmoji = `<:${rawMatch[1]}:${rawMatch[2]}>`;
        }
      }

      // DBに保存
      await pool.query(
        `INSERT INTO reaction_roles (message_id, emoji, role_id) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [messageId, dbEmoji, role_id]
      );
      
      // リアクションを付与
      const encodedEmoji = encodeURIComponent(apiEmoji);
      const reactionResponse = await fetch(
        `https://discord.com/api/v10/channels/${channel_id}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://manybot.com, 1.0)',
            'Content-Length': '0'
          }
        }
      );

      if (!reactionResponse.ok) {
        console.error(`Failed to add reaction ${emoji} to message ${messageId}`, await reactionResponse.text());
      }
      
      // レートリミット回避
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    return NextResponse.json({ success: true, message_id: messageId });
  } catch (error: any) {
    console.error('Other panels error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}