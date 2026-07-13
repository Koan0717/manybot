import discord
from discord.ext import commands
from discord import app_commands
import datetime
import asyncio
import database
from helpers import (
    JST, get_setting, get_role_by_setting, has_admin_role, is_admin, is_admin_or_interviewer, is_admin_or_banker, send_log,
    NEW_MEMBER_ROLE_NAME, INTERVIEWER_ROLE_NAMES, FREE_INN_ROLE_NAMES,
    EMBLEM_MANAGER_ROLE_NAME, EMBLEM_MASTER_ROLE_NAME, CONFESSION_PRIEST_ROLE_NAME,
    PRIEST_ROLE_NAME, ADMIN_ROLE_NAMES, EVALUATOR_ROLE_NAMES, DEFAULT_SETTINGS,
    format_setting_status, circled_to_int, get_circled_number, apply_bot_nicknames
)
# 注意: bot.pyの245行目あたりにあった bot_settings や triggers のキャッシュは bot 側にある。

# --- UIクラス (ヘルパーのダミーインポート等も利用) ---
# 他のUIインポートや定義
from cogs.rooms import VCRenamePanelView, RoomView, CustomRoomView, LuxuryRoomView, InnCombinedView, GameRoomPanelView
from cogs.gambling import ChinchiroView, CoinflipView, SlotView, BlackjackView, RouletteView
from cogs.interview import InterviewPanelView
from cogs.utility import EmblemRequestPanelView, ConfessionRequestPanelView, InquiryRequestPanelView, AnonymousChatPanelView, CustomTicketPanelView, AnonymousChatSetupView, InquirySetupView

async def trigger_evaluation_failure(guild, target, reason, executor, bot):
    # 通貨マイナス落ち対象ロールを剥奪
    minus_target_ids = get_setting(bot, "MINUS_TARGET_ROLE_IDS") or []
    roles_to_remove = [r for r in target.roles if r.id in minus_target_ids]
    if roles_to_remove:
        try:
            await target.remove_roles(*roles_to_remove, reason=reason)
        except Exception as e:
            print(f"[Evaluation] Failed to remove minus target roles: {e}")

    punish_type = get_setting(bot, "MINUS_PUNISHMENT_TYPE") or "evaluation_failure"
    is_minus_trigger = (reason == "通貨マイナスになったため")
    
    if is_minus_trigger and punish_type == "violator":
        # 違反者ロールを付与
        role = get_role_by_setting(bot, guild, "GAMBLE_VIOLATOR_ROLE_ID", "違反者")
        if role and role not in target.roles:
            try:
                await target.add_roles(role, reason=reason)
            except Exception as e:
                print(f"[Evaluation] Failed to add violator role: {e}")
                
        dm_msg = "通貨がマイナスになった為、違反者になりました。"
        try:
            await target.send(dm_msg)
        except Exception:
            pass
            
        embed = discord.Embed(
            title="🚨 違反者登録",
            description=f"{target.mention} が違反者に登録されました。",
            color=discord.Color.red()
        )
        embed.add_field(name="理由", value=reason, inline=False)
        embed.add_field(name="実行者", value=executor.mention if executor else "システム", inline=False)
        await send_log(bot, guild, "evaluation_failure", embed)
    else:
        # 評価落ちロールを付与
        role = get_role_by_setting(bot, guild, "DOWNGRADE_ROLE_ID", "評価落ち")
        if role and role not in target.roles:
            try:
                await target.add_roles(role, reason=reason)
            except Exception as e:
                print(f"[Evaluation] Failed to add role: {e}")
                
        dm_msg = "審査の結果評価落ちになりました。" if reason != "通貨マイナスになったため" else "通貨がマイナスになった為、評価落ちしました。"
        try:
            await target.send(dm_msg)
        except Exception:
            pass
            
        embed = discord.Embed(
            title="📉 評価落ち",
            description=f"{target.mention} が評価落ちしました。",
            color=discord.Color.red()
        )
        embed.add_field(name="理由", value=reason, inline=False)
        embed.add_field(name="実行者", value=executor.mention if executor else "システム", inline=False)
        await send_log(bot, guild, "evaluation_failure", embed)

# --- コア設定パネル更新関数 ---
async def create_admin_panel_embed(bot, guild: discord.Guild) -> discord.Embed:
    import asyncio
    # データベースから設定項目を非同期ロード
    log_chans_task = database.get_all_log_settings(guild.id)
    rank_settings_task = database.get_rank_settings(guild.id)
    level_rewards_task = database.get_level_role_rewards()
    level_coin_rewards_task = database.get_level_coin_rewards()
    room_prices_task = database.get_all_room_prices()
    vc_triggers_task = database.get_auto_vc_triggers()
    eval_settings_task = database.get_evaluation_settings(guild.id)
    role_room_prices_task = database.get_all_role_room_prices()
    antigrief_settings_task = database.get_antigrief_settings(guild.id)
    vc_coins_settings_task = database.get_vc_coins_settings(guild.id)
    
    log_chans, rank_settings, level_rewards, level_coin_rewards, room_prices, vc_triggers, eval_settings, role_room_prices, antigrief_settings, vc_coins_settings = await asyncio.gather(
        log_chans_task, rank_settings_task, level_rewards_task, level_coin_rewards_task, room_prices_task, vc_triggers_task, eval_settings_task, role_room_prices_task, antigrief_settings_task, vc_coins_settings_task
    )
    
    if not eval_settings:
        eval_settings = {"forum_channel_ids": [], "self_intro_channel_ids": []}
        
    log_chans = [{"log_type": k, "channel_id": v} for k, v in log_chans.items()] if isinstance(log_chans, dict) else [{"log_type": k, "channel_id": v} for k, v in (await log_chans_task).items()]
    
    embed = discord.Embed(
        title="⚙️ ０番区bot 管理パネル",
        description="Botの設定状況を確認・変更できます。下のセレクトメニューやボタンから項目を選択してください。",
        color=discord.Color.blue()
    )
    
    
    
    lv_status = format_setting_status(bot, guild, "LEVEL_UP_CHANNEL_ID")
    eval_cat_status = format_setting_status(bot, guild, "EVALUATION_CATEGORY_ID")
    new_mem_status = format_setting_status(bot, guild, "NEW_MEMBER_ROLE_ID")
    downgrade_role_status = format_setting_status(bot, guild, "DOWNGRADE_ROLE_ID")
    pending_mem_status = format_setting_status(bot, guild, "PENDING_MEMBER_ROLE_ID")
    admin_status = format_setting_status(bot, guild, "ADMIN_ROLE_IDS")
    interviewer_status = format_setting_status(bot, guild, "INTERVIEWER_ROLE_IDS")
    free_inn_status = format_setting_status(bot, guild, "FREE_INN_ROLE_IDS")
    main_sub_status = format_setting_status(bot, guild, "MAIN_SUB_MEMBER_ROLE_IDS")
    minus_target_status = format_setting_status(bot, guild, "MINUS_TARGET_ROLE_IDS")
    enable_tc_status = format_setting_status(bot, guild, "ENABLE_TC_RANK")
    enable_vc_coins_status = format_setting_status(bot, guild, "ENABLE_VC_COINS")
    violator_role_status = format_setting_status(bot, guild, "GAMBLE_VIOLATOR_ROLE_ID")
    minus_punishment_val = get_setting(bot, "MINUS_PUNISHMENT_TYPE") or "evaluation_failure"
    minus_punishment_status = "📉 評価落ち" if minus_punishment_val == "evaluation_failure" else "🚨 違反者登録"
    
    emblem_manager_status = format_setting_status(bot, guild, "EMBLEM_MANAGER_ROLE_ID")
    emblem_master_status = format_setting_status(bot, guild, "EMBLEM_MASTER_ROLE_ID")
    confession_status = format_setting_status(bot, guild, "CONFESSION_PRIEST_ROLE_ID")
    priest_status = format_setting_status(bot, guild, "PRIEST_ROLE_ID")
    event_manager_status = format_setting_status(bot, guild, "EVENT_MANAGER_ROLE_IDS")
    gamble_employee_status = format_setting_status(bot, guild, "GAMBLE_EMPLOYEE_ROLE_IDS")
    gamble_manager_status = format_setting_status(bot, guild, "GAMBLE_MANAGER_ROLE_IDS")
    
    evaluator_status = format_setting_status(bot, guild, "EVALUATOR_ROLE_IDS")
    evaluator2_status = format_setting_status(bot, guild, "EVALUATOR_TIER2_ROLE_IDS")
    evaluator3_status = format_setting_status(bot, guild, "EVALUATOR_TIER3_ROLE_IDS")
    
    basic_text = (
        f"・レベルアップ通知: {lv_status}\n"
        f"・評価対象カテゴリー: **{eval_cat_status}**\n"
        f"・仮(新規)メンバーロール: {new_mem_status}\n"
        f"・評価落ちロール: {downgrade_role_status}\n"
        f"・入界待機者ロール: {pending_mem_status}\n"
        f"・本/準メンバーロール: {main_sub_status}\n"
        f"・通貨マイナス落ち対象ロール: {minus_target_status}\n"
        f"・通貨マイナス時の処分: **{minus_punishment_status}**\n"
        f"・運営管理者ロール: {admin_status}\n"
        f"・面接官ロール: {interviewer_status}\n"
        f"・無料宿ロール: {free_inn_status}\n"
        f"・TCランク有効状態: {enable_tc_status}\n"
        f"・VCコイン付与有効状態: {enable_vc_coins_status}\n"
    )
    embed.add_field(name="👥 基本・管理権限設定", value=basic_text, inline=False)
    
    other_roles_text = (
        f"・初級評価員ロール: {evaluator_status}\n"
        f"・中級評価員ロール: {evaluator2_status}\n"
        f"・上級評価員ロール: {evaluator3_status}\n"
        f"・スタンプ統括ロール: {emblem_manager_status}\n"
        f"・スタンプ制作ロール: {emblem_master_status}\n"
        f"・告解司祭 / 司祭ロール: {confession_status} / {priest_status}\n"
        f"・イベンター統括ロール: {event_manager_status}\n"
        f"・賭博従業員ロール: {gamble_employee_status}\n"
        f"・賭博統括ロール: {gamble_manager_status}\n"
        f"・違反者ロール: {violator_role_status}\n"
    )
    embed.add_field(name="🏷️ その他役職・役割ロール設定", value=other_roles_text, inline=False)
    
    # 2. ログ設定
    log_names = {
        "message_edit_delete": "メッセージ編集・削除",
        "member_join_leave": "入退室ログ",
        "vc_join_leave": "VC入退室",
        "currency": "通貨ログ",
        "gambling": "ギャンブルログ",
        "interviewer": "面接官ログ",
        "evaluation_failure": "評価落ちログ"
    }
    log_text = ""
    for s in log_chans:
        chan = bot.get_channel(s["channel_id"])
        mention = chan.mention if chan else f"未取得 (ID: {s['channel_id']})"
        log_text += f"・{log_names.get(s['log_type'], s['log_type'])} ➔ {mention}\n"
    embed.add_field(name="📝 ログ出力設定", value=log_text or "設定されているログ出力はありません。", inline=False)
    
    # 3. ランク除外設定
    wl_ch = [guild.get_channel(cid).mention for cid in rank_settings.get("whitelist", []) if guild.get_channel(cid)]
    wl_cat = [guild.get_channel(cid).name for cid in rank_settings.get("categories", []) if guild.get_channel(cid)]
    bl_ch = [guild.get_channel(cid).mention for cid in rank_settings.get("blacklist", []) if guild.get_channel(cid)]
    bl_cat = [guild.get_channel(cid).name for cid in rank_settings.get("blacklist_categories", []) if guild.get_channel(cid)]
    rank_text = (
        f"・WL(対象)チャンネル: {', '.join(wl_ch) if wl_ch else 'なし'}\n"
        f"・WL(対象)カテゴリー: {', '.join(wl_cat) if wl_cat else 'なし'}\n"
        f"・BL(除外)チャンネル: {', '.join(bl_ch) if bl_ch else 'なし'}\n"
        f"・BL(除外)カテゴリー: {', '.join(bl_cat) if bl_cat else 'なし'}\n"
    )
    embed.add_field(name="🏆 ランク対象チャンネル設定", value=rank_text, inline=False)
    
    # 3.5 VCコイン獲得制限設定
    vcc_wl_ch = [guild.get_channel(cid).mention for cid in vc_coins_settings.get("whitelist", []) if guild.get_channel(cid)]
    vcc_wl_cat = [guild.get_channel(cid).name for cid in vc_coins_settings.get("categories", []) if guild.get_channel(cid)]
    vcc_bl_ch = [guild.get_channel(cid).mention for cid in vc_coins_settings.get("blacklist", []) if guild.get_channel(cid)]
    vcc_bl_cat = [guild.get_channel(cid).name for cid in vc_coins_settings.get("blacklist_categories", []) if guild.get_channel(cid)]
    vc_coins_text = (
        f"・WL(対象)チャンネル: {', '.join(vcc_wl_ch) if vcc_wl_ch else 'なし'}\n"
        f"・WL(対象)カテゴリー: {', '.join(vcc_wl_cat) if vcc_wl_cat else 'なし'}\n"
        f"・BL(除外)チャンネル: {', '.join(vcc_bl_ch) if vcc_bl_ch else 'なし'}\n"
        f"・BL(除外)カテゴリー: {', '.join(vcc_bl_cat) if vcc_bl_cat else 'なし'}\n"
    )
    embed.add_field(name="💰 VCコイン獲得対象設定", value=vc_coins_text, inline=False)
    
    
    cur_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    tc_rewards = [r for r in level_rewards if r["level_type"] == "tc"]
    vc_rewards = [r for r in level_rewards if r["level_type"] == "vc"]
    tc_coin_rewards = [r for r in level_coin_rewards if r["level_type"] == "tc"]
    vc_coin_rewards = [r for r in level_coin_rewards if r["level_type"] == "vc"]
    
    tc_combined = {}
    for r in tc_rewards:
        role = guild.get_role(r["role_id"])
        mention = role.mention if role else f"未取得 (ID: {r['role_id']})"
        tc_combined.setdefault(r["level"], []).append(f"ロール: {mention}")
    for r in tc_coin_rewards:
        tc_combined.setdefault(r["level"], []).append(f"{cur_name}: {r['coins']:,}枚")
        
    vc_combined = {}
    for r in vc_rewards:
        role = guild.get_role(r["role_id"])
        mention = role.mention if role else f"未取得 (ID: {r['role_id']})"
        vc_combined.setdefault(r["level"], []).append(f"ロール: {mention}")
    for r in vc_coin_rewards:
        vc_combined.setdefault(r["level"], []).append(f"{cur_name}: {r['coins']:,}枚")
        
    level_text = "**[💬 テキスト (TC)]**\n"
    for lv in sorted(tc_combined.keys()):
        rewards_str = " + ".join(tc_combined[lv])
        level_text += f" ・Lv.{lv} ➔ {rewards_str}\n"
    if not tc_combined: level_text += " ・設定なし\n"
    
    level_text += "**[🎙️ ボイス (VC)]**\n"
    for lv in sorted(vc_combined.keys()):
        rewards_str = " + ".join(vc_combined[lv])
        level_text += f" ・Lv.{lv} ➔ {rewards_str}\n"
    if not vc_combined: level_text += " ・設定なし\n"
    embed.add_field(name="🎁 レベル到達報酬設定", value=level_text, inline=False)
    
    # 5. 経済＆部屋価格設定
    init_coins = get_setting(bot, "INITIAL_COINS") or 30000
    vc_coins = get_setting(bot, "VC_COINS_PER_MIN")
    if vc_coins is None: vc_coins = 12
    prices_text = (
        f"・通貨単位名: **{cur_name}**\n"
        f"・新規入界時発行額: **{init_coins:,} {cur_name}**\n"
        f"・VC浮上時獲得額 (1分): **{vc_coins} {cur_name}**\n"
    )
    for p in room_prices:
        prices_text += f"・{p['room_type']} ({p['duration']}時間) ➔ **{p['price']:,} {cur_name}**\n"
    
    if role_room_prices:
        role_key_names = {
            "DOWNGRADE_ROLE": "評価落ち",
            "NEW_MEMBER_ROLE": "仮メンバー"
        }
        prices_text += "**[ロール別特別価格]**\n"
        for rp in role_room_prices:
            role_label = role_key_names.get(rp["role_key"], rp["role_key"])
            prices_text += f" ・{role_label}用 {rp['room_type']} ({rp['duration']}時間) ➔ **{rp['price']:,} {cur_name}**\n"
            
    embed.add_field(name="💰 経済・部屋価格設定", value=prices_text, inline=False)
    
    # ギャンブル勝率確率
    ch_pin = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_PINZORO") or 0.02
    ch_ara = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_ARASHI") or 0.05
    ch_shig = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_SHIGORO") or 0.08
    ch_norm = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_NORMAL_WIN") or 0.295
    ch_hif = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_HIFUMI") or 0.11
    ch_los = get_setting(bot, "GAMBLE_CHINCHIRO_RATE_LOSE") or 0.445
    
    coinflip_win = get_setting(bot, "GAMBLE_COINFLIP_RATE_WIN") or 0.475
    coinflip_lose = get_setting(bot, "GAMBLE_COINFLIP_RATE_LOSE") or 0.525
    
    p_7 = get_setting(bot, "GAMBLE_SLOT_RATE_7") or 0.002
    p_star = get_setting(bot, "GAMBLE_SLOT_RATE_STAR") or 0.002
    p_three = get_setting(bot, "GAMBLE_SLOT_RATE_THREE") or 0.012
    p_two = get_setting(bot, "GAMBLE_SLOT_RATE_TWO") or 0.328
    
    bj_win = get_setting(bot, "GAMBLE_BLACKJACK_RATE_NORMAL_WIN") or 0.38
    bj_bj = get_setting(bot, "GAMBLE_BLACKJACK_RATE_BJ_WIN") or 0.05
    bj_draw = get_setting(bot, "GAMBLE_BLACKJACK_RATE_DRAW") or 0.09
    bj_lose = get_setting(bot, "GAMBLE_BLACKJACK_RATE_LOSE") or 0.48
    
    r_win_2x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_2X") or 0.475
    r_win_3x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_3X") or 0.316
    r_win_36x = get_setting(bot, "GAMBLE_ROULETTE_WIN_RATE_36X") or 0.0264
    
    gamble_text = (
        f"・🎲 **チンチロリン**: ピンゾロ `{ch_pin*100:.1f}%` / アラシ `{ch_ara*100:.1f}%` / シゴロ `{ch_shig*100:.1f}%` / 通常勝 `{ch_norm*100:.1f}%` / ヒフミ `{ch_hif*100:.1f}%` / 敗北 `{ch_los*100:.1f}%`\n"
        f"・🪙 **コイントス**: 勝利 `{coinflip_win*100:.1f}%` / 敗北 `{coinflip_lose*100:.1f}%`\n"
        f"・🎰 **スロット**: 7揃 `{p_7*100:.2f}%` / ⭐揃 `{p_star*100:.2f}%` / 3揃 `{p_three*100:.2f}%` / 2揃 `{p_two*100:.1f}%` (ハズレ `{(1.0-p_7-p_star-p_three-p_two)*100:.1f}%`)\n"
        f"・🃏 **ブラックジャック**: 通常勝 `{bj_win*100:.1f}%` / BJ勝 `{bj_bj*100:.1f}%` / 分 `{bj_draw*100:.1f}%` / 負 `{bj_lose*100:.1f}%`\n"
        f"・🎡 **ルーレット**: 2倍賭 `{r_win_2x*100:.1f}%` / 3倍賭 `{r_win_3x*100:.1f}%` / 1点賭 `{r_win_36x*100:.2f}%`\n"
    )
    embed.add_field(name="🎰 ギャンブル勝率確率設定", value=gamble_text, inline=False)
    
    # 6. 自動VCトリガー設定
    trigger_text = ""
    for tid in vc_triggers:
        ch = bot.get_channel(tid)
        mention = ch.mention if ch else f"未取得 (ID: {tid})"
        cfg = bot.auto_vc_configs.get(tid, {})
        base = cfg.get("base_name") or "（デフォルト）"
        trigger_text += f"・{mention} [ベース名: {base}]\n"
    embed.add_field(name=f"🔊 自動VCトリガー設定 (登録数: {len(vc_triggers)}個)", value=trigger_text or "登録されているトリガーはありません。", inline=False)
    
    # 7. 自己紹介評価設定
    forums = [bot.get_channel(fid).mention for fid in eval_settings["forum_channel_ids"] if bot.get_channel(fid)]
    intros = [bot.get_channel(cid).mention for cid in eval_settings["self_intro_channel_ids"] if bot.get_channel(cid)]
    eval_text = (
        f"・評価フォーラム: {', '.join(forums) if forums else 'なし'}\n"
        f"・対象自己紹介チャンネル: {', '.join(intros) if intros else 'なし'}\n"
    )
    embed.add_field(name="📝 自己紹介評価設定", value=eval_text, inline=False)
    
    # 8. 荒らし対策設定
    ag_categories = [guild.get_channel(cid).name for cid in antigrief_settings.get("categories", []) if guild.get_channel(cid)]
    ag_channels = [guild.get_channel(cid).mention for cid in antigrief_settings.get("channels", []) if guild.get_channel(cid)]
    ag_exempt_roles = [guild.get_role(rid).mention for rid in antigrief_settings.get("exempt_roles", []) if guild.get_role(rid)]
    
    target_scope = ""
    if not ag_categories and not ag_channels:
        target_scope = "サーバー全体 (すべてのチャンネルとカテゴリー)"
    else:
        scopes = []
        if ag_categories:
            scopes.append(f"対象カテゴリー: {', '.join(ag_categories)}")
        if ag_channels:
            scopes.append(f"対象チャンネル: {', '.join(ag_channels)}")
        target_scope = "\n".join(scopes)

    antigrief_text = (
        f"・適用対象:\n{target_scope}\n"
        f"・免除ロール: {', '.join(ag_exempt_roles) if ag_exempt_roles else 'なし'}\n"
    )
    embed.add_field(name="🚨 荒らし対策設定", value=antigrief_text, inline=False)
    
    return embed

