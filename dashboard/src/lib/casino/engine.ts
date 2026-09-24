import { randomInt } from 'crypto';
import type { CasinoSettings } from './settings';

/**
 * カジノの各ゲームの判定。cogs/gambling.py と同じ抽選・同じ倍率で結果を決める。
 * 結果は必ずサーバーで決め、ブラウザからは選択（表/裏・賭け先など）だけを受け取る。
 */

/** 0 以上 1 未満の乱数（Python の random.random() 相当） */
export function random(): number {
  return randomInt(0, 2 ** 47) / 2 ** 47; // randomInt の範囲は 2^48 未満まで
}
const randint = (min: number, max: number) => randomInt(min, max + 1); // 両端を含む
const choice = <T,>(arr: T[]): T => arr[randomInt(0, arr.length)];
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------- コイントス ----------------

export type CoinSide = 'heads' | 'tails';

export function playCoinflip(s: CasinoSettings, choiceSide: CoinSide) {
  let total = s.coinflip.win + s.coinflip.lose;
  if (total <= 0) total = 1;
  const win = random() < s.coinflip.win / total;
  const result: CoinSide = win ? choiceSide : choiceSide === 'heads' ? 'tails' : 'heads';
  return { win, result, mul: s.coinflip.mul };
}

// ---------------- スロット ----------------

const SLOT_SYMBOLS = ['🍒', '🍋', '🍉', '🔔', '⭐', '7️⃣', '💎', '🍀'];
const SLOT_OTHERS = ['🍒', '🍋', '🍉', '🔔', '💎', '🍀'];

export function playSlot(s: CasinoSettings) {
  let { p7, pStar, pThree, pTwo } = s.slot;
  const sum = p7 + pStar + pThree + pTwo;
  if (sum > 1) {
    p7 /= sum;
    pStar /= sum;
    pThree /= sum;
    pTwo /= sum;
  }
  const r = random();
  let reels: string[];
  if (r < p7) reels = ['7️⃣', '7️⃣', '7️⃣'];
  else if (r < p7 + pStar) reels = ['⭐', '⭐', '⭐'];
  else if (r < p7 + pStar + pThree) {
    const c = choice(SLOT_OTHERS);
    reels = [c, c, c];
  } else if (r < p7 + pStar + pThree + pTwo) {
    const c1 = choice(SLOT_SYMBOLS);
    const c2 = choice(SLOT_SYMBOLS.filter((e) => e !== c1));
    reels = shuffle([c1, c1, c2]);
  } else {
    reels = shuffle([...SLOT_SYMBOLS]).slice(0, 3);
  }

  const triple = reels[0] === reels[1] && reels[1] === reels[2];
  let mul = 0;
  let kind: 'slot_7' | 'slot_star' | 'slot_three' | 'slot_two' | null = null;
  if (triple && reels[0] === '7️⃣') [mul, kind] = [s.slot.mul7, 'slot_7'];
  else if (triple && reels[0] === '⭐') [mul, kind] = [s.slot.mulStar, 'slot_star'];
  else if (triple) [mul, kind] = [s.slot.mulThree, 'slot_three'];
  else if (new Set(reels).size < 3) [mul, kind] = [s.slot.mulTwo, 'slot_two'];
  return { reels, mul, kind };
}

// ---------------- ルーレット ----------------

export const ROULETTE_BET_TYPES = ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'number'] as const;
export type RouletteBetType = (typeof ROULETTE_BET_TYPES)[number];
export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BLACK_NUMBERS = new Set([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35]);

export const ROULETTE_BET_LABEL: Record<RouletteBetType, string> = {
  red: '🔴 赤',
  black: '⚫ 黒',
  even: '🔢 偶数',
  odd: '🔣 奇数',
  low: '⬇️ ロー (1-18)',
  high: '⬆️ ハイ (19-36)',
  dozen1: '1️⃣ 第1ダズン (1-12)',
  dozen2: '2️⃣ 第2ダズン (13-24)',
  dozen3: '3️⃣ 第3ダズン (25-36)',
  number: '🎯 数字1点賭け',
};

