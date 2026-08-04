import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const ROOM_TYPES = [
  { key: 'inn', label: '一般宿', roomType: '宿' },
  { key: 'luxury_inn', label: '高級宿', roomType: '高級宿' },
  { key: 'gambling_vc', label: '賭博VC', roomType: '賭博VC' },
  { key: 'game_vc', label: 'ゲームVC', roomType: 'ゲームVC' },
  { key: 'custom_vc', label: 'カスタムVC', roomType: 'カスタムVC' },
];

// 設定キーのプレフィックス。評価落ち版は既存のキー名をそのまま維持し(後方互換)、
// 違反者版は新規に VIOLATOR プレフィックスを使う。
const PREFIXES: { section: 'lowEval' | 'violator'; prefix: string }[] = [
  { section: 'lowEval', prefix: 'ROOM_ACCESS_LOW_EVAL_' },
  { section: 'violator', prefix: 'ROOM_ACCESS_VIOLATOR_' },
];

export async function GET(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    const allKeys = PREFIXES.flatMap(p => ROOM_TYPES.map(r => `${p.prefix}${r.key}`));
    const result = await pool.query(
      `SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key = ANY($2)`,
      [guildId, allKeys]
    );

    const lowEval: Record<string, boolean> = {};
    const violator: Record<string, boolean> = {};
    // デフォルトは全部 true（許可）
    for (const rt of ROOM_TYPES) {
      lowEval[rt.key] = true;
      violator[rt.key] = true;
    }
    for (const row of result.rows) {
      for (const p of PREFIXES) {
        if (row.setting_key.startsWith(p.prefix)) {
          const key = row.setting_key.replace(p.prefix, '');
          let val: boolean;
          try {
            val = JSON.parse(row.setting_value);
          } catch {
            val = row.setting_value === 'true';
          }
          if (p.section === 'lowEval') lowEval[key] = val;
          else violator[key] = val;
        }
      }
    }

    return NextResponse.json({ lowEval, violator });
  } catch (error: any) {
    console.error('[room-access] GET error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { guild_id: string } }
) {
  const guildId = params.guild_id;
  try {
    const pool = await getPool(guildId);
    const body = await request.json();
    // 後方互換: 旧フォーマット({inn: true, ...})で送られてきた場合は lowEval として扱う
    const lowEvalBody = body.lowEval ?? body;
    const violatorBody = body.violator ?? {};

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const sections: { body: Record<string, boolean>; prefix: string }[] = [
        { body: lowEvalBody, prefix: 'ROOM_ACCESS_LOW_EVAL_' },
        { body: violatorBody, prefix: 'ROOM_ACCESS_VIOLATOR_' },
      ];

      for (const section of sections) {
        for (const rt of ROOM_TYPES) {
          const val = section.body[rt.key];
          if (val === undefined) continue;
          const settingKey = `${section.prefix}${rt.key}`;
          await client.query(
            `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
            [guildId, settingKey, JSON.stringify(Boolean(val))]
          );
        }
      }

      // Botのキャッシュ再読み込みをリクエスト
      await client.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, 'reload_bot_settings')`,
        [guildId]
      );

      // 既存チャンネルへの一括パーミッション適用をリクエスト(評価落ち・違反者それぞれ)
      const requestBulkApply = async (body: Record<string, boolean>, kind: 'eval' | 'violator') => {
        const deniedRoomTypes = ROOM_TYPES.filter(rt => body[rt.key] === false).map(rt => rt.roomType);
        const allowedRoomTypes = ROOM_TYPES.filter(rt => body[rt.key] !== false).map(rt => rt.roomType);
        const denyPrefix = kind === 'eval' ? 'apply_room_access_deny:' : 'apply_room_access_violator_deny:';
        const allowPrefix = kind === 'eval' ? 'apply_room_access_allow:' : 'apply_room_access_violator_allow:';

        if (deniedRoomTypes.length > 0) {
          await client.query(
            `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, $2)`,
            [guildId, `${denyPrefix}${deniedRoomTypes.join(',')}`]
          );
        }
        if (allowedRoomTypes.length > 0) {
          await client.query(
            `INSERT INTO panel_requests (guild_id, channel_id, panel_type) VALUES ($1, 0, $2)`,
            [guildId, `${allowPrefix}${allowedRoomTypes.join(',')}`]
          );
        }
      };

      if (Object.keys(lowEvalBody).length > 0) await requestBulkApply(lowEvalBody, 'eval');
      if (Object.keys(violatorBody).length > 0) await requestBulkApply(violatorBody, 'violator');

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[room-access] POST error:', error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
