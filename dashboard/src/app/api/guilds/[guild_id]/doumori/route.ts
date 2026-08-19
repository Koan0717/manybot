import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { masterPool, getPool, getDoumoriPool, getDoumoriDbUrl } from '@/lib/db';

const DEFAULT_SETTINGS = {
  // 1. 🎫 浮上・チケット獲得システム
  ticket_required_minutes: 60,
  ticket_chat_activity_seconds: 60,
  ticket_chat_cooldown_seconds: 60,
  ticket_notify_channel_id: '',
  ticket_notify_dm: false,
  ticket_notify_message: '🎉 **【浮上特典】** {user} さんがアクティビティを達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）',

  // 2. 🏪 ショップ (/ショップ)
  miles_per_ticket: 100,
  fishing_rod_price: 1,
  bug_net_price: 1,
  shop_discount_bulk: true,

  // 3. 🎣 採集 (/釣り, /虫捕り)
  shiny_chance_percent: 0.5,
  time_restriction_enabled: true,
  catch_weight_common: 50,
  catch_weight_uncommon: 30,
  catch_weight_rare: 15,
  catch_weight_super_rare: 4,
  catch_weight_legendary: 1,

  // 4. 📖 図鑑 (/魚図鑑, /虫図鑑)
  book_page_size: 10,
  book_show_unobtained_mask: true,
  book_show_shiny_badge: true,

  // 5. 🏆 限定コンプリートロール付与
  fish_completion_role_name: '🎣 金のつりざお',
  fish_completion_role_color: '#FFD700',
  bug_completion_role_name: '🦋 金の虫取り網',
  bug_completion_role_color: '#FFD700',
  completion_auto_award: true,
  completion_announce_channel_id: '',

  // 6. 🪙 鯖内通貨 (ベル) 連携 (/両替, /売却)
  manybot_per_ticket: 500,
  allow_miles_to_ticket: true,
  allow_zeny_to_ticket: true,
  allow_ticket_to_zeny: true,
  sell_price_common: 100,
  sell_price_uncommon: 300,
  sell_price_rare: 800,
  sell_price_super_rare: 2500,
  sell_price_legendary: 10000,
  sell_price_shiny_multiplier: 5,

  // 7. 📸 ミッション報告＆ワンタップ承認自動化 (/ミッション報告)
  mission_report_channel_id: '',
  mission_staff_role_ids: [] as string[],
  mission_auto_card_preview: true,
  daily_mission_slot_count: 3,
  daily_mission_reward_rank1: 30,
  daily_mission_reward_rank2: 50,
  daily_mission_reward_rank3: 70,
  daily_mission_reward_rank4: 100,

  // 8. 👑 ロール権限管理 (/設定パネル連動)
  admin_role_ids: [] as string[],
  mile_grant_role_ids: [] as string[],
  ticket_grant_role_ids: [] as string[],

  // 9. 🃏 住民カード＆階級ステップアップ
  rank1_name: '🌱 新規住人',
  rank1_miles: 0,
  rank1_color: '#A8E6CF',
  rank2_name: '🏠 住人',
  rank2_miles: 300,
  rank2_color: '#3498DB',
  rank3_name: '☕ 常連住人',
  rank3_miles: 800,
  rank3_color: '#E67E22',
  rank4_name: '🌟 人気住人',
  rank4_miles: 1500,
  rank4_color: '#FFD700',
  rank_auto_role_grant: true,
  diy_event_reward_miles: 150,
  diy_cooldown_days: 7,

  // 10. 🎮 総合操作パネル
  panel_channel_id: '',
  panel_title: '🍃 どうぶつの森林 - 総合操作パネル',
  panel_color: '#2ECC71',
};

/**
 * GET /api/guilds/[guild_id]/doumori
 */
