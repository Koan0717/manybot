import sys

# Update config.py
with open('config.py', 'r', encoding='utf-8') as f:
    config_content = f.read()

config_new = '''import sys

def get_setting(bot, key: str, guild_id: int = None):
    if guild_id is None:
        try:
            f = sys._getframe(1)
            for _ in range(15):
                if f is None: break
                locs = f.f_locals
                if 'interaction' in locs:
                    obj = locs['interaction']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'message' in locs:
                    obj = locs['message']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'member' in locs:
                    obj = locs['member']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'guild' in locs:
                    obj = locs['guild']
                    if hasattr(obj, 'id'):
                        guild_id = obj.id
                        break
                elif 'channel' in locs:
                    obj = locs['channel']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                f = f.f_back
        except Exception:
            pass

    if hasattr(bot, 'bot_settings') and guild_id in bot.bot_settings and key in bot.bot_settings[guild_id]:
        return bot.bot_settings[guild_id][key]
    if key == "EVAL_TIME_CATEGORY_ID" and hasattr(bot, 'bot_settings') and guild_id in bot.bot_settings and "RANKING_CATEGORY_ID" in bot.bot_settings[guild_id]:
        return bot.bot_settings[guild_id]["RANKING_CATEGORY_ID"]
    return DEFAULT_SETTINGS.get(key)
'''

import re
config_content = re.sub(r'def get_setting\(bot, key: str, guild_id: int = None\):.*?(?=def |$)', config_new + '\n\n', config_content, flags=re.DOTALL)
with open('config.py', 'w', encoding='utf-8') as f:
    f.write(config_content)


# Update database.py
with open('database.py', 'r', encoding='utf-8') as f:
    db_content = f.read()

db_new = '''async def get_pool(guild_id: int = None):
    if guild_id is None:
        try:
            import sys
            f = sys._getframe(1)
            for _ in range(15):
                if f is None: break
                locs = f.f_locals
                if 'interaction' in locs:
                    obj = locs['interaction']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'message' in locs:
                    obj = locs['message']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'member' in locs:
                    obj = locs['member']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'guild' in locs:
                    obj = locs['guild']
                    if hasattr(obj, 'id'):
                        guild_id = obj.id
                        break
                elif 'channel' in locs:
                    obj = locs['channel']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                f = f.f_back
        except Exception:
            pass

    if guild_id:
        url = await get_guild_db_url(guild_id)
        if url:
            if url not in pools:
                pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)
            return pools[url]
    return await get_master_pool()'''

db_content = re.sub(r'async def get_pool\(guild_id: int = None\):.*?return await get_master_pool\(\)', db_new, db_content, flags=re.DOTALL)
with open('database.py', 'w', encoding='utf-8') as f:
    f.write(db_content)

# Update helpers.py get_setting
with open('helpers.py', 'r', encoding='utf-8') as f:
    help_content = f.read()

help_new = '''import sys
def get_setting(bot, key: str, guild_id: int = None):
    if guild_id is None:
        try:
            f = sys._getframe(1)
            for _ in range(15):
                if f is None: break
                locs = f.f_locals
                if 'interaction' in locs:
                    obj = locs['interaction']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'message' in locs:
                    obj = locs['message']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'member' in locs:
                    obj = locs['member']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                elif 'guild' in locs:
                    obj = locs['guild']
                    if hasattr(obj, 'id'):
                        guild_id = obj.id
                        break
                elif 'channel' in locs:
                    obj = locs['channel']
                    if hasattr(obj, 'guild') and obj.guild:
                        guild_id = obj.guild.id
                        break
                f = f.f_back
        except Exception:
            pass

    if hasattr(bot, 'bot_settings') and guild_id in bot.bot_settings and key in bot.bot_settings[guild_id]:
        return bot.bot_settings[guild_id][key]
    return DEFAULT_SETTINGS.get(key)'''

help_content = re.sub(r'def get_setting\(bot, key: str, guild_id: int = None\):.*?(?=def |$)', help_new + '\n\n', help_content, flags=re.DOTALL)
with open('helpers.py', 'w', encoding='utf-8') as f:
    f.write(help_content)

print("Done replacing.")
