import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

type Check = { label: string; ok: boolean; detail?: string };
type FeatureStatus = { ok: boolean; checks: Check[] };

const token = process.env.DISCORD_BOT_TOKEN;

async function discordGet(path: string): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null };
  }
}

async function checkChannel(channelId: string | null | undefined, label: string): Promise<Check | null> {
  if (!channelId) return null;
  const { status } = await discordGet(`/channels/${channelId}`);
  if (status === 200) return { label, ok: true };
  if (status === 404) return { label, ok: false, detail: 'チャンネルが削除されています' };
  if (status === 403) return { label, ok: false, detail: 'Botに閲覧権限がありません' };
  return { label, ok: false, detail: `確認できませんでした (HTTP ${status})` };
}

async function checkMessage(channelId: string | null | undefined, messageId: string | null | undefined, label: string): Promise<Check | null> {
  if (!channelId || !messageId) return null;
  const { status } = await discordGet(`/channels/${channelId}/messages/${messageId}`);
  if (status === 200) return { label, ok: true };
  if (status === 404) return { label, ok: false, detail: 'パネルのメッセージが見つかりません(削除された可能性)' };
  if (status === 403) return { label, ok: false, detail: 'Botにメッセージ閲覧権限がありません' };
  return { label, ok: false, detail: `確認できませんでした (HTTP ${status})` };
}

function checkRoleExists(roleId: string | null | undefined, roleMap: Map<string, any>, label: string): Check | null {
  if (!roleId) return null;
  const exists = roleMap.has(String(roleId));
  return { label, ok: exists, detail: exists ? undefined : 'ロールが削除されています' };
}

function finalize(checks: (Check | null)[]): FeatureStatus {
  const filtered = checks.filter((c): c is Check => c !== null);
  return { ok: filtered.every(c => c.ok), checks: filtered };
}

