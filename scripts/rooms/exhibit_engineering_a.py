"""Four engineering sculptures, drawn as a few substantial planar volumes.

Coordinates use the site's Three.js convention (Y up, +Z toward the visitor).
The sculpture tops deliberately remain below the exhibit's reading screen.
"""
from math import cos, sin, pi


def _outline(cx, cy, width, height, cut):
    x, y = width / 2, height / 2
    return [(cx-x+cut, cy-y), (cx+x-cut, cy-y),
            (cx+x, cy-y+cut), (cx+x, cy+y-cut),
            (cx+x-cut, cy+y), (cx-x+cut, cy+y),
            (cx-x, cy+y-cut), (cx-x, cy-y+cut)]


def _panel(kit, name, cx, cy, width, height, back, front, token,
           cut=.07, inset=.055):
    """A thick panel with one broad, slanting front shoulder."""
    outer = _outline(cx, cy, width, height, cut)
    inner = _outline(cx, cy, width-2*inset, height-2*inset,
                     max(.015, cut-inset*.5))
    points = [(x, y, back) for x, y in outer]
    points += [(x, y, front-inset*.55) for x, y in outer]
    points += [(x, y, front) for x, y in inner]
    faces = [tuple(reversed(range(8))), tuple(range(16, 24))]
    for i in range(8):
        j = (i+1) % 8
        faces += [(i, j, j+8, i+8), (i+8, j+8, j+16, i+16)]
    return kit.poly(name, points, faces, token)


def _shield(kit, accent):
    # A cast vault casing, a visibly recessed door and a deeply folded shield.
    _panel(kit, 'VaultCastShell', -.34, .695, 1.28, .85,
           -.34, .235, accent, cut=.12, inset=.085)
    _panel(kit, 'VaultDoorRecess', -.34, .695, 1.055, .625,
           .228, .263, 'ink', cut=.09, inset=.018)
    _panel(kit, 'VaultDoorPlate', -.39, .695, .89, .51,
           .262, .302, 'slate', cut=.07, inset=.04)
    for y in [.47, .91]:
        kit.cylinder('VaultHinge', (-.85, y, .284), .055, .17,
                     'brass', n=6, axis='y')
    kit.cylinder('VaultWheelSocket', (-.56, .74, .328), .19, .055,
                 'ink', n=8, axis='z')
    kit.ring('VaultWheelRim', (-.56, .74, .374), .163, .111, .058,
             'brass', n=8, axis='z')
    for a in [0, 2*pi/3, 4*pi/3]:
        kit.beam('VaultWheelSpoke', (-.56, .74, .374),
                 (-.56+.133*cos(a), .74+.133*sin(a), .374),
                 .025, 'brass', n=4)
    kit.cylinder('VaultWheelHub', (-.56, .74, .407), .058, .06,
                 'brass', n=6, axis='z')

    outline = [(.34, 1.155), (.765, 1.025), (.71, .66),
               (.34, .405), (-.03, .66), (-.085, 1.025)]
    kit.extrude('ShieldCastRim', outline, .246, .355, 'brass')
    inside = [(.34, 1.10), (.696, .987), (.653, .693),
              (.34, .474), (.027, .693), (-.016, .987)]
    # The ridge projects almost 12 cm: this reads as armour from close range.
    points = [(x, y, .363) for x, y in inside]
    points += [(.34, 1.062, .455), (.34, .762, .485), (.34, .526, .419)]
    kit.poly('ShieldFoldedFace', points,
             [(0, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3),
              (3, 8, 7, 4), (4, 7, 6, 5), (5, 6, 0)],
             'paper', tones=[1.1, .9, .80, 1.02, 1.13, 1], orient=False)
    # A single cast fastener is more legible than fine embossed line art.
    kit.cylinder('ShieldRidgeFastener', (.34, .796, .487), .055, .018,
                 accent, n=4, axis='z', phase=pi/4)
    for stack, x, z, count in [(0, -.91, .22, 2), (1, .98, .04, 3)]:
        for index in range(count):
            kit.cylinder('RewardCoin%d_%d' % (stack, index),
                         (x + (.012 if index % 2 else 0), .281+index*.069, z),
                         .18, .062, 'brass', n=8, phase=index*.17)


