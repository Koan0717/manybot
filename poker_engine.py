# -*- coding: utf-8 -*-
"""
テキサスホールデム（ノーリミット）のルールとAI。Discord に依存しない（cogs/poker.py から使う）。

カード: (rank, suit)  rank は 2〜14（11=J, 12=Q, 13=K, 14=A）、suit は 0〜3（♠♥♦♣）
テーブル: PokerTable が 1ハンドずつ進める（ブラインド → 配札 → プリフロップ → フロップ → ターン → リバー → ショーダウン）。
サイドポット・オールイン・同点の山分けに対応。
"""
import random

SUIT_MARKS = ["♠️", "♥️", "♦️", "♣️"]
RANK_TEXT = {11: "J", 12: "Q", 13: "K", 14: "A"}
FULL_DECK = [(r, s) for r in range(2, 15) for s in range(4)]

HAND_NAMES = ["ハイカード", "ワンペア", "ツーペア", "スリーカード", "ストレート", "フラッシュ", "フルハウス", "フォーカード", "ストレートフラッシュ"]

STREET_NAMES = {"preflop": "プリフロップ", "flop": "フロップ", "turn": "ターン", "river": "リバー", "showdown": "ショーダウン"}


def card_text(c) -> str:
    r, s = c
    return f"{RANK_TEXT.get(r, str(r))}{SUIT_MARKS[s]}"


def cards_text(cards) -> str:
    return " ".join(card_text(c) for c in cards) if cards else "—"


# ============================================================
# 役の判定（7枚から一番強い5枚）
# ============================================================
def _straight_high(ranks) -> int:
    """ranks（集合）に5連続があれば一番上のランク。A は 1 としても使える"""
    if 14 in ranks:
        ranks = set(ranks) | {1}
    for hi in range(14, 4, -1):
        if hi in ranks and hi - 1 in ranks and hi - 2 in ranks and hi - 3 in ranks and hi - 4 in ranks:
            return hi
    return 0


def evaluate(cards) -> tuple:
    """大きいほど強いタプル (役の番号, 比べる順のランク...)"""
    counts = {}
    suits = [[], [], [], []]
    for r, s in cards:
        counts[r] = counts.get(r, 0) + 1
        suits[s].append(r)
    flush = None
    for lst in suits:
        if len(lst) >= 5:
            flush = sorted(lst, reverse=True)
            break
    if flush:
        sh = _straight_high(set(flush))
        if sh:
            return (8, sh)
    quads, trips, pairs, singles = [], [], [], []
    for r, n in counts.items():
        (quads if n == 4 else trips if n == 3 else pairs if n == 2 else singles).append(r)
    trips.sort(reverse=True)
    pairs.sort(reverse=True)
    if quads:
        q = quads[0]
        return (7, q, max((r for r in counts if r != q), default=0))
    if trips and (len(trips) >= 2 or pairs):
        t = trips[0]
        return (6, t, max(trips[1:] + pairs))
    if flush:
        return (5,) + tuple(flush[:5])
    sh = _straight_high(set(counts))
    if sh:
        return (4, sh)
    rest = sorted(counts, reverse=True)
    if trips:
        t = trips[0]
        return (3, t) + tuple([r for r in rest if r != t][:2])
    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        return (2, p1, p2, max((r for r in rest if r not in (p1, p2)), default=0))
    if pairs:
        p = pairs[0]
        return (1, p) + tuple([r for r in rest if r != p][:3])
    return (0,) + tuple(rest[:5])


def hand_name(score: tuple) -> str:
    if score[0] == 8 and score[1] == 14:
        return "ロイヤルフラッシュ"
    return HAND_NAMES[score[0]]


def best_hand_name(cards) -> str:
    if len(cards) < 5:
        # プリフロップなど: ペアかどうかだけ
        if len(cards) == 2 and cards[0][0] == cards[1][0]:
            return "ポケットペア"
        return "ハイカード"
    return hand_name(evaluate(cards))


