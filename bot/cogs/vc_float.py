import datetime
import random

import discord
from discord.ext import commands, tasks

import database
from helpers import JST, get_setting, send_log, _channel_in_scope

# VC浮上報酬: 対象VCに一定時間いると、ガチャ形式で報酬を抽選してDMで通知する。
# 報酬の種類: coin（通貨） / none（ハズレ）

DEFAULT_SETTINGS = {
    "is_enabled": False,
    "is_whitelist_mode": True,
    "channels": set(),
    "categories": set(),
    "required_minutes": 30,
    "daily_limit": 1,
    "reset_on_leave": False,
    "exclude_muted": False,
    "exclude_deafened": False,
    "rewards": [],
}

_ensured_pools = set()


async def ensure_vc_float_schema(guild_id: int):
    p = await database.get_pool(guild_id)
    if id(p) in _ensured_pools:
        return p
    async with p.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS vc_float_settings (
                guild_id BIGINT PRIMARY KEY,
                is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                is_whitelist_mode BOOLEAN NOT NULL DEFAULT TRUE,
                channel_ids BIGINT[] NOT NULL DEFAULT '{}',
                category_ids BIGINT[] NOT NULL DEFAULT '{}',
                required_minutes INT NOT NULL DEFAULT 30,
                daily_limit INT NOT NULL DEFAULT 1,
                reset_on_leave BOOLEAN NOT NULL DEFAULT FALSE,
                exclude_muted BOOLEAN NOT NULL DEFAULT FALSE,
                exclude_deafened BOOLEAN NOT NULL DEFAULT FALSE
            )
        ''')
        for col in ("exclude_muted", "exclude_deafened"):
            await conn.execute(f'ALTER TABLE vc_float_settings ADD COLUMN IF NOT EXISTS {col} BOOLEAN NOT NULL DEFAULT FALSE')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS vc_float_rewards (
                id SERIAL PRIMARY KEY,
                guild_id BIGINT NOT NULL,
                reward_type TEXT NOT NULL DEFAULT 'coin',
                label TEXT NOT NULL DEFAULT '',
                amount INT NOT NULL DEFAULT 0,
                weight DOUBLE PRECISION NOT NULL DEFAULT 1
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS vc_float_users (
                guild_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                progress_minutes INT NOT NULL DEFAULT 0,
                claim_date DATE,
                claim_count INT NOT NULL DEFAULT 0,
                PRIMARY KEY (guild_id, user_id)
            )
        ''')
    _ensured_pools.add(id(p))
    return p


async def load_vc_float_settings(guild_id: int) -> dict:
    p = await ensure_vc_float_schema(guild_id)
    async with p.acquire() as conn:
        row = await conn.fetchrow('SELECT * FROM vc_float_settings WHERE guild_id = $1', guild_id)
        reward_rows = await conn.fetch(
            'SELECT reward_type, label, amount, weight FROM vc_float_rewards WHERE guild_id = $1 ORDER BY id ASC',
            guild_id,
        )
    if not row:
        return dict(DEFAULT_SETTINGS)
    return {
        "is_enabled": bool(row["is_enabled"]),
        "is_whitelist_mode": row["is_whitelist_mode"] is not False,
        "channels": set(row["channel_ids"] or []),
        "categories": set(row["category_ids"] or []),
        "required_minutes": max(1, row["required_minutes"] or 30),
        "daily_limit": max(0, row["daily_limit"] or 0),
        "reset_on_leave": bool(row["reset_on_leave"]),
        "exclude_muted": bool(row["exclude_muted"]),
        "exclude_deafened": bool(row["exclude_deafened"]),
        "rewards": [
            {
                "reward_type": r["reward_type"],
                "label": r["label"] or "",
                "amount": int(r["amount"] or 0),
                "weight": float(r["weight"] or 0),
            }
            for r in reward_rows
            if (r["weight"] or 0) > 0
        ],
    }


def draw_reward(rewards: list[dict]) -> dict | None:
    total = sum(r["weight"] for r in rewards)
    if total <= 0:
        return None
    roll = random.uniform(0, total)
    acc = 0.0
    for r in rewards:
        acc += r["weight"]
        if roll <= acc:
            return r
    return rewards[-1]


