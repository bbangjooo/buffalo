"""Editable sparse antique-atlas review: brown paper Day / silver-on-black Night.

Blender --background --python scripts/prepare_atlas_review.py
Only NEW atlas-world.blend and atlas-blender-day/night.png are written.
The browser remains authoritative for HTML reading surfaces and the rhythm UI.
"""
from pathlib import Path
from math import pi, sin, cos
import bpy, json, hashlib, random
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1];ASSETS=ROOT/'assets'
SOURCES=['pen-ink-rooms.blend','medieval-village.blend','character-guide-smooth.blend','pen-ink-courtyard.blend']
source_hashes={name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in SOURCES}
layout=json.loads((ROOT/'src/design/medieval-village-layout.json').read_text())
landscape=json.loads((ROOT/'src/design/atlas-landscape.json').read_text())
assert layout['landmarkCount']==4 and len(layout['cottages'])+len(layout['props'])==4
bpy.ops.wm.open_mainfile(filepath=str(ASSETS/SOURCES[0]))
bpy.context.preferences.filepaths.save_version=0
day=bpy.context.scene;day.name='Day'


def linear(hex_color):
    channels=[int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels)


FIELD=linear('#eadcc0');PAPER=linear('#f2e6ce');INK=linear('#5c422d')
BLACK=linear('#050607');SILVER=linear('#d8d4ca');WINDOW=linear('#575650')


def top(obj):
    while obj.parent:obj=obj.parent
    return obj


def ancestor(obj,predicate):
    while obj:
        if predicate(obj):return True
        obj=obj.parent
    return False


def append(filename,label,wanted):
    with bpy.data.libraries.load(str(ASSETS/filename),link=False) as (source,target):target.objects=source.objects
    collection=bpy.data.collections.new(label);day.collection.children.link(collection)
    result=[]
    for obj in target.objects:
        if obj is None or obj.type in ['CAMERA','LIGHT']:continue
        if top(obj).name.split('.')[0] not in wanted:continue
        collection.objects.link(obj);result.append(obj)
    # Do not retain orphan copies of the old room/courtyard review context.
    # Those records remain in their original files, outside this sparse review.
    for obj in target.objects:
        if obj is not None and obj not in result:bpy.data.objects.remove(obj,do_unlink=True)
    return result


# Curated geometry only: no old Courtyard, fixed border garden or exhibits.
landmarks=append('medieval-village.blend','Four subordinate atlas features',{'MedievalVillage'})
companions=append('character-guide-smooth.blend','Original companion',{'GuideCharacter'})
guide=next(obj for obj in companions if not obj.parent)
guide.location=(6.65,-11.45,-.12);guide.scale=(2.2,2.2,2.2)
day.view_layers[0].update()
for obj in day.objects:
    hide=bool(obj.get('penInkSuperseded'))
    obj.hide_render=hide;obj.hide_set(hide)
assert not any(o.name.startswith(('Courtyard','Meadow','RenderOnly_Meadow','Exhibit_','ScreenAnchor_')) for o in day.objects)
village=next(o for o in landmarks if not o.parent)
assert len([o for o in village.children if o.name.startswith(('VillageCottage_','VillageProp_'))])==4

# Reproduce the exact authored plant placements from the runtime JSON. Load
# only the five original template meshes, copy their colours before softening,
# and remove every imported source object after the curated instances exist.
planting=bpy.data.objects.new('AtlasCuratedPlanting',None);day.collection.objects.link(planting)
planting['curated']=True;planting['revision']=landscape['revision']
before_templates=set(bpy.data.objects)
names={item['name'] for item in landscape['templates'].values()}
with bpy.data.libraries.load(str(ASSETS/'pen-ink-courtyard.blend'),link=False) as (source,target):
    target.objects=[name for name in source.objects if name in names]
loaded_template_objects=list(set(bpy.data.objects)-before_templates)
template_sources={obj.name:obj for obj in target.objects if obj}
plant_meshes={};plants=[]
for kind,definition in landscape['templates'].items():
    template=template_sources[definition['name']]
    data=template.data.copy();data.name='AtlasCurated_'+kind+'Geometry'
    for attribute in data.color_attributes:
        for item in attribute.data:
            r,g,b,a=item.color
            if max(r,g,b)<.7:
                mix=definition['inkMix'];item.color=(r+(1-r)*mix,g+(1-g)*mix,b+(1-b)*mix,a)
    plant_meshes[kind]=data
for entry in landscape['placements']:
    obj=bpy.data.objects.new('AtlasPlant_'+entry['id'],plant_meshes[entry['kind']]);day.collection.objects.link(obj)
    obj.parent=planting;obj.location=(entry['x'],-entry['z'],layout['groundY']+landscape['groundOffset'])
    obj.rotation_euler.z=entry['yaw'];obj.scale=(entry['scale'],)*3
    obj['atlasPlant']=True;obj['plantKind']=entry['kind'];obj['placementId']=entry['id'];obj['templateOnly']=False
    obj['inkMix']=landscape['templates'][entry['kind']]['inkMix'];plants.append(obj)
