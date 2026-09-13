"""Derive the editable, richly furnished ink house from the approved room source.

Blender --background --python scripts/build_pen_ink_rooms.py [-- --skip-render]
All authoring coordinates use Three.js X / up Y / Z. No external packages.
Robot data, interactive pivots, screens and the source file are preserved.
"""
from pathlib import Path
from math import pi, sin, cos
from collections import defaultdict
import bpy, json, sys, random, hashlib, struct
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from rooms.common import v, box, mesh, empty, parent

ASSETS = ROOT / 'assets'
SOURCE = ASSETS / 'four-rooms.blend'
OUT = ROOT / 'public/Room/pen-ink-rooms.glb'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
bpy.context.preferences.filepaths.save_version = 0
RNG = random.Random(20260913)
ROOM_NAMES = ['RoomDeveloper', 'RoomPiano', 'RoomBlog', 'RoomAI']
ROOMS = {name: bpy.data.objects[name] for name in ROOM_NAMES}
BASE = json.loads((ASSETS / 'four-rooms-manifest.json').read_text())
DYNAMIC = set(BASE['dynamicObjects'])
FOCUS = {'Monitor','ResumeBoard','LeaderboardBoard','PortraitFrame','GameConsole','GameStart',
         'Robot','BlogLamp','Piano','PianoBench','BlogChair','ArchiveStool','GameStool'}


def top_room(obj):
    while obj.parent:
        obj = obj.parent
    return obj if obj.name in ROOMS else None


def is_robot(obj):
    while obj:
        if obj.name == 'Robot': return True
        obj = obj.parent
    return False


def owner(obj):
    current = obj
    while current:
        if current.name in DYNAMIC or current.name in FOCUS or current.name in ROOMS or current.get('nightWindow'):
            return current
        current = current.parent
    return top_room(obj)


def fingerprint(obj):
    return hashlib.sha256(json.dumps({
        'vertices': [list(vertex.co) for vertex in obj.data.vertices],
        'faces': [list(face.vertices) for face in obj.data.polygons],
        'materials': [(mat.name, list(mat.diffuse_color)) for mat in obj.data.materials],
        'matrix': [list(row) for row in obj.matrix_world],
    }, sort_keys=True).encode()).hexdigest()


originals = [o for o in bpy.context.scene.objects if top_room(o)]
robot_before = {o.name: fingerprint(o) for o in originals if o.type == 'MESH' and is_robot(o)}
anchor_before = {o.name: [list(row) for row in o.matrix_world] for o in originals if o.type == 'EMPTY'}
key_before = {o.name: [list(row) for row in o.matrix_world] for o in originals if o.name in DYNAMIC}
angles = {name: root.rotation_euler.z for name, root in ROOMS.items()}
for room in ROOMS.values(): room.rotation_euler.z = 0
bpy.context.view_layer.update()


def unlit(name, value):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (value, value, value, 1)
    nodes = mat.node_tree.nodes
    nodes.clear()
    # Blender 5.2's exporter recognizes RGB -> Surface as KHR_materials_unlit.
    # A plain Emission node exports a lit black base with emissiveFactor instead.
    emission = nodes.new('ShaderNodeRGB')
    emission.outputs[0].default_value = mat.diffuse_color
    out = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(emission.outputs[0], out.inputs['Surface'])
    mat['penInkAuthored'] = True
    return mat


PAPER = unlit('PenPaper', 1.0)
INK = unlit('PenInk', .004)
SOFT = unlit('PenSoftInk', .035)
STROKES = defaultdict(lambda: {'vertices': [], 'faces': [], 'count': 0})
ADDED = defaultdict(list)


def stroke(points, root, width=.003, soft=False, jitter=0):
    """Three-sided ink tubes: consolidated by owner, no per-stroke objects."""
    if len(points) < 2: return
    batch = STROKES[(root.name, soft)]
    width *= 1.90
    points = [Vector(p) for p in points]
    if jitter:
        for i in range(1, len(points)-1):
            points[i] += Vector((RNG.uniform(-jitter,jitter), RNG.uniform(-jitter,jitter), RNG.uniform(-jitter,jitter)))
    for a, b in zip(points, points[1:]):
        direction = b-a
        if direction.length < .00001: continue
        direction.normalize()
        side = direction.cross(Vector((0,1,0)))
        if side.length < .001: side = direction.cross(Vector((1,0,0)))
        side.normalize()
        up = direction.cross(side).normalized()
        offset = len(batch['vertices'])
        for center in (a,b):
            for k in range(3):
                q = center + width * (side*cos(k*2*pi/3) + up*sin(k*2*pi/3))
                batch['vertices'].append(v(q))
        for k in range(3):
            batch['faces'].append((offset+k, offset+(k+1)%3, offset+(k+1)%3+3, offset+k+3))
    batch['count'] += 1


def polyline(points, root, width=.003, closed=False, soft=False):
    if closed: points = [*points, points[0]]
    stroke(points, root, width, soft)


