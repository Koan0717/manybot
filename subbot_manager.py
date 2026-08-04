import asyncio
import discord
import database

class SubBotManager:
    def __init__(self, main_bot):
        self.main_bot = main_bot
        self.sub_bots = {}  # {guild_id: {'bot': bot_instance, 'task': task, 'token': token_str}}

    def is_handled_by_sub_bot(self, guild_id: int) -> bool:
        """
        指定ギルドが専用サブBotによって稼働中かを判定する。
        """
        info = self.sub_bots.get(guild_id)
        if info and info.get('bot') and info['bot'].is_ready():
            return True
        return False

    async def sync_sub_bots(self):
        """
        データベースの SUB_BOT_TOKEN を読み込み、サブBotの起動・更新・停止を同期する。
        """
        try:
            db_sub_bots = await database.get_all_sub_bot_tokens()
            
            # 停止判定: DBから削除された、またはトークンが変更されたサブBotを停止
            for g_id, info in list(self.sub_bots.items()):
                new_token = db_sub_bots.get(g_id)
                if not new_token or new_token != info['token']:
                    print(f"[SubBotManager] Stopping sub-bot for guild {g_id}")
                    await self.stop_sub_bot(g_id)

            # 起動判定: 新規設定またはトークン更新されたサブBotを起動
            for g_id, token in db_sub_bots.items():
                if g_id not in self.sub_bots and token:
                    print(f"[SubBotManager] Launching sub-bot for guild {g_id}")
                    self.start_sub_bot(g_id, token)
        except Exception as e:
            print(f"[SubBotManager ERROR] Failed to sync sub-bots: {e}")

    def start_sub_bot(self, guild_id: int, token: str):
        """
        指定ギルド用サブBotインスタンスを非同期タスクで起動する。
        """
        from bot import EconomyBot
        
        sub_bot = EconomyBot()
        sub_bot.is_sub_bot = True
        sub_bot.target_guild_id = guild_id

        async def _run():
            try:
                await sub_bot.start(token)
            except Exception as e:
                print(f"[SubBotManager ERROR] Sub-bot execution error (guild: {guild_id}): {e}")

        task = asyncio.create_task(_run())
        self.sub_bots[guild_id] = {
            'bot': sub_bot,
            'task': task,
            'token': token
        }

    async def stop_sub_bot(self, guild_id: int):
        """
        指定ギルド用サブBotを停止・切断する。
        """
        info = self.sub_bots.pop(guild_id, None)
        if info:
            try:
                bot_inst = info['bot']
                task = info['task']
                await bot_inst.close()
                task.cancel()
            except Exception as e:
                print(f"[SubBotManager ERROR] Failed to stop sub-bot for guild {guild_id}: {e}")

_global_sub_bot_manager = None

def get_sub_bot_manager(main_bot=None):
    global _global_sub_bot_manager
    if _global_sub_bot_manager is None and main_bot is not None:
        _global_sub_bot_manager = SubBotManager(main_bot)
    return _global_sub_bot_manager
