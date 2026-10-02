import { randomInt } from 'crypto';

/**
 * テキサスホールデム（ノーリミット）のルールとAI。poker_engine.py をそのまま移植したもの（Web のカジノで使う）。
 *
 * カード: [rank, suit]  rank は 2〜14（11=J, 12=Q, 13=K, 14=A）、suit は 0〜3（♠♥♦♣）
 * 卓の状態（TableState）はそのまま JSON にして web_casino_sessions に保存できる形にしてある。
 */

export type PCard = [number, number];

export const SUIT_MARKS = ['♠️', '♥️', '♦️', '♣️'];
const RANK_TEXT: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const FULL_DECK: PCard[] = [];
for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) FULL_DECK.push([r, s]);

const HAND_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];

export const STREET_NAMES: Record<string, string> = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン' };
export const AI_LEVEL_NAMES: Record<number, string> = { 1: '簡単', 2: '普通', 3: '中級', 4: '難しい', 5: '最難関', 6: '超難関' };
const EQUITY_SIMS: Record<number, number> = { 1: 0, 2: 150, 3: 300, 4: 500, 5: 800, 6: 1500 };

export const cardText = (c: PCard) => `${RANK_TEXT[c[0]] ?? String(c[0])}${SUIT_MARKS[c[1]]}`;
export const cardsText = (cards: PCard[]) => (cards.length ? cards.map(cardText).join(' ') : '—');
const fmt = (n: number) => n.toLocaleString('en-US');
const sameCard = (a: PCard, b: PCard) => a[0] === b[0] && a[1] === b[1];

// ============================================================
// 役の判定（7枚から一番強い5枚）
// ============================================================

/** Python のタプル比較と同じ（大きいほど強い） */
export function cmpScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function straightHigh(ranks: Set<number>): number {
  const rs = new Set(ranks);
  if (rs.has(14)) rs.add(1);
  for (let hi = 14; hi > 4; hi--) {
    if (rs.has(hi) && rs.has(hi - 1) && rs.has(hi - 2) && rs.has(hi - 3) && rs.has(hi - 4)) return hi;
  }
  return 0;
}

/** 大きいほど強い [役の番号, 比べる順のランク...] */
export function evaluate(cards: PCard[]): number[] {
  const counts = new Map<number, number>();
  const suits: number[][] = [[], [], [], []];
  for (const [r, s] of cards) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
    suits[s].push(r);
  }
  let flush: number[] | null = null;
  for (const lst of suits) {
    if (lst.length >= 5) {
      flush = [...lst].sort((x, y) => y - x);
      break;
    }
  }
  if (flush) {
    const sh = straightHigh(new Set(flush));
    if (sh) return [8, sh];
  }
  const quads: number[] = [], trips: number[] = [], pairs: number[] = [];
  for (const [r, n] of Array.from(counts)) (n === 4 ? quads : n === 3 ? trips : n === 2 ? pairs : []).push(r);
  trips.sort((x, y) => y - x);
  pairs.sort((x, y) => y - x);
  const ranks = Array.from(counts.keys());
  if (quads.length) {
    const q = quads[0];
    return [7, q, Math.max(0, ...ranks.filter((r) => r !== q))];
  }
  if (trips.length && (trips.length >= 2 || pairs.length)) {
    return [6, trips[0], Math.max(...trips.slice(1), ...pairs)];
  }
  if (flush) return [5, ...flush.slice(0, 5)];
  const sh = straightHigh(new Set(ranks));
  if (sh) return [4, sh];
  const rest = [...ranks].sort((x, y) => y - x);
  if (trips.length) {
    const t = trips[0];
    return [3, t, ...rest.filter((r) => r !== t).slice(0, 2)];
  }
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    return [2, p1, p2, Math.max(0, ...rest.filter((r) => r !== p1 && r !== p2))];
  }
  if (pairs.length) {
    const p = pairs[0];
    return [1, p, ...rest.filter((r) => r !== p).slice(0, 3)];
  }
  return [0, ...rest.slice(0, 5)];
}

export function handName(score: number[]): string {
  if (score[0] === 8 && score[1] === 14) return 'ロイヤルフラッシュ';
  return HAND_NAMES[score[0]];
}

