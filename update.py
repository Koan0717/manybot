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
    # 1. database.py
    db_path = os.path.join(base, "database.py")
    db_repl = [
        (
            "blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}'",
            "blacklist_category_ids BIGINT[] NOT NULL DEFAULT '{}',\n                enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE,\n                exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT '{}'"
        ),
        (
            "await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids",
            "try:\n            await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS enable_exclude_rank_role BOOLEAN NOT NULL DEFAULT FALSE')\n        except Exception as e:\n            pass\n        try:\n            await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS exclude_rank_role_ids BIGINT[] NOT NULL DEFAULT \\'{}\\')')\n        except Exception as e:\n            pass\n        await conn.execute('ALTER TABLE rank_settings ADD COLUMN IF NOT EXISTS whitelist_category_ids"
        ),
        (
            "SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids FROM rank_settings",
            "SELECT whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids FROM rank_settings"
        ),
        (
            '"blacklist_categories": row["blacklist_category_ids"] or []',
            '"blacklist_categories": row["blacklist_category_ids"] or [],\n                "enable_exclude_rank_role": row["enable_exclude_rank_role"],\n                "exclude_rank_role_ids": row["exclude_rank_role_ids"] or []'
        ),
        (
            "VALUES (, , , , ) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [])",
            "VALUES (, , , , , , ) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [], False, [])"
        ),
        (
            "VALUES (, , , , ) ON CONFLICT (guild_id)",
            "VALUES (, , , , , , ) ON CONFLICT (guild_id)"
        ),
        (
            "(guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids)",
            "(guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids)"
        ),
        (
            '"blacklist_categories": []}',
            '"blacklist_categories": [], "enable_exclude_rank_role": False, "exclude_rank_role_ids": []}'
        ),
        (
            "SET whitelist_channel_ids = , blacklist_channel_ids = , whitelist_category_ids = , blacklist_category_ids = ",
            "SET whitelist_channel_ids = , blacklist_channel_ids = , whitelist_category_ids = , blacklist_category_ids = , enable_exclude_rank_role = , exclude_rank_role_ids = "
        ),
        (
            "guild_id, whitelist_ids, blacklist_ids, category_ids, blacklist_category_ids)",
            "guild_id, whitelist_ids, blacklist_ids, category_ids, blacklist_category_ids, False, [])"
        )
    ]
    update_file(db_path, db_repl)

    # 2. bot.py
    bot_path = os.path.join(base, "bot.py")
    bot_repl = [
        (
            '"blacklist_categories": set(data.get("blacklist_categories", []))',
            '"blacklist_categories": set(data.get("blacklist_categories", [])),\n            "enable_exclude_rank_role": data.get("enable_exclude_rank_role", False),\n            "exclude_rank_role_ids": set(data.get("exclude_rank_role_ids", []))'
        ),
        (
            '"blacklist_categories": set()}',
            '"blacklist_categories": set(), "enable_exclude_rank_role": False, "exclude_rank_role_ids": set()}'
        )
    ]
    update_file(bot_path, bot_repl)

    # 3. config.py
    cfg_path = os.path.join(base, "config.py")
    cfg_repl = [
        (
            'exclude_enabled = get_setting(bot, "ENABLE_EXCLUDE_RANK_ROLE", member.guild.id)\n        if str(exclude_enabled).lower() in ["true", "1", "yes", "on", "True"]:\n            exclude_role_ids = get_setting(bot, "EXCLUDE_RANK_ROLE_IDS", member.guild.id) or []',
            'cfg = bot.get_rank_config(member.guild.id)\n        exclude_enabled = cfg.get("enable_exclude_rank_role", False)\n        if str(exclude_enabled).lower() in ["true", "1", "yes", "on", "True"]:\n            exclude_role_ids = cfg.get("exclude_rank_role_ids", [])'
        )
    ]
    update_file(cfg_path, cfg_repl)

print("Done")
