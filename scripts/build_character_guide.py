"""Author a small plush-inspired personal guide, independently of the house.

/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python scripts/build_character_guide.py

The reference photos are visual references only: no photograph is loaded,
packed, copied or exported. All colour and facial details are real geometry.
Public coordinates are Three.js X/Y/Z; the character faces +Z and stands at Y=0.
"""
from pathlib import Path
from math import sin, cos, pi, sqrt
import json
import sys
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def v(p): return Vector((p[0], -p[2], p[1]))
def parent(obj, target):
    bpy.context.view_layer.update()
    matrix = obj.matrix_world.copy()
    obj.parent = target
    obj.matrix_world = matrix
    return obj

def empty(name, p=(0,0,0), target=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = v(p)
    obj.empty_display_size = .045
    if target: parent(obj,target)
    return obj

def material(name, code, roughness=.92):
    rgb = [int(code[i:i+2],16)/255 for i in (1,3,5)]
    rgb = [c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb,1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb,1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = .14
    return mat

CREAM=material('Plush warm cream','#F6E8B8')
WHITE=material('Plush ivory face and belly','#FFFEF2')
RED=material('Plush strawberry ears paws feet','#AE352D')
BLUSH=material('Plush peach cheeks','#EFA684')
INK=material('Plush dark embroidered eyes','#080D12',.92)
ROSE=material('Plush rose embroidery','#CE7068')
PINK=material('Plush smiling pink mouth','#F4AC95')
NOSE=material('Plush coral nose','#BC5C56')

root=empty('GuideCharacter')
root['assetRole']='trial personal guide'
root['facing']='+Z'
root['footOrigin']=0
root['referencePolicy']='Geometry-only interpretation; no reference photographs embedded.'
head=empty('GuideHead',(0,.985,0),root)
arm=empty('GuideArm',(-.315,.605,.275),root)
arm_left=empty('GuideArmLeft',(.315,.605,.275),root)
foot_left=empty('GuideFootLeft',(.245,.085,.085),root)
foot_right=empty('GuideFootRight',(-.245,.085,.085),root)
anchor=empty('GuideAnchor',(0,1.62,0),root)


def mesh(name, points, faces, mat, target=root, closed=False):
    data=bpy.data.meshes.new(name+'Geometry')
    data.from_pydata([v(p) for p in points],[],faces)
    data.update()
    if closed:
        bm=bmesh.new();bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
        bm.to_mesh(data);bm.free()
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for poly in data.polygons: poly.use_smooth=False
    parent(obj,target)
    return obj


def oval(name, center, radii, mat, target=root, segments=16, rings=8, tilt=0):
    points=[]
    for j in range(1,rings):
        latitude=-pi/2+pi*j/rings
        for i in range(segments):
            longitude=2*pi*i/segments
            x=radii[0]*cos(latitude)*cos(longitude)
            y=radii[1]*sin(latitude)
            z=radii[2]*cos(latitude)*sin(longitude)
            points.append((center[0]+x*cos(tilt)-y*sin(tilt),center[1]+x*sin(tilt)+y*cos(tilt),center[2]+z))
    bottom=len(points);points.append((center[0]+radii[1]*sin(tilt),center[1]-radii[1]*cos(tilt),center[2]))
    top=len(points);points.append((center[0]-radii[1]*sin(tilt),center[1]+radii[1]*cos(tilt),center[2]))
    faces=[]
    for j in range(rings-2):
        for i in range(segments):
            n=(i+1)%segments;a=j*segments+i;b=j*segments+n
            faces.append((a,b,b+segments,a+segments))
    for i in range(segments):
        n=(i+1)%segments
        faces.append((bottom,n,i));faces.append((top,(rings-2)*segments+i,(rings-2)*segments+n))
    return mesh(name,points,faces,mat,target,closed=True)

# Deliberately cheek-heavy contours: the widest cross-section sits well below
# the eyes and the crown narrows smoothly, unlike a scaled generic sphere.
HEAD=[(.615,.025,.035),(.65,.25,.145),(.72,.425,.23),(.83,.548,.29),
      (.94,.582,.315),(1.055,.555,.31),(1.16,.49,.285),(1.26,.408,.248),
      (1.345,.307,.19),(1.40,.175,.115),(1.43,.014,.014)]
BODY=[(.08,.04,.04),(.105,.265,.19),(.16,.35,.245),(.27,.411,.282),
      (.42,.423,.29),(.56,.389,.257),(.68,.325,.221),(.765,.215,.163),(.80,.045,.05)]
# Front/back fullness is authored per cross-section, independent of the face
# layout. The body is nearly as deep as it is wide, with a broad soft rump.
HEAD=[(y,w,d*1.42) for y,w,d in HEAD]
BODY=[(y,w*1.025,d*1.55) for y,w,d in BODY]
SURFACES={}

def section(profile,y):
    for i in range(len(profile)-1):
        p,q=profile[i],profile[i+1]
        if p[0]<=y<=q[0]:
            t=(y-p[0])/(q[0]-p[0])
            values=[]
            for axis in (1,2):
                # Monotone smooth Hermite slopes retain the intentional cheek
                # bulge without ring steps or overshooting the crown.
                prev=profile[max(0,i-1)];nxt=profile[min(len(profile)-1,i+2)]
                slope=(q[axis]-p[axis])/(q[0]-p[0])
                m0=(q[axis]-prev[axis])/(q[0]-prev[0])
                m1=(nxt[axis]-p[axis])/(nxt[0]-p[0])
                if slope==0:m0=m1=0
                else:
                    m0=max(0,min(3,m0/slope))*slope
                    m1=max(0,min(3,m1/slope))*slope
                span=q[0]-p[0]
                values.append((2*t**3-3*t*t+1)*p[axis]+(t**3-2*t*t+t)*span*m0+(-2*t**3+3*t*t)*q[axis]+(t**3-t*t)*span*m1)
            return values
    return profile[0][1:] if y<profile[0][0] else profile[-1][1:]

def contour(name,profile,mat,target,segments=20,levels=15):
    points=[];faces=[]
    for j in range(levels):
        y=profile[0][0]+(profile[-1][0]-profile[0][0])*j/(levels-1)
        w,d=section(profile,y)
        for i in range(segments):
            theta=2*pi*i/segments
            points.append((w*cos(theta),y,d*sin(theta)))
    for j in range(levels-1):
        for i in range(segments):
            n=(i+1)%segments;a=j*segments+i;b=j*segments+n
            faces.append((a,b,b+segments,a+segments))
    faces.extend([tuple(reversed(range(segments))),tuple((levels-1)*segments+i for i in range(segments))])
    obj=mesh(name,points,faces,mat,target,closed=True)
    obj.data.calc_loop_triangles()
    triangles=[tuple(tri.vertices) for tri in obj.data.loop_triangles]
    front=[]
    for tri in triangles:
        a,b,c=[Vector(points[i]) for i in tri]
        if (b-a).cross(c-a).z > 1e-9:front.append((a,b,c))
    SURFACES[id(profile)]={'triangles':front,'bvh':BVHTree.FromPolygons(points,triangles,all_triangles=True)}
    return obj

def surface(profile,x,y):
    point,_,_,_=SURFACES[id(profile)]['bvh'].ray_cast(Vector((x,y,5)),Vector((0,0,-1)),10)
    if point is None:raise ValueError(f'Patch outside authored skin: {x}, {y}')
    return point.z

contour('MochiCheekHead',HEAD,CREAM,head)
contour('PlumpCreamBody',BODY,CREAM,root,segments=20,levels=14)
# Raised, short rounded ears. The tips turn outward like the reference plush.
for sign in (-1,1):
    oval('StrawberryEar'+str(sign),(sign*.365,1.375,-.012),(.084,.108,.080),RED,head,segments=16,rings=8,tilt=-sign*.42)


def patch(name,outline,center,profile,mat,target=head,offset=.008,rings=5):
    # Clip the marking to the ACTUAL coarse skin triangles. Merely raycasting
    # a few boundary points would leave long patch edges cutting through a
    # convex cheek between vertices. Every resulting polygon here lies on one
    # skin plane, so broad facets remain continuous through the coloured fur.
    offset *= .2  # Thin embroidered layers, not floating sheets in side views.
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    area=sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))
    if area<0:outline=list(reversed(outline))
    convex=all(cross(outline[i-1],outline[i],outline[(i+1)%len(outline)])>=-1e-9 for i in range(len(outline)))
    pieces=[outline] if convex else [[outline[p] if isinstance(p,int) else (p.x,p.y) for p in tri]
        for tri in tessellate_polygon([[Vector((x,y,0)) for x,y in outline]])]
    points=[];faces=[];indices={}
    for a,b,c in SURFACES[id(profile)]['triangles']:
        triangle=[(a.x,a.y),(b.x,b.y),(c.x,c.y)]
        for piece in pieces:
            polygon=list(piece)
            for i in range(3):
                start,end=triangle[i],triangle[(i+1)%3]
                clipped=[]
                for j,p in enumerate(polygon):
                    q=polygon[j-1];dp=cross(start,end,p);dq=cross(start,end,q)
                    if (dp>=-1e-10)!=(dq>=-1e-10):
                        t=dq/(dq-dp)
                        clipped.append((q[0]+t*(p[0]-q[0]),q[1]+t*(p[1]-q[1])))
                    if dp>=-1e-10:clipped.append(p)
                polygon=clipped
                if len(polygon)<3:break
            if len(polygon)<3:continue
            normal=(b-a).cross(c-a)
            face=[]
            for x,y in polygon:
                z=a.z-(normal.x*(x-a.x)+normal.y*(y-a.y))/normal.z
                key=tuple(round(value,8) for value in (x,y,z+offset))
                if key not in indices:indices[key]=len(points);points.append((x,y,z+offset))
                if not face or face[-1]!=indices[key]:face.append(indices[key])
            if len(face)>1 and face[-1]==face[0]:face.pop()
            if len(set(face))>=3:faces.append(tuple(face))
    assert faces,name+' marking missing'
    return mesh(name,points,faces,mat,target)

