import re
with open('dashboard/src/app/api/guilds/[guild_id]/rooms/route.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = '''      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ROOM_PRICES', 'ENABLE_PRICE_MAIN_SUB', 'ENABLE_PRICE_NEW_MEMBER', 'ENABLE_PRICE_DOWNGRADE', 'ENABLE_PRICE_VIOLATOR')","'''.strip()
replacement1 = '''      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND setting_key IN ('ROOM_PRICES', 'ENABLE_PRICE_MAIN_SUB', 'ENABLE_PRICE_NEW_MEMBER', 'ENABLE_PRICE_DOWNGRADE', 'ENABLE_PRICE_VIOLATOR', 'ROOM_PANEL_CONFIGS')","'''.strip()
content = content.replace(target1, replacement1)

target2 = '''    let roomPrices = null;
    let toggles = {'''
replacement2 = '''    let roomPrices = null;
    let roomPanelConfigs = null;
    let toggles = {'''
content = content.replace(target2, replacement2)

target3 = '''    for (const row of result.rows) {
      if (row.setting_key === 'ROOM_PRICES') {
        try {
          roomPrices = JSON.parse(row.setting_value);
        } catch (e) {}
      } else {
        toggles[row.setting_key as keyof typeof toggles] = row.setting_value === 'true';
      }
    }'''
replacement3 = '''    for (const row of result.rows) {
      if (row.setting_key === 'ROOM_PRICES') {
        try {
          roomPrices = JSON.parse(row.setting_value);
        } catch (e) {}
      } else if (row.setting_key === 'ROOM_PANEL_CONFIGS') {
        try {
          roomPanelConfigs = JSON.parse(row.setting_value);
        } catch (e) {}
      } else {
        toggles[row.setting_key as keyof typeof toggles] = row.setting_value === 'true';
      }
    }'''
content = content.replace(target3, replacement3)

target4 = '''    return NextResponse.json({ ROOM_PRICES: roomPrices, toggles, role_prices: rolePricesResult.rows });'''
replacement4 = '''    return NextResponse.json({ ROOM_PRICES: roomPrices, roomPanelConfigs, toggles, role_prices: rolePricesResult.rows });'''
content = content.replace(target4, replacement4)

target5 = '''      const { ROOM_PRICES, toggles, role_prices } = body;'''
replacement5 = '''      const { ROOM_PRICES, toggles, role_prices, ROOM_PANEL_CONFIGS } = body;'''
content = content.replace(target5, replacement5)

target6 = '''        if (ROOM_PRICES) {
          await client.query(
            `INSERT INTO bot_settings (guild_id, setting_key, setting_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, setting_key) DO UPDATE SET setting_value = $3`,
            [guildId, 'ROOM_PRICES', JSON.stringify(ROOM_PRICES)]
          );
        }'''
replacement6 = '''        if (ROOM_PRICES) {
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
        }'''
content = content.replace(target6, replacement6)

with open('dashboard/src/app/api/guilds/[guild_id]/rooms/route.ts', 'w', encoding='utf-8') as f:
    f.write(content)
