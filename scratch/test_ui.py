import asyncio
import discord
from database import get_custom_ticket_panel

async def run():
    p = await get_custom_ticket_panel(1503031654711558185)
    print(p)
    btn = discord.ui.Button(
        label=p.get('button_label'),
        emoji=p.get('button_emoji') if p.get('button_emoji') else None,
        custom_id='persistent_custom_ticket_panel_btn',
        style=discord.ButtonStyle.primary
    )
    print(btn.to_component_dict())

asyncio.run(run())