export function bestHandName(cards: PCard[]): string {
  if (cards.length < 5) {
    if (cards.length === 2 && cards[0][0] === cards[1][0]) return 'ポケットペア';
    return 'ハイカード';
  }
  return handName(evaluate(cards));
}

// ============================================================
// AI 用: 勝率の見積もり
// ============================================================

/** 手札2枚の強さ（Chen フォーミュラを 0〜1 にしたもの） */
export function preflopStrength(hole: PCard[]): number {
  const [[r1, s1], [r2, s2]] = [...hole].sort((a, b) => cmpScore(b, a));
  let pts = ({ 14: 10, 13: 8, 12: 7, 11: 6 } as Record<number, number>)[r1] ?? r1 / 2;
  if (r1 === r2) pts = Math.max(5, pts * 2);
  if (s1 === s2) pts += 2;
  const gap = r1 - r2 - 1;
  if (r1 !== r2) {
    pts -= ({ 0: 0, 1: 1, 2: 2, 3: 4 } as Record<number, number>)[gap] ?? 5;
    if (gap <= 1 && r1 < 12) pts += 1;
  }
  return Math.max(0, Math.min(1, (pts + 1) / 21));
}

function weakForBoard(h: PCard[], board: PCard[], boardCat: number, preCut: number): boolean {
  if (!board.length) return preflopStrength(h) < preCut;
  const made = evaluate([...h, ...board]);
  if (made[0] > boardCat) return false;
  for (let s = 0; s < 4; s++) {
    const n = board.filter((c) => c[1] === s).length + h.filter((c) => c[1] === s).length;
    if (n >= 4 && h.some((c) => c[1] === s)) return false;
  }
  return true;
}

