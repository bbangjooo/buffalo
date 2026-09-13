"""Four quiet antique-atlas features around the larger central room pavilion.

Rebuild only the auxiliary village; the original house, courtyard exhibits,
characters, anchors and source blends are never changed by this script.
"""
from pathlib import Path
from math import cos,sin,pi,sqrt,atan2,hypot
import json,random,sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from pen_ink.village_drawing import Drawing,unlit,v,WHITE,INK,SOFT
from pen_ink import village_props

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0
layout_path=ROOT/'src/design/medieval-village-layout.json'
layout=json.loads(layout_path.read_text())
layout.setdefault('limits',{'maxLandmarks':4,'maxTriangles':50000})
courtyard=json.loads((ROOT/'src/design/courtyard-layout.json').read_text())
ground=layout['groundY'];rng=random.Random(916)
root=bpy.data.objects.new('MedievalVillage',None);bpy.context.scene.collection.objects.link(root)
root['penInkAuthored']=True;root['villageEnvironment']=True;root['style']='Four subordinate antique-atlas features: two cottages, a well and a modest market; detailed ink and open paper.'
WINDOW_MAT=unlit('PenVillageWindow',(.085,.085,.085,1))
obstacles=[];torches=[]


def empty(name,parent=root):
    o=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(o);o.parent=parent;return o

def placement(obj,x,z,yaw=0):
    obj.location=v((x,ground,z));obj.rotation_euler.z=yaw

def world_point(p,cottage):
    scale=float(cottage.get('scale',1));x,y,z=[value*scale for value in p];a=cottage['yaw']
    return (cottage['x']+cos(a)*x+sin(a)*z,ground+y,cottage['z']-sin(a)*x+cos(a)*z)

def obstacle(ident,x,z,radius):obstacles.append({'id':ident,'x':round(x,4),'z':round(z,4),'radius':round(radius,4)})

def window(d,wnd,x,y,z,width=.58,height=.68):
    # Panes remain separate from the ink batched mesh, for warm night windows.
    wnd.polygon([(x-width*.5,y-height*.5,z+.018),(x+width*.5,y-height*.5,z+.018),(x+width*.5,y+height*.5,z+.018),(x-width*.5,y+height*.5,z+.018)])
    for xx in [x-width*.5,x+width*.5]:d.box((xx,y,z+.055),(.075,height+.18,.095))
    for yy in [y-height*.5,y+height*.5]:d.box((x,yy,z+.055),(width+.12,.075,.095))
    d.beam((x-width*.46,y-height*.44,z+.061),(x+width*.46,y+height*.44,z+.061),.025)
    d.beam((x-width*.46,y+height*.44,z+.061),(x+width*.46,y-height*.44,z+.061),.025)
    # Open plank shutters project from plaster, each has braces and hinges.
    for side in [-1,1]:
        sx=x+side*(width*.5+.22)
        d.box((sx,y,z+.027),(.31,height+.08,.055))
        for n in range(1,3):d.stroke([(sx-.15+n*.1,y-height*.5,z+.061),(sx-.15+n*.1,y+height*.5,z+.061)],.009)
        d.beam((sx-.12,y-height*.3,z+.077),(sx+.12,y+height*.3,z+.077),.038)
        for hy in [-.21,.21]:d.box((sx,y+hy,z+.084),(.25,.03,.023),INK,False)


def lamp(d,parent,ident,at,cottage=None):
    x,y,z=at
    # Wall bracket, shallow iron cage and rain cap. Parent provides flames.
    d.beam((x,y-.18,z-.34),(x,y-.18,z-.02),.045,color=INK)
    d.box((x,y+.29,z),(.32,.05,.30))
    d.polygon([(x-.2,y+.315,z-.18),(x+.2,y+.315,z-.18),(x,y+.46,z)])
    d.polygon([(x+.2,y+.315,z-.18),(x+.2,y+.315,z+.18),(x,y+.46,z)])
    d.polygon([(x+.2,y+.315,z+.18),(x-.2,y+.315,z+.18),(x,y+.46,z)])
    d.polygon([(x-.2,y+.315,z+.18),(x-.2,y+.315,z-.18),(x,y+.46,z)])
    for xx in [-.135,.135]:
        for zz in [-.12,.12]:d.stroke([(x+xx,y-.16,z+zz),(x+xx,y+.26,z+zz)],.023)
    d.box((x,y-.18,z),(.31,.045,.28))
    anchor=empty('TorchAnchor_'+ident,parent);anchor.location=v((x,y+.025,z));anchor['torch']=True;anchor['penInkAuthored']=True
    absolute=world_point((x,y+.025,z),cottage) if cottage else (x,y+ground+.025,z)
    torches.append({'id':ident,'x':round(absolute[0],5),'y':round(absolute[1],5),'z':round(absolute[2],5)})