def ellipse(center, rx, rz, root, width=.003, plane='y', steps=28):
    x,y,z = center
    points = []
    for i in range(steps):
        a=i*2*pi/steps
        if plane=='y': points.append((x+rx*cos(a),y,z+rz*sin(a)))
        elif plane=='z': points.append((x+rx*cos(a),y+rz*sin(a),z))
        else: points.append((x,y+rx*cos(a),z+rz*sin(a)))
    polyline(points,root,width,True)


def hatch_rect(origin, u, w, root, spacing=.055, width=.0015, fraction=.3):
    """Parallel pen marks only in a selected edge strip; majority stays white."""
    o,u,w = Vector(origin),Vector(u),Vector(w)
    count=max(1,int(u.length/spacing))
    strip=w*fraction
    for i in range(count+1):
        t=(i+.18)/max(1,count+1)
        a=o+u*t
        b=a+strip+u.normalized()*min(.1,u.length*.09)
        stroke([a,(a+b)*.5,b],root,width,jitter=.001)


def clipped_face_hatching(obj, face, data, transform, root, fraction=.5, spacing=.028,
                          width=.0028, cross=False):
    """Shade a real convex face with clipped, slightly imperfect pen strokes.

    Unlike axis-aligned guessed rectangles, every stroke lies on the evaluated
    surface and follows its normal. The 5mm offset clears bevels and z fighting.
    Vertical surfaces keep their upper white paper plane; only the lower chosen
    band receives ink. Each face gets diagonal hatching, optionally crosshatched
    at its foot for a darker contact strip.
    """
    xyz=lambda p:Vector((p.x,p.z,-p.y))
    points=[xyz(transform@data.vertices[i].co) for i in face.vertices]
    normal=(points[1]-points[0]).cross(points[2]-points[0]).normalized()
    vertical=Vector((0,1,0))-normal*normal.y
    if vertical.length<.1:return 0
    vertical.normalize();horizontal=vertical.cross(normal).normalized()
    center=sum(points,Vector())/len(points)
    polygon=[Vector(((p-center).dot(horizontal),(p-center).dot(vertical))) for p in points]
    upper=max(p.y for p in polygon);lower=min(p.y for p in polygon)
    cutoff=lower+(upper-lower)*fraction

    def clip_below(poly,value):
        result=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            inside_a=a.y<=value;inside_b=b.y<=value
            if inside_a:result.append(a)
            if inside_a!=inside_b:
                t=(value-a.y)/(b.y-a.y)
                result.append(a.lerp(b,t))
        return result

    polygon=clip_below(polygon,cutoff)
    if len(polygon)<3:return 0
    count=0
    for angle,poly,gap,weight in [(pi*.29,polygon,spacing,width)]+(
            [(-pi*.24,clip_below(polygon,lower+(upper-lower)*fraction*.23),spacing*1.5,width*.80)] if cross else []):
        if len(poly)<3:continue
        direction=Vector((cos(angle),sin(angle)))
        perpendicular=Vector((-direction.y,direction.x))
        lo=min(p.dot(perpendicular) for p in poly)
        hi=max(p.dot(perpendicular) for p in poly)
        steps=max(1,int((hi-lo)/gap))
        for j in range(steps+1):
            level=lo+(j+.4)*(hi-lo)/(steps+1)
            intersections=[]
            for a,b in zip(poly,poly[1:]+poly[:1]):
                aa=a.dot(perpendicular)-level;bb=b.dot(perpendicular)-level
                if aa*bb<0:
                    intersections.append(a.lerp(b,aa/(aa-bb)))
            if len(intersections)<2:continue
            intersections.sort(key=lambda p:p.dot(direction))
            a,b=intersections[0],intersections[-1]
            length=(b-a).length
            if length<.012:continue
            # Small variable edge insets give a drawn shadow boundary.
            trim=min(length*.075,.010+RNG.random()*.006)
            a+=direction*trim;b-=direction*trim
            to_surface=lambda p:center+horizontal*p.x+vertical*p.y+normal*.005
            start,end=to_surface(a),to_surface(b)
            stroke([start,(start+end)*.5,end],root,weight,jitter=.0011)
            count+=1
    return count


def newbox(name,p,d,root,bevel=.012,yaw=0):
    o=box('InkDetail_'+name,p,d,PAPER,root,bevel=bevel,yaw=yaw)
    o['penInkAuthored']=True
    ADDED[top_room(root).name].append(o.name)
    return o