function sample<T>(arr: T[], k: number): T[] {
  const a = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** モンテカルロで勝率（引き分けは山分け分）を見積もる */
export function equity(hole: PCard[], board: PCard[], nOpp = 1, sims = 400, oppFilter = 0, preCut = 0.33): number {
  if (sims <= 0) return 0.5;
  const known = [...hole, ...board];
  const deck = FULL_DECK.filter((c) => !known.some((k) => sameCard(k, c)));
  const needBoard = 5 - board.length;
  const boardCat = board.length ? evaluate(board)[0] : 0;
  const extra = oppFilter > 0 ? 8 : 0;
  let total = 0;
  for (let n = 0; n < sims; n++) {
    const smp = sample(deck, needBoard + 2 * nOpp + extra);
    const b = [...board, ...smp.slice(0, needBoard)];
    const pool = smp.slice(needBoard, needBoard + 2 * nOpp);
    const spare = smp.slice(needBoard + 2 * nOpp);
    const opps: PCard[][] = [];
    for (let k = 0; k < nOpp; k++) {
      let h: PCard[] = [pool[2 * k], pool[2 * k + 1]];
      let tries = 0;
      while (oppFilter > 0 && tries < 4 && spare.length >= 2 && Math.random() < oppFilter && weakForBoard(h, board, boardCat, preCut)) {
        h = [spare.pop()!, spare.pop()!];
        tries++;
      }
      opps.push(h);
    }
    const mine = evaluate([...hole, ...b]);
    let best: number[] | null = null;
    let nBest = 0;
    for (const h of opps) {
      const v = evaluate([...h, ...b]);
      const c = best ? cmpScore(v, best) : 1;
      if (c > 0) {
        best = v;
        nBest = 1;
      } else if (c === 0) nBest++;
    }
    const c = cmpScore(mine, best!);
    if (c > 0) total += 1;
    else if (c === 0) total += 1 / (nBest + 1);
  }
  return total / sims;
}

// ============================================================
// テーブル
// ============================================================

export interface PPlayer {
  uid: string;
  name: string;
  stack: number;
  isAi: boolean;
  aiLevel: number;
  hole: PCard[];
  bet: number;
  totalIn: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  leaving: boolean;
}

interface Tendency { agg: number; pas: number; faced: number; fold: number; sd_agg?: number; sd_bluff?: number }

export interface HandResult {
  showdown: boolean;
  pots: { amount: number; winners: string[]; hand: string | null }[];
  won: Record<string, number>;
  hands: Record<string, { hole: PCard[]; name: string }>;
}

export interface TableState {
  players: PPlayer[];
  sb: number;
  bb: number;
  dealer: number;
  handNo: number;
  board: PCard[];
  deck: PCard[];
  street: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'done';
  current: number;
  currentBet: number;
  lastRaise: number;
  toAct: string[];
  log: string[];
  result: HandResult | null;
  raisesThisHand: Record<string, number>;
  tendencies: Record<string, Tendency>;
  sbSeat: number;
  bbSeat: number;
}

export interface Options {
  to_call: number;
  can_check: boolean;
  can_raise: boolean;
  min_raise_to: number;
  max_raise_to: number;
  current_bet: number;
}

export function newPlayer(uid: string, name: string, stack: number, isAi = false, aiLevel = 0): PPlayer {
  return { uid, name, stack, isAi, aiLevel, hole: [], bet: 0, totalIn: 0, folded: false, allIn: false, inHand: false, leaving: false };
}

export function newTable(players: PPlayer[], sb: number, bb: number): TableState {
  return {
    players, sb, bb, dealer: -1, handNo: 0, board: [], deck: [], street: 'waiting', current: -1, currentBet: 0, lastRaise: bb,
    toAct: [], log: [], result: null, raisesThisHand: {}, tendencies: {}, sbSeat: -1, bbSeat: -1,
  };
}

const canAct = (p: PPlayer) => p.inHand && !p.folded && !p.allIn;

/** 卓の操作。状態は t.s（JSON にそのまま保存できる） */
export class PokerTable {
  constructor(public s: TableState) {}

  private get toAct() {
    return new Set(this.s.toAct);
  }
  private set toAct(v: Set<string>) {
    this.s.toAct = Array.from(v);
  }

  seatOf(uid: string) {
    return this.s.players.findIndex((p) => p.uid === uid);
  }
  pot() {
    return this.s.players.reduce((a, p) => a + p.totalIn, 0);
  }
  inHandPlayers() {
    return this.s.players.filter((p) => p.inHand && !p.folded);
  }
  currentPlayer(): PPlayer | null {
    const c = this.s.current;
    return c >= 0 && c < this.s.players.length ? this.s.players[c] : null;
  }
  private nextSeat(i: number, cond: (p: PPlayer) => boolean) {
    const n = this.s.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (((i + k) % n) + n) % n;
      if (cond(this.s.players[j])) return j;
    }
    return -1;
  }
  tend(uid: string): Tendency {
    return (this.s.tendencies[uid] ??= { agg: 0, pas: 0, faced: 0, fold: 0 });
  }

  // ---------- ハンドの開始 ----------
  startHand(): boolean {
    const s = this.s;
    const seated = s.players.filter((p) => p.stack > 0 && !p.leaving);
    if (seated.length < 2) return false;
    s.handNo += 1;
    for (const p of s.players) {
      p.hole = [];
      p.bet = p.totalIn = 0;
      p.folded = false;
      p.allIn = false;
      p.inHand = p.stack > 0 && !p.leaving;
    }
    s.board = [];
    s.deck = FULL_DECK.map((c) => [c[0], c[1]] as PCard);
    for (let i = s.deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]];
    }
    s.log = [];
    s.result = null;
    s.raisesThisHand = {};
    s.dealer = this.nextSeat(s.dealer, (p) => p.inHand);
    const sbSeat = seated.length === 2 ? s.dealer : this.nextSeat(s.dealer, (p) => p.inHand);
    const bbSeat = this.nextSeat(sbSeat, (p) => p.inHand);
    for (const p of s.players) if (p.inHand) p.hole = [s.deck.pop()!, s.deck.pop()!];
    s.street = 'preflop';
    s.currentBet = 0;
    s.lastRaise = s.bb;
    this.post(s.players[sbSeat], s.sb, 'SB');
    this.post(s.players[bbSeat], s.bb, 'BB');
    s.currentBet = Math.max(s.bb, s.players[bbSeat].bet, s.players[sbSeat].bet);
    this.toAct = new Set(s.players.filter(canAct).map((p) => p.uid));
    const ta = this.toAct;
    s.current = this.nextSeat(bbSeat, (p) => canAct(p) && ta.has(p.uid));
    s.sbSeat = sbSeat;
    s.bbSeat = bbSeat;
    this.checkRound(false);
    return true;
  }

  private post(p: PPlayer, amount: number, label: string) {
    const amt = Math.min(amount, p.stack);
    p.stack -= amt;
    p.bet += amt;
    p.totalIn += amt;
    if (p.stack === 0) p.allIn = true;
    this.s.log.push(`${p.name} が ${label} ${fmt(amt)}`);
  }

  // ---------- 行動 ----------
  options(uid?: string): Options | null {
    const p = this.currentPlayer();
    if (!p || (uid !== undefined && p.uid !== uid)) return null;
    const toCall = Math.min(this.s.currentBet - p.bet, p.stack);
    const maxTo = p.bet + p.stack;
    const minTo = Math.min(this.s.currentBet + this.s.lastRaise, maxTo);
    return {
      to_call: toCall,
      can_check: toCall === 0,
      can_raise: maxTo > this.s.currentBet && p.stack > toCall,
      min_raise_to: minTo,
      max_raise_to: maxTo,
      current_bet: this.s.currentBet,
    };
  }

  /** action: fold / check / call / raise（amount はこのラウンドの合計額）/ allin。できない行動なら Error */
  act(uid: string, action: string, amount = 0): string {
    const s = this.s;
    const p = this.currentPlayer();
    if (!p || p.uid !== uid || !['preflop', 'flop', 'turn', 'river'].includes(s.street)) throw new Error('今はあなたの番ではありません');
    const o = this.options()!;
    const t = this.tend(uid);
    const facing = o.to_call > 0;
    if (facing) t.faced += 1;
    if (action === 'allin') {
      if (o.can_raise) {
        action = 'raise';
        amount = o.max_raise_to;
      } else {
        action = 'call';
        amount = 0;
      }
    }
    let text: string;
    if (action === 'fold') {
      p.folded = true;
      if (facing) t.fold += 1;
      text = `${p.name} がフォールド`;
    } else if (action === 'check') {
      if (!o.can_check) throw new Error('チェックはできません（コールかフォールドを選んでください）');
      t.pas += 1;
      text = `${p.name} がチェック`;
    } else if (action === 'call') {
      if (o.to_call === 0) {
        t.pas += 1;
        text = `${p.name} がチェック`;
      } else {
        const amt = o.to_call;
        p.stack -= amt;
        p.bet += amt;
        p.totalIn += amt;
        if (p.stack === 0) p.allIn = true;
        t.pas += 1;
        text = `${p.name} がコール ${fmt(amt)}` + (p.allIn ? '（オールイン）' : '');
      }
    } else if (action === 'raise') {
      if (!o.can_raise) throw new Error('レイズはできません');
      amount = Math.floor(Number(amount)) || 0;
      if (amount < o.min_raise_to) amount = o.min_raise_to;
      amount = Math.min(amount, o.max_raise_to);
      const add = amount - p.bet;
      const prevBet = s.currentBet;
      p.stack -= add;
      p.bet = amount;
      p.totalIn += add;
      if (p.stack === 0) p.allIn = true;
      if (amount - prevBet >= s.lastRaise) s.lastRaise = amount - prevBet;
      s.currentBet = Math.max(s.currentBet, amount);
      this.toAct = new Set(s.players.filter((q) => canAct(q) && q.uid !== p.uid).map((q) => q.uid));
      t.agg += 1;
      s.raisesThisHand[uid] = (s.raisesThisHand[uid] ?? 0) + 1;
      const verb = prevBet === 0 ? 'ベット' : 'レイズ';
      text = `${p.name} が${verb} ${fmt(amount)}` + (p.allIn ? '（オールイン）' : '');
    } else {
      throw new Error('その行動はできません');
    }
    const ta = this.toAct;
    ta.delete(p.uid);
    this.toAct = ta;
    s.log.push(text);
    this.checkRound();
    return text;
  }

  private checkRound(advance = true) {
    const s = this.s;
    const alive = this.inHandPlayers();
    if (alive.length === 1) {
      this.finishUncontested(alive[0]);
      return;
    }
    const prev = this.toAct;
    let ta = new Set(alive.filter((p) => canAct(p) && prev.has(p.uid)).map((p) => p.uid));
    const actors = alive.filter(canAct);
    if (actors.length <= 1 && actors.every((p) => p.bet >= s.currentBet)) ta = new Set();
    this.toAct = ta;
    if (ta.size) {
      const p = this.currentPlayer();
      if (advance || !p || !ta.has(p.uid)) s.current = this.nextSeat(s.current, (q) => canAct(q) && ta.has(q.uid));
      return;
    }
    this.nextStreet();
  }

  private nextStreet() {
    const s = this.s;
    for (const p of s.players) p.bet = 0;
    s.currentBet = 0;
    s.lastRaise = s.bb;
    const actors = this.inHandPlayers().filter(canAct);
    if (s.street === 'preflop') {
      s.board.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
      s.street = 'flop';
    } else if (s.street === 'flop') {
      s.board.push(s.deck.pop()!);
      s.street = 'turn';
    } else if (s.street === 'turn') {
      s.board.push(s.deck.pop()!);
      s.street = 'river';
    } else {
      this.showdown();
      return;
    }
    s.log.push(`— ${STREET_NAMES[s.street]}: ${cardsText(s.board)}`);
    if (actors.length < 2) {
      this.toAct = new Set();
      this.nextStreet();
      return;
    }
    this.toAct = new Set(actors.map((p) => p.uid));
    s.current = this.nextSeat(s.dealer, canAct);
  }

  // ---------- 決着 ----------
  private finishUncontested(winner: PPlayer) {
    const s = this.s;
    const amount = this.pot();
    winner.stack += amount;
    s.street = 'done';
    s.current = -1;
    s.result = { showdown: false, pots: [{ amount, winners: [winner.uid], hand: null }], won: { [winner.uid]: amount }, hands: {} };
    s.log.push(`${winner.name} が ${fmt(amount)} を獲得（ほかの全員がフォールド）`);
    this.clearBets();
  }

  private showdown() {
    const s = this.s;
    s.street = 'showdown';
    s.current = -1;
    const alive = this.inHandPlayers();
    const scores: Record<string, number[]> = {};
    for (const p of alive) scores[p.uid] = evaluate([...p.hole, ...s.board]);
    const pots: [number, PPlayer[]][] = [];
    let prev = 0;
    const levels = Array.from(new Set(alive.map((p) => p.totalIn))).sort((a, b) => a - b);
    for (const lvl of levels) {
      const amt = s.players.reduce((a, p) => a + Math.min(p.totalIn, lvl) - Math.min(p.totalIn, prev), 0);
      const eligible = alive.filter((p) => p.totalIn >= lvl);
      if (amt > 0) pots.push([amt, eligible]);
      prev = lvl;
    }
    const extra = s.players.reduce((a, p) => a + Math.max(0, p.totalIn - prev), 0);
    if (extra && pots.length) pots[pots.length - 1][0] += extra;
    const won: Record<string, number> = {};
    const potResults: HandResult['pots'] = [];
    const n = s.players.length;
    for (const [amt, eligible] of pots) {
      let best = scores[eligible[0].uid];
      for (const p of eligible) if (cmpScore(scores[p.uid], best) > 0) best = scores[p.uid];
      const winners = eligible.filter((p) => cmpScore(scores[p.uid], best) === 0);
      winners.sort((a, b) => ((((s.players.indexOf(a) - s.dealer - 1) % n) + n) % n) - ((((s.players.indexOf(b) - s.dealer - 1) % n) + n) % n));
      const share = Math.floor(amt / winners.length);
      const odd = amt % winners.length;
      winners.forEach((w, i) => {
        const got = share + (i < odd ? 1 : 0);
        w.stack += got;
        won[w.uid] = (won[w.uid] ?? 0) + got;
      });
      potResults.push({ amount: amt, winners: winners.map((w) => w.uid), hand: handName(best) });
    }
    const boardCat = evaluate(s.board)[0];
    for (const p of alive) {
      if (s.raisesThisHand[p.uid]) {
        const t = this.tend(p.uid);
        t.sd_agg = (t.sd_agg ?? 0) + 1;
        if (scores[p.uid][0] <= boardCat) t.sd_bluff = (t.sd_bluff ?? 0) + 1;
      }
    }
    s.result = {
      showdown: true,
      pots: potResults,
      won,
      hands: Object.fromEntries(alive.map((p) => [p.uid, { hole: p.hole, name: handName(scores[p.uid]) }])),
    };
    for (const pr of potResults) {
      const names = pr.winners.map((u) => s.players[this.seatOf(u)].name).join('・');
      s.log.push(`${names} が ${fmt(pr.amount)} を獲得（${pr.hand}）`);
    }
    s.street = 'done';
    this.clearBets();
  }

  private clearBets() {
    for (const p of this.s.players) p.bet = 0;
  }
}