# ============================================================
# AI 用: 勝率の見積もり
# ============================================================
def preflop_strength(hole) -> float:
    """手札2枚の強さ（Chen フォーミュラを 0〜1 にしたもの）"""
    (r1, s1), (r2, s2) = sorted(hole, reverse=True)
    pts = {14: 10, 13: 8, 12: 7, 11: 6}.get(r1, r1 / 2)
    if r1 == r2:
        pts = max(5, pts * 2)
    if s1 == s2:
        pts += 2
    gap = r1 - r2 - 1
    if r1 != r2:
        pts -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
        if gap <= 1 and r1 < 12:
            pts += 1
    return max(0.0, min(1.0, (pts + 1) / 21))


def _weak_for_board(h, board, board_cat, pre_cut) -> bool:
    """攻めてきた相手が持っていそうにない（弱い）手札か"""
    if not board:
        return preflop_strength(h) < pre_cut
    made = evaluate(list(h) + board)
    if made[0] > board_cat:
        return False  # 手札で役が良くなっている
    # フラッシュの引き（同じマーク4枚、手札を含む）
    for s in range(4):
        if sum(1 for c in board if c[1] == s) + sum(1 for c in h if c[1] == s) >= 4 and any(c[1] == s for c in h):
            return False
    return True


def equity(hole, board, n_opp: int = 1, sims: int = 400, opp_filter: float = 0.0, pre_cut: float = 0.33, rng=random) -> float:
    """モンテカルロで勝率（引き分けは山分け分）を見積もる。
    opp_filter（0〜1）: 相手が攻めてきたとき、相手の手札から「場に絡まない弱い手」をこの確率で除いて見積もる"""
    known = set(hole) | set(board)
    deck = [c for c in FULL_DECK if c not in known]
    need_board = 5 - len(board)
    board = list(board)
    board_cat = evaluate(board)[0] if board else 0
    extra = 8 if opp_filter > 0 else 0
    total = 0.0
    for _ in range(sims):
        sample = rng.sample(deck, need_board + 2 * n_opp + extra)
        b = board + sample[:need_board]
        pool = sample[need_board:need_board + 2 * n_opp]
        spare = sample[need_board + 2 * n_opp:]
        opps = []
        for k in range(n_opp):
            h = (pool[2 * k], pool[2 * k + 1])
            tries = 0
            while opp_filter > 0 and tries < 4 and len(spare) >= 2 and rng.random() < opp_filter and _weak_for_board(h, board, board_cat, pre_cut):
                h = (spare.pop(), spare.pop())
                tries += 1
            opps.append(h)
        mine = evaluate(list(hole) + b)
        best = None
        n_best = 0
        for h in opps:
            v = evaluate(list(h) + b)
            if best is None or v > best:
                best, n_best = v, 1
            elif v == best:
                n_best += 1
        if mine > best:
            total += 1
        elif mine == best:
            total += 1 / (n_best + 1)
    return total / sims


# ============================================================
# テーブル
# ============================================================
class Player:
    def __init__(self, uid, name: str, stack: int, is_ai: bool = False, ai_level: int = 0):
        self.uid = uid
        self.name = name
        self.stack = stack
        self.is_ai = is_ai
        self.ai_level = ai_level
        self.hole = []
        self.bet = 0          # このラウンド（ストリート）で出した額
        self.total_in = 0     # このハンドで出した合計
        self.folded = False
        self.all_in = False
        self.in_hand = False  # このハンドに参加しているか（チップ0や退席者は不参加）
        self.leaving = False  # ハンドが終わったら退席する

    @property
    def can_act(self):
        return self.in_hand and not self.folded and not self.all_in


