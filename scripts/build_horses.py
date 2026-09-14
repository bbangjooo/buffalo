"""Build six original, articulated horses in a separate Blender session.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build_horses.py
The GLBs use +Y up, +Z forward, unit-scale feet at the origin.  Each file
contains HorseChestnut, HorseCream and HorseCharcoal, with articulated equine
leg chains and a neck that carries the head. Rig data is embedded as extras.
No external textures, add-ons, or open Blender documents are required.

Anatomy references interpreted in the original stylized geometry:
https://www.amnh.org/content/download/213774/3146546/file/horse_walk-flipbook.pdf
https://extension.umn.edu/agriculture/animals-and-livestock/horse/conformation-of-the-horse
https://vanat.ahc.umn.edu/run/plate8.html
The fore support chain is nearly straight; hind stifle and hock are independent.
The hind cannon is longer than the fore cannon, and the hock sits above carpus.
"""

import bpy
import bmesh
import json
import math
import random
import struct
import sys
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'Room'
REVIEW = ROOT / 'assets' / 'horse-review'
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def color(v):
    return tuple(linear(max(0, min(1, n))) for n in v) + (1,)


def material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Roughness'].default_value = .93
    node.inputs['Specular IOR Level'].default_value = .15
    attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'HorsePalette'
    mat.node_tree.links.new(attr.outputs['Color'], node.inputs['Base Color'])
    return mat


MATERIALS = {'ink': material('Pen Warm paper & archival ink'),
             'low-poly': material('Matte hand-cut facets')}


