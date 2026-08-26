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
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ROOM_PRICES', 'ROOM_PANEL_CONFIGS', 'ENABLE_PRICE_MAIN_SUB', 'ENABLE_PRICE_NEW_MEMBER', 'ENABLE_PRICE_DOWNGRADE', 'ENABLE_PRICE_VIOLATOR', 'ENABLE_FREE_INN_MAIN_SUB', 'DISABLE_12H_ROOMS', 'DISABLE_24H_ROOMS', 'DISABLE_12H_INN', 'DISABLE_24H_INN', 'DISABLE_12H_LUXURY', 'DISABLE_24H_LUXURY', 'ROOM_ACCESS_LOW_EVAL_INN_TEXT')",
      [guildId]
    );

    let roomPrices = null;
    let roomPanelConfigs = null;
    let toggles = {
      ENABLE_PRICE_MAIN_SUB: false,
      ENABLE_PRICE_NEW_MEMBER: false,
      ENABLE_PRICE_DOWNGRADE: false,
      ENABLE_PRICE_VIOLATOR: false,
      ENABLE_FREE_INN_MAIN_SUB: false,
      DISABLE_12H_ROOMS: false,
      DISABLE_24H_ROOMS: false,
      DISABLE_12H_INN: false,
      DISABLE_24H_INN: false,
      DISABLE_12H_LUXURY: false,
      DISABLE_24H_LUXURY: false,
      ROOM_ACCESS_LOW_EVAL_INN_TEXT: true
    };

    for (const row of result.rows) {
      if (row.setting_key === 'ROOM_PRICES') {
        try {
          roomPrices = JSON.parse(row.setting_value);
        } catch (e) {}
      } else if (row.setting_key === 'ROOM_PANEL_CONFIGS') {
        try {
          roomPanelConfigs = JSON.parse(row.setting_value);
        } catch (e) {}
      } else if (row.setting_key === 'ROOM_ACCESS_LOW_EVAL_INN_TEXT') {
        try {
          toggles.ROOM_ACCESS_LOW_EVAL_INN_TEXT = JSON.parse(row.setting_value);
        } catch {
          toggles.ROOM_ACCESS_LOW_EVAL_INN_TEXT = row.setting_value === 'true';
        }
      } else {
        toggles[row.setting_key as keyof typeof toggles] = row.setting_value === 'true';
      }
    }

    const rolePricesResult = await pool.query(
      "SELECT role_key, room_type, duration, price FROM role_room_prices ORDER BY role_key ASC, room_type ASC, duration ASC"
    );

    return NextResponse.json({ ROOM_PRICES: roomPrices, roomPanelConfigs, toggles, role_prices: rolePricesResult.rows });
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
    const { action } = body;

    if (action === 'save') {
      const { ROOM_PRICES, toggles, role_prices, ROOM_PANEL_CONFIGS } = body;
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (ROOM_PRICES) {
          await client.query(
            `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
            [guildId, 'ROOM_PRICES', JSON.stringify(ROOM_PRICES)]
          );
        }

        if (ROOM_PANEL_CONFIGS) {
          await client.query(
            `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
            [guildId, 'ROOM_PANEL_CONFIGS', JSON.stringify(ROOM_PANEL_CONFIGS)]
          );
        }

        if (toggles) {
          if (toggles.DISABLE_12H_ROOMS && toggles.DISABLE_24H_ROOMS) {
            toggles.DISABLE_24H_ROOMS = false;
          }
          if (toggles.DISABLE_12H_INN && toggles.DISABLE_24H_INN) {
            toggles.DISABLE_24H_INN = false;
          }
          if (toggles.DISABLE_12H_LUXURY && toggles.DISABLE_24H_LUXURY) {
            toggles.DISABLE_24H_LUXURY = false;
          }
          for (const [key, value] of Object.entries(toggles)) {
            await client.query(
              `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
               VALUES ($1, $2, $3)
               ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
              [guildId, key, value ? 'true' : 'false']
            );
          }
        }

        if (role_prices) {
          for (const rp of role_prices) {
            await client.query(
              `INSERT INTO role_room_prices (role_key, room_type, duration, price)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (role_key, room_type, duration) DO UPDATE SET price = $4`,
              [rp.role_key, rp.room_type, rp.duration, rp.price]
            );
          }
        }

        // Request bot to reload bot_settings and role_room_prices cache
        await client.query(
          `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
           VALUES ($1, $2, $3)`,
          [guildId, 0, 'reload_bot_and_role_prices']
        );

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
    else if (action === 'deploy_panel') {
      const { channel_id, panel_type } = body;
      
      if (!channel_id || !panel_type) {
        return NextResponse.json({ error: 'channel_id and panel_type are required' }, { status: 400 });
      }

      await pool.query(
        `INSERT INTO panel_requests (guild_id, channel_id, panel_type)
         VALUES ($1, $2, $3)`,
        [guildId, channel_id, panel_type]
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