class PokerTable:
    def __init__(self, players: list, small_blind: int, big_blind: int, rng=None):
        self.players = players
        self.sb = small_blind
        self.bb = big_blind
        self.rng = rng or random.Random()
        self.dealer = -1
        self.hand_no = 0
        self.board = []
        self.deck = []
        self.street = "waiting"
        self.current = -1
        self.current_bet = 0
        self.last_raise = big_blind
        self.to_act = set()
        self.log = []              # このハンドの出来事（表示用）
        self.result = None         # ハンドが終わったときの結果
        self.raises_this_hand = {} # uid -> このハンドでレイズした回数（AI の読み用）
        # 相手の傾向（AI 用）: uid -> {"agg": 攻めた回数, "pas": コール/チェック回数, "faced": ベットを受けた回数, "fold": そこで降りた回数}
        self.tendencies = {}

    # ---------- 便利 ----------
    def seat_of(self, uid):
        for i, p in enumerate(self.players):
            if p.uid == uid:
                return i
        return -1

    def pot(self) -> int:
        return sum(p.total_in for p in self.players)

    def in_hand_players(self):
        return [p for p in self.players if p.in_hand and not p.folded]

    def current_player(self):
        return self.players[self.current] if 0 <= self.current < len(self.players) else None

    def _next_seat(self, i, cond):
        n = len(self.players)
        for k in range(1, n + 1):
            j = (i + k) % n
            if cond(self.players[j]):
                return j
        return -1

    def _tend(self, uid):
        return self.tendencies.setdefault(uid, {"agg": 0, "pas": 0, "faced": 0, "fold": 0})

    # ---------- ハンドの開始 ----------
    def start_hand(self) -> bool:
        """次のハンドを始める。チップを持つ人が2人未満なら False"""
        seated = [p for p in self.players if p.stack > 0 and not p.leaving]
        if len(seated) < 2:
            return False
        self.hand_no += 1
        for p in self.players:
            p.hole = []
            p.bet = p.total_in = 0
            p.folded = False
            p.all_in = False
            p.in_hand = p.stack > 0 and not p.leaving
        self.board = []
        self.deck = FULL_DECK[:]
        self.rng.shuffle(self.deck)
        self.log = []
        self.result = None
        self.raises_this_hand = {}
        self.dealer = self._next_seat(self.dealer, lambda p: p.in_hand)
        heads_up = len(seated) == 2
        if heads_up:
            sb_seat = self.dealer
        else:
            sb_seat = self._next_seat(self.dealer, lambda p: p.in_hand)
        bb_seat = self._next_seat(sb_seat, lambda p: p.in_hand)
        for p in self.players:
            if p.in_hand:
                p.hole = [self.deck.pop(), self.deck.pop()]
        self.street = "preflop"
        self.current_bet = 0
        self.last_raise = self.bb
        self._post(self.players[sb_seat], self.sb, "SB")
        self._post(self.players[bb_seat], self.bb, "BB")
        self.current_bet = max(self.bb, self.players[bb_seat].bet, self.players[sb_seat].bet)
        self.to_act = {p.uid for p in self.players if p.can_act}
        self.current = self._next_seat(bb_seat, lambda p: p.can_act and p.uid in self.to_act)
        self.sb_seat, self.bb_seat = sb_seat, bb_seat
        self._check_round(advance=False)
        return True

    def _post(self, p, amount, label):
        amt = min(amount, p.stack)
        p.stack -= amt
        p.bet += amt
        p.total_in += amt
        if p.stack == 0:
            p.all_in = True
        self.log.append(f"{p.name} が {label} {amt:,}")

    # ---------- 行動 ----------
    def options(self, uid=None) -> dict:
        p = self.current_player()
        if p is None or (uid is not None and p.uid != uid):
            return {}
        to_call = min(self.current_bet - p.bet, p.stack)
        max_to = p.bet + p.stack
        min_to = min(self.current_bet + self.last_raise, max_to)
        return {
            "to_call": to_call,
            "can_check": to_call == 0,
            "can_raise": max_to > self.current_bet and p.stack > to_call,
            "min_raise_to": min_to,
            "max_raise_to": max_to,
            "current_bet": self.current_bet,
        }

    def act(self, uid, action: str, amount: int = 0) -> str:
        """action: fold / check / call / raise（amount はこのラウンドの合計額＝レイズ後の額）/ allin。
        成功したら表示用の文、できない行動なら ValueError"""
        p = self.current_player()
        if p is None or p.uid != uid or self.street not in ("preflop", "flop", "turn", "river"):
            raise ValueError("今はあなたの番ではありません")
        o = self.options()
        t = self._tend(uid)
        facing = o["to_call"] > 0
        if facing:
            t["faced"] += 1
        if action == "allin":
            action, amount = ("raise", o["max_raise_to"]) if o["can_raise"] else ("call", 0)
        if action == "fold":
            p.folded = True
            if facing:
                t["fold"] += 1
            text = f"{p.name} がフォールド"
        elif action == "check":
            if not o["can_check"]:
                raise ValueError("チェックはできません（コールかフォールドを選んでください）")
            t["pas"] += 1
            text = f"{p.name} がチェック"
        elif action == "call":
            if o["to_call"] == 0:
                t["pas"] += 1
                text = f"{p.name} がチェック"
            else:
                amt = o["to_call"]
                p.stack -= amt
                p.bet += amt
                p.total_in += amt
                if p.stack == 0:
                    p.all_in = True
                t["pas"] += 1
                text = f"{p.name} がコール {amt:,}" + ("（オールイン）" if p.all_in else "")
        elif action == "raise":
            if not o["can_raise"]:
                raise ValueError("レイズはできません")
            amount = int(amount)
            if amount < o["min_raise_to"]:
                amount = o["min_raise_to"]
            amount = min(amount, o["max_raise_to"])
            add = amount - p.bet
            prev_bet = self.current_bet
            p.stack -= add
            p.bet = amount
            p.total_in += add
            if p.stack == 0:
                p.all_in = True
            if amount - prev_bet >= self.last_raise:
                self.last_raise = amount - prev_bet
            self.current_bet = max(self.current_bet, amount)
            # レイズされたら、他の人はもう一度行動する
            self.to_act = {q.uid for q in self.players if q.can_act and q.uid != p.uid}
            t["agg"] += 1
            self.raises_this_hand[uid] = self.raises_this_hand.get(uid, 0) + 1
            verb = "ベット" if prev_bet == 0 else "レイズ"
            text = f"{p.name} が{verb} {amount:,}" + ("（オールイン）" if p.all_in else "")
        else:
            raise ValueError("その行動はできません")
        self.to_act.discard(p.uid)
        self.log.append(text)
        self._check_round()
        return text

    def _check_round(self, advance: bool = True):
        """全員の行動が終わったか調べて、次の人・次のストリート・決着へ進める"""
        alive = self.in_hand_players()
        if len(alive) == 1:
            self._finish_uncontested(alive[0])
            return
        self.to_act = {p.uid for p in alive if p.can_act and p.uid in self.to_act}
        actors = [p for p in alive if p.can_act]
        # 行動できるのが1人だけで、その人が追加で払う必要もないなら、このラウンドは終わり
        if len(actors) <= 1 and all(p.bet >= self.current_bet for p in actors):
            self.to_act = set()
        if self.to_act:
            p = self.current_player()
            if advance or p is None or p.uid not in self.to_act:
                self.current = self._next_seat(self.current, lambda q: q.can_act and q.uid in self.to_act)
            return
        self._next_street()

    def _next_street(self):
        for p in self.players:
            p.bet = 0
        self.current_bet = 0
        self.last_raise = self.bb
        alive = self.in_hand_players()
        actors = [p for p in alive if p.can_act]
        if self.street == "preflop":
            self.board += [self.deck.pop() for _ in range(3)]
            self.street = "flop"
        elif self.street == "flop":
            self.board.append(self.deck.pop())
            self.street = "turn"
        elif self.street == "turn":
            self.board.append(self.deck.pop())
            self.street = "river"
        else:
            self._showdown()
            return
        self.log.append(f"— {STREET_NAMES[self.street]}: {cards_text(self.board)}")
        if len(actors) < 2:
            # 行動できるのが1人以下（他は全員オールイン）なら最後までカードを開く
            self.to_act = set()
            self._next_street()
            return
        self.to_act = {p.uid for p in actors}
        self.current = self._next_seat(self.dealer, lambda q: q.can_act)

    # ---------- 決着 ----------
    def _finish_uncontested(self, winner):
        amount = self.pot()
        winner.stack += amount
        self.street = "done"
        self.current = -1
        self.result = {
            "showdown": False,
            "pots": [{"amount": amount, "winners": [winner.uid], "hand": None}],
            "won": {winner.uid: amount},
            "hands": {},
        }
        self.log.append(f"{winner.name} が {amount:,} を獲得（ほかの全員がフォールド）")
        self._clear_bets()

    def _showdown(self):
        self.street = "showdown"
        self.current = -1
        alive = self.in_hand_players()
        scores = {p.uid: evaluate(p.hole + self.board) for p in alive}
        pots = []
        prev = 0
        levels = sorted({p.total_in for p in alive})
        for lvl in levels:
            amt = sum(min(p.total_in, lvl) - min(p.total_in, prev) for p in self.players)
            eligible = [p for p in alive if p.total_in >= lvl]
            if amt > 0:
                pots.append([amt, eligible])
            prev = lvl
        extra = sum(max(0, p.total_in - prev) for p in self.players)
        if extra and pots:
            pots[-1][0] += extra
        won = {}
        pot_results = []
        for amt, eligible in pots:
            best = max(scores[p.uid] for p in eligible)
            winners = [p for p in eligible if scores[p.uid] == best]
            # 端数はディーラーの左から順に
            winners.sort(key=lambda p: (self.players.index(p) - self.dealer - 1) % len(self.players))
            share, odd = divmod(amt, len(winners))
            for i, w in enumerate(winners):
                got = share + (1 if i < odd else 0)
                w.stack += got
                won[w.uid] = won.get(w.uid, 0) + got
            pot_results.append({"amount": amt, "winners": [w.uid for w in winners], "hand": hand_name(best)})
        # 攻めていた人が本当に強かったか（ブラフだったか）を覚えておく（レベル6のAIが使う）
        board_cat = evaluate(self.board)[0]
        for p in alive:
            if self.raises_this_hand.get(p.uid):
                t = self._tend(p.uid)
                t["sd_agg"] = t.get("sd_agg", 0) + 1
                if scores[p.uid][0] <= board_cat:  # 手札で役が良くなっていない＝ブラフ
                    t["sd_bluff"] = t.get("sd_bluff", 0) + 1
        self.result = {
            "showdown": True,
            "pots": pot_results,
            "won": won,
            "hands": {p.uid: (p.hole, hand_name(scores[p.uid])) for p in alive},
        }
        for pr in pot_results:
            names = "・".join(self.players[self.seat_of(u)].name for u in pr["winners"])
            self.log.append(f"{names} が {pr['amount']:,} を獲得（{pr['hand']}）")
        self.street = "done"
        self._clear_bets()

    def _clear_bets(self):
        for p in self.players:
            p.bet = 0


