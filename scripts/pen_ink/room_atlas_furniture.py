"""Carved atlas-room furniture, keeping the original interaction hierarchy.

The caller supplies the same canonical Three.js-coordinate helpers as the ink
room builder.  Strokes are batched under their existing interactive owner.
This layer does not move roots, anchors, curtains, or their original cloth.
"""
from math import cos, pi, sin

import bpy
from mathutils import Vector


def build_atlas_furniture(api):
    rooms = api['rooms']
    newbox, mesh = api['newbox'], api['mesh']
    paper, v, stroke = api['paper'], api['v'], api['stroke']
    added = api['added']
    suppressed, wood, curtain_names = [], [], []
    line_count = 0

    def xyz(point):
        return Vector((point.x, point.z, -point.y))

    def line(points, root, width=.00085, closed=False):
        nonlocal line_count
        if closed:
            points = [*points, points[0]]
        inverse = root.matrix_world.inverted()
        stroke([xyz(inverse @ v(point)) for point in points], root, width)
        line_count += 1

    def suppress(obj):
        if obj.type == 'MESH' and not obj.get('penInkSuperseded'):
            obj['penInkSuperseded'] = True
            obj.hide_render = True
            obj.hide_set(True)
            suppressed.append(obj.name)

    def part(name, center, dimensions, root, timber=True, bevel=.008):
        obj = newbox('Atlas' + name, center, dimensions, root, bevel)
        if timber:
            obj['atlasWood'] = True
            wood.append(obj.name)
        return obj

    def polygon(name, points, faces, root, timber=True):
        obj = mesh('InkDetail_Atlas' + name, points, faces, paper, root)
        obj['penInkAuthored'] = True
        current = root
        while current.parent:
            current = current.parent
        added[current.name].append(obj.name)
        if timber:
            obj['atlasWood'] = True
            wood.append(obj.name)
        return obj

    def rosette(center, radius, root, plane='z'):
        x, y, z = center
        for scale, lobes in [(1, 4), (.32, 0)]:
            points = []
            for i in range(33):
                angle = i * 2 * pi / 32
                r = radius * scale * (.84 + .16 * cos(lobes * angle))
                points.append((x + r * cos(angle), y + r * sin(angle), z)
                              if plane == 'z' else
                              (x + r * cos(angle), y, z + r * sin(angle)))
            line(points, root, .0009)

    def cartouche(x0, x1, y0, y1, z, root):
        c = min(x1 - x0, y1 - y0) * .17
        line([(x0+c,y0,z),(x1-c,y0,z),(x1,y0+c,z),
              (x1,y1-c,z),(x1-c,y1,z),(x0+c,y1,z),
              (x0,y1-c,z),(x0,y0+c,z)], root, .00085, True)

    blog = rooms['RoomBlog']
    monitor = bpy.data.objects['Monitor']
    chair = bpy.data.objects['BlogChair']
    # Suppress visual descendants only; every EMPTY and named anchor survives.
    for root in (monitor, chair):
        for obj in list(root.children_recursive):
            suppress(obj)
    for obj in list(blog.children_recursive):
        if obj.name.startswith(('BlogKeyboard', 'BlogMouse')) or obj.name == 'BlogChairMat':
            suppress(obj)

    # Open carved noticeboard. Aperture x=[2.075,3.525], y=[1.60,2.50]
    # exceeds the original HTML rectangle on all four sides.  No backing,
    # mullion, ornament, or stroke enters that opening at any depth.
    for x in (1.995, 3.605):
        part('NoticePost', (x, 1.985, .805), (.15, 1.35, .18), monitor)
        part('NoticePostFoot', (x, 1.338, .80), (.24, .055, .34), monitor)
        for y in (1.40, 1.565, 2.535):
            part('NoticeCollar', (x, y, .813), (.185, .040, .20), monitor, bevel=.003)
        # Paired incised channels make the uprights read as carved wood.
        for dx in (-.034, .034):
            line([(x+dx,1.66,.898),(x+dx+.002,2.03,.898),
                  (x+dx,2.43,.898)], monitor)
        rosette((x, 1.47, .917), .043, monitor)
        cartouche(x-.052, x+.052, 2.555, 2.63, .898, monitor)
    part('NoticeSill', (2.8, 1.535, .812), (1.57, .10, .19), monitor)
    part('NoticeSillLip', (2.8, 1.591, .838), (1.46, .014, .20), monitor, bevel=.003)
    part('NoticeLintel', (2.8, 2.586, .810), (1.80, .14, .18), monitor)
    part('NoticeCornice', (2.8, 2.675, .811), (1.94, .048, .235), monitor)
    part('NoticeCorniceCap', (2.8, 2.717, .797), (1.88, .028, .215), monitor, bevel=.004)
    # Small crest confined above the lintel; avoid theatrical oversized props.
    polygon('NoticeCrest', [(2.49,2.73,.775),(3.11,2.73,.775),
                           (2.99,2.81,.775),(2.8,2.856,.775),(2.61,2.81,.775),
                           (2.49,2.73,.85),(3.11,2.73,.85),
                           (2.99,2.81,.85),(2.8,2.856,.85),(2.61,2.81,.85)],
            [(4,3,2,1,0),(5,6,7,8,9),(0,1,6,5),(1,2,7,6),
             (2,3,8,7),(3,4,9,8),(4,0,5,9)], monitor)
    rosette((2.8, 2.781, .853), .045, monitor)
    cartouche(2.16, 3.44, 2.55, 2.615, .904, monitor)
    for x in (2.22, 2.46, 2.70, 2.94, 3.18, 3.42):
        rosette((x, 1.535, .910), .025, monitor)
    for y in (1.515, 1.554):
        line([(2.14,y,.911),(2.66,y+.001,.911),(3.46,y,.911)], monitor, .0007)

    # Period writing surface occupies the former keyboard/mouse area. Keyboard
    # event controls are runtime behavior and do not depend on these meshes.
    part('WritingFolioCover', (2.67,1.319,1.59), (1.19,.021,.44), blog, False, .004)
    part('WritingAtlasPages', (2.67,1.337,1.59), (1.16,.014,.415), blog, False, .002)
    part('WritingFolioSpine', (2.088,1.336,1.59), (.018,.026,.44), blog, False, .002)
    for offset in (.013, .025):
        line([(2.11,1.346,1.397+offset),(3.23,1.346,1.397+offset)], blog, .00055)
    line([(2.115,1.346,1.422),(3.218,1.346,1.422),(3.218,1.346,1.77),
          (2.115,1.346,1.77)], blog, .00065, True)
    # A few contour/coastline marks, with white interior space and no text.
    for j in range(4):
        points = []
        for i in range(25):
            t = i / 24
            points.append((2.21 + t*.64,1.347,
                           1.49 + j*.057 + .022*sin(t*pi*3+j*.55)
                           + .009*sin(t*pi*9)))
        line(points, blog, .00055)
    rosette((3.06,1.348,1.606), .078, blog, 'y')
    for dx,dz in [(-.09,0),(.09,0),(0,-.10),(0,.10)]:
        line([(3.06,1.349,1.606),(3.06+dx,1.349,1.606+dz)], blog, .00055)

    # Shallow carved apron integrates with the existing desk, leaving its
    # supports, top, and usable floor area intact. Relief stays below the top.
    part('DeskFrontApron', (2.80,1.047,2.039), (3.20,.168,.042), blog)
    for x in (1.59,2.20,2.81,3.42,4.01):
        cartouche(x-.235,x+.235,.991,1.104,2.063,blog)
        rosette((x,1.047,2.065),.040,blog)
    for x in (1.39,4.21):
        for y in (.23,.48,.75):
            cartouche(x-.071,x+.071,y-.07,y+.07,1.978,blog)
        for dx in (-.058,.058):
            line([(x+dx,.32,1.979),(x+dx+.003,.62,1.979),
                  (x+dx,.91,1.979)],blog,.0007)

    # Fixed four-leg carver's chair, within the existing chair footprint. Its
    # seat height and original owner pivot remain unchanged.
    cx, cz = 2.75, 3.00
    part('ChairSeat', (cx,.719,cz), (.96,.12,.81), chair, bevel=.021)
    for x in (cx-.378, cx+.378):
        for z in (cz-.30, cz+.30):
            part('ChairLeg', (x,.361,z), (.103,.66,.103), chair, bevel=.007)
            part('ChairLegFoot', (x,.068,z), (.127,.081,.127), chair, bevel=.008)
        part('ChairSideApron', (x,.616,cz), (.069,.092,.69), chair)
        part('ChairSideStretcher', (x,.292,cz), (.050,.061,.69), chair, bevel=.004)
        part('ChairBackPost', (x,1.041,cz+.326), (.104,.793,.112), chair)
        part('ChairBackPostCap', (x,1.438,cz+.326), (.139,.043,.145), chair)
        part('ChairArm', (x,.991,cz+.025), (.106,.068,.69), chair)
        part('ChairArmSupport', (x,.864,cz-.272), (.066,.216,.066), chair)
        # Front tenon pegs and small arm-end rosettes are drawn, not floating
        # cylinders; they remain crisp at the room's close camera distance.
        for y in (.40,.61):
            rosette((x,y,cz-.354), .018, chair)
    for z in (cz-.30,cz+.30):
        part('ChairApron', (cx,.616,z), (.79,.092,.069), chair)
    part('ChairCrossStretcher', (cx,.292,cz-.10), (.78,.049,.049), chair, bevel=.004)
    part('ChairBackTopRail', (cx,1.359,cz+.330), (.80,.124,.110), chair)
    part('ChairBackLowerRail', (cx,.867,cz+.330), (.79,.067,.081), chair)
    for x in (cx-.23,cx,cx+.23):
        part('ChairCarvedSplat', (x,1.105,cz+.325), (.121,.441,.065), chair)
        cartouche(x-.044,x+.044,.934,1.28,cz+.291,chair)
        rosette((x,1.111,cz+.289),.032,chair)
    # Both faces get modest line carving because the chair is viewed from
    # behind in the room, and from the front in its interactive close-up.
    for z in (cz+.272,cz+.388):
        cartouche(cx-.32,cx+.32,1.324,1.397,z,chair)
        for x in (cx-.20,cx,cx+.20):
            rosette((x,1.361,z),.027,chair)
    for z in (cz-.20,cz,cz+.20):
        line([(cx-.421,.781,z),(cx,.781,z+.002),(cx+.42,.781,z)], chair, .00065)
    for x in (cx-.378,cx+.378):
        line([(x,.365,cz-.354),(x+.005,.471,cz-.354)], chair, .00065)

    # Fine stitching follows the source curtain's actual piecewise-linear
    # folded surface. Insets keep the exact open/closed Z boundary untouched.
    for root in list(bpy.context.scene.objects):
        if root.type != 'EMPTY' or not root.name.endswith(('CurtainLeft','CurtainRight')):
            continue
        if not any(obj.type == 'MESH' for obj in root.children_recursive):
            continue
        pivot = xyz(root.matrix_world.translation)
        side = root.get('curtainSide','left' if root.name.endswith('Left') else 'right')
        z0 = pivot.z if side == 'left' else pivot.z-.48

        def cloth(s,t,lift=.002):
            # Source has 12 width segments. Interpolate vertex positions,
            # rather than drawing a sine through the solid folded cloth.
            q = max(0,min(11.999999,s*12));i = int(q);f = q-i
            def sample(k):
                a = k/12
                return Vector((.29+sin(a*6*pi)*.055*(.6+t*.4),
                               3.16-t*(1.84+sin(a*pi)*.045),z0+a*.48))
            p = sample(i).lerp(sample(i+1),f)
            return (p.x+lift,p.y,p.z)

        for t in (.953,.976):
            line([cloth(.020+i*.960/48,t) for i in range(49)],root,.0006)
        for s in (.025,.975):
            line([cloth(s,.018+j*.94/18) for j in range(19)],root,.0006)
        # Short stitches above the hem; avoid creating one object per stitch.
        for i in range(20):
            s=.045+i*.046
            line([cloth(s,.942),cloth(s+.012,.946)],root,.00048)
        # Tie cord and its small bow are anchored to each dynamic curtain.
        line([cloth(.035+i*.930/32,.54,.004) for i in range(33)],root,.0008)
        center=.30 if side == 'left' else .70
        for direction in (-1,1):
            line([cloth(center,.54,.006),cloth(center+direction*.075,.508,.009),
                  cloth(center+direction*.115,.541,.008),cloth(center,.55,.006)],root,.0008)
            line([cloth(center,.549,.006),cloth(center+direction*.041,.596,.007),
                  cloth(center+direction*.017,.628,.005)],root,.00075)
        curtain_names.append(root.name)

    return {
        'style': 'antique carved atlas furniture with fine ink ornament',
        'monitorOwner': monitor.name,
        'monitorScreenAnchor': 'MonitorScreenAnchor',
        'monitorAnchorPositionCanonical': [2.8,2.05,.82],
        'monitorClearAperture': {'width':1.45,'height':.90,
                                 'x':[2.075,3.525],'y':[1.60,2.50],
                                 'backing':False},
        'chairOwner': chair.name,
        'chairMaxHeight':1.4595,
        'chairFootprint':{'width':.96,'depth':.81},
        'modernVisualsSuperseded':suppressed,
        'atlasWoodObjects':wood,
        'curtainsDetailed':curtain_names,
        'curtainOriginalClothUnchanged':True,
        'batchedStrokeCount':line_count,
    }