async def update_main_admin_panel(interaction: discord.Interaction):
    bot = interaction.client
    guild = interaction.guild
    embed = await create_admin_panel_embed(bot, guild)
    view = BotSetupMainView()
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

# --- 永続Views & Modals (管理者設定用) ---
class EconomySettingsModal(discord.ui.Modal, title='経済設定の変更'):
    def __init__(self, bot):
        super().__init__()
        cur_name_val = get_setting(bot, "CURRENCY_NAME") or "コイン"
        init_coins_val = get_setting(bot, "INITIAL_COINS")
        if init_coins_val is None: init_coins_val = 30000
        vc_coins_val = get_setting(bot, "VC_COINS_PER_MIN")
        if vc_coins_val is None: vc_coins_val = 12
        
        self.cur_name = discord.ui.TextInput(label='通貨名 (デフォルト: コイン)', default=str(cur_name_val), max_length=10, required=True)
        self.init_coins = discord.ui.TextInput(label='新規登録時の発行額', default=str(init_coins_val), max_length=9, required=True)
        self.vc_coins = discord.ui.TextInput(label='VC浮上1分あたりのコイン数', default=str(vc_coins_val), max_length=5, required=True)
        self.add_item(self.cur_name)
        self.add_item(self.init_coins)
        self.add_item(self.vc_coins)
        
    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            coins = int(self.init_coins.value)
            vc_coins = int(self.vc_coins.value)
            if coins < 0 or vc_coins < 0: raise ValueError
            
            await database.save_setting(interaction.guild.id, "CURRENCY_NAME", self.cur_name.value)
            await database.save_setting(interaction.guild.id, "INITIAL_COINS", coins)
            await database.save_setting(interaction.guild.id, "VC_COINS_PER_MIN", vc_coins)
            
            bot.bot_settings.setdefault(interaction.guild.id, {})["CURRENCY_NAME"] = self.cur_name.value
            bot.bot_settings.setdefault(interaction.guild.id, {})["INITIAL_COINS"] = coins
            bot.bot_settings.setdefault(interaction.guild.id, {})["VC_COINS_PER_MIN"] = vc_coins
            
            await interaction.response.send_message("✅ 経済設定を更新しました！", ephemeral=True)
            await update_main_admin_panel(interaction)
        except:
            await interaction.response.send_message("正の整数を入力してください。", ephemeral=True)

class ManageEconomySettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="経済を設定", emoji="🪙", style=discord.ButtonStyle.secondary, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.send_modal(EconomySettingsModal(interaction.client))

class LogTypeSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="📝 メッセージ編集・削除", value="message_edit_delete", description="メッセージの編集・削除ログ"),
            discord.SelectOption(label="👥 メンバー入退", value="member_join_leave", description="サーバー参加・退出ログ"),
            discord.SelectOption(label="🎙️ VC入退室", value="vc_join_leave", description="ボイスチャンネルの接続・切断・移動ログ"),
            discord.SelectOption(label="💰 通貨・経済", value="currency", description="通貨の付与・送金・お渡し等のログ"),
            discord.SelectOption(label="🎰 ギャンブルログ", value="gambling", description="ギャンブルの勝敗や配当などのログ"),
            discord.SelectOption(label="👔 面接官ログ", value="interviewer", description="面接官の入界手続きなどのアクションログ"),
            discord.SelectOption(label="📉 評価落ちログ", value="evaluation_failure", description="評価落ちロール付与および通貨マイナス時のログ"),
            discord.SelectOption(label="🛒 ショップログ", value="shop", description="ショップの商品追加・編集・削除・購入ログ")
        ]
        super().__init__(placeholder="設定するログの種類を選択...", min_values=1, max_values=1, options=options, row=0)

    async def callback(self, interaction: discord.Interaction):
        self.view.selected_log_type = self.values[0]
        await interaction.response.defer()

class LogChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="送信先テキストチャンネルを選択...", channel_types=[discord.ChannelType.text], row=1)

    async def callback(self, interaction: discord.Interaction):
        self.view.selected_channel = self.values[0]
        await interaction.response.defer()

class SaveLogSettingButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="💾 ログ設定を保存", style=discord.ButtonStyle.success, row=2)

    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if not view.selected_log_type or not view.selected_channel:
            return await interaction.response.send_message("❌ ログ種別とチャンネルを両方選択してください。", ephemeral=True)
            
        await interaction.response.defer()
        try:
            await database.save_log_channel(interaction.guild.id, view.selected_log_type, view.selected_channel.id)
            await update_log_settings_config_view(interaction)
            await interaction.followup.send("✅ ログ設定を保存しました！", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ ログ設定の保存中にエラーが発生しました: {e}", ephemeral=True)
            print(f"[Error] Log setting save failed: {e}")

class RemoveLogSettingSelect(discord.ui.Select):
    def __init__(self, settings, guild: discord.Guild):
        options = []
        log_types = {
            "message_edit_delete": "メッセージ編集・削除",
            "member_join_leave": "メンバー入退",
            "vc_join_leave": "VC参加・退出",
            "currency": "通貨・経済",
            "gambling": "ギャンブルログ",
            "interviewer": "面接官ログ",
            "evaluation_failure": "評価落ちログ",
            "shop": "ショップログ"
        }
        for l_type, ch_id in settings.items():
            ch = guild.get_channel(ch_id)
            ch_name = f"#{ch.name}" if ch else f"不明なチャンネル (ID: {ch_id})"
            options.append(discord.SelectOption(
                label=f"{log_types.get(l_type, l_type)} ➔ {ch_name}",
                value=l_type,
                description=f"ログ設定を解除します"
            ))
        super().__init__(
            placeholder="解除するログ設定を選択...",
            min_values=1,
            max_values=1,
            options=options[:25],
            row=3
        )

    async def callback(self, interaction: discord.Interaction):
        log_type = self.values[0]
        await interaction.response.defer()
        try:
            await database.remove_log_channel(interaction.guild.id, log_type)
            await update_log_settings_config_view(interaction)
            await interaction.followup.send("✅ ログ設定を解除しました！", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ ログ設定の解除中にエラーが発生しました: {e}", ephemeral=True)
            print(f"[Error] Log setting remove failed: {e}")

class LogSettingsConfigView(discord.ui.View):
    def __init__(self, settings, guild: discord.Guild):
        super().__init__(timeout=180)
        self.selected_log_type = None
        self.selected_channel = None
        self.add_item(LogTypeSelect())
        self.add_item(LogChannelSelect())
        self.add_item(SaveLogSettingButton())
        
        if settings:
            self.add_item(RemoveLogSettingSelect(settings, guild))
            
        self.add_item(BackToAdminPanelButton(row=4))

async def update_log_settings_config_view(interaction: discord.Interaction):
    guild = interaction.guild
    settings = await database.get_all_log_settings(guild.id)
    
    embed = discord.Embed(
        title="📋 サーバーログ設定パネル",
        description=(
            "サーバー内で発生する各種イベントのログ送信先を設定します。\n\n"
            "**【設定手順】**\n"
            "1. **ログの種類**を選択します。\n"
            "2. **送信先テキストチャンネル**を選択します。\n"
            "3. **「ログ設定を保存」**ボタンを押します。\n\n"
            "**【解除手順】**\n"
            "一番下の解除用ドロップダウンから、解除したい設定を選択します。"
        ),
        color=discord.Color.blue()
    )
    
    log_types = {
        "message_edit_delete": "📝 メッセージ編集・削除",
        "member_join_leave": "👥 メンバー入退",
        "vc_join_leave": "🎙️ VC参加・退出",
        "currency": "💰 通貨・経済",
        "gambling": "🎰 ギャンブルログ",
        "interviewer": "👔 面接官ログ",
        "evaluation_failure": "📉 評価落ちログ",
        "shop": "🛒 ショップログ"
    }
    
    settings_str = ""
    for l_type, display_name in log_types.items():
        ch_id = settings.get(l_type)
        if ch_id:
            channel = interaction.guild.get_channel(ch_id)
            ch_mention = channel.mention if channel else f"⚠️ 不明なチャンネル (ID: `{ch_id}`)"
        else:
            ch_mention = "未設定"
        settings_str += f"• **{display_name}**: {ch_mention}\n"
        
    embed.add_field(name="現在の設定一覧", value=settings_str, inline=False)
    view = LogSettingsConfigView(settings, guild)
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageLogSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="ログを設定", emoji="📋", style=discord.ButtonStyle.secondary, row=1)
    async def callback(self, interaction: discord.Interaction):
        await update_log_settings_config_view(interaction)

# --- ランク除外設定 ---
class WhitelistChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ホワイトリストに追加するチャンネル...", channel_types=[discord.ChannelType.text], min_values=1, max_values=1, row=0)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.update_rank_settings_list(interaction.guild.id, "whitelist_channels", chan.id, "add")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class WhitelistCategorySelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ホワイトリストに追加するカテゴリー...", channel_types=[discord.ChannelType.category], min_values=1, max_values=1, row=1)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cat = self.values[0]
        await database.update_rank_settings_list(interaction.guild.id, "whitelist_categories", cat.id, "add")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class BlacklistChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ブラックリストに追加するチャンネル...", channel_types=[discord.ChannelType.text], min_values=1, max_values=1, row=2)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.update_rank_settings_list(interaction.guild.id, "blacklist_channels", chan.id, "add")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class BlacklistCategorySelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ブラックリストに追加するカテゴリー...", channel_types=[discord.ChannelType.category], min_values=1, max_values=1, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cat = self.values[0]
        await database.update_rank_settings_list(interaction.guild.id, "blacklist_categories", cat.id, "add")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class ClearWhitelistCHButton(discord.ui.Button):
    def __init__(self): super().__init__(label="WLチャンネル消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_rank_settings_field(interaction.guild.id, "whitelist_channel_ids")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class ClearWhitelistCatButton(discord.ui.Button):
    def __init__(self): super().__init__(label="WLカテゴリ消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_rank_settings_field(interaction.guild.id, "whitelist_category_ids")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class ClearBlacklistCHButton(discord.ui.Button):
    def __init__(self): super().__init__(label="BLチャンネル消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_rank_settings_field(interaction.guild.id, "blacklist_channel_ids")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class ClearBlacklistCatButton(discord.ui.Button):
    def __init__(self): super().__init__(label="BLカテゴリ消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_rank_settings_field(interaction.guild.id, "blacklist_category_ids")
        await bot.fetch_and_cache_rank_config(interaction.guild.id)
        await update_rank_settings_config_view(interaction)

class RankSettingsConfigView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.add_item(WhitelistChannelSelect())
        self.add_item(WhitelistCategorySelect())
        self.add_item(BlacklistChannelSelect())
        self.add_item(BlacklistCategorySelect())
        self.add_item(ClearWhitelistCHButton())
        self.add_item(ClearWhitelistCatButton())
        self.add_item(ClearBlacklistCHButton())
        self.add_item(ClearBlacklistCatButton())
        self.add_item(BackToAdminPanelButton(row=4))

async def update_rank_settings_config_view(interaction: discord.Interaction):
    bot = interaction.client
    guild = interaction.guild
    cfg = await database.get_rank_settings(guild.id)
    embed = discord.Embed(
        title="⚙️ ランク対象チャンネル設定",
        description="XP獲得が有効なチャンネルをカテゴリーまたは個別チャンネルで制御します。\n"
                    "・ホワイトリスト(WL)が設定されている場合、WLのみが対象になります。\n"
                    "・ブラックリスト(BL)が設定されている場合、BLは除外されます。",
        color=discord.Color.blue()
    )
    
    wl_ch = [guild.get_channel(cid).mention for cid in cfg.get("whitelist", []) if guild.get_channel(cid)]
    wl_cat = [guild.get_channel(cid).name for cid in cfg.get("categories", []) if guild.get_channel(cid)]
    bl_ch = [guild.get_channel(cid).mention for cid in cfg.get("blacklist", []) if guild.get_channel(cid)]
    bl_cat = [guild.get_channel(cid).name for cid in cfg.get("blacklist_categories", []) if guild.get_channel(cid)]
    
    embed.add_field(name="WL（対象）チャンネル", value=", ".join(wl_ch) if wl_ch else "なし", inline=False)
    embed.add_field(name="WL（対象）カテゴリー", value=", ".join(wl_cat) if wl_cat else "なし", inline=False)
    embed.add_field(name="BL（除外）チャンネル", value=", ".join(bl_ch) if bl_ch else "なし", inline=False)
    embed.add_field(name="BL（除外）カテゴリー", value=", ".join(bl_cat) if bl_cat else "なし", inline=False)
    
    view = RankSettingsConfigView()
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageRankSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="ランク対象を設定", emoji="📊", style=discord.ButtonStyle.secondary, row=1)
    async def callback(self, interaction: discord.Interaction):
        await update_rank_settings_config_view(interaction)

# --- VCコイン制限設定 ---
class VCCoinsWhitelistChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ホワイトリストに追加するチャンネル...", channel_types=[discord.ChannelType.voice], min_values=1, max_values=1, row=0)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.update_vc_coins_settings_list(interaction.guild.id, "whitelist_channels", chan.id, "add")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class VCCoinsWhitelistCategorySelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ホワイトリストに追加するカテゴリー...", channel_types=[discord.ChannelType.category], min_values=1, max_values=1, row=1)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cat = self.values[0]
        await database.update_vc_coins_settings_list(interaction.guild.id, "whitelist_categories", cat.id, "add")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class VCCoinsBlacklistChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ブラックリストに追加するチャンネル...", channel_types=[discord.ChannelType.voice], min_values=1, max_values=1, row=2)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.update_vc_coins_settings_list(interaction.guild.id, "blacklist_channels", chan.id, "add")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class VCCoinsBlacklistCategorySelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="ブラックリストに追加するカテゴリー...", channel_types=[discord.ChannelType.category], min_values=1, max_values=1, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cat = self.values[0]
        await database.update_vc_coins_settings_list(interaction.guild.id, "blacklist_categories", cat.id, "add")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class ClearVCCoinsWhitelistCHButton(discord.ui.Button):
    def __init__(self): super().__init__(label="WLチャンネル消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_vc_coins_settings_field(interaction.guild.id, "whitelist_channel_ids")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class ClearVCCoinsWhitelistCatButton(discord.ui.Button):
    def __init__(self): super().__init__(label="WLカテゴリ消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_vc_coins_settings_field(interaction.guild.id, "whitelist_category_ids")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class ClearVCCoinsBlacklistCHButton(discord.ui.Button):
    def __init__(self): super().__init__(label="BLチャンネル消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_vc_coins_settings_field(interaction.guild.id, "blacklist_channel_ids")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class ClearVCCoinsBlacklistCatButton(discord.ui.Button):
    def __init__(self): super().__init__(label="BLカテゴリ消去", style=discord.ButtonStyle.danger, row=4)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_vc_coins_settings_field(interaction.guild.id, "blacklist_category_ids")
        await bot.fetch_and_cache_vc_coins_config(interaction.guild.id)
        await update_vc_coins_settings_config_view(interaction)

class VCCoinsSettingsConfigView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.add_item(VCCoinsWhitelistChannelSelect())
        self.add_item(VCCoinsWhitelistCategorySelect())
        self.add_item(VCCoinsBlacklistChannelSelect())
        self.add_item(VCCoinsBlacklistCategorySelect())
        self.add_item(ClearVCCoinsWhitelistCHButton())
        self.add_item(ClearVCCoinsWhitelistCatButton())
        self.add_item(ClearVCCoinsBlacklistCHButton())
        self.add_item(ClearVCCoinsBlacklistCatButton())
        self.add_item(BackToAdminPanelButton(row=4))

async def update_vc_coins_settings_config_view(interaction: discord.Interaction):
    bot = interaction.client
    guild = interaction.guild
    cfg = await database.get_vc_coins_settings(guild.id)
    embed = discord.Embed(
        title="⚙️ VCコイン獲得対象設定",
        description="VC滞在時間によるコイン獲得が有効なチャンネルをカテゴリーまたは個別チャンネルで制御します。\n"
                    "・ホワイトリスト(WL)が設定されている場合、WLのみが対象になります。\n"
                    "・ブラックリスト(BL)が設定されている場合、BLは除外されます。",
        color=discord.Color.gold()
    )
    
    wl_ch = [guild.get_channel(cid).mention for cid in cfg.get("whitelist", []) if guild.get_channel(cid)]
    wl_cat = [guild.get_channel(cid).name for cid in cfg.get("categories", []) if guild.get_channel(cid)]
    bl_ch = [guild.get_channel(cid).mention for cid in cfg.get("blacklist", []) if guild.get_channel(cid)]
    bl_cat = [guild.get_channel(cid).name for cid in cfg.get("blacklist_categories", []) if guild.get_channel(cid)]
    
    embed.add_field(name="WL（対象）チャンネル", value=", ".join(wl_ch) if wl_ch else "なし", inline=False)
    embed.add_field(name="WL（対象）カテゴリー", value=", ".join(wl_cat) if wl_cat else "なし", inline=False)
    embed.add_field(name="BL（除外）チャンネル", value=", ".join(bl_ch) if bl_ch else "なし", inline=False)
    embed.add_field(name="BL（除外）カテゴリー", value=", ".join(bl_cat) if bl_cat else "なし", inline=False)
    
    view = VCCoinsSettingsConfigView()
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageVCCoinsSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="VCコイン対象を設定", emoji="🪙", style=discord.ButtonStyle.secondary, row=1)
    async def callback(self, interaction: discord.Interaction):
        await update_vc_coins_settings_config_view(interaction)

# --- 荒らし対策設定UIコンポーネント ---
class AntigriefCategorySelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="対象に追加するカテゴリー...", channel_types=[discord.ChannelType.category], min_values=1, max_values=1, row=0)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cat = self.values[0]
        await database.update_antigrief_settings_list(interaction.guild.id, "categories", cat.id, "add")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class AntigriefChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="対象に追加するチャンネル...", channel_types=[discord.ChannelType.text], min_values=1, max_values=1, row=1)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.update_antigrief_settings_list(interaction.guild.id, "channels", chan.id, "add")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class AntigriefExemptRoleSelect(discord.ui.RoleSelect):
    def __init__(self):
        super().__init__(placeholder="免除に追加するロール...", min_values=1, max_values=1, row=2)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        role = self.values[0]
        await database.update_antigrief_settings_list(interaction.guild.id, "exempt_roles", role.id, "add")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class ClearAntigriefCategoriesButton(discord.ui.Button):
    def __init__(self): super().__init__(label="対象カテゴリ消去", style=discord.ButtonStyle.danger, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_antigrief_settings_field(interaction.guild.id, "target_category_ids")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class ClearAntigriefChannelsButton(discord.ui.Button):
    def __init__(self): super().__init__(label="対象チャンネル消去", style=discord.ButtonStyle.danger, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_antigrief_settings_field(interaction.guild.id, "target_channel_ids")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class ClearAntigriefExemptRolesButton(discord.ui.Button):
    def __init__(self): super().__init__(label="免除ロール消去", style=discord.ButtonStyle.danger, row=3)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        await database.clear_antigrief_settings_field(interaction.guild.id, "exempt_role_ids")
        await bot.fetch_and_cache_antigrief_config(interaction.guild.id)
        await update_antigrief_settings_config_view(interaction)

class AntigriefSettingsConfigView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.add_item(AntigriefCategorySelect())
        self.add_item(AntigriefChannelSelect())
        self.add_item(AntigriefExemptRoleSelect())
        self.add_item(ClearAntigriefCategoriesButton())
        self.add_item(ClearAntigriefChannelsButton())
        self.add_item(ClearAntigriefExemptRolesButton())
        self.add_item(BackToAdminPanelButton(row=4))

async def update_antigrief_settings_config_view(interaction: discord.Interaction):
    bot = interaction.client
    guild = interaction.guild
    cfg = await database.get_antigrief_settings(guild.id)
    embed = discord.Embed(
        title="⚙️ 荒らし対策 対象・免除設定",
        description="荒らし対策システムを適用する対象（カテゴリー/チャンネル）および免除するロールを設定します。\n"
                    "・対象を設定しない場合、**サーバー全体（すべてのチャンネル）が保護対象**となります。\n"
                    "・対象を設定した場合、設定されたカテゴリー/チャンネルのみで検知が有効化されます。\n"
                    "・免除ロールに指定されたメンバーは、検知チェックをバイパス（無視）します。",
        color=discord.Color.blue()
    )
    
    target_cats = [guild.get_channel(cid).name for cid in cfg.get("categories", []) if guild.get_channel(cid)]
    target_chs = [guild.get_channel(cid).mention for cid in cfg.get("channels", []) if guild.get_channel(cid)]
    exempt_roles = [guild.get_role(rid).mention for rid in cfg.get("exempt_roles", []) if guild.get_role(rid)]
    
    embed.add_field(name="対象カテゴリー", value=", ".join(target_cats) if target_cats else "サーバー全体 (全カテゴリー)", inline=False)
    embed.add_field(name="対象チャンネル", value=", ".join(target_chs) if target_chs else "サーバー全体 (全チャンネル)", inline=False)
    embed.add_field(name="免除ロール", value=", ".join(exempt_roles) if exempt_roles else "なし", inline=False)
    
    view = AntigriefSettingsConfigView()
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageAntigriefSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="荒らし対策を設定", emoji="🚨", style=discord.ButtonStyle.secondary, row=2)
    async def callback(self, interaction: discord.Interaction):
        await update_antigrief_settings_config_view(interaction)

# --- レベル到達ロール設定 ---
class LevelTypeSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="テキスト (TC) レベル報酬", value="tc"),
            discord.SelectOption(label="ボイス (VC) レベル報酬", value="vc")
        ]
        super().__init__(placeholder="レベル種別を選択...", options=options, row=0)
    async def callback(self, interaction: discord.Interaction):
        self.view.level_type = self.values[0]
        await interaction.response.defer(ephemeral=True)

class LevelRoleSelect(discord.ui.RoleSelect):
    def __init__(self):
        super().__init__(placeholder="付与するロールを選択...", min_values=1, max_values=1, row=1)
    async def callback(self, interaction: discord.Interaction):
        self.view.role = self.values[0]
        await interaction.response.defer(ephemeral=True)

class LevelInputModal(discord.ui.Modal, title='必要レベルの入力'):
    def __init__(self, view_ref):
        super().__init__()
        self.view_ref = view_ref
        self.level_input = discord.ui.TextInput(label='必要レベル (正の整数)', placeholder='例: 5', max_length=4, required=True)
        self.add_item(self.level_input)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            val = int(self.level_input.value)
            if val <= 0: raise ValueError
            await database.add_level_role_reward(self.view_ref.level_type, val, self.view_ref.role.id)
            await interaction.response.send_message(f"✅ 設定しました: {self.view_ref.level_type.upper()} Lv.{val} ➔ {self.view_ref.role.mention}", ephemeral=True)
            await update_level_roles_config_view(interaction)
        except:
            await interaction.response.send_message("正の整数を入力してください。", ephemeral=True)

class AddLevelRoleButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="レベルを決定して追加", style=discord.ButtonStyle.success, row=2)
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if not view.level_type or not view.role:
            return await interaction.response.send_message("レベル種別とロールを選択してください。", ephemeral=True)
        await interaction.response.send_modal(LevelInputModal(view))

