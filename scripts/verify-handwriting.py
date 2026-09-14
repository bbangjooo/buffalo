"""Compare completed stroke masks with the independently rasterized source font."""
from pathlib import Path
import json
import math
import re
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'src/design/handwriting-glyphs.json').read_text())
font = ImageFont.truetype(str(ROOT / 'public/fonts/Allura-Regular.ttf'), 600)
scale = 600 / data['unitsPerEm']
worst = (1.0, '')
for character, glyph in data['glyphs'].items():
    if not glyph['outline']:
        assert glyph['advance'] > 0
        continue
    x0, y0, x1, y1 = font.getbbox(character, anchor='ls')
    origin, baseline = 16 - x0, 16 - y0
    expected = Image.new('L', (x1 - x0 + 32, y1 - y0 + 32))
    ImageDraw.Draw(expected).text((origin, baseline), character, font=font, fill=255, anchor='ls')
    ink = np.array(expected) > 80
    painted = Image.new('L', expected.size)
    draw = ImageDraw.Draw(painted)
    for stroke in glyph['strokes']:
        values = [float(value) for value in re.findall(r'-?\d+(?:\.\d+)?', stroke['d'])]
        assert len(values) >= 4 and len(values) % 2 == 0
        points = list(zip(values[::2], values[1::2]))
        length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
        assert abs(length - stroke['length']) < .03, (character, 'incorrect timing length')
        pixels = [(x * scale + origin, (y - data['baseline']) * scale + baseline) for x, y in points]
        width = stroke['width'] * scale
        draw.line(pixels, fill=255, width=math.ceil(width), joint='curve')
        for x, y in pixels:
            draw.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=255)
    coverage = np.count_nonzero(ink & (np.array(painted) > 0)) / np.count_nonzero(ink)
    if coverage < worst[0]:
        worst = (coverage, character)
    assert coverage > .99, (character, f'{coverage:.2%} coverage: visible ink would pop in at completion')
print(f'PASS all {len(data["glyphs"])} glyphs reconstruct the original Allura ink; minimum coverage {worst[0]:.2%} ({worst[1]!r})')
print('PASS stroke timing lengths match the pen paths, and spaces retain their advance')
