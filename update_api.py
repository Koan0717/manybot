import os
import re

def update_file(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    for old, new in replacements:
        content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

for base in [r"c:\Users\kakij\OneDrive\ドキュメント\多様化bot", r"C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot"]:
    route_path = os.path.join(base, "dashboard", "src", "app", "api", "guilds", "[guild_id]", "rank", "route.ts")
    route_repl = [
        (
            "'SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM rank_settings WHERE guild_id = ',",
            "'SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM rank_settings WHERE guild_id = ',"
        ),
        (
            "const botSettingsResult = await pool.query(\n      \"SELECT setting_key, setting_value FROM bot_settings WHERE guild_id =  AND setting_key IN ('ENABLE_TC_RANK', 'ENABLE_EXCLUDE_RANK_ROLE', 'EXCLUDE_RANK_ROLE_IDS')\",\n      [guildId]\n    );",
            "const botSettingsResult = await pool.query(\n      \"SELECT setting_key, setting_value FROM bot_settings WHERE guild_id =  AND setting_key = 'ENABLE_TC_RANK'\",\n      [guildId]\n    );"
        ),
        (
            "let enableTcRank = true; // default\n    let enableExcludeRankRole = false;\n    let excludeRankRoleIds: string[] = [];\n    \n    botSettingsResult.rows.forEach((row: any) => {\n      if (row.setting_key === 'ENABLE_TC_RANK') {\n        try { enableTcRank = JSON.parse(row.setting_value); }\n        catch (e) { enableTcRank = row.setting_value === 'true'; }\n      } else if (row.setting_key === 'ENABLE_EXCLUDE_RANK_ROLE') {\n        try { enableExcludeRankRole = JSON.parse(row.setting_value); }\n        catch (e) { enableExcludeRankRole = row.setting_value === 'true'; }\n      } else if (row.setting_key === 'EXCLUDE_RANK_ROLE_IDS') {\n        try { excludeRankRoleIds = JSON.parse(row.setting_value); }\n        catch (e) { excludeRankRoleIds = []; }\n      }\n    });",
            "let enableTcRank = true; // default\n    if (botSettingsResult.rows.length > 0) {\n      try {\n        enableTcRank = JSON.parse(botSettingsResult.rows[0].setting_value);\n      } catch (e) {\n        enableTcRank = botSettingsResult.rows[0].setting_value === 'true';\n      }\n    }"
        ),
        (
            "whitelist_category_ids: [],\n      blacklist_category_ids: []",
            "whitelist_category_ids: [],\n      blacklist_category_ids: [],\n      enable_exclude_rank_role: false,\n      exclude_rank_role_ids: []"
        ),
        (
            "ENABLE_EXCLUDE_RANK_ROLE: enableExcludeRankRole,\n      EXCLUDE_RANK_ROLE_IDS: excludeRankRoleIds",
            "ENABLE_EXCLUDE_RANK_ROLE: rankSettings.enable_exclude_rank_role,\n      EXCLUDE_RANK_ROLE_IDS: rankSettings.exclude_rank_role_ids?.map(String) || []"
        ),
        (
            "await updateSetting('ENABLE_EXCLUDE_RANK_ROLE', ENABLE_EXCLUDE_RANK_ROLE);\n      await updateSetting('EXCLUDE_RANK_ROLE_IDS', EXCLUDE_RANK_ROLE_IDS);",
            ""
        ),
        (
            "INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids)\n         VALUES (, , , , )\n         ON CONFLICT (guild_id) DO UPDATE SET \n         whitelist_channel_ids = , blacklist_channel_ids = , whitelist_category_ids = , blacklist_category_ids = ,\n        [\n          guildId, \n          whitelist_channel_ids || [], \n          blacklist_channel_ids || [], \n          whitelist_category_ids || [], \n          blacklist_category_ids || []\n        ]",
            "INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids)\n         VALUES (, , , , , , )\n         ON CONFLICT (guild_id) DO UPDATE SET \n         whitelist_channel_ids = , blacklist_channel_ids = , whitelist_category_ids = , blacklist_category_ids = , enable_exclude_rank_role = , exclude_rank_role_ids = ,\n        [\n          guildId, \n          whitelist_channel_ids || [], \n          blacklist_channel_ids || [], \n          whitelist_category_ids || [], \n          blacklist_category_ids || [],\n          ENABLE_EXCLUDE_RANK_ROLE || false,\n          EXCLUDE_RANK_ROLE_IDS || []\n        ]"
        )
    ]
    update_file(route_path, route_repl)

print("Done API")