def _parcel(kit, name, x, y, token):
    # Wide chamfers replace tiny bevel strips; the top is a single folded plane.
    _panel(kit, name, x, y+.14, .33, .28, -.195, .195,
           token, cut=.045, inset=.036)
    kit.block(name+'PackingBand', (x, y+.283, -.012), (.073, .022, .34),
              'brass', cut=.012)


def _pipeline(kit, accent):
    # A gently rising conveyor with end housings cut as one consistent silhouette.
    side = [(-1.12, .40), (-1.03, .335), (.91, .43), (1.10, .52),
            (1.10, .65), (1.02, .72), (-1.02, .61), (-1.12, .53)]
    for z, name in [(-.36, 'Far'), (.28, 'Near')]:
        kit.extrude('Conveyor'+name+'CastRail', side, z, z+.08, accent)
    kit.block('ConveyorLeftFoot', (-.81, .305, 0), (.41, .11, .64),
              'ink', cut=.075, taper=.76)
    kit.block('ConveyorRightFoot', (.80, .35, 0), (.41, .20, .64),
              'ink', cut=.075, taper=.76)
    bed = [(-1.02, .565), (1.04, .671), (1.04, .705), (-1.02, .60)]
    kit.extrude('ConveyorRecessedBelt', bed, -.275, .275, 'ink')
    for index, x in enumerate([-.77, -.275, .23, .70, 1.00]):
        kit.cylinder('ConveyorRoller%d' % index,
                     (x, .622+(x+1)*.052, 0), .065, .535,
                     'brass', n=8, axis='z')
    for index, x in enumerate([-.77, -.275, .23]):
        _parcel(kit, 'QueuedPacket%d' % index, x,
                .687+(x+1)*.052, 'paper' if index == 1 else accent)

    # One U-shaped cast gateway: the empty center is real geometry, not a decal.
    x0, x1, y0, y1, top = .70, .88, .69, 1.08, 1.175
    cross = [(-.41, y0), (-.29, y0), (-.29, y1), (.29, y1),
             (.29, y0), (.41, y0), (.41, top-.055), (.355, top),
             (-.355, top), (-.41, top-.055)]
    points = [(x, y, z) for x in [x0, x1] for z, y in cross]
    count = len(cross)
    faces = [tuple(reversed(range(count))), tuple(range(count, 2*count))]
    faces += [(i, (i+1)%count, (i+1)%count+count, i+count)
              for i in range(count)]
    kit.poly('QueueReceivingArch', points, [tuple(reversed(f)) for f in faces],
             'slate', orient=False)
    kit.cylinder('QueueGateIndicatorMount', (.79, 1.105, .412), .059, .042,
                 'ink', n=8, axis='z')
    kit.cylinder('QueueGateIndicator', (.79, 1.105, .439), .038, .018,
                 'signal', n=6, axis='z')


def _house(kit, name, x, z, width, height, depth, token):
    floor = .368
    kit.block(name+'Walls', (x, floor+height/2, z), (width, height, depth),
              token, cut=.024)
    # Five-sided ends, substantial eaves and two unbroken pitched roof planes.
    w, d = width*.59, depth*.61
    eave, ridge = floor+height-.005, floor+height+.125
    points = [(x-w, eave, z-d), (x+w, eave, z-d), (x, ridge, z-d),
              (x-w, eave, z+d), (x+w, eave, z+d), (x, ridge, z+d)]
    kit.poly(name+'PitchedRoof', points,
             [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3),
              (0, 3, 5, 2), (1, 2, 5, 4)], 'wood')
    _panel(kit, name+'Door', x, floor+.065, width*.23, .13,
           z+depth/2-.006, z+depth/2+.009, 'ink', cut=.01, inset=.008)


