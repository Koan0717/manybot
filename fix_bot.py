with open('bot.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'await database.add_vc_duration(guild.id, user_id, before.channel.category.id, duration_seconds)',
    'await database.add_vc_duration(member.guild.id, user_id, before.channel.category.id, duration_seconds)'
)

content = content.replace(
    'helpers.get_setting(self, "VC_XP_PER_MIN", guild_id)',
    'get_setting(bot, "VC_XP_PER_MIN", member.guild.id)'
)

content = content.replace(
    'new_lv = await database.add_xp(guild.id, user_id, xp_reward, "vc")',
    'new_lv = await database.add_xp(member.guild.id, user_id, xp_reward, "vc")'
)

content = content.replace(
    'await database.add_balance(guild.id, user_id, coins_reward)',
    'await database.add_balance(member.guild.id, user_id, coins_reward)'
)

with open('bot.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("bot.py fixed")