for obj in loaded_template_objects:bpy.data.objects.remove(obj,do_unlink=True)
planting['placementCount']=len(plants)
day.view_layers[0].update()


def flat(name,color):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*color,1)
    nodes=mat.node_tree.nodes;nodes.clear()
    rgb=nodes.new('ShaderNodeRGB');rgb.outputs[0].default_value=mat.diffuse_color
    out=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(rgb.outputs[0],out.inputs[0])
    return mat


day_paper=flat('Atlas Review Day | paper',PAPER)
day_ink=flat('Atlas Review Day | sepia ink',INK)
night_black=flat('Atlas Review Night | black paper',BLACK)
night_ink=flat('Atlas Review Night | fine silver ink',SILVER)
night_window=flat('Atlas Review Night | muted glass',WINDOW)
day_materials={};night_materials={}


def vertex_palette(original,night=False):
    cache=night_materials if night else day_materials
    if original.name in cache:return cache[original.name]
    vertex=next((n for n in original.node_tree.nodes if n.bl_idname=='ShaderNodeVertexColor'),None) if original.use_nodes else None
    if vertex is None:return None
    mat=bpy.data.materials.new(('Atlas Review Night | ' if night else 'Atlas Review Day | ')+original.name)
    mat.use_nodes=True;mat.node_tree.nodes.clear();nodes=mat.node_tree.nodes
    color=nodes.new('ShaderNodeVertexColor');color.layer_name=vertex.layer_name
    ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.04
    ramp.color_ramp.elements[0].color=(*(SILVER if night else INK),1)
    ramp.color_ramp.elements[1].position=.90;ramp.color_ramp.elements[1].color=(*(BLACK if night else PAPER),1)
    out=nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(color.outputs['Color'],ramp.inputs['Fac'])
    mat.node_tree.links.new(ramp.outputs['Color'],out.inputs[0]);cache[original.name]=mat
    return mat


def character(obj):return ancestor(obj,lambda p:p.name in ['Robot','GuideCharacter'])
def window(obj):return ancestor(obj,lambda p:bool(p.get('nightWindow')))
def ink_material(mat):return 'Ink' in mat.name and not any(token in mat.name for token in ['Paper','Village'])


# The simplified village is still neutral in its native export. Recolour only
# its review object slots; central room source already has matching overrides.
for obj in [*landmarks,*plants]:
    if obj.type!='MESH':continue
    for index,slot in enumerate(obj.material_slots):
        if slot.material is None:continue
        original=slot.material;replacement=vertex_palette(original) or (day_ink if ink_material(original) else day_paper)
        obj.material_slots[index].link='OBJECT';obj.material_slots[index].material=replacement


# Tiny paper fibre variation belongs to the field only; object surfaces stay
# clean so contours and engraved detail retain the reference's hierarchy.
grain=bpy.data.materials.new('Atlas Review Day | subtle field paper grain');grain.use_nodes=True
nodes=grain.node_tree.nodes;nodes.clear()
coords=nodes.new('ShaderNodeTexCoord');noise=nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value=135;noise.inputs['Detail'].default_value=2
ramp=nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(*(c*.97 for c in FIELD),1)
ramp.color_ramp.elements[1].color=(*(min(1,c*1.025) for c in FIELD),1)
out=nodes.new('ShaderNodeOutputMaterial')
grain.node_tree.links.new(coords.outputs['Object'],noise.inputs['Vector'])
grain.node_tree.links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
grain.node_tree.links.new(ramp.outputs['Color'],out.inputs[0])
ground=bpy.data.objects.get('RenderOnlyGround')
if ground:
    ground.location.z=-.218
    ground.data.materials.clear();ground.data.materials.append(grain)


