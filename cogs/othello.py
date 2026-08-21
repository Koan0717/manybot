# -*- coding: utf-8 -*-
"""
cogs/othello.py
オセロゲーム Cog
PvP / AI対戦、賭け機能、Pillow盤面画像生成、VC自動作成・通話内チャンネル確認
"""

import discord
from discord.ext import commands
import asyncio
import random
import io
from PIL import Image, ImageDraw, ImageFont

import database
from helpers import get_setting, JST

# ============================================================
# モジュールレベル変数
# ============================================================
_bot_instance = None

# セッション管理辞書 key: (guild_id, channel_id) または ("dm", user_id)
game_sessions: dict = {}

# ============================================================
# 位置重みテーブル (AIのLv5で使用)
# ============================================================
WEIGHT_TABLE = [
    [120, -20,  20,  5,  5,  20, -20, 120],
    [-20, -40,  -5, -5, -5,  -5, -40, -20],
    [ 20,  -5,  15,  3,  3,  15,  -5,  20],
    [  5,  -5,   3,  3,  3,   3,  -5,   5],
    [  5,  -5,   3,  3,  3,   3,  -5,   5],
    [ 20,  -5,  15,  3,  3,  15,  -5,  20],
    [-20, -40,  -5, -5, -5,  -5, -40, -20],
    [120, -20,  20,  5,  5,  20, -20, 120],
]

# 8方向
DIRECTIONS = [(-1, -1), (-1, 0), (-1, 1),
              ( 0, -1),          ( 0, 1),
              ( 1, -1), ( 1, 0), ( 1, 1)]


# ============================================================
# OthelloBoard クラス
# ============================================================
class OthelloBoard:
    """8×8のオセロ盤面を管理するクラス。"""

    def __init__(self):
        # 0=空, 1=黒, 2=白
        self.board: list = [[0] * 8 for _ in range(8)]
        # 初期配置
        self.board[3][3] = 2  # 白
        self.board[3][4] = 1  # 黒
        self.board[4][3] = 1  # 黒
        self.board[4][4] = 2  # 白

    def get_valid_moves(self, color: int) -> list:
        """指定色が置ける全マスを返す。"""
        valid = []
        for r in range(8):
            for c in range(8):
                if self.board[r][c] == 0 and self._can_place(r, c, color):
                    valid.append((r, c))
        return valid

    def _can_place(self, row: int, col: int, color: int) -> bool:
        """指定マスに石を置いて相手石を1枚以上ひっくり返せるか判定。"""
        opponent = 3 - color
        for dr, dc in DIRECTIONS:
            r, c = row + dr, col + dc
            count = 0
            while 0 <= r < 8 and 0 <= c < 8 and self.board[r][c] == opponent:
                r += dr
                c += dc
                count += 1
            if count > 0 and 0 <= r < 8 and 0 <= c < 8 and self.board[r][c] == color:
                return True
        return False

    def apply_move(self, row: int, col: int, color: int) -> bool:
        """手を適用し、石をひっくり返す。成功した場合 True を返す。"""
        if self.board[row][col] != 0:
            return False
        if not self._can_place(row, col, color):
            return False
        self.board[row][col] = color
        self.flip_stones(row, col, color)
        return True

    def flip_stones(self, row: int, col: int, color: int):
        """指定位置に置いた色の石を基点に、挟まれた石をすべてひっくり返す。"""
        opponent = 3 - color
        for dr, dc in DIRECTIONS:
            r, c = row + dr, col + dc
            to_flip = []
            while 0 <= r < 8 and 0 <= c < 8 and self.board[r][c] == opponent:
                to_flip.append((r, c))
                r += dr
                c += dc
            if to_flip and 0 <= r < 8 and 0 <= c < 8 and self.board[r][c] == color:
                for fr, fc in to_flip:
                    self.board[fr][fc] = color

    def is_game_over(self) -> bool:
        """双方とも置ける場所がない場合にゲーム終了。"""
        return not self.get_valid_moves(1) and not self.get_valid_moves(2)

    def count_stones(self) -> tuple:
        """(黒の数, 白の数) を返す。"""
        black = sum(row.count(1) for row in self.board)
        white = sum(row.count(2) for row in self.board)
        return black, white

    def get_winner(self) -> int:
        """0=引き分け, 1=黒の勝ち, 2=白の勝ち。"""
        black, white = self.count_stones()
        if black > white:
            return 1
        elif white > black:
            return 2
        return 0

    def copy(self) -> "OthelloBoard":
        """盤面のディープコピーを返す。"""
        new_board = OthelloBoard.__new__(OthelloBoard)
        new_board.board = [row[:] for row in self.board]
        return new_board