/** helpers.check_roulette_win と同じ */
export function rouletteWins(n: number, type: RouletteBetType, target: number | null): boolean {
  if (n === 0) return type === 'number' && target === 0;
  switch (type) {
    case 'red': return RED_NUMBERS.has(n);
    case 'black': return BLACK_NUMBERS.has(n);
    case 'even': return n % 2 === 0;
    case 'odd': return n % 2 !== 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen1': return n >= 1 && n <= 12;
    case 'dozen2': return n >= 13 && n <= 24;
    case 'dozen3': return n >= 25 && n <= 36;
    case 'number': return n === target;
  }
}

export function playRoulette(s: CasinoSettings, type: RouletteBetType, target: number | null) {
  const [pWin, mul] =
    type === 'number'
      ? [s.roulette.rate36, s.roulette.mul36]
      : type.startsWith('dozen')
        ? [s.roulette.rate3, s.roulette.mul3]
        : [s.roulette.rate2, s.roulette.mul2];
  const all = Array.from({ length: 37 }, (_, i) => i);
  const winning = all.filter((n) => rouletteWins(n, type, target));
  const losing = all.filter((n) => !rouletteWins(n, type, target));
  const forcedWin = random() < pWin;
  const pool = forcedWin ? winning : losing;
  const number = pool.length ? choice(pool) : randint(0, 36);
  const win = rouletteWins(number, type, target);
  // Bot と同じく倍率から戦績のキーを決める
  const kind = win ? (mul >= 30 ? 'win_36x' : mul >= 3 ? 'win_3x' : 'win_2x') : null;
  return { number, win, mul, kind };
}

// ---------------- 競馬 ----------------

export const HORSES = [
  { num: 1, name: 'キタサンブラック', emoji: '🟥' },
  { num: 2, name: 'ディープインパクト', emoji: '🟦' },
  { num: 3, name: 'オルフェーヴル', emoji: '🟩' },
  { num: 4, name: 'ゴールドシップ', emoji: '🟨' },
  { num: 5, name: 'イクイノックス', emoji: '🟪' },
];
export type HorseBetType = 'tan' | 'fuku';
const TRACK = 15;
const RACE_STEPS = [
  { phase: '🚩 スタート！', commentary: '各馬綺麗なスタート！一斉にゲートを飛び出しました！', progress: 0.25 },
  { phase: '🏃 第2コーナー通過', commentary: '先頭争いが激化！激しいポジション争いが繰り広げられています！', progress: 0.55 },
  { phase: '🔥 第3〜4コーナー！', commentary: '馬群が凝縮！各馬最後の直線に向けて仕掛け始めました！', progress: 0.8 },
  { phase: '⚡ 最後の直線！！', commentary: '残り200m！外から強烈な追い上げ！先頭は譲らない！！', progress: 0.95 },
];

export function playHorse(s: CasinoSettings, horseNum: number, type: HorseBetType) {
  const others = shuffle(HORSES.map((h) => h.num).filter((n) => n !== horseNum));
  let win = false;
  let mul = 0;
  let ranking: number[];
  const insertAt = (pos: number) => [...others.slice(0, pos), horseNum, ...others.slice(pos)];
  if (type === 'tan') {
    if (random() < s.horse.rateTan) {
      win = true;
      mul = s.horse.mulTan;
      ranking = [horseNum, ...others];
    } else ranking = insertAt(randint(1, 4));
  } else if (random() < s.horse.rateFuku) {
    win = true;
    mul = s.horse.mulFuku;
    ranking = insertAt(randint(0, 2));
  } else ranking = insertAt(randint(3, 4));

  const finalScore = new Map(ranking.map((n, i) => [n, TRACK - i]));
  const frames = RACE_STEPS.map((step, i) => ({
    phase: step.phase,
    commentary: step.commentary,
    positions: Object.fromEntries(
      HORSES.map((h) => {
        const noise = i < 3 ? random() * 2.4 - 1.2 : random() * 0.8 - 0.4;
        const p = Math.max(0, Math.min(TRACK - 1, Math.round(finalScore.get(h.num)! * step.progress + noise)));
        return [h.num, p];
      })
    ) as Record<number, number>,
  }));
  frames.push({
    phase: '🏆 ゴールイン！！',
    commentary: '全馬ゴールイン！白熱の勝負が決着しました！',
    positions: Object.fromEntries(ranking.map((n, i) => [n, i === 0 ? TRACK : Math.max(1, TRACK - i)])) as Record<number, number>,
  });
  return { win, mul, ranking, rank: ranking.indexOf(horseNum) + 1, frames, track: TRACK };
}

