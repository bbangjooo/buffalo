"""Derive ordered pen centerlines from the bundled Allura glyphs.

The exported SVG masks follow the ink's medial line, not the font perimeter or
a horizontal wipe. Allura's original filled outline supplies the nib contrast.
Run with Python + fontTools, Pillow, numpy and scipy. Font license: public/fonts/Allura-OFL.txt.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, label
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / 'public/fonts/Allura-Regular.ttf'
RESOLUTION = 600
UNIT = 100 / RESOLUTION
BASELINE = 80
font = TTFont(FONT)
glyph_set = font.getGlyphSet()
cmap = font.getBestCmap()
pil_font = ImageFont.truetype(str(FONT), RESOLUTION)


def thin(mask):
    """Topology-preserving Zhang–Suen thinning on the glyph raster."""
    skel = np.pad(mask.astype(bool), 1)
    while True:
        changed = False
        for phase in range(2):
            p = [skel[:-2, 1:-1], skel[:-2, 2:], skel[1:-1, 2:], skel[2:, 2:],
                 skel[2:, 1:-1], skel[2:, :-2], skel[1:-1, :-2], skel[:-2, :-2]]
            neighbors = sum(item.astype(np.uint8) for item in p)
            changes = sum((~p[i] & p[(i + 1) % 8]).astype(np.uint8) for i in range(8))
            a = (p[0] & p[2] & p[4]) if phase == 0 else (p[0] & p[2] & p[6])
            b = (p[2] & p[4] & p[6]) if phase == 0 else (p[0] & p[4] & p[6])
            remove = skel[1:-1, 1:-1] & (neighbors >= 2) & (neighbors <= 6) & (changes == 1) & ~a & ~b
            if remove.any():
                skel[1:-1, 1:-1][remove] = False
                changed = True
        if not changed:
            return skel[1:-1, 1:-1]


def simplify(points, tolerance=.11):
    if len(points) <= 2:
        return points
    start, end = np.array(points[0]), np.array(points[-1])
    delta = end - start
    data = np.array(points)
    if np.dot(delta, delta) < 1e-10:
        distances = np.linalg.norm(data - start, axis=1)
    else:
        t = np.clip((data - start) @ delta / np.dot(delta, delta), 0, 1)
        distances = np.linalg.norm(data - start - t[:, None] * delta, axis=1)
    at = int(np.argmax(distances))
    if distances[at] <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def trace_component(pixels, origin, baseline_px):
    pixels = set(pixels)
    graph = {}
    for x, y in pixels:
        neighbors = set()
        for dx, dy in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]:
            other = (x + dx, y + dy)
            if other not in pixels:
                continue
            # Avoid redundant diagonals around a one-pixel right-angle corner.
            if dx and dy and ((x + dx, y) in pixels or (x, y + dy) in pixels):
                continue
            neighbors.add(other)
        graph[(x, y)] = neighbors
    # Remove only tiny medial spurs; isolated dot components remain intact.
    for _ in range(2):
        for point in list(graph):
            if len(graph.get(point, ())) != 1:
                continue
            chain, previous, current = [point], None, point
            while len(chain) <= 4:
                choices = graph.get(current, set()) - ({previous} if previous else set())
                if len(choices) != 1:
                    break
                following = next(iter(choices))
                if len(graph[following]) > 2:
                    for dead in chain:
                        for neighbor in graph.pop(dead, set()):
                            graph.get(neighbor, set()).discard(dead)
                    break
                previous, current = current, following
                chain.append(current)
    edges = {tuple(sorted((point, other))) for point, neighbors in graph.items() for other in neighbors}
    if not edges:
        if not pixels:
            return []
        x = sum(p[0] for p in pixels) / len(pixels)
        y = sum(p[1] for p in pixels) / len(pixels)
        return [[(x, y), (x + .3, y)]]
    trails, last = [], None
    while edges:
        active = {point for edge in edges for point in edge}
        degree = {point: sum(tuple(sorted((point, n))) in edges for n in graph[point]) for point in active}
        ends = [point for point in active if degree[point] == 1]
        candidates = ends or list(active)
        if last is None:
            # Enter a cursive character from its lower-left joining stroke.
            start = min(candidates, key=lambda p: p[0] - origin + abs(p[1] - baseline_px) * .72)
        else:
            start = min(candidates, key=lambda p: math.hypot(p[0] - last[0], p[1] - last[1]))
        current, direction = start, (1, -.3)
        trail = [current]
        while True:
            choices = [n for n in graph[current] if tuple(sorted((current, n))) in edges]
            if not choices:
                break
            def continuity(n):
                dx, dy = n[0] - current[0], n[1] - current[1]
                return (dx * direction[0] + dy * direction[1]) / max(.01, math.hypot(dx, dy) * math.hypot(*direction))
            following = max(choices, key=continuity)
            edges.remove(tuple(sorted((current, following))))
            direction = (following[0] - current[0], following[1] - current[1])
            trail.append(following)
            current = following
        if len(trail) > 1:
            trails.append(trail)
        last = current
    return trails


def build_glyph(char):
    name = cmap[ord(char)]
    glyph = glyph_set[name]
    pen = SVGPathPen(glyph_set, ntos=lambda value: f'{value:.3f}'.rstrip('0').rstrip('.') if value else '0')
    glyph.draw(TransformPen(pen, (0.1, 0, 0, -.1, 0, BASELINE)))
    outline = pen.getCommands()
    bounds_pen = BoundsPen(glyph_set)
    glyph.draw(bounds_pen)
    advance = round(glyph.width * .1, 4)
    if not outline:
        return {'advance': advance, 'bounds': [0, 80, advance, 80], 'outline': '', 'strokes': []}
    x0, y0, x1, y1 = bounds_pen.bounds
    bounds = [round(x0 * .1, 4), round(BASELINE - y1 * .1, 4), round(x1 * .1, 4), round(BASELINE - y0 * .1, 4)]
    bx0, by0, bx1, by1 = pil_font.getbbox(char, anchor='ls')
    origin, baseline_px = 16 - bx0, 16 - by0
    image = Image.new('L', (bx1 - bx0 + 32, by1 - by0 + 32))
    ImageDraw.Draw(image).text((origin, baseline_px), char, font=pil_font, fill=255, anchor='ls')
    mask = np.array(image) > 80
    radii = distance_transform_edt(mask)
    skel = thin(mask)
    components, count = label(skel, structure=np.ones((3, 3)))
    parts = []
    for component in range(1, count + 1):
        ys, xs = np.nonzero(components == component)
        parts.append(list(zip(xs.tolist(), ys.tolist())))
    # Main strokes first; separate i/j dots and punctuation land with a pen lift.
    parts.sort(key=lambda points: (-len(points), min(x for x, y in points)))
    strokes = []
    for part in parts:
        for raw in trace_component(part, origin, baseline_px):
            points = [((x - origin) * UNIT, BASELINE + (y - baseline_px) * UNIT) for x, y in raw]
            points = simplify(points)
            if len(points) < 2:
                continue
            length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
            # The mask covers the original nib's thick downstrokes. The fill
            # itself retains the much finer upstrokes, joins and flourishes.
            radius = max(radii[min(image.height - 1, max(0, round(y))), min(image.width - 1, max(0, round(x)))] for x, y in raw)
            width = max(1.15, radius * UNIT * 2 + .9)
            rounded = [[round(x, 3), round(y, 3)] for x, y in points]
            d = 'M' + ' L'.join(f'{x} {y}' for x, y in rounded)
            strokes.append({'d': d, 'length': round(max(length, .08), 3), 'width': round(width, 3)})
    return {'advance': advance, 'bounds': bounds, 'outline': outline, 'strokes': strokes}


chars = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,’\''
glyphs = {char: build_glyph(char) for char in chars if ord(char) in cmap}
# Read the font's own pair positioning, including class-based kerning.
kerning = {}
for lookup in font['GPOS'].table.LookupList.Lookup:
    if lookup.LookupType != 2:
        continue
    for table in lookup.SubTable:
        for left in glyphs:
            lg = cmap[ord(left)]
            if lg not in table.Coverage.glyphs:
                continue
            for right in glyphs:
                rg, value = cmap[ord(right)], 0
                if table.Format == 1:
                    pairset = table.PairSet[table.Coverage.glyphs.index(lg)]
                    pair = next((p for p in pairset.PairValueRecord if p.SecondGlyph == rg), None)
                    value = getattr(pair.Value1, 'XAdvance', 0) if pair else 0
                elif table.Format == 2:
                    pair = table.Class1Record[table.ClassDef1.classDefs.get(lg, 0)].Class2Record[table.ClassDef2.classDefs.get(rg, 0)]
                    value = getattr(pair.Value1, 'XAdvance', 0)
                if value:
                    kerning[left + right] = round(value * .1, 4)

result = {'unitsPerEm': 100, 'baseline': BASELINE, 'lineHeight': 125,
          'source': 'Allura Regular; SIL Open Font License (public/fonts/Allura-OFL.txt)',
          'glyphs': glyphs, 'kerning': kerning}
output = ROOT / 'src/design/handwriting-glyphs.json'
output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Wrote {output}: {output.stat().st_size:,} bytes, {len(glyphs)} glyphs, {len(kerning)} kern pairs')
for char in 'IabdefgijkptyC.':
    glyph = glyphs[char]
    print(char, len(glyph['strokes']), round(sum(stroke['length'] for stroke in glyph['strokes'])))
