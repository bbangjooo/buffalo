"""Reusable village furnishings, authored as white surfaces and selective ink.

Coordinates are Three.js x/y/z; every public prop starts at ground level.
Only the passed Drawing instance is mutated. There is no Blender state or IO.
"""

from math import cos, pi, sin, sqrt


WHITE = (1, 1, 1, 1)
INK = (.009, .009, .009, 1)
SOFT = (.04, .04, .04, 1)


def _ring(center, radius, n=14):
    x, y, z = center
    return [(x + cos(2 * pi * i / n) * radius, y,
             z + sin(2 * pi * i / n) * radius) for i in range(n)]


def _outlined(d, points, width=.016, color=WHITE):
    d.polygon(points, color=color)
    d.stroke(points, width=width, cyclic=True)


def _crate(d, center, size):
    """Closed plank crate with a crossed brace and restrained corner hatching."""
    x, y, z = center
    w, h, depth = size
    d.box(center, size)
    for k in range(1, 4):
        xx = x - w / 2 + w * k / 4
        d.stroke([(xx, y - h / 2, z + depth / 2 + .009),
                  (xx + .004, y + h / 2, z + depth / 2 + .009)], .010)
        d.stroke([(xx, y + h / 2 + .009, z - depth / 2),
                  (xx, y + h / 2 + .009, z + depth / 2)], .010)
    for side in (-1, 1):
        zz = z + side * (depth / 2 + .019)
        _outlined(d, [(x - w * .43 - .016, y - h * .38 + .022, zz),
                      (x + w * .43 - .016, y + h * .38 + .022, zz),
                      (x + w * .43 + .016, y + h * .38 - .022, zz),
                      (x - w * .43 + .016, y - h * .38 - .022, zz)], .011)
    for k in range(4):
        xx = x - w * .41 + k * .042
        d.stroke([(xx, y - h * .41, z + depth / 2 + .012),
                  (xx + .048, y - h * .23, z + depth / 2 + .012)], .009,
                 color=SOFT)


def barrel(d, center=(0, 0, 0), scale=1):
    """A .65 m stave barrel with bulging sides, two hoops and a plank lid."""
    cx, cy, cz = center
    n = 14
    profile = [(0, .205), (.12, .252), (.33, .276), (.53, .25), (.65, .205)]
    rings = [_ring((cx, cy + y * scale, cz), radius * scale, n)
             for y, radius in profile]
    for lower, upper in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            d.polygon([lower[i], lower[j], upper[j], upper[i]])
    for i in range(n):
        d.stroke([ring[i] for ring in rings], .009 * scale)
    d.polygon(rings[0][::-1])
    d.polygon(rings[-1])
    for ring in (rings[0], rings[-1]):
        d.stroke(ring, .017 * scale, cyclic=True)

    # Broad white hoops have two ink edges, leaving the staves readable.
    for height, radius in ((.12, .259), (.52, .26)):
        low = _ring((cx, cy + (height - .025) * scale, cz), radius * scale, n)
        high = _ring((cx, cy + (height + .025) * scale, cz), radius * scale, n)
        for i in range(n):
            j = (i + 1) % n
            d.polygon([low[i], low[j], high[j], high[i]])
        d.stroke(low, .013 * scale, cyclic=True)
        d.stroke(high, .013 * scale, cyclic=True)

    for xx in (-.115, -.04, .04, .115):
        half_length = sqrt(.20 ** 2 - xx ** 2)
        d.stroke([(cx + xx * scale, cy + .657 * scale, cz - half_length * scale),
                  (cx + xx * scale, cy + .657 * scale, cz + half_length * scale)],
                 .010 * scale)
    # Sparse wood scratches on only a few of the outward-facing staves.
    for i in (2, 3, 8, 9):
        a = (i + .38) * 2 * pi / n
        d.stroke([(cx + cos(a) * .269 * scale, cy + .22 * scale,
                   cz + sin(a) * .269 * scale),
                  (cx + cos(a + .015) * .28 * scale, cy + .35 * scale,
                   cz + sin(a + .015) * .28 * scale),
                  (cx + cos(a - .008) * .269 * scale, cy + .43 * scale,
                   cz + sin(a - .008) * .269 * scale)], .008 * scale,
                 color=SOFT)