// ---------------- チンチロリン ----------------

type HandType = 'pinzoro' | 'arashi' | 'shigoro' | 'normal' | 'hifumi' | 'lose';

export function chinchiroRank(s: CasinoSettings, dice: number[]): { name: string; rank: number; mul: number } {
  const c = s.chinchiro;
  const d = [...dice].sort((a, b) => a - b);
  const k = d.join(',');
  if (k === '1,1,1') return { name: 'ピンゾロ', rank: 1000, mul: c.mulPinzoro };
  for (const n of [2, 3, 4, 5, 6]) {
    if (k === `${n},${n},${n}`) return { name: `アラシ(${n})`, rank: 1100 - n * 100, mul: c.mulArashi };
  }
  if (k === '4,5,6') return { name: 'シゴロ', rank: 400, mul: c.mulShigoro };
  if (k === '1,2,3') return { name: 'ヒフミ', rank: -100, mul: c.mulHifumi };
  if (d[0] === d[1]) return { name: `出目${d[2]}`, rank: 100 + d[2], mul: c.mulNormal };
  if (d[1] === d[2]) return { name: `出目${d[0]}`, rank: 100 + d[0], mul: c.mulNormal };
  return { name: '役なし', rank: 0, mul: c.mulNormal };
}

function chinchiroTarget(s: CasinoSettings): HandType {
  const c = s.chinchiro;
  const weights: [HandType, number][] = [
    ['pinzoro', c.pinzoro], ['arashi', c.arashi], ['shigoro', c.shigoro],
    ['normal', c.normal], ['hifumi', c.hifumi], ['lose', c.lose],
  ];
  let total = weights.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) total = 1;
  let r = random() * total;
  for (const [type, w] of weights) {
    if (r < w) return type;
    r -= w;
  }
  return 'lose';
}

function noHand(): number[] {
  for (;;) {
    const d = [randint(1, 6), randint(1, 6), randint(1, 6)].sort((a, b) => a - b);
    const k = d.join(',');
    if (d[0] !== d[1] && d[1] !== d[2] && k !== '1,2,3' && k !== '4,5,6') return d;
  }
}

function forceHand(s: CasinoSettings, type: HandType): number[] {
  if (type === 'pinzoro') return [1, 1, 1];
  if (type === 'arashi') {
    const n = randint(2, 6);
    return [n, n, n];
  }
  if (type === 'shigoro') return [4, 5, 6];
  if (type === 'hifumi') return [1, 2, 3];
  if (type === 'normal') {
    for (;;) {
      const a = randint(1, 6);
      const b = randint(1, 6);
      if (a !== b && chinchiroRank(s, [a, a, b]).name.startsWith('出目')) return [a, a, b];
    }
  }
  return noHand();
}

export interface ChinchiroRoll { dice: number[]; name: string }

/**
 * Bot の ChinchiroGameView と同じ流れで、プレイヤー（最大3回）とBot（最大3回）の出目をまとめて決める。
 * 画面ではプレイヤーがボタンを押すたびに1回ずつ見せる（結果は最初から決まっているのは Bot と同じ）。
 */