def house(c):
    ident=c['id'];w=c['width'];dep=c['depth'];eave=c['eave'];peak=c['ridge'];front=dep*.5
    group=empty('VillageCottage_'+ident);placement(group,c['x'],c['z'],c['yaw']);group['villageBlock']=True
    scale=float(c.get('scale',1));assert .5<=scale<=1.2,c
    group.scale=(scale,scale,scale);group['cottageScale']=scale
    d=Drawing();wnd=Drawing()
    d.box((0,.19,0),(w+.14,.38,dep+.14))
    d.box((0,eave*.5+.18,0),(w,eave-.36,dep))
    # Both gables and roof overhang are real paper surfaces, not edge shaders.
    for z in [-front,front]:
        d.polygon([(-w*.5,eave,z),(w*.5,eave,z),(0,peak,z)])
        d.stroke([(-w*.5,eave,z),(0,peak,z),(w*.5,eave,z)],.022)
    over=.26;rw=w*.5+over;rz=front+.27
    for side in [-1,1]:
        roof=[(side*rw,eave-.06,-rz),(side*rw,eave-.06,rz),(0,peak+.08,rz),(0,peak+.08,-rz)]
        d.polygon(roof);d.stroke(roof,.026,cyclic=True)
        rows=8;cols=13 if w>3.5 else 11
        if c['roof']=='shingle':
            # Broken overlapping rows; only seams/undersides receive ink.
            for row in range(rows):
                t=(row+.18)/rows
                xx=side*rw*(1-t);yy=eave-.06+(peak+.08-eave+.06)*t
                for col in range(cols):
                    zz=-rz+(col+(row%2)*.42)*(2*rz/cols)
                    length=2*rz/cols*.86
                    end=min(zz+length,rz)
                    if zz>rz:continue
                    d.stroke([(xx,yy+.009,zz),(xx+side*.025,yy+.012,(zz+end)*.5),(xx,yy+.009,end)],.011)
                    d.stroke([(xx,yy+.01,zz),(side*rw*(1-min(.97,t+.1)),yy+(peak-eave)*.1,zz-.025)],.008)
                    if (row+col)%5==0:
                        d.stroke([(xx-side*.04,yy+.04,zz+.05),(xx-side*.11,yy+.13,zz+.1)],.007,SOFT)
        else:
            # Uneven bundles run down the roof pitch, with sparse binding rows.
            for col in range(42):
                zz=-rz+(col+.15)*2*rz/42
                t0=.04+.13*(col%3)/3;t1=.82+.13*((col*7)%11)/11
                d.stroke([(side*rw*(1-t0),eave+(peak-eave)*t0+.004,zz),(side*rw*.48,eave+(peak-eave)*.52+.012,zz+.026*sin(col)),(side*rw*(1-t1),eave+(peak-eave)*t1+.015,zz+.016)],.009)
            for t in [.15,.46,.76]:
                d.stroke([(side*rw*(1-t),eave+(peak-eave)*t+.018,-rz),(side*rw*(1-t),eave+(peak-eave)*t+.018,rz)],.014)
    # Ridge beam and exposed rafter tails carry a confident nib silhouette.
    d.beam((0,peak+.085,-rz-.05),(0,peak+.085,rz+.05),.14)
    for zz in [-front-.12,front+.12]:
        for side in [-1,1]:d.beam((side*rw,eave-.06,zz),(0,peak+.08,zz),.10)
    for side in [-1,1]:
        for n in range(8):
            zz=-front+n*dep/7
            d.beam((side*(w*.5-.08),eave-.05,zz),(side*(rw+.035),eave-.08,zz),.075)
    # Timber framing in front/back and side walls, plaster stays mostly white.
    for zz in [-front-.026,front+.026]:
        for x in [-w*.5,0,w*.5]:d.beam((x,.38,zz),(x,eave,zz),.12)
        for y in [.4,1.05,eave-.05]:d.beam((-w*.5,y,zz),(w*.5,y,zz),.125)
        for side in [-1,1]:
            d.beam((side*w*.49,1.1,zz+.013),(side*.1,eave-.14,zz+.013),.095)
        d.beam((-w*.45,eave+.09,zz),(0,peak-.1,zz),.09)
        d.beam((w*.45,eave+.09,zz),(0,peak-.1,zz),.09)
        d.beam((0,eave,zz),(0,peak-.07,zz),.12)
    for xx in [-w*.5-.024,w*.5+.024]:
        for zz in [-front,0,front]:d.beam((xx,.38,zz),(xx,eave,zz),.12)
        for yy in [.4,1.06,eave-.05]:d.beam((xx,yy,-front),(xx,yy,front),.12)
        for side in [-1,1]:d.beam((xx,1.12,side*front*.94),(xx,eave-.1,side*.08),.09)
    # Stone footing joints as broken courses, not thousands of individual bricks.
    for side in [-1,1]:
        zz=side*(front+.079)
        for row in range(2):
            yy=.08+row*.17
            for col in range(8):
                xx=-w*.49+(col+(row%2)*.5)*w/8
                d.stroke([(xx,yy,zz),(min(xx+w*.095,w*.49),yy+.013,zz)],.011)
                d.stroke([(xx,yy,zz),(xx+.014,yy+.12,zz)],.010)
    # Front door: inset planks, forged strap hinges, iron ring handle.
    door_x=-.50;door_z=front+.094;door_w=.72;door_h=1.52
    d.box((door_x,door_h*.5+.38,door_z),(door_w,door_h,.045))
    for n in range(5):
        xx=door_x-door_w*.45+n*door_w*.18
        d.stroke([(xx,.41,door_z+.028),(xx+.012,.92,door_z+.03),(xx,1.87,door_z+.028)],.009)
    for side in [-1,1]:d.box((door_x+side*(door_w*.5+.055),1.10,door_z+.018),(.11,1.62,.09))
    d.box((door_x,1.92,door_z+.018),(.92,.13,.12))
    for hy in [.67,1.6]:
        d.box((door_x-.04,hy,door_z+.063),(.58,.048,.018),INK,False)
        for xx in [-.24,.19]:d.stroke([(door_x+xx,hy-.027,door_z+.078),(door_x+xx,hy+.027,door_z+.078)],.018)
    ring=[(door_x+.22+cos(i*pi/8)*.058,1.09+sin(i*pi/8)*.058,door_z+.088) for i in range(16)]
    d.stroke(ring,.015,cyclic=True)
    d.box((door_x,.22,front+.32),(.99,.12,.5))
    window(d,wnd,.73,1.49,front+.028,.54,.61)
    # Side window drawn on a separate helper then rotated to one side wall.
    side_d=Drawing();side_w=Drawing();window(side_d,side_w,0,1.48,0,.67,.66)
    # Bake rotations into vertices safely; no shared mesh template mutation.
    for target,source in [(d,side_d),(wnd,side_w)]:
        off=len(target.vertices)
        for xx,by,bz in source.vertices:
            # source Blender -> public; turn local front toward x=-side.
            py,pz=bz,-by
            p=(-w*.5-pz,py,xx)
            target.vertices.append(tuple(v(p)))
        target.faces.extend([tuple(i+off for i in face) for face in source.faces]);target.colors.extend(source.colors)
    # Small attic diamond and roof chimney are visible in the isometric view.
    az=front+.031;ay=eave+.48
    wnd.polygon([(-.16,ay,az),(0,ay+.21,az),(.16,ay,az),(0,ay-.21,az)])
    d.stroke([(-.19,ay,az+.01),(0,ay+.25,az+.01),(.19,ay,az+.01),(0,ay-.25,az+.01)],.035,cyclic=True)
    chimney_x=-w*.27;chimney_z=-dep*.25;chimney_h=peak+.42
    d.box((chimney_x,(eave+chimney_h)*.5,chimney_z),(.48,chimney_h-eave,.53))
    d.box((chimney_x,chimney_h+.01,chimney_z),(.65,.12,.68))
    d.box((chimney_x,chimney_h+.08,chimney_z),(.41,.015,.43),INK,False)
    for row in range(5):
        yy=chimney_h-.2-row*.2
        d.stroke([(chimney_x-.25,yy,chimney_z+.268),(chimney_x+.25,yy+.01,chimney_z+.268)],.011)
        xx=chimney_x+(.07 if row%2 else -.09)
        d.stroke([(xx,yy,chimney_z+.269),(xx,yy+.16,chimney_z+.269)],.01)
    # Sparse weathering marks occupy timber undersides and selected plaster.
    for i in range(16):
        xx=-w*.46+i*w*.056;yy=.49+(i%4)*.018
        d.stroke([(xx,yy,front+.078),(xx+.09,yy+.075,front+.078)],.008,SOFT)
    for i in range(8):
        xx=-w*.45+i*w*.12
        d.stroke([(xx,eave-.21,front+.03),(xx+.07,eave-.32,front+.03)],.008,SOFT)
    lamp(d,group,ident,(w*.40,1.66,front+.41),c)
    d.object('VillageStructure_'+ident,group)
    win=wnd.object('VillageWindow_'+ident,group);win.data.materials.clear();win.data.materials.append(WINDOW_MAT)
    # Remove the colors here: one controllable neutral daytime pane material.
    for color in list(win.data.color_attributes):win.data.color_attributes.remove(color)
    win['nightWindow']=True
    # A smaller cottage brings its eaves into walking height. Derive the new
    # circle from actual scaled vertices instead of shrinking the old circle.
    body=[p for p in d.vertices if p[2]*scale <= 1.85]
    radius=max(hypot(p[0]*scale,p[1]*scale) for p in body)+.035
    c['radius']=round(radius,4)
    c['physicalBoundsLocal']={'min':[round(min(p[0]*scale for p in d.vertices),4),round(min(p[2]*scale for p in d.vertices),4),round(min(-p[1]*scale for p in d.vertices),4)],
                             'max':[round(max(p[0]*scale for p in d.vertices),4),round(max(p[2]*scale for p in d.vertices),4),round(max(-p[1]*scale for p in d.vertices),4)]}
    obstacle('cottage-'+ident,c['x'],c['z'],radius)

