import discord
from discord.ext import commands
from discord import app_commands
import datetime
import random
import asyncio
import database
from helpers import (
    JST, get_setting,
    create_blackjack_deck, calculate_blackjack_score, check_roulette_win,
    format_bet_type, send_log
)

_bot_instance = None

# --- チンチロリン ---
class ChinchiroBetModal(discord.ui.Modal, title='チンチロリン：賭け金入力'):
    bet_input = discord.ui.TextInput(label='賭ける金額', placeholder='例: 1000', max_length=10, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            bet = int(self.bet_input.value)
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if bet <= 0 or bet > max_bet:
                return await interaction.response.send_message(f"1〜{max_bet:,}の範囲で入力してください。", ephemeral=True)
            await interaction.response.defer(ephemeral=True)
            user_data = await database.get_user(interaction.guild.id, interaction.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(interaction.guild.id, interaction.user.id, today_str)
                count = 0
                daily_bet = 0
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
            if max_plays is None: max_plays = 10
            else: max_plays = int(max_plays)
            if max_plays > 0 and count >= max_plays:
                return await interaction.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await interaction.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
            if await database.get_balance(interaction.guild.id, interaction.user.id) < bet:
                return await interaction.followup.send("残高不足です。", ephemeral=True)
            await database.remove_balance(interaction.guild.id, interaction.user.id, bet)
            await database.increment_gambling_count(interaction.guild.id, interaction.user.id, bet)
            view = ChinchiroGameView(interaction.user, bet)
            await interaction.followup.send(f"🎲 **チンチロリン開始！** (本日 {count+1}/{max_plays if max_plays > 0 else '無制限'}回目)\n賭け金: **{bet} {currency_name}**", view=view, ephemeral=True)
        except:
            await interaction.response.send_message("数字を入力してください。", ephemeral=True)

class ChinchiroGameView(discord.ui.View):
    def __init__(self, user, bet):
        super().__init__(timeout=60)
        self.user = user
        self.bet = bet
        self.player_rolls = 0
        self.player_history = []
        self.player_hand = None
        self.player_rank = 0
        self.player_name = ""
        self.player_mul = 1
        
        # ゲーム開始時にどの役にするかを事前抽選
        self.target_hand_type = self.determine_target_hand()

    def determine_target_hand(self):
        bot = _bot_instance
        p_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_PINZORO")
        if p_pinzoro is None: p_pinzoro = 0.02
        p_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_ARASHI")
        if p_arashi is None: p_arashi = 0.05
        p_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_SHIGORO")
        if p_shigoro is None: p_shigoro = 0.08
        p_normal = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_NORMAL_WIN")
        if p_normal is None: p_normal = 0.295
        p_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_HIFUMI")
        if p_hifumi is None: p_hifumi = 0.11
        p_lose = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_LOSE")
        if p_lose is None: p_lose = 0.445
        
        total = p_pinzoro + p_arashi + p_shigoro + p_normal + p_hifumi + p_lose
        if total <= 0:
            total = 1.0
            
        r = random.random() * total
        if r < p_pinzoro:
            return "pinzoro"
        elif r < p_pinzoro + p_arashi:
            return "arashi"
        elif r < p_pinzoro + p_arashi + p_shigoro:
            return "shigoro"
        elif r < p_pinzoro + p_arashi + p_shigoro + p_normal:
            return "normal"
        elif r < p_pinzoro + p_arashi + p_shigoro + p_normal + p_hifumi:
            return "hifumi"
        else:
            return "lose"

    def generate_force_hand(self, hand_type):
        if hand_type == "pinzoro":
            return [1, 1, 1]
        elif hand_type == "arashi":
            num = random.randint(2, 6)
            return [num, num, num]
        elif hand_type == "shigoro":
            return [4, 5, 6]
        elif hand_type == "hifumi":
            return [1, 2, 3]
        elif hand_type == "normal":
            while True:
                num1 = random.randint(1, 6)
                num2 = random.randint(1, 6)
                if num1 != num2:
                    d = [num1, num1, num2]
                    h, _, _ = self.get_rank_and_score(d)
                    if h.startswith("出目"):
                        return d
        else:
            return self.generate_no_hand()

    def generate_no_hand(self):
        while True:
            d = [random.randint(1, 6) for _ in range(3)]
            d.sort()
            if d[0] != d[1] and d[1] != d[2]:
                if d != [1, 2, 3] and d != [4, 5, 6]:
                    return d

    def get_rank_and_score(self, d):
        bot = _bot_instance
        mul_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_PINZORO") or 5.0
        mul_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_ARASHI") or 3.0
        mul_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_SHIGORO") or 2.0
        mul_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_HIFUMI") or -2.0
        mul_normal = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_NORMAL") or 1.0

        d.sort()
        if d == [1,1,1]: return "ピンゾロ", 1000, mul_pinzoro
        if d == [2,2,2]: return "アラシ(2)", 900, mul_arashi
        if d == [3,3,3]: return "アラシ(3)", 800, mul_arashi
        if d == [4,4,4]: return "アラシ(4)", 700, mul_arashi
        if d == [5,5,5]: return "アラシ(5)", 600, mul_arashi
        if d == [6,6,6]: return "アラシ(6)", 500, mul_arashi
        if d == [4,5,6]: return "シゴロ", 400, mul_shigoro
        if d == [1,2,3]: return "ヒフミ", -100, mul_hifumi
        if d[0]==d[1]: return f"出目{d[2]}", 100+d[2], mul_normal
        if d[1]==d[2]: return f"出目{d[0]}", 100+d[0], mul_normal
        if d[0]==d[2]: return f"出目{d[1]}", 100+d[1], mul_normal
        return "役なし", 0, mul_normal

    @discord.ui.button(label="🎲 サイコロを振る！(残り3回)", style=discord.ButtonStyle.success)
    async def roll(self, interaction, button):
        if interaction.user != self.user: return
        
        self.player_rolls += 1
        
        # 1〜2回目は「役なし」で引っ張るリアル演出 (40%で早めに出る)
        is_final_roll = (self.player_rolls >= 3) or (random.random() < 0.4)
        if is_final_roll:
            pd = self.generate_force_hand(self.target_hand_type)
        else:
            pd = self.generate_no_hand()
            
        ph, pr, pm = self.get_rank_and_score(pd)
        self.player_history.append(f"{pd} {ph}")
        
        if ph != "役なし" or self.player_rolls >= 3:
            self.player_hand = pd
            self.player_rank = pr
            self.player_name = ph
            self.player_mul = pm
            
            button.disabled = True
            button.label = "🎲 プレイヤーの役確定"
            await interaction.response.edit_message(view=self)
            
            await self.run_npc_turn(interaction)
        else:
            button.label = f"🎲 サイコロを振る！(残り{3 - self.player_rolls}回)"
            embed = discord.Embed(title="🎲 チンチロリン進行中", color=discord.Color.blue())
            embed.add_field(name="👤 あなたの履歴", value="\n".join(self.player_history), inline=False)
            await interaction.response.edit_message(content=interaction.message.content, embed=embed, view=self)

    async def run_npc_turn(self, interaction):
        bot = interaction.client
        npc_rolls = 0
        npc_history = []
        npc_rank = 0
        npc_name = ""
        npc_mul = 1
        
        await asyncio.sleep(1.0)
        
        if self.player_name == "シゴロ":
            win_status = "player_win"
            npc_name = "なし"
            npc_history = ["出番なし"]
            npc_rank = 0
            npc_mul = 1
            pm = self.player_mul
            bm = npc_mul
        else:
            is_player_win_type = self.target_hand_type in ("pinzoro", "arashi", "shigoro", "normal")
            
            while npc_rolls < 3:
                npc_rolls += 1
                for _ in range(50):
                    bd = [random.randint(1,6) for _ in range(3)]
                    bh, br, bm = self.get_rank_and_score(bd)
                    if is_player_win_type:
                        # NPCはプレイヤーより弱い役
                        if br < self.player_rank: break
                    else:
                        # NPCはプレイヤーより強い役
                        if br > self.player_rank: break
                        
                npc_history.append(f"{bd} {bh}")
                if bh != "役なし" or npc_rolls >= 3:
                    npc_rank = br
                    npc_name = bh
                    npc_mul = bm
                    
                    # 強制敗北補正 (どうしてもNPCが強くならなかった場合)
                    if not is_player_win_type and br <= self.player_rank:
                        if self.player_rank == 0:
                            npc_rank = 101
                            npc_name = "出目1"
                            npc_mul = 1
                            npc_history[-1] = f"[2, 2, 1] 出目1"
                        elif self.player_rank < 106:
                            better_eye = (self.player_rank - 100) + 1
                            if better_eye > 6: better_eye = 6
                            npc_rank = 100 + better_eye
                            npc_name = f"出目{better_eye}"
                            npc_mul = 1
                            other = 1 if better_eye != 1 else 2
                            npc_history[-1] = f"[{other}, {other}, {better_eye}] 出目{better_eye}"
                    break
                    
            pr = self.player_rank
            br = npc_rank
            pm = self.player_mul
            bm = npc_mul
            
            if pr == br:
                win_status = "draw"
            elif self.player_name == "役なし" and npc_name == "役なし":
                win_status = "draw"
            elif pr > br:
                win_status = "player_win"
            else:
                win_status = "npc_win"
            
        res = ""
        color = discord.Color.default()
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        tax_msg = ""
        
        if win_status == "draw":
            await database.add_balance(interaction.guild.id, self.user.id, self.bet)
            res = f"🤝 引き分け！お互い役なし\n賭け金 {self.bet} {currency_name} が戻りました。"
            color = discord.Color.light_grey()
        elif win_status == "player_win":
            win_mul = pm
            if bm < 0:
                win_mul = pm * abs(bm)
                
            win_amount = int(self.bet * win_mul)
            if get_setting(bot, "GAMBLE_TAX_ENABLED"):
                tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
                if tax_rate is None: tax_rate = 0.05
                tax_amount = int(win_amount * tax_rate)
                win_amount = win_amount - tax_amount
                tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
                
            await database.add_balance(interaction.guild.id, self.user.id, self.bet + win_amount)
            res = f"🏆 勝ち！ {win_amount} {currency_name} 獲得！{tax_msg}"
            color = discord.Color.gold()
        else:
            loss_mul = bm if bm > 0 else 1
            if pm < 0:
                loss_mul = loss_mul * abs(pm)
                
            extra_loss = self.bet * (loss_mul - 1)
            if extra_loss > 0:
                current_bal = await database.get_balance(interaction.guild.id, self.user.id)
                if current_bal >= extra_loss:
                    await database.remove_balance(interaction.guild.id, self.user.id, extra_loss)
                    res = f"💀 負け… (合計 {self.bet * loss_mul} {currency_name} 没収)"
                else:
                    await database.remove_balance(interaction.guild.id, self.user.id, current_bal)
                    res = f"💀 負け… (残高不足のため、残高全額没収)"
            else:
                res = f"💀 負け… {self.bet} {currency_name} 没収"
            color = discord.Color.red()
            
        embed = discord.Embed(title="🎲 チンチロリン結果", color=color)
        embed.add_field(name="👤 あなたの履歴", value="\n".join(self.player_history), inline=False)
        embed.add_field(name="🤖 Botの履歴", value="\n".join(npc_history), inline=False)
        embed.add_field(name="最終結果", value=f"👤 {self.player_name} vs 🤖 {npc_name}\n\n**{res}**", inline=False)
        
        try:
            await interaction.edit_original_response(embed=embed, view=None)
        except Exception as e:
            print(f"[ERROR] run_npc_turn edit: {e}")
            try:
                await interaction.message.edit(embed=embed, view=None)
            except Exception:
                pass

        # ギャンブルログ送信
        embed_log = discord.Embed(
            title="🎲 ギャンブルログ: チンチロリン",
            color=discord.Color.gold() if win_status == "player_win" else (discord.Color.red() if win_status == "npc_win" else discord.Color.light_grey()),
            timestamp=discord.utils.utcnow()
        )
        embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
        embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
        
        if win_status == "draw":
            embed_log.add_field(name="結果", value="引き分け 🤝", inline=True)
            embed_log.add_field(name="獲得額", value="±0", inline=True)
        elif win_status == "player_win":
            embed_log.add_field(name="結果", value="プレイヤー勝利 🏆", inline=True)
            embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount:,} {currency_name}", inline=True)
        else:
            embed_log.add_field(name="結果", value="ディーラー勝利 (負け) 💀", inline=True)
            actual_loss = self.bet
            if extra_loss > 0:
                actual_loss = self.bet + min(extra_loss, current_bal if 'current_bal' in locals() else extra_loss)
            embed_log.add_field(name="損失額", value=f"-{actual_loss:,} {currency_name}", inline=True)
            
        embed_log.add_field(name="プレイヤーの役", value=self.player_name, inline=True)
        embed_log.add_field(name="Botの役", value=npc_name, inline=True)
        await send_log(bot, interaction.guild, "gambling", embed_log)

class ChinchiroView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @discord.ui.button(label="🎲 チンチロリンで遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_chinchiro_btn")
    async def play(self, it, btn):
        await it.response.send_modal(ChinchiroBetModal())

# --- コイントス ---
class CoinflipBetModal(discord.ui.Modal, title='コイントス：賭け金入力'):
    bet_input = discord.ui.TextInput(label='賭ける金額', placeholder='例: 1000', max_length=10, required=True)
    async def on_submit(self, it: discord.Interaction):
        try:
            bot = it.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS") or 10
            bet = int(self.bet_input.value)
            if bet <= 0 or bet > max_bet:
                return await it.response.send_message(f"1〜{max_bet:,}の範囲で入力してください。", ephemeral=True)
            await it.response.defer(ephemeral=True)
            user_data = await database.get_user(it.guild.id, it.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(it.guild.id, it.user.id, today_str)
                count = 0
                daily_bet = 0
            max_plays = int(max_plays)
            if max_plays > 0 and count >= max_plays:
                return await it.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await it.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
            if await database.get_balance(it.guild.id, it.user.id) < bet:
                return await it.followup.send("残高不足です。", ephemeral=True)
            await it.followup.send(f"🪙 **コイントス！** (本日 {count+1}/{max_plays if max_plays > 0 else '無制限'}回目)\n「表」か「裏」か？", view=CoinflipGameView(it.user, bet, count), ephemeral=True)
        except:
            await it.response.send_message("数字を入力してください。", ephemeral=True)

class CoinflipGameView(discord.ui.View):
    def __init__(self, user, bet, count):
        super().__init__(timeout=60)
        self.user, self.bet, self.count = user, bet, count
        
    async def process(self, it, choice):
        bot = it.client
        if it.user != self.user: return
        if not await database.remove_balance(it.guild.id, self.user.id, self.bet):
            return await it.response.edit_message(content="残高不足", view=None)
        await database.increment_gambling_count(it.guild.id, self.user.id, self.bet)
        
        p_win = get_setting(bot, "GAMBLE_COINFLIP_RATE_WIN")
        p_lose = get_setting(bot, "GAMBLE_COINFLIP_RATE_LOSE")
        if p_win is None: p_win = 0.475
        if p_lose is None: p_lose = 0.525
        
        total = p_win + p_lose
        if total <= 0: total = 1.0
        win_prob = p_win / total
        
        if random.random() < win_prob:
            res = choice
        else:
            res = "tails" if choice == "heads" else "heads"
            
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        tax_msg = ""
        if choice == res:
            mul = get_setting(bot, "GAMBLE_COINFLIP_MUL")
            if mul is None: mul = 2.0
            win_amount = int(self.bet * mul)
            if get_setting(bot, "GAMBLE_TAX_ENABLED"):
                tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
                if tax_rate is None: tax_rate = 0.05
                net_profit = win_amount - self.bet
                tax_amount = int(net_profit * tax_rate)
                win_amount = self.bet + (net_profit - tax_amount)
                tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
            await database.add_balance(it.guild.id, self.user.id, win_amount)
            msg, color = f"🏆 当たり！ {win_amount} {currency_name} 獲得{tax_msg}", discord.Color.gold()
        else:
            msg, color = f"💀 外れ… {self.bet} {currency_name} 没収", discord.Color.red()
        await it.response.edit_message(content=None, embed=discord.Embed(title="🪙 結果", description=f"結果: {'表' if res=='heads' else '裏'}\n{msg}", color=color), view=None)

        # ギャンブルログ送信
        embed_log = discord.Embed(
            title="🪙 ギャンブルログ: コイントス",
            color=discord.Color.gold() if choice == res else discord.Color.red(),
            timestamp=discord.utils.utcnow()
        )
        embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
        embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
        
        if choice == res:
            embed_log.add_field(name="結果", value="勝ち (当たり) 🏆", inline=True)
            embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount:,} {currency_name}", inline=True)
        else:
            embed_log.add_field(name="結果", value="負け (外れ) 💀", inline=True)
            embed_log.add_field(name="損失額", value=f"-{self.bet:,} {currency_name}", inline=True)
            
        embed_log.add_field(name="選択", value="表" if choice=="heads" else "裏", inline=True)
        embed_log.add_field(name="実際の結果", value="表" if res=="heads" else "裏", inline=True)
        await send_log(bot, it.guild, "gambling", embed_log)
        
    @discord.ui.button(label="表", emoji="⚪")
    async def heads(self, it, btn): await self.process(it, "heads")
    @discord.ui.button(label="裏", emoji="⚫")
    async def tails(self, it, btn): await self.process(it, "tails")

class CoinflipView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @discord.ui.button(label="🪙 コイントスで遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_coinflip_btn")
    async def play(self, it, btn):
        await it.response.send_modal(CoinflipBetModal())

# --- スロット ---
class SlotBetModal(discord.ui.Modal, title='スロット：賭け金入力'):
    bet_input = discord.ui.TextInput(label='賭ける金額', placeholder='例: 1000', max_length=10, required=True)
    async def on_submit(self, it: discord.Interaction):
        try:
            bot = it.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS") or 10
            bet = int(self.bet_input.value)
            if bet <= 0 or bet > max_bet:
                return await it.response.send_message(f"1〜{max_bet:,}の範囲で入力してください。", ephemeral=True)
            await it.response.defer(ephemeral=True)
            user_data = await database.get_user(it.guild.id, it.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(it.guild.id, it.user.id, today_str)
                count = 0
                daily_bet = 0
            max_plays = int(max_plays)
            if max_plays > 0 and count >= max_plays:
                return await it.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await it.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
            if not await database.remove_balance(it.guild.id, it.user.id, bet):
                return await it.followup.send("残高不足です。", ephemeral=True)
            await database.increment_gambling_count(it.guild.id, it.user.id, bet)
            p_7 = get_setting(bot, "GAMBLE_SLOT_RATE_7")
            if p_7 is None: p_7 = 0.002
            p_star = get_setting(bot, "GAMBLE_SLOT_RATE_STAR")
            if p_star is None: p_star = 0.002
            p_triple = get_setting(bot, "GAMBLE_SLOT_RATE_THREE")
            if p_triple is None: p_triple = 0.012
            p_double = get_setting(bot, "GAMBLE_SLOT_RATE_TWO")
            if p_double is None: p_double = 0.328
            
            p_sum = p_7 + p_star + p_triple + p_double
            if p_sum > 1.0:
                p_7 /= p_sum
                p_star /= p_sum
                p_triple /= p_sum
                p_double /= p_sum
                
            rand = random.random()
            if rand < p_7:
                r = ["7️⃣", "7️⃣", "7️⃣"]
            elif rand < p_7 + p_star:
                r = ["⭐", "⭐", "⭐"]
            elif rand < p_7 + p_star + p_triple:
                other_emo = ["🍒", "🍋", "🍉", "🔔", "💎", "🍀"]
                chosen = random.choice(other_emo)
                r = [chosen, chosen, chosen]
            elif rand < p_7 + p_star + p_triple + p_double:
                emo = ["🍒", "🍋", "🍉", "🔔", "⭐", "7️⃣", "💎", "🍀"]
                c1 = random.choice(emo)
                remaining = [e for e in emo if e != c1]
                c2 = random.choice(remaining)
                r = [c1, c1, c2]
                random.shuffle(r)
            else:
                emo = ["🍒", "🍋", "🍉", "🔔", "⭐", "7️⃣", "💎", "🍀"]
                r = random.sample(emo, 3)
                
            mul_7 = get_setting(bot, "GAMBLE_SLOT_MUL_7") or 10.0
            mul_star = get_setting(bot, "GAMBLE_SLOT_MUL_STAR") or 5.0
            mul_three = get_setting(bot, "GAMBLE_SLOT_MUL_THREE") or 3.0
            mul_two = get_setting(bot, "GAMBLE_SLOT_MUL_TWO") or 1.5
            
            mul = mul_7 if r[0]==r[1]==r[2]=="7️⃣" else (mul_star if r[0]==r[1]==r[2]=="⭐" else (mul_three if r[0]==r[1]==r[2] else (mul_two if len(set(r))<3 else 0)))
            win = int(bet * mul)
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            tax_msg = ""
            if win > 0:
                if get_setting(bot, "GAMBLE_TAX_ENABLED"):
                    tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
                    if tax_rate is None: tax_rate = 0.05
                    net_profit = win - bet
                    tax_amount = int(net_profit * tax_rate)
                    win = bet + (net_profit - tax_amount)
                    tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
                await database.add_balance(it.guild.id, it.user.id, win)
            embed = discord.Embed(title="🎰 スロット結果", description=f"{r}\n{'🏆 当たり！' if win>0 else '💀 ハズレ'} {win} {currency_name} 獲得{tax_msg}", color=discord.Color.gold() if win>0 else discord.Color.red())
            await it.followup.send(embed=embed, ephemeral=True)

            # ギャンブルログ送信
            embed_log = discord.Embed(
                title="🎰 ギャンブルログ: スロット",
                color=discord.Color.gold() if win > 0 else discord.Color.red(),
                timestamp=discord.utils.utcnow()
            )
            embed_log.add_field(name="プレイヤー", value=f"{it.user.mention} (ID: {it.user.id})", inline=True)
            embed_log.add_field(name="賭け金", value=f"{bet:,} {currency_name}", inline=True)
            
            if win > 0:
                embed_log.add_field(name="結果", value="当たり 🏆", inline=True)
                embed_log.add_field(name="獲得額 (配当)", value=f"+{win:,} {currency_name} (倍率: {mul}倍)", inline=True)
            else:
                embed_log.add_field(name="結果", value="ハズレ 💀", inline=True)
                embed_log.add_field(name="損失額", value=f"-{bet:,} {currency_name}", inline=True)
                
            embed_log.add_field(name="出目", value=" | ".join(r), inline=True)
            await send_log(bot, it.guild, "gambling", embed_log)
        except:
            if not it.response.is_done():
                await it.response.send_message('エラー', ephemeral=True)
            else:
                await it.followup.send('エラー', ephemeral=True)

class SlotView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @discord.ui.button(label="🎰 スロットで遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_slot_btn")
    async def play(self, it, btn):
        await it.response.send_modal(SlotBetModal())

# --- ブラックジャック ---
class BlackjackBetModal(discord.ui.Modal, title='ブラックジャック：賭け金入力'):
    bet_input = discord.ui.TextInput(label='賭ける金額', placeholder='例: 1000', max_length=10, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            bet = int(self.bet_input.value)
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if bet <= 0 or bet > max_bet:
                return await interaction.response.send_message(f"1〜{max_bet:,}の範囲で入力してください。", ephemeral=True)
            await interaction.response.defer(ephemeral=True)
            user_data = await database.get_user(interaction.guild.id, interaction.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(interaction.guild.id, interaction.user.id, today_str)
                count = 0
                daily_bet = 0
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
            if max_plays is None: max_plays = 10
            else: max_plays = int(max_plays)
            if max_plays > 0 and count >= max_plays:
                return await interaction.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await interaction.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
            if await database.get_balance(interaction.guild.id, interaction.user.id) < bet:
                return await interaction.followup.send("残高不足です。", ephemeral=True)
            
            await database.remove_balance(interaction.guild.id, interaction.user.id, bet)
            await database.increment_gambling_count(interaction.guild.id, interaction.user.id, bet)
            
            view = BlackjackGameView(interaction.user, bet, interaction)
            initial_blackjack_embed = await view.check_initial_blackjack()
            if initial_blackjack_embed:
                await interaction.followup.send(f"🃏 **ブラックジャック開始！** (本日 {count+1}/{max_plays if max_plays > 0 else '無制限'}回目)\n賭け金: **{bet} {currency_name}**", embed=initial_blackjack_embed, ephemeral=True)
            else:
                embed = view.build_embed(description="カードが配られました。どうしますか？")
                msg = await interaction.followup.send(f"🃏 **ブラックジャック開始！** (本日 {count+1}/{max_plays if max_plays > 0 else '無制限'}回目)\n賭け金: **{bet} {currency_name}**", embed=embed, view=view, ephemeral=True)
                view.message = msg
        except ValueError:
            try:
                await interaction.followup.send("金額は半角数字で入力してください。", ephemeral=True)
            except Exception:
                await interaction.response.send_message("金額は半角数字で入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] BlackjackBetModal: {e}")
            try:
                await interaction.followup.send("エラーが発生しました。", ephemeral=True)
            except Exception:
                await interaction.response.send_message("エラーが発生しました。", ephemeral=True)

class BlackjackGameView(discord.ui.View):
    def __init__(self, user, bet, interaction=None):
        super().__init__(timeout=60)
        self.user = user
        self.bet = bet
        self.interaction = interaction
        self.deck = create_blackjack_deck()
        self.message = None
        
        # ゲーム開始時に結果を事前抽選
        self.target_outcome = self.determine_target_outcome()
        
        if self.target_outcome == "bj_win":
            # プレイヤーに強制的にブラックジャック(Aと10)を配る
            ace = next(c for c in self.deck if c['value'] == 'A')
            self.deck.remove(ace)
            ten = next(c for c in self.deck if c['value'] in ('10', 'J', 'Q', 'K'))
            self.deck.remove(ten)
            self.player_hand = [ace, ten]
            
            # ディーラーはBJ以外にする
            self.dealer_hand = [self.deck.pop(), self.deck.pop()]
            if calculate_blackjack_score(self.dealer_hand) == 21:
                returned_card = self.dealer_hand.pop()
                self.dealer_hand.append(self.deck.pop())
                self.deck.insert(0, returned_card)
        else:
            self.player_hand = [self.deck.pop(), self.deck.pop()]
            # 初期BJにならないように調整
            while calculate_blackjack_score(self.player_hand) == 21:
                returned_card = self.player_hand.pop()
                self.player_hand.append(self.deck.pop())
                self.deck.insert(0, returned_card)
            self.dealer_hand = [self.deck.pop(), self.deck.pop()]

    def determine_target_outcome(self):
        bot = _bot_instance
        p_normal = get_setting(bot, "GAMBLE_BLACKJACK_RATE_NORMAL_WIN") or 0.38
        p_bj = get_setting(bot, "GAMBLE_BLACKJACK_RATE_BJ_WIN") or 0.05
        p_draw = get_setting(bot, "GAMBLE_BLACKJACK_RATE_DRAW") or 0.09
        p_lose = get_setting(bot, "GAMBLE_BLACKJACK_RATE_LOSE") or 0.48
        
        total = p_normal + p_bj + p_draw + p_lose
        if total <= 0: total = 1.0
        
        r = random.random() * total
        if r < p_normal:
            return "win"
        elif r < p_normal + p_bj:
            return "bj_win"
        elif r < p_normal + p_bj + p_draw:
            return "draw"
        else:
            return "lose"

    def format_hand(self, hand, hide_second=False):
        if hide_second:
            return f"{hand[0]['suit']} **{hand[0]['value']}**,  ❓ **?**"
        return ", ".join(f"{card['suit']} **{card['value']}**" for card in hand)

    def get_visible_score(self, hand, hide_second=False):
        if hide_second:
            return calculate_blackjack_score([hand[0]])
        return calculate_blackjack_score(hand)

    def build_embed(self, title="🃏 ブラックジャック", color=0x3498db, description="", is_final=False):
        embed = discord.Embed(title=title, color=color, description=description)
        
        dealer_cards = self.format_hand(self.dealer_hand, hide_second=not is_final)
        dealer_score = self.get_visible_score(self.dealer_hand, hide_second=not is_final)
        embed.add_field(
            name=f"🤖 ディーラー (Score: {dealer_score}{' + ?' if not is_final else ''})",
            value=dealer_cards,
            inline=False
        )
        
        player_cards = self.format_hand(self.player_hand)
        player_score = calculate_blackjack_score(self.player_hand)
        embed.add_field(
            name=f"👤 あなた (Score: {player_score})",
            value=player_cards,
            inline=False
        )
        return embed

    async def check_initial_blackjack(self):
        bot = _bot_instance
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        player_score = calculate_blackjack_score(self.player_hand)
        if player_score == 21:
            dealer_score = calculate_blackjack_score(self.dealer_hand)
            if dealer_score == 21:
                win_amount = self.bet
                await database.add_balance(self.user.guild.id, self.user.id, win_amount)
                title = "🤝 引き分け"
                color = discord.Color.light_grey()
                description = f"双方ブラックジャック！引き分け（プッシュ）です。\n**{win_amount} {currency_name}** が戻ります。"

                # ギャンブルログ送信
                embed_log = discord.Embed(title="🃏 ギャンブルログ: ブラックジャック", color=color, timestamp=discord.utils.utcnow())
                embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
                embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
                embed_log.add_field(name="結果", value="引き分け (双方BJ) 🤝", inline=True)
                embed_log.add_field(name="獲得額", value="±0", inline=True)
                embed_log.add_field(name="プレイヤー手札", value=f"Score: {player_score}", inline=True)
                embed_log.add_field(name="ディーラー手札", value=f"Score: {dealer_score}", inline=True)
                await send_log(bot, self.user.guild, "gambling", embed_log)
            else:
                mul_bj = get_setting(bot, "GAMBLE_BLACKJACK_MUL_BJ") or 2.5
                win_amount = int(self.bet * mul_bj)
                tax_msg = ""
                if get_setting(bot, "GAMBLE_TAX_ENABLED"):
                    tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
                    if tax_rate is None: tax_rate = 0.05
                    net_profit = win_amount - self.bet
                    tax_amount = int(net_profit * tax_rate)
                    win_amount = self.bet + (net_profit - tax_amount)
                    tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
                await database.add_balance(self.user.guild.id, self.user.id, win_amount)
                title = "🃏 ブラックジャック！"
                color = discord.Color.gold()
                description = f"ブラックジャック達成！\n**{win_amount} {currency_name}** 獲得！{tax_msg}"

                # ギャンブルログ送信
                embed_log = discord.Embed(title="🃏 ギャンブルログ: ブラックジャック", color=color, timestamp=discord.utils.utcnow())
                embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
                embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
                embed_log.add_field(name="結果", value="プレイヤー勝利 (BJ) 🏆", inline=True)
                embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount - self.bet:,} {currency_name}", inline=True)
                embed_log.add_field(name="プレイヤー手札", value=f"Score: {player_score}", inline=True)
                embed_log.add_field(name="ディーラー手札", value=f"Score: {dealer_score}", inline=True)
                await send_log(bot, self.user.guild, "gambling", embed_log)
            return self.build_embed(title=title, color=color, description=description, is_final=True)
        return None

    async def on_timeout(self):
        for child in self.children:
            if not child.disabled:
                break
        else:
            return
        await self.resolve_stand(None)

    @discord.ui.button(label="カードを引く (Hit)", style=discord.ButtonStyle.success, emoji="🃏")
    async def hit(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user != self.user:
            return await interaction.response.send_message("これはあなたのゲームではありません。", ephemeral=True)
        if getattr(self, 'processing', False):
            try:
                await interaction.response.defer()
            except:
                pass
            return
        self.processing = True
        try:
            await interaction.response.defer()
        except:
            pass
        
        self.player_hand.append(self.deck.pop())
        score = calculate_blackjack_score(self.player_hand)
        
        currency_name = get_setting(interaction.client, "CURRENCY_NAME") or "コイン"
        if score > 21:
            await self.resolve_bust(interaction)
        elif score == 21:
            await self.resolve_stand(interaction)
        else:
            embed = self.build_embed(description="どうしますか？")
            try:
                await interaction.edit_original_response(embed=embed, view=self)
            except Exception:
                pass
            self.processing = False

    @discord.ui.button(label="勝負する (Stand)", style=discord.ButtonStyle.danger, emoji="🛑")
    async def stand(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user != self.user:
            return await interaction.response.send_message("これはあなたのゲームではありません。", ephemeral=True)
        if getattr(self, 'processing', False):
            try:
                await interaction.response.defer()
            except:
                pass
            return
        self.processing = True
        try:
            await interaction.response.defer()
        except:
            pass
        
        await self.resolve_stand(interaction)

    async def resolve_bust(self, interaction: discord.Interaction):
        for child in self.children:
            child.disabled = True
        bot = interaction.client
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        embed = self.build_embed(
            title="💀 バスト！",
            color=discord.Color.red(),
            description=f"手札の合計が21を超えました！\n**{self.bet} {currency_name}** 没収...",
            is_final=True
        )
        try:
            await interaction.edit_original_response(embed=embed, view=self)
        except Exception:
            try:
                await interaction.response.edit_message(embed=embed, view=self)
            except Exception:
                pass

        # ギャンブルログ送信
        player_score = calculate_blackjack_score(self.player_hand)
        dealer_score = calculate_blackjack_score(self.dealer_hand)
        embed_log = discord.Embed(title="🃏 ギャンブルログ: ブラックジャック", color=discord.Color.red(), timestamp=discord.utils.utcnow())
        embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
        embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
        embed_log.add_field(name="結果", value="プレイヤー敗北 (バスト) 💀", inline=True)
        embed_log.add_field(name="損失額", value=f"-{self.bet:,} {currency_name}", inline=True)
        embed_log.add_field(name="プレイヤー手札", value=f"Score: {player_score}", inline=True)
        embed_log.add_field(name="ディーラー手札", value=f"Score: {self.get_visible_score(self.dealer_hand, hide_second=True)}", inline=True)
        await send_log(bot, interaction.guild, "gambling", embed_log)

    async def resolve_stand(self, interaction: discord.Interaction = None):
        bot = interaction.client if interaction else self.user.guild.me
        player_score = calculate_blackjack_score(self.player_hand)
        for child in self.children:
            child.disabled = True
            
        outcome = self.target_outcome
        if outcome == "bj_win":
            pass # bj_win is handled during initial check
            
        # ディーラーは17以上になるまでヒットし続ける
        while calculate_blackjack_score(self.dealer_hand) < 17:
            self.dealer_hand.append(self.deck.pop())
            
        dealer_score = calculate_blackjack_score(self.dealer_hand)
        
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        win_amount = 0
        is_win = False
        mul_normal = get_setting(bot, "GAMBLE_BLACKJACK_MUL_NORMAL") or 2.0
        tax_msg = ""
        
        if dealer_score > 21:
            win_amount = int(self.bet * mul_normal)
            is_win = True
            title = "🏆 勝ち！"
            color = discord.Color.gold()
        elif player_score > dealer_score:
            win_amount = int(self.bet * mul_normal)
            is_win = True
            title = "🏆 勝ち！"
            color = discord.Color.gold()
        elif player_score < dealer_score:
            title = "💀 負け…"
            color = discord.Color.red()
            description = f"ディーラーに敗北しました...\n**{self.bet} {currency_name}** 没収..."
        else:
            win_amount = self.bet
            title = "🤝 引き分け"
            color = discord.Color.light_grey()
            description = f"引き分け（プッシュ）です。\n**{win_amount} {currency_name}** が戻ります。"
            
        if is_win:
            if get_setting(bot, "GAMBLE_TAX_ENABLED"):
                tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
                if tax_rate is None: tax_rate = 0.05
                net_profit = win_amount - self.bet
                tax_amount = int(net_profit * tax_rate)
                win_amount = self.bet + (net_profit - tax_amount)
                tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
            
            if dealer_score > 21:
                description = f"ディーラーがバストしました！\n**{win_amount} {currency_name}** 獲得！{tax_msg}"
            else:
                description = f"ディーラーを上回りました！\n**{win_amount} {currency_name}** 獲得！{tax_msg}"
            
        embed = self.build_embed(title=title, color=color, description=description, is_final=True)

        # UIを先に更新する (遅延を防ぐため)
        if interaction:
            try:
                await interaction.edit_original_response(embed=embed, view=self)
            except Exception:
                try:
                    await interaction.response.edit_message(embed=embed, view=self)
                except Exception:
                    pass
        else:
            if self.interaction:
                try:
                    await self.interaction.edit_original_response(embed=embed, view=self)
                except Exception:
                    try:
                        await self.message.edit(embed=embed, view=self)
                    except Exception:
                        pass
            else:
                try:
                    await self.message.edit(embed=embed, view=self)
                except Exception:
                    pass

        if win_amount > 0:
            await database.add_balance(interaction.guild.id if interaction else self.user.guild.id, self.user.id, win_amount)

        # ギャンブルログ送信
        embed_log = discord.Embed(title="🃏 ギャンブルログ: ブラックジャック", color=color, timestamp=discord.utils.utcnow())
        embed_log.add_field(name="プレイヤー", value=f"{self.user.mention} (ID: {self.user.id})", inline=True)
        embed_log.add_field(name="賭け金", value=f"{self.bet:,} {currency_name}", inline=True)
        
        if dealer_score > 21:
            embed_log.add_field(name="結果", value="プレイヤー勝利 (ディーラーバスト) 🏆", inline=True)
            embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount - self.bet:,} {currency_name}", inline=True)
        elif player_score > dealer_score:
            embed_log.add_field(name="結果", value="プレイヤー勝利 🏆", inline=True)
            embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount - self.bet:,} {currency_name}", inline=True)
        elif player_score < dealer_score:
            embed_log.add_field(name="結果", value="プレイヤー敗北 💀", inline=True)
            embed_log.add_field(name="損失額", value=f"-{self.bet:,} {currency_name}", inline=True)
        else:
            embed_log.add_field(name="結果", value="引き分け 🤝", inline=True)
            embed_log.add_field(name="獲得額", value="±0", inline=True)
            
        embed_log.add_field(name="プレイヤー手札", value=f"Score: {player_score}", inline=True)
        embed_log.add_field(name="ディーラー手札", value=f"Score: {dealer_score}", inline=True)
        await send_log(bot, interaction.guild if interaction else self.user.guild, "gambling", embed_log)

class BlackjackView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @discord.ui.button(label="🃏 ブラックジャックで遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_blackjack_btn")
    async def play(self, it, btn):
        await it.response.send_modal(BlackjackBetModal())

# --- ルーレット ---
class RouletteBetModal(discord.ui.Modal, title='ルーレット：賭け金入力'):
    bet_input = discord.ui.TextInput(label='賭ける金額', placeholder='例: 1000', max_length=10, required=True)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            bet = int(self.bet_input.value)
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if bet <= 0 or bet > max_bet:
                return await interaction.response.send_message(f"1〜{max_bet:,} the rangeで入力してください。", ephemeral=True)
            await interaction.response.defer(ephemeral=True)
            
            user_data = await database.get_user(interaction.guild.id, interaction.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(interaction.guild.id, interaction.user.id, today_str)
                count = 0
                daily_bet = 0
                
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
            if max_plays is None: max_plays = 10
            else: max_plays = int(max_plays)
            if max_plays > 0 and count >= max_plays:
                return await interaction.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
                
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await interaction.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
                
            if await database.get_balance(interaction.guild.id, interaction.user.id) < bet:
                return await interaction.followup.send("残高不足です。", ephemeral=True)
            
            view = RouletteBetTypeView(interaction.user, bet, count)
            embed = discord.Embed(
                title="🎡 ルーレット",
                description=(
                    f"**現在のベット額**: {bet} {currency_name}\n\n"
                    "賭け先を以下から選択してください。\n"
                    "- 赤 / 黒 / 偶数 / 奇数 / ロー / ハイ: **配当2.0倍**\n"
                    "- ダズン (1-12, 13-24, 25-36): **配当3.0倍**\n"
                    "- 数字1点賭け (0-36): **配当36.0倍**"
                ),
                color=0x3498db
            )
            msg = await interaction.followup.send(embed=embed, view=view, ephemeral=True)
            view.message = msg
        except ValueError:
            await interaction.followup.send("金額は半角数字で入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] RouletteBetModal: {e}")

class RouletteBetTypeView(discord.ui.View):
    def __init__(self, user, bet, count):
        super().__init__(timeout=60)
        self.user = user
        self.bet = bet
        self.count = count
        self.message = None
        self.add_item(RouletteTypeSelect())

    @discord.ui.button(label="🎯 数字1点賭け (0-36)", style=discord.ButtonStyle.secondary, row=1)
    async def bet_number_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user != self.user:
            return await interaction.response.send_message("これはあなたのゲームではありません。", ephemeral=True)
        await interaction.response.send_modal(RouletteNumberModal(self.bet, self.count, self.message))

class RouletteTypeSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="🔴 赤に賭ける", description="配当 2.0倍", value="red"),
            discord.SelectOption(label="⚫ 黒に賭ける", description="配当 2.0倍", value="black"),
            discord.SelectOption(label="🔢 偶数に賭ける", description="配当 2.0倍 (0は除く)", value="even"),
            discord.SelectOption(label="🔣 奇数に賭ける", description="配当 2.0倍", value="odd"),
            discord.SelectOption(label="⬇️ ローに賭ける (1-18)", description="配当 2.0倍", value="low"),
            discord.SelectOption(label="⬆️ ハイに賭ける (19-36)", description="配当 2.0倍", value="high"),
            discord.SelectOption(label="1️⃣ 第1ダズン (1-12)", description="配当 3.0倍", value="dozen1"),
            discord.SelectOption(label="2️⃣ 第2ダズン (13-24)", description="配当 3.0倍", value="dozen2"),
            discord.SelectOption(label="3️⃣ 第3ダズン (25-36)", description="配当 3.0倍", value="dozen3"),
        ]
        super().__init__(placeholder="賭け先を選択してください...", min_values=1, max_values=1, options=options, row=0)

    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("これはあなたのゲームではありません。", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        await run_roulette_game(interaction, view.user, view.bet, view.count, self.values[0], None)

class RouletteNumberModal(discord.ui.Modal, title='ルーレット：数字1点賭け'):
    number_input = discord.ui.TextInput(label='賭ける数字 (0〜36)', placeholder='例: 7', max_length=2, required=True)
    def __init__(self, bet, count, game_msg):
        super().__init__()
        self.bet = bet
        self.count = count
        self.game_msg = game_msg

    async def on_submit(self, interaction: discord.Interaction):
        try:
            target_num = int(self.number_input.value)
            if target_num < 0 or target_num > 36:
                return await interaction.response.send_message("0から36の間の数字を入力してください。", ephemeral=True)
            await interaction.response.defer(ephemeral=True)
            await run_roulette_game(interaction, interaction.user, self.bet, self.count, "number", target_num)
        except ValueError:
            await interaction.response.send_message("数字は半角で入力してください。", ephemeral=True)

async def run_roulette_game(interaction: discord.Interaction, user, bet, count, bet_type, target_num):
    bot = interaction.client
    user_data = await database.get_user(interaction.guild.id, user.id)
    now = datetime.datetime.now(JST)
    today_str = now.strftime("%Y-%m-%d")
    current_count = user_data.get("chinchiro_count", 0)
    daily_bet = user_data.get("chinchiro_daily_bet", 0)
    
    if user_data.get("chinchiro_last_date") != today_str:
        await database.reset_gambling_count(interaction.guild.id, user.id, today_str)
        current_count = 0
        daily_bet = 0
        
    max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
    if max_plays is None: max_plays = 10
    else: max_plays = int(max_plays)
    if max_plays > 0 and current_count >= max_plays:
        try:
            await interaction.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
        except Exception:
            await interaction.response.send_message(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
        return
        
    daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
        try:
            await interaction.followup.send(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
        except Exception:
            await interaction.response.send_message(f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}", ephemeral=True)
        return
        
    if not await database.remove_balance(interaction.guild.id, user.id, bet):
        try:
            await interaction.followup.send("残高不足です。", ephemeral=True)
        except Exception:
            await interaction.response.send_message("残高不足です。", ephemeral=True)
        return
        
    await database.increment_gambling_count(interaction.guild.id, user.id, bet)
    
    red_numbers = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
    
    def get_color_emoji(n):
        if n == 0:
            return "🟢0"
        return f"🔴{n}" if n in red_numbers else f"⚫{n}"
        
    spin_sequence = []
    for _ in range(5):
        dummy_num = random.randint(0, 36)
        spin_sequence.append(get_color_emoji(dummy_num))
        
    if bet_type == "number":
        rate_key, mul_key = "GAMBLE_ROULETTE_WIN_RATE_36X", "GAMBLE_ROULETTE_MUL_36X"
        def_rate, def_mul = 0.0264, 36.0
    elif bet_type in ("dozen1", "dozen2", "dozen3"):
        rate_key, mul_key = "GAMBLE_ROULETTE_WIN_RATE_3X", "GAMBLE_ROULETTE_MUL_3X"
        def_rate, def_mul = 0.316, 3.0
    else:
        rate_key, mul_key = "GAMBLE_ROULETTE_WIN_RATE_2X", "GAMBLE_ROULETTE_MUL_2X"
        def_rate, def_mul = 0.475, 2.0
        
    p_win = get_setting(bot, rate_key)
    if p_win is None: p_win = def_rate
    
    multiplier = get_setting(bot, mul_key)
    if multiplier is None: multiplier = def_mul
    
    winning_nums = [n for n in range(37) if check_roulette_win(n, bet_type, target_num)[0]]
    losing_nums = [n for n in range(37) if not check_roulette_win(n, bet_type, target_num)[0]]
    
    if random.random() < p_win:
        forced_win = True
    else:
        forced_win = False
        
    if forced_win is True:
        final_number = random.choice(winning_nums) if winning_nums else random.randint(0, 36)
    else:
        final_number = random.choice(losing_nums) if losing_nums else random.randint(0, 36)
    
    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    embed = discord.Embed(
        title="🎡 ルーレット回転中...",
        description=f"賭け先: **{format_bet_type(bet_type, target_num)}**\n賭け金: **{bet} {currency_name}**\n\n"
                    f"spinning: [ {' ➔ '.join(spin_sequence[:3])} ]",
        color=0x3498db
    )
    
    try:
        await interaction.edit_original_response(embed=embed, view=None)
    except Exception as e:
        print(f"[ERROR] run_roulette_game spin1: {e}")
        if not interaction.is_expired():
            try:
                await interaction.response.edit_message(embed=embed, view=None)
            except Exception:
                await interaction.followup.send(embed=embed, ephemeral=True)
        else:
            await interaction.channel.send(embed=embed)
        
    await asyncio.sleep(1.2)
    
    embed.title = "🎡 ルーレット減速中..."
    embed.description = f"賭け先: **{format_bet_type(bet_type, target_num)}**\n賭け金: **{bet} {currency_name}**\n\n" \
                        f"spinning: [ {' ➔ '.join(spin_sequence[2:])} ➔ ??? ]"
    
    try:
        await interaction.edit_original_response(embed=embed)
    except Exception as e:
        print(f"[ERROR] run_roulette_game spin2: {e}")
        await interaction.followup.edit_message(message_id=interaction.message.id, embed=embed)
    
    await asyncio.sleep(1.2)
    
    is_win, _ = check_roulette_win(final_number, bet_type, target_num)
    win_amount = int(bet * multiplier) if is_win else 0
    tax_msg = ""
    
    if win_amount > 0:
        if get_setting(bot, "GAMBLE_TAX_ENABLED"):
            tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
            if tax_rate is None: tax_rate = 0.05
            net_profit = win_amount - bet
            tax_amount = int(net_profit * tax_rate)
            win_amount = bet + (net_profit - tax_amount)
            tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
        await database.add_balance(interaction.guild.id, user.id, win_amount)
        
    color_emoji = get_color_emoji(final_number)
    if is_win:
        title = "🏆 当たり！"
        color = discord.Color.gold()
        desc = f"結果: **{color_emoji}**\n賭け先: **{format_bet_type(bet_type, target_num)}**\n\n" \
               f"見事に的中しました！\n**{win_amount} {currency_name}** 獲得！{tax_msg}"
    else:
        title = "💀 ハズレ…"
        color = discord.Color.red()
        desc = f"結果: **{color_emoji}**\n賭け先: **{format_bet_type(bet_type, target_num)}**\n\n" \
               f"残念、ハズレです...\n**{bet} {currency_name}** 没収。"
               
    embed = discord.Embed(title=title, description=desc, color=color)
    embed.set_footer(text=f"本日 {current_count+1}/10回目")
    
    try:
        await interaction.edit_original_response(embed=embed)
    except Exception as e:
        print(f"[ERROR] run_roulette_game result: {e}")
        await interaction.followup.edit_message(message_id=interaction.message.id, embed=embed)

    # ギャンブルログ送信
    embed_log = discord.Embed(title="🎡 ギャンブルログ: ルーレット", color=color, timestamp=discord.utils.utcnow())
    embed_log.add_field(name="プレイヤー", value=f"{user.mention} (ID: {user.id})", inline=True)
    embed_log.add_field(name="賭け金", value=f"{bet:,} {currency_name}", inline=True)
    if win_amount > 0:
        embed_log.add_field(name="結果", value="当たり 🏆", inline=True)
        embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount - bet:,} {currency_name} (倍率: {multiplier}倍)", inline=True)
    else:
        embed_log.add_field(name="結果", value="ハズレ 💀", inline=True)
        embed_log.add_field(name="損失額", value=f"-{bet:,} {currency_name}", inline=True)
    embed_log.add_field(name="賭け先", value=format_bet_type(bet_type, target_num), inline=True)
    embed_log.add_field(name="出目", value=color_emoji, inline=True)
    await send_log(bot, interaction.guild, "gambling", embed_log)

class RouletteView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @discord.ui.button(label="🎡 ルーレットで遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_roulette_btn")
    async def play(self, it, btn):
        await it.response.send_modal(RouletteBetModal())

# --- 競馬 (Horse Racing) ---
HORSE_DATA = [
    {"num": 1, "name": "キタサンブラック", "emoji": "🟥", "icon": "1️⃣"},
    {"num": 2, "name": "ディープインパクト", "emoji": "🟦", "icon": "2️⃣"},
    {"num": 3, "name": "オルフェーヴル", "emoji": "🟩", "icon": "3️⃣"},
    {"num": 4, "name": "ゴールドシップ", "emoji": "🟨", "icon": "4️⃣"},
    {"num": 5, "name": "イクイノックス", "emoji": "🟪", "icon": "5️⃣"},
]

def render_horse_track(positions, horses=HORSE_DATA, track_length=15):
    """各馬の位置(0〜track_length)を受け取り、トラックの文字列を作成する"""
    lines = []
    lines.append("🏁" + "━" * (track_length + 2) + " [START]")
    for h in horses:
        p = min(positions.get(h["num"], 0), track_length)
        before = "━" * p
        after = "━" * max(0, track_length - p)
        horse_icon = "🏇" if p < track_length else "🏆"
        lines.append(f"{h['icon']}{h['emoji']} ┫{before}{horse_icon}{after}┣ 🏁 ({h['name']})")
    return "\n".join(lines)

class HorseRacingBetModal(discord.ui.Modal):
    def __init__(self, horse_num: int, bet_type: str):
        self.horse_num = horse_num
        self.bet_type = bet_type
        horse_name = next((h["name"] for h in HORSE_DATA if h["num"] == horse_num), f"{horse_num}号馬")
        type_name = "単勝(1着)" if bet_type == "tan" else "複勝(1〜3着)"
        super().__init__(title=f'競馬賭け金: {horse_num}号馬({type_name})')
        
        self.bet_input = discord.ui.TextInput(
            label='賭ける金額',
            placeholder='例: 1000',
            max_length=10,
            required=True
        )
        self.add_item(self.bet_input)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            max_bet = int(get_setting(bot, "GAMBLE_MAX_BET") or 100000)
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
            if max_plays is None: max_plays = 10
            else: max_plays = int(max_plays)
            
            try:
                bet = int(self.bet_input.value)
            except ValueError:
                return await interaction.response.send_message("賭け金には半角数字を入力してください。", ephemeral=True)
                
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            if bet <= 0 or bet > max_bet:
                return await interaction.response.send_message(f"1〜{max_bet:,} {currency_name} の範囲で入力してください。", ephemeral=True)

            await interaction.response.defer(ephemeral=True)
            user_data = await database.get_user(interaction.guild.id, interaction.user.id)
            now = datetime.datetime.now(JST)
            today_str = now.strftime("%Y-%m-%d")
            count = user_data.get("chinchiro_count", 0)
            daily_bet = user_data.get("chinchiro_daily_bet", 0)
            
            if user_data.get("chinchiro_last_date") != today_str:
                await database.reset_gambling_count(interaction.guild.id, interaction.user.id, today_str)
                count = 0
                daily_bet = 0
                
            if max_plays > 0 and count >= max_plays:
                return await interaction.followup.send(f"本日のプレイ上限({max_plays}回)に達しました。", ephemeral=True)
                
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            if daily_limit is not None and int(daily_limit) > 0 and daily_bet + bet > int(daily_limit):
                return await interaction.followup.send(
                    f"1日の賭け金上限({int(daily_limit):,} {currency_name})を超えるため賭けられません。\n本日既に賭けた額: {daily_bet:,} {currency_name}",
                    ephemeral=True
                )
                
            if not await database.remove_balance(interaction.guild.id, interaction.user.id, bet):
                return await interaction.followup.send("残高不足です。", ephemeral=True)
                
            await database.increment_gambling_count(interaction.guild.id, interaction.user.id, bet)
            
            # レース実行
            await execute_horse_race(interaction, self.horse_num, self.bet_type, bet, count + 1, max_plays)
        except Exception as e:
            print(f"[ERROR] HorseRacingBetModal: {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message("エラーが発生しました。", ephemeral=True)
            else:
                await interaction.followup.send("エラーが発生しました。", ephemeral=True)

class HorseRacingSelect(discord.ui.Select):
    def __init__(self, bot):
        mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN") or 4.5
        mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU") or 1.5
        
        options = []
        for h in HORSE_DATA:
            options.append(
                discord.SelectOption(
                    label=f"🥇 単勝: {h['num']}号馬 {h['name']} ({mul_tan}倍)",
                    value=f"{h['num']}_tan",
                    description=f"{h['name']} が 1着 で的中！",
                    emoji=h["emoji"]
                )
            )
        for h in HORSE_DATA:
            options.append(
                discord.SelectOption(
                    label=f"🥉 複勝: {h['num']}号馬 {h['name']} ({mul_fuku}倍)",
                    value=f"{h['num']}_fuku",
                    description=f"{h['name']} が 1〜3着 で的中！",
                    emoji="🎫"
                )
            )
            
        super().__init__(
            placeholder="賭ける馬と馬券種別を選択...",
            options=options,
            min_values=1,
            max_values=1,
            custom_id="horse_racing_bet_select"
        )
        
    async def callback(self, interaction: discord.Interaction):
        val = self.values[0]
        num_str, bet_type = val.split("_")
        horse_num = int(num_str)
        await interaction.response.send_modal(HorseRacingBetModal(horse_num, bet_type))

class HorseRacingBetTypeView(discord.ui.View):
    def __init__(self, bot):
        super().__init__(timeout=60)
        self.add_item(HorseRacingSelect(bot))

async def execute_horse_race(interaction: discord.Interaction, user_horse_num: int, bet_type: str, bet: int, play_count: int, max_plays: int):
    bot = interaction.client
    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    
    # 確率・倍率の取得
    p_tan = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_TAN")
    if p_tan is None: p_tan = 0.20
    p_fuku = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_FUKU")
    if p_fuku is None: p_fuku = 0.60
    
    mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN")
    if mul_tan is None: mul_tan = 4.5
    mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU")
    if mul_fuku is None: mul_fuku = 1.5
    
    user_horse = next((h for h in HORSE_DATA if h["num"] == user_horse_num), HORSE_DATA[0])
    type_label = f"単勝 ({mul_tan}倍)" if bet_type == "tan" else f"複勝 ({mul_fuku}倍)"
    
    # 順位の事前抽選
    all_nums = [h["num"] for h in HORSE_DATA]
    other_nums = [n for n in all_nums if n != user_horse_num]
    random.shuffle(other_nums)
    
    is_win = False
    mul = 0.0
    
    if bet_type == "tan":
        if random.random() < p_tan:
            is_win = True
            mul = mul_tan
            final_ranking = [user_horse_num] + other_nums
        else:
            pos = random.randint(1, 4)
            final_ranking = other_nums[:pos] + [user_horse_num] + other_nums[pos:]
    else:
        if random.random() < p_fuku:
            is_win = True
            mul = mul_fuku
            pos = random.randint(0, 2)
            final_ranking = other_nums[:pos] + [user_horse_num] + other_nums[pos:]
        else:
            pos = random.randint(3, 4)
            final_ranking = other_nums[:pos] + [user_horse_num] + other_nums[pos:]
            
    track_len = 15
    final_scores = {}
    for rank_idx, h_num in enumerate(final_ranking):
        final_scores[h_num] = track_len - rank_idx * 1
        
    steps_data = [
        {
            "phase": "🚩 【スタート！】",
            "commentary": "各馬綺麗なスタート！一斉にゲートを飛び出しました！",
            "progress": 0.25
        },
        {
            "phase": "🏃 【第2コーナー通過】",
            "commentary": "先頭争いが激化！激しいポジション争いが繰り広げられています！",
            "progress": 0.55
        },
        {
            "phase": "🔥 【第3〜4コーナー！】",
            "commentary": "馬群が凝縮！各馬最後の直線に向けて仕掛け始めました！",
            "progress": 0.80
        },
        {
            "phase": "⚡ 【最後の直線！！】",
            "commentary": "残り200m！外から強烈な追い上げ！先頭は譲らない！！",
            "progress": 0.95
        }
    ]
    
    race_frames = []
    for s_idx, step in enumerate(steps_data):
        ratio = step["progress"]
        positions = {}
        for h in HORSE_DATA:
            h_num = h["num"]
            target_p = final_scores[h_num] * ratio
            noise = random.uniform(-1.5, 1.5) if s_idx < 3 else random.uniform(-0.5, 0.5)
            p = max(0, min(track_len - 1, int(round(target_p + noise))))
            positions[h_num] = p
        race_frames.append((step["phase"], step["commentary"], positions))
        
    goal_positions = {}
    for rank_idx, h_num in enumerate(final_ranking):
        goal_positions[h_num] = track_len if rank_idx == 0 else max(1, track_len - rank_idx)
    race_frames.append(("🏆 【ゴールイン！！】", "全馬ゴールイン！白熱の勝負が決着しました！", goal_positions))
    
    # 1. 初期メッセージ送信
    phase, comm, pos = race_frames[0]
    track_str = render_horse_track(pos, HORSE_DATA, track_len)
    
    embed = discord.Embed(
        title="🏇 競馬レース開催中！",
        description=(
            f"**あなたの選択**: {user_horse['icon']}{user_horse['emoji']} **{user_horse['name']}** 【{type_label}】\n"
            f"**賭け金**: `{bet:,} {currency_name}` (本日 {play_count}/{max_plays if max_plays > 0 else '無制限'}回目)\n\n"
            f"**{phase}**\n"
            f"```\n{track_str}\n```\n"
            f"📢 **実況**: *{comm}*"
        ),
        color=discord.Color.blue()
    )
    
    await interaction.followup.send(embed=embed, ephemeral=True)
    
    # 2. 中間ステップ更新
    for frame_idx in range(1, len(race_frames) - 1):
        await asyncio.sleep(1.4)
        phase, comm, pos = race_frames[frame_idx]
        track_str = render_horse_track(pos, HORSE_DATA, track_len)
        embed.description = (
            f"**あなたの選択**: {user_horse['icon']}{user_horse['emoji']} **{user_horse['name']}** 【{type_label}】\n"
            f"**賭け金**: `{bet:,} {currency_name}` (本日 {play_count}/{max_plays if max_plays > 0 else '無制限'}回目)\n\n"
            f"**{phase}**\n"
            f"```\n{track_str}\n```\n"
            f"📢 **実況**: *{comm}*"
        )
        try:
            await interaction.edit_original_response(embed=embed)
        except Exception as e:
            print(f"[WARN] Failed to edit race message frame {frame_idx}: {e}")
            
    # 3. ゴール結果更新
    await asyncio.sleep(1.5)
    phase, comm, goal_pos = race_frames[-1]
    track_str = render_horse_track(goal_pos, HORSE_DATA, track_len)
    
    rank_emojis = ["🥇 1着", "🥈 2着", "🥉 3着", "4着", "5着"]
    rank_text_lines = []
    user_final_rank = 0
    for r_idx, h_num in enumerate(final_ranking):
        h = next(item for item in HORSE_DATA if item["num"] == h_num)
        is_user_mark = " 👈 **あなたの選択馬**" if h_num == user_horse_num else ""
        if h_num == user_horse_num:
            user_final_rank = r_idx + 1
        rank_text_lines.append(f"{rank_emojis[r_idx]}: {h['icon']}{h['emoji']} **{h['name']}**{is_user_mark}")
    ranking_summary = "\n".join(rank_text_lines)
    
    win_amount = 0
    tax_msg = ""
    if is_win:
        win_amount = int(bet * mul)
        if get_setting(bot, "GAMBLE_TAX_ENABLED"):
            tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
            if tax_rate is None: tax_rate = 0.05
            net_profit = win_amount - bet
            tax_amount = int(net_profit * tax_rate)
            win_amount = bet + (net_profit - tax_amount)
            tax_msg = f"\n※ カジノ手数料 ({tax_rate*100:.1f}%) として **{tax_amount:,} {currency_name}** が引かれました。"
        await database.add_balance(interaction.guild.id, interaction.user.id, win_amount)
        
    result_title = "🏆 競馬レース結果: 的中！" if is_win else "💀 競馬レース結果: 不的中"
    result_color = discord.Color.gold() if is_win else discord.Color.red()
    
    if is_win:
        outcome_text = f"🎉 **的中！** あなたの選んだ **{user_horse['name']}** は **{user_final_rank}着** でした！\n💰 **払戻金**: **+{win_amount:,} {currency_name}** (倍率: `{mul}倍`){tax_msg}"
    else:
        outcome_text = f"💀 **不的中...** あなたの選んだ **{user_horse['name']}** は **{user_final_rank}着** でした。\n💸 **損失額**: `-{bet:,} {currency_name}`"
        
    embed_result = discord.Embed(
        title=result_title,
        description=(
            f"**あなたの選択**: {user_horse['icon']}{user_horse['emoji']} **{user_horse['name']}** 【{type_label}】\n"
            f"**賭け金**: `{bet:,} {currency_name}`\n\n"
            f"```\n{track_str}\n```\n"
            f"**【確定着順】**\n{ranking_summary}\n\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"{outcome_text}"
        ),
        color=result_color
    )
    
    try:
        await interaction.edit_original_response(embed=embed_result)
    except Exception as e:
        print(f"[WARN] Failed to edit race final result: {e}")
        
    embed_log = discord.Embed(
        title="🏇 ギャンブルログ: 競馬",
        color=result_color,
        timestamp=discord.utils.utcnow()
    )
    embed_log.add_field(name="プレイヤー", value=f"{interaction.user.mention} (ID: {interaction.user.id})", inline=True)
    embed_log.add_field(name="賭け金", value=f"{bet:,} {currency_name}", inline=True)
    embed_log.add_field(name="馬券種別・選択馬", value=f"{user_horse['icon']}{user_horse['emoji']} {user_horse['name']} ({type_label})", inline=True)
    
    if is_win:
        embed_log.add_field(name="結果", value=f"的中 🏆 ({user_final_rank}着)", inline=True)
        embed_log.add_field(name="獲得額 (配当)", value=f"+{win_amount:,} {currency_name} (倍率: {mul}倍)", inline=True)
    else:
        embed_log.add_field(name="結果", value=f"ハズレ 💀 ({user_final_rank}着)", inline=True)
        embed_log.add_field(name="損失額", value=f"-{bet:,} {currency_name}", inline=True)
        
    top3_names = [f"{rank_emojis[idx]} {next(h['name'] for h in HORSE_DATA if h['num'] == final_ranking[idx])}" for idx in range(3)]
    embed_log.add_field(name="確定TOP3", value="\n".join(top3_names), inline=False)
    await send_log(bot, interaction.guild, "gambling", embed_log)

class HorseRacingView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        
    @discord.ui.button(label="🏇 競馬で遊ぶ", style=discord.ButtonStyle.primary, custom_id="persistent_horse_racing_btn")
    async def play(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN") or 4.5
        mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU") or 1.5
        
        horses_list_str = "\n".join([f"{h['icon']}{h['emoji']} **{h['num']}号馬: {h['name']}**" for h in HORSE_DATA])
        
        embed = discord.Embed(
            title="🏇 競馬（Horse Racing）：馬券選択",
            description=(
                "出走する5頭の馬から賭けたい馬と馬券を選択してください。\n\n"
                "**【出走表】**\n"
                f"{horses_list_str}\n\n"
                "**【馬券の種類と配当】**\n"
                f"- 🥇 **単勝**: 選んだ馬が **1着** になれば的中！ (配当: **`{mul_tan}倍`**)\n"
                f"- 🥉 **複勝**: 選んだ馬が **1〜3着以内** に入れば的中！ (配当: **`{mul_fuku}倍`**)\n\n"
                "下のメニューから選択して賭け金を入力してください。"
            ),
            color=discord.Color.dark_teal()
        )
        await interaction.response.send_message(embed=embed, view=HorseRacingBetTypeView(bot), ephemeral=True)

# --- ギャンブル期待値設定 管理者UI (2段階ドリルダウン) ---
def calculate_gamble_win_rates(game_name: str, expectation: float):
    """
    指定されたゲーム名と期待値から、プレイヤーとBot（あるいはハウス）の勝率を計算して返します。
    返り値: (player_win_rate, bot_win_rate, draw_rate) - パーセンテージ (0-100)
    """
    E = expectation
    if game_name == "coinflip":
        p_win = min(E / 2.0, 1.0) * 100
        p_lose = (1.0 - min(E / 2.0, 1.0)) * 100
        return p_win, p_lose, 0.0
        
    elif game_name == "slot":
        if E <= 1.5:
            p_win = (176.0 / 285.0) * E * 100
        else:
            p_win = 100.0
        return p_win, 100.0 - p_win, 0.0
        
    elif game_name == "chinchiro":
        if E <= 1.0:
            p_win = 44.5 * E
            p_draw = 11.0 + 44.5 * (1.0 - E) * (11.0 / 55.5)
            p_lose = 44.5 + 44.5 * (1.0 - E) * (44.5 / 55.5)
        else:
            E_clamped = min(E, 2.0)
            p_lose = max(0.0, 44.5 * (2.0 - E_clamped))
            p_draw = 11.0 + 44.5 * (E_clamped - 1.0) * (11.0 / 55.5)
            p_win = 44.5 + 44.5 * (E_clamped - 1.0) * (44.5 / 55.5)
        return p_win, p_lose, p_draw
        
    elif game_name == "roulette":
        p_win = min(E / 2.0, 1.0) * 100
        p_lose = (1.0 - min(E / 2.0, 1.0)) * 100
        return p_win, p_lose, 0.0
        
    elif game_name == "blackjack":
        if E <= 0.95:
            p_win = 43.0 * (E / 0.95)
            p_draw = 9.0
            p_lose = 100.0 - p_draw - p_win
        else:
            E_clamped = min(E, 2.0)
            p_lose = max(0.0, 48.0 * ((2.0 - E_clamped) / 1.05))
            p_draw = 9.0
            p_win = 100.0 - p_draw - p_lose
        return p_win, p_lose, p_draw
        
    elif game_name == "horse":
        p_tan = min(E / 4.5, 1.0) * 100
        p_fuku = min(E / 1.5, 1.0) * 100
        return p_tan, 100.0 - p_tan, p_fuku
        
    return 0.0, 0.0, 0.0

def get_win_rate_str(game_name: str, expectation: float):
    p_win, p_lose, p_draw = calculate_gamble_win_rates(game_name, expectation)
    if game_name == "horse":
        return f"単勝当選率: {p_win:.1f}% / 複勝当選率: {p_draw:.1f}%"
    if p_draw > 0:
        return f"プレイヤー勝率: {p_win:.1f}% / Bot勝率: {p_lose:.1f}% / 引き分け: {p_draw:.1f}%"
    else:
        if game_name == "slot":
            return f"当選率: {p_win:.1f}%"
        return f"プレイヤー勝率: {p_win:.1f}% / Bot勝率: {p_lose:.1f}%"

async def save_auto_expectation_rates(bot, interaction, game_key, E):
    """入力された期待値Eを基準にして、各ゲームの勝率設定を自動計算し一括保存します。"""
    if game_key == "chinchiro":
        p_win, p_lose, p_draw = calculate_gamble_win_rates("chinchiro", E)
        p_win_dec = p_win / 100.0
        p_draw_dec = p_draw / 100.0
        p_lose_dec = p_lose / 100.0
        
        k_win = p_win_dec / 0.445 if p_win_dec > 0 else 0
        p_pin = 0.02 * k_win
        p_ara = 0.05 * k_win
        p_shig = 0.08 * k_win
        p_norm = 0.295 * k_win
        
        k_lose = p_lose_dec / 0.555 if p_lose_dec > 0 else 0
        p_hif = 0.11 * k_lose
        p_los = 0.445 * k_lose
        
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_PINZORO", p_pin)
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_ARASHI", p_ara)
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_SHIGORO", p_shig)
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_NORMAL_WIN", p_norm)
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_HIFUMI", p_hif)
        await database.save_setting(interaction.guild.id, "GAMBLE_CHINCHIRO_RATE_LOSE", p_los)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_PINZORO"] = p_pin
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_ARASHI"] = p_ara
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_SHIGORO"] = p_shig
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_NORMAL_WIN"] = p_norm
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_HIFUMI"] = p_hif
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_CHINCHIRO_RATE_LOSE"] = p_los
        
    elif game_key == "coinflip":
        p_win, _, _ = calculate_gamble_win_rates("coinflip", E)
        p_win_dec = p_win / 100.0
        p_lose_dec = max(0.0, 1.0 - p_win_dec)
        
        await database.save_setting(interaction.guild.id, "GAMBLE_COINFLIP_RATE_WIN", p_win_dec)
        await database.save_setting(interaction.guild.id, "GAMBLE_COINFLIP_RATE_LOSE", p_lose_dec)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_COINFLIP_RATE_WIN"] = p_win_dec
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_COINFLIP_RATE_LOSE"] = p_lose_dec
        
    elif game_key == "slot":
        base_expected = 285.0 / 512.0
        k = E / base_expected
        p_7 = (1.0 / 512.0) * k
        p_star = (1.0 / 512.0) * k
        p_triple = (6.0 / 512.0) * k
        p_double = (168.0 / 512.0) * k
        
        await database.save_setting(interaction.guild.id, "GAMBLE_SLOT_RATE_7", p_7)
        await database.save_setting(interaction.guild.id, "GAMBLE_SLOT_RATE_STAR", p_star)
        await database.save_setting(interaction.guild.id, "GAMBLE_SLOT_RATE_THREE", p_triple)
        await database.save_setting(interaction.guild.id, "GAMBLE_SLOT_RATE_TWO", p_double)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_SLOT_RATE_7"] = p_7
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_SLOT_RATE_STAR"] = p_star
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_SLOT_RATE_THREE"] = p_triple
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_SLOT_RATE_TWO"] = p_double
        
    elif game_key == "blackjack":
        p_win, _, p_draw = calculate_gamble_win_rates("blackjack", E)
        p_win_dec = p_win / 100.0
        p_draw_dec = p_draw / 100.0
        
        k_win = p_win_dec / 0.43 if p_win_dec > 0 else 0
        p_norm = 0.38 * k_win
        p_bj = 0.05 * k_win
        p_los = max(0.0, 1.0 - p_win_dec - p_draw_dec)
        
        await database.save_setting(interaction.guild.id, "GAMBLE_BLACKJACK_RATE_NORMAL_WIN", p_norm)
        await database.save_setting(interaction.guild.id, "GAMBLE_BLACKJACK_RATE_BJ_WIN", p_bj)
        await database.save_setting(interaction.guild.id, "GAMBLE_BLACKJACK_RATE_DRAW", p_draw_dec)
        await database.save_setting(interaction.guild.id, "GAMBLE_BLACKJACK_RATE_LOSE", p_los)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_BLACKJACK_RATE_NORMAL_WIN"] = p_norm
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_BLACKJACK_RATE_BJ_WIN"] = p_bj
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_BLACKJACK_RATE_DRAW"] = p_draw_dec
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_BLACKJACK_RATE_LOSE"] = p_los
        
    elif game_key == "roulette":
        r_win_2x = min(E / 2.0, 1.0)
        r_win_3x = min(E / 3.0, 1.0)
        r_win_36x = min(E / 36.0, 1.0)
        
        await database.save_setting(interaction.guild.id, "GAMBLE_ROULETTE_WIN_RATE_2X", r_win_2x)
        await database.save_setting(interaction.guild.id, "GAMBLE_ROULETTE_WIN_RATE_3X", r_win_3x)
        await database.save_setting(interaction.guild.id, "GAMBLE_ROULETTE_WIN_RATE_36X", r_win_36x)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_ROULETTE_WIN_RATE_2X"] = r_win_2x
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_ROULETTE_WIN_RATE_3X"] = r_win_3x
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_ROULETTE_WIN_RATE_36X"] = r_win_36x
        
    elif game_key == "horse":
        mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN") or 4.5
        mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU") or 1.5
        
        p_tan = min(1.0, E / mul_tan)
        p_fuku = min(1.0, E / mul_fuku)
        
        await database.save_setting(interaction.guild.id, "GAMBLE_HORSE_RATE_WIN_TAN", p_tan)
        await database.save_setting(interaction.guild.id, "GAMBLE_HORSE_RATE_WIN_FUKU", p_fuku)
        
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_HORSE_RATE_WIN_TAN"] = p_tan
        bot.bot_settings.setdefault(interaction.guild.id, {})["GAMBLE_HORSE_RATE_WIN_FUKU"] = p_fuku


class GambleSettingsView(discord.ui.View):
    def __init__(self, user, back_to="admin"):
        super().__init__(timeout=300)
        self.user = user
        self.back_to = back_to
        self.add_item(GambleGameSelect())
        self.add_item(GambleSettingsBackButton(back_to=back_to))
   
    async def build_embed(self, bot):
        embed = discord.Embed(
            title="🎰 ギャンブル詳細設定パネル",
            description="各ゲームの倍率や当選確率を個別に設定できます。\n変更するゲームを下のセレクトメニューから選択してください。",
            color=discord.Color.purple()
        )
        
        # チンチロリン
        p_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_PINZORO") or 0.02
        p_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_ARASHI") or 0.05
        p_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_SHIGORO") or 0.08
        p_normal = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_NORMAL_WIN") or 0.295
        p_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_HIFUMI") or 0.11
        p_lose = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_LOSE") or 0.445
        
        mul_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_PINZORO") or 5.0
        mul_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_ARASHI") or 3.0
        mul_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_SHIGORO") or 2.0
        mul_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_HIFUMI") or -2.0
        mul_normal = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_NORMAL") or 1.0
        
        chinchiro_total = p_pinzoro + p_arashi + p_shigoro + p_normal + p_hifumi + p_lose
        chinchiro_str = (
            f"🎯 **当選確率 (合計 {chinchiro_total*100:.1f}%)**:\n"
            f"  ・ピンゾロ: `{p_pinzoro*100:.1f}%` / アラシ: `{p_arashi*100:.1f}%` / シゴロ: `{p_shigoro*100:.1f}%` / 通常出目: `{p_normal*100:.1f}%`\n"
            f"  ・ヒフミ没収: `{p_hifumi*100:.1f}%` / 敗北: `{p_lose*100:.1f}%`\n"
            f"💰 **配当倍率**: ピンゾロ: `{mul_pinzoro}倍` / アラシ: `{mul_arashi}倍` / シゴロ: `{mul_shigoro}倍` / 通常出目: `{mul_normal}倍` / ヒフミ没収: `{mul_hifumi}倍`"
        )
        embed.add_field(name="🎲 チンチロリン設定", value=chinchiro_str, inline=False)

        # コイントス
        coin_win = get_setting(bot, "GAMBLE_COINFLIP_RATE_WIN") or 0.475
        coin_lose = get_setting(bot, "GAMBLE_COINFLIP_RATE_LOSE") or 0.525
        coin_mul = get_setting(bot, "GAMBLE_COINFLIP_MUL") or 2.0
        coin_total = coin_win + coin_lose
        coinflip_str = (
            f"🎯 **当選確率 (合計 {coin_total*100:.1f}%)**: 勝利: `{coin_win*100:.1f}%` / 敗北: `{coin_lose*100:.1f}%`\n"
            f"💰 **配当倍率**: `{coin_mul}倍`"
        )
        embed.add_field(name="🪙 コイントス設定", value=coinflip_str, inline=False)

        # スロット
        p_7 = get_setting(bot, "GAMBLE_SLOT_RATE_7") or 0.002
        p_star = get_setting(bot, "GAMBLE_SLOT_RATE_STAR") or 0.002
        p_three = get_setting(bot, "GAMBLE_SLOT_RATE_THREE") or 0.012
        p_two = get_setting(bot, "GAMBLE_SLOT_RATE_TWO") or 0.328
        p_lose = max(0.0, 1.0 - (p_7 + p_star + p_three + p_two))
        mul_7 = get_setting(bot, "GAMBLE_SLOT_MUL_7") or 10.0
        mul_star = get_setting(bot, "GAMBLE_SLOT_MUL_STAR") or 5.0
        mul_three = get_setting(bot, "GAMBLE_SLOT_MUL_THREE") or 3.0
        mul_two = get_setting(bot, "GAMBLE_SLOT_MUL_TWO") or 1.5
        slot_str = (
            f"🎯 **当選確率**: 7揃い: `{p_7*100:.2f}%` / ⭐揃い: `{p_star*100:.2f}%` / 3つ揃い: `{p_three*100:.2f}%` / 2つ揃い: `{p_two*100:.1f}%` (ハズレ: `{p_lose*100:.1f}%`)\n"
            f"💰 **配当倍率**: 7揃い: `{mul_7}倍` / ⭐揃い: `{mul_star}倍` / 3つ揃い: `{mul_three}倍` / 2つ揃い: `{mul_two}倍`"
        )
        embed.add_field(name="🎰 スロット設定", value=slot_str, inline=False)

        # ブラックジャック
        bj_norm = get_setting(bot, "GAMBLE_BLACKJACK_RATE_NORMAL_WIN") or 0.38
        bj_bj = get_setting(bot, "GAMBLE_BLACKJACK_RATE_BJ_WIN") or 0.05
        bj_draw = get_setting(bot, "GAMBLE_BLACKJACK_RATE_DRAW") or 0.09
        bj_lose = get_setting(bot, "GAMBLE_BLACKJACK_RATE_LOSE") or 0.48
        
        mul_bj_normal = get_setting(bot, "GAMBLE_BLACKJACK_MUL_NORMAL") or 2.0
        mul_bj_bj = get_setting(bot, "GAMBLE_BLACKJACK_MUL_BJ") or 2.5
        
        bj_total = bj_norm + bj_bj + bj_draw + bj_lose
        bj_str = (
            f"🎯 **当選確率 (合計 {bj_total*100:.1f}%)**:\n"
            f"  ・通常勝利: `{bj_norm*100:.1f}%` / BJ勝利: `{bj_bj*100:.1f}%`\n"
            f"  ・引き分け: `{bj_draw*100:.1f}%` / 敗北: `{bj_lose*100:.1f}%`\n"
            f"💰 **配当倍率**: 通常勝利: `{mul_bj_normal}倍` / BJ勝利: `{mul_bj_bj}倍`"
        )
        embed.add_field(name="🃏 ブラックジャック設定", value=bj_str, inline=False)

        # ルーレット
        r_win_2x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_2X") or 0.475
        r_win_3x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_3X") or 0.316
        r_win_36x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_36X") or 0.0264
        r_mul_2x = get_setting(bot, "GAMBLE_ROULETTE_MUL_2X") or 2.0
        r_mul_3x = get_setting(bot, "GAMBLE_ROULETTE_MUL_3X") or 3.0
        r_mul_36x = get_setting(bot, "GAMBLE_ROULETTE_MUL_36X") or 36.0
        roulette_str = (
            f"🎯 **当選確率**: 2倍賭け: `{r_win_2x*100:.1f}%` / 3倍賭け: `{r_win_3x*100:.1f}%` / 1点賭け: `{r_win_36x*100:.2f}%`\n"
            f"💰 **配当倍率**: 2倍賭け: `{r_mul_2x}倍` / 3倍賭け: `{r_mul_3x}倍` / 1点賭け: `{r_mul_36x}倍`"
        )
        embed.add_field(name="🎡 ルーレット設定", value=roulette_str, inline=False)

        # 競馬
        p_tan = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_TAN") or 0.20
        p_fuku = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_FUKU") or 0.60
        mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN") or 4.5
        mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU") or 1.5
        horse_str = (
            f"🎯 **当選確率**: 単勝: `{p_tan*100:.1f}%` / 複勝: `{p_fuku*100:.1f}%`\n"
            f"💰 **配当倍率**: 単勝: `{mul_tan}倍` / 複勝: `{mul_fuku}倍`"
        )
        embed.add_field(name="🏇 競馬設定", value=horse_str, inline=False)

        # 共通制限など
        limit_str = ""
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
        if max_plays is None: max_plays = 10
        limit_str += f"📅 **1日のプレイ回数上限**: `{max_plays}回`" + (" (無制限)" if int(max_plays) <= 0 else "") + "\n"
        daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
        if daily_limit is None: daily_limit = 0
        limit_str += f"💰 **1日の合計賭け金上限**: `{int(daily_limit):,} {currency_name}`" + (" (無制限)" if int(daily_limit) <= 0 else "") + "\n"
        max_bet = get_setting(bot, "GAMBLE_MAX_BET")
        if max_bet is None: max_bet = 100000
        limit_str += f"💵 **1回の最大賭け金制限**: `{int(max_bet):,} {currency_name}`\n"
        tax_enabled = get_setting(bot, "GAMBLE_TAX_ENABLED")
        if tax_enabled is None: tax_enabled = False
        limit_str += f"💸 **カジノ手数料徴収**: `{'有効' if tax_enabled else '無効'}`\n"
        tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
        if tax_rate is None: tax_rate = 0.05
        limit_str += f"📊 **手数料の割合**: `{tax_rate * 100:.1f}%`\n"
        embed.add_field(name="⚙️ 制限・共通設定", value=limit_str.strip(), inline=False)
        
        return embed


class GambleGameSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="🎲 チンチロリン設定", emoji="🎲", value="chinchiro"),
            discord.SelectOption(label="🪙 コイントス設定", emoji="🪙", value="coinflip"),
            discord.SelectOption(label="🎰 スロット設定", emoji="🎰", value="slot"),
            discord.SelectOption(label="🃏 ブラックジャック設定", emoji="🃏", value="blackjack"),
            discord.SelectOption(label="🎡 ルーレット設定", emoji="🎡", value="roulette"),
            discord.SelectOption(label="🏇 競馬設定", emoji="🏇", value="horse"),
            discord.SelectOption(label="⚙️ 制限値・手数料(共通)設定", emoji="⚙️", value="common")
        ]
        super().__init__(placeholder="編集するゲーム/項目を選択...", options=options, custom_id="admin_gamble_game_select_main")
   
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        
        game_key = self.values[0]
        bot = interaction.client
        
        sub_view = GambleGameSettingsView(view.user, game_key, bot, back_to=getattr(view, "back_to", "admin"))
        embed = await sub_view.build_embed()
        await interaction.response.edit_message(embed=embed, view=sub_view)

class GamblePanelSetupButton(discord.ui.Button):
    def __init__(self, game_key):
        self.game_key = game_key
        super().__init__(label="🪧 このパネルを設置", style=discord.ButtonStyle.primary, row=3)
        
    async def callback(self, interaction: discord.Interaction):
        if interaction.user != self.view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
            
        channel = interaction.channel
        val = self.game_key
        
        if val == "chinchiro":
            embed = discord.Embed(
                title="🎲 チンチロリン",
                description=(
                    "こちらのボタンからチンチロリンをプレイできます。\n\n"
                    "**【配当倍率】**\n"
                    "- **ピンゾロ**: `5.0倍`\n"
                    "- **アラシ**: `3.0倍`\n"
                    "- **シゴロ**: `2.0倍`\n"
                    "- **通常出目**: `1.0倍`\n"
                    "- **ヒフミ**: `支払い2.0倍` (没収)\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.dark_green()
            )
            await channel.send(embed=embed, view=ChinchiroView())
            await interaction.response.send_message("✅ チンチロリンパネルを設置しました。", ephemeral=True)
        elif val == "coinflip":
            embed = discord.Embed(
                title="🪙 コイントス",
                description=(
                    "こちらのボタンからコイントスをプレイできます。\n表か裏かを当ててください。\n\n"
                    "**【配当倍率】**\n"
                    "- **的中**: `2.0倍`\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.blue()
            )
            await channel.send(embed=embed, view=CoinflipView())
            await interaction.response.send_message("✅ コイントスパネルを設置しました。", ephemeral=True)
        elif val == "slot":
            embed = discord.Embed(
                title="🎰 スロット",
                description=(
                    "こちらのボタンからスロットをプレイできます。\n\n"
                    "**【配当倍率】**\n"
                    "- **7️⃣7️⃣7️⃣**: `10.0倍`\n"
                    "- **⭐⭐⭐**: `5.0倍`\n"
                    "- **その他絵柄3つ揃い**: `3.0倍`\n"
                    "- **絵柄2つ揃い**: `1.5倍`\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.gold()
            )
            await channel.send(embed=embed, view=SlotView())
            await interaction.response.send_message("✅ スロットパネルを設置しました。", ephemeral=True)
        elif val == "blackjack":
            embed = discord.Embed(
                title="🃏 ブラックジャック",
                description=(
                    "こちらのボタンからブラックジャックをプレイできます。\nディーラーと勝負して21に近づけてください。\n\n"
                    "**【配当倍率】**\n"
                    "- **通常勝利**: `2.0倍`\n"
                    "- **ブラックジャック勝利**: `2.5倍`\n"
                    "- **引き分け**: `1.0倍` (ベット額払い戻し)\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.blue()
            )
            await channel.send(embed=embed, view=BlackjackView())
            await interaction.response.send_message("✅ ブラックジャックパネルを設置しました。", ephemeral=True)
        elif val == "roulette":
            embed = discord.Embed(
                title="🎡 ルーレット",
                description=(
                    "こちらのボタンからルーレットをプレイできます。\n玉がどの数字や色に落ちるかを予想します。\n\n"
                    "**【配当倍率】**\n"
                    "- **赤 / 黒 / 偶数 / 奇数 / ロー / ハイ**: `2.0倍`\n"
                    "- **ダズン (1-12 / 13-24 / 25-36)**: `3.0倍`\n"
                    "- **数字1点賭け (0-36)**: `36.0倍`\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.red()
            )
            await channel.send(embed=embed, view=RouletteView())
            await interaction.response.send_message("✅ ルーレットパネルを設置しました。", ephemeral=True)
        elif val == "horse":
            horses_str = "\n".join([f"- {h['icon']}{h['emoji']} **{h['num']}号馬: {h['name']}**" for h in HORSE_DATA])
            embed = discord.Embed(
                title="🏇 競馬（Horse Racing）",
                description=(
                    "こちらのボタンから競馬をプレイできます。\n"
                    "出走する5頭の馬から賭けたい馬と馬券を選択してください。\n\n"
                    "**【出走馬】**\n"
                    f"{horses_str}\n\n"
                    "**【配当倍率】**\n"
                    "- 🥇 **単勝 (1着的中)**: `4.5倍`\n"
                    "- 🥉 **複勝 (1〜3着以内的中)**: `1.5倍`\n\n"
                    "※ カジノ手数料設定が有効な場合、勝利配当から手数料が引かれます。\n"
                    "※ 実際の倍率は設定によって異なる場合があります。"
                ),
                color=discord.Color.dark_teal()
            )
            await channel.send(embed=embed, view=HorseRacingView())
            await interaction.response.send_message("✅ 競馬パネルを設置しました。", ephemeral=True)


class GambleGameSettingsView(discord.ui.View):
    def __init__(self, user, game_key, bot, back_to="admin"):
        super().__init__(timeout=300)
        self.user = user
        self.game_key = game_key
        self.bot = bot
        self.back_to = back_to
        
        self.setup_items()
        
    def setup_items(self):
        self.add_item(GambleSubSettingsBackButton())
        
        if self.game_key == "common":
            self.add_item(GambleCommonSelect())
        else:
            # 期待値一括設定ボタン
            self.add_item(GambleExpectationButton())
            # 確率個別設定セレクト
            self.add_item(GambleRateSelect(self.game_key))
            # 倍率個別設定セレクト
            self.add_item(GambleMultiplierSelect(self.game_key))
            # このゲームのパネルを設置するボタン
            self.add_item(GamblePanelSetupButton(self.game_key))
            
    async def build_embed(self):
        bot = self.bot
        game_names = {
            "chinchiro": "🎲 チンチロリン",
            "coinflip": "🪙 コイントス",
            "slot": "🎰 スロット",
            "blackjack": "🃏 ブラックジャック",
            "roulette": "🎡 ルーレット",
            "horse": "🏇 競馬",
            "common": "⚙️ 制限値・手数料"
        }
        embed = discord.Embed(
            title=f"{game_names.get(self.game_key, '設定')} 詳細設定",
            description="期待値から自動計算して一括設定するか、確率や倍率を個別に設定してください。",
            color=discord.Color.purple()
        )
        
        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        
        if self.game_key == "chinchiro":
            p_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_PINZORO") or 0.02
            p_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_ARASHI") or 0.05
            p_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_SHIGORO") or 0.08
            p_normal = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_NORMAL_WIN") or 0.295
            p_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_HIFUMI") or 0.11
            p_lose = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_LOSE") or 0.445
            
            mul_pinzoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_PINZORO") or 5.0
            mul_arashi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_ARASHI") or 3.0
            mul_shigoro = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_SHIGORO") or 2.0
            mul_hifumi = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_HIFUMI") or -2.0
            mul_normal = get_setting(bot, "GAMBLE_CHINCHIRO_MUL_NORMAL") or 1.0
            
            chinchiro_total = p_pinzoro + p_arashi + p_shigoro + p_normal + p_hifumi + p_lose
            
            embed.add_field(name="🎯 ピンゾロ当選率", value=f"`{p_pinzoro*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 アラシ当選率", value=f"`{p_arashi*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 シゴロ当選率", value=f"`{p_shigoro*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 通常出目当選率", value=f"`{p_normal*100:.1f}%`", inline=True)
            embed.add_field(name="💀 ヒフミ没収率", value=f"`{p_hifumi*100:.1f}%`", inline=True)
            embed.add_field(name="💀 敗北確率", value=f"`{p_lose*100:.1f}%`", inline=True)
            embed.add_field(name="📊 確率合計", value=f"`{chinchiro_total*100:.1f}%`", inline=True)
            
            embed.add_field(name="💰 ピンゾロ配当", value=f"`{mul_pinzoro}倍`", inline=True)
            embed.add_field(name="💰 アラシ配当", value=f"`{mul_arashi}倍`", inline=True)
            embed.add_field(name="💰 シゴロ配当", value=f"`{mul_shigoro}倍`", inline=True)
            embed.add_field(name="💰 通常出目配当", value=f"`{mul_normal}倍`", inline=True)
            embed.add_field(name="💀 ヒフミ没収倍率", value=f"`{mul_hifumi}倍`", inline=True)
            
        elif self.game_key == "coinflip":
            coin_win = get_setting(bot, "GAMBLE_COINFLIP_RATE_WIN") or 0.475
            coin_lose = get_setting(bot, "GAMBLE_COINFLIP_RATE_LOSE") or 0.525
            coin_mul = get_setting(bot, "GAMBLE_COINFLIP_MUL") or 2.0
            coin_total = coin_win + coin_lose
            
            embed.add_field(name="🎯 勝利確率 (的中)", value=f"`{coin_win*100:.1f}%`", inline=True)
            embed.add_field(name="💀 敗北確率", value=f"`{coin_lose*100:.1f}%`", inline=True)
            embed.add_field(name="📊 確率合計", value=f"`{coin_total*100:.1f}%`", inline=True)
            embed.add_field(name="💰 配当倍率", value=f"`{coin_mul}倍`", inline=True)
            
        elif self.game_key == "slot":
            p_7 = get_setting(bot, "GAMBLE_SLOT_RATE_7") or 0.002
            p_star = get_setting(bot, "GAMBLE_SLOT_RATE_STAR") or 0.002
            p_three = get_setting(bot, "GAMBLE_SLOT_RATE_THREE") or 0.012
            p_two = get_setting(bot, "GAMBLE_SLOT_RATE_TWO") or 0.328
            p_lose = max(0.0, 1.0 - (p_7 + p_star + p_three + p_two))
            
            mul_7 = get_setting(bot, "GAMBLE_SLOT_MUL_7") or 10.0
            mul_star = get_setting(bot, "GAMBLE_SLOT_MUL_STAR") or 5.0
            mul_three = get_setting(bot, "GAMBLE_SLOT_MUL_THREE") or 3.0
            mul_two = get_setting(bot, "GAMBLE_SLOT_MUL_TWO") or 1.5
            
            embed.add_field(name="🎯 7️⃣7️⃣7️⃣ 当選率", value=f"`{p_7*100:.2f}%`", inline=True)
            embed.add_field(name="🎯 ⭐⭐⭐ 当選率", value=f"`{p_star*100:.2f}%`", inline=True)
            embed.add_field(name="🎯 他絵柄3つ当選率", value=f"`{p_three*100:.2f}%`", inline=True)
            embed.add_field(name="🎯 絵柄2つ当選率", value=f"`{p_two*100:.1f}%`", inline=True)
            embed.add_field(name="💀 ハズレ確率", value=f"`{p_lose*100:.1f}%`", inline=True)
            
            embed.add_field(name="💰 7️⃣7️⃣7️⃣ 配当倍率", value=f"`{mul_7}倍`", inline=True)
            embed.add_field(name="💰 ⭐⭐⭐ 配当倍率", value=f"`{mul_star}倍`", inline=True)
            embed.add_field(name="💰 3つ揃い配当倍率", value=f"`{mul_three}倍`", inline=True)
            embed.add_field(name="💰 2つ揃い配当倍率", value=f"`{mul_two}倍`", inline=True)
            
        elif self.game_key == "blackjack":
            bj_norm = get_setting(bot, "GAMBLE_BLACKJACK_RATE_NORMAL_WIN") or 0.38
            bj_bj = get_setting(bot, "GAMBLE_BLACKJACK_RATE_BJ_WIN") or 0.05
            bj_draw = get_setting(bot, "GAMBLE_BLACKJACK_RATE_DRAW") or 0.09
            bj_lose = get_setting(bot, "GAMBLE_BLACKJACK_RATE_LOSE") or 0.48
            
            mul_bj_normal = get_setting(bot, "GAMBLE_BLACKJACK_MUL_NORMAL") or 2.0
            mul_bj_bj = get_setting(bot, "GAMBLE_BLACKJACK_MUL_BJ") or 2.5
            bj_total = bj_norm + bj_bj + bj_draw + bj_lose
            
            embed.add_field(name="🎯 通常勝利確率", value=f"`{bj_norm*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 BJ勝利確率", value=f"`{bj_bj*100:.1f}%`", inline=True)
            embed.add_field(name="🤝 引き分け確率", value=f"`{bj_draw*100:.1f}%`", inline=True)
            embed.add_field(name="💀 敗北確率", value=f"`{bj_lose*100:.1f}%`", inline=True)
            embed.add_field(name="📊 確率合計", value=f"`{bj_total*100:.1f}%`", inline=True)
            embed.add_field(name="💰 通常勝利倍率", value=f"`{mul_bj_normal}倍`", inline=True)
            embed.add_field(name="💰 BJ勝利倍率", value=f"`{mul_bj_bj}倍`", inline=True)
            
        elif self.game_key == "roulette":
            r_win_2x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_2X") or 0.475
            r_win_3x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_3X") or 0.316
            r_win_36x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_36X") or 0.0264
            r_mul_2x = get_setting(bot, "GAMBLE_ROULETTE_MUL_2X") or 2.0
            r_mul_3x = get_setting(bot, "GAMBLE_ROULETTE_MUL_3X") or 3.0
            r_mul_36x = get_setting(bot, "GAMBLE_ROULETTE_MUL_36X") or 36.0
            
            embed.add_field(name="🎯 2倍賭当選率 (赤黒等)", value=f"`{r_win_2x*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 3倍賭当選率 (ダズン)", value=f"`{r_win_3x*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 1点賭当選率 (数字)", value=f"`{r_win_36x*100:.2f}%`", inline=True)
            embed.add_field(name="💰 2倍賭配当倍率", value=f"`{r_mul_2x}倍`", inline=True)
            embed.add_field(name="💰 3倍賭配当倍率", value=f"`{r_mul_3x}倍`", inline=True)
            embed.add_field(name="💰 1点賭配当倍率", value=f"`{r_mul_36x}倍`", inline=True)

        elif self.game_key == "horse":
            p_tan = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_TAN") or 0.20
            p_fuku = get_setting(bot, "GAMBLE_HORSE_RATE_WIN_FUKU") or 0.60
            mul_tan = get_setting(bot, "GAMBLE_HORSE_MUL_TAN") or 4.5
            mul_fuku = get_setting(bot, "GAMBLE_HORSE_MUL_FUKU") or 1.5
            
            embed.add_field(name="🎯 単勝当選率 (1着)", value=f"`{p_tan*100:.1f}%`", inline=True)
            embed.add_field(name="🎯 複勝当選率 (1〜3着)", value=f"`{p_fuku*100:.1f}%`", inline=True)
            embed.add_field(name="💰 単勝配当倍率", value=f"`{mul_tan}倍`", inline=True)
            embed.add_field(name="💰 複勝配当倍率", value=f"`{mul_fuku}倍`", inline=True)
            
        elif self.game_key == "common":
            max_plays = get_setting(bot, "GAMBLE_MAX_PLAYS")
            if max_plays is None: max_plays = 10
            daily_limit = get_setting(bot, "GAMBLE_DAILY_LIMIT")
            if daily_limit is None: daily_limit = 0
            max_bet = get_setting(bot, "GAMBLE_MAX_BET")
            if max_bet is None: max_bet = 100000
            tax_enabled = get_setting(bot, "GAMBLE_TAX_ENABLED")
            if tax_enabled is None: tax_enabled = False
            tax_rate = get_setting(bot, "GAMBLE_TAX_RATE")
            if tax_rate is None: tax_rate = 0.05
            
            embed.add_field(name="📅 1日のプレイ回数上限", value=f"`{max_plays}回`" + (" (無制限)" if int(max_plays) <= 0 else ""), inline=False)
            embed.add_field(name="💰 1日の合計賭け金上限", value=f"`{int(daily_limit):,} {currency_name}`" + (" (無制限)" if int(daily_limit) <= 0 else ""), inline=False)
            embed.add_field(name="💵 1回の最大賭け金上限", value=f"`{int(max_bet):,} {currency_name}`", inline=False)
            embed.add_field(name="💸 カジノ手数料徴収", value="🟢 有効" if tax_enabled else "🔴 無効", inline=False)
            embed.add_field(name="📊 手数料の割合", value=f"`{tax_rate * 100:.1f}%`", inline=False)
            
        return embed


class GambleExpectationButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="📈 期待値から一括自動設定", style=discord.ButtonStyle.success, emoji="📈", row=0)
        
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        await interaction.response.send_modal(GambleAutoExpectationModal(view.game_key, view.back_to))


class GambleRateSelect(discord.ui.Select):
    def __init__(self, game_key):
        options = []
        if game_key == "chinchiro":
            options = [
                discord.SelectOption(label="🎲 ピンゾロ当選率", value="GAMBLE_CHINCHIRO_RATE_PINZORO", description="ピンゾロ(配当5倍)が出る確率"),
                discord.SelectOption(label="🎲 アラシ当選率", value="GAMBLE_CHINCHIRO_RATE_ARASHI", description="アラシ(配当3倍)が出る確率"),
                discord.SelectOption(label="🎲 シゴロ当選率", value="GAMBLE_CHINCHIRO_RATE_SHIGORO", description="シゴロ(配当2倍)が出る確率"),
                discord.SelectOption(label="🎲 通常出目勝利確率", value="GAMBLE_CHINCHIRO_RATE_NORMAL_WIN", description="通常出目で勝利する確率"),
                discord.SelectOption(label="💀 ヒフミ没収確率", value="GAMBLE_CHINCHIRO_RATE_HIFUMI", description="ヒフミ(2倍支払い)が出る確率"),
                discord.SelectOption(label="💀 敗北確率", value="GAMBLE_CHINCHIRO_RATE_LOSE", description="その他の出目で敗北する確率")
            ]
        elif game_key == "coinflip":
            options = [
                discord.SelectOption(label="🪙 勝利（的中）確率", value="GAMBLE_COINFLIP_RATE_WIN", description="コイントスで的中する確率"),
                discord.SelectOption(label="💀 敗北確率", value="GAMBLE_COINFLIP_RATE_LOSE", description="コイントスではずれる確率")
            ]
        elif game_key == "slot":
            options = [
                discord.SelectOption(label="7️⃣ 7揃い確率", value="GAMBLE_SLOT_RATE_7", description="スリーセブンの当選率"),
                discord.SelectOption(label="⭐ 星揃い確率", value="GAMBLE_SLOT_RATE_STAR", description="スター揃いの当選率"),
                discord.SelectOption(label="🍒 その他3つ揃い確率", value="GAMBLE_SLOT_RATE_THREE", description="7・星以外の3揃い当選率"),
                discord.SelectOption(label="🍋 2つ揃い確率", value="GAMBLE_SLOT_RATE_TWO", description="同じ絵柄が2つ揃う当選率")
            ]
        elif game_key == "blackjack":
            options = [
                discord.SelectOption(label="🃏 通常勝利確率", value="GAMBLE_BLACKJACK_RATE_NORMAL_WIN", description="BJで通常勝利する確率"),
                discord.SelectOption(label="🃏 BJ勝利確率", value="GAMBLE_BLACKJACK_RATE_BJ_WIN", description="21で勝利する確率"),
                discord.SelectOption(label="🤝 引き分け確率", value="GAMBLE_BLACKJACK_RATE_DRAW", description="引き分け（プッシュ）になる確率"),
                discord.SelectOption(label="💀 敗北確率", value="GAMBLE_BLACKJACK_RATE_LOSE", description="敗北する確率")
            ]
        elif game_key == "roulette":
            options = [
                discord.SelectOption(label="🔴 2倍賭け当選率 (赤黒など)", value="GAMBLE_ROULETTE_WIN_RATE_2X", description="赤黒・偶奇・ローハイ等の当選率"),
                discord.SelectOption(label="1️⃣ 3倍賭け当選率 (ダズン)", value="GAMBLE_ROULETTE_WIN_RATE_3X", description="12点賭け（ダズン）の当選率"),
                discord.SelectOption(label="🎯 1点賭け当選率 (数字)", value="GAMBLE_ROULETTE_WIN_RATE_36X", description="数字1点賭けの当選率")
            ]
        elif game_key == "horse":
            options = [
                discord.SelectOption(label="🥇 単勝当選率 (1着)", value="GAMBLE_HORSE_RATE_WIN_TAN", description="選んだ馬が1着になる確率"),
                discord.SelectOption(label="🥉 複勝当選率 (1〜3着)", value="GAMBLE_HORSE_RATE_WIN_FUKU", description="選んだ馬が3着以内に入る確率")
            ]
            
        super().__init__(placeholder="🎯 各当選確率(%)を個別に設定...", options=options, custom_id="admin_gamble_rate_select", row=1)
        
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        key = self.values[0]
        await interaction.response.send_modal(GambleDetailSettingsModal(key, view.game_key, view.back_to))


class GambleMultiplierSelect(discord.ui.Select):
    def __init__(self, game_key):
        options = []
        if game_key == "chinchiro":
            options = [
                discord.SelectOption(label="ピンゾロ配当倍率 (5.0倍)", value="GAMBLE_CHINCHIRO_MUL_PINZORO"),
                discord.SelectOption(label="アラシ配当倍率 (3.0倍)", value="GAMBLE_CHINCHIRO_MUL_ARASHI"),
                discord.SelectOption(label="シゴロ配当倍率 (2.0倍)", value="GAMBLE_CHINCHIRO_MUL_SHIGORO"),
                discord.SelectOption(label="通常出目配当倍率 (1.0倍)", value="GAMBLE_CHINCHIRO_MUL_NORMAL"),
                discord.SelectOption(label="ヒフミ没収倍率 (-2.0倍)", value="GAMBLE_CHINCHIRO_MUL_HIFUMI", description="負けた時にベットの何倍を没収されるか(通常は-2倍)")
            ]
        elif game_key == "coinflip":
            options = [
                discord.SelectOption(label="的中配当倍率 (2.0倍)", value="GAMBLE_COINFLIP_MUL")
            ]
        elif game_key == "slot":
            options = [
                discord.SelectOption(label="777当選配当倍率 (10.0倍)", value="GAMBLE_SLOT_MUL_7"),
                discord.SelectOption(label="星当選配当倍率 (5.0倍)", value="GAMBLE_SLOT_MUL_STAR"),
                discord.SelectOption(label="3つ揃い配当倍率 (3.0倍)", value="GAMBLE_SLOT_MUL_THREE"),
                discord.SelectOption(label="2つ揃い配当倍率 (1.5倍)", value="GAMBLE_SLOT_MUL_TWO")
            ]
        elif game_key == "blackjack":
            options = [
                discord.SelectOption(label="通常勝利配当倍率 (2.0倍)", value="GAMBLE_BLACKJACK_MUL_NORMAL"),
                discord.SelectOption(label="BJ勝利配当倍率 (2.5倍)", value="GAMBLE_BLACKJACK_MUL_BJ")
            ]
        elif game_key == "roulette":
            options = [
                discord.SelectOption(label="2倍賭け配当倍率 (2.0倍)", value="GAMBLE_ROULETTE_MUL_2X"),
                discord.SelectOption(label="3倍賭け配当倍率 (3.0倍)", value="GAMBLE_ROULETTE_MUL_3X"),
                discord.SelectOption(label="36倍賭け配当倍率 (36.0倍)", value="GAMBLE_ROULETTE_MUL_36X")
            ]
        elif game_key == "horse":
            options = [
                discord.SelectOption(label="🥇 単勝配当倍率 (4.5倍)", value="GAMBLE_HORSE_MUL_TAN"),
                discord.SelectOption(label="🥉 複勝配当倍率 (1.5倍)", value="GAMBLE_HORSE_MUL_FUKU")
            ]
            
        super().__init__(placeholder="💰 各配当倍率を個別に設定...", options=options, custom_id="admin_gamble_mul_select", row=2)
        
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        key = self.values[0]
        await interaction.response.send_modal(GambleDetailSettingsModal(key, view.game_key, view.back_to))


class GambleCommonSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="📅 1日のプレイ回数上限", value="GAMBLE_MAX_PLAYS"),
            discord.SelectOption(label="💰 1日の合計賭け金上限", value="GAMBLE_DAILY_LIMIT"),
            discord.SelectOption(label="💵 1回の最大賭け金上限", value="GAMBLE_MAX_BET"),
            discord.SelectOption(label="💸 カジノ手数料の有効化/無効化", value="GAMBLE_TAX_ENABLED"),
            discord.SelectOption(label="📊 カジノ手数料の割合設定", value="GAMBLE_TAX_RATE")
        ]
        super().__init__(placeholder="⚙️ 制限値・手数料項目を選択...", options=options, custom_id="admin_gamble_common_select", row=0)
        
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        key = self.values[0]
        await interaction.response.send_modal(GambleDetailSettingsModal(key, view.game_key, view.back_to))


class GambleAutoExpectationModal(discord.ui.Modal):
    def __init__(self, game_key, back_to="admin"):
        game_names = {
            "chinchiro": "チンチロリン",
            "coinflip": "コイントス",
            "slot": "スロット",
            "blackjack": "ブラックジャック",
            "roulette": "ルーレット",
            "horse": "競馬"
        }
        title = f"{game_names.get(game_key, 'ゲーム')} 期待値自動計算設定"
        super().__init__(title=title)
        self.game_key = game_key
        self.back_to = back_to
        
        self.exp_input = discord.ui.TextInput(
            label="設定する期待値 (0.0 〜 2.0 または 0% 〜 200%)",
            placeholder="例: 0.95 または 95%",
            max_length=15,
            required=True
        )
        self.add_item(self.exp_input)
        
    async def on_submit(self, interaction: discord.Interaction):
        try:
            val_str = self.exp_input.value.strip()
            bot = interaction.client
            
            if "%" in val_str:
                val = float(val_str.replace("%", "")) / 100.0
            else:
                val = float(val_str)
                if val > 2.0:
                    val = val / 100.0
               
            if val < 0.0 or val > 2.0:
                return await interaction.response.send_message("期待値は 0.0 〜 2.0 (0% 〜 200%) の範囲で入力してください。", ephemeral=True)
            
            await save_auto_expectation_rates(bot, interaction, self.game_key, val)
            
            embed = discord.Embed(
                title="✅ 期待値自動設定完了",
                description=f"**{self.game_key.upper()}** の当選確率を期待値 **`{val}`** (還元率 {val*100:.1f}%) を基準にして自動計算し、更新しました！",
                color=discord.Color.green()
            )
            
            back_view = GambleGameSettingsView(interaction.user, self.game_key, bot, back_to=self.back_to)
            await interaction.response.send_message(embed=embed, view=back_view, ephemeral=True)
        except ValueError:
            await interaction.response.send_message("数値（例: 0.95 や 95%）を入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] GambleAutoExpectationModal: {e}")
            await interaction.response.send_message("設定中にエラーが発生しました。", ephemeral=True)


class GambleDetailSettingsModal(discord.ui.Modal):
    def __init__(self, key, game_key, back_to="admin"):
        title_map = {
            "GAMBLE_MAX_PLAYS": "プレイ回数上限設定",
            "GAMBLE_DAILY_LIMIT": "1日合計賭け上限設定",
            "GAMBLE_MAX_BET": "1回最大賭け上限設定",
            "GAMBLE_TAX_ENABLED": "カジノ手数料 有効/無効",
            "GAMBLE_TAX_RATE": "カジノ手数料 割合設定"
        }
        title = title_map.get(key, "個別項目設定")
        super().__init__(title=title)
        self.key = key
        self.game_key = game_key
        self.back_to = back_to
        
        # 入力項目のラベルとプレースホルダー調整
        if "WIN_RATE" in key or "RATE" in key or "DRAW_RATE" in key:
            label = "当選確率 (0.0 〜 1.0 または 0% 〜 100%)"
            placeholder = "例: 0.45 または 45%"
        elif "MUL" in key:
            label = "配当倍率 (通常は正の実数、ヒフミは負の数も可)"
            placeholder = "例: 2.5 または -2"
        elif key == "GAMBLE_MAX_PLAYS":
            label = "1日のプレイ回数上限 (0で無制限)"
            placeholder = "例: 10"
        elif key == "GAMBLE_DAILY_LIMIT":
            label = "1日の合計賭け金上限 (0で無制限)"
            placeholder = "例: 100000"
        elif key == "GAMBLE_MAX_BET":
            label = "1回の最大賭け金上限"
            placeholder = "例: 100000"
        elif key == "GAMBLE_TAX_ENABLED":
            label = "手数料の有効化 (1: 有効, 0: 無効)"
            placeholder = "例: 1"
        elif key == "GAMBLE_TAX_RATE":
            label = "手数料の割合 (0.0 〜 1.0 または 0% 〜 100%)"
            placeholder = "例: 0.05 または 5%"
        else:
            label = "設定値"
            placeholder = "値を入力..."
            
        self.val_input = discord.ui.TextInput(
            label=label,
            placeholder=placeholder,
            max_length=15,
            required=True
        )
        self.add_item(self.val_input)
        
    async def on_submit(self, interaction: discord.Interaction):
        try:
            val_str = self.val_input.value.strip()
            bot = interaction.client
            
            # 型ごとの値のパース
            if "WIN_RATE" in self.key or "RATE" in self.key or "DRAW_RATE" in self.key or self.key == "GAMBLE_TAX_RATE":
                if "%" in val_str:
                    val = float(val_str.replace("%", "")) / 100.0
                else:
                    val = float(val_str)
                    if val > 1.0:
                        val = val / 100.0
                        
                if val < 0.0 or val > 1.0:
                    return await interaction.response.send_message("確率は 0.0 〜 1.0 (0% 〜 100%) の範囲で入力してください。", ephemeral=True)
                    
            elif "MUL" in self.key:
                val = float(val_str)
                
            elif self.key == "GAMBLE_TAX_ENABLED":
                try:
                    val = int(val_str)
                    if val not in (0, 1):
                        return await interaction.response.send_message("1（有効）か0（無効）を入力してください。", ephemeral=True)
                    val = bool(val)
                except ValueError:
                    return await interaction.response.send_message("1（有効）か0（無効）を入力してください。", ephemeral=True)
            else:
                val = int(val_str)
                if val < 0:
                    return await interaction.response.send_message("0以上の数値を入力してください。", ephemeral=True)
                    
            # 保存
            await database.save_setting(interaction.guild.id, self.key, val)
            bot.bot_settings.setdefault(interaction.guild.id, {})[self.key] = val
            
            embed = discord.Embed(
                title="✅ 設定更新完了",
                description=f"設定項目 **`{self.key}`** を **`{val}`** に更新しました！",
                color=discord.Color.green()
            )
            
            back_view = GambleGameSettingsView(interaction.user, self.game_key, bot, back_to=self.back_to)
            await interaction.response.send_message(embed=embed, view=back_view, ephemeral=True)
        except ValueError:
            await interaction.response.send_message("入力された値の形式が正しくありません。数値で入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] GambleDetailSettingsModal: {e}")
            await interaction.response.send_message("設定中にエラーが発生しました。", ephemeral=True)


class GambleSubSettingsBackButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="⬅️ ゲーム選択に戻る", style=discord.ButtonStyle.secondary, emoji="⬅️", row=4)
        
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
            
        main_view = GambleSettingsView(view.user, back_to=view.back_to)
        embed = await main_view.build_embed(interaction.client)
        await interaction.response.edit_message(embed=embed, view=main_view)


class GambleSettingsBackButton(discord.ui.Button):
    def __init__(self, back_to="admin"):
        super().__init__(label="⬅️ 管理パネルに戻る", style=discord.ButtonStyle.secondary, custom_id=f"admin_gamble_back_btn_{back_to}", row=4)
        self.back_to = back_to
   
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if interaction.user != view.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        if self.back_to == "admin":
            await interaction.response.send_message("このパネルは無効になりました。メッセージを削除してください。", ephemeral=True)
            try:
                await interaction.message.delete()
            except:
                pass
        elif self.back_to == "employee":
            await interaction.response.defer()
            from cogs.gambling import GambleEmployeePanelView
            back_view = GambleEmployeePanelView(interaction.user, interaction.client)
            embed = back_view.build_embed()
            await interaction.edit_original_response(embed=embed, view=back_view)


class GambleLimitResetView(discord.ui.View):
    def __init__(self, user, bot):
        super().__init__(timeout=300)
        self.user = user
        self.bot = bot
        self.selected_user = None
        
        self.user_select = discord.ui.UserSelect(placeholder="制限解除するユーザーを選択...", min_values=1, max_values=1, custom_id="gamble_limit_reset_user_select")
        self.user_select.callback = self.user_select_callback
        self.add_item(self.user_select)
        
        self.complete_btn = discord.ui.Button(label="完了", style=discord.ButtonStyle.success, custom_id="gamble_limit_reset_complete_btn")
        self.complete_btn.callback = self.complete_callback
        self.add_item(self.complete_btn)
        
        self.back_btn = discord.ui.Button(label="⬅️ 戻る", style=discord.ButtonStyle.secondary, custom_id="gamble_limit_reset_back_btn")
        self.back_btn.callback = self.back_callback
        self.add_item(self.back_btn)

    async def user_select_callback(self, interaction: discord.Interaction):
        if interaction.user != self.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        self.selected_user = self.user_select.values[0]
        await interaction.response.defer()

    async def complete_callback(self, interaction: discord.Interaction):
        if interaction.user != self.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        
        if not self.selected_user:
            return await interaction.response.send_message("ユーザーを選択してください。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        
        today_str = datetime.datetime.now(JST).strftime("%Y-%m-%d")
        await database.reset_gambling_count(interaction.guild.id, self.selected_user.id, today_str)
        
        from cogs.gambling import GambleEmployeePanelView
        back_view = GambleEmployeePanelView(self.user, self.bot)
        embed = back_view.build_embed()
        
        await interaction.followup.edit_message(message_id=interaction.message.id, embed=embed, view=back_view)
        await interaction.followup.send(f"✅ {self.selected_user.mention} の1日10回のギャンブル制限を解除しました。", ephemeral=True)

    async def back_callback(self, interaction: discord.Interaction):
        if interaction.user != self.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
            
        from cogs.gambling import GambleEmployeePanelView
        back_view = GambleEmployeePanelView(self.user, self.bot)
        embed = back_view.build_embed()
        await interaction.response.edit_message(embed=embed, view=back_view)


class GambleEmployeePanelView(discord.ui.View):
    def __init__(self, user, bot):
        super().__init__(timeout=300)
        self.user = user
        self.bot = bot

    def build_embed(self):
        embed = discord.Embed(
            title="🎰 ギャンブル管理パネル",
            description="賭博統括および管理者専用の操作パネルです。\n実行したい操作を下のボタンから選択してください。",
            color=discord.Color.blue()
        )
        return embed

    @discord.ui.button(label="ギャンブル設定", style=discord.ButtonStyle.primary, emoji="🎰", custom_id="gamble_employee_settings_btn")
    async def gamble_config_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user != self.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        
        view = GambleSettingsView(self.user, back_to="employee")
        embed = await view.build_embed(self.bot)
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="1日10回の制限解除", style=discord.ButtonStyle.success, emoji="🔓", custom_id="gamble_employee_reset_btn")
    async def reset_limit_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user != self.user:
            return await interaction.response.send_message("操作権限がありません。", ephemeral=True)
        
        view = GambleLimitResetView(self.user, self.bot)
        embed = discord.Embed(
            title="🔓 1日10回の制限解除",
            description="制限解除（本日のプレイ回数をリセット）したいユーザーを選択し、完了ボタンを押してください。",
            color=discord.Color.green()
        )
        await interaction.response.edit_message(embed=embed, view=view)


class GambleEmployeeGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="賭博従業員", description="賭博統括および管理者専用コマンド")
        self.bot = bot

    @app_commands.command(name="設定", description="【賭博統括・管理者専用】ギャンブル管理パネルを表示します")
    async def gamble_setup(self, interaction: discord.Interaction):
        from helpers import has_gamble_manager_role
        if not has_gamble_manager_role(self.bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません。", ephemeral=True)
        
        view = GambleEmployeePanelView(interaction.user, self.bot)
        embed = view.build_embed()
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)


# --- Cogの定義 ---
class Gambling(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        global _bot_instance
        _bot_instance = bot

    async def cog_load(self):
        self.bot.add_view(ChinchiroView())
        self.bot.add_view(CoinflipView())
        self.bot.add_view(SlotView())
        self.bot.add_view(BlackjackView())
        self.bot.add_view(RouletteView())
        self.bot.add_view(HorseRacingView())
        self.bot.tree.add_command(GambleEmployeeGroup(self.bot))

    async def cog_unload(self):
        self.bot.tree.remove_command("賭博従業員")

async def setup(bot):
    await bot.add_cog(Gambling(bot))