def _route(kit, accent):
    # A shallow landform deliberately stretched across the plinth: irregular
    # eight-sided shoreline, bevelled escarpment and a calm uninterrupted top.
    shore = [(-1.12, -.17), (-.80, -.425), (.42, -.435), (1.02, -.25),
             (1.13, .10), (.73, .42), (-.40, .435), (-1.05, .27)]
    points = [(x*.93, .25, z*.9) for x, z in shore]
    points += [(x, .30, z) for x, z in shore]
    points += [(x*.91, .365, z*.9) for x, z in shore]
    faces = [tuple(reversed(range(8))), tuple(range(16, 24))]
    for i in range(8):
        j = (i+1)%8
        faces += [(i, j, j+8, i+8), (i+8, j+8, j+16, i+16)]
    kit.poly('DispatchLandscape', points, faces, 'paper')
    destinations = [(-.76, -.21, .26, .20, .22),
                    (-.75, .24, .29, .23, .22),
                    (.00, .27, .28, .19, .22),
                    (.78, .17, .27, .21, .23),
                    (.70, -.24, .29, .24, .20)]
    for index, (x, z, width, height, depth) in enumerate(destinations):
        kit.beam('DispatchRoute%d' % index, (0, .382, -.07),
                 (x, .382, z), .035, 'brass', n=4)
        _house(kit, 'DeliveryHouse%d' % index, x, z, width, height, depth,
               accent if index%2 == 0 else 'slate')

    # An unmistakably larger, multifaceted central depot, with stepped roof.
    kit.cylinder('DispatchDepotBase', (0, .413, -.09), .275, .095,
                 'ink', n=6, top_radius=.24, phase=pi/6)
    kit.cylinder('DispatchDepot', (0, .657, -.09), .235, .40,
                 accent, n=6, top_radius=.205, phase=pi/6)
    kit.cylinder('DispatchDepotCornice', (0, .866, -.09), .29, .085,
                 'wood', n=6, top_radius=.235, phase=pi/6)
    kit.cylinder('DispatchDepotRoof', (0, .977, -.09), .24, .14,
                 'ink', n=6, top_radius=.09, phase=pi/6)
    _panel(kit, 'DispatchDepotEntrance', 0, .603, .145, .275,
           .115, .145, 'paper', cut=.027, inset=.017)
    kit.cylinder('DispatchBeaconBase', (0, 1.063, -.09), .09, .053,
                 'brass', n=6)
    kit.cylinder('DispatchBeacon', (0, 1.13, -.09), .067, .08,
                 'signal', n=6, top_radius=.024)


def _archive(kit, accent):
    # The cabinet sides lean into a smaller cap; the three fronts sit in a
    # continuous dark recess, so each drawer has real shadow and depth.
    outline = [(-.965, .28), (.215, .28), (.265, .35), (.23, 1.015),
               (.145, 1.09), (-.895, 1.09), (-.98, 1.015), (-1.015, .35)]
    kit.extrude('ArchiveAngledCase', outline, -.32, .23, accent)
    _panel(kit, 'ArchiveDrawerWell', -.375, .676, 1.06, .703,
           .227, .261, 'ink', cut=.035, inset=.018)
    for index, y in enumerate([.43, .661, .892]):
        _panel(kit, 'ArchiveInsetDrawer%d' % index, -.375, y, .966, .185,
               .26, .33, 'wood' if index == 2 else 'paper', cut=.035, inset=.031)
        kit.extrude('ArchiveDrawerPull%d' % index,
                    [(-.47, y+.015), (-.28, y+.015), (-.255, y+.04),
                     (-.28, y+.063), (-.47, y+.063), (-.495, y+.04)],
                    .324, .39, 'brass')
    kit.block('ArchiveCap', (-.375, 1.071, -.05), (1.15, .088, .64),
              'wood', cut=.075, taper=.93)
    kit.block('ArchiveFiledVolume', (-.50, 1.141, -.08), (.57, .049, .46),
              'paper', cut=.035, yaw=-.1)

    for y, name in [(.303, 'Foot'), (1.078, 'Crown')]:
        kit.cylinder('Hourglass'+name, (.80, y, 0), .266, .10,
                     'wood', n=8, top_radius=.23, phase=pi/8)
    for index, (dx, z) in enumerate([(-.189, -.15), (.189, -.15),
                                    (-.189, .15), (.189, .15)]):
        kit.beam('HourglassFramePillar%d' % index,
                 (.80+dx, .348, z), (.80+dx*.94, 1.035, z*.94),
                 .03, 'brass', n=4)
    kit.cylinder('HourglassLowerBowl', (.80, .512, 0), .176, .308,
                 'brass', n=8, top_radius=.038, phase=pi/8)
    kit.cylinder('HourglassUpperBowl', (.80, .829, 0), .038, .326,
                 'paper', n=8, top_radius=.176, phase=pi/8)
    kit.cylinder('HourglassWaist', (.80, .667, 0), .047, .037,
                 'brass', n=8, phase=pi/8)


def build(shape, kit, station):
    """Build one requested career sculpture under ``kit.root``."""
    builders = {'shield': _shield, 'pipeline': _pipeline,
                'route': _route, 'archive': _archive}
    builders[shape](kit, station['color'])