for c in layout['cottages']:house(c)

for prop in layout['props']:
    group=empty('VillageProp_'+prop['id']);placement(group,prop['x'],prop['z'],prop['yaw'])
    scale=float(prop.get('scale',1));assert .5<=scale<=1.2,prop
    group.scale=(scale,scale,scale)
    group['propScale']=scale
    d=Drawing();getattr(village_props,prop['kind'])(d);d.object('VillagePropMesh_'+prop['id'],group)
    # The navigation radius must use physical scaled geometry, including low
    # canopy edges; scaling only the JSON radius misses those collision planes.
    body=[p for p in d.vertices if p[2]*scale <= 1.85]
    prop['radius']=round(max(hypot(p[0]*scale,p[1]*scale) for p in body)+.035,4)
    prop['physicalBoundsLocal']={
        'min':[round(min(p[axis]*scale for p in d.vertices),4) for axis in [0,2,1]],
        'max':[round(max(p[axis]*scale for p in d.vertices),4) for axis in [0,2,1]]}
    # Blender's Y axis is negative Three Z; provide explicit Three bounds.
    prop['physicalBoundsLocal']['min'][2]=round(min(-p[1]*scale for p in d.vertices),4)
    prop['physicalBoundsLocal']['max'][2]=round(max(-p[1]*scale for p in d.vertices),4)
    obstacle(prop['id'],prop['x'],prop['z'],prop['radius'])

