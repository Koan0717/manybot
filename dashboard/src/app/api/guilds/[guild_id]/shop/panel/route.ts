import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token) {
    return NextResponse.json({ error: "DISCORD_BOT_TOKEN is not set" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { channel_id, channel_type } = body;

    if (!channel_id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const payload = {
      embeds: [
        {
          title: "🛍️ ショップ",
          description: "ボタンを押してメニューを開いてください。\n\n🛍️ **ショップを開く**: アイテムの購入や効果の確認ができます。\n✉️ **お問い合わせ**: ショップに関する質問や問題がある場合はこちらから。\n⚙️ **従業員専用**: ショップの設定やアイテムの管理を行うことができます。",
          color: 16766720 // discord.Color.gold()
        }
      ],
      components: [
        {
          type: 1, // ActionRow
          components: [
            {
              type: 2, // Button
              style: 1, // Primary
              label: "ショップを開く",
              emoji: { name: "🛍️" },
              custom_id: "shop_panel_open_btn"
            },
            {
              type: 2, // Button
              style: 2, // Secondary
              label: "お問い合わせ",
              emoji: { name: "✉️" },
              custom_id: "shop_panel_ticket_btn"
            },
            {
              type: 2, // Button
              style: 4, // Danger
              label: "従業員専用",
              emoji: { name: "⚙️" },
              custom_id: "shop_panel_employee_btn"
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
        name: "🛍️ ショップ",
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
    console.error("Failed to send shop panel:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
