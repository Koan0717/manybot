import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const GAME_TITLES: Record<string, string> = {
  chinchiro: "🎲 チンチロリン",
  coinflip: "🪙 コイントス",
  slot: "🎰 スロット",
  blackjack: "🃏 ブラックジャック",
  roulette: "🎡 ルーレット",
  horse: "🏇 競馬"
};

const GAME_DESCRIPTIONS: Record<string, string> = {
  chinchiro: "こちらのボタンからチンチロリンをプレイできます。\n\n**【配当倍率】**\n- **ピンゾロ**: `5.0倍`\n- **アラシ**: `3.0倍`\n- **シゴロ**: `2.0倍`\n- **通常出目**: `1.0倍`\n- **ヒフミ**: `支払い2.0倍` (没収)\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。",
  coinflip: "こちらのボタンからコイントスをプレイできます。\n表か裏かを当ててください。\n\n**【配当倍率】**\n- **的中**: `2.0倍`\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。",
  slot: "こちらのボタンからスロットをプレイできます。\n\n**【配当倍率】**\n- **7️⃣7️⃣7️⃣**: `10.0倍`\n- **⭐⭐⭐**: `5.0倍`\n- **その他絵柄3つ揃い**: `3.0倍`\n- **絵柄2つ揃い**: `1.5倍`\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。",
  blackjack: "こちらのボタンからブラックジャックをプレイできます。\n\n**【配当倍率】**\n- **通常勝利**: `2.0倍`\n- **ブラックジャック(BJ)勝利**: `2.5倍`\n- **引き分け**: `1.0倍` (返還)\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。",
  roulette: "こちらのボタンからルーレットをプレイできます。\n\n**【配当倍率】**\n- **2倍賭け的中**: `2.0倍`\n- **3倍賭け的中**: `3.0倍`\n- **1点掛け的中**: `36.0倍`\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。",
  horse: "こちらのボタンから競馬をプレイできます。\n出走する5頭の馬から賭けたい馬と馬券を選択してください。\n\n**【出走馬】**\n- 1️⃣ 🟥 **1号馬: キタサンブラック**\n- 2️⃣ 🟦 **2号馬: ディープインパクト**\n- 3️⃣ 🟩 **3号馬: オルフェーヴル**\n- 4️⃣ 🟨 **4号馬: ゴールドシップ**\n- 5️⃣ 🟪 **5号馬: イクイノックス**\n\n**【配当倍率】**\n- 🥇 **単勝 (1着的中)**: `4.5倍`\n- 🥉 **複勝 (1〜3着以内的中)**: `1.5倍`\n\n※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n※ 実際の倍率は設定によって異なる場合があります。"
};

const GAME_COLORS: Record<string, number> = {
  chinchiro: 2067276, // discord.Color.dark_green()
  coinflip: 3447003, // discord.Color.blue()
  slot: 16766720, // discord.Color.gold()
  blackjack: 10038562, // discord.Color.dark_red()
  roulette: 15158332, // discord.Color.red()
  horse: 1102720 // discord.Color.dark_teal()
};

const GAME_CUSTOM_IDS: Record<string, string> = {
  chinchiro: "persistent_chinchiro_btn",
  coinflip: "persistent_coinflip_btn",
  slot: "persistent_slot_btn",
  blackjack: "persistent_blackjack_btn",
  roulette: "persistent_roulette_btn",
  horse: "persistent_horse_racing_btn"
};

const GAME_STATS_CUSTOM_IDS: Record<string, string> = {
  chinchiro: "persistent_chinchiro_stats_btn",
  coinflip: "persistent_coinflip_stats_btn",
  slot: "persistent_slot_stats_btn",
  blackjack: "persistent_blackjack_stats_btn",
  roulette: "persistent_roulette_stats_btn",
  horse: "persistent_horse_racing_stats_btn"
};

const GAME_EMOJIS: Record<string, string> = {
  chinchiro: "🎲",
  coinflip: "🪙",
  slot: "🎰",
  blackjack: "🃏",
  roulette: "🎡",
  horse: "🏇"
};

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
    const { channel_id, channel_type, game_type } = body;

    if (!channel_id || !game_type || !GAME_TITLES[game_type]) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const pool = await getPool(params.guild_id);
    const showKey = `GAMBLE_${game_type.toUpperCase()}_SHOW_STATS`;
    const settingRes = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('GAMBLE_SHOW_STATS', $2)",
      [params.guild_id, showKey]
    );

    let showStats = true;
    settingRes.rows.forEach((r: any) => {
      if (r.setting_value === 'false') {
        showStats = false;
      }
    });

    const buttons: any[] = [
      {
        type: 2, // Button
        style: 1, // Primary
        label: `${GAME_TITLES[game_type].replace(/^[^\s]+\s/, '')}で遊ぶ`,
        emoji: { name: GAME_EMOJIS[game_type] },
        custom_id: GAME_CUSTOM_IDS[game_type]
      }
    ];

    if (showStats && GAME_STATS_CUSTOM_IDS[game_type]) {
      buttons.push({
        type: 2, // Button
        style: 2, // Secondary
        label: '自分の戦績',
        emoji: { name: '📊' },
        custom_id: GAME_STATS_CUSTOM_IDS[game_type]
      });
    }

    const payload = {
      embeds: [
        {
          title: GAME_TITLES[game_type],
          description: GAME_DESCRIPTIONS[game_type],
          color: GAME_COLORS[game_type]
        }
      ],
      components: [
        {
          type: 1, // ActionRow
          components: buttons
        }
      ]
    };


    let url = `https://discord.com/api/v10/channels/${channel_id}/messages`;
    let postBody: any = payload;

    if (channel_type === 15) { // GUILD_FORUM
      url = `https://discord.com/api/v10/channels/${channel_id}/threads`;
      postBody = {
        name: GAME_TITLES[game_type],
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
    console.error("Failed to send gambling panel:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