def well(d):
    """Open stone well: .85 m basin radius and a 2.8 m pitched timber roof."""
    n = 14
    outer_radius, inner_radius, height = .85, .60, .86
    outside = [_ring((0, y, 0), outer_radius, n) for y in (.025, height)]
    inside = [_ring((0, y, 0), inner_radius, n) for y in (.35, height)]
    for i in range(n):
        j = (i + 1) % n
        d.polygon([outside[0][i], outside[0][j], outside[1][j], outside[1][i]])
        d.polygon([inside[0][j], inside[0][i], inside[1][i], inside[1][j]])
        d.polygon([outside[1][i], outside[1][j], inside[1][j], inside[1][i]])
        d.stroke([inside[1][i], outside[1][i]], .012)
    d.polygon(_ring((0, .355, 0), inner_radius, n), color=SOFT)
    for ring in (outside[0], outside[1], inside[1]):
        d.stroke(ring, .020, cyclic=True)

    # Staggered masonry courses; the middle joints follow the faceted surface.
    for row in range(3):
        low = .025 + row * .278
        top = low + .278
        if row:
            d.stroke(_ring((0, low, 0), .855, n), .013, cyclic=True)
        for i in range(n):
            a = 2 * pi * (i + (row % 2) * .5) / n
            radius = .856 if row % 2 == 0 else .85 * cos(pi / n) + .007
            p = (cos(a) * radius, low, sin(a) * radius)
            d.stroke([p, (p[0], top, p[2])], .011)
            if (i + row) % 4 == 0:
                # The bottom-left of selected blocks holds the darkest marks.
                for mark in range(3):
                    aa = a + .04 + mark * .035
                    surface_r = .85 * cos(pi / n) / cos(aa % (2 * pi / n) - pi / n)
                    d.stroke([(cos(aa) * (surface_r + .008), low + .04,
                               sin(aa) * (surface_r + .008)),
                              (cos(aa + .025) * (surface_r + .008), low + .105,
                               sin(aa + .025) * (surface_r + .008))], .009,
                             color=SOFT)

    for x in (-.99, .99):
        d.box((x, 1.10, 0), (.15, 2.20, .18))
        d.stroke([(x - .025, .18, .095), (x - .016, .93, .095),
                  (x - .03, 1.75, .095)], .010)
        d.beam((x, 1.88, 0), (x * .65, 2.26, 0), .10)
    d.beam((-1.12, 1.42, 0), (1.16, 1.42, 0), .12)
    d.stroke([(1.17, 1.42, 0), (1.17, 1.13, 0), (1.36, 1.13, 0)], .06)
    for step in range(6):
        x = -.095 + step * .035
        d.stroke([(x, 1.36, -.05), (x, 1.485, -.05),
                  (x, 1.485, .06), (x, 1.36, .06)], .015)
    d.stroke([(.04, 1.37, .04), (.035, .91, .05), (.07, .53, .04)], .024)

    for sign in (-1, 1):
        z = sign * .97
        _outlined(d, [(-1.20, 2.23, z), (1.20, 2.23, z),
                      (1.20, 2.80, 0), (-1.20, 2.80, 0)], .023)
        d.beam((-1.20, 2.20, z), (1.20, 2.20, z), .10)
        for x in (-1.12, 1.12):
            d.beam((x, 2.22, z), (x, 2.77, 0), .08)
        for i in range(1, 10):
            x = -1.20 + i * .24
            d.stroke([(x, 2.24, z), (x + .008 * sin(i), 2.806, 0)], .012)
            if i % 3 == 0:
                for j in range(3):
                    offset = j * .04
                    d.stroke([(x + .04 + offset, 2.245, z * .99),
                              (x + .09 + offset, 2.34, z * .82)], .009,
                             color=SOFT)
    d.stroke([(-1.23, 2.805, 0), (1.23, 2.805, 0)], .034)


