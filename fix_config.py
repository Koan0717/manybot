import re

with open('config.py', 'r', encoding='utf-8') as f:
    content = f.read()

new_func = '''async def check_and_assign_level_roles(bot, member: discord.Member, level_type: str, new_level: int):
    # Check if level rewards are enabled
    is_enabled = get_setting(bot, "ENABLE_LEVEL_REWARDS", member.guild.id)
    if str(is_enabled).lower() not in ["true", "1", "yes", "on"]:
        return

    try:
        # --- Coin Rewards ---
        coin_rewards = await database.get_level_coin_rewards(member.guild.id, level_type)
        if coin_rewards:
            for cr in coin_rewards:
                if cr["level"] == new_level:
                    await database.add_balance(member.guild.id, member.id, cr["coins"])
                    lv_channel_id = get_setting(bot, "LEVEL_UP_CHANNEL_ID", member.guild.id)
                    if lv_channel_id:
                        lv_channel = member.guild.get_channel(lv_channel_id)
                        if lv_channel:
                            currency = get_setting(bot, "CURRENCY_NAME", member.guild.id) or "Rune"
                            await lv_channel.send(f"🪙 {member.mention} が {level_type.upper()} レベル {new_level} に到達したボーナスとして、**{cr['coins']} {currency}** を獲得しました！")

        # --- Role Rewards ---
        rewards = await database.get_level_role_rewards(member.guild.id, level_type)
        if not rewards:
            return

        target_level = -1
        for r in rewards:
            if r["level"] <= new_level:
                target_level = max(target_level, r["level"])

        roles_to_add = []
        roles_to_remove = []

        for r in rewards:
            role = member.guild.get_role(r["role_id"])
            if not role: continue

            if r["level"] == target_level:
                if role not in member.roles:
                    roles_to_add.append(role)
            else:
                if role in member.roles:
                    roles_to_remove.append(role)

        if roles_to_remove:
            await member.remove_roles(*roles_to_remove, reason=f"{level_type.upper()}レベル更新 (古いロールの解除)")
        if roles_to_add:
            await member.add_roles(*roles_to_add, reason=f"{level_type.upper()}レベル到達報酬 (Lv.{new_level})")
            
            role_mentions = ", ".join([role.mention for role in roles_to_add])
            lv_channel_id = get_setting(bot, "LEVEL_UP_CHANNEL_ID", member.guild.id)
            if lv_channel_id:
                lv_channel = member.guild.get_channel(lv_channel_id)
                if lv_channel:
                    await lv_channel.send(f"🎁 {member.mention} が {level_type.upper()} レベル {new_level} に到達したため、以下のロールが付与されました！\\n{role_mentions}")
                    
    except Exception as e:
        print(f"[ERROR] check_and_assign_level_roles for {member.display_name}: {e}")
'''

# Find the old function and replace it
content = re.sub(
    r'async def check_and_assign_level_roles\(bot, member: discord\.Member, level_type: str, new_level: int\):.*?# ------------',
    new_func + '\n# ------------',
    content,
    flags=re.DOTALL
)

with open('config.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated config.py")
