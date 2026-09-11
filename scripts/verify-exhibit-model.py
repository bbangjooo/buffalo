#!/usr/bin/env python3
"""Verify the authored exhibit asset and its exported GLB without changing either.

Run with ordinary Python: python scripts/verify-exhibit-model.py
The script launches Blender to inspect the actual saved source, then writes a
small reproducible quality report. Draco decoding / rendered opening visibility
are intentionally left to the browser checks; this verifies source geometry,
export metadata, material contracts, and preserved interaction transforms.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/courtyard-model-quality.json'
EPS = 5e-5


def run_blender():
    executable = os.environ.get('BLENDER_BIN', '/Applications/Blender.app/Contents/MacOS/Blender')
    command = [executable, '--background', '--factory-startup', '--python-exit-code', '1',
               '--python', str(Path(__file__).resolve()), '--', '--inside-blender']
    result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    lines = result.stdout.splitlines()
    if result.returncode:
        print(result.stdout)
    else:
        for line in lines:
            if line.startswith(('PASS ', 'FAIL ', 'Report:')):
                print(line)
    return result.returncode


def inspect():
    import bpy
    from mathutils import Vector

    source = ROOT / 'assets/courtyard.blend'
    exported = ROOT / 'public/Room/courtyard.glb'
    baseline = json.loads((ROOT / 'scripts/fixtures/exhibit-closeup-baseline.json').read_text())
    layout = json.loads((ROOT / 'src/design/courtyard-layout.json').read_text())
    expected = {station['id']: station for station in layout['stations']}
    gates, failures = {}, []

    def check(name, passed, detail=''):
        gates[name] = bool(passed)
        if not passed:
            failures.append(name + (': ' + detail if detail else ''))

    def near(a, b):
        return len(a) == len(b) and max((abs(x-y) for x,y in zip(a,b)), default=0) < EPS

    def same_rotation(a, b):
        # q and -q encode the same rotation.
        return min(max(abs(x-y) for x,y in zip(a,b)),
                   max(abs(x+y) for x,y in zip(a,b))) < EPS

    blob = exported.read_bytes()
    magic, version, declared_length = struct.unpack_from('<4sII', blob)
    check('valid_glb_header', magic == b'glTF' and version == 2 and declared_length == len(blob))
    chunk_length, chunk_type = struct.unpack_from('<II', blob, 12)
    check('glb_json_chunk', chunk_type == 0x4E4F534A and 20 + chunk_length <= len(blob))
    gltf = json.loads(blob[20:20+chunk_length])
    nodes = {node.get('name'): node for node in gltf['nodes']}
    glb_stations = {name: node for name,node in nodes.items() if name and name.startswith('Exhibit_') and 'mesh' not in node}
    glb_anchors = {name: node for name,node in nodes.items() if name and name.startswith('ScreenAnchor_')}
    station_names = {'Exhibit_' + station_id for station_id in expected}
    anchor_names = {'ScreenAnchor_' + station_id for station_id in expected}
    check('thirteen_station_groups', len(expected) == 13 and set(glb_stations) == station_names)
    check('thirteen_screen_anchors', set(glb_anchors) == anchor_names)
    # The immutable fixture predates the intentional replacement of eight work
    # articles by coffee. Keep its geometry budgets and the transforms
    # for the twelve retained personal entries, without blessing other removals.
    removed_groups = {name for name in baseline['stations'] if name.startswith('Exhibit_work--')}
    removed_anchors = {name for name in baseline['anchors'] if name.startswith('ScreenAnchor_work--')}
    check('only_requested_station_replacement',
          len(removed_groups) == 8 and
          set(baseline['stations']) - station_names == removed_groups and
          station_names - set(baseline['stations']) == {'Exhibit_coffee--support'})
    check('only_requested_anchor_replacement',
          len(removed_anchors) == 8 and
          set(baseline['anchors']) - anchor_names == removed_anchors and
          anchor_names - set(baseline['anchors']) == {'ScreenAnchor_coffee--support'})
    check('no_star_exhibit', not any('star--github' in (name or '') for name in nodes))
    check('no_exported_engineering_route',not any(name and name.startswith('EngineeringRoute') for name in nodes))

    bpy.ops.wm.open_mainfile(filepath=str(source))
    bpy.context.view_layer.update()
    source_stations = {obj.name: obj for obj in bpy.data.objects if obj.name.startswith('Exhibit_') and obj.type == 'EMPTY'}
    source_anchors = {obj.name: obj for obj in bpy.data.objects if obj.name.startswith('ScreenAnchor_')}
    check('source_groups_match_export', set(source_stations) == station_names)
    check('source_anchors_match_export', set(source_anchors) == anchor_names)
    check('source_station_ids_match_layout', {obj.get('stationId') for obj in source_stations.values()} == set(expected))
    check('no_authored_engineering_route',not any(obj.name.startswith('EngineeringRoute') for obj in bpy.data.objects))
    check('fixed_reader_dimensions', near([layout['reader'][key] for key in ('width','height','y')], [2.6,1.7,2.1]))

    positions_ok = rotations_ok = anchor_transform_ok = baseline_ok = True
    aperture_ok = hero_ok = shade_ok = color_ok = projection_ok = True
    radius_max, height_max, painted_count, artifact_count = 0, 0, 0, 0
    front_clearance_min, projected_height_max = float('inf'), -float('inf')
    projection_samples = 0
    for station_id, station in expected.items():
        name, anchor_name = 'Exhibit_'+station_id, 'ScreenAnchor_'+station_id
        if name not in source_stations or anchor_name not in source_anchors or name not in glb_stations or anchor_name not in glb_anchors:
            positions_ok = anchor_transform_ok = False
            continue
        root, anchor = source_stations[name], source_anchors[anchor_name]
        node, anchor_node = glb_stations[name], glb_anchors[anchor_name]
        target = [station['x'],0,station['z']]
        translation = node.get('translation',[0,0,0])
        positions_ok &= near(translation,target) and near(root.location,[station['x'],-station['z'],0])
        positions_ok &= near(node.get('scale',[1,1,1]),[1,1,1]) and near(root.scale,[1,1,1])
        quaternion = [0,math.sin(station['yaw']/2),0,math.cos(station['yaw']/2)]
        rotations_ok &= same_rotation(node.get('rotation',[0,0,0,1]),quaternion)
        rotations_ok &= abs(math.atan2(math.sin(root.rotation_euler.z-station['yaw']),math.cos(root.rotation_euler.z-station['yaw']))) < EPS
        if name in baseline['stations']:
            baseline_ok &= near(translation,baseline['stations'][name].get('translation',[0,0,0]))
            baseline_ok &= same_rotation(node.get('rotation',[0,0,0,1]),baseline['stations'][name].get('rotation',[0,0,0,1]))
            baseline_ok &= near(anchor_node.get('translation',[0,0,0]),baseline['anchors'][anchor_name]['translation'])
        anchor_local = root.matrix_world.inverted() @ anchor.matrix_world.translation
        anchor_transform_ok &= anchor.parent == root and near(anchor_local,[0,-.015,2.1])
        anchor_transform_ok &= any(gltf['nodes'][index].get('name') == anchor_name for index in node.get('children',[]))
        anchor_transform_ok &= near(anchor_node.get('translation',[0,0,0]),[0,2.1,.015])
        anchor_transform_ok &= same_rotation(anchor_node.get('rotation',[0,0,0,1]),[0,0,0,1])
        anchor_transform_ok &= near(anchor_node.get('scale',[1,1,1]),[1,1,1])
        anchor_transform_ok &= near([anchor.get('width',0),anchor.get('height',0)],[2.6,1.7])
        anchor_transform_ok &= near([anchor_node.get('extras',{}).get('width',0),anchor_node.get('extras',{}).get('height',0)],[2.6,1.7])

        height = root.get('artifactHeight',float('inf'))
        count = root.get('artifactPrimitiveCount',0)
        hero_ok &= 0 < height <= 1.22 and count > 0
        height_max = max(height_max,height)
        artifact_count += count
        points, artifact_points = [], []
        for obj in root.children_recursive:
            if obj.type != 'MESH':
                continue
            local = root.matrix_world.inverted() @ obj.matrix_world
            points.extend(local @ vertex.co for vertex in obj.data.vertices)
            artifact_group = obj.vertex_groups.get('ExhibitArtifact')
            if artifact_group:
                artifact_points.extend(local @ vertex.co for vertex in obj.data.vertices
                    if any(group.group == artifact_group.index and group.weight > .99 for group in vertex.groups))
            if any(mat and mat.name.startswith('Sculpture ') for mat in obj.data.materials):
                painted_count += 1
                layer = obj.data.color_attributes.get('ExhibitTone')
                color_ok &= layer is not None and layer.domain == 'CORNER' and len(layer.data) == len(obj.data.loops)
                color_ok &= obj.data.color_attributes.active_color is not None and obj.data.color_attributes.active_color.name == 'ExhibitTone'
                if layer:
                    color_ok &= all(all(math.isfinite(value) and 0 <= value <= 1 for value in sample.color) for sample in layer.data)
        if not points:
            aperture_ok = False
            continue
        max_radius = max(math.hypot(point.x,point.y) for point in points)
        radius_max = max(radius_max,max_radius)
        # Inspect the actual sculpture vertices after material merging. A
        # height-only gate cannot establish perspective separation: record and
        # check the forward depth too. Project each vertex onto the display
        # plane from walking, reading and one-metre-jump eye levels.
        projection_ok &= len(artifact_points) > 0
        for point in artifact_points:
            front = -point.y
            front_clearance_min = min(front_clearance_min, front - .015)
            projection_ok &= front > .215 and point.z < 1.22
            for eye_height in (1.49, 2.1, 2.49, 2.5):
                for distance in (2, 2.5, 2.7, 5):
                    projected_height = eye_height + (point.z-eye_height) * (distance-.015) / (distance-front)
                    projected_height_max = max(projected_height_max, projected_height)
                    projection_ok &= projected_height < 1.25 - .03
                    projection_samples += 1
        # The front and rear aperture corners must exist in the actual merged
        # source meshes. This complements metadata without claiming a ray test.
        for x in [-1.3,1.3]:
            for y in [1.25,2.95]:
                for z in [.035,-.085]:
                    corner = Vector((x,-z,y))
                    aperture_ok &= any((point-corner).length < EPS for point in points)

    check('layout_positions_preserved',positions_ok)
    check('layout_yaw_preserved',rotations_ok)
    check('retained_baseline_interaction_transforms_preserved',baseline_ok)
    check('screen_anchor_transform_and_size',anchor_transform_ok)
    check('actual_aperture_corner_geometry',aperture_ok)
    check('artifact_height_clearance',hero_ok)
    check('artifact_projection_clearance_at_walk_read_and_jump_heights',projection_ok)
    # Only the year markers have authored text. Station labels and the old
    # inset nameplate are deliberately absent from the reproducible generator.
    generator = (ROOT / 'scripts/build_courtyard.py').read_text()
    stand_generator = (ROOT / 'scripts/rooms/exhibit_stand.py').read_text()
    check('no_numbered_station_text_or_nameplate',
          "text('StationLabel'" not in generator and 'InlaidNameplate' not in stand_generator)
    check('station_geometry_radius_below_two_metres',radius_max < 2)
    check('painted_source_meshes_have_active_vertex_colours',color_ok and painted_count >= 2 * len(expected))

    source_meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    smooth_faces = sum(poly.use_smooth for obj in source_meshes for poly in obj.data.polygons)
    faces = sum(len(obj.data.polygons) for obj in source_meshes)
    source_triangles = 0
    template_duplicate_triangles = 0
    template_deduplication = []
    topology_counts_ok = True
    for obj in source_meshes:
        obj.data.calc_loop_triangles()
        count = len(obj.data.loop_triangles)
        source_triangles += count
        node = nodes.get(obj.name,{})
        if 'mesh' not in node:
            topology_counts_ok = False
            continue
        primitives = gltf['meshes'][node['mesh']]['primitives']
        exported_count = sum(gltf['accessors'][p['indices']]['count']//3 for p in primitives)
        if count == exported_count:
            continue
        # Grass was authored as four triangles plus the same four triangles
        # with reversed winding. Draco removes these duplicate faces. Accept
        # only that exact, provable reduction in an explicit double-sided
        # template; do not allow arbitrary source/export count tolerances.
        groups = {}
        for triangle in obj.data.loop_triangles:
            values = tuple(triangle.vertices)
            groups.setdefault(tuple(sorted(values)),[]).append(values)
        unique_count = len(groups)
        def canonical_winding(values):
            return min(values[i:]+values[:i] for i in range(3))
        reverse_pairs = all(len(pair) == 2 and canonical_winding(pair[0]) == canonical_winding(tuple(reversed(pair[1]))) for pair in groups.values())
        double_sided = all(gltf['materials'][p['material']].get('doubleSided',False) for p in primitives)
        allowed = obj.get('templateOnly',False) and double_sided and reverse_pairs and exported_count == unique_count
        topology_counts_ok &= allowed
        if allowed:
            template_duplicate_triangles += count - unique_count
            template_deduplication.append({'mesh':obj.name,'sourceTriangles':count,
                'exportTriangles':exported_count,'duplicateFacesRemoved':count-unique_count,
                'reason':'Identical vertex triples with reversed winding in a double-sided template.'})
    check('all_authored_faces_flat_including_templates',smooth_faces == 0)
    check('no_unapplied_geometry_modifiers',not any(obj.modifiers for obj in source_meshes))
    check('no_source_curves',not any(obj.type == 'CURVE' for obj in bpy.data.objects))

    material_stats = []
    for mat in bpy.data.materials:
        if not mat.name.startswith('Sculpture '):
            continue
        bsdf = next((node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'),None)
        expected_roughness = .62 if 'satin metal' in mat.name else .9
        expected_metallic = .12 if 'satin metal' in mat.name else 0
        valid = bsdf is not None
        if bsdf:
            base = bsdf.inputs['Base Color']
            valid &= near(base.default_value,[1,1,1,1])
            valid &= abs(bsdf.inputs['Roughness'].default_value-expected_roughness) < EPS
            valid &= abs(bsdf.inputs['Metallic'].default_value-expected_metallic) < EPS
            valid &= any(link.from_node.type == 'VERTEX_COLOR' and link.from_node.layer_name == 'ExhibitTone' for link in base.links)
            material_stats.append({'name':mat.name,'roughness':round(bsdf.inputs['Roughness'].default_value,2),
                                   'metallic':round(bsdf.inputs['Metallic'].default_value,2),'whiteVertexColourFactor':near(base.default_value,[1,1,1,1])})
        shade_ok &= valid
    check('source_matte_and_satin_material_contract',shade_ok and len(material_stats) == 2)

    triangles = 0
    primitive_count = 0
    glb_painted = 0
    export_colour_ok = export_shader_ok = True
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            primitive_count += 1
            triangles += gltf['accessors'][primitive['indices']]['count']//3
            check_name = primitive.get('mode',4) == 4
            export_colour_ok &= check_name
            mat = gltf['materials'][primitive['material']]
            if mat['name'].startswith('Sculpture '):
                glb_painted += 1
                export_colour_ok &= 'COLOR_0' in primitive['attributes']
                export_colour_ok &= 'KHR_draco_mesh_compression' in primitive.get('extensions',{})
                pbr = mat.get('pbrMetallicRoughness',{})
                export_shader_ok &= near(pbr.get('baseColorFactor',[1,1,1,1]),[1,1,1,1])
                export_shader_ok &= abs(pbr.get('roughnessFactor',1)-(.62 if 'satin metal' in mat['name'] else .9)) < EPS
    check('exported_painted_primitives_preserve_colour_and_draco',export_colour_ok and glb_painted >= painted_count)
    check('exported_materials_preserve_white_factor_and_roughness',export_shader_ok)
    check('source_and_export_topology_counts_reconcile',topology_counts_ok and source_triangles-template_duplicate_triangles == triangles)
    check('fewer_triangles_than_baseline',triangles < baseline['triangles'])
    check('fewer_meshes_than_baseline',len(gltf['meshes']) < baseline['meshCount'])
    check('smaller_glb_than_baseline',len(blob) < baseline['bytes'])

    report = {
        'status':'PASS' if not failures else 'FAIL',
        'method':'Saved Blender source inspection plus GLB JSON/accessor metadata; actual tagged sculpture vertices projected to the screen plane from walking, reading and jumping eye levels. No Draco decoding or rendered ray-visibility claim.',
        'source':str(source.relative_to(ROOT)),
        'export':str(exported.relative_to(ROOT)),
        'sha256':hashlib.sha256(blob).hexdigest(),
        'stationGroups':len(glb_stations),'screenAnchors':len(glb_anchors),
        'reader':{'width':2.6,'height':1.7,'centerY':2.1,'localZ':.015},
        'bytes':len(blob),'meshes':len(gltf['meshes']),'primitives':primitive_count,
        'triangles':triangles,'sourceTriangles':source_triangles,'sourceMeshes':len(source_meshes),
        'templateTriangleDeduplication':template_deduplication,
        'sourceFaces':faces,'flatFaces':faces-smooth_faces,'smoothFaces':smooth_faces,
        'paintedSourceMeshes':painted_count,'paintedExportPrimitives':glb_painted,
        'sourceArtifactPrimitives':artifact_count,'maxArtifactHeight':round(height_max,6),
        'minArtifactForwardClearance':round(front_clearance_min,6),
        'maxProjectedArtifactHeight':round(projected_height_max,6),
        'artifactProjectionSamples':projection_samples,
        'maxStationRadius':round(radius_max,6),'materials':material_stats,
        'baseline':{'bytes':baseline['bytes'],'meshes':baseline['meshCount'],'triangles':baseline['triangles']},
        'reductionsPercent':{'bytes':round((1-len(blob)/baseline['bytes'])*100,2),
                             'meshes':round((1-len(gltf['meshes'])/baseline['meshCount'])*100,2),
                             'triangles':round((1-triangles/baseline['triangles'])*100,2)},
        'qualityGates':gates,'failures':failures,
    }
    REPORT.write_text(json.dumps(report,indent=2)+'\n')
    if failures:
        for failure in failures:
            print('FAIL ' + failure)
        return 1
    print(f'PASS {len(expected)} exhibit groups and anchors preserve layout, retained baseline transforms, and 2.6 × 1.7m reader openings.')
    print(f'PASS {faces:,} flat source faces; {painted_count} painted meshes retain vertex colours and matte/satin materials.')
    print(f'PASS {triangles:,} triangles / {len(gltf["meshes"])} meshes / {len(blob):,} bytes; below all baseline budgets.')
    print(f'PASS artifact height ≤ {height_max:.3f}m; station radius ≤ {radius_max:.3f}m.')
    print(f'PASS {projection_samples:,} sculpture projections clear the screen; minimum forward gap {front_clearance_min:.3f}m; no station labels or nameplates.')
    print('Report: ' + str(REPORT))
    return 0


if __name__ == '__main__':
    sys.exit(inspect() if '--inside-blender' in sys.argv else run_blender())
