# -*- coding: utf-8 -*-
"""
チェス・将棋の盤面画像（Discord の対局パネル用）。PNG のバイト列を返す。
"""
import io
import os
import urllib.request
from PIL import Image, ImageDraw, ImageFont

import chess_engine as ce
import shogi_engine as se

FONT_DIR = "assets/fonts"
_font_cache = {}


def _download(name: str, url: str):
    path = os.path.join(FONT_DIR, name)
    if os.path.exists(path):
        return path
    try:
        os.makedirs(FONT_DIR, exist_ok=True)
        urllib.request.urlretrieve(url, path)
        return path
    except Exception as e:
        print(f"[board_images] font download failed ({name}): {e}")
        return None


def _font(kind: str, size: int):
    """kind: "chess"（チェスの駒の記号が入ったフォント） / "jp"（漢字） / "latin" """
    key = (kind, size)
    if key in _font_cache:
        return _font_cache[key]
    candidates = []
    if kind == "chess":
        candidates = [
            os.path.join(FONT_DIR, "NotoSansSymbols2-Regular.ttf"),
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "DejaVuSans.ttf",
        ]
    elif kind == "jp":
        candidates = [
            os.path.join(FONT_DIR, "NotoSansJP[wght].ttf"),
            "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
            "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
        ]
    else:
        candidates = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"]
    font = None
    for path in candidates:
        try:
            font = ImageFont.truetype(path, size)
            break
        except Exception:
            continue
    if font is None:
        # 見つからなければ一度だけダウンロードを試す
        path = None
        if kind == "chess":
            path = _download("NotoSansSymbols2-Regular.ttf",
                             "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf")
        elif kind == "jp":
            path = _download("NotoSansJP[wght].ttf",
                             "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf")
        if path:
            try:
                font = ImageFont.truetype(path, size)
            except Exception:
                font = None
    if font is None:
        try:
            font = ImageFont.load_default(size=size)
        except TypeError:
            font = ImageFont.load_default()
    _font_cache[key] = font
    return font


def _has_glyph(font, ch: str) -> bool:
    try:
        return font.getmask(ch).getbbox() is not None
    except Exception:
        return False


