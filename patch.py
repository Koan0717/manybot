import re

content = open('database.py', encoding='utf-8').read()
setup_match = re.search(r'async def setup_db\(\):\n    p = await get_pool\(\)\n    async with p\.acquire\(\) as conn:\n(.*?)async def get_user', content, re.DOTALL)
schema_code = setup_match.group(1)

new_pool_logic = '''# -- NEW POOL LOGIC --
pools = {}
guild_to_db = {}
master_pool = None
import inspect

async def get_master_pool():
    global master_pool
    if master_pool is None:
        master_pool = await asyncpg.create_pool(DATABASE_URL, statement_cache_size=0, min_size=1, max_size=10)
    return master_pool

async def get_all_configured_pools():
    p = await get_master_pool()
    try:
        urls = await p.fetch("SELECT DISTINCT database_url FROM guild_databases")
        all_pools = [p]
        for r in urls:
            url = r['database_url']
            if url not in pools:
                pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)
            if pools[url] not in all_pools:
                all_pools.append(pools[url])
        return all_pools
    except asyncpg.exceptions.UndefinedTableError:
        return [p]

async def get_guild_db_url(guild_id: int):
    if guild_id in guild_to_db:
        return guild_to_db[guild_id]
    p = await get_master_pool()
    try:
        val = await p.fetchval("SELECT database_url FROM guild_databases WHERE guild_id = ", guild_id)
        guild_to_db[guild_id] = val
        return val
    except asyncpg.exceptions.UndefinedTableError:
        return None

async def set_guild_db_url(guild_id: int, url: str):
    p = await get_master_pool()
    if url:
        await p.execute(\"\"\"
            INSERT INTO guild_databases (guild_id, database_url) 
            VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET database_url = EXCLUDED.database_url
        \"\"\", guild_id, url)
        guild_to_db[guild_id] = url
        new_pool = await get_pool(guild_id)
        await setup_db_schema(new_pool)
    else:
        await p.execute("DELETE FROM guild_databases WHERE guild_id = $1", guild_id)
        guild_to_db[guild_id] = None

async def get_pool(guild_id: int = None):
    if guild_id is None:
        for frame_info in inspect.stack()[1:10]:
            frame = frame_info.frame
            if 'interaction' in frame.f_locals:
                obj = frame.f_locals['interaction']
                if hasattr(obj, 'guild') and obj.guild:
                    guild_id = obj.guild.id
                    break
            elif 'message' in frame.f_locals:
                obj = frame.f_locals['message']
                if hasattr(obj, 'guild') and obj.guild:
                    guild_id = obj.guild.id
                    break
            elif 'member' in frame.f_locals:
                obj = frame.f_locals['member']
                if hasattr(obj, 'guild') and obj.guild:
                    guild_id = obj.guild.id
                    break
            elif 'guild' in frame.f_locals:
                obj = frame.f_locals['guild']
                if hasattr(obj, 'id'):
                    guild_id = obj.id
                    break
            elif 'channel' in frame.f_locals:
                obj = frame.f_locals['channel']
                if hasattr(obj, 'guild') and obj.guild:
                    guild_id = obj.guild.id
                    break

    if guild_id:
        url = await get_guild_db_url(guild_id)
        if url:
            if url not in pools:
                pools[url] = await asyncpg.create_pool(url, statement_cache_size=0, min_size=1, max_size=10)
            return pools[url]
    return await get_master_pool()

async def setup_db_schema(p):
    async with p.acquire() as conn:
''' + schema_code + '''

async def setup_db():
    p = await get_master_pool()
    async with p.acquire() as conn:
        await conn.execute(\"\"\"
            CREATE TABLE IF NOT EXISTS guild_databases (
                guild_id BIGINT PRIMARY KEY,
                database_url TEXT NOT NULL
            )
        \"\"\")
    for p in await get_all_configured_pools():
        await setup_db_schema(p)
'''

content = re.sub(r'pool = None.*?async def get_user', new_pool_logic + '\nasync def get_user', content, flags=re.DOTALL)

global_funcs = [
    'get_expired_rooms',
    'get_expired_user_items',
    'get_all_evaluation_periods',
    'get_all_auto_vc_configs',
    'get_all_room_prices',
    'get_all_role_room_prices',
    'get_all_evaluation_settings',
    'get_all_rank_settings',
    'get_all_vc_coins_settings',
    'get_all_antigrief_settings',
    'load_settings',
    'get_expired_rooms',
    'remove_room',
    'mark_user_item_role_removed'
]

# We need a generic way to replace them.
# The previous regex missed parameters like emove_room(channel_id: int).
for func in global_funcs:
    content = re.sub(
        r'(async def ' + func + r'\(.*?\).*?:\n)\s*p = await get_pool\(\)\n',
        r'\1    # REPLACED FOR ALL POOLS\n',
        content,
        flags=re.DOTALL
    )

open('database_new.py', 'w', encoding='utf-8').write(content)
print("database_new.py created")
