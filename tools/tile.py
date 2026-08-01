#!/usr/bin/env python3
"""Tile a manifest of captures into one labelled contact sheet.

Used by the animation tools: a stride or a pose set can only be judged side by side.
Usage: tile.py <manifest.json> <out.png> [cols]
"""
import json
import sys

from PIL import Image, ImageDraw

manifest, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 0

man = json.load(open(manifest))
shots = man["shots"]
items = [(s, "") if isinstance(s, str) else (s["file"], s.get("label", "")) for s in shots]

ims = [Image.open(f).convert("RGB") for f, _ in items]
w, h = ims[0].size
n = len(ims)
if not cols:
    cols = min(n, 10)
rows = (n + cols - 1) // cols
pad, bar = 4, 16

sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + bar + pad) + pad), (18, 20, 26))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    r, c = divmod(i, cols)
    x = pad + c * (w + pad)
    y = pad + r * (h + bar + pad)
    sheet.paste(im, (x, y))
    label = items[i][1] or str(i)
    d.text((x + 3, y + h + 3), label, fill=(210, 220, 235))
sheet.save(out)
print(f"{out}  {sheet.size[0]}x{sheet.size[1]}  ({n} frames, {cols}x{rows})")