class LevelCoinInputModal(discord.ui.Modal, title='コイン報酬の入力'):
    def __init__(self, view_ref):
        super().__init__()
        self.view_ref = view_ref
        self.level_input = discord.ui.TextInput(label='必要レベル (正の整数)', placeholder='例: 5', max_length=4, required=True)
        self.coins_input = discord.ui.TextInput(label='報酬コイン数 (正の整数)', placeholder='例: 1000', max_length=9, required=True)
        self.add_item(self.level_input)
        self.add_item(self.coins_input)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            lv = int(self.level_input.value)
            coins = int(self.coins_input.value)
            if lv <= 0 or coins <= 0: raise ValueError
            await database.add_level_coin_reward(self.view_ref.level_type, lv, coins)
            await interaction.response.send_message(f"✅ 設定しました: {self.view_ref.level_type.upper()} Lv.{lv} ➔ {coins:,} コイン", ephemeral=True)
            await update_level_roles_config_view(interaction)
        except:
            await interaction.response.send_message("レベルとコイン数は正の整数を入力してください。", ephemeral=True)

class AddLevelCoinButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="レベルとコインを決定して追加", style=discord.ButtonStyle.success, row=2)
    async def callback(self, interaction: discord.Interaction):
        view = self.view
        if not view.level_type:
            return await interaction.response.send_message("レベル種別を選択してください。", ephemeral=True)
        await interaction.response.send_modal(LevelCoinInputModal(view))

class RemoveLevelRewardSelect(discord.ui.Select):
    def __init__(self, role_rewards, coin_rewards, guild):
        options = []
        for r in role_rewards:
            role = guild.get_role(r["role_id"])
            role_name = role.name if role else f"不明 (ID: {r['role_id']})"
            options.append(discord.SelectOption(
                label=f"🔴 ロール削除: {r['level_type'].upper()} Lv.{r['level']} ➔ {role_name}",
                value=f"role:{r['level_type']}:{r['level']}:{r['role_id']}"
            ))
        for r in coin_rewards:
            options.append(discord.SelectOption(
                label=f"🪙 コイン削除: {r['level_type'].upper()} Lv.{r['level']} ➔ {r['coins']:,}枚",
                value=f"coin:{r['level_type']}:{r['level']}"
            ))
        super().__init__(placeholder="削除する報酬設定を選択...", options=options[:25], row=3)
        
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        parts = self.values[0].split(":")
        rtype = parts[0]
        if rtype == "role":
            ltype, level, rid = parts[1], int(parts[2]), int(parts[3])
            await database.remove_level_role_reward(ltype, level, rid)
        elif rtype == "coin":
            ltype, level = parts[1], int(parts[2])
            await database.remove_level_coin_reward(ltype, level)
        await update_level_roles_config_view(interaction)
        await interaction.followup.send("✅ 報酬設定を削除しました。", ephemeral=True)

class LevelRolesConfigView(discord.ui.View):
    def __init__(self, role_rewards=None, coin_rewards=None, guild=None):
        super().__init__(timeout=180)
        self.level_type = None
        self.role = None
        self.add_item(LevelTypeSelect())
        self.add_item(LevelRoleSelect())
        self.add_item(AddLevelRoleButton())
        self.add_item(AddLevelCoinButton())
        
        if (role_rewards or coin_rewards) and guild:
            self.add_item(RemoveLevelRewardSelect(role_rewards or [], coin_rewards or [], guild))
            
        self.add_item(BackToAdminPanelButton(row=4))

async def update_level_roles_config_view(interaction: discord.Interaction):
    guild = interaction.guild
    bot = interaction.client
    rewards = await database.get_level_role_rewards()
    coin_rewards = await database.get_level_coin_rewards()
    embed = discord.Embed(title="⚙️ レベル到達報酬設定", description="特定のレベルに達したメンバーに自動付与するロールやコインを管理します。", color=discord.Color.blue())
    
    cur_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    
    tc_rewards = [r for r in rewards if r["level_type"] == "tc"]
    vc_rewards = [r for r in rewards if r["level_type"] == "vc"]
    tc_coin_rewards = [r for r in coin_rewards if r["level_type"] == "tc"]
    vc_coin_rewards = [r for r in coin_rewards if r["level_type"] == "vc"]
    
    tc_combined = {}
    for r in tc_rewards:
        role = guild.get_role(r["role_id"])
        mention = role.mention if role else f"未取得 (ID: {r['role_id']})"
        tc_combined.setdefault(r["level"], []).append(f"ロール: {mention}")
    for r in tc_coin_rewards:
        tc_combined.setdefault(r["level"], []).append(f"{cur_name}: {r['coins']:,}枚")
        
    vc_combined = {}
    for r in vc_rewards:
        role = guild.get_role(r["role_id"])
        mention = role.mention if role else f"未取得 (ID: {r['role_id']})"
        vc_combined.setdefault(r["level"], []).append(f"ロール: {mention}")
    for r in vc_coin_rewards:
        vc_combined.setdefault(r["level"], []).append(f"{cur_name}: {r['coins']:,}枚")
        
    tc_text = ""
    for lv in sorted(tc_combined.keys()):
        rewards_str = " + ".join(tc_combined[lv])
        tc_text += f"・Lv.{lv} ➔ {rewards_str}\n"
        
    vc_text = ""
    for lv in sorted(vc_combined.keys()):
        rewards_str = " + ".join(vc_combined[lv])
        vc_text += f"・Lv.{lv} ➔ {rewards_str}\n"
        
    embed.add_field(name="💬 テキスト (TC) レベル報酬", value=tc_text or "設定なし", inline=False)
    embed.add_field(name="🎙️ ボイス (VC) レベル報酬", value=vc_text or "設定なし", inline=False)
    
    view = LevelRolesConfigView(rewards, coin_rewards, guild)
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageLevelRolesButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="レベルロールを設定", emoji="🎁", style=discord.ButtonStyle.secondary, row=1)
    async def callback(self, interaction: discord.Interaction):
        await update_level_roles_config_view(interaction)

# --- 部屋の価格設定 ---
# --- 部屋の価格設定 ---
class RoomPriceSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="一般宿 (12時間)", value="宿:12"),
            discord.SelectOption(label="一般宿 (24時間)", value="宿:24"),
            discord.SelectOption(label="高級宿 (12時間)", value="高級宿:12"),
            discord.SelectOption(label="高級宿 (24時間)", value="高級宿:24"),
            discord.SelectOption(label="カスタムVC (24時間)", value="カスタムVC:24"),
            discord.SelectOption(label="ゲームVC (12時間)", value="ゲームVC:12"),
            discord.SelectOption(label="ゲームVC (24時間)", value="ゲームVC:24"),
            discord.SelectOption(label="賭博VC (12時間)", value="賭博VC:12"),
            discord.SelectOption(label="賭博VC (24時間)", value="賭博VC:24"),
            discord.SelectOption(label="評価落ち用 高級宿 (12時間)", value="role:DOWNGRADE_ROLE:高級宿:12"),
            discord.SelectOption(label="評価落ち用 高級宿 (24時間)", value="role:DOWNGRADE_ROLE:高級宿:24"),
            discord.SelectOption(label="仮メンバー用 高級宿 (12時間)", value="role:NEW_MEMBER_ROLE:高級宿:12"),
            discord.SelectOption(label="仮メンバー用 高級宿 (24時間)", value="role:NEW_MEMBER_ROLE:高級宿:24"),
            discord.SelectOption(label="本・準メン用 高級宿 (12時間)", value="role:MAIN_SUB_MEMBER_ROLE:高級宿:12"),
            discord.SelectOption(label="本・準メン用 高級宿 (24時間)", value="role:MAIN_SUB_MEMBER_ROLE:高級宿:24")
        ]
        super().__init__(placeholder="価格を変更する部屋種別を選択...", options=options, row=0)
    async def callback(self, interaction: discord.Interaction):
        self.view.selected_item = self.values[0]
        await interaction.response.defer(ephemeral=True)

class PriceInputModal(discord.ui.Modal, title='新しい価格の入力'):
    def __init__(self, view_ref):
        super().__init__()
        self.view_ref = view_ref
        self.price_input = discord.ui.TextInput(label='新しい価格', placeholder='例: 15000', max_length=9, required=True)
        self.add_item(self.price_input)
    async def on_submit(self, interaction: discord.Interaction):
        try:
            bot = interaction.client
            price = int(self.price_input.value)
            if price < 0: raise ValueError
            parts = self.view_ref.selected_item.split(":")
            
            currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            
            if parts[0] == "role":
                role_key = parts[1]
                rtype = parts[2]
                dur = int(parts[3])
                await database.save_role_room_price(role_key, rtype, dur, price)
                bot.role_room_prices[(role_key, rtype, dur)] = price
                
                role_labels = {
                    "DOWNGRADE_ROLE": "評価落ち",
                    "NEW_MEMBER_ROLE": "仮メンバー",
                    "MAIN_SUB_MEMBER_ROLE": "本・準メンバー"
                }
                role_label = role_labels.get(role_key, role_key)
                await interaction.response.send_message(f"✅ 更新しました: {role_label}用 {rtype} ({dur}時間) ➔ {price:,} {currency_name}", ephemeral=True)
            else:
                rtype, dur = parts[0], int(parts[1])
                await database.update_room_price(rtype, dur, price)
                await interaction.response.send_message(f"✅ 更新しました: {rtype} ({dur}時間) ➔ {price:,} {currency_name}", ephemeral=True)
                
            await update_room_prices_config_view(interaction)
        except ValueError:
            await interaction.response.send_message("正の整数を入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] PriceInputModal submission error: {e}")
            await interaction.response.send_message(f"❌ システムエラーが発生しました: {e}", ephemeral=True)

class RoomPricesConfigView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)
        self.selected_item = None
        self.add_item(RoomPriceSelect())
        self.add_item(BackToAdminPanelButton(row=2))

    @discord.ui.button(label="価格を入力する", style=discord.ButtonStyle.success, row=1)
    async def confirm_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not self.selected_item:
            return await interaction.response.send_message("部屋種別を選択してください。", ephemeral=True)
        await interaction.response.send_modal(PriceInputModal(self))

async def update_room_prices_config_view(interaction: discord.Interaction):
    bot = interaction.client
    prices = await database.get_all_room_prices()
    role_prices = await database.get_all_role_room_prices()
    
    embed = discord.Embed(title="⚙️ 部屋の価格設定", description="宿やカスタムVCのレンタル料金を管理します。", color=discord.Color.blue())
    
    currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
    text = ""
    for p in prices:
        text += f"・{p['room_type']} ({p['duration']}時間) ➔ **{p['price']:,} {currency_name}**\n"
        
    if role_prices:
        role_key_names = {
            "DOWNGRADE_ROLE": "評価落ち",
            "NEW_MEMBER_ROLE": "仮メンバー",
            "MAIN_SUB_MEMBER_ROLE": "本・準メンバー"
        }
        text += "\n**[ロール別特別価格]**\n"
        for rp in role_prices:
            role_label = role_key_names.get(rp["role_key"], rp["role_key"])
            text += f" ・{role_label}用 {rp['room_type']} ({rp['duration']}時間) ➔ **{rp['price']:,} {currency_name}**\n"
        
    embed.add_field(name="現在の価格設定一覧", value=text or "設定なし", inline=False)
    view = RoomPricesConfigView()
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageRoomPricesButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="部屋価格を設定", emoji="💰", style=discord.ButtonStyle.secondary, row=1)
    async def callback(self, interaction: discord.Interaction):
        await update_room_prices_config_view(interaction)

# --- VC自動作成トリガー設定 ---
class VCTriggerNameModal(discord.ui.Modal, title='ベースチャンネル名の設定'):
    def __init__(self, channel_id, cfg):
        super().__init__()
        self.channel_id = channel_id
        self.cfg = cfg
        self.name_input = discord.ui.TextInput(
            label='部屋のベース名 (空白で「🔊│メンバー名の部屋」)',
            placeholder='例: 雑談部屋',
            default=cfg.get("base_name", ""),
            required=False,
            max_length=50
        )
        self.add_item(self.name_input)

    async def on_submit(self, interaction: discord.Interaction):
        bot = interaction.client
        base_name = self.name_input.value
        c = self.cfg
        await database.save_auto_vc_config(
            self.channel_id,
            base_name,
            c.get("allow_rename", True),
            c.get("include_owner_name", True),
            c.get("use_numbering", False),
            c.get("allow_limit_change", True),
            c.get("show_panel", True)
        )
        
        # キャッシュ更新
        bot.auto_vc_configs[self.channel_id] = {
            "channel_id": self.channel_id,
            "base_name": base_name,
            "allow_rename": c.get("allow_rename", True),
            "include_owner_name": c.get("include_owner_name", True),
            "use_numbering": c.get("use_numbering", False),
            "allow_limit_change": c.get("allow_limit_change", True),
            "show_panel": c.get("show_panel", True)
        }
        
        await interaction.response.send_message("✅ ベースチャンネル名を更新しました！", ephemeral=True)
        await update_config_view(interaction)