async function getSetting(pool: any, guildId: string, key: string): Promise<any> {
  const r = await pool.query(`SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2`, [guildId, key]);
  if (r.rows.length === 0) return null;
  try {
    return JSON.parse(r.rows[0].setting_value);
  } catch {
    return r.rows[0].setting_value;
  }
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);

    // ロール一覧を一度だけ取得(存在チェック用)
    const rolesRes = await discordGet(`/guilds/${guildId}/roles`);
    const roleMap = new Map<string, any>();
    if (rolesRes.status === 200 && Array.isArray(rolesRes.body)) {
      for (const r of rolesRes.body) roleMap.set(String(r.id), r);
    }

    const result: Record<string, FeatureStatus> = {};

    // --- 基本・評価設定 ---
    {
      const downgradeRoleId = await getSetting(pool, guildId, 'DOWNGRADE_ROLE_ID');
      const violatorRoleIds: string[] = (await getSetting(pool, guildId, 'GAMBLE_VIOLATOR_ROLE_IDS')) || [];
      const checks: (Check | null)[] = [
        checkRoleExists(downgradeRoleId, roleMap, '評価落ちロール'),
      ];
      for (const rid of violatorRoleIds) checks.push(checkRoleExists(rid, roleMap, '違反者ロール'));
      result['index'] = finalize(checks);
    }

    // --- VCルーム設定 / 評価落ちVCアクセス制御 (基本設定と同じロールに依存) ---
    result['rooms'] = { ok: true, checks: [] };
    result['room-access'] = result['index'];

    // --- VCトリガー設定 ---
    {
      const triggers = await pool.query(`SELECT channel_id FROM auto_vc_triggers`);
      const checks: (Check | null)[] = [];
      for (const row of triggers.rows) {
        checks.push(await checkChannel(row.channel_id?.toString(), `トリガーチャンネル (${row.channel_id})`));
      }
      result['vc-triggers'] = finalize(checks);
    }

    // --- VCコイン獲得制限 ---
    result['vc-coins'] = { ok: true, checks: [] };

    // --- ショップ設定 ---
    {
      const shop = await pool.query(`SELECT employee_role_id, manager_role_id FROM shop_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (shop.rows.length > 0) {
        checks.push(checkRoleExists(shop.rows[0].employee_role_id?.toString(), roleMap, '店員ロール'));
        checks.push(checkRoleExists(shop.rows[0].manager_role_id?.toString(), roleMap, '管理ロール'));
      }
      result['shop'] = finalize(checks);
    }

    // --- チケット設定 (カスタムチケットパネルのメッセージ存在確認) ---
    {
      const panels = await pool.query(`SELECT channel_id FROM custom_ticket_panels`);
      const checks: (Check | null)[] = [];
      for (const row of panels.rows) {
        checks.push(await checkChannel(row.channel_id?.toString(), `チケットパネル設置先 (${row.channel_id})`));
      }
      result['tickets'] = finalize(checks);
    }

    // --- ランク設定 ---
    {
      const rank = await pool.query(`SELECT whitelist_channel_ids, blacklist_channel_ids FROM rank_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (rank.rows.length > 0) {
        for (const cid of rank.rows[0].whitelist_channel_ids || []) {
          checks.push(await checkChannel(cid?.toString(), `対象チャンネル (${cid})`));
        }
      }
      result['rank'] = finalize(checks);
    }

    // --- 評価関連設定 ---
    {
      const ev = await pool.query(`SELECT forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (ev.rows.length > 0) {
        for (const cid of ev.rows[0].forum_channel_ids || []) {
          checks.push(await checkChannel(cid?.toString(), `評価フォーラム (${cid})`));
        }
        for (const cid of ev.rows[0].self_intro_channel_ids || []) {
          checks.push(await checkChannel(cid?.toString(), `自己紹介チャンネル (${cid})`));
        }
      }
      result['eval-sheet'] = finalize(checks);
    }

    // --- 経済・レベリング設定 / ギャンブル設定 (通貨系。特定チャンネル/ロール依存が薄いため簡易) ---
    result['economy'] = { ok: true, checks: [] };
    {
      const bankerRoleIds: string[] = (await getSetting(pool, guildId, 'BANKER_ROLE_IDS')) || [];
      const checks: (Check | null)[] = bankerRoleIds.map((rid: string) => checkRoleExists(rid, roleMap, '銀行員ロール'));
      result['gambling'] = finalize(checks);
    }

    // --- レベル到達報酬 ---
    {
      const rewards = await pool.query(`SELECT DISTINCT role_id FROM level_role_rewards WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = rewards.rows.map((row: any) => checkRoleExists(row.role_id?.toString(), roleMap, `報酬ロール (${row.role_id})`));
      result['level-rewards'] = finalize(checks);
    }

    // --- 面接官設定 / コマンド設定 / アカウント設定 (外部リソース依存が薄い) ---
    result['interviewer'] = { ok: true, checks: [] };
    result['commands'] = { ok: true, checks: [] };
    result['accounts'] = { ok: true, checks: [] };

    // --- ログ出力設定 ---
    {
      const logs = await pool.query(`SELECT log_type, channel_id, is_enabled FROM log_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      for (const row of logs.rows) {
        if (!row.is_enabled) continue;
        checks.push(await checkChannel(row.channel_id?.toString(), `${row.log_type} ログチャンネル`));
      }
      result['logs'] = finalize(checks);
    }

    // --- データベース設定 (接続確認) ---
    {
      const checks: (Check | null)[] = [];
      try {
        await pool.query('SELECT 1');
        checks.push({ label: '専用データベース接続', ok: true });
      } catch (e: any) {
        checks.push({ label: '専用データベース接続', ok: false, detail: e?.message || '接続に失敗しました' });
      }
      result['database'] = finalize(checks);
    }

    // --- 条件ロール付与設定 ---
    {
      const settings = await pool.query(
        `SELECT channel_id, welcome_channel_id, role_id, is_enabled FROM self_intro_role_settings WHERE guild_id = $1`,
        [guildId]
      );
      const checks: (Check | null)[] = [];
      if (settings.rows.length > 0 && settings.rows[0].is_enabled) {
        const row = settings.rows[0];
        checks.push(await checkChannel(row.channel_id?.toString(), '自己紹介チャンネル'));
        checks.push(await checkChannel(row.welcome_channel_id?.toString(), 'ようこそチャンネル'));
        checks.push(checkRoleExists(row.role_id?.toString(), roleMap, '付与ロール'));
      }
      result['self-intro-role'] = finalize(checks);
    }

    // --- 荒らし対策設定 ---
    {
      const ag = await pool.query(`SELECT target_channel_ids, exempt_role_ids FROM antigrief_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (ag.rows.length > 0) {
        for (const cid of ag.rows[0].target_channel_ids || []) {
          checks.push(await checkChannel(cid?.toString(), `監視対象チャンネル (${cid})`));
        }
        for (const rid of ag.rows[0].exempt_role_ids || []) {
          checks.push(checkRoleExists(rid?.toString(), roleMap, '除外ロール'));
        }
      }
      result['antigrief'] = finalize(checks);
    }

    // --- その他パネル設定 (リアクションロールの付与先ロール確認) ---
    {
      const rr = await pool.query(`SELECT DISTINCT role_id FROM reaction_roles`);
      const checks: (Check | null)[] = rr.rows.map((row: any) => checkRoleExists(row.role_id?.toString(), roleMap, `付与ロール (${row.role_id})`));
      result['other-panels'] = finalize(checks);
    }

    // --- 通話募集掲示板設定 (call-board) ---
    {
      const cb = await pool.query(`SELECT panel_channel_id, board_channel_id FROM call_board_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (cb.rows.length > 0) {
        checks.push(await checkChannel(cb.rows[0].panel_channel_id?.toString(), 'パネル設置チャンネル'));
        checks.push(await checkChannel(cb.rows[0].board_channel_id?.toString(), '募集掲示チャンネル'));
      }
      result['call-board'] = finalize(checks);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[health] GET error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