# No detached village furniture, fences, roads or paving: the four features
# stand on the same open paper as the main rooms. No hidden leftovers export.
assert layout['landmarkCount']==4 and len(root.children)==4 and len(root.children)<=layout['limits']['maxLandmarks'], [child.name for child in root.children]
assert len(layout['cottages'])==2 and len(layout['props'])==2
assert sorted(p['kind'] for p in layout['props'])==['market','well'] and len(torches)==2

def segment_distance(point,a,b):
    dx,dz=b[0]-a[0],b[1]-a[1]
    length=dx*dx+dz*dz
    t=max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/length)) if length else 0
    return hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t)

# Validate navigation clearances before saving layout/collisions for runtime.
for o in obstacles:
    assert abs(o['x'])-o['radius']>6.55 or abs(o['z'])-o['radius']>6.55, ('house overlap',o)
    for q in courtyard['quadrants']:
        assert hypot(o['x']-q['spawn'][0],o['z']-q['spawn'][1])>o['radius']+.62, ('spawn',o,q['room'])
    assert abs(o['x'])-o['radius'] > layout['crossPathHalfWidth'] and abs(o['z'])-o['radius'] > layout['crossPathHalfWidth'], ('crossroad',o)
    for s in courtyard['stations']:
        front_spawn=(s['x']+sin(s['yaw'])*2.7,s['z']+cos(s['yaw'])*2.7)
        assert hypot(o['x']-front_spawn[0],o['z']-front_spawn[1])>o['radius']+.62, ('front spawn',o,s['id'])
        assert hypot(o['x']-s['x'],o['z']-s['z'])>o['radius']+2.22, ('exhibit envelope',o,s['id'])
        assert segment_distance((o['x'],o['z']),front_spawn,(s['x'],s['z']))>o['radius']+.32, ('reader sightline',o,s['id'])