def cylinder(name,p,r,h,root,top=None,n=24,mat=PAPER):
    x,y,z=p
    if top is None: top=r
    points=[(x+rr*cos(i*2*pi/n), yy,z+rr*sin(i*2*pi/n)) for yy,rr in [(y-h/2,r),(y+h/2,top)] for i in range(n)]
    # x/z rings wind clockwise from above in Three's Y-up coordinates.
    # Explicit outward winding is essential for surface-normal hatch offsets.
    faces=[tuple(range(n)),tuple(reversed(range(n,n*2)))]
    faces += [(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
    o=mesh('InkDetail_'+name,points,faces,mat,root)
    o['penInkAuthored']=True
    ADDED[top_room(root).name].append(o.name)
    return o


def book(name,x,y,z,width,height,depth,root):
    newbox(name+'Pages',(x,y+height/2,z),(width,height-.025,depth-.025),root,.004)
    for xx in [x-width/2,x+width/2]:
        newbox(name+'Cover',(xx,y+height/2,z),(.012,height+.022,depth),root,.003)
    newbox(name+'Spine',(x,y+height/2,z+depth/2),(width+.014,height+.022,.025),root,.006)
    # End bands and a small unlettered title cartouche.
    for yy in [y+.07,y+height-.065]:
        stroke([(x-width*.45,yy,z+depth/2+.014),(x+width*.45,yy+.003,z+depth/2+.014)],root,.002)
    if height>.36:
        hatch_rect((x-width*.4,y+.13,z+depth/2+.015),(width*.7,0,0),(0,height*.3,0),root,.035,.0013,.65)
    # Four curved end-grain page lines stay on the exposed upper page block.
    for j in range(4):
        zz=z-depth*.28+j*depth*.16
        stroke([(x-width*.4,y+height/2+.003,zz),(x,y+height/2+.003,zz+.006),(x+width*.4,y+height/2+.003,zz)],root,.001)


def shelf(name,x,z,root,width=1.03,height=2.2,levels=4):
    depth=.42
    for xx in [x-width/2,x+width/2]:
        newbox(name+'Upright',(xx,height/2,z),(.065,height,depth),root)
    newbox(name+'Back',(x,height/2,z-depth/2),(width,height,.035),root,.004)
    for j in range(levels+1):
        yy=.08+j*(height-.14)/levels
        newbox(name+'Shelf',(x,yy,z),(width+.11,.055,depth+.05),root)
        if j:
            hatch_rect((x+width/2+.034,yy-.23,z-depth/2+.04),(0,0,depth-.07),(0,.21,0),root,.018,.0020,.95)
        if j==levels: continue
        pos=x-width/2+.085
        count=4 if j%2 else 5
        for k in range(count):
            bw=.095+RNG.random()*.025
            bh=.24+RNG.random()*.17
            book(name+f'Book{j}-{k}',pos+bw/2,yy+.036,z+.03,bw,bh,.29,root)
            pos+=bw+.022
        if j%2:
            cylinder(name+'Vase',(x+width*.28,yy+.17,z+.04),.095,.28,root,.055,n=20)
    hatch_rect((x-width/2-.034,.2,z+depth/2+.003),(0,height-.4,0),(.06,0,0),root,.07,.0013,.8)


def leaf(name,start,tip,wide,root):
    a,b=Vector(start),Vector(tip)
    direction=b-a
    side=direction.cross(Vector((0,1,0)))
    if side.length<.01: side=Vector((1,0,0))
    side.normalize()
    rings=[]
    for j in range(7):
        t=j/6
        mid=a+direction*t+Vector((0,sin(t*pi)*wide*.52,0))
        breadth=sin(t*pi)*wide*(1+.08*sin(j*2.1))
        rings.append([mid-side*breadth,mid+Vector((0,.01,0)),mid+side*breadth])
    points=[q for ring in rings for q in ring]
    faces=[]
    for j in range(6):
        k=j*3
        faces.extend([(k,k+1,k+4,k+3),(k+1,k+2,k+5,k+4)])
    o=mesh('InkDetail_'+name,points,faces,PAPER,root)
    o['skipInkEdges']=True;o['penInkAuthored']=True
    ADDED[top_room(root).name].append(o.name)
    polyline([ring[0] for ring in rings]+[ring[2] for ring in rings[::-1]],root,.0026,True)
    stroke([ring[1]+Vector((0,.002,0)) for ring in rings],root,.0022)
    for j in range(1,6):
        # Hatching on one leaf half preserves the broad white crown.
        stroke([rings[j][1]+Vector((0,.003,0)),rings[j][2]+Vector((0,.003,0))],root,.0014)
        if j%2==0:
            stroke([rings[j][1]+Vector((0,.003,0)),rings[j][0]+Vector((0,.003,0))],root,.0011)
    # A real ink shadow on one leaf half: parallel marks interpolated directly
    # along its folded surface. Broad unmarked opposite half stays white.
    for j in range(1,6):
        for sub in range(3):
            t=(sub+.25)/3
            center=rings[j][1].lerp(rings[j+1][1],t)
            edge=rings[j][2].lerp(rings[j+1][2],t)
            offset=Vector((0,.007,0))
            stroke([center.lerp(edge,.10)+offset,center.lerp(edge,.52)+offset,center.lerp(edge,.96)+offset],root,.0025,jitter=.0005)


def botanical(name,p,root,scale=1,branches=10):
    x,y,z=p;s=scale
    cylinder(name+'Pot',(x,y+.20*s,z),.18*s,.38*s,root,.245*s)
    cylinder(name+'PotRim',(x,y+.397*s,z),.25*s,.045*s,root)
    cylinder(name+'Soil',(x,y+.425*s,z),.215*s,.018*s,root,mat=INK)
    for k in range(14):
        angle=k*2*pi/14
        stroke([(x+.19*s*cos(angle),y+.04*s,z+.19*s*sin(angle)),(x+.24*s*cos(angle),y+.38*s,z+.24*s*sin(angle))],root,.0014)
    origin=Vector((x,y+.43*s,z))
    for k in range(branches):
        angle=k*2.39996
        mid=origin+Vector((cos(angle)*.12*s,(.40+.075*(k%5))*s,sin(angle)*.12*s))
        end=origin+Vector((cos(angle)*(.38+.025*(k%3))*s,(.6+.11*(k%5))*s,sin(angle)*(.38+.025*(k%3))*s))
        stroke([origin,mid,end],root,.008*s)
        for j in range(3):
            start=mid.lerp(end,j/3)
            a=angle+(-1 if j%2 else 1)*.8
            tip=start+Vector((cos(a)*.38*s,.11*s,sin(a)*.38*s))
            tip.x=max(.18,tip.x)
            leaf(name+f'Leaf{k}-{j}',start,tip,.12*s,root)


def notebook(name,p,root):
    x,y,z=p
    newbox(name+'Cover',(x,y,z),(.44,.045,.56),root,.005,yaw=.05)
    newbox(name+'Paper',(x,y+.028,z),(.411,.014,.525),root,.004,yaw=.05)
    for k in range(8):
        zz=z-.2+k*.057
        ellipse((x-.20,y+.044,zz),.035,.022,root,.002,plane='z',steps=12)
        if k<6: stroke([(x-.13,y+.037,zz),(x+.13-RNG.random()*.1,y+.037,zz)],root,.0014)
    stroke([(x+.26,y+.046,z-.19),(x+.32,y+.047,z+.2)],root,.009)
    stroke([(x+.26,y+.046,z-.19),(x+.251,y+.046,z-.244)],root,.003)


def mug(name,p,root):
    x,y,z=p
    cylinder(name+'Cup',(x,y+.115,z),.10,.23,root,.116)
    cylinder(name+'Inside',(x,y+.233,z),.096,.006,root,mat=INK)
    ellipse((x,y+.24,z),.114,.114,root,.004)
    ellipse((x+.125,y+.12,z),.09,.075,root,.012,plane='z',steps=20)
    for j in range(4): stroke([(x-.07+j*.045,y+.04,z+.101),(x-.055+j*.045,y+.115,z+.112)],root,.0012)


def frame(name,p,root,width=.60,height=.67,kind='botanical'):
    x,y,z=p
    newbox(name+'Mat',(x,y,z),(width,height,.042),root,.004)
    for xx in [x-width/2,x+width/2]:newbox(name+'Side',(xx,y,z+.027),(.035,height+.04,.045),root,.006)
    for yy in [y-height/2,y+height/2]:newbox(name+'Rail',(x,yy,z+.027),(width+.04,.035,.045),root,.006)
    if kind=='botanical':
        stroke([(x,y-height*.32,z+.025),(x-.04,y,z+.025),(x+.06,y+height*.32,z+.025)],root,.0023)
        for k in range(5):
            yy=y-height*.22+k*height*.11
            side=-1 if k%2 else 1
            polyline([(x,yy,z+.027),(x+side*width*.23,yy+.10,z+.027),(x+side*width*.14,yy-.015,z+.027),(x,yy,z+.027)],root,.002)
    else:
        for j in range(4):
            stroke([(x-width*.35,y-height*.22+j*.1,z+.026),(x+width*.35,y-height*.22+j*.1,z+.026)],root,.0015)
        ellipse((x,y+height*.18,z+.027),width*.16,width*.16,root,.002,plane='z')


def basket(name,p,root):
    x,y,z=p
    cylinder(name+'Basket',(x,y+.27,z),.28,.54,root,.37)
    for j in range(9):ellipse((x,y+.025+j*.057,z),.282+j*.01,.282+j*.01,root,.0024,steps=24)
    for j in range(18):
        a=j*2*pi/18
        stroke([(x+.28*cos(a),y+.015,z+.28*sin(a)),(x+.37*cos(a+.13),y+.53,z+.37*sin(a+.13))],root,.0027)
    ellipse((x,y+.55,z),.373,.373,root,.008)


# Convert major planes to white paper. Black areas are meaningful notation,
# apertures, piano accidentals and thin structural accents, never broad walls.
for obj in originals:
    if obj.type!='MESH' or is_robot(obj) or obj.name.startswith('RenderOnly'): continue
    black=(any(q in obj.name for q in ['ScoreNote','ScoreStaff','ScoreTitle','ChickEye','Soil','KeyboardShadow'])
           or obj.name in ['GamePadCircle','GamePadDiamond','GamePadTriangle','GamePadSquare','GameStartButton']
           or obj.name.startswith('GamePadNumber'))
    if obj.name.startswith('PianoKey') and obj.name[8:].isdigit():
        black=int(obj.name[8:])%12 in [1,3,6,8,10]
    for i in range(len(obj.data.materials)):obj.data.materials[i]=INK if black else PAPER
    obj['penInkAuthored']=True
    for attr in list(obj.data.color_attributes):obj.data.color_attributes.remove(attr)

# Replace the low-detail original potted vignette with the articulated botanical
# in the same corner. Keep source hierarchy for inspection, but hide the old art.
for plant_name in ['ArchiveFloorPlant','PianoCornerPlant','BlogWindowPlant','GameWindowPlant']:
    plant_root=bpy.data.objects.get(plant_name)
    if plant_root:
        for obj in plant_root.children_recursive:
            obj['penInkSuperseded']=True
            obj.hide_render=True
            obj.hide_set(True)

# Curated, camera-visible room stories: archival library / music study /
# illustrated writing desk / small experiment atelier. Clear centers remain.
for name,root in ROOMS.items():
    prefix=name.replace('Room','')
    shelf(prefix+'Bookcase',4.92,.48,root,width=.87,height=2.32,levels=4)
    botanical(prefix+'Broadleaf',(.80,.015,4.25),root,scale=1.30,branches=13)
    basket(prefix+'WovenBasket',(4.93,.015,1.54),root)
    # Rolled drawing papers make the woven basket a meaningful studio object.
    for k in range(3):
        xx=4.79+k*.12
        cylinder(prefix+'PaperRoll',(xx,.50,1.49+.055*(k%2)),.052,.66+.08*(k%2),root,n=16)
        ellipse((xx,.835+.04*(k%2),1.49+.055*(k%2)),.04,.04,root,.0025)
    # Back-wall hanging shelf occupies a free band above or beside the screens.
    frame(prefix+'BotanicalStudy',(4.93,2.98,.20),root,.54,.58)
    # Low architectural dado on left-front blank wall, below the window.
    for zz in [.56,1.17,1.78,2.39,3.00,3.61,4.22,4.83]:
        newbox(prefix+'DadoStile',(.15,.60,zz),(.04,.59,.035),root,.004)
    newbox(prefix+'DadoRail',(.15,.91,2.8),(.047,.045,5.34),root,.004)
    # Atlas direction keeps the room floor as quiet paper around detailed props.

dev=ROOMS['RoomDeveloper']
notebook('ArchiveSketchbook',(2.15,.554,1.14),dev)
mug('ArchiveCup',(3.90,.541,1.13),dev)
for j in range(3):
    frame('ArchivePrint'+str(j),(.72,1.36+j*.58,.20),dev,.53,.42,kind='diagram' if j==1 else 'botanical')

blog=ROOMS['RoomBlog']
notebook('WriterNotebook',(1.46,1.32,1.54),blog)
mug('WriterCoffee',(4.19,1.313,1.79),blog)
newbox('WriterWallShelf',(2.58,2.95,.39),(2.75,.065,.39),blog)
for j in range(7):book('WriterShelfBook'+str(j),1.41+j*.16,2.986,.39,.11,.24+(j%3)*.04,.25,blog)
botanical('WriterShelfVine',(3.34,2.99,.39),blog,.39,branches=6)
for j in range(2):frame('WriterPinnedStudy'+str(j),(1.23+j*.73,2.28,.20),blog,.56,.59)

piano=ROOMS['RoomPiano']
newbox('MusicSideTable',(4.82,.78,3.25),(.74,.07,.70),piano)
for x in [4.56,5.08]:
    for z in [3.02,3.48]:newbox('MusicSideLeg',(x,.38,z),(.044,.76,.044),piano,.005)
notebook('MusicFolio',(4.80,.835,3.19),piano)
mug('MusicTea',(5.02,.821,3.48),piano)
frame('MusicInkPrint',(.58,2.30,.20),piano,.54,.80,kind='diagram')

ai=ROOMS['RoomAI']
frame('AtelierCircuitStudy',(.64,2.36,.20),ai,.56,.72,kind='diagram')
newbox('AtelierSideCabinet',(.55,.38,.55),(.62,.74,.61),ai)
botanical('AtelierTableFern',(.55,.77,.55),ai,.62,branches=7)

from pen_ink.room_medieval import build_medieval_rooms
MEDIEVAL=build_medieval_rooms({'rooms':ROOMS,'paper':PAPER,'ink':INK,'newbox':newbox,
    'cylinder':cylinder,'mesh':mesh,'empty':empty,'v':v,'stroke':stroke,'hatch_rect':hatch_rect,
    'rng':RNG,'added':ADDED,'atlas_mode':True})
from pen_ink.room_atlas_organ import build_atlas_organ
from pen_ink.room_atlas_furniture import build_atlas_furniture
atlas_api={'rooms':ROOMS,'paper':PAPER,'ink':INK,'newbox':newbox,'cylinder':cylinder,
    'mesh':mesh,'empty':empty,'v':v,'stroke':stroke,'ellipse':ellipse,'rng':RNG,'added':ADDED}
ATLAS_ORGAN=build_atlas_organ(atlas_api)
ATLAS_FURNITURE=build_atlas_furniture(atlas_api)

bpy.context.view_layer.update()

# Author explicit edges from evaluated polygons, rejecting flat triangulation
# and tiny bevel edges. They remain true geometry in Blender and on the web.
outline_count=0
graph=bpy.context.evaluated_depsgraph_get()
targets=[o for o in bpy.context.scene.objects if o.type=='MESH' and top_room(o) and not is_robot(o) and not o.name.startswith('RenderOnly') and not o.get('penInkSuperseded')]
for obj in targets:
    if obj.get('skipInkEdges'):continue
    name=obj.name
    if any(token in name for token in ['Plaster','OakBoard','BackMolding','LeftMolding','MoldingCorner',
            'Dado','CornerBead','ScoreStaff','ScoreNote','ScoreTitle','Soil','WindowGlass','WindowRecess']): continue
    root=owner(obj)
    ev=obj.evaluated_get(graph);data=ev.to_mesh()
    transform=root.matrix_world.inverted()@ev.matrix_world
    verts=[transform@vert.co for vert in data.vertices]
    adjacency=defaultdict(list)
    for face in data.polygons:
        for edge in face.edge_keys:adjacency[tuple(sorted(edge))].append(face.normal.copy())
    thin=any(token in name for token in ['OakBoard','Keyboard','Molding','Dado','Book','Score'])
    width=.0019 if thin else .0032
    if name.startswith('PianoKey') or 'Score' in name:width=.0011
    if 'Plinth' in name or 'OakRim' in name:width=.0014
    for pair,normals in adjacency.items():
        if len(normals)>1 and normals[0].dot(normals[1])>.74:continue
        a,b=[verts[i] for i in pair]
        if (b-a).length<.035:continue
        # Floorboards only need visible top boundary, not their hidden box edges.
        if 'OakBoard' in name and (a.z<.0 or b.z<.0):continue
        xyz=lambda q:Vector((q.x,q.z,-q.y))
        aa,bb=xyz(a),xyz(b)
        midpoint=(aa+bb)*.5
        stroke([aa,midpoint,bb],root,width,jitter=.0035 if not thin else .0013)
        outline_count+=1
    ev.to_mesh_clear()

# Coherent, surface-attached shadow passages. Selection is deliberately by
# meaningful furniture parts, never global material density or every plane.
face_hatch_count=0;face_hatch_surfaces=0
for obj in targets:
    name=obj.name
    category=None
    if name in ['PianoUpperField','PianoLowerField']:category='piano_panel'
    elif name=='PianoCabinet':category='piano_side'
    elif name.startswith('ChairFoldedBackPanel'):category='chair'
    elif name.startswith('BlogDeskPedestal') and 'Foot' not in name:category='desk'
    elif name.startswith('InkDetail_') and 'BookcaseUpright' in name:category='shelf_side'
    elif name.startswith('InkDetail_') and 'BookcaseBack' in name:category='shelf_back'
    elif name.startswith('InkDetail_') and ('BroadleafPot' in name or 'TableFernPot' in name) and 'Rim' not in name:category='pot'
    elif name in ['ArchiveBenchApron','PianoBenchUnderframe']:category='apron'
    elif obj.get('medievalWood'):category='timber'
    elif obj.get('medievalStone'):category='stone'
    elif obj.get('atlasWood'):category='atlas_wood'
    elif obj.get('atlasPipe'):category='atlas_pipe'
    if category is None:continue
    root=owner(obj);ev=obj.evaluated_get(graph);data=ev.to_mesh()
    transform=root.matrix_world.inverted()@ev.matrix_world
    world_normal_matrix=ev.matrix_world.to_3x3().inverted().transposed()
    for face in data.polygons:
        normal=world_normal_matrix@face.normal;normal.normalize()
        nx,ny,nz=normal.x,normal.z,-normal.y
        if abs(ny)>.68:continue  # Broad illuminated tops retain white paper.
        area=face.area
        if category in ['piano_panel','shelf_back','apron']:
            if nz<.92 or area<.03:continue
        elif category in ['piano_side','desk','shelf_side']:
            if nx<.90 or area<.07:continue
        elif category=='chair':
            if nx*.60+nz*.80<.25 or area<.055:continue
        elif category=='pot':
            if nx<.2 or nz<-.4 or area<.008:continue
        elif category in ['timber','stone','atlas_wood','atlas_pipe']:
            if nx*.62+nz*.78<.25 or area<(.006 if category=='atlas_pipe' else .025 if category=='atlas_wood' else .045 if category=='timber' else .014):continue
        fractions={'piano_panel':.55,'piano_side':.78,'chair':.62,'desk':.75,
                   'shelf_side':.78,'shelf_back':.94,'pot':.88,'apron':.84,'timber':.28,'stone':.30,
                   'atlas_wood':.56,'atlas_pipe':.23}
        count=clipped_face_hatching(obj,face,data,transform,root,fraction=fractions[category],
                spacing=.043 if category in ['timber','stone'] else .031 if category=='atlas_pipe' else .024 if category in ['piano_panel','chair','pot'] else .028,
                width=.0015 if category=='atlas_pipe' else .0028 if category!='shelf_back' else .0034,
                cross=category in ['piano_panel','piano_side','chair','desk','shelf_back'])
        face_hatch_count+=count;face_hatch_surfaces+=int(count>0)
    ev.to_mesh_clear()

# The floor and large wall planes remain unmarked atlas paper.

ink_objects=[]
for (owner_name,soft),batch in STROKES.items():
    data=bpy.data.meshes.new('PenInk_'+owner_name+('Soft' if soft else '')+'Geometry')
    data.from_pydata(batch['vertices'],[],batch['faces']);data.materials.append(SOFT if soft else INK);data.update()
    obj=bpy.data.objects.new('PenInk_'+owner_name+('Soft' if soft else ''),data)
    bpy.context.collection.objects.link(obj);obj.parent=bpy.data.objects[owner_name]
    obj['penInkStroke']=True;obj['penInkAuthored']=True;obj['strokeCount']=batch['count']
    ink_objects.append(obj)

for name,root in ROOMS.items():
    root.rotation_euler.z=angles[name]
    root['penInkAuthored']=True
    root['penInkStyle']='antique atlas: quiet paper planes, engraved core objects, chamber pipe organ and carved writing furniture'
bpy.context.view_layer.update()
assert robot_before=={o.name:fingerprint(o) for o in originals if o.type=='MESH' and is_robot(o)}, 'Robot preservation failed'
assert anchor_before=={o.name:[list(row) for row in o.matrix_world] for o in originals if o.type=='EMPTY'}, 'Anchor moved'
assert key_before=={o.name:[list(row) for row in o.matrix_world] for o in originals if o.name in DYNAMIC}, 'Dynamic pivot moved'


def export_batched():
    source=[o for o in bpy.context.scene.objects if top_room(o) and not o.name.startswith('RenderOnly') and not o.get('penInkSuperseded')]
    graph=bpy.context.evaluated_depsgraph_get();batches={}
    for obj in source:
        if obj.type!='MESH':continue
        ev=obj.evaluated_get(graph);data=ev.to_mesh();root=owner(obj)
        transform=root.matrix_world.inverted()@ev.matrix_world
        for index,mat in enumerate(data.materials):
            faces=[p for p in data.polygons if p.material_index==index]
            if not faces:continue
            key=(root.name,mat.name,bool(obj.get('penInkStroke')))
            batch=batches.setdefault(key,{'root':root,'mat':mat,'vertices':[],'faces':[]})
            offset=len(batch['vertices'])
            batch['vertices'].extend(transform@vert.co for vert in data.vertices)
            batch['faces'].extend(tuple(offset+i for i in face.vertices) for face in faces)
        ev.to_mesh_clear()
    pivots={}
    for name in DYNAMIC:
        obj=bpy.data.objects.get(name)
        if obj and obj.type=='MESH':
            obj.name=name+'__source'
            pivot=empty(name,(0,0,0));pivot.matrix_world=obj.matrix_world.copy();parent(pivot,obj.parent)
            for key in obj.keys():pivot[key]=obj[key]
            pivots[name]=(obj,pivot)
    exports=[]
    for (name,matname,ink),batch in batches.items():
        data=bpy.data.meshes.new(name+'_'+matname+'_Export')
        data.from_pydata(batch['vertices'],[],batch['faces']);data.materials.append(batch['mat']);data.update()
        obj=bpy.data.objects.new(('PenInk_' if ink else '')+name+'_'+matname+'_Baked',data)
        bpy.context.collection.objects.link(obj)
        obj.parent=pivots[name][1] if name in pivots else batch['root']
        if not is_robot(obj):obj['penInkAuthored']=True
        if ink:obj['penInkStroke']=True
        exports.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in source:
        if obj.type=='EMPTY':obj.select_set(True)
    for original,pivot in pivots.values():pivot.select_set(True)
    for obj in exports:obj.select_set(True)
    bpy.context.view_layer.update()
    triangles=0
    for obj in exports:
        obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,export_apply=True,
        export_yup=True,export_lights=False,export_cameras=False,export_extras=True,
        export_vertex_color='NONE',export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,export_draco_position_quantization=16,
        export_draco_normal_quantization=10,export_animations=True)
    mesh_count=len(exports)
    for obj in exports:
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(data)
    for name,(original,pivot) in pivots.items():
        bpy.data.objects.remove(pivot,do_unlink=True);original.name=name
    return {'exportMeshes':mesh_count,'triangles':triangles,'fileBytes':OUT.stat().st_size}


stats=export_batched()
from pen_ink.preserve_character import transplant_robot
stats['robotPayloadPreservation']=transplant_robot(ROOT/'public/Room/four-rooms.glb', OUT)
stats['fileBytes']=OUT.stat().st_size
# Keep the runtime neutral material contract. The editable Blender file offers
# a separate sepia map preview through object material overrides only.
def preview_material(name,hex_color):
    rgb=[int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    linear=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*linear,1)
    mat.node_tree.nodes.clear();color=mat.node_tree.nodes.new('ShaderNodeRGB')
    color.outputs[0].default_value=mat.diffuse_color
    output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(color.outputs[0],output.inputs[0]);mat['previewOnly']=True
    return mat
preview_paper=preview_material('Atlas Preview | PenPaper object','#f2e6ce')
preview_field=preview_material('Atlas Preview | PenPaper field','#eadcc0')
preview_ink=preview_material('Atlas Preview | PenInk brown','#5c422d')
preview_muted=preview_material('Atlas Preview | PenSoftInk muted','#725b43')
for obj in bpy.context.scene.objects:
    if obj.type!='MESH' or not top_room(obj) or is_robot(obj) or obj.name.startswith('RenderOnly'):continue
    for i,slot in enumerate(obj.material_slots):
        original=slot.material
        if original is None:continue
        obj.material_slots[i].link='OBJECT'
        obj.material_slots[i].material=preview_ink if original==INK else preview_muted if original==SOFT else preview_paper
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=preview_field.diffuse_color
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
ground=bpy.data.objects.get('RenderOnlyGround')
if ground:
    ground.data.materials.clear();ground.data.materials.append(preview_field)
for obj in scene.objects:obj.hide_render=bool(obj.get('penInkSuperseded'))
scene.render.resolution_x=1500;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.camera.data.ortho_scale=8.8
room=ROOMS['RoomBlog']
target=room.matrix_world@v((2.75,1.50,2.50))
scene.camera.location=room.matrix_world@v((10.8,8.3,12.0))
scene.camera.rotation_euler=(target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
for obj in scene.objects:
    r=top_room(obj)
    if r and r!=room:obj.hide_render=True
scene.render.filepath=str(ASSETS/'pen-ink-rooms-blog.png')
if '--skip-render' not in sys.argv:bpy.ops.render.render(write_still=True)
for obj in scene.objects:
    obj.hide_render=bool(obj.get('penInkSuperseded')) or (top_room(obj) is not None and top_room(obj)!=ROOMS['RoomPiano'])
room=ROOMS['RoomPiano'];target=room.matrix_world@v((2.80,1.75,1.45))
scene.camera.location=room.matrix_world@v((7.4,4.6,8.8))
scene.camera.rotation_euler=(target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera.data.ortho_scale=5.5
scene.render.filepath=str(ASSETS/'atlas-organ-close.png')
if '--skip-render' not in sys.argv:bpy.ops.render.render(write_still=True)
for obj in scene.objects:obj.hide_render=bool(obj.get('penInkSuperseded'))
scene.camera.data.ortho_scale=17.2
scene.camera.location=v((12,22,16));target=v((0,1.0,0))
scene.camera.rotation_euler=(target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(ASSETS/'pen-ink-rooms-whole-house.png')
scene.render.resolution_x=1700;scene.render.resolution_y=1400
if '--skip-render' not in sys.argv:bpy.ops.render.render(write_still=True)
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type!='VIEW_3D':continue
            space.shading.type='MATERIAL'
            space.shading.use_scene_world=True
            space.clip_start=.1;space.clip_end=250
            if space.region_3d:
                space.region_3d.view_perspective='CAMERA'
                space.region_3d.view_camera_zoom=0
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'pen-ink-rooms.blend'))
manifest={**BASE,**stats,'asset':'/Room/pen-ink-rooms.glb','source':'assets/pen-ink-rooms.blend',
    'derivedFrom':'assets/four-rooms.blend','geometryStyle':'Antique atlas engraving: quiet unmarked floor/wall planes, tiered chamber pipe organ, carved noticeboard and wooden chair, linen seams and bound folios. Neutral runtime pigments with sepia Blender object overrides.',
    'medieval':MEDIEVAL,
    'atlas':{'organ':ATLAS_ORGAN,'furniture':ATLAS_FURNITURE,
        'previewPalette':{'field':'#eadcc0','paper':'#f2e6ce','ink':'#5c422d','muted':'#725b43'},
        'runtimeMaterialsRemainNeutral':True,'backgroundFloorboardContoursRemoved':True,
        'reversibleBackup':'assets/archive/atlas-before'},
    'ambientOcclusion':None,'penInk':{'outlineSegments':outline_count,'strokeCount':sum(b['count'] for b in STROKES.values()),
        'faceAttachedHatchStrokes':face_hatch_count,'faceAttachedHatchSurfaces':face_hatch_surfaces,
        'strokeMeshes':len(ink_objects),'addedObjects':{k:len(v) for k,v in ADDED.items()},
        'robotPreservedMeshes':len(robot_before),'allAnchorTransformsPreserved':True,'allDynamicTransformsPreserved':True,
        'materials':['PenPaper','PenInk','PenSoftInk'],'runtimeContract':'penInkAuthored excludes duplicate runtime outlines; penInkStroke identifies consolidated physical ink strokes.',
        'layout':'Added side bookcases and botanical corners; monitor/portrait/resume/leaderboard apertures, piano keyboard, bench, and central passages unchanged.'}}
(ASSETS/'pen-ink-rooms-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('PEN_INK_RESULT '+json.dumps({**stats,**manifest['penInk']}),flush=True)