export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const token = process.env.DISCORD_BOT_TOKEN;

  try {
    const pool = await getDoumoriPool(guildId);

    // 1. Settings & Master Tables ensure & fetch
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS doumori_settings (
          guild_id BIGINT,
          setting_key TEXT,
          setting_value TEXT,
          PRIMARY KEY (guild_id, setting_key)
        );
        CREATE TABLE IF NOT EXISTS doumori_missions_master (
          id SERIAL PRIMARY KEY,
          guild_id BIGINT DEFAULT 0,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          target_rank INTEGER DEFAULT 0,
          reward_miles INTEGER DEFAULT 100,
          is_active BOOLEAN DEFAULT TRUE,
          times_assigned INTEGER DEFAULT 0,
          times_completed INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS doumori_ranks_master (
          level INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          required_miles INTEGER NOT NULL,
          color TEXT NOT NULL,
          role_name TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS doumori_mission_logs (
          id SERIAL PRIMARY KEY,
          guild_id BIGINT,
          user_id BIGINT,
          staff_id BIGINT,
          mission_desc TEXT,
          reward_miles INTEGER DEFAULT 100,
          mission_count INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS doumori_mile_logs (
          id SERIAL PRIMARY KEY,
          guild_id BIGINT,
          user_id BIGINT,
          admin_id BIGINT,
          amount INTEGER,
          action TEXT,
          reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS doumori_miles (
          guild_id BIGINT,
          user_id BIGINT,
          miles INTEGER DEFAULT 0,
          rank_level INTEGER DEFAULT 1,
          mission_count INTEGER DEFAULT 0,
          total_mission_count INTEGER DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS doumori_daily_missions_slot_uidx
        ON doumori_daily_missions (guild_id, user_id, date_key, mission_slot);
        CREATE UNIQUE INDEX IF NOT EXISTS doumori_miles_uidx
        ON doumori_miles (guild_id, user_id);
      `);
    } catch (e) {}

    const settingsRows = await pool
      .query('SELECT setting_key, setting_value FROM doumori_settings WHERE guild_id = $1', [guildId])
      .then((res: any) => res.rows)
      .catch(() => []);

    const customSettings: Record<string, any> = {};
    for (const r of settingsRows) {
      try {
        customSettings[r.setting_key] = JSON.parse(r.setting_value);
      } catch {
        customSettings[r.setting_key] = r.setting_value;
      }
    }

    const mergedSettings = { ...DEFAULT_SETTINGS, ...customSettings };

    // 2. Fetch Missions Master & Calculate Stats
    let missionsRes = await pool.query(
      `SELECT * FROM doumori_missions_master
       WHERE guild_id = $1
       ORDER BY is_active DESC, id ASC`,
      [guildId]
    ).catch(() => ({ rows: [] as any[] }));

    if (!missionsRes.rows || missionsRes.rows.length === 0) {
      missionsRes = await pool.query(
        `SELECT * FROM doumori_missions_master
         WHERE guild_id = 0 OR guild_id IS NULL
         ORDER BY is_active DESC, id ASC`
      ).catch(() => ({ rows: [] as any[] }));
    }

    let totalAssigned = 0;
    let totalCompleted = 0;
    let activeMissions = 0;

    const missionsMaster = (missionsRes.rows || []).map((row: any) => {
      const assigned = parseInt(row.times_assigned || 0, 10);
      const completed = parseInt(row.times_completed || 0, 10);
      const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
      if (row.is_active) activeMissions++;
      totalAssigned += assigned;
      totalCompleted += completed;
      return {
        ...row,
        times_assigned: assigned,
        times_completed: completed,
        completion_rate: completionRate,
      };
    });

    const missionStats = {
      totalMissions: missionsMaster.length,
      activeMissions,
      totalAssigned,
      totalCompleted,
      overallCompletionRate: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
      averageAssigned: missionsMaster.length > 0 ? Math.round(totalAssigned / missionsMaster.length) : 0,
    };

    // 3. Fetch Ranks Master
    const DEFAULT_RANKS = [
      { level: 1, name: '🌱 新規住人', required_miles: 0, color: '#A8E6CF', role_name: '新規住人' },
      { level: 2, name: '🏠 住人', required_miles: 4000, color: '#3498DB', role_name: '住人' },
      { level: 3, name: '☕ 常連住人', required_miles: 15000, color: '#E67E22', role_name: '常連住人' },
      { level: 4, name: '🌟 人気住人', required_miles: 45000, color: '#FFD700', role_name: '人気住人' },
    ];

    let ranksMaster = await pool
      .query('SELECT level, name, required_miles, color, role_name FROM doumori_ranks_master ORDER BY level ASC')
      .then((res: any) => res.rows)
      .catch(() => []);

    if (ranksMaster.length === 0) {
      ranksMaster = DEFAULT_RANKS;
    }

    // 4. Fetch Recent Mission Logs
    const missionLogs = await pool
      .query(
        `SELECT id, user_id, staff_id, mission_desc, reward_miles, mission_count, created_at
         FROM doumori_mission_logs
         WHERE guild_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [guildId]
      )
      .then((res: any) => res.rows)
      .catch(() => []);

    // 5. Fetch Recent Mile Logs
    const mileLogs = await pool
      .query(
        `SELECT id, user_id, admin_id, amount, action, reason, created_at
         FROM doumori_mile_logs
         WHERE guild_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [guildId]
      )
      .then((res: any) => res.rows)
      .catch(() => []);

    // 6. Fetch Database URL
    const doumoriDbUrl = await getDoumoriDbUrl(guildId);

    // 7. Fetch Discord Channels & Roles
    let channels: any[] = [];
    let roles: any[] = [];

    if (token) {
      const [chRes, roRes] = await Promise.all([
        fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${token}` },
        }).catch(() => null),
        fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
          headers: { Authorization: `Bot ${token}` },
        }).catch(() => null),
      ]);

      if (chRes && chRes.ok) channels = await chRes.json();
      if (roRes && roRes.ok) roles = await roRes.json();
    }

    return NextResponse.json({
      settings: mergedSettings,
      missionsMaster,
      missionStats,
      ranksMaster,
      missionLogs,
      mileLogs,
      databaseUrl: doumoriDbUrl || '',
      channels: Array.isArray(channels) ? channels : [],
      roles: Array.isArray(roles) ? roles : [],
    });
  } catch (error: any) {
    console.error('GET /api/guilds/[guild_id]/doumori error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/guilds/[guild_id]/doumori
 */
export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const token = process.env.DISCORD_BOT_TOKEN;

  try {
    const body = await request.json();
    const { action, settings, mileOperation, panelRequest, mission, ranks, database_url } = body;
    const pool = await getDoumoriPool(guildId);

    // Case 0: Save Database URL
    if (action === 'save_database') {
      if (database_url) {
        let testPool: Pool | null = null;
        try {
          testPool = new Pool({ connectionString: database_url?.replace('?sslmode=require', ''), ssl: { rejectUnauthorized: false } });
          await testPool.query('SELECT 1');
        } catch (connErr: any) {
          if (testPool) await testPool.end().catch(() => {});
          return NextResponse.json({ error: `データベース接続テストに失敗しました: ${connErr.message}` }, { status: 400 });
        } finally {
          if (testPool) await testPool.end().catch(() => {});
        }
      }

      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS guild_databases (
            guild_id BIGINT PRIMARY KEY,
            database_url TEXT NOT NULL,
            doumori_database_url TEXT
        );
        ALTER TABLE guild_databases ADD COLUMN IF NOT EXISTS doumori_database_url TEXT;
      `).catch(() => {});

      await masterPool.query(
        `INSERT INTO guild_databases (guild_id, database_url, doumori_database_url)
         VALUES ($1, '', $2)
         ON CONFLICT (guild_id)
         DO UPDATE SET doumori_database_url = EXCLUDED.doumori_database_url`,
        [guildId, database_url || null]
      );

      return NextResponse.json({ success: true, message: 'どうぶつの森専用データベース設定を保存しました！' });
    }

    // Case 1: Create Mission
    if (action === 'create_mission' && mission) {
      const { title, description, target_rank = 0, reward_miles = 100 } = mission;
      if (!title || !description) {
        return NextResponse.json({ error: 'タイトルと達成条件は必須です' }, { status: 400 });
      }

      const res = await pool.query(
        `INSERT INTO doumori_missions_master (guild_id, title, description, target_rank, reward_miles, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING *`,
        [guildId, title, description, parseInt(target_rank, 10) || 0, parseInt(reward_miles, 10) || 100]
      );
      return NextResponse.json({ success: true, mission: res.rows[0], message: '新規ミッションを作成しました！' });
    }

    // Case 2: Update Mission
    if (action === 'update_mission' && mission) {
      const { id, title, description, target_rank, reward_miles, is_active } = mission;
      if (!id) {
        return NextResponse.json({ error: 'ミッションIDが指定されていません' }, { status: 400 });
      }

      const res = await pool.query(
        `UPDATE doumori_missions_master
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             target_rank = COALESCE($3, target_rank),
             reward_miles = COALESCE($4, reward_miles),
             is_active = COALESCE($5, is_active),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [
          title || null,
          description || null,
          target_rank !== undefined ? parseInt(target_rank, 10) : null,
          reward_miles !== undefined ? parseInt(reward_miles, 10) : null,
          is_active !== undefined ? Boolean(is_active) : null,
          id,
        ]
      );
      return NextResponse.json({ success: true, mission: res.rows[0], message: 'ミッションを更新しました！' });
    }

    // Case 3: Delete Mission
    if (action === 'delete_mission' && mission?.id) {
      await pool.query('DELETE FROM doumori_missions_master WHERE id = $1', [mission.id]);
      return NextResponse.json({ success: true, message: 'ミッションを削除しました。' });
    }

    // Case 4: Save Ranks Master
    if (action === 'save_ranks' && Array.isArray(ranks)) {
      for (const r of ranks) {
        await pool.query(
          `INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (level)
           DO UPDATE SET
             name = EXCLUDED.name,
             required_miles = EXCLUDED.required_miles,
             color = EXCLUDED.color,
             role_name = EXCLUDED.role_name,
             updated_at = CURRENT_TIMESTAMP`,
          [
            parseInt(r.level, 10),
            r.name || `Rank ${r.level}`,
            parseInt(r.required_miles, 10) || 0,
            r.color || '#3498DB',
            r.role_name || r.name,
          ]
        );
      }
      return NextResponse.json({ success: true, message: '階級・ランク設定を保存しました！' });
    }

    // Case 5: Manual Mile Action (Grant / Revoke)
    if (action === 'mile_operation' && mileOperation) {
      const { user_id, amount, op_type, reason, admin_id } = mileOperation;
      const numericAmount = Math.abs(parseInt(amount, 10) || 0);

      if (!user_id || numericAmount === 0) {
        return NextResponse.json({ error: '対象ユーザーIDと1以上のポイント数を指定してください。' }, { status: 400 });
      }

      const diff = op_type === 'revoke' ? -numericAmount : numericAmount;

      await pool.query(
        `INSERT INTO doumori_miles (guild_id, user_id, miles)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET miles = GREATEST(0, doumori_miles.miles + $3)`,
        [guildId, user_id, diff]
      );

      await pool.query(
        `INSERT INTO doumori_mile_logs (guild_id, user_id, admin_id, amount, action, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [guildId, user_id, admin_id || 0, numericAmount, op_type, reason || 'Dashboard操作']
      );

      return NextResponse.json({ success: true, message: `マイル${op_type === 'grant' ? '付与' : '没収'}が完了しました。` });
    }

    // Case 2: Send Control Panel to Discord Channel
    if (action === 'send_panel' && panelRequest) {
      const { channel_id, panel_title, panel_color } = panelRequest;

      if (!token || !channel_id) {
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
            value: '・**【魚図鑑】/【虫図鑑】**: 各図鑑と完成率を確認\n・**【両替】**: マイル/ベル ⇄ 図鑑チケット の相互両替\n・**【ダブり売却】**: 重複した生き物をまとめてベルに換金',
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

      const sendRes = await fetch(`https://discord.com/api/v10/channels/${channel_id}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed], components }),
      });

      if (!sendRes.ok) {
        const errJson = await sendRes.json().catch(() => ({}));
        return NextResponse.json({ error: `Discord送信エラー: ${errJson.message || sendRes.statusText}` }, { status: 400 });
      }

      return NextResponse.json({ success: true, message: 'チャンネルに総合操作パネルを正常に送信しました！' });
    }

    // Case 3: Save All Doumori Settings
    if (settings) {
      for (const [key, value] of Object.entries(settings)) {
        const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await pool.query(
          `INSERT INTO doumori_settings (guild_id, setting_key, setting_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id, setting_key)
           DO UPDATE SET setting_value = $3`,
          [guildId, key, strVal]
        );
      }
      return NextResponse.json({ success: true, message: '設定を正常に保存しました！' });
    }

    return NextResponse.json({ error: '無効なリクエストです' }, { status: 400 });
  } catch (error: any) {
    console.error('POST /api/guilds/[guild_id]/doumori error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
