import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureAllSchemas } from '@/lib/migrations';

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
  try {
    const r = await pool.query(`SELECT setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = $2`, [guildId, key]);
    if (r.rows.length === 0) return null;
    try {
      return JSON.parse(r.rows[0].setting_value);
    } catch {
      return r.rows[0].setting_value;
    }
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;

  try {
    const pool = await getPool(guildId);
    
    // スキーマの自動補完・移行
    try {
      await ensureAllSchemas(pool);
    } catch (migErr) {
      console.warn('[health] ensureAllSchemas warning:', migErr);
    }

    // ギルドのロール一覧をまとめて取得(キャッシュ効率化)
    const rolesRes = await discordGet(`/guilds/${guildId}/roles`);
    const roles: any[] = rolesRes.status === 200 && Array.isArray(rolesRes.body) ? rolesRes.body : [];
    const roleMap = new Map<string, any>(roles.map(r => [String(r.id), r]));

    const result: Record<string, FeatureStatus> = {};

    // --- ルーム設定 (VC価格パネルのメッセージ存在確認) ---
    try {
      const panel = await pool.query(`SELECT channel_id, message_id FROM room_panels WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (panel.rows.length > 0) {
        checks.push(await checkChannel(panel.rows[0].channel_id?.toString(), 'パネル設置チャンネル'));
        checks.push(await checkMessage(panel.rows[0].channel_id?.toString(), panel.rows[0].message_id?.toString(), '価格パネルメッセージ'));
      }
      result['rooms'] = finalize(checks);
    } catch (e: any) {
      result['rooms'] = { ok: false, checks: [{ label: 'ルーム設定', ok: false, detail: e.message }] };
    }

    // --- 面接・入界設定 (主要ロール確認) ---
    try {
      const pendingRoleId = await getSetting(pool, guildId, 'PENDING_MEMBER_ROLE_ID');
      const interviewerRoleIds: string[] = (await getSetting(pool, guildId, 'INTERVIEWER_ROLE_IDS')) || [];
      const checks: (Check | null)[] = [
        checkRoleExists(pendingRoleId, roleMap, '面接中(仮入界)ロール'),
        ...interviewerRoleIds.map((rid: string) => checkRoleExists(rid, roleMap, '面接官ロール')),
      ];
      result['interview'] = finalize(checks);
    } catch (e: any) {
      result['interview'] = { ok: false, checks: [{ label: '面接設定', ok: false, detail: e.message }] };
    }

    // --- 通話募集掲示板設定 (旧版/補助) ---
    try {
      const callChannelId = await getSetting(pool, guildId, 'CALL_RECRUITMENT_CHANNEL_ID');
      const checks: (Check | null)[] = [
        await checkChannel(callChannelId, '通話募集チャンネル'),
      ];
      result['call'] = finalize(checks);
    } catch (e: any) {
      result['call'] = { ok: false, checks: [{ label: '通話募集設定', ok: false, detail: e.message }] };
    }

    // --- VCトリガー設定 ---
    try {
      const triggers = await pool.query(`SELECT channel_id FROM auto_vc_triggers`);
      const checks: (Check | null)[] = [];
      for (const row of triggers.rows) {
        checks.push(await checkChannel(row.channel_id?.toString(), `作成トリガーVC (${row.channel_id})`));
      }
      result['vc-triggers'] = finalize(checks);
    } catch (e: any) {
      result['vc-triggers'] = { ok: false, checks: [{ label: 'VCトリガー設定', ok: false, detail: e.message }] };
    }

    // --- VCコイン獲得制限 ---
    result['vc-coins'] = { ok: true, checks: [] };

    // --- ショップ設定 ---
    try {
      const shop = await pool.query(`SELECT employee_role_id, manager_role_id FROM shop_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (shop.rows.length > 0) {
        checks.push(checkRoleExists(shop.rows[0].employee_role_id?.toString(), roleMap, '店員ロール'));
        checks.push(checkRoleExists(shop.rows[0].manager_role_id?.toString(), roleMap, '管理ロール'));
      }
      result['shop'] = finalize(checks);
    } catch (e: any) {
      result['shop'] = { ok: false, checks: [{ label: 'ショップ設定', ok: false, detail: e.message }] };
    }

    // --- チケット設定 (カスタムチケットパネルのメッセージ存在確認) ---
    try {
      const panels = await pool.query(`SELECT channel_id FROM custom_ticket_panels`);
      const checks: (Check | null)[] = [];
      for (const row of panels.rows) {
        checks.push(await checkChannel(row.channel_id?.toString(), `チケットパネル設置先 (${row.channel_id})`));
      }
      result['tickets'] = finalize(checks);
    } catch (e: any) {
      result['tickets'] = { ok: false, checks: [{ label: 'チケット設定', ok: false, detail: e.message }] };
    }

    // --- ランク設定 ---
    try {
      const rank = await pool.query(`SELECT whitelist_channel_ids, blacklist_channel_ids FROM rank_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (rank.rows.length > 0) {
        for (const cid of rank.rows[0].whitelist_channel_ids || []) {
          checks.push(await checkChannel(cid?.toString(), `対象チャンネル (${cid})`));
        }
      }
      result['rank'] = finalize(checks);
    } catch (e: any) {
      result['rank'] = { ok: false, checks: [{ label: 'ランク設定', ok: false, detail: e.message }] };
    }

    // --- 評価関連設定 ---
    try {
      const ev = await pool.query(`SELECT forum_channel_ids, self_intro_channel_ids FROM evaluation_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (ev.rows.length > 0) {
        const cleanIds = (arr: any[]) => {
          if (!Array.isArray(arr)) return [];
          const strings = arr.map(String).filter(id => id && id.length > 5);
          const valid = strings.filter(id => !(id.length >= 18 && id.endsWith('00')));
          return Array.from(new Set(valid));
        };
        const rawForums = ev.rows[0].forum_channel_ids || [];
        const rawIntros = ev.rows[0].self_intro_channel_ids || [];
        const cleanForums = cleanIds(rawForums);
        const cleanIntros = cleanIds(rawIntros);

        // 不正IDや重複があれば即座にDBをクリーンアップ
        if (
          JSON.stringify(cleanForums) !== JSON.stringify(rawForums.map(String)) ||
          JSON.stringify(cleanIntros) !== JSON.stringify(rawIntros.map(String))
        ) {
          try {
            await pool.query(
              `UPDATE evaluation_settings SET forum_channel_ids = $2::bigint[], self_intro_channel_ids = $3::bigint[] WHERE guild_id = $1`,
              [guildId, cleanForums, cleanIntros]
            );
          } catch {}
        }

        for (const cid of cleanForums) {
          checks.push(await checkChannel(cid, `評価フォーラム (${cid})`));
        }
        for (const cid of cleanIntros) {
          checks.push(await checkChannel(cid, `自己紹介チャンネル (${cid})`));
        }
      }
      result['eval-sheet'] = finalize(checks);
    } catch (e: any) {
      result['eval-sheet'] = { ok: false, checks: [{ label: '評価設定', ok: false, detail: e.message }] };
    }

    // --- 経済・レベリング設定 / ギャンブル設定 ---
    result['economy'] = { ok: true, checks: [] };
    try {
      const bankerRoleIds: string[] = (await getSetting(pool, guildId, 'BANKER_ROLE_IDS')) || [];
      const checks: (Check | null)[] = bankerRoleIds.map((rid: string) => checkRoleExists(rid, roleMap, '銀行員ロール'));
      result['gambling'] = finalize(checks);
    } catch (e: any) {
      result['gambling'] = { ok: false, checks: [{ label: 'ギャンブル設定', ok: false, detail: e.message }] };
    }

    // --- レベル到達報酬 ---
    try {
      const rewards = await pool.query(`SELECT DISTINCT role_id FROM level_role_rewards WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = rewards.rows.map((row: any) => checkRoleExists(row.role_id?.toString(), roleMap, `報酬ロール (${row.role_id})`));
      result['level-rewards'] = finalize(checks);
    } catch (e: any) {
      result['level-rewards'] = { ok: false, checks: [{ label: 'レベル報酬設定', ok: false, detail: e.message }] };
    }

    // --- 面接官設定 / コマンド設定 / アカウント設定 ---
    result['interviewer'] = { ok: true, checks: [] };
    result['commands'] = { ok: true, checks: [] };
    result['accounts'] = { ok: true, checks: [] };

    // --- ログ出力設定 ---
    try {
      const logs = await pool.query(`SELECT log_type, channel_id, is_enabled FROM log_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      for (const row of logs.rows) {
        if (!row.is_enabled) continue;
        checks.push(await checkChannel(row.channel_id?.toString(), `${row.log_type} ログチャンネル`));
      }
      result['logs'] = finalize(checks);
    } catch (e: any) {
      result['logs'] = { ok: false, checks: [{ label: 'ログ設定', ok: false, detail: e.message }] };
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
    try {
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
    } catch (e: any) {
      result['self-intro-role'] = { ok: false, checks: [{ label: '条件ロール付与設定', ok: false, detail: e.message }] };
    }

    // --- 荒らし対策設定 ---
    try {
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
    } catch (e: any) {
      result['antigrief'] = { ok: false, checks: [{ label: '荒らし対策設定', ok: false, detail: e.message }] };
    }

    // --- その他パネル設定 (リアクションロールの付与先ロール確認) ---
    try {
      const rr = await pool.query(`SELECT DISTINCT role_id FROM reaction_roles`);
      const checks: (Check | null)[] = rr.rows.map((row: any) => checkRoleExists(row.role_id?.toString(), roleMap, `付与ロール (${row.role_id})`));
      result['other-panels'] = finalize(checks);
    } catch (e: any) {
      result['other-panels'] = { ok: false, checks: [{ label: 'その他パネル設定', ok: false, detail: e.message }] };
    }

    // --- 通話募集掲示板設定 (call-board) ---
    try {
      const cb = await pool.query(`SELECT panel_channel_id, board_channel_id FROM call_board_settings WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      if (cb.rows.length > 0) {
        checks.push(await checkChannel(cb.rows[0].panel_channel_id?.toString(), 'パネル設置チャンネル'));
        checks.push(await checkChannel(cb.rows[0].board_channel_id?.toString(), '募集掲示チャンネル'));
      }
      result['call-board'] = finalize(checks);
    } catch (e: any) {
      result['call-board'] = { ok: false, checks: [{ label: '通話募集掲示板設定', ok: false, detail: e.message }] };
    }

    // --- 福引ガチャ設定 ---
    try {
      const gachaSettings = await pool.query(`SELECT allowed_role_ids FROM gacha_settings WHERE guild_id = $1`, [guildId]);
      const gachaPrizes = await pool.query(`SELECT reward_role_id, prize_name FROM gacha_prizes WHERE guild_id = $1`, [guildId]);
      const checks: (Check | null)[] = [];
      for (const rid of gachaSettings.rows[0]?.allowed_role_ids || []) {
        checks.push(checkRoleExists(rid?.toString(), roleMap, '対象者ロール'));
      }
      for (const row of gachaPrizes.rows) {
        if (row.reward_role_id) {
          checks.push(checkRoleExists(row.reward_role_id?.toString(), roleMap, `報酬ロール (${row.prize_name})`));
        }
      }
      result['gacha'] = finalize(checks);
    } catch (e: any) {
      result['gacha'] = { ok: false, checks: [{ label: '福引ガチャ設定', ok: false, detail: e.message }] };
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[health] GET error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
