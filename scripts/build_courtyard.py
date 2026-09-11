"""Author the freestanding low-poly exhibits for the four open meadows.

/Applications/Blender.app/Contents/MacOS/Blender --background \\
    --factory-startup --python scripts/build_courtyard.py

The runtime streams the grass, paths and planting. This asset deliberately has
no floor or perimeter: each room's meadow can continue beyond the last exhibit.
Public coordinates use Three.js axes through rooms.common.v. Each display is
authored facing local +Z, then rotated by the layout's Three.js Y-axis yaw.
"""
from pathlib import Path
from math import pi, sin, cos, atan2, hypot
import json
import random
import sys

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import rooms.common as common
from rooms.common import box, cyl, ellipsoid, rod, empty, text, mesh, v

# Every new parent is at the origin while its children are authored. Avoid a
# full dependency-graph update per primitive; these local transforms are exact.
def parent_at_origin(obj, root):
    if root:
        obj.parent = root
    return obj

common.parent = parent_at_origin

layout = json.loads((ROOT / 'src/design/courtyard-layout.json').read_text())
colors = json.loads((ROOT / 'src/design/jo-colors.json').read_text())['colors']
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

palette = {}
for token, code in colors.items():
    rgb = [int(code[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    rgb = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
    material = bpy.data.materials.new('Meadow ' + token)
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = .82
    bsdf.inputs['Metallic'].default_value = .3 if token == 'brass' else 0
    material.diffuse_color = (*rgb, 1)
    palette[token] = material

courtyard = empty('Courtyard', (0, 0, 0))
courtyard['design'] = 'Four open low-poly meadows; the grass is streamed by the runtime.'
width, height, screen_y = (layout['reader'][key] for key in ('width', 'height', 'y'))


from rooms.exhibit_geometry import FacetKit
from rooms.exhibit_stand import build_stand
from rooms.exhibit_ao import bake_station
from rooms.exhibit_culture import build as build_culture
from rooms.exhibit_support import build as build_support


def identity(shape, root, accent, station):
    kit = FacetKit(palette, root)
    if not build_culture(shape, kit, station) and not build_support(shape, kit, station):
        raise ValueError('Unsupported personal exhibit: ' + shape)


def create_station(station):
    # Helpers preserve world coordinates on parenting, so author about the origin
    # before moving/rotating the completed station as one editable hierarchy.
    root = empty('Exhibit_' + station['id'], (0, 0, 0), courtyard)
    root['stationId'] = station['id']
    root['room'] = station['room']
    root['exhibitionId'] = station['exhibitionId']
    root['entryIndex'] = station['entryIndex']
    root['objectKind'] = station['shape']
    root['footprint'] = [3.08, 1.9]
    accent = palette[station['color']]

    build_stand(root, palette, layout, station)
    anchor = empty('ScreenAnchor_' + station['id'], (0, screen_y, .015), root)
    anchor['width'] = width
    anchor['height'] = height
    anchor['normal'] = '+Z'
    previous_children = set(root.children)
    identity(station['shape'], root, accent, station)
    for child in set(root.children) - previous_children:
        child['heroArtifact'] = True
        # A rearward object can project over the screen from a high viewpoint,
        # even when its actual top is lower than the aperture. Move every
        # sculpture ahead of the screen plane; this also preserves clearance
        # while the first-person visitor jumps or the reader camera rises.
        child.location += v((0, 0, .8))
        if child.type == 'MESH':
            group = child.vertex_groups.new(name='ExhibitArtifact')
            group.add(list(range(len(child.data.vertices))), 1, 'REPLACE')
    root.location = v((station['x'], 0, station['z']))
    root.rotation_euler.z = station['yaw']
    return root


stations = []
for station in layout['stations']:
    stations.append(create_station(station))
    print('Authored ' + station['id'], flush=True)

year_markers = []
for marker in layout.get('yearMarkers', []):
    root = empty('YearMarker_' + marker['year'], (0, 0, 0), courtyard)
    root['year'] = marker['year']
    root['room'] = marker['room']
    root['collisionRadius'] = .6
    kit=FacetKit(palette,root)
    kit.cylinder('YearMarkerStone',(0,-.01,0),.48,.30,'chalk',n=8,top_radius=.39)
    kit.block('YearMarkerBook',(0,.19,0),(.76,.16,.46),'slate',cut=.07,taper=.97)
    kit.block('YearMarkerPages',(0,.30,0),(.67,.065,.40),'paper',cut=.03)
    kit.block('YearMarkerSpine',(0,.64,-.07),(.73,.61,.19),'wood',cut=.06,taper=.95)
    text('YearMarkerGlyphs', marker['year'], (0,.65,.037),.22,palette['ink'],root)
    root.location = v((marker['x'], 0, marker['z']))
    root.rotation_euler.z = marker['yaw']
    year_markers.append(root)


# Reusable Blender-authored foliage. Runtime removes this template group from
# the visible asset and instances each named mesh at streamed ground positions.
# All mesh origins are (0,0,0), the base is local y=0, and scale is in metres.
templates = empty('MeadowTemplates', (0, 0, 0), courtyard)
templates['templateOnly'] = True
points, faces = [], []
for i, (x, z, height, yaw) in enumerate([(-.12, -.06, .35, .2), (.08, -.04, .46, 1.2), (.01, .12, .30, 2.2), (-.03, .02, .39, 2.9)]):
    side = (.07 * cos(yaw), .07 * sin(yaw))
    start = len(points)
    points.extend([(x-side[0],0,z-side[1]), (x+side[0],0,z+side[1]), (x+.045*cos(yaw),height,z+.045*sin(yaw))])
    faces.append((start,start+1,start+2))
    faces.append((start+2,start+1,start))
grass = mesh('MeadowGrassClump', points, faces, palette['sage'], templates)
grass['templateOnly'] = True
flower = empty('MeadowFlower', (0, 0, 0), templates)
rod('FlowerStem', (0,0,0), (.025,.32,0), .011, palette['teal'], flower, n=6)
for i in range(5):
    yaw = i * 2*pi/5
    ellipsoid('MeadowPetal', (.025+cos(yaw)*.048,.325,sin(yaw)*.048), (.049,.015,.032), palette['paper'], flower)
ellipsoid('FlowerHeart', (.025,.345,0), (.022,.020,.022), palette['brass'], flower)
flower['templateOnly'] = True
rock = ellipsoid('MeadowRock', (0,.13,0), (.33,.22,.26), palette['chalk'], templates)
# Bake the rock's height into geometry so its origin also lies on the ground.
for vertex in rock.data.vertices:
    vertex.co += rock.location
rock.location = (0,0,0)
lowest = min(vertex.co.z for vertex in rock.data.vertices)
for vertex in rock.data.vertices:
    vertex.co.z -= lowest
rock['templateOnly'] = True

# Merge by material within each authored station. Anchors remain independent
# and the .blend stays editable as one named hierarchy per story.
bpy.context.view_layer.update()
for root in stations:
    hero_objects = [obj for obj in root.children if obj.type == 'MESH' and obj.get('heroArtifact')]
    hero_vertices = [obj.matrix_local @ point.co for obj in hero_objects for point in obj.data.vertices]
    hero_height = max(vertex.z for vertex in hero_vertices)
    assert hero_height < screen_y - height / 2 - .03, (root.name, hero_height)
    hero_front_clearance = min(-vertex.y - .015 for vertex in hero_vertices)
    assert hero_front_clearance > .20, (root.name, hero_front_clearance)
    root['artifactHeight'] = hero_height
    root['artifactFrontClearance'] = hero_front_clearance
    root['artifactPrimitiveCount'] = len(hero_objects)
    for obj in root.children:
        if obj.type == 'MESH':
            assert all((point.x * point.x + point.y * point.y) ** .5 < 2 for point in [obj.matrix_local @ vertex.co for vertex in obj.data.vertices]), root.name
for root in stations + year_markers:
    bake_station(root)
    root['styleRevision']='clear-screen forward sculpture, unlabelled plinth'
    print('Contact shading ' + root.name, flush=True)

for root in stations + year_markers + [flower]:
    buckets = {}
    for obj in list(root.children):
        if obj.type == 'MESH':
            buckets.setdefault(obj.data.materials[0].name, []).append(obj)
    for material_name, objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            for modifier in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        objects[0].name = root.name + '_' + material_name.replace(' ', '')


def finalize_templates():
    """One identity-transformed mesh per template, ready for InstancedMesh."""
    root = bpy.data.objects['MeadowFlower']
    meshes = [child for child in root.children if child.type == 'MESH']
    if meshes:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        # Preserve the authored palette as vertex colors in one material.
        colors = [material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:] for material in obj.data.materials]
        color_layer = obj.data.color_attributes.new(name='MeadowTint', type='FLOAT_COLOR', domain='CORNER')
        for polygon in obj.data.polygons:
            for loop in polygon.loop_indices:
                color_layer.data[loop].color = colors[polygon.material_index]
            polygon.material_index = 0
        obj.data.color_attributes.active_color = color_layer
        material = bpy.data.materials.new('Meadow Flower Vertex Color')
        material.use_nodes = True
        bsdf = material.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (1,1,1,1)
        bsdf.inputs['Roughness'].default_value = .9
        vertex_color = material.node_tree.nodes.new('ShaderNodeVertexColor')
        vertex_color.layer_name = 'MeadowTint'
        material.node_tree.links.new(vertex_color.outputs['Color'], bsdf.inputs['Base Color'])
        obj.data.materials.clear()
        obj.data.materials.append(material)
        bpy.context.view_layer.update()
        obj.data.transform(obj.matrix_world)
        obj.parent = bpy.data.objects['MeadowTemplates']
        obj.matrix_world = Matrix.Identity(4)
        bpy.data.objects.remove(root, do_unlink=True)
        obj.name = 'MeadowFlower'
        obj['templateOnly'] = True
    for name in ['MeadowGrassClump','MeadowFlower','MeadowRock']:
        template_obj = bpy.data.objects[name]
        lowest = min(vertex.co.z for vertex in template_obj.data.vertices)
        for vertex in template_obj.data.vertices:
            vertex.co.z -= lowest
    bpy.context.view_layer.update()
    for name in ['MeadowGrassClump','MeadowFlower','MeadowRock']:
        obj = bpy.data.objects[name]
        bounds = [(min(vertex.co[axis] for vertex in obj.data.vertices),max(vertex.co[axis] for vertex in obj.data.vertices)) for axis in range(3)]
        print('MEADOW_TEMPLATE ' + json.dumps({'name':name, 'boundsBlender':bounds}), flush=True)


finalize_templates()
flower = bpy.data.objects['MeadowFlower']

# A centered saved authoring camera shows all four approaches around the house.
# Lights and camera are intentionally omitted from the web asset.
scene = bpy.context.scene
camera_data = bpy.data.cameras.new('CourtyardCamera')
camera = bpy.data.objects.new('CourtyardCamera', camera_data)
scene.collection.objects.link(camera)
camera.location = v((46, 58, 64))
camera.rotation_euler = (v((0, 0, 10)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 91
camera_data.clip_start, camera_data.clip_end = .2, 300
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1600, 1200, 100
scene.world.color = (.7, .7, .7)
light_data = bpy.data.lights.new('MeadowStudio', 'AREA')
light_data.energy, light_data.shape, light_data.size = 24000, 'DISK', 25
light = bpy.data.objects.new('MeadowStudio', light_data)
scene.collection.objects.link(light)
light.location = v((12, 35, 18))
light.rotation_euler = (v((0, 0, 10)) - light.location).to_track_quat('-Z', 'Y').to_euler()
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.clip_start, area.spaces.active.clip_end = .2, 300
            area.spaces.active.region_3d.view_perspective = 'CAMERA'

bpy.context.view_layer.update()
for station in layout['stations']:
    root = bpy.data.objects['Exhibit_' + station['id']]
    anchor = bpy.data.objects['ScreenAnchor_' + station['id']]
    expected = root.matrix_world @ v((0, screen_y, .015))
    assert (anchor.matrix_world.translation - expected).length < 1e-5, station['id']

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/courtyard.blend'))
bpy.ops.export_scene.gltf(
    filepath=str(ROOT / 'public/Room/courtyard.glb'), export_format='GLB',
    export_apply=True, export_cameras=False, export_lights=False,
    export_animations=False, export_extras=True,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
)
meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
print(f'Meadow exported: {len(stations)} exhibit groups, {len(meshes)} meshes, {triangles} triangles; house assets untouched.')


def build_review_scene():
    """Compose a separate Blender inspection file without saving over the house."""
    print('Building complete meadow review scene.', flush=True)
    templates.hide_render = True
    templates.hide_set(True)
    for obj in templates.children_recursive:
        obj.hide_render = True
        obj.hide_set(True)
    with bpy.data.libraries.load(str(ROOT / 'assets/four-rooms.blend'), link=False) as (source, target):
        target.objects = [name for name in source.objects if not name.startswith('RenderOnly') or name == 'RenderOnlyPortrait']
    house_collection = bpy.data.collections.new('Existing four-room house')
    scene.collection.children.link(house_collection)
    for obj in target.objects:
        if obj and obj.type not in {'CAMERA', 'LIGHT'}:
            house_collection.objects.link(obj)
            obj.hide_render = False
            obj.hide_set(False)

    meadow_collection = bpy.data.collections.new('Authored meadow review landscape')
    scene.collection.children.link(meadow_collection)
    rng = random.Random(164)
    meadow_colors = {
        'Grass fern': '#A4B87D', 'Grass sunlit': '#B6C88C',
        'Grass sage': '#ACBF88', 'Grass deep': '#96AD76',
    }
    meadow_materials = []
    for name, color in meadow_colors.items():
        mat = bpy.data.materials.new(name)
        rgb = [int(color[i:i+2],16)/255 for i in (1,3,5)]
        rgb = [((c+.055)/1.055)**2.4 for c in rgb]
        mat.diffuse_color = (*rgb,1)
        mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb,1)
        mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
        meadow_materials.append(mat)
    for quadrant in layout['quadrants']:
        sign_x = 1 if quadrant['spawn'][0] > 0 else -1
        sign_z = 1 if quadrant['spawn'][1] > 0 else -1
        points, faces = [], []
        count, step, edge = 13, 5, .65
        for row in range(count+1):
            for col in range(count+1):
                points.append((sign_x*(edge+col*step), layout['groundY'] + (0 if row==0 or col==0 else rng.uniform(-.026,.026)), sign_z*(edge+row*step)))
        for row in range(count):
            for col in range(count):
                a = row*(count+1)+col
                tri = [(a,a+1,a+count+2),(a,a+count+2,a+count+1)]
                if sign_x*sign_z > 0:
                    tri = [tuple(reversed(face)) for face in tri]
                faces.extend(tri)
        ground = mesh('Meadow_' + quadrant['room'], points, faces, meadow_materials[0])
        for mat in meadow_materials[1:]:
            ground.data.materials.append(mat)
        for face in ground.data.polygons:
            face.material_index = rng.choices(range(4), weights=[3,1,5,1])[0]
        ground['room'] = quadrant['room']

    # The four room walls become a pair of open, crossing meadow paths.
    box('Meadow boundary path X', (0,layout['groundY']-.015,0), (132,.035,1.28), palette['chalk'], bevel=0)
    for sign in [-1,1]:
        box('Meadow boundary path Z', (0,layout['groundY']-.015,sign*33.32), (1.28,.035,65.36), palette['chalk'], bevel=0)

    # Deterministic linked plant/rock copies keep the review scene editable.
    for i in range(500):
        x, z = rng.uniform(-59,59), rng.uniform(-59,59)
        if abs(x)<1.35 or abs(z)<1.35 or (abs(x)<6.8 and abs(z)<6.8):
            continue
        if any((x-station['x'])**2 + (z-station['z'])**2 < 2.9**2 for station in layout['stations']):
            continue
        template = rock if i%17==0 else flower if i%8==0 else grass
        clone = template.copy()
        clone.name = 'Review_' + template.name
        clone.parent = None
        clone.hide_render = False
        clone.hide_viewport = False
        clone.location = v((x,layout['groundY'],z))
        clone.rotation_euler.z = rng.uniform(0,2*pi)
        scale = rng.uniform(.7,1.45)
        clone.scale = (scale,scale,scale)
        meadow_collection.objects.link(clone)
        clone.hide_set(False)
        for original in template.children:
            child = original.copy()
            child.parent = clone
            child.matrix_parent_inverse = original.matrix_parent_inverse.copy()
            child.hide_render = False
            child.hide_viewport = False
            meadow_collection.objects.link(child)
            child.hide_set(False)

    camera.location = v((46,64,73))
    camera.rotation_euler = (v((0,.8,11))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.ortho_scale = 91
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.70,.77,.75,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .5
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'MATERIAL'
                area.spaces.active.shading.color_type = 'MATERIAL'
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.region_3d.view_camera_zoom = 0
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/meadow-review.blend'))
    print('MEADOW_REVIEW_READY ' + str(ROOT / 'assets/meadow-review.blend'), flush=True)


build_review_scene()
