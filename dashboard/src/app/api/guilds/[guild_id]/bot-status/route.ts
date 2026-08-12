import { NextResponse } from 'next/server';
import { getPool, masterPool } from '@/lib/db';

/**
 * GET /api/guilds/[guild_id]/bot-status
 *
 * サーバーとBot本体、データベース、および全21個の設定モジュールの連携・動作状況を総合診断するAPI。
 */
export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  const token = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;

  // 1. データベース接続・種別確認
  let dbStatus = {
    ok: false,
    latencyMs: 0,
    isDedicated: false,
    databaseUrlMasked: null as string | null,
    error: null as string | null,
  };

  let pool;
  try {
    const dbStart = Date.now();
    pool = await getPool(guildId);
    await pool.query('SELECT 1');
    dbStatus.latencyMs = Date.now() - dbStart;
    dbStatus.ok = true;

    // 専用DBかチェック
    try {
      const dedicatedRes = await masterPool.query(
        'SELECT database_url FROM guild_databases WHERE guild_id = $1',
        [guildId]
      );
      if (dedicatedRes.rows.length > 0 && dedicatedRes.rows[0].database_url) {
        dbStatus.isDedicated = true;
        const rawUrl = dedicatedRes.rows[0].database_url as string;
        try {
          const parsed = new URL(rawUrl);
          dbStatus.databaseUrlMasked = `${parsed.protocol}//${parsed.username}:****@${parsed.host}${parsed.pathname}`;
        } catch {
          dbStatus.databaseUrlMasked = 'カスタムSupabase接続中';
        }
      }
    } catch {}
  } catch (e: any) {
    dbStatus.ok = false;
    dbStatus.error = e?.message || String(e);
  }

  // 2. Bot本体の稼働状況 (Heartbeat & Render Ping)
  let botStatus = {
    ok: false,
    latencyMs: null as number | null,
    secondsAgo: null as number | null,
    lastSeenAt: null as string | null,
    renderConfigured: false,
  };

  const healthUrl = process.env.RENDER_BOT_HEALTH_URL;
  if (healthUrl) {
    botStatus.renderConfigured = true;
    try {
      const renderStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      if (res.ok) {
        botStatus.ok = true;
        botStatus.latencyMs = Date.now() - renderStart;
      }
    } catch {}
  }

  if (pool) {
    try {
      const hbResult = await pool.query(
        'SELECT last_seen_at FROM bot_heartbeat WHERE guild_id = $1',
        [guildId]
      );
      if (hbResult.rows.length > 0) {
        const lastSeen = new Date(hbResult.rows[0].last_seen_at);
        botStatus.lastSeenAt = lastSeen.toISOString();
        const diffMs = Date.now() - lastSeen.getTime();
        botStatus.secondsAgo = Math.max(0, Math.floor(diffMs / 1000));
        if (diffMs < 60_000) {
          botStatus.ok = true;
          if (botStatus.latencyMs === null) {
            botStatus.latencyMs = Math.floor(diffMs / 10);
          }
        }
      }
    } catch {}
  }

  // 3. Discord API経由でのBot・ギルド連携状況
  let discordStatus = {
    ok: false,
    guildName: null as string | null,
    guildIcon: null as string | null,
    memberCount: null as number | null,
    botInGuild: false,
    latencyMs: 0,
    channelIds: [] as string[],
    error: null as string | null,
  };

  if (token) {
    try {
      const dStart = Date.now();
      const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
        headers: { Authorization: `Bot ${token}` },
        cache: 'no-store',
      });
      discordStatus.latencyMs = Date.now() - dStart;

      if (guildRes.ok) {
        const gData = await guildRes.json();
        discordStatus.ok = true;
        discordStatus.botInGuild = true;
        discordStatus.guildName = gData.name;
        discordStatus.guildIcon = gData.icon ? `https://cdn.discordapp.com/icons/${guildId}/${gData.icon}.png` : null;
        discordStatus.memberCount = gData.approximate_member_count ?? null;
      } else {
        discordStatus.error = `Discord API: HTTP ${guildRes.status}`;
      }

      // チャンネル一覧も取得
      try {
        const chRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${token}` },
          cache: 'no-store',
        });
        if (chRes.ok) {
          const chData = await chRes.json();
          discordStatus.channelIds = chData.map((c: any) => String(c.id));
        }
      } catch {}
    } catch (e: any) {
      discordStatus.error = e?.message || String(e);
    }
  }

  // 4. 全機能モジュールの連携状態を網羅的に診断
  const modules: Record<string, { configured: boolean; summary: string; detail?: any }> = {};

  if (pool) {
    // 1) 基本・評価設定 (General Settings)
    try {
      const gRes = await pool.query('SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1', [guildId]);
      const settingCount = gRes.rows.length;
      modules['general'] = {
        configured: settingCount > 0,
        summary: settingCount > 0 ? `${settingCount}項目のサーバー基本設定が連携中` : '未設定 (初期値)',
      };
    } catch {
      modules['general'] = { configured: false, summary: '未設定' };
    }

    // 2) 荒らし対策機能 (Anti-Grief)
    try {
      const agRes = await pool.query('SELECT * FROM antigrief_settings WHERE guild_id = $1', [guildId]);
      const agEnabledRes = await pool.query("SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = 'ENABLE_ANTIGRIEF'", [guildId]);
      let agEnabled = true;
      if (agEnabledRes.rows.length > 0) {
        try { agEnabled = JSON.parse(agEnabledRes.rows[0].setting_value); } catch { agEnabled = agEnabledRes.rows[0].setting_value === 'true'; }
      }
      const agRow = agRes.rows[0];
      modules['antigrief'] = {
        configured: agEnabled,
        summary: agEnabled
          ? `稼働中 (対象カテゴリ: ${agRow?.target_category_ids?.length || 0}件, チャンネル: ${agRow?.target_channel_ids?.length || 0}件)`
          : '機能オフ (無効化中)',
      };
    } catch {
      modules['antigrief'] = { configured: false, summary: '未設定' };
    }

    // 3) 自動VCトリガー (Auto VC Triggers)
    try {
      let count = 0;
      if (discordStatus.channelIds.length > 0) {
        const placeholders = discordStatus.channelIds.map((_, i) => `$${i + 1}`).join(',');
        const vcRes = await pool.query(`SELECT COUNT(*) as count FROM auto_vc_triggers WHERE channel_id::text IN (${placeholders})`, discordStatus.channelIds);
        count = Number(vcRes.rows[0]?.count || 0);
      } else {
        const vcRes = await pool.query('SELECT COUNT(*) as count FROM auto_vc_triggers');
        count = Number(vcRes.rows[0]?.count || 0);
      }
      modules['vc_triggers'] = {
        configured: count > 0,
        summary: count > 0 ? `${count}件のトリガーVCが登録中` : 'トリガー未登録',
      };
    } catch {
      modules['vc_triggers'] = { configured: false, summary: '未設定' };
    }

    // 4) 通話募集掲示板 (Call Board)
    try {
      const cbRes = await pool.query('SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1', [guildId]);
      if (cbRes.rows.length > 0) {
        const row = cbRes.rows[0];
        const isConfigured = !!(row.panel_channel_id || row.board_channel_id || row.vc_category_id);
        const details = [];
        if (row.panel_channel_id) details.push('パネル設置');
        if (row.board_channel_id) details.push('募集一覧');
        if (row.vc_category_id) details.push('VCカテゴリ');
        
        modules['call_board'] = {
          configured: isConfigured,
          summary: isConfigured ? `連携中 (${details.join('・')})` : '設定チャンネル未指定',
        };
      } else {
        modules['call_board'] = { configured: false, summary: '未設定 (初期状態)' };
      }
    } catch {
      modules['call_board'] = { configured: false, summary: '未設定' };
    }

    // 5) VCコイン獲得制限 (VC Coins)
    try {
      const vccRes = await pool.query('SELECT is_enabled, whitelist_channels, blacklist_channels, vc_interval_min, vc_coins_per_interval FROM vc_coins_settings WHERE guild_id = $1', [guildId]);
      const botCoinsRes = await pool.query("SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('vc_coin_reward_interval', 'vc_coin_reward_amount', 'is_whitelist_mode', 'channels', 'categories')", [guildId]);
      
      const hasBotCoins = botCoinsRes.rows.length > 0;
      const vccRow = vccRes.rows[0];
      
      let isEnabled = true;
      let interval = 10;
      let amount = 100;
      
      if (vccRow) {
        isEnabled = vccRow.is_enabled !== false;
        interval = vccRow.vc_interval_min || 10;
        amount = vccRow.vc_coins_per_interval || 100;
      }
      
      for (const r of botCoinsRes.rows) {
        if (r.setting_key === 'vc_coin_reward_interval') interval = Number(r.setting_value) || interval;
        if (r.setting_key === 'vc_coin_reward_amount') amount = Number(r.setting_value) || amount;
      }

      modules['vc_coins'] = {
        configured: isEnabled || hasBotCoins,
        summary: isEnabled ? `稼働中 (${interval}分ごとに${amount}コイン付与)` : '無効化中',
      };
    } catch {
      modules['vc_coins'] = { configured: true, summary: 'デフォルト動作中 (10分ごと付与)' };
    }

    // 6) ショップ設定 (Shop)
    try {
      const shopItemsRes = await pool.query('SELECT COUNT(*) as count FROM shop_items WHERE guild_id = $1', [guildId]);
      const shopSetRes = await pool.query('SELECT employee_role_id, manager_role_id FROM shop_settings WHERE guild_id = $1', [guildId]);
      const count = Number(shopItemsRes.rows[0]?.count || 0);
      const hasRoles = shopSetRes.rows.length > 0 && (shopSetRes.rows[0].employee_role_id || shopSetRes.rows[0].manager_role_id);
      
      modules['shop'] = {
        configured: count > 0 || hasRoles,
        summary: count > 0 ? `${count}品目のアイテムが出品・販売中` : (hasRoles ? '役職ロール設定済み (商品0件)' : '商品未登録'),
      };
    } catch {
      modules['shop'] = { configured: false, summary: '未設定' };
    }

    // 7) チケット設定 (Tickets)
    try {
      let count = 0;
      if (discordStatus.channelIds.length > 0) {
        const placeholders = discordStatus.channelIds.map((_, i) => `$${i + 1}`).join(',');
        const tRes = await pool.query(`SELECT COUNT(*) as count FROM custom_ticket_panels WHERE channel_id::text IN (${placeholders})`, discordStatus.channelIds);
        count = Number(tRes.rows[0]?.count || 0);
      } else {
        const tRes = await pool.query('SELECT COUNT(*) as count FROM custom_ticket_panels');
        count = Number(tRes.rows[0]?.count || 0);
      }
      modules['tickets'] = {
        configured: count > 0,
        summary: count > 0 ? `${count}件のチケットパネルが連携中` : 'パネル未設置',
      };
    } catch {
      modules['tickets'] = { configured: false, summary: '未設定' };
    }

    // 8) ランク設定 (Rank)
    try {
      const rRes = await pool.query('SELECT is_enabled, vc_multiplier, msg_multiplier FROM rank_settings WHERE guild_id = $1', [guildId]);
      const rRow = rRes.rows[0];
      modules['rank'] = {
        configured: rRow ? (rRow.is_enabled !== false) : false,
        summary: rRow ? (rRow.is_enabled !== false ? '稼働中 (XP集計・ランクアップ有効)' : '無効化中') : '未設定',
      };
    } catch {
      modules['rank'] = { configured: false, summary: '未設定' };
    }

    // 9) 評価関連設定 (Evaluation / Sheet)
    try {
      const evalRes = await pool.query('SELECT is_enabled, auto_generate FROM evaluation_settings WHERE guild_id = $1', [guildId]);
      const evalRow = evalRes.rows[0];
      modules['eval_sheet'] = {
        configured: evalRow ? (evalRow.is_enabled !== false) : false,
        summary: evalRow ? (evalRow.is_enabled !== false ? '稼働中 (評価フォーラム・自動生成)' : '無効化中') : '未設定',
      };
    } catch {
      modules['eval_sheet'] = { configured: false, summary: '未設定' };
    }

    // 10) 経済・レベリング設定 (Economy & Users)
    try {
      const userRes = await pool.query('SELECT COUNT(*) as count FROM users WHERE guild_id = $1', [guildId]);
      const userCount = Number(userRes.rows[0]?.count || 0);
      modules['economy'] = {
        configured: true,
        summary: `ユーザー経済データ連携中 (${userCount}名の残高・XP記録)`,
      };
    } catch {
      modules['economy'] = { configured: true, summary: '経済システム稼働中' };
    }

    // 11) ギャンブル設定 (Gambling)
    try {
      const gambleRes = await pool.query("SELECT setting_key FROM bot_settings WHERE guild_id = $1 AND setting_key LIKE 'GAMBLE_%'", [guildId]);
      const count = gambleRes.rows.length;
      modules['gambling'] = {
        configured: count > 0,
        summary: count > 0 ? `設定済み (${count}項目のルール設定連携中)` : '標準ルールで稼働中',
      };
    } catch {
      modules['gambling'] = { configured: true, summary: '標準稼働中' };
    }

    // 12) レベル到達報酬 (Level Rewards)
    try {
      const lrRoleRes = await pool.query('SELECT COUNT(*) as count FROM level_role_rewards WHERE guild_id = $1', [guildId]);
      const lrCoinRes = await pool.query('SELECT COUNT(*) as count FROM level_coin_rewards WHERE guild_id = $1', [guildId]);
      const roleCount = Number(lrRoleRes.rows[0]?.count || 0);
      const coinCount = Number(lrCoinRes.rows[0]?.count || 0);
      const total = roleCount + coinCount;
      modules['level_rewards'] = {
        configured: total > 0,
        summary: total > 0 ? `${total}件の到達報酬 (ロール: ${roleCount}, コイン: ${coinCount})` : '報酬未登録',
      };
    } catch {
      modules['level_rewards'] = { configured: false, summary: '未設定' };
    }

    // 13) コマンド設定 (Commands)
    try {
      const cmdRes = await pool.query('SELECT COUNT(*) as count FROM command_settings WHERE guild_id = $1', [guildId]);
      const count = Number(cmdRes.rows[0]?.count || 0);
      modules['commands'] = {
        configured: true,
        summary: count > 0 ? `${count}件の個別コマンド制御設定` : '全スラッシュコマンド利用可能 (標準)',
      };
    } catch {
      modules['commands'] = { configured: true, summary: '全コマンド利用可能' };
    }

    // 14) ログ出力設定 (Logs)
    try {
      const logRes = await pool.query('SELECT COUNT(*) as count FROM log_settings WHERE guild_id = $1', [guildId]);
      const logCount = Number(logRes.rows[0]?.count || 0);
      modules['logs'] = {
        configured: logCount > 0,
        summary: logCount > 0 ? `${logCount}種類のログチャンネルを設定中` : 'ログ出力未設定',
      };
    } catch {
      modules['logs'] = { configured: false, summary: '未設定' };
    }

    // 15) 面接官設定 (Interviewer)
    try {
      const intRes = await pool.query('SELECT COUNT(*) as count FROM interviewer_logs WHERE guild_id = $1', [guildId]);
      const count = Number(intRes.rows[0]?.count || 0);
      modules['interviewer'] = {
        configured: count > 0,
        summary: count > 0 ? `面接ログ記録件数: ${count}件` : '面接ログ待機中',
      };
    } catch {
      modules['interviewer'] = { configured: true, summary: '面接官システム準備完了' };
    }

    // 16) 条件ロール付与・自己紹介 (Self Intro / Roles)
    try {
      const siRes = await pool.query('SELECT is_enabled, channel_id, role_id FROM self_intro_role_settings WHERE guild_id = $1', [guildId]);
      const rrRes = await pool.query('SELECT COUNT(*) as count FROM reaction_roles WHERE message_id IN (SELECT message_id FROM inquiry_panels WHERE guild_id = $1)', [guildId]).catch(() => ({ rows: [{ count: 0 }] }));
      const siRow = siRes.rows[0];
      const isSiConfigured = siRow && (siRow.channel_id || siRow.role_id);
      
      modules['self_intro_role'] = {
        configured: isSiConfigured || Number(rrRes.rows[0]?.count || 0) > 0,
        summary: isSiConfigured ? '設定済み (自己紹介チャンネル監視中)' : '未設定',
      };
    } catch {
      modules['self_intro_role'] = { configured: false, summary: '未設定' };
    }

    // 17) VCルーム・宿設定 (Rooms & Inn)
    try {
      const rpRes = await pool.query('SELECT COUNT(*) as count FROM room_prices');
      const rrpRes = await pool.query('SELECT COUNT(*) as count FROM role_room_prices');
      const total = Number(rpRes.rows[0]?.count || 0) + Number(rrpRes.rows[0]?.count || 0);
      modules['rooms'] = {
        configured: total > 0,
        summary: total > 0 ? `${total}件の部屋価格・ロール価格設定が連携中` : 'デフォルト価格で稼働中',
      };
    } catch {
      modules['rooms'] = { configured: true, summary: '部屋システム稼働中' };
    }

    // 18) 評価落ちVCアクセス制御 (Room Access)
    try {
      const raRes = await pool.query("SELECT setting_key FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('DOWNGRADE_ROLE_ID', 'ROOM_ACCESS_DENY_ROLES', 'GAMBLE_VIOLATOR_ROLE_IDS')", [guildId]);
      modules['room_access'] = {
        configured: raRes.rows.length > 0,
        summary: raRes.rows.length > 0 ? 'ロール別アクセス拒否・制限ルール連携中' : '全ロールアクセス可能 (制限なし)',
      };
    } catch {
      modules['room_access'] = { configured: false, summary: '未設定' };
    }

    // 19) その他パネル設定 (Other Panels)
    try {
      const opRes = await pool.query('SELECT COUNT(*) as count FROM inquiry_panels WHERE guild_id = $1', [guildId]);
      const count = Number(opRes.rows[0]?.count || 0);
      modules['other_panels'] = {
        configured: count > 0,
        summary: count > 0 ? `${count}件の問い合わせ・追加パネル設置中` : 'パネル未設置',
      };
    } catch {
      modules['other_panels'] = { configured: false, summary: '未設置' };
    }

    // 20) データベース設定 (Database)
    modules['database'] = {
      configured: dbStatus.ok,
      summary: dbStatus.isDedicated ? '専用Supabase接続中 (完全独立)' : '共有マスターDB利用中',
    };

    // 21) アカウント設定 (Accounts)
    try {
      const accRes = await masterPool.query('SELECT COUNT(*) as count FROM dashboard_users WHERE guild_id = $1', [guildId]);
      const count = Number(accRes.rows[0]?.count || 0);
      modules['accounts'] = {
        configured: count > 0,
        summary: count > 0 ? `${count}名のサーバー限定管理者アカウント登録中` : 'マスター管理者のみ',
      };
    } catch {
      modules['accounts'] = { configured: false, summary: '未設定' };
    }
  }

  // 5. IPC保留中リクエスト
  let pendingIpcCount = 0;
  if (pool) {
    try {
      const ipcRes = await pool.query('SELECT COUNT(*) as count FROM panel_requests WHERE guild_id = $1', [guildId]);
      pendingIpcCount = Number(ipcRes.rows[0]?.count || 0);
    } catch {}
  }

  return NextResponse.json({
    db: dbStatus,
    bot: botStatus,
    discord: discordStatus,
    modules,
    ipc: {
      pendingCount: pendingIpcCount,
      synchronized: pendingIpcCount === 0,
    },
    checkedAt: new Date().toISOString(),
  });
}