# ============================================================
# AI
# ============================================================
AI_LEVEL_NAMES = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関", 6: "超難関"}
EQUITY_SIMS = {1: 0, 2: 150, 3: 300, 4: 500, 5: 800, 6: 1500}


def _raise_to(table: PokerTable, o: dict, frac: float) -> int:
    """ポットの frac 倍のベット/レイズ額（このラウンドの合計額）"""
    pot = table.pot()
    target = o["current_bet"] + int(max(table.bb, (pot + o["to_call"]) * frac))
    return max(o["min_raise_to"], min(o["max_raise_to"], target))


def ai_decide(table: PokerTable, uid, rng=None):
    """(action, amount) を返す。AI は自分の手札と場のカードだけを見る（相手の手札は見ない）

    レベル1: ほぼ適当
    レベル2: 自分の手の強さだけで判断（ポットオッズも相手も見ない。降りなさすぎる）
    レベル3: ポットオッズで判断。相手が攻めてきたら少しだけ「相手は強い」と考える（ブラフはしない）
    レベル4: 「降りる・コール・ベット」それぞれの期待値を計算して一番得な行動（相手が攻めてきたら強い手を持っていると考える）
    レベル5: さらに相手の傾向（よく攻める・よく降りる）を読んで期待値に反映し、ベット額の選択肢も増やして読まれにくくする
    レベル6: さらにショーダウンで見た相手の手（攻めてきたときにブラフだったか）から相手の読みを毎回直し、
             勝率の見積もりも2倍の精度で計算する
    """
    rng = rng or random
    p = table.players[table.seat_of(uid)]
    level = p.ai_level
    o = table.options(uid)
    to_call, can_check, can_raise = o["to_call"], o["can_check"], o["can_raise"]
    pot = table.pot()
    street = table.street
    opps = [q for q in table.in_hand_players() if q.uid != uid]
    n_opp = max(1, len(opps))

    def fold_or_check():
        return ("check", 0) if can_check else ("fold", 0)

    def call():
        return ("call", 0)

    def bet(frac):
        if not can_raise:
            return call()
        return ("raise", _raise_to(table, o, frac))

    # ---- レベル1: ほぼ適当 ----
    if level <= 1:
        r = rng.random()
        if to_call > 0:
            if r < 0.3:
                return ("fold", 0)
            if r > 0.92 and can_raise:
                return ("raise", o["min_raise_to"])
            return call()
        return bet(0.5) if r > 0.8 else ("check", 0)

    # 相手の傾向
    agg = pas = faced = folds = 0
    for q in opps:
        t = table.tendencies.get(q.uid)
        if t:
            agg += t["agg"]
            pas += t["pas"]
            faced += t["faced"]
            folds += t["fold"]
    aggression = agg / (agg + pas) if agg + pas >= 6 else 0.35
    fold_rate = folds / faced if faced >= 5 else 0.35
    # ショーダウンで見た「攻めてきたのにブラフだった」割合（少ないうちは 25% と仮定して混ぜる）
    sd_agg = sum(table.tendencies.get(q.uid, {}).get("sd_agg", 0) for q in opps)
    sd_bluff = sum(table.tendencies.get(q.uid, {}).get("sd_bluff", 0) for q in opps)
    bluff_rate = (sd_bluff + 0.25 * 4) / (sd_agg + 4)
    opp_raises = max((table.raises_this_hand.get(q.uid, 0) for q in opps), default=0)

    # 相手が攻めてきたとき、相手の手札の幅をどれだけ絞るか（レベル3以上）
    opp_filter, pre_cut = 0.0, 0.33
    if level >= 3 and opp_raises:
        pre_cut = 0.33 if opp_raises == 1 else 0.45
        if level == 3:
            opp_filter = 0.3
        elif level == 4:
            opp_filter = 0.55
        elif level >= 6:
            # 実際にブラフが多い相手ほど、攻めてきても弱い手が混ざっていると考える
            opp_filter = max(0.15, min(0.95, 1.0 - bluff_rate * 2.2))
            if opp_raises >= 2:
                opp_filter = min(0.95, opp_filter + 0.1)
        else:
            # よく攻める相手はブラフも多いので絞りすぎない
            opp_filter = max(0.25, min(0.9, 0.95 - aggression))
            if opp_raises >= 2:
                opp_filter = min(0.95, opp_filter + 0.15)

    eq = equity(p.hole, table.board, n_opp, EQUITY_SIMS.get(level, 500), opp_filter, pre_cut, rng)
    pot_odds = to_call / (pot + to_call) if to_call > 0 else 0.0
    stack_bb = (p.stack + p.bet) / max(1, table.bb)

    # ---- レベル2: 手の強さだけ（降りなさすぎ・ブラフなし） ----
    if level == 2:
        if to_call > 0:
            if eq > 0.88 and can_raise:
                return bet(0.5)
            return call() if eq > 0.33 else ("fold", 0)
        return bet(0.4) if eq > 0.75 else ("check", 0)

    # ---- レベル3: ポットオッズ、たまにブラフ ----
    if level == 3:
        if to_call > 0:
            # 一度レイズした後にさらにレイズし返すのは、とても強い手だけ
            if can_raise and eq > (0.72 if not table.raises_this_hand.get(uid) else 0.9):
                return bet(0.75)
            return call() if eq > pot_odds + 0.05 else ("fold", 0)
        if eq > 0.58:
            return bet(0.66)
        return ("check", 0)

    # ---- レベル4〜6 ----
    my_raises = table.raises_this_hand.get(uid, 0)
    # 短いスタックはオールインかフォールド
    if stack_bb <= 12 and street == "preflop":
        if preflop_strength(p.hole) > (0.42 if to_call > table.bb else 0.33):
            return ("allin", 0)
        return fold_or_check()

    # --- プリフロップ: 手札の強さの段階で決める（標準的なサイズ） ---
    if street == "preflop":
        ps = preflop_strength(p.hole)
        if level >= 5:
            # 攻撃的な相手には少し広く戦う。毎回同じにならないよう少し揺らす
            ps += (aggression - 0.35) * 0.15 + rng.uniform(-0.03, 0.03)
        facing_raise = o["current_bet"] > table.bb
        open_cut, defend_adj = 0.33, 0.0
        if level >= 6:
            # よく降りる相手からは広くブラインドを奪い、よくレイズしてくる相手には広く受けて立つ
            open_cut -= max(0.0, min(0.15, (fold_rate - 0.3) * 0.6))
            defend_adj = max(-0.08, min(0.04, -(aggression - 0.35) * 0.3))
        if not facing_raise:
            if ps >= open_cut and can_raise:
                return ("raise", max(o["min_raise_to"], min(o["max_raise_to"], int(table.bb * 2.5))))
            if to_call > 0:
                return call() if ps >= 0.2 else ("fold", 0)
            return ("check", 0)
        # レイズされている
        if ps >= (0.72 if opp_raises <= 1 else 0.82) and can_raise and my_raises < 2:
            return ("raise", max(o["min_raise_to"], min(o["max_raise_to"], o["current_bet"] * 3)))
        need = 0.3 + defend_adj + 0.08 * max(0, opp_raises - 1) + min(0.2, to_call / max(1, p.stack + p.bet) * 0.4)
        return call() if ps >= need or pot_odds < 0.2 and ps >= 0.24 else ("fold", 0)

    # --- フロップ以降: 期待値で比べる ---
    if level == 4:
        base_fold = 0.3
    else:
        base_fold = (folds + 0.35 * 5) / (faced + 5)
    if opp_raises:
        base_fold *= 0.5  # 強さを見せている相手はなかなか降りない
    call_filter = 0.55 if level == 4 else 0.65
    eq_called = equity(p.hole, table.board, n_opp, EQUITY_SIMS.get(level, 500) // 2,
                       min(0.95, opp_filter + call_filter * (1 - opp_filter)), max(pre_cut, 0.36), rng)
    margin = 0.02 if level == 4 else 0.0
    if level == 5 and to_call > 0 and aggression < 0.25 and street in ("turn", "river"):
        margin += 0.05  # 受け身の相手が後半に攻めてきたら本物

    if to_call > 0:
        ev_call = eq * (pot + to_call) - to_call
        # 強い手はレイズ（すでに何度もレイズし合っているなら、とても強い手だけ）
        need_raise = 0.62 if my_raises == 0 else 0.78
        if can_raise and eq_called > need_raise:
            to = _raise_to(table, o, 0.75)
            add = to - p.bet
            f = base_fold * 0.6
            ev_raise = f * pot + (1 - f) * (eq_called * (pot + add + (to - o["current_bet"]) * n_opp) - add)
            if ev_raise > ev_call:
                return ("raise", to)
        # セミブラフのレイズ（レベル5・よく降りる相手に）
        if level >= 5 and can_raise and my_raises == 0 and street in ("flop", "turn") and 0.3 < eq < 0.5 and fold_rate > 0.6 and rng.random() < 0.15:
            return ("raise", _raise_to(table, o, 0.75))
        return call() if eq > pot_odds + margin else ("fold", 0)

    # 誰もベットしていない: チェックとベット（サイズ別）の期待値を比べる
    ev_check = eq * pot
    best_ev, best = ev_check, ("check", 0)
    if can_raise:
        sizes = (0.5, 0.75) if level == 4 else (0.33, 0.5, 0.75, 1.0) if level == 5 else (0.25, 0.4, 0.6, 0.8, 1.1)
        for frac in sizes:
            to = _raise_to(table, o, frac)
            add = to - p.bet
            f = min(0.8, base_fold * (0.55 + 0.6 * frac)) * (0.6 if n_opp > 1 else 1.0)
            # 大きく賭けるほど、コールしてくる手は強くなる
            eqc = eq_called - 0.04 * frac
            ev = f * pot + (1 - f) * (eqc * (pot + add + add * n_opp) - add)
            if ev > best_ev:
                best_ev, best = ev, ("raise", to)
    return best
