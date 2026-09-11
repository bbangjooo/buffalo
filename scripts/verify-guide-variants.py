"""Read-only shading checks on saved Blender sources and the actual exported GLBs.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
    --python scripts/verify-guide-variants.py

No scenes are saved or exported. Source hashes are checked after inspection.
Unlike the Node metadata checks, this imports Draco geometry and reads actual
corner normals, so smooth/flat claims do not rely on a style label alone.
"""
from pathlib import Path
from math import cos, radians
import hashlib
import json
import bpy


ROOT = Path(__file__).resolve().parents[1]
VARIANTS = ("faceted", "smooth")
MAX_FLAT_DEVIATION = cos(radians(1.0))
MAX_CONSTANT_DEVIATION = cos(radians(.1))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def descends_from(obj, root):
    while obj:
        if obj == root:
            return True
        obj = obj.parent
    return False


def inspect_scene(style, exported):
    root = bpy.data.objects.get("GuideCharacter")
    assert root is not None, "GuideCharacter root is missing"
    assert root.get("style") == style, "Variant style metadata differs from its requested file"
    objects = [obj for obj in bpy.data.objects if obj.type == "MESH" and descends_from(obj, root)]
    assert objects, "No character meshes found"
    head = bpy.data.objects.get("GuideHead")
    assert head is not None, "Head pivot is missing"
    total = smooth_polygons = corners = interpolated_corners = varying_corners = triangles = custom_meshes = 0
    face_materials = set()
    for obj in objects:
        assert not obj.modifiers, f"{obj.name}: modifiers should be baked for comparison/export"
        mesh = obj.data
        mesh.calc_loop_triangles()
        mesh.update()
        triangles += len(mesh.loop_triangles)
        custom_meshes += bool(getattr(mesh, "has_custom_normals", False))
        normals = mesh.corner_normals
        assert len(normals) == len(mesh.loops), f"{obj.name}: missing corner normals"
        for material in mesh.materials:
            if material and any(word in material.name.lower() for word in ("eyes", "nose", "mouth", "cheeks")):
                assert descends_from(obj, head), f"Facial geometry {obj.name} is not attached to the head"
                face_materials.add(material.name)
            if material and material.node_tree:
                assert not any(node.type == "TEX_IMAGE" and node.image for node in material.node_tree.nodes), "Character materials must not load reference photos"
        for polygon in mesh.polygons:
            total += 1
            smooth_polygons += polygon.use_smooth
            face_normal = polygon.normal.normalized()
            first_normal = normals[polygon.loop_start].vector.normalized()
            assert face_normal.length > .99, f"{obj.name}: degenerate face normal"
            for index in polygon.loop_indices:
                normal = normals[index].vector.normalized()
                assert normal.length > .99, f"{obj.name}: invalid exported normal"
                corners += 1
                interpolated_corners += normal.dot(face_normal) < MAX_FLAT_DEVIATION
                varying_corners += normal.dot(first_normal) < MAX_CONSTANT_DEVIATION
    assert total and corners and len(face_materials) >= 4, "Face geometry or shading data is missing"
    smooth_ratio = smooth_polygons / total
    interpolated_ratio = interpolated_corners / corners
    varying_ratio = varying_corners / corners
    if style == "faceted":
        assert 400 < triangles < 3500, f"Faceted triangle count {triangles} is outside the broad-facet budget"
        if not exported:
            assert smooth_polygons == 0, f"Faceted source has {smooth_polygons} smoothed polygons"
        # Export triangulates authored quads. A flat nonplanar quad can retain
        # one shared normal that differs from either triangle's geometric
        # normal; flat appearance requires constant normals across its corners.
        assert varying_ratio < .005, f"Faceted polygons interpolate their normals: {varying_ratio:.1%}"
    else:
        assert 3500 < triangles < 100000, f"Smooth triangle count {triangles} is outside the dense-mesh budget"
        if not exported:
            assert smooth_ratio > .9, f"Smooth source has only {smooth_ratio:.1%} smooth polygons"
        assert interpolated_ratio > .3, f"Smooth geometry still has mostly flat corner normals: {interpolated_ratio:.1%}"
        assert varying_ratio > .3, f"Smooth polygons lack varying corner normals: {varying_ratio:.1%}"
    return {
        "meshes": len(objects),
        "triangles": triangles,
        "polygons": total,
        "smoothPolygonRatio": round(smooth_ratio, 5),
        "interpolatedCornerRatio": round(interpolated_ratio, 5),
        "varyingFaceCornerRatio": round(varying_ratio, 5),
        "meshesWithCustomNormals": custom_meshes,
    }


paths = [ROOT / directory / f"character-guide-{style}.{suffix}"
         for style in VARIANTS for directory, suffix in (("assets", "blend"), ("public/Room", "glb"))]
for path in paths:
    assert path.is_file(), f"Variant asset is not ready: {path}"
hashes = {path: digest(path) for path in paths}
results = {}
try:
    for style in VARIANTS:
        source = ROOT / "assets" / f"character-guide-{style}.blend"
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
        source_result = inspect_scene(style, exported=False)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        glb = ROOT / "public/Room" / f"character-guide-{style}.glb"
        bpy.ops.import_scene.gltf(filepath=str(glb))
        export_result = inspect_scene(style, exported=True)
        assert source_result["triangles"] == export_result["triangles"], f"{style}: triangle topology differs after export"
        results[style] = {"source": source_result, "exportedGLB": export_result}
        print(f"PASS {style}: source and exported geometry have the intended corner normals")
finally:
    for path, original in hashes.items():
        assert digest(path) == original, f"Read-only verification modified {path}"

assert results["smooth"]["exportedGLB"]["triangles"] > results["faceted"]["exportedGLB"]["triangles"] * 3
print(json.dumps(results, indent=2))
print("All guide variant shading checks passed; source and export files unchanged")