class VCTriggerOptionsView(discord.ui.View):
    def __init__(self, channel_id, cfg):
        super().__init__(timeout=120)
        self.channel_id = channel_id
        self.cfg = cfg
        self.update_buttons()

    def update_buttons(self):
        c = self.cfg
        self.rename_btn.label = f"名前変更の許可: {'⭕' if c.get('allow_rename', True) else '❌'}"
        self.owner_btn.label = f"所有者名の付与: {'⭕' if c.get('include_owner_name', True) else '❌'}"
        self.num_btn.label = f"連番（①②...）の付与: {'⭕' if c.get('use_numbering', False) else '❌'}"
        self.limit_btn.label = f"人数制限変更の許可: {'⭕' if c.get('allow_limit_change', True) else '❌'}"
        self.show_panel_btn.label = f"設定パネルの送信: {'⭕' if c.get('show_panel', True) else '❌'}"

    async def save(self, interaction):
        bot = interaction.client
        c = self.cfg
        await database.save_auto_vc_config(
            self.channel_id,
            c.get("base_name", ""),
            c.get("allow_rename", True),
            c.get("include_owner_name", True),
            c.get("use_numbering", False),
            c.get("allow_limit_change", True),
            c.get("show_panel", True)
        )
        bot.auto_vc_configs[self.channel_id] = c
        self.update_buttons()
        await interaction.response.edit_message(view=self)

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=0)
    async def rename_btn(self, interaction, button):
        self.cfg["allow_rename"] = not self.cfg.get("allow_rename", True)
        await self.save(interaction)

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=0)
    async def owner_btn(self, interaction, button):
        self.cfg["include_owner_name"] = not self.cfg.get("include_owner_name", True)
        await self.save(interaction)

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=0)
    async def num_btn(self, interaction, button):
        self.cfg["use_numbering"] = not self.cfg.get("use_numbering", False)
        await self.save(interaction)

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=1)
    async def limit_btn(self, interaction, button):
        self.cfg["allow_limit_change"] = not self.cfg.get("allow_limit_change", True)
        await self.save(interaction)

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=1)
    async def show_panel_btn(self, interaction, button):
        self.cfg["show_panel"] = not self.cfg.get("show_panel", True)
        await self.save(interaction)

    @discord.ui.button(label="名前の編集...", style=discord.ButtonStyle.primary, row=2)
    async def edit_name_btn(self, interaction, button):
        await interaction.response.send_modal(VCTriggerNameModal(self.channel_id, self.cfg))

    @discord.ui.button(label="戻る", style=discord.ButtonStyle.secondary, row=2)
    async def back(self, interaction, button):
        await interaction.response.defer(ephemeral=True)
        await update_config_view(interaction)

async def update_config_view(interaction):
    # helpers等ではなくここで呼ぶ
    await update_config_view_impl(interaction)

async def update_config_view_impl(interaction: discord.Interaction):
    bot = interaction.client
    triggers = await database.get_auto_vc_triggers()
    bot.auto_vc_triggers = set(triggers)
    
    embed = discord.Embed(
        title="⚙️ 自動VC作成トリガー設定",
        description="特定のボイスチャンネルに入室した際、自動的に一時部屋を作成するトリガーを管理します。",
        color=discord.Color.blue()
    )
    
    text = ""
    for tid in triggers:
        ch = bot.get_channel(tid)
        mention = ch.mention if ch else f"未取得 (ID: {tid})"
        cfg = bot.auto_vc_configs.get(tid, {})
        base = cfg.get("base_name") or "（デフォルト）"
        text += f"・{mention} [ベース名: {base}]\n"
        
    embed.add_field(name="現在の登録トリガー一覧", value=text or "登録されているトリガーはありません。", inline=False)
    view = VCTriggersConfigView(triggers, bot)
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class AddVCTriggerSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="トリガーにするボイスチャンネルを選択...", channel_types=[discord.ChannelType.voice], row=0)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        ch = self.values[0]
        if ch.id in bot.auto_vc_triggers:
            return await interaction.followup.send("⚠️ このチャンネルは既にトリガーに登録されています。", ephemeral=True)
            
        await database.add_auto_vc_trigger(ch.id)
        bot.auto_vc_triggers.add(ch.id)
        
        # デフォルト設定保存
        await database.save_auto_vc_config(ch.id, "", True, True, False, True, True)
        bot.auto_vc_configs[ch.id] = {
            "channel_id": ch.id, "base_name": "", "allow_rename": True,
            "include_owner_name": True, "use_numbering": False, "allow_limit_change": True, "show_panel": True
        }
        
        await update_config_view(interaction)

class RemoveVCTriggerSelect(discord.ui.Select):
    def __init__(self, triggers, bot):
        options = []
        for tid in triggers:
            ch = bot.get_channel(tid)
            name = ch.name if ch else f"不明 (ID: {tid})"
            options.append(discord.SelectOption(label=f"解除: {name}", value=str(tid)))
        super().__init__(placeholder="トリガー設定を解除するチャンネル...", options=options, row=1)
        
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        tid = int(self.values[0])
        await database.remove_auto_vc_trigger(tid)
        bot.auto_vc_triggers.discard(tid)
        bot.auto_vc_configs.pop(tid, None)
        await update_config_view(interaction)

class BotSetupConfigureView(discord.ui.Select):
    def __init__(self, triggers, bot):
        options = []
        for tid in triggers:
            ch = bot.get_channel(tid)
            name = ch.name if ch else f"不明 (ID: {tid})"
            options.append(discord.SelectOption(label=f"詳細設定: {name}", value=str(tid)))
        super().__init__(placeholder="詳細設定をするトリガーを選択...", options=options, row=2)
        
    async def callback(self, interaction: discord.Interaction):
        bot = interaction.client
        tid = int(self.values[0])
        cfg = bot.auto_vc_configs.get(tid)
        if not cfg:
            cfg = {
                "channel_id": tid, "base_name": "", "allow_rename": True,
                "include_owner_name": True, "use_numbering": False, "allow_limit_change": True, "show_panel": True
            }
            
        ch = bot.get_channel(tid)
        name = ch.name if ch else f"ID: {tid}"
        
        embed = discord.Embed(
            title=f"⚙️ 詳細設定: {name}",
            description="自動作成される一時部屋の挙動を設定できます。",
            color=discord.Color.blue()
        )
        
        view = VCTriggerOptionsView(tid, cfg)
        await interaction.response.edit_message(embed=embed, view=view)

class VCTriggersConfigView(discord.ui.View):
    def __init__(self, triggers, bot):
        super().__init__(timeout=180)
        self.add_item(AddVCTriggerSelect())
        if triggers:
            self.add_item(RemoveVCTriggerSelect(triggers, bot))
            self.add_item(BotSetupConfigureView(triggers, bot))
        self.add_item(BackToAdminPanelButton(row=3))

class ManageVCTriggersButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="vc作成トリガーを設定", emoji="🎙️", style=discord.ButtonStyle.secondary, row=2)
    async def callback(self, interaction: discord.Interaction):
        await update_config_view_impl(interaction)

# --- 評価管理設定 ---
class AddEvaluationForumSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="評価フォーラムを追加...", channel_types=[discord.ChannelType.forum], row=0)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        ch = self.values[0]
        cfg = bot.get_evaluation_config(interaction.guild.id)
        cfg["forum_channel_ids"].add(ch.id)
        await database.set_evaluation_settings(interaction.guild.id, list(cfg["forum_channel_ids"]), list(cfg["self_intro_channel_ids"]))
        await update_evaluation_settings_config_view(interaction)

class RemoveEvaluationForumSelect(discord.ui.Select):
    def __init__(self, forum_ids, bot):
        options = []
        for fid in forum_ids:
            ch = bot.get_channel(fid)
            name = ch.name if ch else f"不明 (ID: {fid})"
            options.append(discord.SelectOption(label=f"削除: {name}", value=str(fid)))
        super().__init__(placeholder="評価フォーラムを削除...", options=options, row=1)
        
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        fid = int(self.values[0])
        cfg = bot.get_evaluation_config(interaction.guild.id)
        cfg["forum_channel_ids"].discard(fid)
        await database.set_evaluation_settings(interaction.guild.id, list(cfg["forum_channel_ids"]), list(cfg["self_intro_channel_ids"]))
        await update_evaluation_settings_config_view(interaction)

class AddSelfIntroChannelSelect(discord.ui.ChannelSelect):
    def __init__(self):
        super().__init__(placeholder="自己紹介チャンネルを追加...", channel_types=[discord.ChannelType.text], row=2)
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        ch = self.values[0]
        cfg = bot.get_evaluation_config(interaction.guild.id)
        cfg["self_intro_channel_ids"].add(ch.id)
        await database.set_evaluation_settings(interaction.guild.id, list(cfg["forum_channel_ids"]), list(cfg["self_intro_channel_ids"]))
        await update_evaluation_settings_config_view(interaction)

class RemoveSelfIntroChannelSelect(discord.ui.Select):
    def __init__(self, channel_ids, bot):
        options = []
        for cid in channel_ids:
            ch = bot.get_channel(cid)
            name = ch.name if ch else f"不明 (ID: {cid})"
            options.append(discord.SelectOption(label=f"削除: {name}", value=str(cid)))
        super().__init__(placeholder="自己紹介チャンネルを削除...", options=options, row=3)
        
    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        cid = int(self.values[0])
        cfg = bot.get_evaluation_config(interaction.guild.id)
        cfg["self_intro_channel_ids"].discard(cid)
        await database.set_evaluation_settings(interaction.guild.id, list(cfg["forum_channel_ids"]), list(cfg["self_intro_channel_ids"]))
        await update_evaluation_settings_config_view(interaction)

class EvaluationSettingsConfigView(discord.ui.View):
    def __init__(self, cfg, bot):
        super().__init__(timeout=180)
        self.add_item(AddEvaluationForumSelect())
        if cfg["forum_channel_ids"]:
            self.add_item(RemoveEvaluationForumSelect(list(cfg["forum_channel_ids"]), bot))
            
        self.add_item(AddSelfIntroChannelSelect())
        if cfg["self_intro_channel_ids"]:
            self.add_item(RemoveSelfIntroChannelSelect(list(cfg["self_intro_channel_ids"]), bot))
            
        self.add_item(BackToAdminPanelButton(row=4))

async def update_evaluation_settings_config_view(interaction: discord.Interaction):
    bot = interaction.client
    guild = interaction.guild
    cfg = bot.get_evaluation_config(guild.id)
    embed = discord.Embed(title="⚙️ 評価スレッド作成設定", description="自己紹介が投稿された際に自動で評価スレッドを作成する設定を管理します。", color=discord.Color.blue())
    
    forums = [bot.get_channel(fid).mention for fid in cfg["forum_channel_ids"] if bot.get_channel(fid)]
    embed.add_field(name="評価フォーラム一覧", value=", ".join(forums) if forums else "なし", inline=False)
    
    intros = [bot.get_channel(cid).mention for cid in cfg["self_intro_channel_ids"] if bot.get_channel(cid)]
    embed.add_field(name="対象自己紹介チャンネル一覧", value=", ".join(intros) if intros else "なし", inline=False)
    
    view = EvaluationSettingsConfigView(cfg, bot)
    try:
        await interaction.response.edit_message(embed=embed, view=view)
    except discord.InteractionResponded:
        await interaction.edit_original_response(embed=embed, view=view)

class ManageEvaluationSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="自己紹介・評価を設定", emoji="📋", style=discord.ButtonStyle.secondary, row=2)
    async def callback(self, interaction: discord.Interaction):
        await update_evaluation_settings_config_view(interaction)

# --- TCランク & VCコイン設定UI ---
class TCRankToggleView(discord.ui.View):
    def __init__(self, current_val):
        super().__init__(timeout=180)
        self.current_val = current_val
        self.update_button()

    def update_button(self):
        self.toggle_btn.label = f"TCランク: {'🟢 有効' if self.current_val else '🔴 無効'}"
        self.toggle_btn.style = discord.ButtonStyle.success if self.current_val else discord.ButtonStyle.danger

    @discord.ui.button(style=discord.ButtonStyle.primary)
    async def toggle_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.current_val = not self.current_val
        await database.save_setting(interaction.guild.id, "ENABLE_TC_RANK", self.current_val)
        interaction.client.bot_settings.setdefault(interaction.guild.id, {})["ENABLE_TC_RANK"] = self.current_val
        self.update_button()
        await interaction.response.edit_message(view=self)
        try:
            await update_main_admin_panel(interaction)
        except:
            pass

class VCCoinsToggleView(discord.ui.View):
    def __init__(self, current_val):
        super().__init__(timeout=180)
        self.current_val = current_val
        self.update_button()

    def update_button(self):
        self.toggle_btn.label = f"VCコイン付与: {'🟢 有効' if self.current_val else '🔴 無効'}"
        self.toggle_btn.style = discord.ButtonStyle.success if self.current_val else discord.ButtonStyle.danger

    @discord.ui.button(style=discord.ButtonStyle.primary)
    async def toggle_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.current_val = not self.current_val
        await database.save_setting(interaction.guild.id, "ENABLE_VC_COINS", self.current_val)
        interaction.client.bot_settings.setdefault(interaction.guild.id, {})["ENABLE_VC_COINS"] = self.current_val
        self.update_button()
        await interaction.response.edit_message(view=self)
        try:
            await update_main_admin_panel(interaction)
        except:
            pass

class MinusPunishmentToggleView(discord.ui.View):
    def __init__(self, current_val):
        super().__init__(timeout=180)
        self.current_val = current_val or "evaluation_failure"
        self.update_button()

    def update_button(self):
        label_text = "📉 評価落ち" if self.current_val == "evaluation_failure" else "🚨 違反者登録"
        self.toggle_btn.label = f"マイナス処分: {label_text}"
        self.toggle_btn.style = discord.ButtonStyle.success if self.current_val == "evaluation_failure" else discord.ButtonStyle.danger

    @discord.ui.button(style=discord.ButtonStyle.primary)
    async def toggle_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.current_val == "evaluation_failure":
            self.current_val = "violator"
        else:
            self.current_val = "evaluation_failure"
            
        await database.save_setting(interaction.guild.id, "MINUS_PUNISHMENT_TYPE", self.current_val)
        interaction.client.bot_settings.setdefault(interaction.guild.id, {})["MINUS_PUNISHMENT_TYPE"] = self.current_val
        self.update_button()
        await interaction.response.edit_message(view=self)
        try:
            await update_main_admin_panel(interaction)
        except:
            pass

class VCCoinsInputModal(discord.ui.Modal, title='VC浮上コイン数の設定'):
    def __init__(self):
        super().__init__()
        self.coins_input = discord.ui.TextInput(
            label='1分あたりの獲得コイン数 (正の整数)', 
            placeholder='例: 12', 
            default='12',
            max_length=5, 
            required=True
        )
        self.add_item(self.coins_input)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            val = int(self.coins_input.value)
            if val < 0: raise ValueError
            await database.save_setting(interaction.guild.id, "VC_COINS_PER_MIN", val)
            interaction.client.bot_settings.setdefault(interaction.guild.id, {})["VC_COINS_PER_MIN"] = val
            await interaction.response.send_message(f"✅ VC浮上コイン数を {val} に設定しました。", ephemeral=True)
            await update_main_admin_panel(interaction)
        except:
            await interaction.response.send_message("正の整数を入力してください。", ephemeral=True)

