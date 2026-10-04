import discord
from discord.ext import commands
import database


class RoleHistory(commands.Cog):
    """
    メンバーのロールの付け外しを記録する（role_history）。
    Discordにはロールがいつ付いたかを後から調べる手段が無いため、
    ダッシュボードのメンバー画面「役職」タブで付与日を表示するのに使う。
    """

    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        if before.roles == after.roles:
            return
        before_ids = {r.id for r in before.roles}
        after_ids = {r.id for r in after.roles}
        added = [r for r in after.roles if r.id not in before_ids]
        removed = [r for r in before.roles if r.id not in after_ids]
        try:
            for role in added:
                await database.add_role_history(after.guild.id, after.id, role.id, role.name, "add")
            for role in removed:
                await database.add_role_history(after.guild.id, after.id, role.id, role.name, "remove")
        except Exception as e:
            print(f"[RoleHistory] Failed to record role change: {e}")


async def setup(bot):
    await bot.add_cog(RoleHistory(bot))
