import type { Pool } from 'pg';

/**
 * アクティビティ・Webで遊べるカジノの設定。
 * 確率・倍率・上限・手数料は Bot（cogs/gambling.py, helpers.py の DEFAULT_SETTINGS）と同じキー・同じ既定値を使う。
 * どのゲームをWebで遊べるかは、管理ダッシュボード「Webアクティビティ設定」の WEB_GAMES_ENABLED で決める。
 */
export const WEB_GAMES = ['coinflip', 'slot', 'roulette', 'blackjack', 'chinchiro', 'horse'] as const;
export type WebGame = (typeof WEB_GAMES)[number];

export const WEB_GAME_LABEL: Record<WebGame, string> = {
  coinflip: 'コイントス',
  slot: 'スロット',
  roulette: 'ルーレット',
  blackjack: 'ブラックジャック',
  chinchiro: 'チンチロリン',
  horse: '競馬',
};

export const WEB_GAMES_SETTING_KEY = 'WEB_GAMES_ENABLED';

export function isWebGame(value: unknown): value is WebGame {
  return typeof value === 'string' && (WEB_GAMES as readonly string[]).includes(value);
}

/** 保存値（JSON文字列 or "0.475" のような素の文字列）を解釈する */
function parseValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 未設定（null）だけ既定値にする（Python の `if x is None: x = d`） */
const orNull = (value: unknown, d: number) => toNumber(value) ?? d;
/** 0 も既定値にする（Python の `x or d`） */
const orFalsy = (value: unknown, d: number) => toNumber(value) || d;

export interface CasinoSettings {
  currencyName: string;
  enabled: Record<WebGame, boolean>;
  /** 戦績を見せるか（Bot と同じく、共通 GAMBLE_SHOW_STATS とゲーム別の両方がOFFでないとき） */
  showStats: Record<WebGame, boolean>;
  maxBet: number;
  maxPlays: number; // 0 = 無制限
  dailyLimit: number; // 0 = 無制限
  taxEnabled: boolean;
  taxRate: number;
  coinflip: { win: number; lose: number; mul: number };
  slot: { p7: number; pStar: number; pThree: number; pTwo: number; mul7: number; mulStar: number; mulThree: number; mulTwo: number };
  roulette: { rate2: number; rate3: number; rate36: number; mul2: number; mul3: number; mul36: number };
  blackjack: { normal: number; bj: number; draw: number; lose: number; mulNormal: number; mulBj: number };
  chinchiro: {
    pinzoro: number; arashi: number; shigoro: number; normal: number; hifumi: number; lose: number;
    mulPinzoro: number; mulArashi: number; mulShigoro: number; mulHifumi: number; mulNormal: number;
  };
  horse: { rateTan: number; rateFuku: number; mulTan: number; mulFuku: number };
}

export function parseEnabledGames(raw: unknown): Record<WebGame, boolean> {
  const value = parseValue(raw);
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  // 未設定のゲームはOFF（管理者がONにしたものだけ遊べる）
  return Object.fromEntries(WEB_GAMES.map((g) => [g, obj[g] === true || obj[g] === 'true'])) as Record<WebGame, boolean>;
}

