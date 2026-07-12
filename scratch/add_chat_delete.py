import re

with open('cogs/interview.py', 'r', encoding='utf-8') as f:
    content = f.read()

new_command = '''
    @app_commands.command(name="チャット削除", description="【面接官専用】チャンネル内のメッセージを指定された件数分、一括削除します")
    @app_commands.describe(count="削除するメッセージの件数")
    async def clear_chat(self, interaction: discord.Interaction, count: int):
        bot = self.bot
        if not has_interviewer_role(bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（面接官ロールが必要です）。", ephemeral=True)
            
        if count <= 0:
            return await interaction.response.send_message("1以上の件数を指定してください。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=count)
        await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)
'''

# insert before the end of InterviewerGroup
# InterviewerGroup ends when the next top-level construct begins.
# Let's insert it right after the execute_interview command.
content = content.replace(
    '''    def has_interviewer_permission(self):''',
    new_command + '''\n    def has_interviewer_permission(self):'''
)

with open('cogs/interview.py', 'w', encoding='utf-8') as f:
    f.write(content)
