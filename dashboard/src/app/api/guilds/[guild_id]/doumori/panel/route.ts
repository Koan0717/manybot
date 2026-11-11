import { NextResponse } from 'next/server';
import { sendChannelMessage } from '@/lib/doumori/discord';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { channel_id, panel_title, panel_color } = await request.json();
    if (!channel_id || !/^\d{6,}$/.test(String(channel_id))) {
      return NextResponse.json({ error: '送信先チャンネルを選択してください。' }, { status: 400 });
    }

    const embed = {
      title: panel_title || '🍃 どうぶつの森林 - 総合操作パネル',
      description: '下のボタンを押すだけで、採集・図鑑・マイルポイント・ランクアップなどの全機能が手軽に使えます！',
      color: parseInt((panel_color || '#2ECC71').replace('#', ''), 16),
      fields: [
        {
          name: '🎣 🦋 採集＆ショップ',
          value: '・**【魚を釣る】**: つりざおを消費して釣る\n・**【虫を捕まえる】**: 虫取り網を消費して捕まえる\n・**【タヌキショップ】**: マイルでチケット購入＆道具交換',
          inline: false,
        },
        {
          name: '🌟 📅 🛠️ ⬆️ マイル＆階級ステップアップ',
          value: '・**【マイル確認】**: 現在のマイルと階級状態を確認\n・**【ミッション】**: 今日の階級別デイリーミッションを確認\n・**【DIY作業台】**: 週1回のイベント開催告知でマイル獲得\n・**【階級アップ】**: マイルを消費して次の階級に昇格！',
          inline: false,
        },
        {
          name: '📖 🔀 💰 図鑑・両替・売却',
          value: '・**【魚図鑑】/【虫図鑑】**: 各図鑑と完成率を確認\n・**【両替】**: マイルを図鑑チケットに両替 (100pt ➔ 1枚)\n・**【ダブり売却】**: 重複した生き物をまとめてベルに換金',
          inline: false,
        },
        {
          name: '🃏 📊 🏆 ❓ 住民カード・プロフ・ランキング・ヘルプ',
          value: '・**【住民カード】**: 階級・ミッション達成回数・ポイント証を表示\n・**【プロフィール】**: 自分の持ち物や図鑑完成率を確認\n・**【ランキング】**: サーバー内完成率 Top 10\n・**【ヘルプ】**: 遊び方ガイドパネルを表示',
          inline: false,
        },
      ],
      footer: { text: '🍃 どうぶつの森林 Bot | Dashboard連携' },
      timestamp: new Date().toISOString(),
    };

    const components = [
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: 'btn_fish', label: '🎣 魚を釣る' },
          { type: 2, style: 3, custom_id: 'btn_bug', label: '🦋 虫を捕まえる' },
          { type: 2, style: 2, custom_id: 'btn_shop', label: '🏪 タヌキショップ' },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: 'btn_miles', label: '🌟 マイル確認' },
          { type: 2, style: 3, custom_id: 'btn_mission', label: '📅 ミッション' },
          { type: 2, style: 2, custom_id: 'btn_diy', label: '🛠️ DIY作業台' },
          { type: 2, style: 4, custom_id: 'btn_rankup', label: '⬆️ 階級アップ' },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: 'btn_fishbook', label: '📖 魚図鑑' },
          { type: 2, style: 3, custom_id: 'btn_bugbook', label: '📖 虫図鑑' },
          { type: 2, style: 2, custom_id: 'btn_exchange', label: '🔀 両替' },
          { type: 2, style: 4, custom_id: 'btn_sell', label: '💰 ダブり売却 (ベル)' },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: 'btn_card', label: '🃏 住民カード' },
          { type: 2, style: 2, custom_id: 'btn_profile', label: '📊 プロフィール' },
          { type: 2, style: 2, custom_id: 'btn_leaderboard', label: '🏆 ランキング' },
          { type: 2, style: 2, custom_id: 'btn_help', label: '❓ ヘルプ' },
        ],
      },
    ];

    const result = await sendChannelMessage(channel_id, { embeds: [embed], components });
    if (!result.ok) {
      return NextResponse.json({ error: `Discord送信エラー: ${result.error}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'チャンネルに総合操作パネルを正常に送信しました！' });
  } catch (error: any) {
    console.error('POST doumori/panel error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