class VCCoinsConfigView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=180)

    @discord.ui.button(label="獲得コイン数を入力する", style=discord.ButtonStyle.success)
    async def input_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(VCCoinsInputModal())

# --- 基本設定 (BotSetup) ---
class BotSetupRoleSelect(discord.ui.RoleSelect):
    def __init__(self, key, label):
        super().__init__(placeholder=label, min_values=1, max_values=10 if "IDS" in key else 1)
        self.key = key

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        val = self.values
        
        if "IDS" in self.key:
            ids = [r.id for r in val]
            await database.save_setting(interaction.guild.id, self.key, ids)
            bot.bot_settings.setdefault(interaction.guild.id, {})[self.key] = ids
        else:
            rid = val[0].id
            await database.save_setting(interaction.guild.id, self.key, rid)
            bot.bot_settings.setdefault(interaction.guild.id, {})[self.key] = rid
            
        await update_main_admin_panel(interaction)

class BotSetupChannelSelect(discord.ui.ChannelSelect):
    def __init__(self, key, label, ctype):
        super().__init__(placeholder=label, channel_types=[ctype])
        self.key = key

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        bot = interaction.client
        chan = self.values[0]
        await database.save_setting(interaction.guild.id, self.key, chan.id)
        bot.bot_settings.setdefault(interaction.guild.id, {})[self.key] = chan.id
        await update_main_admin_panel(interaction)

class BotSetupMainSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="レベル通知チャンネル", value="LEVEL_UP_CHANNEL_ID"),
            discord.SelectOption(label="評価対象カテゴリー", value="EVALUATION_CATEGORY_ID"),
            discord.SelectOption(label="仮（新規）メンバーロール", value="NEW_MEMBER_ROLE_ID"),
            discord.SelectOption(label="評価落ちロール", value="DOWNGRADE_ROLE_ID"),
            discord.SelectOption(label="入界待機者ロール", value="PENDING_MEMBER_ROLE_ID"),
            discord.SelectOption(label="スタンプ統括ロール", value="EMBLEM_MANAGER_ROLE_ID"),
            discord.SelectOption(label="スタンプ制作ロール", value="EMBLEM_MASTER_ROLE_ID"),
            discord.SelectOption(label="告解司祭ロール", value="CONFESSION_PRIEST_ROLE_ID"),
            discord.SelectOption(label="司祭ロール", value="PRIEST_ROLE_ID"),
            discord.SelectOption(label="運営管理者ロール (複数可)", value="ADMIN_ROLE_IDS"),
            discord.SelectOption(label="面接官ロール (複数可)", value="INTERVIEWER_ROLE_IDS"),
            discord.SelectOption(label="初級評価員ロール (複数可)", value="EVALUATOR_ROLE_IDS"),
            discord.SelectOption(label="中級評価員ロール (複数可)", value="EVALUATOR_TIER2_ROLE_IDS"),
            discord.SelectOption(label="上級評価員ロール (複数可)", value="EVALUATOR_TIER3_ROLE_IDS"),
            discord.SelectOption(label="無料宿ロール (複数可)", value="FREE_INN_ROLE_IDS"),
            discord.SelectOption(label="本・準メンバーロール (複数可)", value="MAIN_SUB_MEMBER_ROLE_IDS"),
            discord.SelectOption(label="イベンター統括ロール (複数可)", value="EVENT_MANAGER_ROLE_IDS", description="イベント管理やイベントポイントの付与・没収ができるロール"),
            discord.SelectOption(label="賭博従業員ロール (複数可)", value="GAMBLE_EMPLOYEE_ROLE_IDS"),
            discord.SelectOption(label="賭博統括ロール (複数可)", value="GAMBLE_MANAGER_ROLE_IDS"),
            discord.SelectOption(label="通貨マイナス落ち対象ロール (複数可)", value="MINUS_TARGET_ROLE_IDS"),
            discord.SelectOption(label="銀行員ロール (複数可)", value="BANKER_ROLE_IDS"),
            discord.SelectOption(label="違反者ロール", value="GAMBLE_VIOLATOR_ROLE_ID"),
            discord.SelectOption(label="通貨マイナス時の処分先", value="MINUS_PUNISHMENT_TYPE"),
            discord.SelectOption(label="TCランク有効状態", value="ENABLE_TC_RANK"),
            discord.SelectOption(label="VCコイン付与有効状態", value="ENABLE_VC_COINS")
        ]
        super().__init__(placeholder="設定する項目を選択...", options=options, custom_id="admin_bot_setup_main_select")

    async def callback(self, interaction: discord.Interaction):
        val = self.values[0]
        bot = interaction.client
        
        if val == "gamble_settings_menu":
            from cogs.gambling import GambleSettingsView
            view = GambleSettingsView(interaction.user, back_to="admin")
            embed = await view.build_embed(bot)
            return await interaction.response.edit_message(embed=embed, view=view)
            
        view = discord.ui.View()
        
        # チャンネルかロールかを判別
        role_items = [
            "NEW_MEMBER_ROLE_ID", "DOWNGRADE_ROLE_ID", "PENDING_MEMBER_ROLE_ID", "EMBLEM_MANAGER_ROLE_ID", "EMBLEM_MASTER_ROLE_ID",
            "CONFESSION_PRIEST_ROLE_ID", "PRIEST_ROLE_ID", "ADMIN_ROLE_IDS", "INTERVIEWER_ROLE_IDS",
            "EVALUATOR_ROLE_IDS", "EVALUATOR_TIER2_ROLE_IDS", "EVALUATOR_TIER3_ROLE_IDS", "FREE_INN_ROLE_IDS",
            "MAIN_SUB_MEMBER_ROLE_IDS", "EVENT_MANAGER_ROLE_IDS", "GAMBLE_EMPLOYEE_ROLE_IDS", "GAMBLE_MANAGER_ROLE_IDS",
            "MINUS_TARGET_ROLE_IDS", "BANKER_ROLE_IDS", "GAMBLE_VIOLATOR_ROLE_ID"
        ]
        
        if val in role_items:
            view.add_item(BotSetupRoleSelect(val, f"対象ロールを選択 ({self.placeholder})"))
        elif val == "LEVEL_UP_CHANNEL_ID":
            view.add_item(BotSetupChannelSelect(val, "通知するテキストチャンネルを選択...", discord.ChannelType.text))
        elif val == "EVALUATION_CATEGORY_ID":
            view.add_item(BotSetupChannelSelect(val, "評価対象のボイスカテゴリーを選択...", discord.ChannelType.category))
        elif val == "ENABLE_TC_RANK":
            current_val = get_setting(bot, "ENABLE_TC_RANK")
            view = TCRankToggleView(current_val)
        elif val == "ENABLE_VC_COINS":
            current_val = get_setting(bot, "ENABLE_VC_COINS")
            view = VCCoinsToggleView(current_val)
        elif val == "MINUS_PUNISHMENT_TYPE":
            current_val = get_setting(bot, "MINUS_PUNISHMENT_TYPE")
            view = MinusPunishmentToggleView(current_val)
            
        view.add_item(BackToAdminPanelButton())
        
        # 現在の設定値を取得して表示
        current_val = get_setting(bot, val)
        guild = interaction.guild
        current_status = "未設定"
        if current_val:
            if isinstance(current_val, list):
                mentions = []
                for item_id in current_val:
                    role = guild.get_role(item_id)
                    if role:
                        mentions.append(role.mention)
                    else:
                        chan = bot.get_channel(item_id)
                        if chan:
                            mentions.append(chan.mention)
                        else:
                            mentions.append(f"不明 (ID: {item_id})")
                if mentions:
                    current_status = "、".join(mentions)
            else:
                role = guild.get_role(current_val)
                if role:
                    current_status = role.mention
                else:
                    chan = bot.get_channel(current_val)
                    if chan:
                        current_status = chan.mention
                    else:
                        current_status = str(current_val)

        embed = discord.Embed(title=f"⚙️ 設定変更: {val}", description="下の選択メニューから値を選択してください。", color=discord.Color.blue())
        embed.add_field(name="現在の設定", value=current_status, inline=False)
        await interaction.response.edit_message(embed=embed, view=view)

class ManageGambleSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="ギャンブル設定", emoji="🎰", style=discord.ButtonStyle.secondary, custom_id="admin_manage_gamble_btn", row=3)

    async def callback(self, interaction: discord.Interaction):
        from cogs.gambling import GambleSettingsView
        view = GambleSettingsView(interaction.user)
        embed = await view.build_embed(interaction.client)
        await interaction.response.edit_message(embed=embed, view=view)


class ShopSettingsConfigView(discord.ui.View):
    def __init__(self, bot, guild_id: int):
        super().__init__(timeout=None)
        self.bot = bot
        self.guild_id = guild_id

    async def build_embed(self) -> discord.Embed:
        settings = await database.get_shop_settings(self.guild_id)
        emp_id = settings.get("employee_role_id")
        mgr_id = settings.get("manager_role_id")
        mention_ids = settings.get("inquiry_mention_role_ids", [])
        
        guild = self.bot.get_guild(self.guild_id)
        
        emp_mention = "未設定"
        if emp_id and guild:
            role = guild.get_role(emp_id)
            if role:
                emp_mention = role.mention
                
        mgr_mention = "未設定"
        if mgr_id and guild:
            role = guild.get_role(mgr_id)
            if role:
                mgr_mention = role.mention
                
        mention_strs = []
        if guild and mention_ids:
            for m_id in mention_ids:
                role = guild.get_role(m_id)
                if role:
                    mention_strs.append(role.mention)
        
        mention_mention = " ".join(mention_strs) if mention_strs else "未設定"
        
        embed = discord.Embed(
            title="🛒 ショップ設定",
            description=(
                "ショップの従業員ロール、統括ロール、およびお問い合わせの通知先メンションを設定します。\n\n"
                "**ショップ従業員ロール**\n"
                f"{emp_mention}\n\n"
                "**ショップ統括ロール**\n"
                f"{mgr_mention}\n\n"
                "**お問い合わせ通知先メンション**\n"
                f"{mention_mention}"
            ),
            color=discord.Color.gold()
        )
        return embed

    @discord.ui.button(label="従業員ロールを設定", style=discord.ButtonStyle.primary, custom_id="shop_settings_set_employee")
    async def set_employee(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = ShopRoleSelectView(self.bot, self.guild_id, "employee")
        embed = discord.Embed(title="🛒 ショップ従業員ロール設定", description="設定するロールを選択してください。", color=discord.Color.gold())
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="統括ロールを設定", style=discord.ButtonStyle.primary, custom_id="shop_settings_set_manager")
    async def set_manager(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = ShopRoleSelectView(self.bot, self.guild_id, "manager")
        embed = discord.Embed(title="🛒 ショップ統括ロール設定", description="設定するロールを選択してください。", color=discord.Color.gold())
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="お問い合わせメンションを設定", style=discord.ButtonStyle.primary, custom_id="shop_settings_set_mention")
    async def set_mention(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = ShopRoleSelectView(self.bot, self.guild_id, "mention")
        embed = discord.Embed(title="🛒 お問い合わせ通知先メンション設定", description="設定するロールを選択してください（複数可）。", color=discord.Color.gold())
        await interaction.response.edit_message(embed=embed, view=view)

    @discord.ui.button(label="戻る", style=discord.ButtonStyle.secondary, custom_id="shop_settings_back")
    async def back(self, interaction: discord.Interaction, button: discord.ui.Button):
        await update_main_admin_panel(interaction)

class ShopRoleSelectView(discord.ui.View):
    def __init__(self, bot, guild_id: int, setting_type: str):
        super().__init__(timeout=None)
        self.bot = bot
        self.guild_id = guild_id
        self.setting_type = setting_type
        
        if setting_type == "employee":
            select = discord.ui.RoleSelect(placeholder="従業員ロールを選択してください...", min_values=1, max_values=1)
        elif setting_type == "manager":
            select = discord.ui.RoleSelect(placeholder="統括ロールを選択してください...", min_values=1, max_values=1)
        else: # mention
            select = discord.ui.RoleSelect(placeholder="通知先ロールを選択してください...", min_values=1, max_values=10)
            
        select.callback = self.select_callback
        self.add_item(select)
        
        cancel_btn = discord.ui.Button(label="キャンセル", style=discord.ButtonStyle.secondary)
        cancel_btn.callback = self.cancel_callback
        self.add_item(cancel_btn)
        
    async def select_callback(self, interaction: discord.Interaction):
        select_component = self.children[0]
        roles = select_component.values
        
        current_settings = await database.get_shop_settings(self.guild_id)
        emp_id = current_settings.get("employee_role_id")
        mgr_id = current_settings.get("manager_role_id")
        mention_ids = current_settings.get("inquiry_mention_role_ids", [])
        
        if self.setting_type == "employee":
            emp_id = roles[0].id if roles else None
        elif self.setting_type == "manager":
            mgr_id = roles[0].id if roles else None
        elif self.setting_type == "mention":
            mention_ids = [role.id for role in roles] if roles else []
            
        first_mention_id = mention_ids[0] if mention_ids else None
        
        await database.set_shop_settings(self.guild_id, emp_id, mgr_id, first_mention_id, mention_ids)
        
        # メインショップ設定画面に戻す
        main_view = ShopSettingsConfigView(self.bot, self.guild_id)
        embed = await main_view.build_embed()
        await interaction.response.edit_message(embed=embed, view=main_view)
        
        await interaction.followup.send("設定を保存しました。", ephemeral=True)
        
    async def cancel_callback(self, interaction: discord.Interaction):
        main_view = ShopSettingsConfigView(self.bot, self.guild_id)
        embed = await main_view.build_embed()
        await interaction.response.edit_message(embed=embed, view=main_view)

class ManageShopSettingsButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label="ショップ設定", style=discord.ButtonStyle.secondary, emoji="🛒", custom_id="manage_shop_settings_btn", row=3)

    async def callback(self, interaction: discord.Interaction):
        view = ShopSettingsConfigView(interaction.client, interaction.guild_id)
        embed = await view.build_embed()
        await interaction.response.edit_message(embed=embed, view=view)

class BotSetupMainView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(BotSetupMainSelect())
        self.add_item(ManageLogSettingsButton())
        self.add_item(ManageRankSettingsButton())
        self.add_item(ManageVCCoinsSettingsButton())
        self.add_item(ManageLevelRolesButton())
        self.add_item(ManageRoomPricesButton())
        self.add_item(ManageVCTriggersButton())
        self.add_item(ManageEvaluationSettingsButton())
        self.add_item(ManageAntigriefSettingsButton())
        self.add_item(ManageShopSettingsButton())
        self.add_item(ManageGambleSettingsButton())
        self.add_item(ManageEconomySettingsButton())