// ============================================================
// AI（poker_engine.ai_decide と同じ考え方）
// ============================================================

function raiseTo(table: PokerTable, o: Options, frac: number): number {
  const pot = table.pot();
  const target = o.current_bet + Math.floor(Math.max(table.s.bb, (pot + o.to_call) * frac));
  return Math.max(o.min_raise_to, Math.min(o.max_raise_to, target));
}

const uniform = (a: number, b: number) => a + (b - a) * Math.random();

export function aiDecide(table: PokerTable, uid: string): [string, number] {
  const s = table.s;
  const p = s.players[table.seatOf(uid)];
  const level = p.aiLevel;
  const o = table.options(uid)!;
  const { to_call: toCall, can_check: canCheck, can_raise: canRaise } = o;
  const pot = table.pot();
  const street = s.street;
  const opps = table.inHandPlayers().filter((q) => q.uid !== uid);
  const nOpp = Math.max(1, opps.length);

  const foldOrCheck = (): [string, number] => (canCheck ? ['check', 0] : ['fold', 0]);
  const call = (): [string, number] => ['call', 0];
  const bet = (frac: number): [string, number] => (canRaise ? ['raise', raiseTo(table, o, frac)] : call());

  // ---- レベル1: ほぼ適当 ----
  if (level <= 1) {
    const r = Math.random();
    if (toCall > 0) {
      if (r < 0.3) return ['fold', 0];
      if (r > 0.92 && canRaise) return ['raise', o.min_raise_to];
      return call();
    }
    return r > 0.8 ? bet(0.5) : ['check', 0];
  }

  let agg = 0, pas = 0, faced = 0, folds = 0, sdAgg = 0, sdBluff = 0;
  for (const q of opps) {
    const t = s.tendencies[q.uid];
    if (t) {
      agg += t.agg;
      pas += t.pas;
      faced += t.faced;
      folds += t.fold;
      sdAgg += t.sd_agg ?? 0;
      sdBluff += t.sd_bluff ?? 0;
    }
  }
  const aggression = agg + pas >= 6 ? agg / (agg + pas) : 0.35;
  const foldRate = faced >= 5 ? folds / faced : 0.35;
  const bluffRate = (sdBluff + 0.25 * 4) / (sdAgg + 4);
  const oppRaises = Math.max(0, ...opps.map((q) => s.raisesThisHand[q.uid] ?? 0));

  let oppFilter = 0;
  let preCut = 0.33;
  if (level >= 3 && oppRaises) {
    preCut = oppRaises === 1 ? 0.33 : 0.45;
    if (level === 3) oppFilter = 0.3;
    else if (level === 4) oppFilter = 0.55;
    else if (level >= 6) {
      oppFilter = Math.max(0.15, Math.min(0.95, 1 - bluffRate * 2.2));
      if (oppRaises >= 2) oppFilter = Math.min(0.95, oppFilter + 0.1);
    } else {
      oppFilter = Math.max(0.25, Math.min(0.9, 0.95 - aggression));
      if (oppRaises >= 2) oppFilter = Math.min(0.95, oppFilter + 0.15);
    }
  }

  const sims = EQUITY_SIMS[level] ?? 500;
  const eq = equity(p.hole, s.board, nOpp, sims, oppFilter, preCut);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const stackBb = (p.stack + p.bet) / Math.max(1, s.bb);

  // ---- レベル2 ----
  if (level === 2) {
    if (toCall > 0) {
      if (eq > 0.88 && canRaise) return bet(0.5);
      return eq > 0.33 ? call() : ['fold', 0];
    }
    return eq > 0.75 ? bet(0.4) : ['check', 0];
  }

  // ---- レベル3 ----
  if (level === 3) {
    if (toCall > 0) {
      if (canRaise && eq > (!s.raisesThisHand[uid] ? 0.72 : 0.9)) return bet(0.75);
      return eq > potOdds + 0.05 ? call() : ['fold', 0];
    }
    if (eq > 0.58) return bet(0.66);
    return ['check', 0];
  }

  // ---- レベル4〜6 ----
  const myRaises = s.raisesThisHand[uid] ?? 0;
  if (stackBb <= 12 && street === 'preflop') {
    if (preflopStrength(p.hole) > (toCall > s.bb ? 0.42 : 0.33)) return ['allin', 0];
    return foldOrCheck();
  }

  if (street === 'preflop') {
    let ps = preflopStrength(p.hole);
    if (level >= 5) ps += (aggression - 0.35) * 0.15 + uniform(-0.03, 0.03);
    const facingRaise = o.current_bet > s.bb;
    let openCut = 0.33;
    let defendAdj = 0;
    if (level >= 6) {
      openCut -= Math.max(0, Math.min(0.15, (foldRate - 0.3) * 0.6));
      defendAdj = Math.max(-0.08, Math.min(0.04, -(aggression - 0.35) * 0.3));
    }
    if (!facingRaise) {
      if (ps >= openCut && canRaise) return ['raise', Math.max(o.min_raise_to, Math.min(o.max_raise_to, Math.floor(s.bb * 2.5)))];
      if (toCall > 0) return ps >= 0.2 ? call() : ['fold', 0];
      return ['check', 0];
    }
    if (ps >= (oppRaises <= 1 ? 0.72 : 0.82) && canRaise && myRaises < 2) {
      return ['raise', Math.max(o.min_raise_to, Math.min(o.max_raise_to, o.current_bet * 3))];
    }
    const need = 0.3 + defendAdj + 0.08 * Math.max(0, oppRaises - 1) + Math.min(0.2, (toCall / Math.max(1, p.stack + p.bet)) * 0.4);
    return ps >= need || (potOdds < 0.2 && ps >= 0.24) ? call() : ['fold', 0];
  }

  let baseFold = level === 4 ? 0.3 : (folds + 0.35 * 5) / (faced + 5);
  if (oppRaises) baseFold *= 0.5;
  const callFilter = level === 4 ? 0.55 : 0.65;
  const eqCalled = equity(p.hole, s.board, nOpp, Math.floor(sims / 2), Math.min(0.95, oppFilter + callFilter * (1 - oppFilter)), Math.max(preCut, 0.36));
  let margin = level === 4 ? 0.02 : 0;
  if (level === 5 && toCall > 0 && aggression < 0.25 && (street === 'turn' || street === 'river')) margin += 0.05;

  if (toCall > 0) {
    const evCall = eq * (pot + toCall) - toCall;
    const needRaise = myRaises === 0 ? 0.62 : 0.78;
    if (canRaise && eqCalled > needRaise) {
      const to = raiseTo(table, o, 0.75);
      const add = to - p.bet;
      const f = baseFold * 0.6;
      const evRaise = f * pot + (1 - f) * (eqCalled * (pot + add + (to - o.current_bet) * nOpp) - add);
      if (evRaise > evCall) return ['raise', to];
    }
    if (level >= 5 && canRaise && myRaises === 0 && (street === 'flop' || street === 'turn') && eq > 0.3 && eq < 0.5 && foldRate > 0.6 && Math.random() < 0.15) {
      return ['raise', raiseTo(table, o, 0.75)];
    }
    return eq > potOdds + margin ? call() : ['fold', 0];
  }

  let bestEv = eq * pot;
  let best: [string, number] = ['check', 0];
  if (canRaise) {
    const sizes = level === 4 ? [0.5, 0.75] : level === 5 ? [0.33, 0.5, 0.75, 1.0] : [0.25, 0.4, 0.6, 0.8, 1.1];
    for (const frac of sizes) {
      const to = raiseTo(table, o, frac);
      const add = to - p.bet;
      const f = Math.min(0.8, baseFold * (0.55 + 0.6 * frac)) * (nOpp > 1 ? 0.6 : 1);
      const eqc = eqCalled - 0.04 * frac;
      const ev = f * pot + (1 - f) * (eqc * (pot + add + add * nOpp) - add);
      if (ev > bestEv) {
        bestEv = ev;
        best = ['raise', to];
      }
    }
  }
  return best;
}
