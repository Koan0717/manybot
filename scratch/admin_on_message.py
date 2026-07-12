@commands.Cog.listener()
async def on_message(self, message):
    if message.author.bot:
        return
    if isinstance(message.author, discord.Member):
        should_check_spam = True
        guild = message.guild
        if guild:
            cfg = self.bot.get_antigrief_config(guild.id)
            exempt_roles = cfg.get('exempt_roles', set())
            author_role_ids = {role.id for role in message.author.roles}
            if exempt_roles & author_role_ids:
                should_check_spam = False
            if should_check_spam:
                target_categories = cfg.get('categories', set())
                target_channels = cfg.get('channels', set())
                if target_categories or target_channels:
                    in_target_channel = message.channel.id in target_channels
                    in_target_category = message.channel.category and message.channel.category.id in target_categories
                    if not in_target_channel and (not in_target_category):
                        should_check_spam = False
        else:
            should_check_spam = False
        if should_check_spam:
            user_id = message.author.id
            now = datetime.datetime.now(JST)
            if not hasattr(self.bot, 'spam_tracker'):
                self.bot.spam_tracker = {}
            user_tracker = self.bot.spam_tracker.setdefault(user_id, {'last_content': None, 'content_count': 0, 'everyone_count': 0, 'invite_count': 0, 'mention_count': 0, 'last_time': now})
            if (now - user_tracker['last_time']).total_seconds() > 3:
                user_tracker['content_count'] = 0
                user_tracker['everyone_count'] = 0
                user_tracker['invite_count'] = 0
                user_tracker['mention_count'] = 0
            user_tracker['last_time'] = now
            timeout_reason = None
            if message.content and message.content == user_tracker['last_content']:
                user_tracker['content_count'] += 1
                if user_tracker['content_count'] >= 3:
                    timeout_reason = '連続で同じメッセージを送信したため'
            else:
                user_tracker['last_content'] = message.content
                user_tracker['content_count'] = 1
            if message.mention_everyone:
                user_tracker['everyone_count'] += 1
                if user_tracker['everyone_count'] >= 5:
                    timeout_reason = '短時間に@everyoneメンションを複数回送信したため'
            import re
            DISCORD_INVITE_PATTERN = re.compile('(?:https?://)?(?:www\\.)?(?:discord\\.gg|discord\\.com/invite|discordapp\\.com/invite)/[a-zA-Z0-9-]+', re.IGNORECASE)
            if DISCORD_INVITE_PATTERN.search(message.content):
                user_tracker['invite_count'] += 1
                if user_tracker['invite_count'] >= 5:
                    timeout_reason = '連続でDiscordの招待リンクを送信したため'
            msg_mentions = len(message.mentions) + len(message.role_mentions)
            if msg_mentions >= 5:
                timeout_reason = '1つのメッセージで大量のメンションを送信したため'
            elif msg_mentions > 0:
                user_tracker['mention_count'] += msg_mentions
                if user_tracker['mention_count'] >= 10:
                    timeout_reason = '短時間に連続してメンションを送信したため'
            if timeout_reason:
                try:
                    try:
                        await message.delete()
                    except discord.Forbidden:
                        print(f'[WARNING] Cannot delete message. Missing permissions.')
                    except Exception as de:
                        print(f'[ERROR] Message deletion failed: {de}')
                    timeout_duration = datetime.timedelta(hours=1)
                    await message.author.timeout(timeout_duration, reason=timeout_reason)
                    await message.channel.send(f'🚨 {message.author.mention} がスパム行為（{timeout_reason}）によりタイムアウトされました。')
                    user_tracker['content_count'] = 0
                    user_tracker['everyone_count'] = 0
                    user_tracker['invite_count'] = 0
                    user_tracker['mention_count'] = 0
                    return
                except Exception as e:
                    print(f'[ERROR] Timeout failed for {message.author.display_name}: {e}')
    if message.guild:
        sticky_data = await database.get_sticky_template(message.channel.id)
        if sticky_data:
            if sticky_data['last_message_id']:
                try:
                    old_msg = await message.channel.fetch_message(sticky_data['last_message_id'])
                    await old_msg.delete()
                except:
                    pass
            if sticky_data.get('last_text_message_id'):
                try:
                    old_text_msg = await message.channel.fetch_message(sticky_data.get('last_text_message_id'))
                    await old_text_msg.delete()
                except:
                    pass
            text_content = sticky_data['content']
            new_msg = await message.channel.send(content=text_content)
            await database.update_sticky_last_message(message.channel.id, new_msg.id, None)