# ============================================================
# OthelloAI クラス (5段階難易度)
# ============================================================
class OthelloAI:
    """オセロAI (レベル1〜5)。"""

    def __init__(self, level: int):
        self.level = level

    def get_move(self, board: OthelloBoard, color: int):
        """AIの手を返す。置ける手がない場合は None。"""
        valid_moves = board.get_valid_moves(color)
        if not valid_moves:
            return None

        if self.level == 1:
            return self._random(valid_moves)
        elif self.level == 2:
            return self._greedy(board, color, valid_moves)
        elif self.level == 3:
            return self._minimax_move(board, color, depth=3, use_alpha_beta=False, use_weight=False)
        elif self.level == 4:
            return self._minimax_move(board, color, depth=5, use_alpha_beta=True, use_weight=False)
        else:  # level 5
            return self._minimax_move(board, color, depth=7, use_alpha_beta=True, use_weight=True)

    def _random(self, valid_moves: list) -> tuple:
        """Lv1: ランダムに手を選ぶ。"""
        return random.choice(valid_moves)

    def _greedy(self, board: OthelloBoard, color: int, valid_moves: list) -> tuple:
        """Lv2: 最も多くの石を獲得できる手を選ぶ。"""
        best_move = None
        best_count = -1
        for r, c in valid_moves:
            tmp = board.copy()
            tmp.apply_move(r, c, color)
            my_count = sum(row.count(color) for row in tmp.board)
            if my_count > best_count:
                best_count = my_count
                best_move = (r, c)
        return best_move or valid_moves[0]

    def _minimax_move(self, board: OthelloBoard, color: int, depth: int, use_alpha_beta: bool, use_weight: bool) -> tuple:
        """Lv3〜5: minimax (alpha-beta) で最善手を選ぶ。"""
        valid_moves = board.get_valid_moves(color)
        if not valid_moves:
            return None

        best_move = valid_moves[0]
        best_score = float('-inf')
        alpha = float('-inf')
        beta = float('inf')

        for r, c in valid_moves:
            tmp = board.copy()
            tmp.apply_move(r, c, color)
            score = self._minimax(tmp, 3 - color, color, depth - 1, alpha, beta, False, use_alpha_beta, use_weight)
            if score > best_score:
                best_score = score
                best_move = (r, c)
            if use_alpha_beta:
                alpha = max(alpha, best_score)

        return best_move

    def _minimax(self, board: OthelloBoard, current_color: int, ai_color: int, depth: int,
                 alpha: float, beta: float, is_maximizing: bool,
                 use_alpha_beta: bool, use_weight: bool) -> float:
        """ミニマックス探索 (再帰)。"""
        if depth == 0 or board.is_game_over():
            return self._evaluate(board, ai_color, use_weight)

        valid_moves = board.get_valid_moves(current_color)

        # パスの場合
        if not valid_moves:
            return self._minimax(board, 3 - current_color, ai_color, depth - 1,
                                 alpha, beta, not is_maximizing, use_alpha_beta, use_weight)

        if is_maximizing:
            best = float('-inf')
            for r, c in valid_moves:
                tmp = board.copy()
                tmp.apply_move(r, c, current_color)
                val = self._minimax(tmp, 3 - current_color, ai_color, depth - 1,
                                    alpha, beta, False, use_alpha_beta, use_weight)
                best = max(best, val)
                if use_alpha_beta:
                    alpha = max(alpha, best)
                    if beta <= alpha:
                        break
            return best
        else:
            best = float('inf')
            for r, c in valid_moves:
                tmp = board.copy()
                tmp.apply_move(r, c, current_color)
                val = self._minimax(tmp, 3 - current_color, ai_color, depth - 1,
                                    alpha, beta, True, use_alpha_beta, use_weight)
                best = min(best, val)
                if use_alpha_beta:
                    beta = min(beta, best)
                    if beta <= alpha:
                        break
            return best

    def _evaluate(self, board: OthelloBoard, ai_color: int, use_weight: bool) -> float:
        """盤面評価関数。"""
        opponent = 3 - ai_color
        if use_weight:
            score = 0
            for r in range(8):
                for c in range(8):
                    if board.board[r][c] == ai_color:
                        score += WEIGHT_TABLE[r][c]
                    elif board.board[r][c] == opponent:
                        score -= WEIGHT_TABLE[r][c]
            return score
        else:
            my = sum(row.count(ai_color) for row in board.board)
            op = sum(row.count(opponent) for row in board.board)
            return my - op