def ellipse(cx,cy,rx,ry,n=24):
    return [(cx+rx*cos(i*2*pi/n),cy+ry*sin(i*2*pi/n)) for i in range(n)]

patch('IvoryLowerFace',ellipse(0,.849,.355,.203), (0,.849),HEAD,WHITE,offset=.008,rings=8)
patch('RoundIvoryBelly',ellipse(0,.329,.274,.246),(0,.329),BODY,WHITE,root,offset=.007,rings=8)
for sign in (-1,1):
    patch('PeachCheek'+str(sign),ellipse(sign*.439,.928,.108,.157),(sign*.439,.928),HEAD,BLUSH,offset=.012,rings=6)
    # Eyes are embroidered-looking shallow ovals, not protruding cartoon balls.
    patch('OvalEye'+str(sign),ellipse(sign*.132,1.104,.039,.062),(sign*.132,1.104),HEAD,INK,offset=.011,rings=4)
    patch('EyeCatchlight'+str(sign),ellipse(sign*.132+.010,1.128,.0115,.013),(sign*.132+.010,1.128),HEAD,WHITE,offset=.015,rings=3)


def bezier(points,steps=6):
    out=[]
    for p0,p1,p2,p3 in points:
        for i in range(steps):
            t=i/steps;s=1-t
            out.append((s**3*p0[0]+3*s*s*t*p1[0]+3*s*t*t*p2[0]+t**3*p3[0],
                        s**3*p0[1]+3*s*s*t*p1[1]+3*s*t*t*p2[1]+t**3*p3[1]))
    return out