def market(d):
    """2.8 x 1.9 m market stall with a pitched cloth awning and produce crates."""
    for x in (-1.23, 1.23):
        for z in (-.73, .73):
            d.box((x, 1.02, z), (.10, 2.04, .10))
            d.stroke([(x + .018, .14, z + .058),
                      (x + .005, 1.62, z + .058)], .008)
        d.beam((x, 1.69, -.73), (x, 1.99, -.40), .065)
        d.beam((x, 1.69, .73), (x, 1.99, .40), .065)

    # Slightly bowed seams and the scalloped valance suggest stretched cloth.
    for sign in (-1, 1):
        z = sign * .95
        _outlined(d, [(-1.40, 2.06, z), (1.40, 2.06, z),
                      (1.40, 2.50, 0), (-1.40, 2.50, 0)], .020)
        d.beam((-1.29, 2.02, sign * .76), (1.29, 2.02, sign * .76), .065)
        for i in range(1, 8):
            x = -1.40 + i * .35
            d.stroke([(x, 2.512, 0), (x + .016, 2.286, z * .50),
                      (x, 2.07, z)], .011)
        for i in range(8):
            x1, x2 = -1.40 + i * .35, -1.40 + (i + 1) * .35
            points = [(x1, 2.06, z), (x2, 2.06, z),
                      (x2, 1.97, z), (x2 - .075, 1.91, z),
                      (x1 + .075, 1.91, z), (x1, 1.97, z)]
            _outlined(d, points, .012)
            if i in (0, 4, 7):
                for j in range(4):
                    xx = x1 + .045 + j * .065
                    d.stroke([(xx, 2.055, z + sign * .007),
                              (xx + .023, 1.97, z + sign * .007)], .009,
                             color=SOFT)
    d.stroke([(-1.43, 2.505, 0), (1.43, 2.505, 0)], .024)

    d.box((0, .84, .42), (2.51, .115, .69))
    for i in range(8):
        x = -1.225 + (i + .5) * (2.45 / 8)
        d.box((x, .46, .688), (.293, .66, .052))
        if i in (0, 3, 6):
            d.stroke([(x - .055, .20, .721), (x - .035, .48, .721),
                      (x - .045, .72, .721)], .009)
    d.beam((-1.20, .18, .73), (1.20, .18, .73), .067)
    for x in (-1.13, 1.13):
        d.box((x, .39, .26), (.105, .78, .105))
    for x in (-.73, .02, .76):
        _crate(d, (x, 1.015, .40), (.60, .24, .47))
        # Stylized fruit silhouettes sit above otherwise clean white boxes.
        for j in range(3):
            xx = x - .18 + .18 * j
            fruit_y = 1.185 + .015 * (j % 2)
            d.cylinder((xx, fruit_y, .40), .078, .075, n=8, outline=False)
            d.stroke(_ring((xx, fruit_y + .04, .40), .078, 8), .011, cyclic=True)
            d.stroke([(xx, 1.22, .40), (xx + .018, 1.275, .405)], .012)
    _crate(d, (-.90, .225, -.43), (.63, .45, .50))
    _crate(d, (-.90, .635, -.43), (.56, .37, .43))
    barrel(d, (.88, 0, -.42), .85)


def _wheel(d, x, y, z, radius=.39):
    n = 16
    rings = [[(x + offset, y + sin(2 * pi * i / n) * radius,
               z + cos(2 * pi * i / n) * radius) for i in range(n)]
             for offset in (-.045, .045)]
    for i in range(n):
        j = (i + 1) % n
        d.polygon([rings[0][i], rings[0][j], rings[1][j], rings[1][i]])
    for ring in rings:
        d.polygon(ring)
        d.stroke(ring, .022, cyclic=True)
        face_x = ring[0][0] + (.007 if ring[0][0] > x else -.007)
        inner = [(face_x, y + sin(2 * pi * i / n) * radius * .83,
                  z + cos(2 * pi * i / n) * radius * .83) for i in range(n)]
        d.stroke(inner, .018, cyclic=True)
        for i in range(8):
            a = 2 * pi * i / 8
            for offset in (-.020, .020):
                d.stroke([(face_x, y + sin(a) * .075 + cos(a) * offset,
                           z + cos(a) * .075 - sin(a) * offset),
                          (face_x, y + sin(a) * radius * .82 + cos(a) * offset,
                           z + cos(a) * radius * .82 - sin(a) * offset)], .011)
        hub = [(face_x, y + sin(2 * pi * i / 10) * .072,
                z + cos(2 * pi * i / 10) * .072) for i in range(10)]
        _outlined(d, hub, .016)


