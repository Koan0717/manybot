import re
import discord
from discord.ext import commands
import database
from helpers import get_setting


def extract_template_keywords(template: str) -> list:
    """
    テンプレート文字列から【】や「：（:）」で始まるキーワードを抽出する。
    空行はスキップし、先頭の記号キーワード部分（【〇〇】 または 〇〇：）を返す。
    """
    keywords = []
    for line in template.splitlines():
        line = line.strip()
        if not line:
            continue
        # 【〇〇】 形式
        m = re.match(r'(【[^】]+】)', line)
        if m:
            keywords.append(m.group(1))
            continue
        # 〇〇： または 〇〇: 形式
        m = re.match(r'([^：:]+[：:])', line)
        if m:
            keywords.append(m.group(1))
            continue
        # どちらでもない行はそのまま追加（完全一致チェック）
        keywords.append(line)
    return keywords


def check_intro_completeness(message_content: str, keywords: list) -> bool:
    """メッセージに全キーワードが含まれているか確認する。"""
    for kw in keywords:
        if kw not in message_content:
            return False
    return True


class SelfIntroRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        """入室時に自己紹介チャンネルへメンション付きで案内を送る。"""
        if member.bot:
            return
        guild = member.guild
        try:
            settings = await database.get_self_intro_role_settings(guild.id)
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to get settings for guild {guild.id}: {e}")
            return

        if not settings.get("is_enabled"):
            return

        intro_channel_id = settings.get("channel_id")
        welcome_channel_id = settings.get("welcome_channel_id")
        template = settings.get("template") or ""

        if not intro_channel_id or not settings.get("role_id"):
            return

        # 案内メッセージの送信先チャンネルを決定
        target_channel_id = welcome_channel_id if welcome_channel_id else intro_channel_id
        channel = guild.get_channel(int(target_channel_id))
        if not channel:
            return

        intro_channel = guild.get_channel(int(intro_channel_id))
        intro_mention = intro_channel.mention if intro_channel else f"<#{intro_channel_id}>"

        # 案内メッセージ作成
        if template:
            guide_text = (
                f"🎉 {member.mention} さん、ようこそ！\n\n"
                f"まず {intro_mention} で以下のテンプレートを使って自己紹介をお願いします📝\n"
                f"全ての項目を埋めて送信すると、ロールが付与されます！\n\n"
                f"```\n{template}\n```"
            )
        else:
            guide_text = (
                f"🎉 {member.mention} さん、ようこそ！\n\n"
                f"{intro_mention} で自己紹介をお願いします📝"
            )

        try:
            msg = await channel.send(guide_text)
            await database.save_self_intro_welcome_message(guild.id, member.id, msg.id, channel.id)
        except discord.Forbidden:
            print(f"[SelfIntroRoles] Cannot send message to channel {target_channel_id} in guild {guild.id}")
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to send welcome message: {e}")

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """自己紹介チャンネルへの投稿を検知してロールを付与する。"""
        if message.author.bot:
            return
        if not message.guild:
            return

        guild = message.guild
        member = message.author

        try:
            settings = await database.get_self_intro_role_settings(guild.id)
        except Exception:
            return

        if not settings.get("is_enabled"):
            return

        intro_channel_id = settings.get("channel_id")
        role_id = settings.get("role_id")
        template = settings.get("template") or ""

        if not intro_channel_id or not role_id:
            return

        # 自己紹介チャンネルのメッセージのみ対象
        if message.channel.id != int(intro_channel_id):
            return

        # 既にロールを持っていればスキップ
        target_role = guild.get_role(int(role_id))
        if not target_role:
            return
        if target_role in member.roles:
            return

        # テンプレートからキーワード抽出
        if not template:
            return
        keywords = extract_template_keywords(template)
        if not keywords:
            return

        # メッセージが全キーワードを含んでいるか確認
        if not check_intro_completeness(message.content, keywords):
            return

        # ロール付与
        try:
            await member.add_roles(target_role, reason="自己紹介テンプレート完成によるロール付与")
        except discord.Forbidden:
            print(f"[SelfIntroRoles] Cannot add role {role_id} to {member} in guild {guild.id}")
            return
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to add role: {e}")
            return

        # 案内メッセージを削除
        try:
            welcome_data = await database.get_self_intro_welcome_message(guild.id, member.id)
            if welcome_data:
                welcome_channel = guild.get_channel(int(welcome_data["channel_id"]))
                if welcome_channel:
                    try:
                        welcome_msg = await welcome_channel.fetch_message(int(welcome_data["message_id"]))
                        await welcome_msg.delete()
                    except (discord.NotFound, discord.Forbidden):
                        pass
                await database.delete_self_intro_welcome_message(guild.id, member.id)
        except Exception as e:
            print(f"[SelfIntroRoles] Failed to delete welcome message: {e}")

        # 付与完了のリプライ
        try:
            await message.reply(
                f"✅ {member.mention} 自己紹介ありがとうございます！ロール **{target_role.name}** を付与しました🎉",
                delete_after=30
            )
        except Exception:
            pass


async def setup(bot):
    await bot.add_cog(SelfIntroRoles(bot))
