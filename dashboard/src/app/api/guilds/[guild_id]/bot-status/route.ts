import { NextResponse } from 'next/server';
import { getPool, masterPool } from '@/lib/db';

/**
 * GET /api/guilds/[guild_id]/bot-status
 *
 * サーバーとBot本体、データベース、各機能モジュールの連携・動作状況を総合診断するAPI。
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
    permissions: [] as string[],
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
    } catch (e: any) {
      discordStatus.error = e?.message || String(e);
    }
  }

  // 4. 各設定モジュールの連携状態
  const modules: Record<string, { configured: boolean; summary: string; detail?: any }> = {};

  if (pool) {
    try {
      // 荒らし対策 (Anti-Grief)
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
        detail: { enabled: agEnabled, exemptRolesCount: agRow?.exempt_role_ids?.length || 0 },
      };
    } catch {
      modules['antigrief'] = { configured: false, summary: '未設定 / 読み込み失敗' };
    }

    try {
      // VCトリガー (Auto VC)
      const vcRes = await pool.query('SELECT COUNT(*) as count FROM auto_vc_triggers');
      const count = Number(vcRes.rows[0]?.count || 0);
      modules['vc_triggers'] = {
        configured: count > 0,
        summary: count > 0 ? `${count}件のトリガーVCが登録中` : 'トリガー未登録',
        detail: { count },
      };
    } catch {
      modules['vc_triggers'] = { configured: false, summary: '未設定' };
    }

    try {
      // 通話募集掲示板 (Call Board)
      const cbRes = await pool.query('SELECT panel_channel_id, board_channel_id, vc_category_id FROM call_board_settings WHERE guild_id = $1', [guildId]);
      if (cbRes.rows.length > 0 && cbRes.rows[0].panel_channel_id) {
        modules['call_board'] = {
          configured: true,
          summary: '設定済み (募集パネル/一覧チャンネル連携中)',
          detail: cbRes.rows[0],
        };
      } else {
        modules['call_board'] = {
          configured: false,
          summary: '未設置 (パネルチャンネル未指定)',
        };
      }
    } catch {
      modules['call_board'] = { configured: false, summary: '未設定' };
    }

    try {
      // VCコイン (VC Coins)
      const vccRes = await pool.query('SELECT is_enabled, whitelist_channels, blacklist_channels FROM vc_coins_settings WHERE guild_id = $1', [guildId]);
      const vccRow = vccRes.rows[0];
      modules['vc_coins'] = {
        configured: vccRow ? (vccRow.is_enabled !== false) : false,
        summary: vccRow ? (vccRow.is_enabled !== false ? '稼働中 (コイン付与中)' : '無効化中') : 'デフォルト動作',
      };
    } catch {
      modules['vc_coins'] = { configured: false, summary: '未設定' };
    }

    try {
      // ショップ (Shop)
      const shopRes = await pool.query('SELECT COUNT(*) as count FROM shop_items WHERE guild_id = $1 AND is_active = TRUE', [guildId]);
      const shopCount = Number(shopRes.rows[0]?.count || 0);
      modules['shop'] = {
        configured: shopCount > 0,
        summary: shopCount > 0 ? `${shopCount}品目のアイテムが販売中` : '商品未登録',
        detail: { activeItemsCount: shopCount },
      };
    } catch {
      modules['shop'] = { configured: false, summary: '未設定' };
    }

    try {
      // カスタムチケット (Tickets)
      const tRes = await pool.query('SELECT COUNT(*) as count FROM custom_ticket_panels WHERE guild_id = $1', [guildId]);
      const tCount = Number(tRes.rows[0]?.count || 0);
      modules['tickets'] = {
        configured: tCount > 0,
        summary: tCount > 0 ? `${tCount}件のチケットパネルが登録中` : 'パネル未登録',
      };
    } catch {
      modules['tickets'] = { configured: false, summary: '未設定' };
    }

    try {
      // ログ出力 (Logging)
      const logRes = await pool.query('SELECT COUNT(*) as count FROM log_settings WHERE guild_id = $1', [guildId]);
      const logCount = Number(logRes.rows[0]?.count || 0);
      modules['logs'] = {
        configured: logCount > 0,
        summary: logCount > 0 ? `${logCount}種類のログチャンネルを設定中` : 'ログ出力未設定',
      };
    } catch {
      modules['logs'] = { configured: false, summary: '未設定' };
    }

    try {
      // 面接官設定 (Interviewer)
      const intRes = await pool.query('SELECT COUNT(*) as count FROM interviewer_logs WHERE guild_id = $1', [guildId]);
      modules['interviewer'] = {
        configured: true,
        summary: `面接ログ記録件数: ${Number(intRes.rows[0]?.count || 0)}件`,
      };
    } catch {
      modules['interviewer'] = { configured: false, summary: '未設定' };
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
