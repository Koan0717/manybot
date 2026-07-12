import re
with open('cogs/rooms.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''                    new_channel = await guild.create_voice_channel(
                        name=channel_name,
                        category=category,
                        reason=f"Auto-VC for {member.display_name}"
                    )
                    
                    now_naive = database.get_now_naive()'''

replacement = '''                    new_channel = await guild.create_voice_channel(
                        name=channel_name,
                        category=category,
                        reason=f"Auto-VC for {member.display_name}"
                    )
                    
                    if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                        try:
                            await member.move_to(new_channel)
                        except:
                            pass
                    
                    now_naive = database.get_now_naive()'''

content = content.replace(target, replacement)

target2 = '''                    for i in range(3):
                        await asyncio.sleep(0.5 if i == 0 else 1.0)
                        if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                            try:
                                await member.move_to(new_channel)
                                print(f"[Auto-VC] Successfully moved {member.display_name} on attempt {i+1}")
                                break
                            except Exception as move_e:
                                print(f"[Auto-VC] Move attempt {i+1} failed: {move_e}")
                        else:
                            print(f"[Auto-VC] User already left the trigger channel.")
                            break'''

replacement2 = '''                    # Move attempts are now done instantly above. We still keep a fallback just in case.
                    async def delayed_move():
                        for i in range(3):
                            await asyncio.sleep(0.5 if i == 0 else 1.0)
                            if member.voice and member.voice.channel and member.voice.channel.id == trigger_id:
                                try:
                                    await member.move_to(new_channel)
                                    break
                                except:
                                    pass
                            else:
                                break
                    self.bot.loop.create_task(delayed_move())'''

content = content.replace(target2, replacement2)

with open('cogs/rooms.py', 'w', encoding='utf-8') as f:
    f.write(content)