# ============================================================
# 盤面画像生成
# ============================================================
def generate_board_image(board: OthelloBoard, valid_moves: list) -> discord.File:
    """
    Pillowを使って8×8の盤面画像を生成し、discord.File として返す。
    valid_moves: [(row, col), ...] 左上から右下の順に番号付け
    """
    CELL = 60          # 1マスのピクセル数
    MARGIN = 30        # 行・列ラベル用のマージン
    SIZE = CELL * 8 + MARGIN  # 画像サイズ (510px)

    COLOR_BG = (45, 125, 70)       # 盤面の緑
    COLOR_GRID = (0, 0, 0)         # グリッド線
    COLOR_BLACK = (26, 26, 26)     # 黒石
    COLOR_WHITE = (245, 245, 245)  # 白石
    COLOR_HINT = (255, 215, 0)     # 設置可能マスの番号色
    COLOR_LABEL = (255, 255, 255)  # ラベル文字色

    img = Image.new("RGB", (SIZE, SIZE), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # フォントの取得
    try:
        font = ImageFont.truetype("arial.ttf", 16)
        font_large = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
            font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
        except Exception:
            font = ImageFont.load_default()
            font_large = font

    # 列ラベル (1-8)
    for c in range(8):
        x = MARGIN + c * CELL + CELL // 2
        try:
            draw.text((x, 8), str(c + 1), fill=COLOR_LABEL, font=font, anchor="mm")
        except Exception:
            draw.text((x - 4, 2), str(c + 1), fill=COLOR_LABEL, font=font)

    # 行ラベル (A-H)
    for r in range(8):
        y = MARGIN + r * CELL + CELL // 2
        try:
            draw.text((10, y), chr(ord('A') + r), fill=COLOR_LABEL, font=font, anchor="mm")
        except Exception:
            draw.text((2, y - 8), chr(ord('A') + r), fill=COLOR_LABEL, font=font)

    # グリッド線
    for i in range(9):
        x = MARGIN + i * CELL
        draw.line([(x, MARGIN), (x, SIZE)], fill=COLOR_GRID, width=1)
        y = MARGIN + i * CELL
        draw.line([(MARGIN, y), (SIZE, y)], fill=COLOR_GRID, width=1)

    # 設置可能マスを番号でインデックス付け (左上→右下順)
    hint_map = {}
    for idx, (r, c) in enumerate(valid_moves):
        hint_map[(r, c)] = idx + 1

    # 各マスを描画
    PAD = 5  # 石の余白
    for r in range(8):
        for c in range(8):
            x0 = MARGIN + c * CELL + PAD
            y0 = MARGIN + r * CELL + PAD
            x1 = MARGIN + (c + 1) * CELL - PAD
            y1 = MARGIN + (r + 1) * CELL - PAD
            cx = MARGIN + c * CELL + CELL // 2
            cy = MARGIN + r * CELL + CELL // 2

            cell_val = board.board[r][c]
            if cell_val == 1:
                draw.ellipse([x0, y0, x1, y1], fill=COLOR_BLACK)
            elif cell_val == 2:
                draw.ellipse([x0, y0, x1, y1], fill=COLOR_WHITE)
            elif (r, c) in hint_map:
                num = hint_map[(r, c)]
                try:
                    draw.text((cx, cy), str(num), fill=COLOR_HINT, font=font_large, anchor="mm")
                except Exception:
                    draw.text((cx - 6, cy - 9), str(num), fill=COLOR_HINT, font=font_large)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return discord.File(buf, filename="othello_board.png")


# ============================================================
# セッション管理
# ============================================================
class OthelloSession:
    """オセロゲームの1セッションを管理するデータクラス。"""

    def __init__(self, black_id: int, white_id,
                 channel_id: int, guild_id,
                 bet: int = 0, is_dm: bool = False,
                 is_ai: bool = False, ai_level: int = 1):
        self.board = OthelloBoard()
        self.current_color: int = 1          # 1=黒(先手), 2=白(後手)
        self.black_id: int = black_id        # 黒石プレイヤーのユーザーID
        self.white_id = white_id             # 白石プレイヤーのユーザーID (AI時は None)
        self.channel_id: int = channel_id
        self.guild_id = guild_id
        self.bet: int = bet
        self.is_dm: bool = is_dm
        self.is_ai: bool = is_ai
        self.ai_level: int = ai_level
        self.board_message_id = None         # 盤面メッセージのID
        self.pending_move = None             # 選択中の手

    @property
    def current_player_id(self):
        """現在のターンのプレイヤーIDを返す。AIターンは None。"""
        if self.current_color == 1:
            return self.black_id
        else:
            if self.is_ai:
                return None  # AIのターン
            return self.white_id

    def session_key(self):
        """セッションキーを返す。"""
        if self.is_dm:
            return ("dm", self.black_id)
        return (self.guild_id, self.channel_id)


# ============================================================
# 盤面表示 (内部共通関数)
# ============================================================
async def show_game_board(channel, session: OthelloSession):
    """盤面メッセージを更新または新規送信する (MoveRequestView付き)。"""
    valid_moves = session.board.get_valid_moves(session.current_color)
    board_file = generate_board_image(session.board, valid_moves)

    black, white = session.board.count_stones()
    color_name = "⚫ 黒" if session.current_color == 1 else "⬜ 白"

    if session.is_ai and session.current_color == 2:
        level_names = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関"}
        lname = level_names.get(session.ai_level, str(session.ai_level))
        turn_text = f"🤖 AI (Lv{session.ai_level}: {lname}) が思考中..."
    else:
        player_id = session.black_id if session.current_color == 1 else session.white_id
        turn_text = f"{color_name} <@{player_id}> のターン"

    embed = discord.Embed(
        title="♟️ オセロ対戦",
        description=f"{turn_text}\n\n⚫ 黒: **{black}** 石  |  ⬜ 白: **{white}** 石",
        color=discord.Color.dark_green()
    )

    bot = _bot_instance
    if session.bet > 0 and bot and session.guild_id:
        currency_name = get_setting(bot, "CURRENCY_NAME", session.guild_id) or "コイン"
        embed.add_field(name="💰 賭け金 (ポット)", value=f"{session.bet * 2:,} {currency_name}", inline=True)

    embed.set_image(url="attachment://othello_board.png")

    # 既存の盤面メッセージを削除
    try:
        if session.board_message_id:
            old_msg = await channel.fetch_message(session.board_message_id)
            await old_msg.delete()
    except Exception:
        pass

    # AIターン中はボタン不要
    if session.is_ai and session.current_color == 2:
        view = None
    else:
        view = MoveRequestView(session)

    msg = await channel.send(embed=embed, file=board_file, view=view)
    session.board_message_id = msg.id


# ============================================================
# ゲームフロー関数
# ============================================================
async def start_game(channel, session: OthelloSession):
    """ゲームを開始する。盤面を送信し、最初のターンを処理する。"""
    await show_game_board(channel, session)
    await process_turn(channel, session)


async def process_turn(channel, session: OthelloSession):
    """現在のターン処理。AIターンの場合は自動で手を打つ。"""
    valid_moves = session.board.get_valid_moves(session.current_color)

    # 置ける手がない場合はパス
    if not valid_moves:
        opponent_moves = session.board.get_valid_moves(3 - session.current_color)
        if not opponent_moves:
            # 双方パス → ゲーム終了
            winner = session.board.get_winner()
            await end_game(channel, session, winner)
            return
        else:
            # パスして相手のターンへ
            color_name = "⚫ 黒" if session.current_color == 1 else "⬜ 白"
            await channel.send(f"⏩ {color_name} は置ける場所がないためパスします。", delete_after=5)
            session.current_color = 3 - session.current_color
            await show_game_board(channel, session)
            await process_turn(channel, session)
            return

    # AIのターンの場合
    if session.is_ai and session.current_color == 2:
        await asyncio.sleep(1.0)  # 思考中の演出
        ai = OthelloAI(session.ai_level)
        move = ai.get_move(session.board, 2)
        if move:
            row, col = move
            session.board.apply_move(row, col, 2)
            col_label = str(col + 1)
            row_label = chr(ord('A') + row)
            await channel.send(f"🤖 AI が **{row_label}{col_label}** に置きました。", delete_after=8)

        # ゲーム終了チェック
        if session.board.is_game_over():
            winner = session.board.get_winner()
            await end_game(channel, session, winner)
            return

        # 人間のターンへ
        session.current_color = 1
        await show_game_board(channel, session)
        return


async def process_move(interaction: discord.Interaction, session: OthelloSession, row: int, col: int):
    """手を適用し、次のターンへ進む。"""
    channel = interaction.channel

    # 手を適用
    success = session.board.apply_move(row, col, session.current_color)
    if not success:
        await interaction.response.send_message("❌ その手は無効です。", ephemeral=True)
        return

    col_label = str(col + 1)
    row_label = chr(ord('A') + row)
    color_name = "⚫ 黒" if session.current_color == 1 else "⬜ 白"
    await channel.send(f"{color_name} が **{row_label}{col_label}** に置きました。", delete_after=8)

    # ゲーム終了チェック
    if session.board.is_game_over():
        winner = session.board.get_winner()
        await end_game(channel, session, winner)
        return

    # ターンを交代
    session.current_color = 3 - session.current_color
    await show_game_board(channel, session)
    await process_turn(channel, session)


async def end_game(channel, session: OthelloSession, winner: int):
    """ゲーム終了処理。結果表示と賭け精算を行う。"""
    bot = _bot_instance
    black, white = session.board.count_stones()

    # 最終盤面を表示
    final_file = generate_board_image(session.board, [])
    embed = discord.Embed(
        title="♟️ オセロ ゲーム終了",
        color=discord.Color.gold()
    )
    embed.add_field(name="⚫ 黒", value=f"{black} 石", inline=True)
    embed.add_field(name="⬜ 白", value=f"{white} 石", inline=True)

    if winner == 0:
        embed.description = "🤝 引き分け！"
        embed.color = discord.Color.light_grey()
    elif winner == 1:
        embed.description = f"🏆 ⚫ 黒 <@{session.black_id}> の勝利！"
    else:
        if session.is_ai:
            embed.description = "🤖 AI (白) の勝利！"
        else:
            embed.description = f"🏆 ⬜ 白 <@{session.white_id}> の勝利！"

    embed.set_image(url="attachment://othello_board.png")

    # 賭け精算
    if session.bet > 0 and session.guild_id and bot:
        currency_name = get_setting(bot, "CURRENCY_NAME", session.guild_id) or "コイン"
        try:
            if winner == 0:
                # 引き分け: 両者に返金
                await database.add_balance(session.guild_id, session.black_id, session.bet)
                if not session.is_ai and session.white_id:
                    await database.add_balance(session.guild_id, session.white_id, session.bet)
                embed.add_field(
                    name="💰 賭け精算",
                    value=f"引き分けのため各 **{session.bet:,} {currency_name}** 返金",
                    inline=False
                )
            elif winner == 1:
                # 黒の勝ち
                prize = session.bet * 2 if not session.is_ai else session.bet
                await database.add_balance(session.guild_id, session.black_id, prize)
                embed.add_field(
                    name="💰 賭け精算",
                    value=f"⚫ 黒 <@{session.black_id}> が **{prize:,} {currency_name}** 獲得！",
                    inline=False
                )
            else:
                # 白の勝ち
                if session.is_ai:
                    embed.add_field(
                        name="💰 賭け精算",
                        value=f"AI の勝利。**{session.bet:,} {currency_name}** 没収。",
                        inline=False
                    )
                else:
                    prize = session.bet * 2
                    await database.add_balance(session.guild_id, session.white_id, prize)
                    embed.add_field(
                        name="💰 賭け精算",
                        value=f"⬜ 白 <@{session.white_id}> が **{prize:,} {currency_name}** 獲得！",
                        inline=False
                    )
        except Exception as e:
            print(f"[ERROR] end_game 賭け精算: {e}")

    try:
        await channel.send(embed=embed, file=final_file)
    except Exception as e:
        print(f"[ERROR] end_game send: {e}")

    # セッション削除
    key = session.session_key()
    game_sessions.pop(key, None)


# ============================================================
# MoveSelectView: 手選択 View (エフェメラル)
# ============================================================
class MoveSelectView(discord.ui.View):
    """有効な手の番号ボタンを表示し、プレイヤーが手を選択するView。"""

    def __init__(self, session: OthelloSession, valid_moves: list):
        super().__init__(timeout=120)
        self.session = session
        self.valid_moves = valid_moves
        self.selected_index = None
        self.confirm_button = None

        # 番号ボタンを動的に追加 (最大25個、4行に収める)
        for idx, (r, c) in enumerate(valid_moves[:25]):
            col_label = str(c + 1)
            row_label = chr(ord('A') + r)
            btn = discord.ui.Button(
                label=f"{idx + 1}: {row_label}{col_label}",
                style=discord.ButtonStyle.secondary,
                custom_id=f"othello_move_{idx}_{session.channel_id}",
                row=min(idx // 5, 3)
            )
            btn.callback = self._make_select_callback(idx)
            self.add_item(btn)

        # 「確定」ボタン (初期 disabled)
        confirm = discord.ui.Button(
            label="✅ 確定",
            style=discord.ButtonStyle.success,
            custom_id=f"othello_confirm_{session.channel_id}",
            disabled=True,
            row=4
        )
        confirm.callback = self._confirm_callback
        self.confirm_button = confirm
        self.add_item(confirm)

        # 「降伏・終了」ボタン
        resign_btn = discord.ui.Button(
            label="🏳️ 降伏・終了",
            style=discord.ButtonStyle.danger,
            custom_id=f"othello_modal_resign_{session.channel_id}",
            row=4
        )
        resign_btn.callback = self._resign_callback
        self.add_item(resign_btn)

    def _make_select_callback(self, idx: int):
        async def callback(interaction: discord.Interaction):
            # 本人チェック
            if interaction.user.id != self.session.current_player_id:
                return await interaction.response.send_message("あなたのターンではありません。", ephemeral=True)

            self.selected_index = idx
            r, c = self.valid_moves[idx]
            col_label = str(c + 1)
            row_label = chr(ord('A') + r)

            # 確定ボタンを有効化
            if self.confirm_button:
                self.confirm_button.disabled = False

            # 選択したボタンを強調
            for item in self.children:
                if isinstance(item, discord.ui.Button) and not item.custom_id.startswith("othello_confirm"):
                    item.style = discord.ButtonStyle.secondary
            for item in self.children:
                if isinstance(item, discord.ui.Button) and item.custom_id == f"othello_move_{idx}_{self.session.channel_id}":
                    item.style = discord.ButtonStyle.primary

            embed = discord.Embed(
                title="♟️ 手を選択中",
                description=f"選択中: **{row_label}{col_label}** (番号 {idx + 1})\n\n「✅ 確定」を押して決定してください。",
                color=discord.Color.blurple()
            )
            await interaction.response.edit_message(embed=embed, view=self)
        return callback

    async def _confirm_callback(self, interaction: discord.Interaction):
        """確定ボタンのコールバック。"""
        if interaction.user.id != self.session.current_player_id:
            return await interaction.response.send_message("あなたのターンではありません。", ephemeral=True)
        if self.selected_index is None:
            return await interaction.response.send_message("手を選択してください。", ephemeral=True)

        row, col = self.valid_moves[self.selected_index]
        self.stop()

        await interaction.response.edit_message(
            content="✅ 手を確定しました。",
            embed=None,
            view=None
        )

        await process_move(interaction, self.session, row, col)

    async def _resign_callback(self, interaction: discord.Interaction):
        """降伏・強制終了ボタンのコールバック。"""
        if interaction.user.id != self.session.current_player_id:
            return await interaction.response.send_message("あなたのターンではありません。", ephemeral=True)

        self.stop()
        confirm_view = ConfirmResignView(self.session, interaction.user.id)
        if self.session.is_ai:
            desc = "本当にAI対戦を途中で終了（降伏）しますか？\n※賭け金がある場合は没収されます。"
        else:
            desc = "本当に降伏してゲームを終了しますか？\n※相手プレイヤーの勝利となり、賭け金がある場合は相手に付与されます。"

        embed = discord.Embed(
            title="⚠️ ゲーム終了・降伏の確認",
            description=desc,
            color=discord.Color.red()
        )
        await interaction.response.edit_message(content=None, embed=embed, view=confirm_view)

    async def on_timeout(self):
        """タイムアウト時は自動的にランダムな手を選択する。"""
        if self.session and self.valid_moves:
            key = self.session.session_key()
            if key in game_sessions:
                bot = _bot_instance
                if bot:
                    try:
                        channel = bot.get_channel(self.session.channel_id)
                        if channel:
                            r, c = random.choice(self.valid_moves)
                            self.session.board.apply_move(r, c, self.session.current_color)
                            col_label = str(c + 1)
                            row_label = chr(ord('A') + r)
                            color_name = "⚫ 黒" if self.session.current_color == 1 else "⬜ 白"
                            await channel.send(
                                f"⏰ タイムアウト！ {color_name} が自動で **{row_label}{col_label}** に置きました。",
                                delete_after=10
                            )
                            if self.session.board.is_game_over():
                                winner = self.session.board.get_winner()
                                await end_game(channel, self.session, winner)
                            else:
                                self.session.current_color = 3 - self.session.current_color
                                await show_game_board(channel, self.session)
                                await process_turn(channel, self.session)
                    except Exception as e:
                        print(f"[ERROR] MoveSelectView.on_timeout: {e}")


# ============================================================
# ConfirmResignView: 強制終了・降伏確認 View (エフェメラル)
# ============================================================
class ConfirmResignView(discord.ui.View):
    """ゲーム降伏・強制終了の確認View。"""

    def __init__(self, session: OthelloSession, user_id: int):
        super().__init__(timeout=60)
        self.session = session
        self.user_id = user_id

    @discord.ui.button(label="🏳️ 降伏して終了する", style=discord.ButtonStyle.danger)
    async def confirm_resign(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.user_id:
            return await interaction.response.send_message("あなた専用の確認画面ではありません。", ephemeral=True)

        key = self.session.session_key()
        if key not in game_sessions:
            self.stop()
            return await interaction.response.edit_message(
                content="❌ 既にゲームは終了しています。", embed=None, view=None
            )

        self.stop()
        await interaction.response.edit_message(
            content="🏳️ ゲームを終了しました。", embed=None, view=None
        )

        channel = interaction.channel
        # 勝者の決定: 降伏した側の反対が勝者
        if self.session.is_ai:
            winner = 2  # AIの勝利
            await channel.send(f"🏳️ <@{self.user_id}> がゲームを降伏・終了しました。")
        else:
            if self.user_id == self.session.black_id:
                winner = 2  # 白の勝利
                await channel.send(f"🏳️ ⚫ <@{self.user_id}> が降伏しました。")
            else:
                winner = 1  # 黒の勝利
                await channel.send(f"🏳️ ⬜ <@{self.user_id}> が降伏しました。")

        await end_game(channel, self.session, winner)

    @discord.ui.button(label="キャンセル", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.user_id:
            return await interaction.response.send_message("あなた専用の確認画面ではありません。", ephemeral=True)
        self.stop()
        await interaction.response.edit_message(
            content="ゲームを継続します。", embed=None, view=None
        )


# ============================================================
# MoveRequestView: 「手を選ぶ」「強制終了」ボタン
# ============================================================
class MoveRequestView(discord.ui.View):
    """「手を選ぶ」「強制終了」ボタンを盤面メッセージに付けるView。"""

    def __init__(self, session: OthelloSession):
        super().__init__(timeout=180)
        self.session = session

    @discord.ui.button(label="♟️ 手を選ぶ", style=discord.ButtonStyle.primary)
    async def select_move(self, interaction: discord.Interaction, button: discord.ui.Button):
        """クリックしたプレイヤーに手選択用のエフェメラルViewを送る。"""
        key = self.session.session_key()
        if key not in game_sessions:
            return await interaction.response.send_message("ゲームが終了しています。", ephemeral=True)

        session = game_sessions[key]

        # ターンのプレイヤーチェック
        if interaction.user.id != session.current_player_id:
            return await interaction.response.send_message(
                "現在あなたのターンではありません。", ephemeral=True
            )

        valid_moves = session.board.get_valid_moves(session.current_color)
        if not valid_moves:
            return await interaction.response.send_message(
                "置ける場所がありません。", ephemeral=True
            )

        move_view = MoveSelectView(session, valid_moves)
        embed = discord.Embed(
            title="♟️ 手を選択",
            description="番号ボタンで手を選んで「✅ 確定」を押してください。",
            color=discord.Color.blurple()
        )
        await interaction.response.send_message(embed=embed, view=move_view, ephemeral=True)

    @discord.ui.button(label="🏳️ 降伏・終了", style=discord.ButtonStyle.danger)
    async def resign_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        """ゲーム参加者が降伏・強制終了するボタン。"""
        key = self.session.session_key()
        if key not in game_sessions:
            return await interaction.response.send_message("ゲームが終了しています。", ephemeral=True)

        session = game_sessions[key]

        # 参加者チェック
        valid_players = [session.black_id]
        if not session.is_ai and session.white_id:
            valid_players.append(session.white_id)

        if interaction.user.id not in valid_players:
            return await interaction.response.send_message(
                "このゲームの対戦プレイヤーではありません。", ephemeral=True
            )

        confirm_view = ConfirmResignView(session, interaction.user.id)
        if session.is_ai:
            desc = "本当にAI対戦を途中で終了（降伏）しますか？\n※賭け金がある場合は没収されます。"
        else:
            desc = "本当に降伏してゲームを終了しますか？\n※相手プレイヤーの勝利となり、賭け金がある場合は相手に付与されます。"

        embed = discord.Embed(
            title="⚠️ ゲーム終了・降伏の確認",
            description=desc,
            color=discord.Color.red()
        )
        await interaction.response.send_message(embed=embed, view=confirm_view, ephemeral=True)


# ============================================================
# BetInputModal: 賭け金入力モーダル
# ============================================================
class BetInputModal(discord.ui.Modal, title="オセロ：賭け金入力"):
    bet_input = discord.ui.TextInput(
        label="賭ける金額",
        placeholder="例: 1000",
        max_length=10,
        required=True
    )

    def __init__(self, next_callback):
        super().__init__()
        self.next_callback = next_callback  # (interaction, bet) を受け取る非同期関数

    async def on_submit(self, interaction: discord.Interaction):
        try:
            bet = int(self.bet_input.value)
            if bet <= 0:
                return await interaction.response.send_message("1以上の金額を入力してください。", ephemeral=True)
            await self.next_callback(interaction, bet)
        except ValueError:
            await interaction.response.send_message("数字を入力してください。", ephemeral=True)
        except Exception as e:
            print(f"[ERROR] BetInputModal: {e}")
            if not interaction.response.is_done():
                await interaction.response.send_message("エラーが発生しました。", ephemeral=True)


# ============================================================
# DifficultySelectView: AI難易度選択 (Lv1〜Lv5)
# ============================================================
class DifficultySelectView(discord.ui.View):
    """AI対戦の難易度を選択するView。"""

    def __init__(self, initiator_id: int):
        super().__init__(timeout=60)
        self.initiator_id = initiator_id

    async def _handle_level(self, interaction: discord.Interaction, level: int):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)

        bot = interaction.client
        guild_id = interaction.guild.id if interaction.guild else None
        bet_enabled = get_setting(bot, "OTHELLO_BET_ENABLED", guild_id)

        if bet_enabled and (str(bet_enabled).lower() == "true" or bet_enabled is True):
            async def on_bet(it: discord.Interaction, bet: int):
                await _start_ai_game(it, level, bet)
            modal = BetInputModal(next_callback=on_bet)
            await interaction.response.send_modal(modal)
        else:
            await interaction.response.defer(ephemeral=True)
            await _start_ai_game(interaction, level, 0)

    @discord.ui.button(label="レベル1（簡単）", style=discord.ButtonStyle.secondary, row=0)
    async def lv1(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._handle_level(interaction, 1)

    @discord.ui.button(label="レベル2（普通）", style=discord.ButtonStyle.secondary, row=0)
    async def lv2(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._handle_level(interaction, 2)

    @discord.ui.button(label="レベル3（中級）", style=discord.ButtonStyle.primary, row=1)
    async def lv3(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._handle_level(interaction, 3)

    @discord.ui.button(label="レベル4（難しい）", style=discord.ButtonStyle.primary, row=1)
    async def lv4(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._handle_level(interaction, 4)

    @discord.ui.button(label="レベル5（最難関）", style=discord.ButtonStyle.danger, row=2)
    async def lv5(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._handle_level(interaction, 5)


async def _start_ai_game(interaction: discord.Interaction, ai_level: int, bet: int):
    """AI対戦を開始する内部関数。DM内でゲームを行う。"""
    bot = interaction.client
    guild_id = interaction.guild.id if interaction.guild else None

    # 賭け金チェック
    if bet > 0 and guild_id:
        balance = await database.get_balance(guild_id, interaction.user.id)
        currency_name = get_setting(bot, "CURRENCY_NAME", guild_id) or "コイン"
        if balance < bet:
            msg = f"残高不足です。現在の残高: {balance:,} {currency_name}"
            if not interaction.response.is_done():
                return await interaction.response.send_message(msg, ephemeral=True)
            else:
                return await interaction.followup.send(msg, ephemeral=True)
        await database.remove_balance(guild_id, interaction.user.id, bet)

    # DMチャンネルを開く
    try:
        dm_channel = await interaction.user.create_dm()
    except discord.Forbidden:
        msg = "DMを送れませんでした。プライバシー設定でBotからのDMを許可してください。"
        if not interaction.response.is_done():
            return await interaction.response.send_message(msg, ephemeral=True)
        else:
            return await interaction.followup.send(msg, ephemeral=True)

    # セッションキーチェック (DM)
    key = ("dm", interaction.user.id)
    if key in game_sessions:
        msg = "DMで既にゲームが進行中です。先にゲームを終了してください。"
        if not interaction.response.is_done():
            return await interaction.response.send_message(msg, ephemeral=True)
        else:
            return await interaction.followup.send(msg, ephemeral=True)

    # セッション作成
    session = OthelloSession(
        black_id=interaction.user.id,
        white_id=None,
        channel_id=dm_channel.id,
        guild_id=guild_id,
        bet=bet,
        is_dm=True,
        is_ai=True,
        ai_level=ai_level
    )
    game_sessions[key] = session

    # エフェメラルで通知
    level_names = {1: "簡単", 2: "普通", 3: "中級", 4: "難しい", 5: "最難関"}
    level_name = level_names.get(ai_level, str(ai_level))
    msg = f"✅ AI対戦 (レベル{ai_level}: {level_name}) を開始します！DMをご確認ください。\nあなたは ⚫ 黒 です。"

    try:
        if not interaction.response.is_done():
            await interaction.response.send_message(msg, ephemeral=True)
        else:
            await interaction.followup.send(msg, ephemeral=True)
    except Exception:
        pass

    # DM内でゲーム開始
    await start_game(dm_channel, session)


# ============================================================
# OpponentSelectView: PvP 対戦相手選択
# ============================================================
class OpponentSelectView(discord.ui.View):
    """PvP対戦の相手をUserSelectで選ぶView。"""

    def __init__(self, initiator_id: int):
        super().__init__(timeout=120)
        self.initiator_id = initiator_id
        self.selected_user = None

    @discord.ui.select(
        cls=discord.ui.UserSelect,
        placeholder="対戦相手を選択...",
        min_values=1,
        max_values=1
    )
    async def user_select(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
        self.selected_user = select.values[0]
        await interaction.response.defer()

    @discord.ui.button(label="✅ 選択を確定", style=discord.ButtonStyle.success)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
        if not self.selected_user:
            return await interaction.response.send_message("対戦相手を先に選択してください。", ephemeral=True)
        if self.selected_user.id == self.initiator_id:
            return await interaction.response.send_message("自分自身とは対戦できません。", ephemeral=True)
        if self.selected_user.bot:
            return await interaction.response.send_message("Botとは対戦できません。AI対戦を選択してください。", ephemeral=True)

        self.stop()

        # 開始者が通話（VC）に入っているかチェック
        bot = interaction.client
        guild = interaction.guild
        member = guild.get_member(self.initiator_id) if guild else None
        in_vc = (member and member.voice and member.voice.channel)

        auto_vc_setting = get_setting(bot, "OTHELLO_AUTO_VC_ENABLED", guild.id if guild else None)
        auto_vc_enabled = (str(auto_vc_setting).lower() == "true" or auto_vc_setting is True)

        vc_view = VCCheckView(self.initiator_id, self.selected_user, in_vc, auto_vc_enabled)
        
        if in_vc:
            vc_name = member.voice.channel.name
            prompt = (
                f"対戦相手: {self.selected_user.mention}\n\n"
                f"現在ボイスチャンネル「**{vc_name}**」に接続中です。\n"
                f"この通話のテキストチャンネルにゲームボードを設置しますか？"
            )
        else:
            if auto_vc_enabled:
                prompt = (
                    f"対戦相手: {self.selected_user.mention}\n\n"
                    f"現在ボイスチャンネルに接続していません。\n"
                    f"ダッシュボードの設定に基づき、専用の対戦VCを新しく作成します。"
                )
            else:
                prompt = (
                    f"対戦相手: {self.selected_user.mention}\n\n"
                    f"対戦ゲームを行う場所を確認してください。"
                )

        await interaction.response.edit_message(
            content=prompt,
            view=vc_view
        )


# ============================================================
# VCCheckView: ゲームチャンネル選択
# ============================================================
class VCCheckView(discord.ui.View):
    """PvPゲームを行うチャンネルを決定するView。"""

    def __init__(self, initiator_id: int, opponent: discord.Member, in_vc: bool, auto_vc_enabled: bool):
        super().__init__(timeout=60)
        self.initiator_id = initiator_id
        self.opponent = opponent
        self.in_vc = in_vc
        self.auto_vc_enabled = auto_vc_enabled

        # ボタンを条件に応じて動的に調整
        self.clear_items()

        if self.in_vc:
            btn_yes = discord.ui.Button(
                label="通話のテキストチャンネルに設置する",
                style=discord.ButtonStyle.success,
                custom_id="othello_vc_yes"
            )
            btn_yes.callback = self.use_vc_channel
            self.add_item(btn_yes)

            btn_no_label = "設置しない（専用VCを作成または指定CHで対戦）" if self.auto_vc_enabled else "設置しない（パネル/指定CHで対戦）"
            btn_no = discord.ui.Button(
                label=btn_no_label,
                style=discord.ButtonStyle.secondary,
                custom_id="othello_vc_no"
            )
            btn_no.callback = self.use_other_channel
            self.add_item(btn_no)
        else:
            btn_proceed = discord.ui.Button(
                label="対戦招待を送信する",
                style=discord.ButtonStyle.primary,
                custom_id="othello_proceed"
            )
            btn_proceed.callback = self.use_other_channel
            self.add_item(btn_proceed)

        btn_cancel = discord.ui.Button(
            label="キャンセル",
            style=discord.ButtonStyle.danger,
            custom_id="othello_cancel"
        )
        btn_cancel.callback = self.cancel
        self.add_item(btn_cancel)

    async def use_vc_channel(self, interaction: discord.Interaction):
        """通話のテキストチャンネルに対戦ボードを設置"""
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)

        guild = interaction.guild
        member = guild.get_member(self.initiator_id) if guild else None
        target_channel = None

        if member and member.voice and member.voice.channel:
            vc = member.voice.channel
            # VC自体のテキストチャンネル（Discord v2のVoiceChannelテキストチャット）
            target_channel = vc

        if not target_channel:
            target_channel = interaction.channel

        self.stop()
        await _send_pvp_invitation(interaction, self.opponent, target_channel)

    async def use_other_channel(self, interaction: discord.Interaction):
        """専用VC作成または指定チャンネルで対戦"""
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)

        bot = interaction.client
        guild = interaction.guild
        guild_id = guild.id if guild else None
        target_channel = None

        auto_vc = get_setting(bot, "OTHELLO_AUTO_VC_ENABLED", guild_id)
        if auto_vc and (str(auto_vc).lower() == "true" or auto_vc is True):
            category_id_raw = get_setting(bot, "OTHELLO_VC_CATEGORY_ID", guild_id)
            vc_name = get_setting(bot, "OTHELLO_VC_NAME", guild_id) or "オセロ対戦"
            try:
                category = guild.get_channel(int(category_id_raw)) if category_id_raw else None
                # 専用VCを作成（VoiceChannel自体にテキストチャットあり）
                target_channel = await guild.create_voice_channel(
                    name=vc_name,
                    category=category,
                    reason="オセロ対戦用専用VC自動作成"
                )
            except Exception as e:
                print(f"[ERROR] 専用VC自動作成失敗: {e}")

        if not target_channel:
            game_channel_id_raw = get_setting(bot, "OTHELLO_GAME_CHANNEL", guild_id)
            if game_channel_id_raw:
                try:
                    target_channel = guild.get_channel(int(game_channel_id_raw))
                except Exception:
                    pass

        if not target_channel:
            target_channel = interaction.channel

        self.stop()
        await _send_pvp_invitation(interaction, self.opponent, target_channel)

    async def cancel(self, interaction: discord.Interaction):
        if interaction.user.id != self.initiator_id:
            return await interaction.response.send_message("あなた専用の選択ではありません。", ephemeral=True)
        self.stop()
        await interaction.response.edit_message(content="対戦の作成をキャンセルしました。", view=None)


async def _send_pvp_invitation(interaction: discord.Interaction, opponent: discord.Member, game_channel):
    """PvPの招待メッセージを対象チャンネルに送信する。"""
    bot = interaction.client
    guild_id = interaction.guild.id if interaction.guild else None
    key = (guild_id, game_channel.id)

    if key in game_sessions:
        msg = f"❌ {game_channel.mention} では既にゲームが進行中です。"
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.edit_message(content=msg, view=None)
        return

    bet_enabled = get_setting(bot, "OTHELLO_BET_ENABLED", guild_id)
    default_bet_raw = get_setting(bot, "OTHELLO_DEFAULT_BET", guild_id)
    bet = 0
    if bet_enabled and (str(bet_enabled).lower() == "true" or bet_enabled is True):
        try:
            bet = int(default_bet_raw) if default_bet_raw else 0
        except Exception:
            bet = 0

    initiator = interaction.user
    invite_view = InvitationView(
        initiator_id=initiator.id,
        opponent_id=opponent.id,
        game_channel=game_channel,
        guild_id=guild_id,
        bet=bet
    )

    currency_name = get_setting(bot, "CURRENCY_NAME", guild_id) or "コイン"
    bet_text = f"\n💰 賭け金: **{bet:,} {currency_name}**" if bet > 0 else ""
    content = (
        f"♟️ **オセロ対戦の招待**\n"
        f"{initiator.mention} から {opponent.mention} へ対戦申し込みがありました！{bet_text}\n"
        f"ゲームチャンネル: {game_channel.mention}\n\n"
        f"120秒以内に応答してください。"
    )

    try:
        if not interaction.response.is_done():
            if game_channel.id == interaction.channel.id:
                await interaction.response.edit_message(content="✅ 招待を送りました！", view=None)
            else:
                await interaction.response.edit_message(
                    content=f"✅ {game_channel.mention} に招待を送りました！", view=None
                )
        await game_channel.send(content=content, view=invite_view)
    except Exception as e:
        print(f"[ERROR] _send_pvp_invitation: {e}")


# ============================================================
# InvitationView: 招待 View (公開メッセージ)
# ============================================================
class InvitationView(discord.ui.View):
    """PvP招待の承諾/拒否Viewクラス。"""

    def __init__(self, initiator_id: int, opponent_id: int,
                 game_channel, guild_id, bet: int):
        super().__init__(timeout=120)
        self.initiator_id = initiator_id
        self.opponent_id = opponent_id
        self.game_channel = game_channel
        self.guild_id = guild_id
        self.bet = bet

    @discord.ui.button(label="✅ 承諾する", style=discord.ButtonStyle.success)
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id != self.opponent_id:
            return await interaction.response.send_message("あなた宛ての招待ではありません。", ephemeral=True)

        bot = interaction.client
        key = (self.guild_id, self.game_channel.id)

        if key in game_sessions:
            self.stop()
            return await interaction.response.edit_message(
                content="❌ このチャンネルでは既にゲームが進行中です。", view=None
            )

        # 賭け金チェック
        if self.bet > 0 and self.guild_id:
            currency_name = get_setting(bot, "CURRENCY_NAME", self.guild_id) or "コイン"
            initiator_balance = await database.get_balance(self.guild_id, self.initiator_id)
            if initiator_balance < self.bet:
                self.stop()
                return await interaction.response.edit_message(
                    content="❌ 招待者の残高が不足しているため、ゲームを開始できません。", view=None
                )
            opponent_balance = await database.get_balance(self.guild_id, self.opponent_id)
            if opponent_balance < self.bet:
                return await interaction.response.send_message(
                    f"残高が不足しています。現在の残高: {opponent_balance:,} {currency_name}", ephemeral=True
                )
            await database.remove_balance(self.guild_id, self.initiator_id, self.bet)
            await database.remove_balance(self.guild_id, self.opponent_id, self.bet)

        # セッション作成 (招待者=黒, 承諾者=白)
        session = OthelloSession(
            black_id=self.initiator_id,
            white_id=self.opponent_id,
            channel_id=self.game_channel.id,
            guild_id=self.guild_id,
            bet=self.bet,
            is_dm=False,
            is_ai=False,
            ai_level=1
        )
        game_sessions[key] = session

        self.stop()
        await interaction.response.edit_message(
            content=(
                f"✅ 対戦が承諾されました！ゲームを開始します。\n"
                f"⚫ 黒: <@{self.initiator_id}>  vs  ⬜ 白: <@{self.opponent_id}>"
            ),
            view=None
        )

        await start_game(self.game_channel, session)

    @discord.ui.button(label="❌ 断る", style=discord.ButtonStyle.danger)
    async def decline(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id not in (self.opponent_id, self.initiator_id):
            return await interaction.response.send_message("あなた宛ての招待ではありません。", ephemeral=True)

        self.stop()
        await interaction.response.edit_message(
            content=f"❌ {interaction.user.mention} が対戦を辞退しました。", view=None
        )

    async def on_timeout(self):
        """タイムアウト時"""
        pass


# ============================================================
# OthelloPanelView: メインパネル View (persistent)
# ============================================================
class OthelloPanelView(discord.ui.View):
    """オセロ対戦パネルView (persistent)。"""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="👥 PvP対戦",
        style=discord.ButtonStyle.primary,
        custom_id="othello_panel_pvp"
    )
    async def pvp_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        bot = interaction.client
        guild_id = interaction.guild.id if interaction.guild else None
        key = (guild_id, interaction.channel.id)

        if key in game_sessions:
            return await interaction.response.send_message(
                "このチャンネルで既にゲームが進行中です。", ephemeral=True
            )

        view = OpponentSelectView(initiator_id=interaction.user.id)
        await interaction.response.send_message(
            "♟️ **PvP対戦**\n対戦相手を選択してください。",
            view=view,
            ephemeral=True
        )

    @discord.ui.button(
        label="🤖 AI対戦",
        style=discord.ButtonStyle.secondary,
        custom_id="othello_panel_ai"
    )
    async def ai_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        view = DifficultySelectView(initiator_id=interaction.user.id)
        await interaction.response.send_message(
            "🤖 **AI対戦**\nAIの難易度を選択してください。\n（AI対戦はDMで行われます）",
            view=view,
            ephemeral=True
        )


# ============================================================
# OthelloCog
# ============================================================
class OthelloCog(commands.Cog):
    """オセロゲーム Cog。"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        global _bot_instance
        _bot_instance = bot

    async def cog_load(self):
        """Cog ロード時に persistent View を登録する。"""
        self.bot.add_view(OthelloPanelView())

    @commands.command(name="othello_end")
    async def force_end(self, ctx: commands.Context):
        """管理者がゲームを強制終了するコマンド。"""
        if not ctx.author.guild_permissions.administrator:
            return await ctx.send("このコマンドは管理者専用です。", delete_after=5)

        guild_id = ctx.guild.id if ctx.guild else None
        key = (guild_id, ctx.channel.id)

        if key not in game_sessions:
            return await ctx.send("このチャンネルで進行中のゲームはありません。", delete_after=5)

        session = game_sessions.pop(key)

        # 賭け金返金
        if session.bet > 0 and guild_id:
            try:
                await database.add_balance(guild_id, session.black_id, session.bet)
                if not session.is_ai and session.white_id:
                    await database.add_balance(guild_id, session.white_id, session.bet)
            except Exception as e:
                print(f"[ERROR] force_end 返金: {e}")

        await ctx.send("🛑 ゲームを強制終了しました。賭け金は返金されました。")


# ============================================================
# setup 関数
# ============================================================
async def setup(bot: commands.Bot):
    await bot.add_cog(OthelloCog(bot))
