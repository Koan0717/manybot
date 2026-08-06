import discord
from discord.ext import commands

from cogs.utility import (
    TicketControlView,
    TicketCloseConfirmView,
    EmblemRequestModal,
    EmblemSelectView,
    EmblemRequestPanelView,
    ConfessionRequestModal,
    ConfessionSelectView,
    ConfessionRequestPanelView,
    InquiryRequestModal,
    InquiryRequestPanelView,
    InquirySetupRoleSelect,
    InquirySetupView,
    CustomTicketPanelView,
    CustomTicketSelectView,
    CustomTicketRequestModal,
    CustomTicketSetupModal,
    CustomTicketMentionRoleSelectView,
    CustomTicketMentionRoleSelect,
    CustomTicketTargetRoleSelectView,
    CustomTicketTargetRoleSelect
)

class Tickets(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

async def setup(bot):
    await bot.add_cog(Tickets(bot))