def configure(scene,color):
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
    scene.cycles.use_denoising=True;scene.cycles.max_bounces=3
    scene.render.resolution_x=1800;scene.render.resolution_y=1450;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
    scene.world=bpy.data.worlds.new(scene.name+' atlas world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(*color,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=1


configure(day,FIELD)
camera=day.camera;camera.location=(16,-20,19)
look_at=Vector((0,0,.65));camera.rotation_euler=(look_at-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=20;camera.data.clip_end=350
day['sourceFiles']='; '.join('assets/'+name for name in SOURCES)
day['reviewScope']='Larger central room pavilion, four subordinate village features, and the exact curated atlas-landscape plant placements. No repeated meadow, paving, legacy border beds or exhibit boards.'
day['contentNote']='Native model/anchor review; the browser owns HTML records, animated instrument controls and the current rhythm interface.'
day['palette']='#eadcc0 field; #f2e6ce objects; #5c422d sepia ink'

night=bpy.data.scenes.new('Night');configure(night,BLACK)
night['palette']='#050607 black; #d8d4ca thin silver ink; tiny white flames; no coloured light pools'
night['contentNote']=day['contentNote']
collection=bpy.data.collections.new('Night — object material overrides, shared source geometry')
night.collection.children.link(collection);copies={}
for original in list(day.objects):
    if original.type=='LIGHT':continue
    duplicate=original.copy()
    if original.type=='CAMERA':duplicate.data=original.data.copy()
    collection.objects.link(duplicate);duplicate.name='Night | '+original.name;copies[original]=duplicate
    duplicate.hide_set(original.hide_get(),view_layer=night.view_layers[0])
    if original.type=='MESH' and not character(original) and not original.name.startswith('RenderOnlyPortrait'):
        for index,slot in enumerate(original.material_slots):
            if slot.material is None:continue
            replacement=vertex_palette(slot.material,True)
            if replacement is None:replacement=night_window if window(original) else night_ink if ink_material(slot.material) else night_black
            duplicate.material_slots[index].link='OBJECT';duplicate.material_slots[index].material=replacement
for original,duplicate in copies.items():
    duplicate.parent=copies.get(original.parent);duplicate.matrix_parent_inverse=original.matrix_parent_inverse.copy()
    duplicate.matrix_basis=original.matrix_basis.copy()
night.camera=copies[camera];night.view_layers[0].update()

# A neutral fill affects only the original lit characters; every atlas surface
# is unlit, so no moon-blue or orange ground/wall pools can appear.
data=bpy.data.lights.new('Original-character neutral fill','AREA')
data.energy=2200;data.color=(1,1,1);data.shape='DISK';data.size=18
lamp=bpy.data.objects.new('Original-character neutral fill',data);night.collection.objects.link(lamp)
lamp.location=(0,0,15)
fill_data=bpy.data.lights.new('Original-companion neutral front fill','AREA')
fill_data.energy=1100;fill_data.color=(1,1,1);fill_data.shape='DISK';fill_data.size=9
fill=bpy.data.objects.new('Original-companion neutral front fill',fill_data);night.collection.objects.link(fill)
fill.location=(5,-14,6)
fill.rotation_euler=(Vector((6.65,-11.45,1.2))-fill.location).to_track_quat('-Z','Y').to_euler()
white_flame=flat('Atlas Review Night | white torch flame',linear('#eeeade'))
torches=[o for o in day.objects if o.get('torch')]
for i,marker in enumerate(torches):
    points=[]
    for h,r in [(0,.033),(.045,.063),(.13,.04),(.225,.001)]:
        for k in range(8):
            a=k*pi/4;points.append((r*cos(a)+h*h*.25,r*sin(a),h))
    faces=[(j*8+k,j*8+(k+1)%8,(j+1)*8+(k+1)%8,(j+1)*8+k) for j in range(3) for k in range(8)]
    mesh=bpy.data.meshes.new('White torch flame');mesh.from_pydata(points,[],faces);mesh.materials.append(white_flame)
    obj=bpy.data.objects.new('White flame '+str(i+1),mesh);night.collection.objects.link(obj);obj.parent=copies[marker]

# Sparse tiny stars lie above the black field and outside the central house.
rng=random.Random(91643);vertices=[];faces=[];star_count=0
for i in range(370):
    x,y=rng.uniform(-22,22),rng.uniform(-22,22)
    if abs(x)<6.25 and abs(y)<6.25:continue
    radius=rng.uniform(.006,.015);offset=len(vertices)
    vertices.extend([(x-radius,y,-.160),(x,y-radius,-.160),(x+radius,y,-.160),(x,y+radius,-.160)])
    faces.append((offset,offset+1,offset+2,offset+3));star_count+=1
mesh=bpy.data.meshes.new('Sparse atlas stars');mesh.from_pydata(vertices,[],faces);mesh.materials.append(night_ink)
stars=bpy.data.objects.new('Sparse atlas stars — Night only',mesh);night.collection.objects.link(stars)
night['starCount']=star_count;night['whiteFlameCount']=len(torches)
assert not any(o.type=='LIGHT' and o.data.type=='POINT' for o in night.objects)
assert all(not slot.material or not slot.material.name.startswith('Atlas Review Night |') for o in day.objects if o.type=='MESH' for slot in o.material_slots)

for scene in [day,night]:
    scene.render.filepath=str(ASSETS/('atlas-blender-'+scene.name.lower()+'.png'))
    bpy.ops.render.render(scene=scene.name,write_still=True)
if bpy.context.window:bpy.context.window.scene=day
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type!='VIEW_3D':continue
        space=area.spaces.active;space.shading.type='MATERIAL';space.shading.use_scene_world=True;space.shading.use_scene_lights=True
        space.overlay.show_overlays=False;space.region_3d.view_perspective='CAMERA';space.region_3d.view_camera_zoom=0
        space.clip_start=.1;space.clip_end=350
for name in SOURCES:assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==source_hashes[name]
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'atlas-world.blend'))
print('ATLAS_REVIEW_READY '+json.dumps({'file':str(ASSETS/'atlas-world.blend'),'scenes':['Day','Night'],
    'landmarkCount':4,'curatedPlacements':len(plants),'landscapeRevision':landscape['revision'],
    'importedCourtyard':False,'whiteFlames':len(torches),'stars':star_count,
    'cameraOrtho':20,'sourceFilesUnchanged':True}),flush=True)