class BackToAdminPanelButton(discord.ui.Button):
    def __init__(self, row=None):
        super().__init__(label="◀ 管理パネルに戻る", style=discord.ButtonStyle.secondary, row=row)
    async def callback(self, interaction: discord.Interaction):
        await update_main_admin_panel(interaction)

# --- パネル設置 ---
class PanelSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="チンチロリン", description="チンチロリンゲームのパネルを設置します", emoji="🎲", value="chinchiro"),
            discord.SelectOption(label="コイントス", description="コイントスゲームのパネルを設置します", emoji="🪙", value="coinflip"),
            discord.SelectOption(label="スロット", description="スロットゲームのパネルを設置します", emoji="🎰", value="slot"),
            discord.SelectOption(label="ブラックジャック", description="ブラックジャックゲームのパネルを設置します", emoji="🃏", value="blackjack"),
            discord.SelectOption(label="ルーレット", description="ルーレットゲームのパネルを設置します", emoji="🎡", value="roulette"),
            discord.SelectOption(label="一般宿", description="一般宿の購入パネルを設置します", emoji="🛖", value="general_inn"),
            discord.SelectOption(label="高級宿", description="高級宿の購入パネルを設置します", emoji="🏰", value="luxury_inn"),
            discord.SelectOption(label="一般宿・高級宿セット", description="一般宿と高級宿の両方の購入ボタンがあるパネルを設置します", emoji="🏨", value="inn_combined"),
            discord.SelectOption(label="カスタムVC", description="カスタムVCの作成パネルを設置します", emoji="✨", value="custom_vc"),
            discord.SelectOption(label="ゲームVC", description="ゲームVCの購入ボタンがあるパネルを設置します", emoji="🎮", value="game_vc"),
            discord.SelectOption(label="賭博VC", description="賭博VCの購入ボタンがあるパネルを設置します", emoji="🎲", value="gamble_vc"),
            discord.SelectOption(label="スタンプ依頼", description="スタンプ制作依頼のパネルを設置します", emoji="🎨", value="stamp"),
            discord.SelectOption(label="告解・相談室", description="告解・相談依頼のパネルを設置します", emoji="⛪", value="confession"),
            discord.SelectOption(label="VC管理", description="VC名・人数制限変更のパネルを設置します", emoji="⚙️", value="vc_manage"),
            discord.SelectOption(label="入界手続き", description="新規メンバーの入界手続きパネルを設置します", emoji="📝", value="interview"),
            discord.SelectOption(label="お問い合わせ", description="お問い合わせ作成パネルを設置します", emoji="✉️", value="inquiry"),
            discord.SelectOption(label="匿名チャット", description="匿名チャットのパネルを設置します", emoji="💬", value="anonymous_chat"),
            discord.SelectOption(label="カスタムチケット", description="任意のタイトル・説明文・担当ロールを指定したチケットパネルを設置します", emoji="🎫", value="custom_ticket"),
            discord.SelectOption(label="ショップ", description="ショップ機能のパネルを設置します", emoji="🛒", value="shop")
        ]
        super().__init__(placeholder="設置するパネルを選択してください...", min_values=1, max_values=1, options=options, custom_id="admin_panel_setup_select")

    async def callback(self, interaction: discord.Interaction):
        val = self.values[0]
        bot = interaction.client
        channel = interaction.channel
        guild = interaction.guild
        
        # 権限チェック
        if not has_admin_role(bot, interaction.user) and not interaction.user.guild_permissions.administrator:
            if val == "interview":
                user_role_names = [r.name for r in interaction.user.roles]
                is_interviewer = any(r in INTERVIEWER_ROLE_NAMES for r in user_role_names)
                if not is_interviewer:
                    return await interaction.response.send_message("この操作を実行する権限がありません。", ephemeral=True)
            else:
                return await interaction.response.send_message("この操作を実行する権限がありません（運営専用）。", ephemeral=True)

        currency_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
        
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
                    "こちらのボタンからルーレットをプレイできます。\n球がどの数字や色に落ちるかを予想します。\n\n"
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
        elif val == "shop":
            embed = discord.Embed(
                title="🛒 ショップ",
                description=(
                    "こちらのボタンからショップを開き、アイテムや役職（ロール）を購入できます。\n\n"
                    "**【購入方法】**\n"
                    "1. 下の「ショップを開く」ボタンを押す\n"
                    "2. セレクトメニューから購入したいアイテムを選択する\n\n"
                    "※対象外のロールや残高が不足している場合は購入できません。"
                ),
                color=discord.Color.gold()
            )
            from cogs.shop import ShopPanelView
            await channel.send(embed=embed, view=ShopPanelView(bot))
            await interaction.response.send_message("✅ ショップパネルを設置しました。", ephemeral=True)
        elif val == "general_inn":
            embed = discord.Embed(title="🛖 一般宿", description="「一般宿」の購入パネルです。ボタンを押して作成してください。", color=discord.Color.blue())
            from cogs.rooms import RoomView
            await channel.send(embed=embed, view=RoomView())
            await interaction.response.send_message("✅ 一般宿パネルを設置しました。", ephemeral=True)
        elif val == "luxury_inn":
            embed = discord.Embed(title="🏰 高級宿", description="「高級宿」の購入パネルです。ボタンを押して作成してください。", color=discord.Color.blue())
            from cogs.rooms import LuxuryRoomView
            await channel.send(embed=embed, view=LuxuryRoomView())
            await interaction.response.send_message("✅ 高級宿パネルを設置しました。", ephemeral=True)
        elif val == "inn_combined":
            embed = discord.Embed(title="🏨 宿の購入パネル", description="一般宿または高級宿を作成できます。", color=discord.Color.blue())
            from cogs.rooms import InnCombinedView
            await channel.send(embed=embed, view=InnCombinedView())
            await interaction.response.send_message("✅ 一般宿・高級宿セットパネルを設置しました。", ephemeral=True)
        elif val == "custom_vc":
            embed = discord.Embed(title="✨ カスタムVC", description="「カスタムVC」の作成パネルです。", color=discord.Color.blue())
            from cogs.rooms import CustomRoomView
            await channel.send(embed=embed, view=CustomRoomView())
            await interaction.response.send_message("✅ カスタムVCパネルを設置しました。", ephemeral=True)
        elif val == "game_vc":
            embed = discord.Embed(title="🎮 ゲームVC", description="ゲームVCを作成できます。", color=discord.Color.blue())
            from cogs.rooms import GameRoomPanelView
            await channel.send(embed=embed, view=GameRoomPanelView())
            await interaction.response.send_message("✅ ゲームVCパネルを設置しました。", ephemeral=True)
        elif val == "gamble_vc":
            embed = discord.Embed(title="🎲 賭博VC", description="賭博VCを作成できます。", color=discord.Color.blue())
            from cogs.rooms import GambleRoomPanelView
            await channel.send(embed=embed, view=GambleRoomPanelView())
            await interaction.response.send_message("✅ 賭博VCパネルを設置しました。", ephemeral=True)
        elif val == "stamp":
            embed = discord.Embed(title="🎨 スタンプ依頼", description="スタンプ制作を依頼できます。", color=discord.Color.blue())
            await channel.send(embed=embed, view=EmblemRequestPanelView())
            await interaction.response.send_message("✅ スタンプ依頼パネルを設置しました。", ephemeral=True)
        elif val == "confession":
            embed = discord.Embed(title="⛪ 告解・相談室", description="告解・相談を依頼できます。", color=discord.Color.blue())
            await channel.send(embed=embed, view=ConfessionRequestPanelView())
            await interaction.response.send_message("✅ 告解・相談室パネルを設置しました。", ephemeral=True)
        elif val == "vc_manage":
            embed = discord.Embed(title="⚙️ VC管理", description="VC名・人数制限を変更できます。", color=discord.Color.blue())
            await channel.send(embed=embed, view=VCRenamePanelView())
            await interaction.response.send_message("✅ VC管理パネルを設置しました。", ephemeral=True)
        elif val == "interview":
            embed = discord.Embed(title="📝 入界手続き", description="新規メンバーの入界手続きを行います。", color=discord.Color.blue())
            await channel.send(embed=embed, view=InterviewPanelView())
            await interaction.response.send_message("✅ 入界手続きパネルを設置しました。", ephemeral=True)
        elif val == "inquiry":
            embed = discord.Embed(
                title="✉️ お問い合わせパネル設定",
                description="お問い合わせチケット作成時に通知（メンション）するロールを選択してください。",
                color=discord.Color.blue()
            )
            await interaction.response.send_message(embed=embed, view=InquirySetupView(), ephemeral=True)
        elif val == "anonymous_chat":
            embed = discord.Embed(title="💬 匿名チャット", description="匿名チャットを送信できます。", color=discord.Color.blue())
            await channel.send(embed=embed, view=AnonymousChatPanelView())
            await interaction.response.send_message("✅ 匿名チャットパネルを設置しました。", ephemeral=True)
        elif val == "custom_ticket":
            embed = discord.Embed(title="🎫 カスタムチケット", description="チケットを作成できます。", color=discord.Color.blue())
            await channel.send(embed=embed, view=CustomTicketPanelView())
            await interaction.response.send_message("✅ カスタムチケットパネルを設置しました。", ephemeral=True)

class PanelSetupView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(PanelSelect())

# --- リアクションロール ---
class StickyTemplateModal(discord.ui.Modal, title="固定テンプレートの作成"):
    content_input = discord.ui.TextInput(
        label="固定するテキスト内容",
        style=discord.TextStyle.paragraph,
        placeholder="メッセージの最後に常に表示される内容を入力してください。",
        max_length=2000,
        required=True
    )
    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        # 以前表示されていた jump_url 等を考慮せず、シンプルなコンテンツの送信
        await database.save_sticky_template(interaction.channel.id, self.content_input.value)
        
        # 新しいメッセージを送信
                # 新しいメッセージを送信
        new_msg = await interaction.channel.send(content=self.content_input.value)
        await database.update_sticky_last_message(interaction.channel.id, new_msg.id, None)
        await interaction.followup.send("✅ 固定テンプレートを設定しました。", ephemeral=True)

