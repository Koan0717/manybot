@app_commands.command(name='固定テンプレート設定', description='【運営専用】このチャンネルのチャットテンプレートを固定し、常に最新の発言として自動更新します')
@is_admin()
async def sticky_template_create(self, interaction: discord.Interaction):
    await interaction.response.send_modal(StickyTemplateModal())