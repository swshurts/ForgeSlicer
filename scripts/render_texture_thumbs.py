"""Render schematic thumbnails of each texture pattern for the PDF tutorial.

These are NOT rendered from the actual Three.js geometry — they're hand-drawn
PIL diagrams that match the geometric character of each pattern. The goal
is to give the reader an at-a-glance "what does this look like?" reference
without needing to bake & screenshot every pattern from the live app.

Output: /tmp/forge-tex-thumbs/<pattern_id>.png (256×256 PNG, transparent BG)
"""
from PIL import Image, ImageDraw, ImageFont
import math
import os
import random

OUT = "/tmp/forge-tex-thumbs"
os.makedirs(OUT, exist_ok=True)
SIZE = 256
PAD = 16
FG = (245, 158, 11, 255)        # orange-400 — texture relief
SHADOW = (180, 90, 5, 200)      # darker orange — depth shading
BG = (15, 23, 42, 255)          # slate-900
GRID = (51, 65, 85, 255)


def base(name):
    img = Image.new("RGBA", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)
    # Light grid for visual reference
    step = 32
    for x in range(0, SIZE, step):
        d.line([(x, 0), (x, SIZE)], fill=GRID, width=1)
    for y in range(0, SIZE, step):
        d.line([(0, y), (SIZE, y)], fill=GRID, width=1)
    return img, d


def knurl_diamond():
    img, d = base("knurl_diamond")
    step = 22
    for i in range(-1, 13):
        for j in range(-1, 13):
            cx, cy = i * step + 11, j * step + 11
            # Rotated square = diamond
            pts = [(cx, cy - 9), (cx + 9, cy), (cx, cy + 9), (cx - 9, cy)]
            d.polygon(pts, fill=FG, outline=SHADOW)
    img.save(f"{OUT}/knurl_diamond.png")


def hex_pattern():
    img, d = base("hex")
    r = 16
    h = r * math.sqrt(3) / 2
    rows = int(SIZE / (1.5 * r)) + 2
    cols = int(SIZE / (2 * h)) + 2
    for row in range(-1, rows + 1):
        for col in range(-1, cols + 1):
            cx = col * 2 * h + (h if row % 2 else 0)
            cy = row * 1.5 * r
            pts = [
                (cx + r * math.cos(math.pi / 3 * a + math.pi / 6),
                 cy + r * math.sin(math.pi / 3 * a + math.pi / 6))
                for a in range(6)
            ]
            d.polygon(pts, fill=FG, outline=SHADOW)
    img.save(f"{OUT}/hex.png")


def bumps():
    img, d = base("bumps")
    step = 24
    r = 9
    for i in range(0, 12):
        for j in range(0, 12):
            cx = i * step + 12
            cy = j * step + 12
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FG, outline=SHADOW)
    img.save(f"{OUT}/bumps.png")


def ridges_linear():
    img, d = base("ridges_linear")
    step = 20
    # Horizontal half-cylinder grooves drawn as gradient stripes
    for j in range(0, SIZE + step, step):
        d.rectangle([(0, j), (SIZE, j + step // 2)], fill=FG, outline=SHADOW)
    img.save(f"{OUT}/ridges_linear.png")


def diamond_plate():
    img, d = base("diamond_plate")
    step = 40
    for i in range(0, 8):
        for j in range(0, 8):
            cx = i * step + 16
            cy = j * step + 16
            # Pinwheel: 4 diamonds rotated around centre
            for ang in range(0, 360, 90):
                rad = math.radians(ang)
                dx = 12 * math.cos(rad)
                dy = 12 * math.sin(rad)
                pts = [(cx + dx - 4, cy + dy), (cx + dx, cy + dy - 4),
                       (cx + dx + 4, cy + dy), (cx + dx, cy + dy + 4)]
                d.polygon(pts, fill=FG, outline=SHADOW)
    img.save(f"{OUT}/diamond_plate.png")


def brick():
    img, d = base("brick")
    w, h = 50, 20
    for row, y in enumerate(range(0, SIZE + h, h + 2)):
        offset = (w // 2) if row % 2 else 0
        for x in range(-offset, SIZE + w, w + 3):
            d.rectangle([(x, y), (x + w, y + h)], fill=FG, outline=SHADOW)
    img.save(f"{OUT}/brick.png")


def fabric():
    img, d = base("fabric")
    # Alternating warp (vertical) + weft (horizontal) "yarns"
    step = 18
    yarn_w = 10
    for i, x in enumerate(range(0, SIZE + step, step)):
        if i % 2 == 0:
            d.rectangle([(x, 0), (x + yarn_w, SIZE)], fill=FG, outline=SHADOW)
    for i, y in enumerate(range(0, SIZE + step, step)):
        if i % 2 == 1:
            d.rectangle([(0, y), (SIZE, y + yarn_w)], fill=FG, outline=SHADOW)
    img.save(f"{OUT}/fabric.png")


def hex_camo():
    img, d = base("hex_camo")
    random.seed(42)
    r = 18
    h = r * math.sqrt(3) / 2
    rows = int(SIZE / (1.5 * r)) + 2
    cols = int(SIZE / (2 * h)) + 2
    for row in range(-1, rows + 1):
        for col in range(-1, cols + 1):
            cx = col * 2 * h + (h if row % 2 else 0)
            cy = row * 1.5 * r
            # Randomised brightness — taller cells appear lighter
            shade = random.randint(140, 250)
            fill = (245, shade, 11, 255)
            pts = [
                (cx + r * math.cos(math.pi / 3 * a + math.pi / 6),
                 cy + r * math.sin(math.pi / 3 * a + math.pi / 6))
                for a in range(6)
            ]
            d.polygon(pts, fill=fill, outline=SHADOW)
    img.save(f"{OUT}/hex_camo.png")


def voronoi():
    img, d = base("voronoi")
    random.seed(7)
    # 12 random seed points, draw the cell boundaries by sampling
    seeds = [(random.randint(20, SIZE - 20), random.randint(20, SIZE - 20)) for _ in range(14)]
    # For each pixel grid cell, find nearest seed; draw boundary where neighbours differ
    cells = {}
    G = 4  # grid step (faster than per-pixel)
    for y in range(0, SIZE, G):
        for x in range(0, SIZE, G):
            best = 0
            bd = 1e9
            for k, (sx, sy) in enumerate(seeds):
                dd = (x - sx) ** 2 + (y - sy) ** 2
                if dd < bd: bd, best = dd, k
            cells[(x, y)] = best
    # Fill each cell with FG, draw seed boundaries
    for (x, y), k in cells.items():
        d.rectangle([(x, y), (x + G, y + G)], fill=FG)
    for (x, y), k in cells.items():
        for (dx, dy) in [(G, 0), (0, G)]:
            n = cells.get((x + dx, y + dy))
            if n is not None and n != k:
                d.line([(x, y), (x + dx, y + dy)], fill=SHADOW, width=2)
    img.save(f"{OUT}/voronoi.png")


for fn in (knurl_diamond, hex_pattern, bumps, ridges_linear,
           diamond_plate, brick, fabric, hex_camo, voronoi):
    fn()
    print(f"  rendered {fn.__name__}")

print(f"\nThumbnails in {OUT}/")