class VCFloat(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.settings_cache: dict[int, dict] = {}
        self.vc_float_loop.start()

    def cog_unload(self):
        self.vc_float_loop.cancel()

    async def get_settings(self, guild_id: int) -> dict:
        if guild_id not in self.settings_cache:
            self.settings_cache[guild_id] = await load_vc_float_settings(guild_id)
        return self.settings_cache[guild_id]

    async def reload_settings(self, guild_id: int):
        self.settings_cache[guild_id] = await load_vc_float_settings(guild_id)

    def is_eligible_channel(self, cfg: dict, channel) -> bool:
        if channel.guild.afk_channel and channel.id == channel.guild.afk_channel.id:
            return False
        if cfg["is_whitelist_mode"]:
            return _channel_in_scope(channel, cfg["channels"], cfg["categories"], set(), set())
        return _channel_in_scope(channel, set(), set(), cfg["channels"], cfg["categories"])

    def is_counted_member(self, cfg: dict, member: discord.Member) -> bool:
        if member.bot:
            return False
        vs = member.voice
        if not vs:
            return True
        deafened = vs.self_deaf or vs.deaf
        # スピーカーミュートすると自動でマイクもミュートになるため、
        # 「ミュート」はスピーカーミュートしていない状態でのマイクミュートだけを指す
        muted = (vs.self_mute or vs.mute) and not deafened
        if cfg["exclude_deafened"] and deafened:
            return False
        if cfg["exclude_muted"] and muted:
            return False
        return True

    @tasks.loop(minutes=1)
    async def vc_float_loop(self):
        today = datetime.datetime.now(JST).date()
        for guild in self.bot.guilds:
            try:
                cfg = await self.get_settings(guild.id)
                if not cfg["is_enabled"] or not cfg["rewards"]:
                    continue
                members = [
                    m
                    for vc in list(guild.voice_channels) + list(guild.stage_channels)
                    if self.is_eligible_channel(cfg, vc)
                    for m in vc.members
                    if self.is_counted_member(cfg, m)
                ]
                if not members:
                    continue
                await self.tick_guild(guild, cfg, members, today)
            except Exception as e:
                print(f"[ERROR] vc_float_loop ({guild.id}): {e}")

    async def tick_guild(self, guild: discord.Guild, cfg: dict, members: list, today: datetime.date):
        p = await ensure_vc_float_schema(guild.id)
        achieved = []
        async with p.acquire() as conn:
            for member in members:
                row = await conn.fetchrow(
                    'SELECT progress_minutes, claim_date, claim_count FROM vc_float_users WHERE guild_id = $1 AND user_id = $2',
                    guild.id, member.id,
                )
                progress = row["progress_minutes"] if row else 0
                count = row["claim_count"] if row and row["claim_date"] == today else 0

                # 本日の上限に達している人はカウントしない
                if cfg["daily_limit"] > 0 and count >= cfg["daily_limit"]:
                    continue

                progress += 1
                if progress >= cfg["required_minutes"]:
                    progress = 0
                    count += 1
                    achieved.append((member, count))

                await conn.execute(
                    '''INSERT INTO vc_float_users (guild_id, user_id, progress_minutes, claim_date, claim_count)
                       VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (guild_id, user_id) DO UPDATE SET
                         progress_minutes = EXCLUDED.progress_minutes,
                         claim_date = EXCLUDED.claim_date,
                         claim_count = EXCLUDED.claim_count''',
                    guild.id, member.id, progress, today, count,
                )

        for member, count in achieved:
            try:
                await self.grant_reward(guild, cfg, member, count)
            except Exception as e:
                print(f"[ERROR] vc_float grant_reward ({guild.id}/{member.id}): {e}")

    async def grant_reward(self, guild: discord.Guild, cfg: dict, member: discord.Member, count: int):
        reward = draw_reward(cfg["rewards"])
        if reward is None:
            return

        currency_name = get_setting(self.bot, "CURRENCY_NAME", guild.id) or "コイン"
        is_win = reward["reward_type"] == "coin" and reward["amount"] > 0
        new_balance = None
        if is_win:
            new_balance = await database.add_balance(guild.id, member.id, reward["amount"])

        limit = cfg["daily_limit"]
        remaining_txt = f"本日の残り回数: **{limit - count}回**" if limit > 0 else "本日の回数制限: なし"
        label = reward["label"]

        if is_win:
            title = "🎉 VC浮上報酬 - 当たり！"
            result_txt = f"**{reward['amount']:,} {currency_name}** を獲得しました！"
            if label:
                result_txt = f"【{label}】\n" + result_txt
            color = discord.Color.gold()
        else:
            title = "💨 VC浮上報酬 - ハズレ…"
            result_txt = f"【{label}】\n残念、ハズレでした…" if label else "残念、ハズレでした…"
            color = discord.Color.light_grey()

        dm_embed = discord.Embed(
            title=title,
            description=(
                f"**{guild.name}** のVCに {cfg['required_minutes']}分 浮上したので報酬ガチャを引きました！\n\n"
                f"{result_txt}"
            ),
            color=color,
            timestamp=discord.utils.utcnow(),
        )
        if new_balance is not None:
            dm_embed.add_field(name="現在の残高", value=f"{new_balance:,} {currency_name}", inline=True)
        dm_embed.add_field(name="回数", value=remaining_txt, inline=True)
        try:
            await member.send(embed=dm_embed)
        except (discord.Forbidden, discord.HTTPException):
            pass  # DMを閉じている人には送れないが、報酬自体は付与済み

        log_embed = discord.Embed(
            title="🎰 VC浮上報酬",
            description=f"{member.mention} がVC浮上報酬ガチャを引きました。",
            color=color,
            timestamp=discord.utils.utcnow(),
        )
        log_embed.add_field(name="対象ユーザー", value=f"{member.mention} ({member.id})", inline=False)
        log_embed.add_field(
            name="結果",
            value=(f"{label} / " if label else "") + (f"{reward['amount']:,} {currency_name}" if is_win else "ハズレ"),
            inline=True,
        )
        if new_balance is not None:
            log_embed.add_field(name="付与後残高", value=f"{new_balance:,} {currency_name}", inline=True)
        log_embed.add_field(name="本日の回数", value=f"{count}回目" + (f" / {limit}回" if limit > 0 else ""), inline=True)
        await send_log(self.bot, guild, "currency", log_embed)

    @vc_float_loop.before_loop
    async def before_vc_float_loop(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_voice_state_update(self, member, before, after):
        # 「退出したら進捗リセット」がONなら、VCから完全に抜けた時点で進捗を0に戻す
        try:
            if member.bot or before.channel is None or after.channel is not None:
                return
            cfg = await self.get_settings(member.guild.id)
            if not cfg["is_enabled"] or not cfg["reset_on_leave"]:
                return
            p = await ensure_vc_float_schema(member.guild.id)
            async with p.acquire() as conn:
                await conn.execute(
                    'UPDATE vc_float_users SET progress_minutes = 0 WHERE guild_id = $1 AND user_id = $2',
                    member.guild.id, member.id,
                )
        except Exception as e:
            print(f"[ERROR] vc_float on_voice_state_update: {e}")


async def setup(bot):
    await bot.add_cog(VCFloat(bot))