def cart(d):
    """Timber handcart, approximately 1.6 x 2.5 m, with visible spoked wheels."""
    d.beam((-.78, .41, -.04), (.78, .41, -.04), .115)
    for x in (-.71, .71):
        _wheel(d, x, .41, -.04)
    d.box((0, .55, -.10), (1.16, .12, 1.72))
    for i in range(1, 6):
        x = -.58 + i * (1.16 / 6)
        d.stroke([(x, .617, -.96), (x + .008, .617, .76)], .010)
    for x in (-.55, .55):
        d.beam((x, .43, -.81), (x, .67, 1.54), .08)
        for z in (-.88, .67):
            d.box((x, .91, z), (.09, .75, .09))
        for row in range(3):
            y = .74 + row * .185
            d.box((x, y, -.10), (.063, .155, 1.66))
            if row != 1:
                for stroke_z in (-.61, .16):
                    d.stroke([(x + (.038 if x > 0 else -.038), y - .025, stroke_z),
                              (x + (.038 if x > 0 else -.038), y - .007, stroke_z + .28),
                              (x + (.038 if x > 0 else -.038), y - .014, stroke_z + .42)],
                             .008, color=SOFT)
    for z in (-.90, .72):
        for row in range(3):
            y = .74 + row * .185
            d.box((0, y, z), (1.16, .155, .062))
        d.beam((-.46, .68, z + .037), (.46, 1.18, z + .037), .045)
    _crate(d, (.19, .82, .27), (.52, .40, .46))
    barrel(d, (-.19, .62, -.52), .78)


def notice(d):
    """1.8 m village notice post with timber board, two pinned white sheets."""
    d.box((0, .89, 0), (.14, 1.78, .15))
    d.box((0, 1.38, 0), (.92, .66, .105))
    d.box((0, 1.755, 0), (1.03, .09, .22))
    for x in (-.29, -.08, .13, .33):
        d.stroke([(x, 1.067, .060), (x + .007, 1.69, .060)], .009)
    d.stroke([(-.029, .11, .081), (-.035, .48, .081),
              (-.022, .94, .081)], .009)
    sheets = [(-.35, 1.14, .38, .47), (.065, 1.25, .285, .34)]
    for index, (x, y, width, height) in enumerate(sheets):
        z = .071 + index * .005
        _outlined(d, [(x, y, z), (x + width, y + .012, z),
                      (x + width - .009, y + height, z),
                      (x + .007, y + height - .012, z)], .010)
        for row in range(4):
            yy = y + height * .70 - row * .064
            d.stroke([(x + .055, yy, z + .007),
                      (x + width - .045 - (row % 2) * .05, yy + .005, z + .007)],
                     .009, color=SOFT)
        d.stroke([(x + width / 2, y + height - .039, z + .008),
                  (x + width / 2 + .004, y + height - .022, z + .008)], .023)


def barrel_cluster(d):
    """One compact delivery group: two stave barrels and a low packing crate."""
    barrel(d,(-.23,0,.02),.92)
    barrel(d,(.28,0,.20),.76)
    _crate(d,(.055,.16,-.38),(.46,.32,.36))
    # A short lid board remains inside the same grouped footprint.
    d.box((.055,.334,-.38),(.49,.026,.38))
    d.stroke([(-.16,.350,-.46),(.24,.350,-.46)],.008,color=SOFT)


def crates_cluster(d):
    """Three modest wood crates stacked into one yard object and one draw call."""
    _crate(d,(-.22,.22,0),(.60,.44,.52))
    _crate(d,(-.19,.635,.005),(.45,.37,.40))
    _crate(d,(.36,.16,.075),(.38,.32,.38))
    d.box((.36,.336,.075),(.40,.025,.40))
    for offset in [-.09,.03]:
        d.stroke([(.18,.352,.075+offset),(.54,.352,.075+offset)],.008,color=SOFT)
