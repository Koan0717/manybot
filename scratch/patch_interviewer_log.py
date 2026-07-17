import sys

paths = [
    r'c:\Users\kakij\OneDrive\ドキュメント\多様化bot\cogs\logging_cog.py',
    r'C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\cogs\logging_cog.py'
]

for path in paths:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        continue

    # We want to replace the embed description and add the interviewer role check.
    # The block we are looking for is in check_manual_join.
    
    old_block = '''                        if entry.user and not entry.user.bot:
                            interviewer = entry.user
                            
                            new_total = await database.increment_interviewer_stats(after.guild.id, interviewer.id)
                            
                            embed = discord.Embed(
                                title="👔 手動入界手続き",
                                description=f"面接官が手動で入界手続きを行いました。\\n\\n**対象者:** {after.mention}\\n**面接官:** {interviewer.mention}\\n\\n**今回の対応人数:** 1人\\n**面接合計対応人数:** {new_total}人",
                                color=discord.Color.green(),
                                timestamp=datetime.datetime.now(config.JST)
                            )
                            await config.send_log(self.bot, after.guild, "interviewer", embed)'''
                            
    new_block = '''                        if entry.user and not entry.user.bot:
                            interviewer = entry.user
                            
                            interviewer_member = after.guild.get_member(interviewer.id)
                            if not interviewer_member or not config.has_interviewer_role(self.bot, interviewer_member):
                                break
                            
                            new_total = await database.increment_interviewer_stats(after.guild.id, interviewer.id)
                            
                            embed = discord.Embed(
                                title="👔 入界手続き完了",
                                description=f"面接官 {interviewer.mention} が、入界待機者 {after.mention} に {human_role.name} ロールを付与しました。\\n対応人数 {new_total}人目",
                                color=discord.Color.green(),
                                timestamp=datetime.datetime.now(config.JST)
                            )
                            await config.send_log(self.bot, after.guild, "interviewer", embed)'''
                            
    if old_block in content:
        content = content.replace(old_block, new_block)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {path}")
    else:
        print(f"Could not find block in {path}")

