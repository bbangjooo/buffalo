"""Crafted low-poly upright piano for the four-room portfolio.

Public interface: build_piano(room_root, palette) -> metadata.
All authored coordinates use Three.js (x, y-up, z-front).  The room root is
expected to be unrotated during construction and may be transformed afterward.
No cameras, lights, exports or scene clearing happen here.

PianoKey60..PianoKey83 have origins at their rear hinges.  In the exported
Three.js hierarchy, translate local Y by -0.025 or rotate local X by -0.045 to
depress a key.
"""

import math
import bpy
import bmesh
from mathutils import Vector, Quaternion


def _b(xyz):
    x, y, z = xyz
    return Vector((x, -z, y))


def _material(palette, name, roughness=.90, metallic=0.0):
    """Own matte materials even when the room builder passes shared materials."""
    source = palette[name]
    material = bpy.data.materials.get("PianoFacet_" + name)
    if material:
        return material
    if isinstance(source, bpy.types.Material):
        material = source.copy()
        material.name = "PianoFacet_" + name
    else:
        material = bpy.data.materials.new("PianoFacet_" + name)
        value = source.lstrip("#")
        srgb = tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
        linear = tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in srgb)
        material.diffuse_color = (*linear, 1)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if not isinstance(source, bpy.types.Material):
        bsdf.inputs["Base Color"].default_value = material.diffuse_color
    bsdf.inputs["Roughness"].default_value = max(.88, roughness)
    bsdf.inputs["Metallic"].default_value = 0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = .16
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0
    return material


def _tone(name, material, other=None, mix=0, factor=1):
    """A few coherent face tones derived only from the personal palette."""
    tone = material.copy()
    tone.name = "PianoFacet_" + name
    node = tone.node_tree.nodes["Principled BSDF"]
    base = list(node.inputs["Base Color"].default_value)
    target = other.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value if other else base
    color = tuple((base[i] * (1 - mix) + target[i] * mix) * factor for i in range(3))
    node.inputs["Base Color"].default_value = (*color, 1)
    tone.diffuse_color = (*color, 1)
    return tone


def _empty(name, xyz, parent):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = _b(xyz)
    obj.empty_display_size = .08
    return obj


def _mesh(name, vertices, faces, materials, parent, face_tones=None):
    """Explicit large faces; neither bevel subdivision nor fake coplanar facets."""
    data = bpy.data.meshes.new(name + "Mesh")
    data.from_pydata([_b(v) for v in vertices], [], faces)
    data.update()
    for material in materials:
        data.materials.append(material)
    for polygon, index in zip(data.polygons, face_tones or [0] * len(faces)):
        polygon.material_index = index
        polygon.use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def _ring_hull(name, rings, materials, parent, tones=None):
    """Join polygon rings. Each band is a deliberate change in the silhouette."""
    count = len(rings[0])
    vertices = [point for ring in rings for point in ring]
    faces = [tuple(reversed(range(count)))]
    for band in range(len(rings) - 1):
        a, b = band * count, (band + 1) * count
        faces.extend((a + i, a + (i + 1) % count, b + (i + 1) % count, b + i)
                     for i in range(count))
    faces.append(tuple(range(len(vertices) - count, len(vertices))))
    return _mesh(name, vertices, faces, materials, parent, tones)


def _cut_rectangle(cx, y, half_width, back, front, cut):
    return [(cx + x, y, z) for x, z in [
        (-half_width + cut, back), (half_width - cut, back),
        (half_width, back + cut), (half_width, front - cut),
        (half_width - cut, front), (-half_width + cut, front),
        (-half_width, front - cut), (-half_width, back + cut),
    ]]


def _finish(obj, name, material, parent, bevel=0, segments=1):
    obj.name = name
    obj.parent = parent
    if material:
        obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("Single planar chamfer", "BEVEL")
        # One cut keeps the edge visibly planar, including legacy helper calls
        # that supplied a higher segment count before the low-poly revision.
        mod.width, mod.segments = bevel, 1
        mod.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj.select_set(False)
    return obj


def _box(name, xyz, size, mat, parent, bevel=.025, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=_b(xyz))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rotation:
        axis, angle = rotation
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Quaternion(_b(axis), angle)
    return _finish(obj, name, mat, parent, bevel)