mouth=bezier([
    ((-.205,.957),(-.260,.978),(-.258,.912),(-.211,.884)),
    ((-.211,.884),(-.135,.827),(.135,.827),(.211,.884)),
    ((.211,.884),(.258,.912),(.260,.978),(.205,.957)),
    ((.205,.957),(.102,.929),(-.102,.929),(-.205,.957)),
])
# Reverse outline so all surface triangles face forward.
mouth=list(reversed(mouth))
patch('SmileEmbroideredOutline',mouth,(0,.909),HEAD,ROSE,offset=.016,rings=5)
inner=[(x*.927,.909+(y-.909)*.80) for x,y in mouth]
patch('HappyPinkSmile',inner,(0,.909),HEAD,PINK,offset=.019,rings=5)
tooth=[(-.105,.947),(-.085,.889),(.085,.889),(.105,.947),(.044,.938),(-.044,.938)]
patch('BroadFrontToothOutline',tooth,(0,.916),HEAD,ROSE,offset=.022,rings=3)
tooth_inner=[(x*.82,.920+(y-.920)*.70) for x,y in tooth]
patch('BroadIvoryFrontTooth',tooth_inner,(0,.918),HEAD,WHITE,offset=.025,rings=3)
# A short stitched philtrum connects the small coral nose to the smile.
patch('NoseSmileStitch',[(-.0055,.998),(.0055,.998),(.0055,.945),(-.0055,.945)],(0,.972),HEAD,ROSE,offset=.026,rings=3)
nose=bezier([
    ((-.042,1.065),(-.05,1.066),(-.041,1.044),(-.026,1.019)),
    ((-.026,1.019),(-.010,.989),(.010,.989),(.026,1.019)),
    ((.026,1.019),(.041,1.044),(.05,1.066),(.042,1.065)),
    ((.042,1.065),(.018,1.071),(-.018,1.071),(-.042,1.065)),
],steps=4)
patch('CoralRoundedTriangleNose',list(reversed(nose)),(0,1.043),HEAD,NOSE,offset=.032,rings=4)