class ReactionRoleAdminView(discord.ui.View):
    def __init__(self, target_message: discord.Message):
        super().__init__(timeout=None)
        self.target_message = target_message

    @discord.ui.select(cls=discord.ui.RoleSelect, placeholder="付与するロールを選択してください...")
    async def select_role(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        selected_role = select.values[0]
        await interaction.response.send_message(
            f"🎯 ロール {selected_role.mention} を選択しました。\n\n"
            f"**対象のパネル（上のメッセージ）に、Discord標準の絵文字ピッカーを使って直接リアクションを付けてください！**\n"
            f"（※スタンプ一覧からの検索機能がそのまま使えます。60秒以内にリアクションをお願いします）", 
            ephemeral=True
        )
        
        def check(payload: discord.RawReactionActionEvent):
            return payload.message_id == self.target_message.id and payload.user_id == interaction.user.id

        try:
            payload = await interaction.client.wait_for('raw_reaction_add', timeout=60.0, check=check)
        except asyncio.TimeoutError:
            try:
                await interaction.followup.send("⏳ タイムアウトしました。もう一度メニューからロールを選び直してください。", ephemeral=True)
            except:
                pass
            return
            
        emoji_str = str(payload.emoji)
        try:
            await self.target_message.remove_reaction(payload.emoji, interaction.user)
            await self.target_message.add_reaction(payload.emoji)
        except Exception:
            pass

        await database.add_reaction_role(self.target_message.id, emoji_str, selected_role.id)
        await interaction.followup.send(f"✅ 追加完了！\n絵文字 {emoji_str} にロール {selected_role.mention} を紐付けました！\n続けて別のロールを設定する場合は、上のメニューから再度選択してください。", ephemeral=True)

class CustomRolePanelSetupModal(discord.ui.Modal, title="任意ロールパネル設置"):
    panel_title = discord.ui.TextInput(label="パネルのタイトル", default="ロール付与パネル")
    panel_desc = discord.ui.TextInput(
        label="説明文 (例: 🎮:ゲーム)", 
        style=discord.TextStyle.paragraph, 
        default="以下のリアクションを押してロールを取得してください。"
    )

    async def on_submit(self, interaction: discord.Interaction):
        embed = discord.Embed(title=self.panel_title.value, description=self.panel_desc.value, color=discord.Color.gold())
        msg = await interaction.channel.send(embed=embed)
        await interaction.response.send_message(
            "パネルを設置しました！続けて以下のメニューから、付与するロールと絵文字を紐付けてください。",
            view=ReactionRoleAdminView(msg),
            ephemeral=True
        )

# --- コマンドグループ ---
class AdminGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="運営", description="運営管理者専用コマンド")
        self.bot = bot

    @app_commands.command(name="ボット名変更", description="【運営専用】このサーバー内でのボットの名前（ニックネーム）を変更します。")
    @app_commands.describe(nickname="新しい名前を入力してください。未入力の場合は元の名前に戻ります。")
    @is_admin()
    async def set_bot_nickname(self, interaction: discord.Interaction, nickname: str = None):
        await interaction.response.defer(ephemeral=True)
        try:
            await interaction.guild.me.edit(nick=nickname)
            if nickname:
                await interaction.followup.send(f"✅ ボットの名前を `{nickname}` に変更しました。", ephemeral=True)
            else:
                await interaction.followup.send("✅ ボットの名前を元に戻しました。", ephemeral=True)
        except discord.Forbidden:
            await interaction.followup.send("❌ エラー: ボットの名前を変更する権限がありません。（ボットのロールが一番上にあるか確認してください）", ephemeral=True)
        except Exception as e:
            await interaction.followup.send(f"❌ エラーが発生しました: {e}", ephemeral=True)

    @app_commands.command(name="任意ロールパネル設置", description="【運営専用】ユーザーがリアクションを押すことで自由に付与・剥奪できるロールパネルを設置します")
    @is_admin()
    async def reaction_role_setup(self, interaction: discord.Interaction):
        await interaction.response.send_modal(CustomRolePanelSetupModal())

    @app_commands.command(name="固定テンプレート設定", description="【運営専用】このチャンネルのチャットテンプレートを固定し、常に最新の発言として自動更新します")
    @is_admin()
    async def sticky_template_create(self, interaction: discord.Interaction):
        await interaction.response.send_modal(StickyTemplateModal())

    @app_commands.command(name="固定テンプレート削除", description="【運営専用】このチャンネルに設定されている固定テンプレートを削除します")
    @is_admin()
    async def sticky_template_delete(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        sticky_data = await database.get_sticky_template(interaction.channel.id)
        if not sticky_data:
            return await interaction.followup.send("⚠️ このチャンネルには固定テンプレートが設定されていません。", ephemeral=True)
            
        if sticky_data["last_message_id"]:
            try:
                old_msg = await interaction.channel.fetch_message(sticky_data["last_message_id"])
                await old_msg.delete()
            except:
                pass
                
        await database.remove_sticky_template(interaction.channel.id)
        await interaction.followup.send("🗑️ 固定テンプレートの設定を削除しました。", ephemeral=True)

    @app_commands.command(name="チャット消去", description="【運営・面接官専用】チャンネル内のメッセージを指定された件数分、一括削除します")
    @is_admin_or_interviewer()
    async def clear_chat(self, interaction: discord.Interaction, count: int):
        if count <= 0:
            return await interaction.response.send_message("1以上の件数を指定してください。", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=count)
        await interaction.followup.send(f"🧹 メッセージを {len(deleted)} 件削除しました。", ephemeral=True)

    @app_commands.command(name="手動給与", description="【運営専用】指定したユーザーに通貨を直接発行して付与します")
    @is_admin_or_banker()
    @app_commands.describe(user="付与するユーザー", amount="金額")
    async def manual_issue(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        await interaction.response.defer()
        if amount <= 0:
            return await interaction.followup.send("❌ 1以上の金額を指定してください。", ephemeral=True)
        new_bal = await database.add_balance(interaction.guild.id, user.id, amount)
        cur_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        await interaction.followup.send(f"💵 {user.mention} に **{amount} {cur_name}** を付与しました。")

        # 通貨ログの送信
        embed = discord.Embed(
            title="💵 手動給与 (運営)",
            description="運営による手動給与が行われました。",
            color=discord.Color.green(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
        embed.add_field(name="対象者", value=f"{user.mention} ({user.id})", inline=True)
        embed.add_field(name="付与額", value=f"{amount:,} {cur_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)
        
        if new_bal < 0:
            minus_target_ids = get_setting(self.bot, "MINUS_TARGET_ROLE_IDS") or []
            member_roles = [r.id for r in user.roles]
            if any(rid in minus_target_ids for rid in member_roles):
                await trigger_evaluation_failure(interaction.guild, user, "通貨マイナスになったため", interaction.user, self.bot)

    @app_commands.command(name="手動没収", description="【運営専用】指定したユーザーから通貨を直接没収（減額）します")
    @is_admin_or_banker()
    @app_commands.describe(user="没収するユーザー", amount="金額")
    async def manual_confiscate(self, interaction: discord.Interaction, user: discord.Member, amount: int):
        await interaction.response.defer()
        if amount <= 0:
            await interaction.followup.send("❌ 1以上の金額を指定してください。", ephemeral=True)
            return

        await database.remove_balance(interaction.guild.id, user.id, amount, force=True)
        new_bal = await database.get_balance(interaction.guild.id, user.id)
        cur_name = get_setting(self.bot, "CURRENCY_NAME") or "コイン"
        
        await interaction.followup.send(f"💸 {user.mention} から **{amount} {cur_name}** を没収しました。（現在の残高: **{new_bal} {cur_name}**）")

        # 通貨ログの送信
        embed = discord.Embed(
            title="📉 手動没収 (運営)",
            description="運営による手動没収が行われました。",
            color=discord.Color.red(),
            timestamp=discord.utils.utcnow()
        )
        embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
        embed.add_field(name="対象者", value=f"{user.mention} ({user.id})", inline=True)
        embed.add_field(name="没収額", value=f"{amount:,} {cur_name}", inline=True)
        embed.add_field(name="新残高", value=f"{new_bal:,} {cur_name}", inline=True)
        await send_log(self.bot, interaction.guild, "currency", embed)
        
        if new_bal < 0:
            minus_target_ids = get_setting(self.bot, "MINUS_TARGET_ROLE_IDS") or []
            member_roles = [r.id for r in user.roles]
            if any(rid in minus_target_ids for rid in member_roles):
                await trigger_evaluation_failure(interaction.guild, user, "通貨マイナスになったため", interaction.user, self.bot)

    @app_commands.command(name="一括初期給与", description="【運営専用】全員（サーバー全体）に一括で初期給与（30000コイン）を受け取っていない人を含めて一律で発行します")
    @app_commands.describe(preview="Trueの場合、実際には付与せずに対象者の一覧を表示します（デフォルト: True）")
    @is_admin()
    async def batch_initial_issue(self, interaction: discord.Interaction, preview: bool = True):
        await interaction.response.defer(ephemeral=True)
        guild = interaction.guild
        bot = self.bot
        
        try:
            # 1. メンバーを API 経由で確実にフェッチする（guild.chunk() のフリーズ回避）
            members = []
            async for member in guild.fetch_members(limit=None):
                if not member.bot:
                    members.append(member)
                
            initial_coins = get_setting(bot, "INITIAL_COINS") or 30000
            cur_name = get_setting(bot, "CURRENCY_NAME") or "コイン"
            
            # --- プレビューモードの場合 ---
            if preview:
                issue_list_text = [f"- {m.mention} (ID: {m.id})" for m in members[:10]]
                if len(members) > 10:
                    issue_list_text.append(f"他 {len(members) - 10} 名...")

                embed = discord.Embed(
                    title="📋 【プレビュー】一括初期給与 対象者一覧",
                    description="実際には付与を行っていません。内容に問題がなければ、`/一括初期給与 preview:False` で実行してください。",
                    color=discord.Color.blue(),
                    timestamp=discord.utils.utcnow()
                )
                embed.add_field(
                    name=f"🪙 全員一括発行 対象者 ({len(members)} 名)",
                    value="\n".join(issue_list_text) if members else "対象者なし",
                    inline=False
                )
                embed.set_footer(text=f"※実行すると、全員に一律 {initial_coins:,} {cur_name} が加算され、初期給与済みにマークされます。")
                return await interaction.followup.send(embed=embed, ephemeral=True)

            # --- 実行モード (preview=False) の場合 ---
            issued_count = 0
            issued_members_log = []
            
            # 全員に初期給与を付与してフラグを TRUE にマークする
            for member in members:
                await database.add_balance(interaction.guild.id, member.id, initial_coins)
                await database.mark_initial_issued(interaction.guild_id, member.id)
                issued_count += 1
                issued_members_log.append(f"{member.mention} (ID: {member.id})")
                    
            await interaction.followup.send(
                f"✅ 処理が完了しました！\n"
                f"- 全員一括発行: {issued_count} 名に {initial_coins:,} {cur_name} を付与しました。",
                ephemeral=True
            )

            if issued_count > 0:
                embed = discord.Embed(
                    title="🪙 一括初期給与 (全員対象・運営)",
                    description="運営による一括初期給与が実行されました。",
                    color=discord.Color.gold(),
                    timestamp=discord.utils.utcnow()
                )
                embed.add_field(name="実行者", value=f"{interaction.user.mention} ({interaction.user.id})", inline=True)
                embed.add_field(name="発行人数", value=f"{issued_count} 名", inline=True)
                embed.add_field(name="発行総額", value=f"{issued_count * initial_coins:,} {cur_name}", inline=True)
                
                members_text = "\n".join(issued_members_log[:20])
                if len(issued_members_log) > 20:
                    members_text += f"\n他 {len(issued_members_log) - 20} 名..."
                embed.add_field(name="対象メンバー一覧 (最大20名)", value=members_text, inline=False)
                
                await send_log(self.bot, interaction.guild, "currency", embed)
                
        except Exception as e:
            # エラーをキャッチしてDiscordに送信する（フリーズ回避）
            import traceback
            tb = traceback.format_exc()
            print(f"[ERROR] batch_initial_issue: {e}\n{tb}")
            await interaction.followup.send(f"❌ エラーが発生しました: `{e}`\nBotのログまたはコンソールを確認してください。", ephemeral=True)

    @app_commands.command(name="デバッグ用vc強制退室", description="【運営専用】指定したユーザーのVC接続セッションを強制的に終了させます（時間測定 of バグ修正用）")
    @is_admin()
    @app_commands.describe(user="強制退室させるユーザー")
    async def debug_vc(self, interaction: discord.Interaction, user: discord.Member):
        await interaction.response.defer(ephemeral=True)
        session = self.bot.vc_sessions.pop(user.id, None)
        if session:
            await interaction.followup.send(f"✅ {user.display_name} のVCセッションを破棄しました。", ephemeral=True)
        else:
            await interaction.followup.send(f"⚠️ {user.display_name} はVCセッションを保持していませんでした。", ephemeral=True)

# --- Cogの定義 ---
class DowngradeGroup(app_commands.Group):
    def __init__(self, bot):
        super().__init__(name="評価落ち", description="評価落ちに関するコマンド")
        self.bot = bot

    @app_commands.command(name="実行", description="【運営専用】指定したユーザーを評価落ちさせます")
    @app_commands.describe(target="対象メンバー", reason="評価落ちの理由")
    async def downgrade_execute(self, interaction: discord.Interaction, target: discord.Member, reason: str):
        if not has_admin_role(self.bot, interaction.user):
            return await interaction.response.send_message("このコマンドを実行する権限がありません（運営専用）。", ephemeral=True)
            
        await interaction.response.defer(ephemeral=True)
        await trigger_evaluation_failure(interaction.guild, target, reason, interaction.user, self.bot)
        await interaction.followup.send(f"✅ {target.mention} を評価落ちさせました（理由: {reason}）。", ephemeral=True)

class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(PanelSetupView())
        
        # コマンドグループの追加
        self.bot.tree.add_command(AdminGroup(self.bot))
        self.bot.tree.add_command(DowngradeGroup(self.bot))

        # 招待キャッシュの初期化 (コグリロード時の対応)
        for guild in self.bot.guilds:
            self.bot.loop.create_task(self.update_invite_cache(guild))

    async def cog_unload(self):
        self.bot.tree.remove_command("運営")
        self.bot.tree.remove_command("評価落ち")

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot:
            return

        # 荒らし対策: 連続同じメッセージ、@everyone/メンションスパム、招待URL連投
        if isinstance(message.author, discord.Member):
            should_check_spam = True
            # 適用対象および免除ロールの確認
            guild = message.guild
            if guild:
                cfg = self.bot.get_antigrief_config(guild.id)
                
                # 免除ロールチェック
                exempt_roles = cfg.get("exempt_roles", set())
                author_role_ids = {role.id for role in message.author.roles}
                if exempt_roles & author_role_ids:
                    should_check_spam = False
                
                # 対象カテゴリー/チャンネルチェック
                if should_check_spam:
                    target_categories = cfg.get("categories", set())
                    target_channels = cfg.get("channels", set())
                    if target_categories or target_channels:
                        in_target_channel = message.channel.id in target_channels
                        in_target_category = message.channel.category and message.channel.category.id in target_categories
                        if not in_target_channel and not in_target_category:
                            should_check_spam = False
            else:
                should_check_spam = False

            if should_check_spam:
                user_id = message.author.id
                now = datetime.datetime.now(JST)

                if not hasattr(self.bot, 'spam_tracker'):
                    self.bot.spam_tracker = {}

                user_tracker = self.bot.spam_tracker.setdefault(user_id, {
                    "last_content": None,
                    "content_count": 0,
                    "everyone_count": 0,
                    "invite_count": 0,
                    "mention_count": 0,
                    "last_time": now
                })

                # 3秒以上経過していればリセット
                if (now - user_tracker["last_time"]).total_seconds() > 3:
                    user_tracker["content_count"] = 0
                    user_tracker["everyone_count"] = 0
                    user_tracker["invite_count"] = 0
                    user_tracker["mention_count"] = 0

                user_tracker["last_time"] = now
                timeout_reason = None

                # 同じメッセージの連続検知 (内容が存在する場合)
                if message.content and message.content == user_tracker["last_content"]:
                    user_tracker["content_count"] += 1
                    if user_tracker["content_count"] >= 3:
                        timeout_reason = "連続で同じメッセージを送信したため"
                else:
                    user_tracker["last_content"] = message.content
                    user_tracker["content_count"] = 1

                # @everyone or @here の検知 (他のメッセージを挟んでも3秒以内の累計でカウント)
                if message.mention_everyone:
                    user_tracker["everyone_count"] += 1
                    if user_tracker["everyone_count"] >= 5:
                        timeout_reason = "短時間に@everyoneメンションを複数回送信したため"

                # Discord招待URLの検知 (discord.gg/ などの招待リンク)
                import re
                DISCORD_INVITE_PATTERN = re.compile(
                    r'(?:https?://)?(?:www\.)?(?:discord\.gg|discord\.com/invite|discordapp\.com/invite)/[a-zA-Z0-9-]+',
                    re.IGNORECASE
                )
                if DISCORD_INVITE_PATTERN.search(message.content):
                    user_tracker["invite_count"] += 1
                    if user_tracker["invite_count"] >= 5:
                        timeout_reason = "連続でDiscordの招待リンクを送信したため"

                # メンションスパムの検知 (ユーザーメンション + 役職メンション)
                msg_mentions = len(message.mentions) + len(message.role_mentions)
                if msg_mentions >= 5:
                    timeout_reason = "1つのメッセージで大量のメンションを送信したため"
                elif msg_mentions > 0:
                    user_tracker["mention_count"] += msg_mentions
                    if user_tracker["mention_count"] >= 10:
                        timeout_reason = "短時間に連続してメンションを送信したため"

                if timeout_reason:
                    try:
                        # トリガーとなったメッセージの自動削除を試みる
                        try:
                            await message.delete()
                        except discord.Forbidden:
                            print(f"[WARNING] Cannot delete message. Missing permissions.")
                        except Exception as de:
                            print(f"[ERROR] Message deletion failed: {de}")

                        timeout_duration = datetime.timedelta(hours=1)
                        await message.author.timeout(timeout_duration, reason=timeout_reason)
                        await message.channel.send(f"🚨 {message.author.mention} がスパム行為（{timeout_reason}）によりタイムアウトされました。")
                        
                        user_tracker["content_count"] = 0
                        user_tracker["everyone_count"] = 0
                        user_tracker["invite_count"] = 0
                        user_tracker["mention_count"] = 0
                        return # スパムなら処理終了
                    except Exception as e:
                        print(f"[ERROR] Timeout failed for {message.author.display_name}: {e}")




    # --- 招待キャッシュ同期リスナー ---
    @commands.Cog.listener()
    async def on_ready(self):
        await apply_bot_nicknames(self.bot)
        print("[Bot Nicknames] Initialized bot nicknames for all guilds.")


    @commands.command(name="sync")
    @commands.has_permissions(administrator=True)
    async def sync_commands(self, ctx):
        await ctx.send("コマンドを同期しています...")
        try:
            self.bot.tree.copy_global_to(guild=ctx.guild)
            synced = await self.bot.tree.sync(guild=ctx.guild)
            await ctx.send(f"このサーバーに {len(synced)} 個のコマンドを同期しました！\n※これで即座にDiscordへ反映されるはずです。")
        except Exception as e:
            await ctx.send(f"同期中にエラーが発生しました: {e}")

async def setup(bot):
    await bot.add_cog(Admin(bot))