def _cylinder(name, xyz, radius, depth, mat, parent, vertices=8, bevel=.01):
    bpy.ops.mesh.primitive_cylinder_add(vertices=min(8, max(6, vertices)), radius=radius,
                                      depth=depth, location=_b(xyz))
    return _finish(bpy.context.object, name, mat, parent, bevel, 2)


def _rod(name, start, end, radius, mat, parent, vertices=8):
    start_b, end_b = _b(start), _b(end)
    delta = end_b - start_b
    bpy.ops.mesh.primitive_cylinder_add(vertices=min(8, max(6, vertices)), radius=radius, depth=delta.length,
                                      location=(start_b + end_b) / 2)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return _finish(obj, name, mat, parent)


def _sphere(name, xyz, size, mat, parent, segments=16, rings=8):
    # A 20-face ellipsoid retains rounded silhouettes through large triangular
    # facets. Arguments remain compatible with the authored detail placements.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=_b(xyz))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, name, mat, parent)


def _extrude(name, polygon, bottom, top, axis, mat, parent, bevel=0, origin=None):
    """Extrude an x/z footprint on Y, or y/z side profile on X."""
    if axis == "Y":
        verts = [(a, h, b) for h in (bottom, top) for a, b in polygon]
    else:
        verts = [(h, a, b) for h in (bottom, top) for a, b in polygon]
    n = len(polygon)
    # The input polygons are clockwise viewed from +Y / counterclockwise from +X.
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
    pivot = _b(origin or (0, 0, 0))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata([_b(v) - pivot for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = pivot
    # Recalculate outside normals, including concave L-shaped white keys.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return _finish(obj, name, mat, parent, bevel, 2)


def _arc_profile(y0, z0, radius_y, radius_z, start, end, steps=7):
    steps = min(steps, 4)
    return [(y0 + radius_y * math.sin(t), z0 + radius_z * math.cos(t))
            for t in [start + (end - start) * i / steps for i in range(steps + 1)]]


def _music_book(parent, m):
    # A shallow, forward-set score stays clear of the upright's front panel.
    # Its lower edge is above the black keys and behind their visible tips;
    # seated rays from PianoEyeAnchor reach all 24 keys below this small ledge.
    stand = _empty("PianoMusicRest", (2.8, 1.79, 1.635), parent)
    stand.rotation_mode = "QUATERNION"
    stand.rotation_quaternion = Quaternion((1, 0, 0), math.radians(-8))
    _extrude("PianoMusicRestLip", [(-.69, -.055), (.69, -.055), (.60, .13), (-.60, .13)],
             -.32, -.255, "Y", m["walnut"], stand)
    for side in (-1, 1):
        page = _empty("PianoScoreLeaf" + str(side), (side * .292, .08, .042), stand)
        page.rotation_mode = "QUATERNION"
        page.rotation_quaternion = Quaternion((0, 0, 1), side * math.radians(9))
        outline = [(-.278, -.327), (.278, -.327), (.278, .24), (.185, .344), (-.278, .344)]
        vertices = [(x, y, z) for z in (-.02, .0) for x, y in outline]
        faces = [(4, 3, 2, 1, 0), (5, 6, 7, 8, 9)]
        faces += [(i, (i + 1) % 5, (i + 1) % 5 + 5, i + 5) for i in range(5)]
        _mesh("PianoScorePaper" + str(side), vertices, faces,
              [m["paper"], m["chalk"]], page, [1, 0, 1, 1, 1, 1, 1])
        _mesh("PianoFoldedPageCorner" + str(side),
              [(.185, .344, 0), (.278, .24, 0), (.13, .235, .036)], [(0, 1, 2)],
              [m["chalk"]], page)
        _box("PianoScoreTitle", (0, .26, .002), (.19, .009, .003), m["muted"], page, 0)
        glyph = [(-.030, -.010), (-.014, -.023), (.018, -.017), (.026, .002),
                 (.026, .091), (.014, .091), (.014, .012), (-.017, .015)]
        for row, y in enumerate((.105, -.12)):
            for line in range(5):
                _box("PianoScoreStaff", (0, y - line * .019, .002),
                     (.435, .003, .003), m["slate"], page, 0)
            for i, x in enumerate((-.135, .105)):
                note_y = y - ((row + i * 2) % 4) * .019
                vertices = [(x + a, note_y + b, .005) for a, b in glyph]
                _mesh("PianoScoreNote", vertices, [tuple(range(len(vertices)))], [m["ink"]], page)


def _bench(parent, m):
    bench = _empty("PianoBench", (2.8, 0, 2.86), parent)
    # Restrained square legs recover the earlier bench proportions while
    # retaining the room's clear planar geometry and quiet matte wood finish.
    for sx in (-1, 1):
        for sz in (-1, 1):
            rings = []
            for y, x, z, half in ((.03, sx * .66, sz * .27, .046),
                                 (.685, sx * .61, sz * .245, .058)):
                rings.append([(x + dx, y, z + dz) for dx, dz in
                              [(-half, -half), (half, -half), (half, half), (-half, half)]])
            _ring_hull("PianoBenchLeg", rings, [m["walnut"]], bench)
    _box("PianoBenchUnderframe", (0, .65, 0), (1.46, .135, .70), m["walnut"], bench, .018)
    # A flat eight-sided center and one restrained sloping edge band replace the
    # peaked cushion. No buttons, stitching or piping compete with the piano.
    rings = [_cut_rectangle(0, .714, .77, -.395, .395, .075),
             _cut_rectangle(0, .758, .78, -.405, .405, .075),
             _cut_rectangle(0, .839, .705, -.33, .33, .038)]
    _ring_hull("PianoBenchCushion", rings, [m["teal"], m["tealDark"]], bench,
               [1] + [1] * 8 + [0] * 8 + [0])
    return bench


def build_piano(room_root, palette):
    """Create instrument and bench, then return their local metadata."""
    names = ("ink", "paper", "teal", "brass", "walnut", "wood", "chalk", "muted", "slate")
    m = {name: _material(palette, name) for name in names}
    m["inkLight"] = _tone("inkLight", m["ink"], m["teal"], mix=.42)
    m["inkDark"] = _tone("inkDark", m["ink"], factor=.72)
    m["woodLight"] = _tone("woodLight", m["walnut"], m["wood"], mix=.20)
    m["tealLight"] = _tone("tealLight", m["teal"], m["paper"], mix=.14)
    m["tealDark"] = _tone("tealDark", m["teal"], factor=.72)
    piano = _empty("Piano", (0, 0, 0), room_root)
    piano["instrument"] = "upright piano"
    piano["midiRange"] = "60-83"
    piano["style"] = "quiet upright proportions, slim walnut framing, matte planar chamfers"

    # Recover the calm upright silhouette: a slim top and one walnut frame
    # around each plain panel. Only the manufactured edge cuts remain faceted.
    _box("PianoCabinet", (2.8, 1.225, .985), (3.50, 2.23, .73), m["ink"], piano, .042)
    _box("PianoCrown", (2.8, 2.36, 1.00), (3.62, .105, .84), m["walnut"], piano, .026)
    _box("PianoUpperFrame", (2.8, 1.86, 1.365), (3.13, .75, .032), m["walnut"], piano, .016)
    _box("PianoUpperField", (2.8, 1.86, 1.385), (2.985, .605, .025), m["ink"], piano, .010)
    for x in (1.135, 4.465):
        _box("PianoCabinetStile", (x, 1.23, 1.354), (.11, 2.02, .078), m["walnut"], piano, .019)
    _box("PianoLowerFrame", (2.8, .66, 1.37), (3.05, .67, .042), m["walnut"], piano, .016)
    _box("PianoLowerField", (2.8, .66, 1.395), (2.90, .515, .021), m["ink"], piano, .009)
    _box("PianoBasePlinth", (2.8, .135, 1.02), (3.55, .17, .79), m["walnut"], piano, .024)
    _box("PianoKeybed", (2.8, 1.145, 1.705), (3.46, .14, .86), m["walnut"], piano, .026)
    _box("PianoKeyboardShadow", (2.8, 1.228, 1.706), (3.04, .024, .77), m["inkDark"], piano, 0)

    # The earlier curved cheek is reduced to four quiet planes, preserving its
    # elegant profile without the last revision's large diagonal strut.
    profile = [(.10, 1.89), (.10, 2.035), (1.195, 2.135)]
    profile += _arc_profile(1.215, 1.915, .195, .215, 0, math.pi / 2, 4)
    profile += [(1.405, 1.35), (.35, 1.35), (.30, 1.66), (.19, 1.78)]
    for side, x in (("L", 1.145), ("R", 4.455)):
        _extrude("PianoCheek" + side, profile, x - .105, x + .105,
                 "X", m["ink"], piano, .012)
        _box("PianoFoot" + side, (x, .071, 1.965), (.155, .078, .16), m["walnut"], piano, .012)

    # Twenty-four independent, correctly spaced keys. White key shoulders are
    # notched around raised black keys, including the E-F and B-C gaps.
    keyboard_left, key_pitch, back, front, shoulder = 1.33, .21, 1.346, 2.087, 1.812
    white_midis = [midi for midi in range(60, 84) if midi % 12 in (0, 2, 4, 5, 7, 9, 11)]
    keys = []
    for index, midi in enumerate(white_midis):
        x = keyboard_left + key_pitch * (index + .5)
        left, right = x - .101, x + .101
        black_left = midi % 12 in (2, 4, 7, 9, 11)
        black_right = midi % 12 in (0, 2, 5, 7, 9)
        back_left, back_right = left + (.060 if black_left else 0), right - (.060 if black_right else 0)
        polygon = [(left, front), (right, front), (right, shoulder), (back_right, shoulder),
                   (back_right, back), (back_left, back), (back_left, shoulder), (left, shoulder)]
        # Deduplicate coincident corners on E/B and C/F keys.
        polygon = [v for i, v in enumerate(polygon) if v != polygon[i - 1]]
        key = _extrude("PianoKey" + str(midi), polygon, 1.223, 1.278, "Y", m["paper"], piano,
                       .005, origin=(x, 1.25, back))
        key["midi"] = midi
        key["pressAxisThree"] = "x"
        keys.append({"name": key.name, "midi": midi, "position": [x, 1.285, 1.99], "black": False})
    for midi in range(60, 84):
        if midi in white_midis:
            continue
        preceding = sum(1 for white in white_midis if white < midi)
        x = keyboard_left + key_pitch * preceding
        key = _box("PianoKey" + str(midi), (x, 1.325, 1.584), (.111, .108, .455), m["ink"], piano, .009)
        # Move origin to rear hinge without moving the visible mesh.
        pivot = _b((x, 1.27, back))
        offset = key.location - pivot
        for vertex in key.data.vertices:
            vertex.co += offset
        key.location = pivot
        key["midi"] = midi
        key["pressAxisThree"] = "x"
        keys.append({"name": key.name, "midi": midi, "position": [x, 1.386, 1.63], "black": True})
    _box("PianoFallboardRail", (2.8, 1.381, 1.325), (3.18, .18, .074), m["ink"], piano, 0)

    # Three simple broad pedal wedges retain the instrument's identity.
    _box("PianoPedalMount", (2.8, .21, 1.424), (.69, .17, .15), m["inkDark"], piano, 0)
    for x in (2.57, 2.8, 3.03):
        _extrude("PianoPedal", [(.12, 1.47), (.18, 1.47), (.145, 2.04), (.085, 2.04)],
                 x - .052, x + .052, "X", m["wood"], piano)

    # The forward score ledge is carried by two discreet brackets. Millimetre
    # fitting gaps keep the individual exported solids free of intersections.
    for x in (2.22, 3.38):
        _box("PianoMusicSupport", (x, 1.495, 1.4975), (.045, .04, .227), m["walnut"], piano, 0)
    _music_book(piano, m)
    _bench(room_root, m)
    _empty("PianoAnchor", (2.8, 2.72, 1.72), room_root)
    return {
        "keys": sorted(keys, key=lambda key: key["midi"]),
        "anchors": {"PianoAnchor": [2.8, 2.72, 1.72]},
        "instrument": "Piano",
    }
