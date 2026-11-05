"""拡張アイコン（独自デザイン）を生成する。
複数の部屋の空き枠を1本の時間軸に並べて比べる、という機能をそのまま図にしている。
Chrome の推奨に合わせ、128px では周囲16pxを透明余白にして中央96pxに描く。
実行: python3 tools/make_icons.py （Pillow が必要）
"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024                      # 高解像度で描いて縮小（縁を滑らかにする）
PAD = S * 16 // 128           # 128px 換算で16pxの余白
BG = (26, 115, 232)           # 青（ポップアップのアクセント色と同じ）
CARD = (255, 255, 255)
GREEN = (52, 168, 83)         # 空き
GRAY = (200, 205, 212)        # 空きなし

ROWS = [                      # (開始, 終了) を 0..1 の割合で。色は空き/空きなし
    [(0.00, 0.30, GREEN), (0.36, 0.64, GRAY), (0.70, 1.00, GREEN)],
    [(0.00, 0.30, GRAY), (0.36, 0.64, GREEN), (0.70, 1.00, GREEN)],
    [(0.00, 0.30, GREEN), (0.36, 0.64, GREEN), (0.70, 1.00, GRAY)],
]


def draw() -> Image.Image:
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = (PAD, PAD, S - PAD, S - PAD)
    d.rounded_rectangle(box, radius=(S - 2 * PAD) * 0.22, fill=BG)

    inner = (S - 2 * PAD)
    m = inner * 0.16
    card = (PAD + m, PAD + m, S - PAD - m, S - PAD - m)
    d.rounded_rectangle(card, radius=inner * 0.08, fill=CARD)

    cx0, cy0, cx1, cy1 = card
    pad = (cx1 - cx0) * 0.10
    x0, x1 = cx0 + pad, cx1 - pad
    y0, y1 = cy0 + pad, cy1 - pad
    row_h = (y1 - y0) / len(ROWS)
    bar_h = row_h * 0.62
    for i, row in enumerate(ROWS):
        top = y0 + i * row_h + (row_h - bar_h) / 2
        for a, b, color in row:
            d.rounded_rectangle((x0 + (x1 - x0) * a, top, x0 + (x1 - x0) * b, top + bar_h),
                                radius=bar_h * 0.28, fill=color)
    return img


def main() -> None:
    out = Path(__file__).resolve().parent.parent / 'icons'
    out.mkdir(exist_ok=True)
    big = draw()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(out / f'icon{size}.png')
    print('written:', sorted(p.name for p in out.glob('icon*.png')))


if __name__ == '__main__':
    main()
