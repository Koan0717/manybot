import re
import glob

def process_file(filepath, replacements):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = content
    for pattern, repl in replacements:
        new_content = re.sub(pattern, repl, new_content)
        
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Refactored: {filepath}")
    else:
        print(f"No changes: {filepath}")

# database.py 向けの置換パターン
db_replacements = [
    # Table creation
    (r'CREATE TABLE IF NOT EXISTS users \(\s*user_id BIGINT PRIMARY KEY,', 
     r'CREATE TABLE IF NOT EXISTS users (\n                guild_id BIGINT,\n                user_id BIGINT,\n                PRIMARY KEY (guild_id, user_id),'),
     
    (r'CREATE TABLE IF NOT EXISTS evaluation_periods \(\s*user_id BIGINT PRIMARY KEY,', 
     r'CREATE TABLE IF NOT EXISTS evaluation_periods (\n                guild_id BIGINT,\n                user_id BIGINT,\n                PRIMARY KEY (guild_id, user_id),'),
     
    (r'CREATE TABLE IF NOT EXISTS user_evaluations \(\s*id SERIAL PRIMARY KEY,\s*target_user_id BIGINT,', 
     r'CREATE TABLE IF NOT EXISTS user_evaluations (\n                id SERIAL PRIMARY KEY,\n                guild_id BIGINT,\n                target_user_id BIGINT,'),
     
    (r'CREATE TABLE IF NOT EXISTS user_vc_durations \(\s*user_id BIGINT,\s*category_id BIGINT,\s*duration_seconds INTEGER DEFAULT 0,\s*PRIMARY KEY \(user_id, category_id\)', 
     r'CREATE TABLE IF NOT EXISTS user_vc_durations (\n                guild_id BIGINT,\n                user_id BIGINT,\n                category_id BIGINT,\n                duration_seconds INTEGER DEFAULT 0,\n                PRIMARY KEY (guild_id, user_id, category_id)'),
     
    (r'CREATE TABLE IF NOT EXISTS user_items \(\s*id SERIAL PRIMARY KEY,\s*user_id BIGINT,', 
     r'CREATE TABLE IF NOT EXISTS user_items (\n                id SERIAL PRIMARY KEY,\n                guild_id BIGINT,\n                user_id BIGINT,'),

    # Functions signature changes
    (r'def get_user\(user_id: int\)', r'def get_user(guild_id: int, user_id: int)'),
    (r'def get_balance\(user_id: int\)', r'def get_balance(guild_id: int, user_id: int)'),
    (r'def add_balance\(user_id: int, amount: int\)', r'def add_balance(guild_id: int, user_id: int, amount: int)'),
    (r'def remove_balance\(user_id: int, amount: int, force: bool = False\)', r'def remove_balance(guild_id: int, user_id: int, amount: int, force: bool = False)'),
    (r'def transfer_balance\(sender_id: int, receiver_id: int, amount: int\)', r'def transfer_balance(guild_id: int, sender_id: int, receiver_id: int, amount: int)'),
    (r'def get_event_points\(user_id: int\)', r'def get_event_points(guild_id: int, user_id: int)'),
    (r'def add_event_points\(user_id: int, amount: int\)', r'def add_event_points(guild_id: int, user_id: int, amount: int)'),
    (r'def remove_event_points\(user_id: int, amount: int\)', r'def remove_event_points(guild_id: int, user_id: int, amount: int)'),
    (r'def reset_gambling_count\(user_id: int, date_str: str\)', r'def reset_gambling_count(guild_id: int, user_id: int, date_str: str)'),
    (r'def increment_gambling_count\(user_id: int, amount: int = 0\)', r'def increment_gambling_count(guild_id: int, user_id: int, amount: int = 0)'),
    (r'def add_xp\(user_id: int, amount: int, mode: str\)', r'def add_xp(guild_id: int, user_id: int, amount: int, mode: str)'),
    (r'def reset_user_rank\(user_id: int\)', r'def reset_user_rank(guild_id: int, user_id: int)'),
    (r'def reset_user_balance\(user_id: int\)', r'def reset_user_balance(guild_id: int, user_id: int)'),
    (r'def add_evaluation_period\(user_id: int, start_time: datetime.datetime, end_time: datetime.datetime\)', r'def add_evaluation_period(guild_id: int, user_id: int, start_time: datetime.datetime, end_time: datetime.datetime)'),
    (r'def get_evaluation_period\(user_id: int\)', r'def get_evaluation_period(guild_id: int, user_id: int)'),
    (r'def extend_evaluation_period\(user_id: int, extra_days: int\)', r'def extend_evaluation_period(guild_id: int, user_id: int, extra_days: int)'),
    (r'def add_vc_duration\(user_id: int, category_id: int, duration_seconds: int\)', r'def add_vc_duration(guild_id: int, user_id: int, category_id: int, duration_seconds: int)'),

    # Queries in database.py
    # get_user
    (r"SELECT (.*?) FROM users WHERE user_id = \$1', user_id\)", 
     r"SELECT \1 FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)"),
    (r"INSERT INTO users \(user_id, balance, initial_issued\) VALUES \(\$1, 0, FALSE\) ON CONFLICT \(user_id\) DO NOTHING', user_id\)", 
     r"INSERT INTO users (guild_id, user_id, balance, initial_issued) VALUES ($1, $2, 0, FALSE) ON CONFLICT (guild_id, user_id) DO NOTHING', guild_id, user_id)"),
     
    # Call to get_user inside database.py functions
    (r'await get_user\(user_id\)', r'await get_user(guild_id, user_id)'),
    (r'await get_user\(receiver_id\)', r'await get_user(guild_id, receiver_id)'),
    (r'await get_user\(sender_id\)', r'await get_user(guild_id, sender_id)'),
    
    # get_balance etc (already matched by await get_user)
    
    # add_balance
    (r"UPDATE users SET balance = balance \+ \$1 WHERE user_id = \$2 RETURNING balance', amount, user_id\)", 
     r"UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3 RETURNING balance', amount, guild_id, user_id)"),
     
    # remove_balance
    (r"UPDATE users SET balance = balance - \$1 WHERE user_id = \$2', amount, user_id\)", 
     r"UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, user_id)"),
    (r"UPDATE users SET balance = balance - \$1 WHERE user_id = \$2 AND balance >= \$1', amount, user_id\)", 
     r"UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 AND balance >= $1', amount, guild_id, user_id)"),
     
    # transfer_balance
    (r"UPDATE users SET balance = balance - \$1 WHERE user_id = \$2 AND balance >= \$1', amount, sender_id\)", 
     r"UPDATE users SET balance = balance - $1 WHERE guild_id = $2 AND user_id = $3 AND balance >= $1', amount, guild_id, sender_id)"),
    (r"UPDATE users SET balance = balance \+ \$1 WHERE user_id = \$2', amount, receiver_id\)", 
     r"UPDATE users SET balance = balance + $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, receiver_id)"),
     
    # event_points
    (r"UPDATE users SET event_points = event_points \+ \$1 WHERE user_id = \$2 RETURNING event_points', amount, user_id\)", 
     r"UPDATE users SET event_points = event_points + $1 WHERE guild_id = $2 AND user_id = $3 RETURNING event_points', amount, guild_id, user_id)"),
    (r"UPDATE users SET event_points = GREATEST\(0, event_points - \$1\) WHERE user_id = \$2 RETURNING event_points', amount, user_id\)", 
     r"UPDATE users SET event_points = GREATEST(0, event_points - $1) WHERE guild_id = $2 AND user_id = $3 RETURNING event_points', amount, guild_id, user_id)"),
     
    # reset_gambling_count
    (r"UPDATE users SET chinchiro_count = 0, chinchiro_daily_bet = 0, chinchiro_last_date = \$1 WHERE user_id = \$2', date_str, user_id\)", 
     r"UPDATE users SET chinchiro_count = 0, chinchiro_daily_bet = 0, chinchiro_last_date = $1 WHERE guild_id = $2 AND user_id = $3', date_str, guild_id, user_id)"),
     
    # increment_gambling_count
    (r"UPDATE users SET chinchiro_count = chinchiro_count \+ 1, chinchiro_daily_bet = chinchiro_daily_bet \+ \$1 WHERE user_id = \$2', amount, user_id\)", 
     r"UPDATE users SET chinchiro_count = chinchiro_count + 1, chinchiro_daily_bet = chinchiro_daily_bet + $1 WHERE guild_id = $2 AND user_id = $3', amount, guild_id, user_id)"),
     
    # add_xp
    (r"SELECT \{field_xp\}, \{field_lv\} FROM users WHERE user_id = \$1', user_id\)", 
     r"SELECT {field_xp}, {field_lv} FROM users WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)"),
    (r"UPDATE users SET \{field_xp\} = \$1, \{field_lv\} = \$2 WHERE user_id = \$3', new_xp, new_lv, user_id\)", 
     r"UPDATE users SET {field_xp} = $1, {field_lv} = $2 WHERE guild_id = $3 AND user_id = $4', new_xp, new_lv, guild_id, user_id)"),

    # reset_user_rank
    (r"WHERE user_id = \$1\n        ''', user_id\)", 
     r"WHERE guild_id = $1 AND user_id = $2\n        ''', guild_id, user_id)"),

    # reset_user_balance
    (r"UPDATE users SET balance = 0 WHERE user_id = \$1', user_id\)", 
     r"UPDATE users SET balance = 0 WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)"),
     
    # add_evaluation_period
    (r"INSERT INTO evaluation_periods \(user_id, start_time, end_time\) \n            VALUES \(\$1, \$2, \$3\) \n            ON CONFLICT \(user_id\) DO NOTHING\n        ''', user_id, start_time, end_time\)",
     r"INSERT INTO evaluation_periods (guild_id, user_id, start_time, end_time) \n            VALUES ($1, $2, $3, $4) \n            ON CONFLICT (guild_id, user_id) DO NOTHING\n        ''', guild_id, user_id, start_time, end_time)"),
     
    # get_evaluation_period
    (r"SELECT start_time, end_time FROM evaluation_periods WHERE user_id = \$1', user_id\)",
     r"SELECT start_time, end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)"),
     
    # extend_evaluation_period
    (r"SELECT end_time FROM evaluation_periods WHERE user_id = \$1', user_id\)",
     r"SELECT end_time FROM evaluation_periods WHERE guild_id = $1 AND user_id = $2', guild_id, user_id)"),
    (r"UPDATE evaluation_periods SET end_time = \$1 WHERE user_id = \$2', new_end_time, user_id\)",
     r"UPDATE evaluation_periods SET end_time = $1 WHERE guild_id = $2 AND user_id = $3', new_end_time, guild_id, user_id)")
]

