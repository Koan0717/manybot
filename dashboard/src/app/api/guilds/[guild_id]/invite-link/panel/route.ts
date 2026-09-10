import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    return NextResponse.json({ error: 'DISCORD_BOT_TOKEN is not set' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { channel_id, channel_type, title, description, button_label } = body;

    if (!channel_id) {
      return NextResponse.json({ error: '送信先チャンネルを選択してください。' }, { status: 400 });
    }

    const panelTitle = title || '🔗 サーバー招待リンク発行';
    const panelDesc = description || '下のボタンを押すと、あなた専用のサーバー招待リンクがDMに送られます。\nお友達をサーバーに招待する際にご利用ください！';
    const btnLabel = button_label || '招待リンクを発行する';

    const payload = {
      embeds: [
        {
          title: panelTitle,
          description: panelDesc,
          color: 3447003 // discord.Color.blue()
        }
      ],
      components: [
        {
          type: 1, // ActionRow
          components: [
            {
              type: 2, // Button
              style: 1, // Primary (Blurple/Blue)
              label: btnLabel,
              emoji: { name: '🔗' },
              custom_id: 'persistent_invite_link_btn'
            }
          ]
        }
      ]
    };

    let url = `https://discord.com/api/v10/channels/${channel_id}/messages`;
    let postBody: any = payload;

    if (channel_type === 15) { // GUILD_FORUM
      url = `https://discord.com/api/v10/channels/${channel_id}/threads`;
      postBody = {
        name: panelTitle,
        message: payload
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Discord API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to send invite link panel:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
