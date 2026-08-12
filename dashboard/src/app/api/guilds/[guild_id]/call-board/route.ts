import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const result = await pool.query(
      'SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1',
      [guildId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return NextResponse.json({
        panel_channel_id: row.panel_channel_id ? String(row.panel_channel_id) : '',
        board_channel_id: row.board_channel_id ? String(row.board_channel_id) : '',
        vc_category_id: row.vc_category_id ? String(row.vc_category_id) : '',
      });
    }

    return NextResponse.json({
      panel_channel_id: '',
      board_channel_id: '',
      vc_category_id: '',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const pool = await getPool(guildId);

  try {
    const body = await request.json();
    const { action, panel_channel_id, board_channel_id, vc_category_id } = body;

    // テーブルが存在しない場合は自動作成
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_board_settings (
        guild_id BIGINT PRIMARY KEY,
        panel_channel_id BIGINT,
        board_channel_id BIGINT,
        vc_category_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS panel_requests (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT,
        channel_id BIGINT,
        panel_type TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const panelCh = panel_channel_id ? String(panel_channel_id) : null;
    const boardCh = board_channel_id ? String(board_channel_id) : null;
    const vcCat = vc_category_id ? String(vc_category_id) : null;

    // 設定の保存（saveでもdeployでも保存）
    if (panelCh || boardCh || vcCat) {
      await pool.query(
        `INSERT INTO call_board_settings (guild_id, panel_channel_id, board_channel_id, vc_category_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id) DO UPDATE
         SET panel_channel_id = EXCLUDED.panel_channel_id,
             board_channel_id = EXCLUDED.board_channel_id,
             vc_category_id = EXCLUDED.vc_category_id`,
        [guildId, panelCh, boardCh, vcCat]
      );
    }

    if (action === 'save') {
      // IPCでBotに設定再読み込みを通知
      const reqResult = await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, 0, 'reload_call_board')
         RETURNING id`,
        [guildId]
      );
      const sync_request_id: number | null = reqResult.rows[0]?.id ?? null;
      return NextResponse.json({ success: true, sync_request_id });
    }

    if (action === 'deploy') {
      if (!panelCh) {
        return NextResponse.json({ error: 'パネル設置チャンネルが指定されていません。' }, { status: 400 });
      }

      const token = process.env.DISCORD_BOT_TOKEN;
      let sentDirectly = false;

      if (token) {
        try {
          const discordRes = await fetch(`https://discord.com/api/v10/channels/${panelCh}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              embeds: [{
                title: '📞 通話募集掲示板',
                description: 'ボイスチャンネルで一緒に通話する相手を募集できます！\n下のボタンを押して「目的」や「一言」を入力してください。',
                color: 5793266
              }],
              components: [
                {
                  type: 1,
                  components: [
                    {
                      type: 2,
                      style: 3,
                      label: '📞 通話を募集する',
                      custom_id: 'persistent_call_board_panel_btn'
                    }
                  ]
                }
              ]
            })
          });

          if (discordRes.ok) {
            sentDirectly = true;
          } else {
            const errData = await discordRes.json();
            console.error('[Discord REST API Error]', errData);
            return NextResponse.json({ error: `Discordエラー: ${errData.message || JSON.stringify(errData)}` }, { status: 400 });
          }
        } catch (err: any) {
          console.error('[Discord Direct Post Failed]', err);
        }
      }

      if (!sentDirectly) {
        await pool.query(
          `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
           VALUES ($1, $2, 'call_board')`,
          [guildId, panelCh]
        );
      }

      return NextResponse.json({ success: true, message: 'パネルを正常に設置しました！', sync_request_id: null });
    }

    return NextResponse.json({ success: true, sync_request_id: null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
