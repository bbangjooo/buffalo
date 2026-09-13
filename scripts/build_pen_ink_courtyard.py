"""Author an exportable pen-and-ink garden from the existing courtyard.

The strokes are geometry, not Blender-only Freestyle effects. A single unlit
vertex-color material keeps each pooled botanical template to one draw call.
Run: Blender --background --python scripts/build_pen_ink_courtyard.py
"""
from pathlib import Path
from math import sin, cos, pi, sqrt
from collections import defaultdict
import json
import random

import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/courtyard.blend'))
bpy.context.preferences.filepaths.save_version = 0
LAYOUT = json.loads((ROOT / 'src/design/courtyard-layout.json').read_text())
RNG = random.Random(2419)
WHITE = (1, 1, 1, 1)
INK = (.009, .009, .009, 1)
SOFT = (.040, .040, .040, 1)


def v(p):
    return Vector((p[0], -p[2], p[1]))


def material(name, color=None, vertex=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    if vertex:
        pigment = nodes.new('ShaderNodeVertexColor')
        pigment.layer_name = 'PenInkTint'
    else:
        pigment = nodes.new('ShaderNodeRGB')
        pigment.outputs['Color'].default_value = color or WHITE
    # An RGBA socket directly on Surface is Blender's glTF unlit convention.
    mat.node_tree.links.new(pigment.outputs['Color'], output.inputs['Surface'])
    mat.diffuse_color = color or WHITE
    mat['penInkAuthored'] = True
    return mat


PAPER_MAT = material('PenPaper', WHITE)
INK_MAT = material('PenInk', INK)
VERTEX_MAT = material('PenPaperBotanicalVertex', vertex=True)


class Drawing:
    def __init__(self):
        self.vertices, self.faces, self.colors = [], [], []

    def polygon(self, points, color=WHITE):
        offset = len(self.vertices)
        self.vertices.extend([tuple(v(p)) for p in points])
        self.faces.append(tuple(range(offset, offset + len(points))))
        self.colors.append(color)

    def stroke(self, points, width=.012, color=INK, cyclic=False, sides=3):
        width *= 1.75
        pts = [Vector(p) for p in points]
        if cyclic:
            pts.append(pts[0])
        for i in range(len(pts) - 1):
            a, b = pts[i:i+2]
            delta = b-a
            if delta.length < .00001:
                continue
            side = delta.normalized().cross(Vector((0, 0, 1)))
            if side.length < .05:
                side = delta.normalized().cross(Vector((0, 1, 0)))
            side.normalize()
            other = delta.normalized().cross(side).normalized()
            offset = len(self.vertices)
            # Width varies slightly along a pen mark, as a real nib does.
            for center, scale in [(a, 1), (b, .88)]:
                for n in range(sides):
                    p = center + (side*cos(n*2*pi/sides)+other*sin(n*2*pi/sides))*width*scale*.5
                    self.vertices.append(tuple(v(p)))
            for n in range(sides):
                self.faces.append((offset+n,offset+(n+1)%sides,offset+sides+(n+1)%sides,offset+sides+n))
                self.colors.append(color)

    def leaf(self, a, b, width=.11, plane=(0,0,1), hatch=True):
        a,b=Vector(a),Vector(b)
        d=b-a
        side=d.cross(Vector(plane)).normalized()
        points=[]
        steps=5 if hatch else 4
        for i in range(steps):
            t=i/(steps-1)
            points.append(a+d*t+side*sin(pi*t)*width)
        for i in range(steps-2,-1,-1):
            t=i/(steps-1)
            points.append(a+d*t-side*sin(pi*t)*width*.87)
        self.polygon(points)
        self.stroke(points,.011,cyclic=True)
        self.stroke([a,b],.009)
        if hatch:
            for i in range(3,7):
                t=i/8
                mid=a+d*t
                self.stroke([mid-d*.11,mid+side*sin(pi*t)*width*.91],.0065,SOFT)

    def object(self,name,parent=None,stroke=False):
        mesh=bpy.data.meshes.new(name+'Geometry')
        mesh.from_pydata(self.vertices,[],self.faces)
        mesh.update()
        layer=mesh.color_attributes.new(name='PenInkTint',type='FLOAT_COLOR',domain='CORNER')
        for face,color in zip(mesh.polygons,self.colors):
            for idx in face.loop_indices:
                layer.data[idx].color=color
        mesh.color_attributes.active_color=layer
        mesh.materials.append(VERTEX_MAT)
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent=parent
        obj['penInkAuthored']=True
        if stroke:
            obj['penInkStroke']=True
        return obj


# Preserve station shape, screen transforms, IDs and collision metadata. Turn
# existing AO colors into paper; explicit geometry describes seams and edges.
for obj in list(bpy.data.objects):
    if obj.type != 'MESH' or obj.name.startswith('Meadow'):
        continue
    for layer in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(layer)
    obj.data.materials.clear()
    obj.data.materials.append(INK_MAT if 'Glyphs' in obj.name else PAPER_MAT)
    obj['penInkAuthored'] = True
    obj['penInkStyle'] = 'white paper forms with selective black ink strokes'
    for face in obj.data.polygons:
        face.material_index = 0
    # Only sharp structural seams are inked. Avoid all-over triangulation.
    mesh=obj.data
    incident=defaultdict(list)
    for face in mesh.polygons:
        indices=list(face.vertices)
        for a,b in zip(indices,indices[1:]+indices[:1]):
            incident[tuple(sorted((a,b)))].append(face)
    drawing=Drawing()
    for (a,b), faces in incident.items():
        boundary=len(faces)==1 or any(faces[0].normal.dot(f.normal)<.79 for f in faces[1:])
        if not boundary:
            continue
        va,vb=mesh.vertices[a].co,mesh.vertices[b].co
        if (vb-va).length < .025:
            continue
        # Drawing public coordinates are x/y/z; source geometry is Blender.
        aa=Vector((va.x,va.z,-va.y));bb=Vector((vb.x,vb.z,-vb.y))
        drawing.stroke([aa,(aa+bb)*.5,bb],.012)
    # Hatching only on shadow-facing faces. Thin scattered marks leave paper.
    for idx,face in enumerate(mesh.polygons):
        if len(face.vertices)<3 or face.area<.018 or face.normal.z>.32 or idx%3:
            continue
        pts=[Vector((mesh.vertices[i].co.x,mesh.vertices[i].co.z,-mesh.vertices[i].co.y)) for i in face.vertices]
        a,b,c=pts[:3]
        n=Vector((face.normal.x,face.normal.z,-face.normal.y))*.003
        for t in [.23,.41,.59,.77]:
            p=a*(1-t)+b*t+n
            q=a*(1-t)+c*t+n
            if (q-p).length>.025:
                drawing.stroke([p,q],.0042,SOFT)
    ink=drawing.object('PenInk_'+obj.name,obj.parent,True)
    ink.matrix_local=obj.matrix_local.copy()

# Replace the three coarse templates with botanical nib drawings.
parent=bpy.data.objects.get('MeadowTemplates')
for obj in list(parent.children_recursive):
    bpy.data.objects.remove(obj,do_unlink=True)


def grass_template():
    d=Drawing()
    for i in range(13):
        yaw=i*2.399
        root=Vector((cos(yaw)*.12,0,sin(yaw)*.12))
        height=.18+.25*((i*7)%13)/13
        tip=root+Vector((cos(yaw)*(.07+.12*(i%3)),height,sin(yaw)*.14))
        d.stroke([root,root+(tip-root)*.48+Vector((0,.045,0)),tip],.01)
        if i%3==0:
            d.stroke([root,tip+Vector((.022,-.022,.02))],.0055,SOFT)
    for i in range(4):
        d.stroke([(-.23+i*.12,.003,-.09),(-.15+i*.12,.004,-.03)],.007)
    return d


def flower_template():
    d=Drawing()
    for i in range(2):
        x,z=(i-.5)*.18,sin(i*4)*.12
        h=.42+i*.105
        top=Vector((x+.04,h,z))
        d.stroke([(x,0,z),(x-.015,h*.55,z+.025),top],.012)
        d.leaf((x,h*.38,z),(x+.2,h*.62,z+.035),.05)
        d.leaf((x,h*.57,z),(x-.15,h*.77,z-.055),.042,plane=(1,0,0))
        for n in range(7):
            yaw=n*2*pi/7
            end=top+Vector((cos(yaw)*.102,.019,sin(yaw)*.102))
            d.leaf(top,end,.033,plane=(0,1,0),hatch=False)
        d.stroke([top-Vector((.015,0,0)),top+Vector((.015,.017,0))],.035)
    return d


def rock_template():
    d=Drawing()
    ring=[(.34*cos(i*2*pi/9),.035+.018*sin(i*3),.25*sin(i*2*pi/9)) for i in range(9)]
    top=[(.23*cos(i*2*pi/9),.22+.045*sin(i*2),.17*sin(i*2*pi/9)) for i in range(9)]
    for i in range(9):
        j=(i+1)%9
        d.polygon([ring[i],ring[j],top[j],top[i]])
    d.polygon(top)
    d.stroke(ring,.011,cyclic=True)
    d.stroke(top,.01,cyclic=True)
    for i in [1,4,7]:d.stroke([ring[i],top[i]],.008)
    for i in range(6):
        x=-.16+i*.051
        d.stroke([(x,.025,.23),(x+.06,.16,.17)],.0065,SOFT)
    return d


def shrub_template():
    d=Drawing()
    for branch in range(5):
        yaw=branch*2.399
        end=Vector((cos(yaw)*.46,.52+.18*(branch%3),sin(yaw)*.46))
        d.stroke([(0,0,0),end*.52+Vector((0,.06,0)),end],.018)
        for i in range(2,5):
            stem=end*(i/6)
            spread=Vector((cos(yaw+1.1)*.22,.11,sin(yaw+1.1)*.22))
            d.leaf(stem,stem+spread,.075,plane=(cos(yaw),0,sin(yaw)))
            if i%2==0:d.leaf(stem,stem-spread+Vector((0,.23,0)),.065,plane=(cos(yaw),0,sin(yaw)))
    return d


def tree_template():
    d=Drawing()
    # Irregular white trunk, contour and bark strokes; ample visible white.
    left=[(-.16,0,.03),(-.12,.75,-.01),(-.19,1.32,-.02),(-.05,2.2,0)]
    right=[(.17,0,.03),(.11,.78,.025),(.13,1.35,.01),(.04,2.2,0)]
    d.polygon(left+list(reversed(right)))
    d.stroke(left,.026);d.stroke(right,.023)
    for i in range(8):
        h=.06+i*.17
        d.stroke([(-.13,h,.046),(.05,h+.2,.045)],.010)
    for angle in [0,2.1,4.2]:
        tip=Vector((cos(angle)*.91,2.28+sin(angle)*.16,sin(angle)*.81))
        joint=Vector((0,1.25,0))
        d.stroke([joint,(joint+tip)*.5+Vector((0,.13,0)),tip],.075)
    # Five canopy clusters, each with curved scallops on three intersecting
    # paper planes. This retains a drawn silhouette around a 3D trunk.
    for c,(cx,cy,cz,r) in enumerate([(-.72,2.23,.1,.72),(.65,2.4,.08,.81),(.03,2.95,0,.74),(0,2.19,-.63,.71),(.1,2.16,.65,.64)]):
        for plane in range(2):
            angle=plane*pi/2+c*.48
            side=Vector((cos(angle),0,sin(angle)))
            front=Vector((-sin(angle),0,cos(angle)))
            center=Vector((cx,cy,cz))+front*.012
            points=[]
            for n in range(40):
                a=n*2*pi/40
                rr=r*(1+.095*sin(n*2.1+c)+.055*sin(n*4.3))
                points.append(center+side*cos(a)*rr+Vector((0,sin(a)*rr*.62,0)))
            d.polygon(points)
            d.stroke(points,.015,cyclic=True)
            # Bottom-third diagonal hatch; upper leaf mass stays paper white.
            for n in range(8):
                xx=(-.65+n*.18)*r
                yy=-.31*r+.07*sin(n*3)
                a=center+side*xx+Vector((0,yy,0))+front*.008
                b=a+side*.22*r+Vector((0,.2*r,0))
                d.stroke([a,b],.009,SOFT)
            for n in range(4):
                a=center+side*((n-1.5)*r*.32)+Vector((0,.14*sin(n*3),0))+front*.01
                d.stroke([a,a+side*.06+Vector((0,.05,0)),a+side*.12],.0075)
    return d


sources={}
for name,builder in [('MeadowGrassClump',grass_template),('MeadowFlower',flower_template),('MeadowRock',rock_template),('MeadowInkShrub',shrub_template),('MeadowInkTree',tree_template)]:
    obj=builder().object(name,parent)
    obj['templateOnly']=True
    sources[name]=obj

# Small botanical beds frame the house corners while leaving all four room
# approaches and station reading envelopes open. They are geometry instances.
garden=bpy.data.objects.new('PenInkGarden',None)
bpy.context.scene.collection.objects.link(garden)
garden.parent=bpy.data.objects['Courtyard']
garden['penInkAuthored']=True

def clear(x,z,margin=2.9):
    return abs(x)>.85 and abs(z)>.85 and (abs(x)>6.35 or abs(z)>6.35) and all((x-s['x'])**2+(z-s['z'])**2>margin**2 for s in LAYOUT['stations']) and all((x-o['x'])**2+(z-o['z'])**2>1.1**2 for o in LAYOUT['obstacles']) and all((x-q['spawn'][0])**2+(z-q['spawn'][1])**2>.9**2 for q in LAYOUT['quadrants'])

def clone(source,name,x,z,scale,parent=garden,angle=None):
    obj=source.copy();obj.name=name
    obj.data=source.data
    bpy.context.scene.collection.objects.link(obj)
    obj.parent=parent
    obj.location=v((x,LAYOUT['groundY'],z))
    obj.rotation_euler.z=angle if angle is not None else RNG.uniform(0,2*pi)
    obj.scale=(scale,)*3
    obj['templateOnly']=False
    return obj

for corner,(x,z) in enumerate([(-7.0,-6.6),(-6.7,7.5),(6.8,7.4),(7.1,-6.9)]):
    for n in range(16):
        a=n*2.399
        radius=.27+sqrt(n/16)*1.25
        px,pz=x+cos(a)*radius,z+sin(a)*radius
        if not clear(px,pz,2.75):continue
        name='MeadowInkShrub' if n%6==0 else 'MeadowFlower' if n%3==0 else 'MeadowGrassClump'
        clone(sources[name],f'PenInkBorder_{corner}_{n}',px,pz,.85+RNG.random()*.35)

# Compact engraved low garden stones near beds add drawing density without
# high solids that could sit between the visitor and an exhibit reader.
for x,z in [(-7.3,5.5),(5.8,7.3),(-5.8,-7.2),(7.1,-5.7)]:
    if clear(x,z):clone(sources['MeadowRock'],'PenInkGardenStone',x,z,1.0)

# Merge the fixed beds into one vertex-colored mesh. The runtime field stays
# instanced separately; this garden frame costs only one additional draw call.
bpy.context.view_layer.update()
bed_objects=[obj for obj in garden.children if obj.type=='MESH']
if bed_objects:
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bed_objects:
        obj.data=obj.data.copy()  # Joining must not mutate linked source templates.
        obj.select_set(True)
    bpy.context.view_layer.objects.active=bed_objects[0]
    bpy.ops.object.join()
    bed=bpy.context.object
    bed.name='PenInkGardenPlanting'
    bed['penInkAuthored']=True
    bed['templateOnly']=False

# Export the runtime asset before adding only-for-Blender landscape instances.
bpy.context.view_layer.update()
for station in LAYOUT['stations']:
    anchor=bpy.data.objects['ScreenAnchor_'+station['id']]
    root=bpy.data.objects['Exhibit_'+station['id']]
    assert (anchor.matrix_world.translation-root.matrix_world@v((0,LAYOUT['reader']['y'],.015))).length < .0001

for name,obj in sources.items():
    assert len(obj.data.vertices) < 5000, (name, 'Unexpected template geometry growth')
    # A merged/static placement accidentally baked into a shared template would
    # replicate a whole garden thousands of times in the streamed meadow.
    bounds=[(min(point.co[axis] for point in obj.data.vertices),max(point.co[axis] for point in obj.data.vertices)) for axis in range(3)]
    max_height=3.6 if name=='MeadowInkTree' else 1.0
    max_width=3.1 if name=='MeadowInkTree' else 1.0
    assert -.025 < bounds[2][0] < .04 and bounds[2][1] < max_height, (name,bounds)
    assert bounds[0][1]-bounds[0][0] < max_width and bounds[1][1]-bounds[1][0] < max_width, (name,bounds)
    assert obj.location.length < .00001 and all(abs(value-1)<.00001 for value in obj.scale), name

bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/Room/pen-ink-courtyard.glb'),export_format='GLB',export_apply=True,export_cameras=False,export_lights=False,export_animations=False,export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)

# Saved authoring review: linked pooled plants, white ground and a close camera.
review=bpy.data.objects.new('RenderOnlyPenInkMeadowPreview',None)
bpy.context.scene.collection.objects.link(review)
review['renderOnly']=True
for obj in parent.children:
    obj.hide_render=True
    obj.hide_set(True)
for n in range(730):
    x,z=RNG.uniform(-37,37),RNG.uniform(-37,37)
    if not clear(x,z):continue
    name='MeadowInkTree' if n%31==0 and max(abs(x),abs(z))>13 else 'MeadowInkShrub' if n%9==0 else 'MeadowFlower' if n%4==0 else 'MeadowGrassClump'
    obj=clone(sources[name],'RenderOnly_'+name,x,z,.65+RNG.random()*.6,parent=review)
    obj.hide_render=False;obj.hide_set(False)
bpy.ops.mesh.primitive_plane_add(size=400,location=v((0,LAYOUT['groundY']-.004,0)))
ground=bpy.context.object;ground.name='RenderOnlyPaperGround';ground.data.materials.append(PAPER_MAT);ground.parent=review
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=WHITE
scene.world.node_tree.nodes['Background'].inputs[1].default_value=1
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=0
scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
camera=scene.camera
camera.location=v((20,13,25))
camera.rotation_euler=(v((1,1,1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=37
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.shading.use_scene_world=True
            area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/pen-ink-courtyard.blend'))
for name,obj in sources.items():
    assert len(obj.data.vertices) < 5000, (name, 'Unexpected template geometry growth')
    print('PEN_TEMPLATE',name,len(obj.data.vertices),sum(len(f.vertices)-2 for f in obj.data.polygons))
print('Pen-and-ink courtyard saved and exported.',flush=True)
