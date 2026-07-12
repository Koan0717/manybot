class StickyTemplateModal(discord.ui.Modal, title='固定テンプレートの作成'):
    content_input = discord.ui.TextInput(label='固定するテキスト内容', style=discord.TextStyle.paragraph, placeholder='メッセージの最後に常に表示される内容を入力してください。', max_length=2000, required=True)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        await database.save_sticky_template(interaction.channel.id, self.content_input.value)
        new_msg = await interaction.channel.send(content=self.content_input.value)
        await database.update_sticky_last_message(interaction.channel.id, new_msg.id, None)
        await interaction.followup.send('✅ 固定テンプレートを設定しました。', ephemeral=True)