export function playChinchiro(s: CasinoSettings) {
  const target = chinchiroTarget(s);
  const player: ChinchiroRoll[] = [];
  let playerHand = { name: '役なし', rank: 0, mul: s.chinchiro.mulNormal };
  for (let rolls = 1; rolls <= 3; rolls++) {
    const isFinal = rolls >= 3 || random() < 0.4;
    const dice = isFinal ? forceHand(s, target) : noHand();
    const hand = chinchiroRank(s, dice);
    player.push({ dice: [...dice].sort((a, b) => a - b), name: hand.name });
    if (hand.name !== '役なし' || rolls >= 3) {
      playerHand = hand;
      break;
    }
  }

  const npc: ChinchiroRoll[] = [];
  let npcHand = { name: 'なし', rank: 0, mul: 1 };
  let status: 'player_win' | 'npc_win' | 'draw';
  if (playerHand.name === 'シゴロ') {
    status = 'player_win';
  } else {
    const playerWinType = ['pinzoro', 'arashi', 'shigoro', 'normal'].includes(target);
    for (let rolls = 1; rolls <= 3; rolls++) {
      let dice: number[] = [];
      let hand = chinchiroRank(s, [1, 2, 4]);
      for (let i = 0; i < 50; i++) {
        dice = [randint(1, 6), randint(1, 6), randint(1, 6)];
        hand = chinchiroRank(s, dice);
        if (playerWinType ? hand.rank < playerHand.rank : hand.rank > playerHand.rank) break;
      }
      npc.push({ dice: [...dice].sort((a, b) => a - b), name: hand.name });
      if (hand.name !== '役なし' || rolls >= 3) {
        npcHand = hand;
        // どうしてもBotが強くならなかった場合の補正（Bot と同じ）
        if (!playerWinType && hand.rank <= playerHand.rank) {
          if (playerHand.rank === 0) {
            npcHand = { name: '出目1', rank: 101, mul: 1 };
            npc[npc.length - 1] = { dice: [1, 2, 2], name: '出目1' };
          } else if (playerHand.rank < 106) {
            const eye = Math.min(6, playerHand.rank - 100 + 1);
            const other = eye !== 1 ? 1 : 2;
            npcHand = { name: `出目${eye}`, rank: 100 + eye, mul: 1 };
            npc[npc.length - 1] = { dice: [other, other, eye].sort((a, b) => a - b), name: `出目${eye}` };
          }
        }
        break;
      }
    }
    if (playerHand.rank === npcHand.rank || (playerHand.name === '役なし' && npcHand.name === '役なし')) status = 'draw';
    else status = playerHand.rank > npcHand.rank ? 'player_win' : 'npc_win';
  }

  const kind = playerHand.name.includes('ピンゾロ')
    ? 'pinzoro'
    : playerHand.name.includes('アラシ')
      ? 'arashi'
      : playerHand.name.includes('シゴロ')
        ? 'shigoro'
        : playerHand.name.includes('ヒフミ')
          ? 'hifumi'
          : playerHand.name.includes('出目')
            ? 'normal'
            : null;
  return { player, npc, playerHand, npcHand, status, kind };
}

// ---------------- ブラックジャック ----------------

export interface Card { suit: string; value: string }

export function newDeck(): Card[] {
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return shuffle(suits.flatMap((suit) => values.map((value) => ({ suit, value }))));
}

/** helpers.calculate_blackjack_score と同じ */
export function bjScore(hand: Card[]): number {
  let score = 0;
  let aces = 0;
  for (const c of hand) {
    if (['J', 'Q', 'K'].includes(c.value)) score += 10;
    else if (c.value === 'A') {
      score += 11;
      aces++;
    } else score += Number(c.value);
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  return score;
}

export interface BlackjackState { deck: Card[]; player: Card[]; dealer: Card[] }

/** Bot の BlackjackGameView.__init__ と同じ配り方（BJ勝ちが抽選されたときだけ A+10 を配る） */
export function dealBlackjack(s: CasinoSettings): BlackjackState {
  const b = s.blackjack;
  let total = b.normal + b.bj + b.draw + b.lose;
  if (total <= 0) total = 1;
  const r = random() * total;
  const bjWin = r >= b.normal && r < b.normal + b.bj;

  const deck = newDeck();
  const take = (pred: (c: Card) => boolean) => deck.splice(deck.findIndex(pred), 1)[0];
  let player: Card[];
  let dealer: Card[];
  if (bjWin) {
    player = [take((c) => c.value === 'A'), take((c) => ['10', 'J', 'Q', 'K'].includes(c.value))];
    dealer = [deck.pop()!, deck.pop()!];
    if (bjScore(dealer) === 21) {
      const back = dealer.pop()!;
      dealer.push(deck.pop()!);
      deck.unshift(back);
    }
  } else {
    player = [deck.pop()!, deck.pop()!];
    while (bjScore(player) === 21) {
      const back = player.pop()!;
      player.push(deck.pop()!);
      deck.unshift(back);
    }
    dealer = [deck.pop()!, deck.pop()!];
  }
  return { deck, player, dealer };
}

/** ディーラーは17以上になるまで引く */
export function dealerPlay(state: BlackjackState) {
  while (bjScore(state.dealer) < 17) state.dealer.push(state.deck.pop()!);
}
