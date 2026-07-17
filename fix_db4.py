import re

with open('database.py', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = r"(async def get_rank_settings\(guild_id: int\) -> dict:.*?WHERE guild_id = \$1', guild_id).*?(?=async def get_all_rank_settings)"

replacement = r'''\1

        if row:
            return {
                "whitelist": row["whitelist_channel_ids"] or [],
                "blacklist": row["blacklist_channel_ids"] or [],
                "categories": row["whitelist_category_ids"] or [],
                "blacklist_categories": row["blacklist_category_ids"] or [],
                "enable_exclude_rank_role": row["enable_exclude_rank_role"],
                "exclude_rank_role_ids": row["exclude_rank_role_ids"] or [],
                "ephemeral_rank_commands": row["ephemeral_rank_commands"]
            }
        else:
            await conn.execute('INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, enable_exclude_rank_role, exclude_rank_role_ids, ephemeral_rank_commands) VALUES ($1, $2, $3, $4, $5, FALSE, \'{}\', FALSE) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [])
            return {"whitelist": [], "blacklist": [], "categories": [], "blacklist_categories": [], "enable_exclude_rank_role": False, "exclude_rank_role_ids": [], "ephemeral_rank_commands": False}

async def toggle_ephemeral_rank_commands(guild_id: int) -> bool:
    p = await get_pool(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow('SELECT ephemeral_rank_commands FROM rank_settings WHERE guild_id = $1', guild_id)
        if not row:
            await conn.execute('INSERT INTO rank_settings (guild_id, whitelist_channel_ids, blacklist_channel_ids, whitelist_category_ids, blacklist_category_ids, ephemeral_rank_commands) VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT (guild_id) DO NOTHING', guild_id, [], [], [], [])
            return True
        else:
            new_val = not row['ephemeral_rank_commands']
            await conn.execute('UPDATE rank_settings SET ephemeral_rank_commands = $2 WHERE guild_id = $1', guild_id, new_val)
            return new_val

'''

new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('database.py', 'w', encoding='utf-8') as f:
    f.write(new_content)