class Mesh:
    def __init__(self, rng):
        self.vertices, self.faces, self.colors = [], [], []
        self.rng = rng

    def surface(self, verts, faces, tint, variation=0):
        base = len(self.vertices)
        self.vertices.extend(verts)
        for face in faces:
            self.faces.append(tuple(base + i for i in face))
            # Variation is baked into vertex colors, retaining one draw call/joint.
            shade = self.rng.uniform(-variation, variation)
            self.colors.append(color(tuple(c + shade for c in tint)))

    def loft(self, rings, tint, sides=8, variation=0):
        # Rings are (center, horizontal radius, vertical radius), in a Y loft.
        verts = []
        for center, rx, rz in rings:
            for k in range(sides):
                angle = 2 * math.pi * (k + .5) / sides
                verts.append((center[0] + rx * math.cos(angle), center[1],
                              center[2] + rz * math.sin(angle)))
        faces = [tuple(range(sides - 1, -1, -1))]
        for r in range(len(rings) - 1):
            for k in range(sides):
                a, b = r * sides + k, r * sides + (k + 1) % sides
                c, d = b + sides, a + sides
                if (r + k) % 2:
                    faces.extend([(a, b, d), (b, c, d)])
                else:
                    faces.extend([(a, b, c), (a, c, d)])
        faces.append(tuple((len(rings) - 1) * sides + k for k in range(sides)))
        self.surface(verts, faces, tint, variation)

    def ellipsoid(self, center, radii, tint, sides=8, levels=5, variation=0):
        rings = []
        for j in range(levels + 1):
            phi = -math.pi / 2 + .035 + (math.pi - .07) * j / levels
            rings.append(((center[0], center[1] + math.sin(phi) * radii[1], center[2]),
                          math.cos(phi) * radii[0], math.cos(phi) * radii[2]))
        self.loft(rings, tint, sides, variation)

    def tube(self, points, radii, tint, sides=6, variation=0):
        verts = []
        for i, point in enumerate(points):
            before, after = points[max(i - 1, 0)], points[min(i + 1, len(points) - 1)]
            tangent = (Vector(after) - Vector(before)).normalized()
            axis = Vector((1, 0, 0))
            if abs(tangent.dot(axis)) > .9:
                axis = Vector((0, 1, 0))
            u = tangent.cross(axis).normalized()
            v = tangent.cross(u).normalized()
            radius = radii[i] if isinstance(radii, list) else radii
            for k in range(sides):
                angle = 2 * math.pi * k / sides
                verts.append(Vector(point) + (u * math.cos(angle) + v * math.sin(angle)) * radius)
        faces = [tuple(range(sides - 1, -1, -1))]
        for i in range(len(points) - 1):
            for k in range(sides):
                a, b = i * sides + k, i * sides + (k + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        faces.append(tuple((len(points) - 1) * sides + k for k in range(sides)))
        self.surface(verts, faces, tint, variation)

    def leaf(self, points, width, tint):
        # A faceted tapered lock of mane, ear, or tail.
        verts = []
        for i, point in enumerate(points):
            w = width[i] if isinstance(width, list) else width
            x, y, z = point
            verts.extend([(x - w, y, z), (x, y - w * .45, z + w * .45),
                          (x + w, y, z), (x, y + w * .45, z - w * .35)])
        faces = [(3, 2, 1, 0)]
        for i in range(len(points) - 1):
            for k in range(4):
                a, b = i * 4 + k, i * 4 + (k + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        faces.append(tuple((len(points) - 1) * 4 + k for k in range(4)))
        self.surface(verts, faces, tint, .018)

    def object(self, name, parent, pivot, style):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([Vector(v) - Vector(pivot) for v in self.vertices], [], self.faces)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        attr = mesh.color_attributes.new(name='HorsePalette', type='FLOAT_COLOR', domain='CORNER')
        for face, tint in zip(mesh.polygons, self.colors):
            for loop in face.loop_indices:
                attr.data[loop].color = tint
        mesh.color_attributes.active_color = attr
        mesh.materials.append(MATERIALS[style])
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        if style == 'ink':
            obj['penInkAuthored'] = True
        return obj


def empty(name, parent=None, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.empty_display_size = .08
    return obj


PALETTES = {
    'low-poly': {
        'Chestnut': ((.63, .31, .19), (.22, .105, .075), (.91, .84, .69)),
        'Cream': ((.83, .66, .40), (.91, .87, .71), (.97, .94, .82)),
        'Charcoal': ((.27, .30, .30), (.10, .12, .13), (.80, .80, .73)),
    },
    'ink': {
        'Chestnut': ((.84, .78, .66), (.27, .24, .20), (.97, .94, .85)),
        'Cream': ((.96, .93, .84), (.64, .59, .47), (.99, .97, .90)),
        'Charcoal': ((.68, .68, .62), (.23, .25, .23), (.91, .90, .81)),
    },
}
INK = (.17, .19, .17)


def build_horse(style, coat):
    rng = random.Random(641 + list(PALETTES[style]).index(coat))
    fill, hair, sock = PALETTES[style][coat]
    is_ink = style == 'ink'
    variation = .012 if is_ink else .040
    root = empty('Horse' + coat)
    root['design'] = 'Original pen study' if is_ink else 'Original faceted study'
    root['forward'] = 'Blender -Y / glTF +Z'
    root['horseRigVersion'] = 3
    prefix = style.replace('-', '_') + '_' + coat
    body = Mesh(rng)
    body.loft([((0, -.735, 1.21), .04, .10),
               ((0, -.64, 1.21), .16, .245),
               ((0, -.47, 1.23), .265, .33),
               ((0, -.15, 1.20), .32, .32),
               ((0, .20, 1.20), .35, .30),
               ((0, .50, 1.25), .30, .33),
               ((0, .70, 1.24), .20, .26),
               ((0, .785, 1.24), .055, .10)], fill, 12 if is_ink else 10, variation)
    # The neck hinges inside the shoulder, not above it. The rounded collar
    # conceals the moving neck root throughout a complete grazing reach.
    neck_origin = (0, -.40, 1.24)
    body.ellipsoid(neck_origin, (.225, .275, .26), fill, 10, 5, variation)
    neck_pivot = empty(prefix + '_NeckPivot', root, neck_origin)
    neck_pivot['anatomicalJoint'] = 'neck base at withers'
    neck = Mesh(rng)
    # Long, forward-sloping neck; broad at the shoulder, narrow at the poll.
    neck_rings = [((0, -.40, 1.28), .185, .22), ((0, -.49, 1.55), .16, .195),
                  ((0, -.69, 1.84), .13, .15), ((0, -.89, 2.08), .105, .12)]
    verts = []
    sides = 8
    for center, rx, ry in neck_rings:
        for k in range(sides):
            angle = 2 * math.pi * (k + .5) / sides
            verts.append((rx * math.cos(angle), center[1] + ry * math.sin(angle), center[2]))
    faces = [tuple(range(7, -1, -1))]
    for i in range(len(neck_rings) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.extend([(a, b, b + sides), (a, b + sides, a + sides)])
    faces.append(tuple(24 + k for k in range(8)))
    neck.surface(verts, faces, fill, variation)
    # The swept dark crest makes the horse silhouette legible from above.
    neck.leaf([(0, -.78, 2.12), (.018, -.54, 1.83), (.035, -.32, 1.54),
               (.04, -.23, 1.38)], [.055, .064, .075, .009], hair)
    for i in range(9):
        t = i / 9
        neck.leaf([(.035, -.77 + .51 * t, 2.10 - .66 * t),
                   (.15, -.75 + .53 * t, 1.97 - .66 * t),
                   (.13, -.70 + .50 * t, 1.91 - .63 * t)], [.043, .034, .001], hair)

    # Deliberate contour marks sit above the paper surface and survive GLB export.
    if is_ink:
        for side in [-1, 1]:
            body.tube([(side * .148, .70, 1.30), (side * .274, .50, 1.48),
                       (side * .305, .2, 1.47), (side * .27, -.15, 1.49),
                       (side * .23, -.41, 1.48)], .008, INK, 4)
            neck.tube([(side * .185, -.51, 1.34), (side * .157, -.62, 1.60),
                       (side * .13, -.77, 1.88), (side * .10, -.94, 2.065)], .008, INK, 4)
            body.tube([(side * .22, -.45, .99), (side * .276, -.16, .935),
                       (side * .307, .16, .958), (side * .23, .49, 1.0)], .008, INK, 4)
            body.tube([(side * .28, .52, 1.39), (side * .313, .40, 1.25),
                       (side * .287, .42, 1.09)], .007, INK, 4)
            # Short parallel strokes, with denser cross-hatching on charcoal.
            for i in range(10 if coat == 'Charcoal' else 6):
                y = -.18 + i * .059
                x = side * (.324 + .023 * math.sin((y + .18) * 5))
                body.tube([(x, y, 1.17), (x + side * .003, y + .052, 1.095)], .0044, INK, 3)
            for i in range(4):
                neck.tube([(side * (.157 - .009 * i), -.54 - .04 * i, 1.60 + .055 * i),
                           (side * (.149 - .009 * i), -.48 - .04 * i, 1.56 + .055 * i)], .0045, INK, 3)
    body.object(prefix + '_Body', root, (0, 0, 0), style)
    neck.object(prefix + '_Neck', neck_pivot, neck_origin, style)

    # The poll nods gently; broad grazing movement belongs to the entire neck.
    head_origin = (0, -.91, 2.09)
    head_pivot = empty(prefix + '_HeadPivot', neck_pivot, Vector(head_origin) - Vector(neck_origin))
    head_pivot['anatomicalJoint'] = 'poll'
    head = Mesh(rng)
    head.loft([((0, -.66, 1.91), .105, .11), ((0, -.81, 1.91), .148, .16),
               ((0, -.97, 1.80), .103, .113), ((0, -1.16, 1.70), .105, .087),
               ((0, -1.22, 1.69), .079, .065)], fill, 8, variation)
    muzzle = tuple(v * .63 for v in fill)
    head.ellipsoid((0, -1.19, 1.68), (.105, .077, .071), muzzle, 8, 3, variation)
    for side in [-1, 1]:
        # Ears have a broad root and a small, keen point.
        head.leaf([(side * .084, -.705, 2.007), (side * .113, -.722, 2.11),
                   (side * .119, -.745, 2.175)], [.054, .035, .001], fill)
        head.leaf([(side * .085, -.734, 2.035), (side * .109, -.749, 2.115),
                   (side * .116, -.752, 2.15)], [.022, .013, .001], hair)
        head.ellipsoid((side * .143, -.822, 1.935), (.012, .029, .025), INK, 8, 3)
        head.ellipsoid((side * .153, -.835, 1.944), (.005, .008, .009), (1, .97, .85), 6, 2)
        head.ellipsoid((side * .089, -1.205, 1.708), (.009, .023, .011), INK, 6, 2)
        if is_ink:
            head.tube([(side * .123, -.73, 1.995), (side * .151, -.83, 1.96),
                       (side * .119, -.96, 1.85), (side * .10, -1.145, 1.748)], .0065, INK, 4)
            head.tube([(side * .096, -.88, 1.80), (side * .087, -1.02, 1.718),
                       (side * .083, -1.19, 1.655)], .006, INK, 4)
        head.tube([(side * .087, -1.185, 1.652), (side * .067, -1.237, 1.655)], .006, INK, 4)
    # Distinctive white blaze, set just proud of the forehead.
    if coat != 'Charcoal':
        head.leaf([(0, -.848, 2.052), (0, -.989, 1.907), (0, -1.142, 1.783)],
                  [.018 if coat == 'Cream' else .033, .022, .014], sock)
    head.leaf([(0, -.697, 2.062), (-.013, -.85, 2.065), (-.023, -.901, 1.977)],
              [.055, .05, .004], hair)
    # Re-proportion the original face around its actual poll. Poll-to-shoulder
    # length is now about 1.5x the head length and the muzzle can reach the turf.
    def head_point(point):
        return Vector((point[0], -.91 + (point[1] + .70) * 1.06,
                       2.09 + (point[2] - 2.02) * 1.16))

    head.vertices = [head_point(v) for v in head.vertices]
    head.object(prefix + '_Head', head_pivot, head_origin, style)
    jaw_origin = head_point((0, -.845, 1.81))
    jaw_pivot = empty(prefix + '_JawPivot', head_pivot, jaw_origin - Vector(head_origin))
    jaw_pivot['anatomicalJoint'] = 'mandible'
    jaw = Mesh(rng)
    jaw.loft([((0, -.815, 1.79), .088, .043), ((0, -1.005, 1.69), .075, .039),
              ((0, -1.19, 1.623), .066, .029)], fill, 8, variation)
    if is_ink:
        for side in [-1, 1]:
            jaw.tube([(side * .079, -.835, 1.767), (side * .067, -1.008, 1.656),
                      (side * .058, -1.19, 1.614)], .005, INK, 4)
    jaw.vertices = [head_point(v) for v in jaw.vertices]
    jaw.object(prefix + '_Jaw', jaw_pivot, jaw_origin, style)
    muzzle_point = head_point((0, -1.237, 1.655))
    muzzle_anchor = empty(prefix + '_MuzzleAnchor', head_pivot, muzzle_point - Vector(head_origin))
    muzzle_anchor['role'] = 'grass contact at the authored lower lip edge'
    neck_delta, lip_delta = Vector(head_origin) - Vector(neck_origin), muzzle_point - Vector(head_origin)
    head_world_angle = math.pi - math.atan2(-lip_delta.y, lip_delta.z)
    neck_angle = math.acos((.09 + lip_delta.length - neck_origin[2]) / neck_delta.length) - math.atan2(-neck_delta.y, neck_delta.z)
    root['grazingRig'] = {'neckRestWorld': [0, neck_origin[2], -neck_origin[1]],
                         'pollRestWorld': [0, head_origin[2], -head_origin[1]],
                         'muzzleRestWorld': [0, muzzle_point.z, -muzzle_point.y],
                         'reviewNeckX': neck_angle, 'reviewHeadX': head_world_angle - neck_angle,
                         'reviewLipHeight': .09}

    for front, side, joint in [(True, -1, 'LegFL'), (True, 1, 'LegFR'),
                               (False, -1, 'LegBL'), (False, 1, 'LegBR')]:
        x = side * .215
        origin = (x, -.56, 1.30) if front else (x, .47, 1.34)
        proximal = (x, -.38, 1.12) if front else (x, .27, 1.04)
        knee = (x, -.40, .57) if front else (x, .66, .72)
        ankle = (x, -.40, .17) if front else (x, .66, .17)
        pivot = empty(prefix + '_' + joint, root, origin)
        proximal_name = 'ElbowPivot' if front else 'StiflePivot'
        distal_name = 'KneePivot' if front else 'HockPivot'
        proximal_pivot = empty(prefix + '_' + joint + '_' + proximal_name, pivot,
                               Vector(proximal) - Vector(origin))
        knee_pivot = empty(prefix + '_' + joint + '_' + distal_name, proximal_pivot,
                           Vector(knee) - Vector(proximal))
        hoof_pivot = empty(prefix + '_' + joint + '_HoofPivot', knee_pivot, Vector(ankle) - Vector(knee))
        pivot['anatomicalJoint'] = 'shoulder' if front else 'hip'
        proximal_pivot['anatomicalJoint'] = 'elbow' if front else 'stifle'
        knee_pivot['anatomicalJoint'] = 'carpus' if front else 'hock'
        hoof_pivot['anatomicalJoint'] = 'fetlock and hoof'
        to_three = lambda p: [float(p[0]), float(p[2]), float(-p[1])]
        pivot['horseLegRig'] = {
            'kind': 'fore' if front else 'hind',
            'version': 3,
            'jointSuffixes': [joint, joint + '_' + proximal_name, joint + '_' + distal_name,
                              joint + '_HoofPivot'],
            'segmentLengths': [(Vector(proximal) - Vector(origin)).length,
                               (Vector(knee) - Vector(proximal)).length,
                               (Vector(ankle) - Vector(knee)).length],
            'jointWorld': [to_three(p) for p in (origin, proximal, knee, ankle)],
            'jointLocal': [to_three(origin), to_three(Vector(proximal) - Vector(origin)),
                           to_three(Vector(knee) - Vector(proximal)), to_three(Vector(ankle) - Vector(knee))],
            'proximalBendDirection': -1 if front else 1,
            'distalBendDirection': 1 if front else -1,
            'ankleHeight': .17, 'rotationAxis': '+X',
        }
        upper, lower, foot = Mesh(rng), Mesh(rng), Mesh(rng)
        if not front:
            thigh = Mesh(rng)
            thigh.tube([origin, proximal], [.133, .076], fill, 8, variation)
            if is_ink:
                thigh.tube([(x + side * .118, origin[1], origin[2]),
                            (x + side * .071, proximal[1], proximal[2])], .006, INK, 4)
            thigh.object(prefix + '_' + joint + '_Thigh', pivot, origin, style)
            upper.ellipsoid(proximal, (.071, .078, .07), fill, 8, 3, variation)
        upper_points = [proximal, Vector(proximal).lerp(Vector(knee), .45), knee]
        upper.tube(upper_points, [.068, .052, .041] if front else [.077, .063, .043], fill, 8, variation)
        lower.ellipsoid(knee, (.047, .054, .05), fill, 8, 3, variation)
        lower.tube([knee, ankle], [.034, .032] if front else [.038, .034], fill, 8, variation)
        foot.ellipsoid(ankle, (.043, .047, .046), fill, 8, 3, variation)
        foot_y = ankle[1] - .060
        foot.tube([ankle, (x, foot_y, .085)], [.036, .047], fill, 8, variation)
        # Small cream socks alternate for a more individual, less toy-like herd.
        has_sock = (coat == 'Cream') or (coat == 'Chestnut' and side < 0) or (not front and side > 0)
        if has_sock:
            sock_start = Vector(ankle).lerp(Vector(knee), .17)
            lower.tube([sock_start, ankle], [.036, .035], sock, 8)
            foot.tube([ankle, (x, foot_y, .085)], [.039, .049], sock, 8)
        hoof = (.22, .22, .20) if coat != 'Cream' else (.42, .37, .29)
        # A real flat sole makes stance locking measurable at ground level.
        foot.surface([(x - .063, foot_y + .060, 0), (x + .063, foot_y + .060, 0),
                      (x + .070, foot_y - .105, 0), (x - .070, foot_y - .105, 0),
                      (x - .050, foot_y + .050, .090), (x + .050, foot_y + .050, .090),
                      (x + .055, foot_y - .072, .081), (x - .055, foot_y - .072, .081)],
                     [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                      (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], hoof, variation)
        if is_ink:
            outer = [(p[0] + side * r, p[1] - .009, p[2])
                     for p, r in zip(upper_points, [.063 if front else .074, .050 if front else .060, .040])]
            upper.tube(outer, .006, INK, 4)
            lower.tube([(x + side * .036, knee[1], knee[2]),
                        (x + side * .033, ankle[1], ankle[2])], .005, INK, 4)
            foot.tube([(x + side * .050, foot_y, .105), (x + side * .059, foot_y - .069, .07),
                       (x + side * .059, foot_y - .1, .014)], .006, INK, 4)
        upper.object(prefix + '_' + joint + '_Forearm' if front else prefix + '_' + joint + '_Gaskin',
                     proximal_pivot, proximal, style)
        lower.object(prefix + '_' + joint + '_Lower', knee_pivot, knee, style)
        foot.object(prefix + '_' + joint + '_Hoof', hoof_pivot, ankle, style)
        for marker, position in [('ToeAnchor', (x, foot_y - .105, 0)),
                                  ('HeelAnchor', (x, foot_y + .060, 0)),
                                  ('SoleAnchor', (x, foot_y - .02, 0))]:
            empty(prefix + '_' + joint + '_' + marker, hoof_pivot, Vector(position) - Vector(ankle))
        hoof_pivot['soleLocal'] = [0, -.17, .080]
        hoof_pivot['toeLocal'] = [0, -.17, .165]
        hoof_pivot['heelLocal'] = [0, -.17, 0]

    tail_origin = (0, .697, 1.38)
    tail_pivot = empty(prefix + '_TailPivot', root, tail_origin)
    tail = Mesh(rng)
    tail.tube([(0, .698, 1.38), (0, .89, 1.24), (.025, 1.035, .93),
               (.06, 1.052, .59), (.10, 1.00, .43)], [.067, .082, .087, .065, .002], hair, 7, variation)
    for i in range(3):
        x = (i - 1) * .038
        tail.leaf([(x, .92, 1.11), (x + .015, 1.075, .78), (x + .04, 1.04, .48 - i * .023)],
                  [.035, .029, .001], tuple(min(1, c + .055) for c in hair))
    if is_ink:
        for side in [-1, 1]:
            tail.tube([(side * .04, .73, 1.36), (side * .073, .92, 1.19),
                       (side * .083 + .02, 1.054, .82), (.1, 1.01, .43)], .006, INK, 4)
    tail.object(prefix + '_Tail', tail_pivot, tail_origin, style)
    bpy.context.view_layer.update()
    floor_z = min((obj.matrix_world @ vertex.co).z for obj in descendants(root)
                  if obj.type == 'MESH' for vertex in obj.data.vertices)
    for child in root.children:
        child.location.z -= floor_z
    return root


def descendants(obj):
    return [obj] + [child for c in obj.children for child in descendants(c)]


def unlit_glb(filepath):
    """Declare the ink's vertex-color palette unlit, as the web pen shader expects.

    The exporter discovers COLOR_0 reliably through the Principled base-color
    socket. Its web equivalent must not let exposure darken the paper.
    """
    raw = filepath.read_bytes()
    length, kind = struct.unpack_from('<II', raw, 12)
    assert kind == 0x4E4F534A
    gltf = json.loads(raw[20:20 + length])
    gltf['extensionsUsed'] = [e for e in gltf.get('extensionsUsed', []) if e != 'KHR_materials_specular']
    gltf['extensionsUsed'].append('KHR_materials_unlit')
    for mat in gltf['materials']:
        mat.pop('extensions', None)
        mat['extensions'] = {'KHR_materials_unlit': {}}
    encoded = json.dumps(gltf, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    binary = raw[20 + length:]
    filepath.write_bytes(struct.pack('<III', 0x46546C67, 2, 20 + len(encoded) + len(binary))
                         + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + binary)


all_horses, manifest = [], {}
for style in ('ink', 'low-poly'):
    # Blender auto-suffixes shared names; rename the previous style before building.
    for previous in all_horses:
        previous.name = previous.name + '_Studio'
    horses = [build_horse(style, coat) for coat in PALETTES[style]]
    bpy.ops.object.select_all(action='DESELECT')
    for horse in horses:
        for obj in descendants(horse):
            obj.select_set(True)
    filepath = OUT / f'horses-{style}.glb'
    bpy.ops.export_scene.gltf(filepath=str(filepath), export_format='GLB',
        use_selection=True, export_apply=True, export_texcoords=False,
        export_normals=True, export_materials='EXPORT', export_cameras=False,
        export_lights=False, export_animations=False, export_yup=True, export_extras=True)
    if style == 'ink':
        unlit_glb(filepath)
    bpy.context.view_layer.update()
    coords = [obj.matrix_world @ vertex.co for obj in descendants(horses[0])
              if obj.type == 'MESH' for vertex in obj.data.vertices]
    minima = [min(v[i] for v in coords) for i in range(3)]
    maxima = [max(v[i] for v in coords) for i in range(3)]
    manifest[style] = {'file': str(filepath.relative_to(ROOT)), 'bytes': filepath.stat().st_size,
                      'roots': [h.name for h in horses], 'meshCountPerHorse': 19,
                      'rigVersion': 3,
                      'pivotNames': ['LegFL', 'LegFR', 'LegBL', 'LegBR', 'ElbowPivot', 'KneePivot',
                                     'StiflePivot', 'HockPivot', 'HoofPivot', 'NeckPivot', 'HeadPivot',
                                     'JawPivot', 'MuzzleAnchor', 'ToeAnchor', 'HeelAnchor'],
                      'forward': '+Z', 'up': '+Y', 'height': round(maxima[2], 5),
                      'feetY': round(minima[2], 5), 'maximumLength': round(maxima[1] - minima[1], 5),
                      'boundsThree': {'min': [minima[0], minima[2], -maxima[1]],
                                      'max': [maxima[0], maxima[2], -minima[1]]},
                      'triangles': sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
                          for h in horses for o in descendants(h) if o.type == 'MESH')}
    all_horses.extend(horses)

# Match the ink's web material in the editable studio after export.
ink_nodes = MATERIALS['ink'].node_tree
ink_nodes.links.new(next(n for n in ink_nodes.nodes if n.bl_idname == 'ShaderNodeVertexColor').outputs['Color'],
                    ink_nodes.nodes.get('Material Output').inputs['Surface'])

# Arrange an editable Blender design studio and render a single contact sheet.
for i, horse in enumerate(all_horses):
    row, col = divmod(i, 3)
    horse.location = ((col - 1) * 3.05, row * 4.0, 0)
    horse.rotation_euler.z = math.radians(-57)
    horse.name = ('INK_' if row == 0 else 'LOW_POLY_') + list(PALETTES['ink'])[col]

def plain_mat(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color(rgb)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color(rgb)
    bsdf.inputs['Roughness'].default_value = 1
    return mat

floor = plain_mat('Studio • oat paper', (.92, .90, .84))
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.013))
bpy.context.object.name = 'Review background — excluded from GLBs'
bpy.context.object.data.materials.append(floor)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.world.color = (.7, .7, .7)
for name, loc, energy, size in [('Key', (-5, -5, 9), 1700, 7), ('Fill', (6, 0, 7), 900, 7)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    lamp = bpy.context.object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.shape = 'DISK'
    lamp.data.size = size
    lamp.rotation_euler = (Vector((0, 2, 0)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.camera_add(location=(6, -12, 12))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 2.0, .70)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 12.3
scene.camera = camera
scene.render.resolution_x = 1700
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(REVIEW / 'horses-contact-sheet.png')
scene['asset_notes'] = 'Three coats in each theme. Nineteen meshes per horse, one material each. Reference-shaped fore shoulder/elbow/carpus and hind hip/stifle/hock chains; grazing lip anchor and jaw. Feet at ground, +Z forward. Rerun scripts/build_horses.py to reproduce.'
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets' / 'horses.blend'))
bpy.ops.render.render(write_still=True)

# The grazing review proves actual lip AND head geometry clear the ground.
for horse in all_horses:
    for obj in descendants(horse):
        if obj.name.endswith('_NeckPivot'):
            obj.rotation_euler.x = horse['grazingRig']['reviewNeckX']
        elif obj.name.endswith('_HeadPivot'):
            obj.rotation_euler.x = horse['grazingRig']['reviewHeadX']
        elif obj.name.endswith('_JawPivot'):
            obj.rotation_euler.x = .025
bpy.context.view_layer.update()
for style, horse in [('ink', all_horses[0]), ('low-poly', all_horses[3])]:
    lip = next(o for o in descendants(horse) if o.name.endswith('_MuzzleAnchor'))
    head = next(o for o in descendants(horse) if o.name.endswith('_HeadPivot'))
    points = [obj.matrix_world @ vertex.co for obj in descendants(head)
              if obj.type == 'MESH' for vertex in obj.data.vertices]
    min_head_z = min(p.z for p in points)
    lip_z = lip.matrix_world.translation.z
    assert min_head_z >= -.002, f'Grazing head penetrates ground: {min_head_z}'
    assert .03 <= lip_z <= .10, f'Lip is outside grazing band: {lip_z}'
    manifest[style]['grazingReview'] = {'lipHeight': lip_z, 'minimumHeadHeight': min_head_z,
        'neckX': float(horse['grazingRig']['reviewNeckX']), 'headX': float(horse['grazingRig']['reviewHeadX'])}
scene.render.filepath = str(REVIEW / 'horses-grazing-contact-sheet.png')
bpy.ops.render.render(write_still=True)
for horse in all_horses:
    for obj in descendants(horse):
        if obj.name.endswith(('_NeckPivot', '_HeadPivot', '_JawPivot')):
            obj.rotation_euler.x = 0
(REVIEW / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('HORSE_ASSETS', json.dumps(manifest))


def render_gait_contact(pose_file, output_name='horses-walk-v3-contact-sheet.png', mode='walk'):
    """Render measured runtime poses in both themes, without changing the GLBs.

    Optional: -- --gait-poses assets/horse-review/gait-poses.json
    JSON: [{phase, bodyY, neckX, headX,
            joints: {LegFL: {upper, knee, hoof}, LegFR: ..., LegBL: ..., LegBR: ...}}]
    Joint values are local X rotation radians or [x,y,z,w] glTF quaternions.
    """
    poses = json.loads(Path(pose_file).read_text())
    if isinstance(poses, dict):
        poses = poses['poses']
    assert poses, 'Contact sheet needs measured runtime poses'
    if mode == 'graze' and len(poses) == 18:
        poses = [poses[i] for i in [0, 3, 4, 5, 9, 13, 15, 17]]
    elif len(poses) > 8:
        poses = [poses[round(i * len(poses) / 8) % len(poses)] for i in range(8)]
    existing_objects = set(bpy.data.objects)
    for obj in bpy.context.scene.objects:
        if obj.type == 'LIGHT':
            obj.hide_render = True
    # Side views look past the original floor. Use a paper backdrop and a
    # uniform sun so every frame has the same readable contrast and lighting.
    backdrop = plain_mat('Side review paper', (.95, .94, .90))
    rgb = backdrop.node_tree.nodes.new('ShaderNodeRGB')
    rgb.outputs[0].default_value = color((.95, .94, .90))
    backdrop.node_tree.links.new(rgb.outputs[0], backdrop.node_tree.nodes.get('Material Output').inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=100, location=(2, 0, 2.6), rotation=(0, math.pi / 2, 0))
    bpy.context.object.data.materials.append(backdrop)
    bpy.ops.object.light_add(type='SUN', location=(-4, -2, 7))
    sun = bpy.context.object
    sun.data.energy = 2.0
    sun.data.angle = .2
    sun.rotation_euler = Vector((4, 2, -7)).to_track_quat('-Z', 'Y').to_euler()
    for horse in all_horses:
        for obj in descendants(horse):
            obj.hide_render = True

    def clone_tree(original, parent=None):
        clone = original.copy()
        bpy.context.collection.objects.link(clone)
        clone.parent = parent
        clone.hide_render = False
        for child in original.children:
            clone_tree(child, clone)
        return clone

    def apply_joint(obj, value):
        if isinstance(value, list):
            x, y, z, w = value
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = Quaternion((w, x, -z, y))
        else:
            obj.rotation_euler.x = value

    label_material = plain_mat('Gait labels', (.18, .18, .16))
    label_rgb = label_material.node_tree.nodes.new('ShaderNodeRGB')
    label_rgb.outputs[0].default_value = color((.18, .18, .16))
    label_material.node_tree.links.new(label_rgb.outputs[0], label_material.node_tree.nodes.get('Material Output').inputs['Surface'])
    label_rotation = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0))).to_euler()
    for row, template in enumerate((all_horses[3], all_horses[0])):
        for column, pose in enumerate(poses):
            horse = clone_tree(template)
            horse.name = f'Gait_{row}_{column}'
            centre_y = -(column - (len(poses) - 1) / 2) * 3.25
            baseline = row * 3.15
            horse.location = (0, centre_y, baseline + pose.get('bodyY', 0))
            horse.rotation_euler.z = 0
            for obj in descendants(horse):
                for leg_name, angles in pose.get('joints', {}).items():
                    name = obj.name.split('.')[0]
                    if name.endswith('_' + leg_name):
                        apply_joint(obj, angles.get('upperQuaternion', angles['upper']))
                    elif name.endswith('_' + leg_name + '_KneePivot'):
                        apply_joint(obj, angles.get('kneeQuaternion', angles['knee']))
                    elif name.endswith('_' + leg_name + '_HoofPivot'):
                        apply_joint(obj, angles.get('hoofQuaternion', angles['hoof']))
                if 'NeckPivot' in obj.name:
                    obj.rotation_euler.x = pose.get('neckX', 0)
                elif 'HeadPivot' in obj.name:
                    obj.rotation_euler.x = pose.get('headX', 0)
                for suffix, value in pose.get('jointQuaternions', {}).items():
                    if obj.name.split('.')[0].endswith('_' + suffix):
                        apply_joint(obj, value)
                for suffix, value in pose.get('jointPositions', {}).items():
                    if obj.name.split('.')[0].endswith('_' + suffix):
                        obj.location = (value[0], -value[2], value[1])
            horse['gaitPhase'] = pose['phase']
            rule = Mesh(random.Random(column))
            rule.tube([(0, centre_y - 1.50, baseline - .014),
                       (0, centre_y + 1.50, baseline - .014)], .006, INK, 4)
            rule.object(f'Ground_{row}_{column}', None, (0, 0, 0), 'ink')
            bpy.ops.object.text_add(location=(-.5, centre_y, baseline - .28))
            text_obj = bpy.context.object
            text_obj.name = f'Phase_{row}_{column}'
            text_obj.data.body = (f"{pose.get('label', column + 1)} / {pose.get('activity', mode)}"
                                  if mode == 'graze' else f"{pose.get('label', column + 1)} / {pose['phase'] % 1:.2f}")
            text_obj.data.align_x = 'CENTER'
            text_obj.data.size = .145
            text_obj.rotation_euler = label_rotation
            text_obj.data.materials.append(label_material)
    camera.location = (-12, 0, 2.68)
    camera.rotation_euler = (Vector((0, 0, 2.68)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.ortho_scale = max(10, len(poses) * 3.28)
    scene.render.resolution_x = max(1600, len(poses) * 440)
    scene.render.resolution_y = 830
    scene.render.filepath = str(REVIEW / output_name)
    bpy.ops.render.render(write_still=True)
    for obj in list(bpy.data.objects):
        if obj not in existing_objects:
            bpy.data.objects.remove(obj, do_unlink=True)


if '--gait-poses' in sys.argv:
    render_gait_contact(sys.argv[sys.argv.index('--gait-poses') + 1])
if '--graze-poses' in sys.argv:
    render_gait_contact(sys.argv[sys.argv.index('--graze-poses') + 1], 'horses-graze-v3-contact-sheet.png', 'graze')