def _png(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ============================================================
# チェス
# ============================================================
CHESS_GLYPH = {"k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟"}


def render_chess(state: ce.ChessState, last_move=None, flip: bool = False) -> bytes:
    CELL, M = 64, 30
    size = CELL * 8 + M * 2
    img = Image.new("RGB", (size, size), (49, 46, 43))
    d = ImageDraw.Draw(img)
    light, dark = (240, 217, 181), (181, 136, 99)
    hl_light, hl_dark = (246, 246, 130), (218, 195, 74)
    check_sq = ce.king_square(state.board, state.turn) if ce.in_check(state) else -1
    marks = set(last_move[:2]) if last_move else set()
    piece_font = _font("chess", 52)
    use_glyph = _has_glyph(piece_font, "♚")
    letter_font = _font("latin", 30)
    label_font = _font("latin", 16)

    def pos(sq):
        r, c = divmod(sq, 8)
        if flip:
            r, c = 7 - r, 7 - c
        return M + c * CELL, M + r * CELL

    for sq in range(64):
        r, c = divmod(sq, 8)
        x, y = pos(sq)
        is_light = (r + c) % 2 == 0
        color = (hl_light if is_light else hl_dark) if sq in marks else (light if is_light else dark)
        d.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=color)
        if sq == check_sq:
            d.ellipse([x + 4, y + 4, x + CELL - 5, y + CELL - 5], fill=(235, 80, 80))
        p = state.board[sq]
        if p == ".":
            continue
        white = p.isupper()
        cx, cy = x + CELL // 2, y + CELL // 2
        if use_glyph:
            d.text((cx, cy + 2), CHESS_GLYPH[p.lower()], font=piece_font, anchor="mm",
                   fill=(250, 250, 250) if white else (25, 25, 25),
                   stroke_width=2, stroke_fill=(20, 20, 20) if white else (230, 230, 230))
        else:
            d.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=(250, 250, 250) if white else (30, 30, 30),
                      outline=(20, 20, 20) if white else (220, 220, 220), width=2)
            d.text((cx, cy), p.upper(), font=letter_font, anchor="mm", fill=(20, 20, 20) if white else (240, 240, 240))

    for i in range(8):
        f = ce.FILES[7 - i] if flip else ce.FILES[i]
        rank = str(i + 1) if flip else str(8 - i)
        d.text((M + i * CELL + CELL // 2, size - M // 2), f, font=label_font, anchor="mm", fill=(220, 220, 220))
        d.text((M + i * CELL + CELL // 2, M // 2), f, font=label_font, anchor="mm", fill=(220, 220, 220))
        d.text((M // 2, M + i * CELL + CELL // 2), rank, font=label_font, anchor="mm", fill=(220, 220, 220))
        d.text((size - M // 2, M + i * CELL + CELL // 2), rank, font=label_font, anchor="mm", fill=(220, 220, 220))
    return _png(img)


# ============================================================
# 将棋
# ============================================================
def _shogi_piece_image(text: str, promoted: bool, size: int, font) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = size
    pts = [(w * 0.5, w * 0.06), (w * 0.82, w * 0.2), (w * 0.9, w * 0.94), (w * 0.1, w * 0.94), (w * 0.18, w * 0.2)]
    d.polygon(pts, fill=(247, 222, 170), outline=(120, 80, 30))
    color = (200, 20, 20) if promoted else (20, 20, 20)
    if len(text) == 1:
        d.text((w * 0.5, w * 0.57), text, font=font, anchor="mm", fill=color)
    else:
        small = font.font_variant(size=int(font.size * 0.62)) if hasattr(font, "font_variant") else font
        d.text((w * 0.5, w * 0.42), text[0], font=small, anchor="mm", fill=color)
        d.text((w * 0.5, w * 0.74), text[1], font=small, anchor="mm", fill=color)
    return im


SHOGI_BOARD_KANJI = {**se.KANJI, "+S": "成銀", "+N": "成桂", "+L": "成香"}


def _hand_text(hand: dict) -> str:
    parts = []
    for k in se.HAND_ORDER:
        n = hand.get(k, 0)
        if n:
            parts.append(se.KANJI[k] + (f"×{n}" if n > 1 else ""))
    return " ".join(parts) if parts else "なし"


def render_shogi(state: se.ShogiState, last_move=None) -> bytes:
    CELL, MX, TOP, BOTTOM = 54, 36, 64, 64
    W = CELL * 9 + MX * 2
    H = CELL * 9 + TOP + BOTTOM
    img = Image.new("RGB", (W, H), (60, 42, 26))
    d = ImageDraw.Draw(img)
    jp = _font("jp", 34)
    jp_small = _font("jp", 17)
    use_kanji = _has_glyph(jp, "歩")
    bx, by = MX, TOP
    d.rectangle([bx - 4, by - 4, bx + CELL * 9 + 4, by + CELL * 9 + 4], fill=(222, 178, 108))
    last_to = last_move[1] if last_move else -1
    last_from = last_move[0] if last_move else -1
    check_sq = se.king_square(state.board, state.turn) if se.in_check(state) else -1
    for sq in range(81):
        r, c = divmod(sq, 9)
        x, y = bx + c * CELL, by + r * CELL
        if sq == last_to or sq == last_from:
            d.rectangle([x, y, x + CELL, y + CELL], fill=(240, 205, 120) if sq == last_from else (250, 225, 90))
        if sq == check_sq:
            d.rectangle([x, y, x + CELL, y + CELL], fill=(235, 110, 110))
    for i in range(10):
        d.line([(bx + i * CELL, by), (bx + i * CELL, by + CELL * 9)], fill=(40, 25, 10), width=2 if i in (0, 9) else 1)
        d.line([(bx, by + i * CELL), (bx + CELL * 9, by + i * CELL)], fill=(40, 25, 10), width=2 if i in (0, 9) else 1)
    for (r, c) in ((3, 3), (3, 6), (6, 3), (6, 6)):
        d.ellipse([bx + c * CELL - 3, by + r * CELL - 3, bx + c * CELL + 3, by + r * CELL + 3], fill=(40, 25, 10))
    for sq, p in enumerate(state.board):
        if p is None:
            continue
        r, c = divmod(sq, 9)
        k = se.kind_of(p)
        label = SHOGI_BOARD_KANJI[k] if use_kanji else k
        piece = _shogi_piece_image(label, k.startswith("+"), CELL - 4, jp)
        if se.side_of(p) == se.GOTE:
            piece = piece.rotate(180)
        img.paste(piece, (bx + c * CELL + 2, by + r * CELL + 2), piece)
    for i in range(9):
        d.text((bx + i * CELL + CELL // 2, by - 14), str(9 - i), font=jp_small, anchor="mm", fill=(240, 220, 190))
        d.text((bx + CELL * 9 + 18, by + i * CELL + CELL // 2), se.KANJI_NUM[i], font=jp_small, anchor="mm", fill=(240, 220, 190))
    turn_mark_g = " ◀ 手番" if state.turn == se.GOTE else ""
    turn_mark_s = " ◀ 手番" if state.turn == se.SENTE else ""
    d.text((MX, 18), f"☖ 後手 持ち駒: {_hand_text(state.hands[se.GOTE])}{turn_mark_g}", font=jp_small, anchor="lm", fill=(255, 255, 255))
    d.text((MX, H - 22), f"☗ 先手 持ち駒: {_hand_text(state.hands[se.SENTE])}{turn_mark_s}", font=jp_small, anchor="lm", fill=(255, 255, 255))
    return _png(img)