export async function loadCasinoSettings(pool: Pool, guildId: string): Promise<CasinoSettings> {
  const s: Record<string, unknown> = {};
  try {
    const res = await pool.query(
      "SELECT setting_key, setting_value FROM bot_settings WHERE guild_id = $1 AND (setting_key LIKE 'GAMBLE\\_%' OR setting_key IN ('CURRENCY_NAME', $2))",
      [guildId, WEB_GAMES_SETTING_KEY]
    );
    for (const row of res.rows) s[row.setting_key] = row.setting_value;
  } catch (e: any) {
    if (e?.code !== '42P01') throw e; // bot_settings が無い＝全部既定値
  }
  const v = (key: string) => parseValue(s[key]);
  const bool = (key: string, d: boolean) => {
    const x = v(key);
    if (x === null || x === undefined) return d;
    return x === true || x === 'true';
  };
  const currency = v('CURRENCY_NAME');
  // Bot（show_user_game_stats）は False のときだけ隠す
  const isOff = (x: unknown) => x === false || x === 'false';

  return {
    currencyName: typeof currency === 'string' || typeof currency === 'number' ? String(currency) || 'コイン' : 'コイン',
    enabled: parseEnabledGames(s[WEB_GAMES_SETTING_KEY]),
    showStats: Object.fromEntries(
      WEB_GAMES.map((g) => [g, !isOff(v('GAMBLE_SHOW_STATS')) && !isOff(v(`GAMBLE_${g.toUpperCase()}_SHOW_STATS`))])
    ) as Record<WebGame, boolean>,
    maxBet: Math.floor(orFalsy(v('GAMBLE_MAX_BET'), 100000)),
    maxPlays: Math.floor(orNull(v('GAMBLE_MAX_PLAYS'), 10)),
    dailyLimit: Math.floor(orNull(v('GAMBLE_DAILY_LIMIT'), 0)),
    taxEnabled: bool('GAMBLE_TAX_ENABLED', false),
    taxRate: orNull(v('GAMBLE_TAX_RATE'), 0.05),
    coinflip: {
      win: orNull(v('GAMBLE_COINFLIP_RATE_WIN'), 0.475),
      lose: orNull(v('GAMBLE_COINFLIP_RATE_LOSE'), 0.525),
      mul: orNull(v('GAMBLE_COINFLIP_MUL'), 2.0),
    },
    slot: {
      p7: orNull(v('GAMBLE_SLOT_RATE_7'), 0.002),
      pStar: orNull(v('GAMBLE_SLOT_RATE_STAR'), 0.002),
      pThree: orNull(v('GAMBLE_SLOT_RATE_THREE'), 0.012),
      pTwo: orNull(v('GAMBLE_SLOT_RATE_TWO'), 0.328),
      mul7: orFalsy(v('GAMBLE_SLOT_MUL_7'), 10.0),
      mulStar: orFalsy(v('GAMBLE_SLOT_MUL_STAR'), 5.0),
      mulThree: orFalsy(v('GAMBLE_SLOT_MUL_THREE'), 3.0),
      mulTwo: orFalsy(v('GAMBLE_SLOT_MUL_TWO'), 1.5),
    },
    roulette: {
      rate2: orNull(v('GAMBLE_ROULETTE_WIN_RATE_2X'), 0.475),
      rate3: orNull(v('GAMBLE_ROULETTE_WIN_RATE_3X'), 0.316),
      rate36: orNull(v('GAMBLE_ROULETTE_WIN_RATE_36X'), 0.0264),
      mul2: orNull(v('GAMBLE_ROULETTE_MUL_2X'), 2.0),
      mul3: orNull(v('GAMBLE_ROULETTE_MUL_3X'), 3.0),
      mul36: orNull(v('GAMBLE_ROULETTE_MUL_36X'), 36.0),
    },
    blackjack: {
      normal: orFalsy(v('GAMBLE_BLACKJACK_RATE_NORMAL_WIN'), 0.38),
      bj: orFalsy(v('GAMBLE_BLACKJACK_RATE_BJ_WIN'), 0.05),
      draw: orFalsy(v('GAMBLE_BLACKJACK_RATE_DRAW'), 0.09),
      lose: orFalsy(v('GAMBLE_BLACKJACK_RATE_LOSE'), 0.48),
      mulNormal: orFalsy(v('GAMBLE_BLACKJACK_MUL_NORMAL'), 2.0),
      mulBj: orFalsy(v('GAMBLE_BLACKJACK_MUL_BJ'), 2.5),
    },
    chinchiro: {
      pinzoro: orNull(v('GAMBLE_CHINCHIRO_RATE_PINZORO'), 0.02),
      arashi: orNull(v('GAMBLE_CHINCHIRO_RATE_ARASHI'), 0.05),
      shigoro: orNull(v('GAMBLE_CHINCHIRO_RATE_SHIGORO'), 0.08),
      normal: orNull(v('GAMBLE_CHINCHIRO_RATE_NORMAL_WIN'), 0.295),
      hifumi: orNull(v('GAMBLE_CHINCHIRO_RATE_HIFUMI'), 0.11),
      lose: orNull(v('GAMBLE_CHINCHIRO_RATE_LOSE'), 0.445),
      mulPinzoro: orFalsy(v('GAMBLE_CHINCHIRO_MUL_PINZORO'), 5.0),
      mulArashi: orFalsy(v('GAMBLE_CHINCHIRO_MUL_ARASHI'), 3.0),
      mulShigoro: orFalsy(v('GAMBLE_CHINCHIRO_MUL_SHIGORO'), 2.0),
      mulHifumi: orFalsy(v('GAMBLE_CHINCHIRO_MUL_HIFUMI'), -2.0),
      mulNormal: orFalsy(v('GAMBLE_CHINCHIRO_MUL_NORMAL'), 1.0),
    },
    horse: {
      rateTan: orNull(v('GAMBLE_HORSE_RATE_WIN_TAN'), 0.2),
      rateFuku: orNull(v('GAMBLE_HORSE_RATE_WIN_FUKU'), 0.6),
      mulTan: orNull(v('GAMBLE_HORSE_MUL_TAN'), 4.5),
      mulFuku: orNull(v('GAMBLE_HORSE_MUL_FUKU'), 1.5),
    },
  };
}

/** Bot と同じ手数料計算（純利益に対して課税）。chinchiro だけは獲得額そのものに課税する */
export function applyTax(settings: CasinoSettings, bet: number, winAmount: number): { payout: number; tax: number } {
  if (!settings.taxEnabled) return { payout: winAmount, tax: 0 };
  const tax = Math.trunc((winAmount - bet) * settings.taxRate);
  return { payout: winAmount - tax, tax };
}