# Stubby cream forearms are lifted to hold the red paws just below the cheeks.
for sign,pivot in [(-1,arm),(1,arm_left)]:
    oval('CreamRaisedForearm'+str(sign),(sign*.298,.618,.355),(.103,.137,.123),CREAM,pivot,segments=16,rings=8,tilt=-sign*.22)
    oval('RedRoundedPaw'+str(sign),(sign*.277,.720,.444),(.096,.088,.091),RED,pivot,segments=16,rings=8,tilt=-sign*.22)
for sign,pivot in [(-1,foot_right),(1,foot_left)]:
    oval('RedFlatFoot'+str(sign),(sign*.245,.073,.13),(.184,.073,.225),RED,pivot,segments=16,rings=8)
oval('RoundCreamTail',(0,.235,-.428),(.151,.154,.145),CREAM,root,segments=16,rings=10)

# Combine material-compatible parts per animation pivot. All pivots remain
# independent; the head owns every facial component, and neither paw owns face.
bpy.context.view_layer.update()
for pivot in (root,head,arm,arm_left,foot_left,foot_right):
    buckets={}
    for child in list(pivot.children):
        if child.type=='MESH':buckets.setdefault(child.data.materials[0].name,[]).append(child)
    for matname,objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        objects[0].name=pivot.name+'_'+matname.replace(' ','')

scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.76,.80,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.view_settings.view_transform='AgX'
camera_data=bpy.data.cameras.new('CharacterReviewCamera')
camera=bpy.data.objects.new('CharacterReviewCamera',camera_data);scene.collection.objects.link(camera)
camera_data.type='ORTHO';camera_data.ortho_scale=1.90
scene.camera=camera
for name,position,power,size in [('Key',(-3,5,4),500,4),('Fill',(3,2,2),180,3),('Rim',(0,4,-3),300,3)]:
    data=bpy.data.lights.new('CharacterReview'+name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj)
    obj.location=v(position);obj.rotation_euler=(v((0,.8,0))-obj.location).to_track_quat('-Z','Y').to_euler()

bpy.context.view_layer.update()
meshes=[obj for obj in root.children_recursive if obj.type=='MESH']
vertices=[obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
minimum=[min(point[i] for point in vertices) for i in range(3)]
maximum=[max(point[i] for point in vertices) for i in range(3)]
triangles=sum(len(poly.vertices)-2 for obj in meshes for poly in obj.data.polygons)
assert abs(minimum[2])<.0001 and 1.45<maximum[2]<1.55
assert 3000<triangles<6000
assert not bpy.data.images.get('Render Result') or not bpy.data.images['Render Result'].packed_file
for p in (head,arm,arm_left,foot_left,foot_right):p['animationPivot']=True
camera.location=v((2.6,1.55,4));camera.rotation_euler=(v((0,.76,0))-camera.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/character-guide.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in [root,*root.children_recursive]:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/Room/character-guide.glb'),export_format='GLB',use_selection=True,
    export_apply=True,export_cameras=False,export_lights=False,export_animations=False,export_extras=True,
    export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)
manifest={'root':'GuideCharacter','facing':'+Z','height':round(maximum[2],6),'width':round(maximum[0]-minimum[0],6),
    'depth':round(maximum[1]-minimum[1],6),'footY':round(minimum[2],6),'triangles':triangles,'meshes':len(meshes),
    'bytes':(ROOT/'public/Room/character-guide.glb').stat().st_size,
    'pivots':{p.name:[round(p.location.x,6),round(p.location.z,6),round(-p.location.y,6)] for p in [head,arm,arm_left,foot_left,foot_right,anchor]},
    'headDepthScale':1.42,'bodyDepthScale':1.55,
    'skinTopology':{'headSegments':20,'headLevels':15,'bodySegments':20,'bodyLevels':14},
    'patchFit':'Projected polygon clipped to actual front-facing skin triangles',
    'embeddedPhotos':False,'materials':[m.name for m in (CREAM,WHITE,RED,BLUSH,INK,ROSE,PINK,NOSE)]}
(ROOT/'assets/character-guide-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('CHARACTER_GUIDE '+json.dumps(manifest),flush=True)

# Temporary render-only studio floor is intentionally absent from saved/exported assets.
floor_material=material('ReviewOnly studio floor','#DEE1DC')
bpy.ops.mesh.primitive_plane_add(size=200,location=v((0,-.004,0)))
floor=bpy.context.object;floor.name='ReviewOnlyFloor';floor.data.materials.append(floor_material)
for name,location in [('front',(0,.93,4)),('side',(4,1.05,0)),('three-quarter',(2.6,1.55,4)),('back',(0,1.1,-4))]:
    camera.location=v(location);camera.rotation_euler=(v((0,.75,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(ROOT/'assets'/('character-guide-'+name+'.png'))
    bpy.ops.render.render(write_still=True)
