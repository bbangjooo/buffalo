"""Four hand-built engineering miniatures, authored for eye-level viewing.

Every broad face is an intentional plane. Openings, folded panels, load paths,
and attachment points are modelled, rather than implied by disconnected props.
All coordinates are Three.js x/y/z; the fixed display aperture starts at 1.25m.
"""
from math import cos, sin, pi

from rooms.exhibit_geometry import clipped


def _boxes(kit, name, boxes, token):
    """Combine small rectangular hardware into a single named mesh."""
    points, faces = [], []
    for (x, y, z), (w, h, d) in boxes:
        start = len(points)
        points.extend((x + a*w/2, y + b*h/2, z + c*d/2)
                      for a, b, c in [(-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
                                      (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1)])
        faces.extend(tuple(start+i for i in face) for face in
                     [(0,3,2,1), (4,5,6,7), (0,1,5,4), (1,2,6,5),
                      (2,3,7,6), (3,0,4,7)])
    return kit.poly(name, points, faces, token, orient=False)


def _compressor(kit, accent):
    kit.block('CompressorCastBed', (0, .335, -.015), (2.24, .17, .76), 'ink', .13, .94)
    _boxes(kit, 'CompressorBoltedSaddles', [
        ((-.40, .465, -.02), (.26, .19, .49)),
        ((.42, .52, -.02), (.23, .29, .35)),
    ], accent)

    # Four octagonal rings form a genuinely hollow reducing chamber. The
    # inlet has a dark recessed back wall, visible through its brass lip.
    points = []
    for x, radius in [(-.64, .36), (.39, .155), (-.64, .285), (.39, .095)]:
        points.extend((x, .79 + cos(i*pi/4)*radius, -.015 + sin(i*pi/4)*radius)
                      for i in range(8))
    faces = []
    for i in range(8):
        j = (i+1) % 8
        faces.extend([(i,j,j+8,i+8), (i+16,i+24,j+24,j+16),
                      (i,i+16,j+16,j), (i+8,j+8,j+24,i+24)])
    kit.poly('CompressorHollowReducer', points, faces, 'brass', orient=False)
    kit.ring('CompressorInletCasting', (-.66, .79, -.015), .377, .285, .10, accent, axis='x')
    kit.cylinder('CompressorRecessedInlet', (-.37, .79, -.015), .225, .025, 'ink', axis='x')
    kit.ring('CompressorOutletCollar', (.41, .79, -.015), .181, .095, .12, accent, axis='x')

    # Incoming files sit on a feed cradle; the compact output is collected in
    # a raised tray. Nothing floats outside the machine's physical supports.
    kit.block('CompressorFeedCradle', (-.90, .468, .05), (.39, .115, .58), 'slate', .065)
    _boxes(kit, 'CompressorInputFiles', [
        ((-.998, .755, .05), (.065, .46, .46)),
        ((-.892, .755, .05), (.065, .46, .46)),
    ], 'paper')
    _boxes(kit, 'CompressorInputFileBindings', [
        ((-.998, .768, .288), (.068, .14, .025)),
        ((-.892, .768, .288), (.068, .14, .025)),
    ], accent)
    kit.block('CompressorOutputTray', (.82, .59, .02), (.56, .14, .46), 'slate', .065)
    _boxes(kit, 'CompressorOutputTrayFeet', [
        ((x,.47,.02),(.09,.13,.32)) for x in [.63,1.01]
    ], accent)
    _boxes(kit, 'CompressorCollectedOutputFiles', [
        ((x,.77,.02),(.07,.22,.23)) for x in [.62,.82,1.02]
    ], 'paper')
    kit.cylinder('CompressorGaugeCasting', (0,.465,.385), .119,.085, accent, axis='z')
    kit.cylinder('CompressorGaugeFace', (0,.465,.432), .084,.015, 'paper', axis='z')
    kit.beam('CompressorGaugeNeedle', (-.037,.44,.446), (.032,.51,.446), .018, 'ink', n=4)


def _bridge(kit, accent):
    for i, x in enumerate([-.91, 0, .91]):
        kit.block('BridgeStructuralPier%02d' % i, (x, .39, -.085), (.47, .28, .72), 'slate', .09, .83)
        h = .60 if i == 1 else .49
        kit.block('BridgeServerIsland%02d' % i, (x, .53+h/2, -.20), (.34, h, .35), accent if i != 1 else 'ink', .055, .92)

    # The deck is one closed arched extrusion with real structural depth.
    crown = [(-1.12,.51), (-.73,.58), (-.32,.66), (.32,.66), (.73,.58), (1.12,.51)]
    outline = crown + [(x,y-.095) for x,y in reversed(crown)]
    kit.extrude('BridgeContinuousArchedWalkway', outline, .07, .36, 'wood')
    # Two triangular trusses connect to three substantial piers. Their feet
    # coincide with the deck; every brace meets the chord or an actual post.
    nodes = [(-1.04,.535,.393), (0,.685,.393), (1.04,.535,.393)]
    tops = [(-1.04,.775,.393), (0,.91,.393), (1.04,.775,.393)]
    for i in range(3):
        kit.beam('BridgeTrussUpright%02d' % i, nodes[i], tops[i], .039, accent, n=4)
    for i in range(2):
        kit.beam('BridgeTrussTopChord%02d' % i, tops[i], tops[i+1], .043, 'brass', n=4)
        kit.beam('BridgeDiagonalWeb%02d' % i, nodes[i], tops[i+1], .035, accent, n=4)
    _boxes(kit, 'BridgeInsetServerPanels', [
        ((x, .79 if i == 1 else .745, -.016), (.235, .34 if i == 1 else .29, .025))
        for i, x in enumerate([-.91, 0, .91])
    ], 'ink')
    _boxes(kit, 'BridgeServerActivitySlots', [
        ((x, .655 + j*.10, .003), (.151, .034, .02))
        for x in [-.91, 0, .91] for j in range(3)
    ], 'brass')


def _radar(kit, accent):
    kit.block('RadarAnchoredFoot', (-.30, .335, -.08), (.68, .17, .62), accent, .10, .78)
    kit.extrude('RadarFoldedElevationStand', [
        (-.55,.40), (-.10,.40), (-.14,.50), (-.25,.60),
        (-.25,.82), (-.43,.82), (-.43,.56),
    ], -.28, -.105, 'ink')
    kit.cylinder('RadarElevationPivot', (-.34, .77, -.18), .115, .27, 'brass', axis='x')

    # A closed shell has eight concave inner panels and eight broad exterior
    # panels, joined by a deep rolled rim. It remains solid from the rear.
    cx, cy = -.30, .81
    points = [(cx,cy,-.12)]
    points += [(cx+cos(i*pi/4)*.44, cy+sin(i*pi/4)*.355, .22) for i in range(8)]
    points += [(cx+cos(i*pi/4)*.44, cy+sin(i*pi/4)*.355, .155) for i in range(8)]
    points += [(cx,cy,-.195)]
    faces = []
    for i in range(8):
        j = (i+1) % 8
        faces.extend([(0,i+1,j+1), (17,j+9,i+9), (i+1,i+9,j+9,j+1)])
    kit.poly('RadarEightPlaneConcaveShell', points, faces, 'paper', orient=False)

    # Low raised ribs grow out of each reflector panel. The quad strips have
    # substantial width, and their ridge tapers naturally into the hub.
    rib_points, rib_faces = [], []
    for i in range(8):
        a = i*pi/4
        dx, dy = cos(a)*.44, sin(a)*.355
        tx, ty = -sin(a)*.024, cos(a)*.024
        s = len(rib_points)
        rib_points += [(cx+dx*.23+tx*.6,cy+dy*.23+ty*.6,-.12+.34*.23),
                       (cx+dx*.91+tx,cy+dy*.91+ty,-.12+.34*.91),
                       (cx+dx*.91-tx,cy+dy*.91-ty,-.12+.34*.91),
                       (cx+dx*.23-tx*.6,cy+dy*.23-ty*.6,-.12+.34*.23),
                       (cx+dx*.23,cy+dy*.23,-.12+.34*.23+.018),
                       (cx+dx*.91,cy+dy*.91,-.12+.34*.91+.024)]
        rib_faces += [tuple(s+j for j in f) for f in [(0,1,5,4),(4,5,2,3),(0,4,3),(1,2,5)]]
    kit.poly('RadarIntegralRadialRibs', rib_points, rib_faces, 'brass')
    kit.beam('RadarFeedSupport', (cx,.483,.22), (cx,.81,.399), .031, accent, n=4)
    kit.cylinder('RadarReceiverHorn', (cx,.81,.418), .058, .07, 'brass', axis='z', top_radius=.043)

    # A wedge-shaped console presents its screen toward the standing reader.
    ring = clipped(.60,.51,.065)
    points = [(x+.67,.27,z+.035) for x,z in ring]
    points += [(x+.67,.80-(z+.235)*.32,z+.035) for x,z in ring]
    faces = [tuple(reversed(range(8))),tuple(range(8,16))]
    faces += [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    kit.poly('RadarSlopedControlConsole', points, faces, accent)
    def surface(x,z,lift=.006):
        return (x,.80-(z+.20)*.32+lift,z)
    kit.poly('RadarRecessedSignalScreen', [surface(x,z) for x,z in
             [(.443,-.12),(.897,-.12),(.897,.22),(.443,.22)]], [(0,1,2,3)], 'ink')
    meter_points, meter_faces = [], []
    for i in range(3):
        x=.497+i*.121; z=.15; length=.075+i*.060; s=len(meter_points)
        meter_points += [surface(px,pz,.009) for px,pz in [(x,z),(x+.065,z),(x+.065,z-length),(x,z-length)]]
        meter_faces.append(tuple(range(s,s+4)))
    kit.poly('RadarScreenSignalMeter', meter_points, meter_faces, 'brass')
    _boxes(kit, 'RadarConsoleTactileControls', [
        ((.50+i*.16,.485,.302),(.068,.057,.035)) for i in range(3)
    ], 'paper')


def _toolbox(kit, accent):
    for x in [-.70,.70]:
        kit.cylinder('ToolcaseRubberWheel', (x,.35,.215), .10, .18, 'ink', axis='z')
        kit.cylinder('ToolcaseWheelHub', (x,.35,.315), .043, .025, 'brass', n=6, axis='z')
    _boxes(kit, 'ToolcaseRearFeet', [((x,.315,-.225),(.15,.13,.15)) for x in [-.70,.70]], 'ink')

    # The case face folds inward around an actual badge recess; this is not a
    # flat decal pasted over a beveled cube.
    outer = [(x,y+.64) for x,y in clipped(1.88,.62,.10)]
    inner = [(x,y+.64) for x,y in clipped(.78,.43,.04)]
    points = [(x,y,z) for z in [-.31,.31] for x,y in outer]
    points += [(x,y,z) for z in [.31,.274] for x,y in inner]
    faces = [tuple(reversed(range(8)))]
    for i in range(8):
        j=(i+1)%8
        faces += [(i,j,j+8,i+8),(i+8,j+8,j+16,i+16),(i+16,j+16,j+24,i+24)]
    kit.poly('ToolcaseFoldedShellAndBadgeRecess', points, faces, accent, orient=False)
    kit.extrude('ToolcaseRecessShadow', inner, .272,.276,'ink')
    _boxes(kit, 'ToolcaseFourInsetBadgePanes', [
        ((x,y,.282),(.265,.133,.018)) for x in [-.158,.158] for y in [.549,.725]
    ], 'paper')
    kit.block('ToolcaseOverlappingLid', (0,.958,0), (1.91,.10,.68), 'ink', .12, .965)
    kit.extrude('ToolcaseSolidCarryHandle', [
        (-.34,.97),(-.34,1.085),(-.255,1.175),(.255,1.175),
        (.34,1.085),(.34,.97),(.235,.97),(.235,1.06),
        (.195,1.095),(-.195,1.095),(-.235,1.06),(-.235,.97),
    ], -.08,.08,'brass')
    _boxes(kit, 'ToolcaseHandleMountsAndLatches', [
        ((x,.978,0),(.155,.066,.20)) for x in [-.285,.285]
    ] + [((x,.865,.341),(.116,.18,.062)) for x in [-.64,.64]], 'brass')
    for side in [-1,1]:
        # Large L-shaped corner plates meet the folded front and the side wall.
        outline = [(side*x,y) for x,y in [(.71,.348),(.84,.348),(.94,.448),
                   (.94,.58),(.84,.58),(.84,.46),(.71,.46)]]
        kit.extrude('ToolcaseStructuralCornerGuard', outline, .307,.376,'slate')
    _boxes(kit, 'ToolcaseSideImpactRails', [
        ((x,.67,-.035),(.084,.30,.56)) for x in [-.94,.94]
    ], 'slate')


def build(shape, kit, station):
    """Build one sculpture, leaving its root transform to the station author."""
    builders = {'compressor': _compressor, 'bridge': _bridge,
                'radar': _radar, 'toolbox': _toolbox}
    builders[shape](kit, station['color'])