layout['obstacles']=obstacles;layout['torches']=torches
layout_path.write_text(json.dumps(layout,ensure_ascii=False,indent=2)+'\n')
bpy.context.view_layer.update()
meshes=[o for o in root.children_recursive if o.type=='MESH']
tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
assert tris<layout['limits']['maxTriangles'], tris
manifest={'revision':layout['revision'],'landmarkCount':4,'cottageCount':len(layout['cottages']),'meshCount':len(meshes),'triangles':tris,'obstacleCount':len(obstacles),'torchCount':len(torches),'windowCount':sum(o.get('nightWindow',False) for o in meshes),'style':'four purposeful background features on open antique-map paper; two small cottages, well and modest scaled market; no village clutter or paving','authoringSource':'scripts/build_medieval_village.py','preserved':['central house clear area','all courtyard station anchors/assets','four spawn clearances','open cross roads','reader sightline segments'],'propScales':{p['id']:p.get('scale',1) for p in layout['props']},'cottageScales':{c['id']:c.get('scale',1) for c in layout['cottages']}}
(ROOT/'assets/medieval-village-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/Room/medieval-village.glb'),export_format='GLB',export_apply=True,export_cameras=False,export_lights=False,export_animations=False,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)

# The editable review includes the current main rooms as context only, added
# AFTER export. Functional courtyard content belongs to Explore, not this view.
scene=bpy.context.scene
for filename,label in [('pen-ink-rooms.blend','RenderOnlyExistingHouse')]:
    source_path=ROOT/'assets'/filename
    if not source_path.exists():continue
    collection=bpy.data.collections.new(label);scene.collection.children.link(collection)
    with bpy.data.libraries.load(str(source_path),link=False) as (source,target):
        target.objects=[name for name in source.objects if not name.startswith('RenderOnly') and not name.startswith('Meadow')]
    for o in target.objects:
        if o and o.type not in {'CAMERA','LIGHT'}:
            collection.objects.link(o);o.hide_render=bool(o.get('penInkSuperseded'));o.hide_set(bool(o.get('penInkSuperseded')))
            o['renderOnly']=True
# The runtime colors paper through its atlas shader. This saved review uses
# a brown parchment ground; exported geometry remains neutral and recolorable.
PARCHMENT=(.687,.521,.301,1)
paper=unlit('RenderOnlyVillagePaper',PARCHMENT)
bpy.ops.mesh.primitive_plane_add(size=220,location=v((0,ground-.008,0)))
plane=bpy.context.object;plane.name='RenderOnlyPaperGround';plane.data.materials.append(paper)
world=bpy.data.worlds.new('VillagePaperWorld');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=PARCHMENT;world.node_tree.nodes['Background'].inputs[1].default_value=1;scene.world=world
camera_data=bpy.data.cameras.new('VillageReviewCamera');camera=bpy.data.objects.new('VillageReviewCamera',camera_data);scene.collection.objects.link(camera)
camera.location=v((28,25,32));camera.rotation_euler=(v((0,1.0,1))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=31;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL';area.spaces.active.shading.use_scene_world=True;area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/medieval-village.blend'))
scene.render.filepath=str(ROOT/'assets/medieval-village-review.png')
bpy.ops.render.render(write_still=True)
print('VILLAGE_MANIFEST '+json.dumps(manifest),flush=True)