cog_replacements = [
    # General cog call rewrites
    (r'database.get_balance\(([\w\.]+id)\)', r'database.get_balance(interaction.guild.id, \1)'),
    (r'database.get_balance\(([\w\.]+id)\)', r'database.get_balance(interaction.guild.id, \1)'), # In case of message.guild.id?
    (r'database.transfer_balance\(([\w\.]+id), ([\w\.]+id), ([\w]+)\)', r'database.transfer_balance(interaction.guild.id, \1, \2, \3)'),
    (r'database.add_balance\(([\w\.]+id),', r'database.add_balance(interaction.guild.id, \1,'),
    (r'database.remove_balance\(([\w\.]+id),', r'database.remove_balance(interaction.guild.id, \1,'),
    (r'database.get_event_points\(([\w\.]+id)\)', r'database.get_event_points(interaction.guild.id, \1)'),
    (r'database.add_event_points\(([\w\.]+id),', r'database.add_event_points(interaction.guild.id, \1,'),
    (r'database.remove_event_points\(([\w\.]+id),', r'database.remove_event_points(interaction.guild.id, \1,'),
    (r'database.reset_gambling_count\(([\w\.]+id),', r'database.reset_gambling_count(interaction.guild.id, \1,'),
    (r'database.increment_gambling_count\(([\w\.]+id)', r'database.increment_gambling_count(interaction.guild.id, \1'),
    (r'database.add_xp\(([\w\.]+id),', r'database.add_xp(interaction.guild.id, \1,'),
    (r'database.reset_user_rank\(([\w\.]+id)\)', r'database.reset_user_rank(interaction.guild.id, \1)'),
    (r'database.reset_user_balance\(([\w\.]+id)\)', r'database.reset_user_balance(interaction.guild.id, \1)'),
    (r'database.add_evaluation_period\(([\w\.]+id),', r'database.add_evaluation_period(interaction.guild.id, \1,'),
    (r'database.get_evaluation_period\(([\w\.]+id)\)', r'database.get_evaluation_period(interaction.guild.id, \1)'),
    (r'database.extend_evaluation_period\(([\w\.]+id),', r'database.extend_evaluation_period(interaction.guild.id, \1,'),
]

if __name__ == "__main__":
    print("Refactoring database.py...")
    process_file("database.py", db_replacements)
    
    print("Refactoring cogs...")
    for file in glob.glob("cogs/*.py"):
        process_file(file, cog_replacements)
    
    print("Refactoring bot.py...")
    # bot.py has add_xp and add_vc_duration
    bot_replacements = [
        (r'database.add_vc_duration\(user_id,', r'database.add_vc_duration(guild.id, user_id,'),
        (r'database.add_xp\(user_id,', r'database.add_xp(guild.id, user_id,'),
        (r'database.add_balance\(user_id,', r'database.add_balance(guild.id, user_id,')
    ]
    process_file("bot.py", bot_replacements)
