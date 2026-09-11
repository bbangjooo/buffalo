"""Author four independent quarter rooms, bake vertex AO, export one GLB.

Blender --background --factory-startup --python scripts/build_four_rooms.py
Palette: src/design/jo-colors.json. Never modifies existing diorama sources.
"""
from pathlib import Path
from math import pi, cos, sin, sqrt
import sys, json, time, hashlib
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from rooms.common import v,parent,empty,box,cyl,ellipsoid,rod,mesh,text,grid,plant
from rooms.piano import build_piano

ASSETS=ROOT/'assets'; ASSETS.mkdir(exist_ok=True)
GLB=ROOT/'public/Room/four-rooms.glb'
COLORS=json.loads((ROOT/'src/design/jo-colors.json').read_text())['colors']


def noncurtain_geometry_fingerprints():
    """Hash authored geometry/materials, independently of regenerated AO."""
    fingerprints={};graph=bpy.context.evaluated_depsgraph_get()
    def clean(value):
        value=round(float(value),6)
        return 0.0 if value==0 else value
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or 'LinenCurtain' in obj.name or obj.name.startswith('RenderOnly'):continue
        current=obj;curtain=False
        while current.parent:
            curtain=curtain or bool(current.get('curtainSide'))
            current=current.parent
        if curtain or current.name not in ['RoomDeveloper','RoomPiano','RoomBlog','RoomAI']:continue
        evaluated=obj.evaluated_get(graph);data=evaluated.to_mesh()
        normal_matrix=evaluated.matrix_world.to_3x3().inverted().transposed()
        vertices=[[clean(c) for c in evaluated.matrix_world@vertex.co] for vertex in data.vertices]
        normals=[[clean(c) for c in (normal_matrix@normal.vector).normalized()] for normal in data.corner_normals]
        polygons=[(list(face.vertices),face.material_index,face.use_smooth) for face in data.polygons]
        materials=[]
        for mat in data.materials:
            bsdf=mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
            if bsdf:
                values={name:[clean(c) for c in bsdf.inputs[name].default_value] for name in ['Base Color','Emission Color']}
                values.update({name:clean(bsdf.inputs[name].default_value) for name in ['Roughness','Metallic','Emission Strength']})
                materials.append(values)
            else:materials.append(None)
        payload=json.dumps([vertices,normals,polygons,materials],separators=(',',':')).encode()
        fingerprints[obj.name]=hashlib.sha256(payload).hexdigest()
        evaluated.to_mesh_clear()
    return fingerprints


CURTAIN_BASELINE={}
PORTRAIT_BASELINE={}
curtain_archive=ASSETS/'archive/four-rooms-before-curtains.blend'
if '--curtain-previews' in sys.argv and curtain_archive.exists():
    bpy.ops.wm.open_mainfile(filepath=str(curtain_archive))
    CURTAIN_BASELINE=noncurtain_geometry_fingerprints()
    # The archive is only read in this headless process. Reset datablocks before
    # authoring so existing material names and the user's open GUI stay intact.
    bpy.ops.wm.read_factory_settings(use_empty=False)
portrait_archive=ASSETS/'archive/four-rooms-before-portrait.blend'
if '--portrait-preview' in sys.argv and portrait_archive.exists():
    bpy.ops.wm.open_mainfile(filepath=str(portrait_archive))
    PORTRAIT_BASELINE={name:value for name,value in noncurtain_geometry_fingerprints().items() if not name.startswith(('ArchiveFolio','Portrait'))}
    bpy.ops.wm.read_factory_settings(use_empty=False)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0


def linear(c):
    return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4


def material(token,name=None,rough=None,metal=0):
    code=COLORS[token].lstrip('#'); color=[linear(int(code[i:i+2],16)/255) for i in (0,2,4)]
    mat=bpy.data.materials.new(name or token)
    mat.use_nodes=True;mat.diffuse_color=(*color,1)
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=rough if rough is not None else {
        'ink':.34,'brass':.29,'walnut':.46,'wood':.62,'paper':.82,'glow':.70}.get(token,.88)
    bsdf.inputs['Metallic'].default_value=metal if token!='brass' else .72
    if token=='glow':
        bsdf.inputs['Emission Color'].default_value=(*color,1)
        bsdf.inputs['Emission Strength'].default_value=.32
    mat['paletteToken']=token
    return mat


P={key:material(key) for key in COLORS}
P['linen']=material('paper','Paper woven linen',.98)
P['satin']=material('ink','Ink satin enamel',.22,.24)
P['rubber']=material('ink','Ink soft rubber',.95)
# Macro-facet assets use dedicated matte paints. Tone variants stay within the
# established hue and are assigned to physically different planes only.
FACET={}
for token in ['ink','teal','paper','slate','walnut','wood','brass','signal']:
    FACET[token]=[]
    factors=[.70,1.0,1.18] if token not in ['paper','signal'] else [.76,1.0,1.05]
    for label,factor in zip(['shadow','base','light'],factors):
        mat=P[token].copy();mat.name='Facet '+token+' '+label
        bsdf=mat.node_tree.nodes['Principled BSDF']
        color=P[token].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:]
        bsdf.inputs['Base Color'].default_value=(*[min(1,channel*factor) for channel in color[:3]],1)
        mat.diffuse_color=bsdf.inputs['Base Color'].default_value[:]
        bsdf.inputs['Roughness'].default_value=.91
        bsdf.inputs['Metallic'].default_value=0
        bsdf.inputs['Emission Strength'].default_value=0
        mat['paletteToken']=token;mat['toneFactor']=factor;mat['finish']='macro-facet matte'
        FACET[token].append(mat)
for i,factor in enumerate([.94,1.,1.045]):
    token='oak'+str(i)
    P[token]=material('wood','Oak tonal '+str(factor),.62+i*.035)
    bsdf=P[token].node_tree.nodes['Principled BSDF']
    color=bsdf.inputs['Base Color'].default_value[:]
    bsdf.inputs['Base Color'].default_value=(*[channel*factor for channel in color[:3]],1)

ROOMS={name:empty(name,(0,0,0)) for name in ['RoomDeveloper','RoomPiano','RoomBlog','RoomAI']}
META={'palette':'src/design/jo-colors.json','coordinates':'Three.js y-up; canonical room x/z in [0,5.6]',
      'derivedShades':'Vertex AO factors [0.48,1]. Oak lightness factors 0.94/1.00/1.045. Macro-facet matte materials use coherent shadow/base/light factors 0.70/1.00/1.18 (paper and signal 0.76/1.00/1.05), on physically different planes. No new hues.',
      'rooms':{},'dynamicObjects':[]}
DYNAMIC=set()
CURTAINS=[]


def dynamic(name):
    DYNAMIC.add(name);return name


def anchor(name,p,root):
    empty(name,p,root)
    META['rooms'].setdefault(root.name,{'anchors':{}})['anchors'][name]=list(p)


def facet_mesh(name,points,faces,token,root,tones=None,orient=True):
    """Closed convex planes with outward normals and no bevel or smoothing."""
    pts=[Vector(point) for point in points]
    center=sum(pts,Vector())/len(pts)
    corrected=[];chosen=[];planar_faces=[]
    for index,face in enumerate(faces):
        normal=(pts[face[1]]-pts[face[0]]).cross(pts[face[2]]-pts[face[0]])
        if normal.length:normal.normalize()
        deviation=max(abs(normal.dot(pts[i]-pts[face[0]])) for i in face)
        if len(face)>3 and deviation>.000001:
            planar_faces.extend((index,[face[0],face[j],face[j+1]]) for j in range(1,len(face)-1))
        else:planar_faces.append((index,face))
    illumination=Vector((-.55,.88,.40)).normalized()
    for index,face in planar_faces:
        face=list(face)
        normal=(pts[face[1]]-pts[face[0]]).cross(pts[face[2]]-pts[face[0]])
        mid=sum((pts[i] for i in face),Vector())/len(face)
        if orient and normal.dot(mid-center)<0:
            face.reverse();normal=-normal
        if normal.length:normal.normalize()
        dot=normal.dot(illumination)
        corrected.append(face)
        chosen.append(tones[index] if tones else (2 if dot>.55 else 0 if dot<-.35 else 1))
    obj=mesh(name,points,corrected,FACET[token][0],root,smooth=False)
    obj.data.materials.append(FACET[token][1]);obj.data.materials.append(FACET[token][2])
    for face,tone in zip(obj.data.polygons,chosen):face.material_index=tone
    return obj


def clipped_xy(width,height,cut):
    x,y=width/2,height/2
    return [(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),
            (x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)]


def tapered_shell(name,front,back,token,root,close_front=True):
    """Corresponding polygon rings; taper is structural, not a tiny bevel."""
    n=len(front);points=front+back
    faces=[tuple(range(n,2*n))[::-1]]
    if close_front:faces.append(tuple(range(n)))
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    return facet_mesh(name,points,faces,token,root)


def block_beam(name,a,b,width,depth,token,root):
    a,b=Vector(a),Vector(b);axis=(b-a).normalized()
    side=axis.cross(Vector((0,1,0)))
    if side.length<.01:side=Vector((1,0,0))
    side.normalize();up=axis.cross(side).normalized()
    points=[p+side*s*width/2+up*t*depth/2 for p in [a,b] for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    faces=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
    return facet_mesh(name,points,faces,token,root)


def octahedron(name,position,radii,token,root):
    p=Vector(position);x,y,z=radii
    points=[p+Vector(q) for q in [(x,0,0),(-x,0,0),(0,y,0),(0,-y,0),(0,0,z),(0,0,-z)]]
    faces=[(0,2,4),(4,2,1),(1,2,5),(5,2,0),(4,3,0),(1,3,4),(5,3,1),(0,3,5)]
    return facet_mesh(name,points,faces,token,root)


def ridged_seat(name,center,width,depth,bottom,edge,ridge,token,root):
    x,_,z=center
    ring=[(-.5,0),(-.30,-.5),(.30,-.5),(.5,0),(.30,.5),(-.30,.5)]
    points=[(x+a*width,y,z+b*depth) for y in [bottom,edge] for a,b in ring]
    points.extend([(x-width*.20,ridge,z),(x+width*.20,ridge,z)])
    faces=[(5,4,3,2,1,0)]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)]
    faces.extend([(7,8,13,12),(10,11,12,13),(8,9,13),(9,10,13),(11,6,12),(6,7,12)])
    return facet_mesh(name,points,faces,token,root)


def macro_stool(name,center,top,token,root):
    x,_,z=center;stool=empty(name,center,root)
    ridged_seat(name+'Crown',center,.80,.70,top-.18,top-.07,top,token,stool)
    for angle in [pi/6,5*pi/6,3*pi/2]:
        a=(x+cos(angle)*.20,top-.18,z+sin(angle)*.20)
        b=(x+cos(angle)*.32,.055,z+sin(angle)*.32)
        block_beam(name+'WedgeLeg',a,b,.105,.105,'walnut',stool)
    return stool


def architecture(root,wall_token,window=True):
    prefix=root.name.replace('Room','')
    # Each quarter occupies its own closed [0, 5.6] footprint. Neighbouring
    # plinths share an edge, never an overlapping top surface.
    box(prefix+'PetrolPlinth',(2.8,-.21,2.8),(5.60,.42,5.60),P['ink'],root,.085)
    box(prefix+'OakRim',(2.8,-.045,2.8),(5.58,.075,5.58),P['wood'],root,.018)
    # Inset end grain borders and staggered joined boards. The upper grids carry
    # actual baked contact shadows, while bevelled solids provide silhouettes.
    for i in range(14):
        x=.205+i*.399
        joints=[.025,1.41,2.81,4.21,5.575] if i%2==0 else [.025,.70,2.10,3.50,4.90,5.575]
        for j in range(len(joints)-1):
            a,b=joints[j:j+2];mid=(a+b)/2
            box(prefix+'OakBoard',(x,-.014,mid),(.396,.028,b-a-.004),P['wood'],root,.002,segments=1)
            grid(prefix+'OakBoardFace',(x,.001,mid),.393,b-a-.010,P['oak'+str((i+j*2)%3)],root,step=.18)
    # A wall is one 10 cm half of the shared partition, entirely in this
    # quadrant. The next rotated room owns the opposite half. Stop the back
    # slab at x=.10 so even this room's two slabs only meet, rather than overlap.
    box(prefix+'BackWall',(2.85,1.75,.05),(5.50,3.50,.10),P[wall_token],root,.018)
    grid(prefix+'BackPlaster',(2.85,1.76,.104),5.48,3.42,P[wall_token],root,axis='z',step=.20)
    if window:
        # A genuinely inset opening, broad jambs, sash, curved draped linen.
        box(prefix+'WindowBelow',(.05,.60,2.8),(.10,1.2,5.60),P[wall_token],root,.018)
        box(prefix+'WindowAbove',(.05,3.35,2.8),(.10,.30,5.60),P[wall_token],root,.018)
        box(prefix+'WindowRearPier',(.05,2.2,.62),(.10,2.0,1.24),P[wall_token],root,.018)
        box(prefix+'WindowFrontPier',(.05,2.2,4.70),(.10,2.0,1.80),P[wall_token],root,.018)
        grid(prefix+'LeftPlasterLower',(.104,.60,2.85),5.48,1.18,P[wall_token],root,axis='x')
        grid(prefix+'LeftPlasterRear',(.104,2.18,.67),1.10,1.94,P[wall_token],root,axis='x')
        grid(prefix+'LeftPlasterFront',(.104,2.18,4.70),1.78,1.94,P[wall_token],root,axis='x')
        box(prefix+'WindowRecess',(.020,2.19,2.52),(.024,1.98,2.62),P['slate'],root,.008)
        box(prefix+'WindowGlass',(.046,2.19,2.52),(.018,1.84,2.45),P['paper'],root,.008)
        for z in [1.235,3.805]:
            box(prefix+'WindowJamb',(.145,2.19,z),(.13,2.12,.13),P['paper'],root,.018)
        for y in [1.17,3.23]:
            box(prefix+'WindowHeader',(.145,y,2.52),(.13,.13,2.70),P['paper'],root,.018)
        box(prefix+'WindowSash',(.10,2.19,2.52),(.08,1.91,.065),P['wood'],root,.010)
        box(prefix+'WindowCrossbar',(.10,2.14,2.52),(.08,.06,2.47),P['wood'],root,.010)
        box(prefix+'DeepWindowSill',(.325,1.14,2.52),(.55,.13,2.91),P['wood'],root,.03)
        # Linen has actual folds and a drooped hem instead of bevelled rectangles.
        for side,pivot_z in [('left',1.24),('right',3.81)]:
            name=prefix+'Curtain'+side.title()
            curtain=empty(dynamic(name),(.29,3.16,pivot_z),root)
            curtain['curtainSide']=side
            curtain['curtainOpenWidth']=.48
            curtain['curtainClosedWidth']=1.283
            CURTAINS.append(curtain)
            points=[];nx,ny=12,3
            for j in range(ny+1):
                t=j/ny
                for i in range(nx+1):
                    s=i/nx
                    z=pivot_z+s*.48 if side=='left' else pivot_z-.48+s*.48
                    x=.29+sin(s*6*pi)*.055*(.6+t*.4)
                    y=3.16-t*(1.84+sin(s*pi)*.045)
                    points.append((x,y,z))
            faces=[]
            for j in range(ny):
                for i in range(nx):
                    k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
            # Extrude only on X. Unlike a normal-offset Solidify, this leaves
            # both Z hems exact when stretched to the central 4 mm seam.
            count=len(points);front_faces=list(faces)
            points.extend([(x-.008,y,z) for x,y,z in points[:count]])
            faces.extend(tuple(index+count for index in reversed(face)) for face in front_faces)
            boundary=[*range(nx+1),*[j*(nx+1)+nx for j in range(1,ny+1)],
                      *[ny*(nx+1)+i for i in range(nx-1,-1,-1)],
                      *[j*(nx+1) for j in range(ny-1,0,-1)]]
            for i,a in enumerate(boundary):
                b=boundary[(i+1)%len(boundary)];faces.append((a,a+count,b+count,b))
            mesh(name+'Cloth',points,faces,P['linen'],curtain,smooth=False)
        rod(prefix+'CurtainRail',(.23,3.27,1.1),(.23,3.27,3.98),.025,P['brass'],root,n=14)
        for z in [1.07,4.01]:ellipsoid(prefix+'RailFinial',(.23,3.27,z),(.044,.044,.044),P['brass'],root,n=12,rings=6)
    else:
        box(prefix+'LeftWall',(.05,1.75,2.8),(.10,3.50,5.60),P[wall_token],root,.018)
        grid(prefix+'LeftPlaster',(.104,1.76,2.85),5.48,3.42,P[wall_token],root,axis='x',step=.20)
    # Two-step baseboards and a continuous crown make wall thickness explicit.
    for y,h,w in [(.11,.22,.075),(.24,.045,.1),(3.45,.10,.13)]:
        inset=.104+w/2;start=.104+w;length=5.60-start;middle=(5.60+start)/2
        box(prefix+'BackMolding',(middle,y,inset),(length,h,w),P['chalk'],root,.012)
        box(prefix+'LeftMolding',(inset,y,middle),(w,h,length),P['chalk'],root,.012)
        box(prefix+'MoldingCorner',(inset,y,inset),(w,h,w),P['chalk'],root,.010)
    box(prefix+'CornerBead',(.135,1.75,.135),(.10,3.46,.10),P['chalk'],root,.022)


def plaque(name,title,subtitle,p,width,root,title_size=.108,subtitle_size=.053):
    x,y,z=p
    box(name+'Mount',(x,y,z),(width,.37,.07),P['walnut'],root,.025)
    box(name+'Face',(x,y,z+.043),(width-.06,.31,.027),P['brass'],root,.016)
    text(name+'Title',title,(x,y+.052,z+.061),title_size,P['ink'],root)
    text(name+'Subtitle',subtitle,(x,y-.082,z+.061),subtitle_size,P['ink'],root)


def leg(name,x,z,height,root):
    cyl(name,(x,height/2,z),.066,height,P['walnut'],root,n=16,top=.045)
    cyl(name+'Shoe',(x,.045,z),.071,.09,P['brass'],root,n=16)


def developer(root):
    architecture(root,'developerWall',False)
    # A real HTML resume is the main exhibit. The front aperture stays empty.
    resume=empty('ResumeBoard',(3.0,2.0,.22),root)
    box('ResumeBacking',(3.0,2.0,.125),(2.46,2.94,.10),P['paper'],resume,.022)
    for x in [1.81,4.19]:
        box('ResumeFrameSide',(x,2.0,.215),(.08,2.94,.07),P['walnut'],resume,.014)
    for y in [.57,3.43]:
        box('ResumeFrameRail',(3.0,y,.215),(2.46,.08,.07),P['walnut'],resume,.014)
    for x in [1.807,4.193]:
        box('ResumeBrassSide',(x,2.0,.255),(.018,2.79,.011),P['brass'],resume,.003)
    anchor('ResumeScreenAnchor',(3.0,2.0,.22),root)
    anchor('ResumeAnchor',(4.48,2.82,.28),root)
    META['resumeScreen']={'room':'RoomDeveloper','anchor':'ResumeScreenAnchor','width':2.30,'height':2.78,
                          'position':[3.0,2.0,.22],'normalCanonical':[0,0,1]}
    # A low archival bench sits below the paper, keeping the document dominant.
    box('ArchiveBenchTop',(3.0,.47,1.0),(3.70,.13,1.00),P['wood'],root,.035)
    box('ArchiveBenchApron',(3.0,.355,1.41),(3.38,.15,.10),P['walnut'],root,.014)
    for x in [1.40,4.60]:
        for z in [.69,1.31]:leg('ArchiveBenchLeg',x,z,.43,root)
    for i,(width,color) in enumerate([(.58,'teal'),(.63,'paper'),(.52,'slate')]):
        box('ArchiveBookCover',(1.49,.565+i*.082,1.02),(width,.058,.38),P[color],root,.009,yaw=.03*(i-1))
        box('ArchiveBookPages',(1.49,.577+i*.082,1.025),(width-.025,.020,.365),P['chalk'],root,.003,yaw=.03*(i-1))
    chick=empty('FirstBackendChick',(4.50,.54,1.03),root)
    ellipsoid('ChickBody',(4.50,.70,1.03),(.16,.17,.145),P['paper'],chick)
    ellipsoid('ChickHead',(4.50,.90,1.03),(.13,.13,.125),P['paper'],chick)
    for x in [4.446,4.554]:ellipsoid('ChickEye',(x,.925,1.14),(.014,.020,.011),P['ink'],chick)
    mesh('ChickBeak',[(4.46,.874,1.142),(4.54,.874,1.142),(4.50,.844,1.22)],[(0,1,2)],P['brass'],chick)
    for x in [4.40,4.60]:ellipsoid('ChickWing',(x,.71,1.03),(.055,.095,.085),P['chalk'],chick)
    # Landscape photo frame: the web fills this exact empty aperture with the
    # original external image. Backing and mount stay behind its x=.29 plane.
    portrait=empty('PortraitFrame',(.18,2.16,2.65),root)
    box('PortraitBacking',(.18,2.16,2.65),(.075,1.40,2.00),P['paper'],portrait,.009)
    for z in [1.675,3.625]:
        box('PortraitWalnutSide',(.265,2.16,z),(.080,1.28,.070),P['walnut'],portrait,.008)
    for y in [1.485,2.835]:
        box('PortraitWalnutRail',(.265,y,2.65),(.080,.070,2.02),P['walnut'],portrait,.008)
    for z in [1.73,3.57]:
        box('PortraitIvoryMountSide',(.292,2.16,z),(.010,1.28,.040),P['paper'],portrait,.002)
    for y in [1.54,2.78]:
        box('PortraitIvoryMountRail',(.292,y,2.65),(.010,.040,1.80),P['paper'],portrait,.002)
    anchor('PortraitScreenAnchor',(.29,2.16,2.65),root)
    bpy.data.objects['PortraitScreenAnchor'].rotation_euler.z=pi/2
    source=ROOT/'public/images/bbangjo-portrait.jpg'
    META['portrait']={'room':'RoomDeveloper','root':'PortraitFrame','anchor':'PortraitScreenAnchor',
        'positionCanonical':[.29,2.16,2.65],'rotationThree':[0,pi/2,0],'normalCanonical':[1,0,0],
        'width':1.80,'height':1.20,'outerWidth':2.02,'outerHeight':1.42,'frameFrontX':.305,
        'imageSource':'/images/bbangjo-portrait.jpg','sourcePixelSize':[4962,3308],
        'sourceImageBytes':source.stat().st_size,'sourceImageSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'imageEmbeddedInGLB':False,'authoringImage':'RenderOnlyPortrait','sourceColorProfile':'Display P3',
        'uvCorners':[[0,0],[1,0],[1,1],[0,1]],'mapping':'Full 3:2 original, no crop or horizontal/vertical flip; image-right maps to canonical -Z.'}
    macro_stool('ArchiveStool',(3.05,.57,2.89),.72,'teal',root)
    plant('ArchiveFloorPlant',(.63,.01,4.68),.76,P,root)


def blog(root):
    architecture(root,'blogWall',True)
    box('BlogDeskTop',(2.80,1.22,1.30),(3.50,.17,1.68),P['wood'],root,.11,segments=1)
    # Deliberately curved, thick pedestal supports rather than four box legs.
    for x in [1.39,4.21]:
        box('BlogDeskPedestal',(x,.59,1.35),(.24,1.18,1.25),P['walnut'],root,.10,segments=1)
        box('BlogDeskPedestalFoot',(x,.075,1.35),(.38,.15,1.43),P['ink'],root,.06)
    box('BlogDeskUnderrail',(2.8,1.055,.66),(2.80,.19,.14),P['walnut'],root,.025)
    monitor=empty('Monitor',(2.8,2.05,.82),root)
    # Deep polygon-cut monitor: eight broad housing facets and a true open ring.
    outer=[(2.8+x,2.05+y,.848) for x,y in clipped_xy(1.74,1.05,.10)]
    rear=[(2.8+x,2.00+y,.455) for x,y in clipped_xy(1.26,.80,.075)]
    tapered_shell('MonitorWedgeHousing',outer,rear,'ink',monitor,close_front=False)
    inner_offsets=[(-.70,-.42),(.70,-.42),(.70,-.42),(.70,.42),(.70,.42),(-.70,.42),(-.70,.42),(-.70,-.42)]
    inner=[(2.8+x,2.05+y,.848) for x,y in inner_offsets]
    ring_points=outer+inner
    ring_faces=[]
    for i in range(8):
        face=[i,(i+1)%8,8+(i+1)%8,8+i]
        unique=[]
        for index in face:
            if not unique or ring_points[index]!=ring_points[unique[-1]]:unique.append(index)
        if ring_points[unique[0]]==ring_points[unique[-1]]:unique.pop()
        ring_faces.append(tuple(unique))
    facet_mesh('MonitorAngularFaceRing',ring_points,ring_faces,'ink',monitor,
               tones=[0,1,1,1,2,2,1,0],orient=False)
    corners=[(-.70,-.42),(.70,-.42),(.70,.42),(-.70,.42)]
    pocket=[(2.8+x,2.05+y,z) for z in [.848,.775] for x,y in corners]
    facet_mesh('MonitorRecessWalls',pocket,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'ink',monitor,
               tones=[0,0,0,0],orient=False)
    # Broad slanted neck and a wedge foot replace the slender metallic stem.
    stand_points=[(2.55,1.33,.52),(3.05,1.33,.52),(3.05,1.33,.77),(2.55,1.33,.77),
                  (2.67,1.73,.48),(2.93,1.73,.48),(2.93,1.73,.66),(2.67,1.73,.66)]
    closed_box=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
    facet_mesh('MonitorTrapezoidNeck',stand_points,closed_box,'ink',monitor)
    foot_points=[(2.43,1.307,.40),(3.17,1.307,.40),(3.17,1.307,1.08),(2.43,1.307,1.08),
                 (2.51,1.435,.40),(3.09,1.435,.40),(3.12,1.345,1.03),(2.48,1.345,1.03)]
    facet_mesh('MonitorWedgeFoot',foot_points,closed_box,'ink',monitor)
    anchor('MonitorScreenAnchor',(2.8,2.05,.82),root)
    anchor('MonitorAnchor',(2.8,2.73,.84),root)
    META['monitorScreen']={'room':'RoomBlog','anchor':'MonitorScreenAnchor','width':1.4,'height':.84,'normalCanonical':[0,0,1]}
    box('BlogKeyboardBase',(2.67,1.34,1.57),(1.17,.06,.39),P['slate'],root,.034)
    for row in range(4):
        for col in range(13):
            if row==3 and 3<=col<=8:continue
            box('BlogKeyboardKey',(2.17+col*.083,1.386,1.432+row*.09),(.066,.033,.064),P['paper' if col else 'teal'],root,.008,segments=1)
    box('BlogKeyboardSpace',(2.63,1.386,1.702),(.48,.033,.064),P['paper'],root,.008,segments=1)
    box('BlogMouseMat',(3.66,1.318,1.58),(.46,.014,.54),P['muted'],root,.070)
    ellipsoid('BlogMouse',(3.66,1.385,1.58),(.094,.060,.15),P['paper'],root)
    # Three deliberately folded planes, a ridged hexagonal seat, and solid feet.
    chair=empty('BlogChair',(2.75,.68,3.00),root)
    cyl('BlogChairMat',(2.75,.017,3.02),1.12,.025,P['chalk'],root,n=64,bevel=.012)
    ridged_seat('ChairOrigamiSeat',(2.75,0,3.00),1.08,.94,.65,.77,.90,'teal',chair)
    panels=[[(2.43,.75,3.34),(3.07,.75,3.34),(3.07,1.47,3.51),(2.43,1.47,3.51)],
            [(2.16,.74,3.01),(2.43,.75,3.34),(2.43,1.47,3.51),(2.16,1.244,3.129)],
            [(3.07,.75,3.34),(3.34,.74,3.01),(3.34,1.244,3.129),(3.07,1.47,3.51)]]
    for i,panel in enumerate(panels):
        backing=[(x,y,z+.09) for x,y,z in panel]
        tapered_shell('ChairFoldedBackPanel'+str(i),backing,panel,'teal',chair)
    post=[(2.62,.18,2.87),(2.88,.18,2.87),(2.88,.18,3.13),(2.62,.18,3.13),
          (2.67,.67,2.92),(2.83,.67,2.92),(2.83,.67,3.08),(2.67,.67,3.08)]
    facet_mesh('ChairTaperedSupport',post,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'ink',chair)
    for dx,dz in [(-.42,-.42),(.42,-.42),(.42,.42),(-.42,.42)]:
        block_beam('ChairSplayedBlockFoot',(2.75,.25,3.00),(2.75+dx,.075,3.00+dz),.14,.11,'ink',chair)
    lamp=empty('BlogLamp',(4.20,1.36,1.12),root)
    cyl('BlogLampBase',(4.20,1.355,1.12),.20,.06,P['brass'],lamp,n=32)
    rod('BlogLampStem',(4.20,1.385,1.12),(4.20,2.02,1.12),.026,P['brass'],lamp)
    cyl('BlogLampShade',(4.20,2.07,1.12),.30,.39,P['linen'],lamp,n=32,top=.19,bevel=.016)
    cyl('BlogLampLight',(4.20,1.868,1.12),.271,.02,P['glow'],lamp,n=32,bevel=.004)
    anchor('BlogLampAnchor',(4.20,1.90,1.12),root)
    plant('BlogWindowPlant',(.67,.01,4.65),.83,P,root)


def ai(root):
    architecture(root,'aiWall',True)
    game=empty('GameConsole',(2.8,.96,2.15),root)
    box('GameConsoleCabinet',(2.8,.86,2.15),(2.91,.35,2.61),P['ink'],game,.08)
    box('GameConsoleRim',(2.8,1.022,2.15),(2.88,.075,2.58),P['walnut'],game,.035)
    box('GameConsoleDeck',(2.8,1.045,2.15),(2.66,.024,2.38),P['paper'],game,.035)
    for x in [1.62,3.98]:
        for z in [1.18,3.12]:
            rod('GameConsoleLeg',(x,.73,z),(x,.05,z),.07,P['walnut'],game,n=6)
            cyl('GameConsoleFoot',(x,.055,z),.079,.10,P['brass'],game,n=6)
    pads=[]
    for i,(x,z,color) in enumerate([(2.2,1.65,'teal'),(3.4,1.65,'brass'),(2.2,2.65,'slate'),(3.4,2.65,'sage')]):
        box('GamePadSocket'+str(i),(x,1.070,z),(1.04,.047,.86),P['ink'],game,.045)
        pad=empty(dynamic('GamePad'+str(i)),(x,1.10,z),game)
        pad['padIndex']=i;pad['pressAxisThree']='y';pad['restPosition']=[x,1.10,z]
        box('GamePadCap'+str(i),(x,1.122,z),(.95,.14,.77),P[color],pad,.055)
        # A number plus a geometric symbol gives both textual and shape cues.
        text('GamePadNumber'+str(i),str(i+1),(x-.20,1.200,z+.02),.24,P['ink' if i in [1,3] else 'paper'],pad,axis='y')
        symbol=P['ink' if i in [1,3] else 'paper'];sx=x+.20;sy=1.201
        if i==0:
            cyl('GamePadCircle',(sx,sy,z),.106,.008,symbol,pad,n=10,bevel=0)
        elif i==1:
            mesh('GamePadDiamond',[(sx-.125,sy,z),(sx,sy,z-.14),(sx+.125,sy,z),(sx,sy,z+.14)],[(3,2,1,0)],symbol,pad)
        elif i==2:
            mesh('GamePadTriangle',[(sx-.13,sy,z+.12),(sx+.13,sy,z+.12),(sx,sy,z-.13)],[(2,1,0)],symbol,pad)
        else:
            box('GamePadSquare',(sx,sy,z),(.20,.008,.20),symbol,pad,.006)
        pads.append({'name':'GamePad'+str(i),'index':i,'position':[x,1.10,z],'color':color,'shape':['circle','diamond','triangle','square'][i]})
    start=empty('GameStart',(2.8,1.10,3.18),game)
    cyl('GameStartButton',(2.8,1.112,3.18),.13,.06,P['ink'],start,n=8,bevel=.016)
    mesh('GameStartGlyph',[(2.765,1.148,3.235),(2.765,1.148,3.125),(2.850,1.148,3.18)],[(2,1,0)],P['paper'],start)
    anchor('GameAnchor',(2.8,1.85,2.20),root)
    META['memoryGame']={'room':'RoomAI','root':'GameConsole','start':'GameStart','anchor':'GameAnchor',
                        'pressAxis':'y','pressTravel':-.055,'pads':pads}
    # The leaderboard reader uses the Summary board's frame and open aperture.
    leaderboard=empty('LeaderboardBoard',(3.0,2.0,.22),root)
    box('LeaderboardBacking',(3.0,2.0,.125),(2.46,2.94,.10),P['paper'],leaderboard,.022)
    for x in [1.81,4.19]:
        box('LeaderboardFrameSide',(x,2.0,.215),(.08,2.94,.07),P['walnut'],leaderboard,.014)
    for y in [.57,3.43]:
        box('LeaderboardFrameRail',(3.0,y,.215),(2.46,.08,.07),P['walnut'],leaderboard,.014)
    for x in [1.807,4.193]:
        box('LeaderboardBrassSide',(x,2.0,.255),(.018,2.79,.011),P['brass'],leaderboard,.003)
    anchor('LeaderboardScreenAnchor',(3.0,2.0,.22),root)
    anchor('LeaderboardAnchor',(4.48,2.82,.28),root)
    META['leaderboardScreen']={'room':'RoomAI','root':'LeaderboardBoard','anchor':'LeaderboardScreenAnchor',
                               'interactionAnchor':'LeaderboardAnchor','width':2.30,'height':2.78,
                               'position':[3.0,2.0,.22],'normalCanonical':[0,0,1]}
    macro_stool('GameStool',(2.75,.55,4.02),.68,'slate',root)
    plant('GameWindowPlant',(.54,.01,4.70),.70,P,root)
    build_guide_robot(root)


def build_guide_robot(room):
    # Feet are the origin: the runtime can reparent this complete rig to any room.
    x,z=4.65,4.35
    robot=empty('Robot',(x,0,z),room)
    robot['guideRig']=True;robot['restOrigin']=[x,0,z];robot['forwardCanonical']=[0,0,1]
    # The tapered six-plane torso and deep cut-corner head are real silhouette
    # changes; no smoothly shaded primitive or cosmetic triangle overlay is used.
    body_profile=[(-.21,.14),(.21,.14),(.285,.48),(.20,.56),(-.20,.56),(-.285,.48)]
    front=[(x+dx,y,z+.18) for dx,y in body_profile]
    back=[(x+dx*.82,.35+(y-.35)*.92,z-.17) for dx,y in body_profile]
    tapered_shell('RobotTaperedTorso',front,back,'ink',robot)
    chest_front=[(x-.13,.235,z+.195),(x+.13,.235,z+.195),(x+.16,.425,z+.195),(x-.16,.425,z+.195)]
    chest_back=[(xx,yy,zz-.013) for xx,yy,zz in chest_front]
    tapered_shell('RobotTrapezoidChest',chest_front,chest_back,'paper',robot)
    octahedron('RobotChestButton',(x,.33,z+.219),(.047,.048,.020),'brass',robot)
    for sx in [x-.17,x+.17]:
        feet=[(sx-.085,0,z-.065),(sx+.085,0,z-.065),(sx+.115,0,z+.235),(sx-.115,0,z+.235),
              (sx-.072,.17,z-.065),(sx+.072,.17,z-.065),(sx+.110,.075,z+.235),(sx-.110,.075,z+.235)]
        facet_mesh('RobotWedgeShoe',feet,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'ink',robot)
        octahedron('RobotAngularAnkle',(sx,.157,z+.015),(.048,.053,.045),'brass',robot)
    head=empty(dynamic('RobotHead'),(x,.575,z),robot)
    block_beam('RobotNeckBlock',(x,.525,z),(x,.647,z),.115,.115,'brass',head)
    head_front=[(x+dx,.78+dy,z+.210) for dx,dy in clipped_xy(.68,.40,.09)]
    head_back=[(x+dx,.79+dy,z-.205) for dx,dy in clipped_xy(.44,.30,.06)]
    tapered_shell('RobotAngularHeadShell',head_front,head_back,'paper',head)
    visor_shape=[(-.262,0),(-.205,-.125),(.205,-.125),(.262,0),(.205,.125),(-.205,.125)]
    visor_front=[(x+dx,.790+dy,z+.235) for dx,dy in visor_shape]
    visor_back=[(xx,yy,zz-.016) for xx,yy,zz in visor_front]
    tapered_shell('RobotHexagonalVisor',visor_front,visor_back,'ink',head)
    for sx in [x-.12,x+.12]:
        eye_front=[(sx+dx,.815+dy,z+.247) for dx,dy in clipped_xy(.056,.083,.014)]
        eye_back=[(xx,yy,zz-.008) for xx,yy,zz in eye_front]
        tapered_shell('RobotPaleEye',eye_front,eye_back,'signal',head)
    smile=[(x-.055,.730,z+.246),(x-.048,.713,z+.246),(x,.703,z+.246),
           (x+.048,.713,z+.246),(x+.055,.730,z+.246),(x,.719,z+.246)]
    facet_mesh('RobotGentleSmile',smile,[tuple(range(6))],'brass',head,tones=[1],orient=False)
    block_beam('RobotAntenna',(x,.965,z-.015),(x,1.115,z-.015),.019,.019,'brass',head)
    octahedron('RobotAntennaTip',(x,1.12,z-.015),(.028,.030,.028),'teal',head)
    arm=empty(dynamic('RobotArm'),(x+.31,.475,z),robot)
    octahedron('RobotShoulder',(x+.31,.475,z),(.073,.073,.073),'brass',arm)
    block_beam('RobotForearm',(x+.328,.443,z),(x+.36,.287,z+.082),.080,.085,'paper',arm)
    octahedron('RobotHand',(x+.36,.250,z+.108),(.070,.071,.065),'ink',arm)
    octahedron('RobotLeftShoulder',(x-.31,.475,z),(.073,.073,.073),'brass',robot)
    block_beam('RobotLeftArm',(x-.328,.443,z),(x-.36,.287,z+.075),.080,.085,'paper',robot)
    octahedron('RobotLeftHand',(x-.36,.250,z+.09),(.070,.071,.065),'ink',robot)
    empty('RobotGuideAnchor',(x,1.27,z),robot)
    META['robot']={'root':'Robot','initialRoom':'RoomAI','origin':[x,0,z],'anchor':'RobotGuideAnchor',
                   'anchorLocal':[0,1.27,0],'head':'RobotHead','arm':'RobotArm',
                   'nominalBounds':{'width':.87,'height':1.15,'depth':.49},'forwardCanonical':[0,0,1]}
    bpy.context.view_layer.update()
    evaluated_graph=bpy.context.evaluated_depsgraph_get()
    lower=[float('inf')]*3;upper=[float('-inf')]*3
    for source in robot.children_recursive:
        if source.type!='MESH':continue
        evaluated=source.evaluated_get(evaluated_graph);data=evaluated.to_mesh()
        inverse=robot.matrix_world.inverted()
        for vertex in data.vertices:
            point=inverse@evaluated.matrix_world@vertex.co
            xyz=(point.x,point.z,-point.y)
            for axis in range(3):
                lower[axis]=min(lower[axis],xyz[axis]);upper[axis]=max(upper[axis],xyz[axis])
        evaluated.to_mesh_clear()
    META['robot']['boundsLocal']={'min':lower,'max':upper,'size':[b-a for a,b in zip(lower,upper)]}
    robot['boundsLocal']=[*lower,*upper]


developer(ROOMS['RoomDeveloper'])
architecture(ROOMS['RoomPiano'],'pianoWall',True)
# Acoustic felt panels are rhythm and depth, kept above the piano silhouette.
for i in range(6):
    x=1.38+i*.59
    box('PianoAcousticFrame',(x,2.78,.145),(.43,.84,.12),P['walnut'],ROOMS['RoomPiano'],.035)
    box('PianoAcousticFelt',(x,2.78,.218),(.35,.75,.043),P['slate' if i%2 else 'muted'],ROOMS['RoomPiano'],.035)
plant('PianoCornerPlant',(.60,.01,4.65),.82,P,ROOMS['RoomPiano'])
piano_metadata=build_piano(ROOMS['RoomPiano'],P)
seat_anchors={'PianoSeatAnchor':(2.8,.95,2.86),'PianoEyeAnchor':(2.8,1.78,2.98),'PianoLookAnchor':(2.8,1.22,1.72)}
for name,position in seat_anchors.items():anchor(name,position,ROOMS['RoomPiano'])
piano_metadata['seat']={'root':'PianoBench','anchors':{name:list(position) for name,position in seat_anchors.items()}}
META['piano']=piano_metadata
blog(ROOMS['RoomBlog'])
ai(ROOMS['RoomAI'])
for obj in bpy.context.scene.objects:
    if obj.name.startswith('PianoKey'):DYNAMIC.add(obj.name)

# The authoring scene keeps everything in canonical coordinates until all rooms
# are authored; then each entire quarter rotates around the shared wall origin.
for i,(name,room) in enumerate(ROOMS.items()):
    room.rotation_euler.z=i*pi/2
    META['rooms'].setdefault(name,{'anchors':{}}).update({'rotationY':i*pi/2,'canonicalBounds':{'min':[0,-.42,0],'max':[5.6,3.5,5.6]}})
bpy.context.view_layer.update()


def curtain_pose_bounds(closed=False):
    ratio=1.283/.48
    for curtain in CURTAINS:curtain.scale=(.72,ratio,1) if closed else (1,1,1)
    bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get();result={}
    for curtain in CURTAINS:
        room=curtain.parent;lower=[float('inf')]*3;upper=[float('-inf')]*3
        local_lower=[float('inf')]*3;local_upper=[float('-inf')]*3
        for source in curtain.children_recursive:
            if source.type!='MESH':continue
            evaluated=source.evaluated_get(graph);data=evaluated.to_mesh()
            to_room=room.matrix_world.inverted()@evaluated.matrix_world
            to_local=curtain.matrix_world.inverted()@evaluated.matrix_world
            for vertex in data.vertices:
                for transform,minimum,maximum in [(to_room,lower,upper),(to_local,local_lower,local_upper)]:
                    p=transform@vertex.co;xyz=(p.x,p.z,-p.y)
                    for axis in range(3):minimum[axis]=min(minimum[axis],xyz[axis]);maximum[axis]=max(maximum[axis],xyz[axis])
            evaluated.to_mesh_clear()
        result[curtain.name]={'canonical':{'min':lower,'max':upper},'meshLocal':{'min':local_lower,'max':local_upper}}
    return result


curtain_open=curtain_pose_bounds(False);curtain_closed=curtain_pose_bounds(True)
curtain_pose_bounds(False)
curtain_validation={};curtain_nodes={}
for curtain in CURTAINS:
    side=curtain['curtainSide'];name=curtain.name;opened=curtain_open[name];closed=curtain_closed[name]
    expected=(0,.48) if side=='left' else (-.48,0)
    assert abs(opened['meshLocal']['min'][2]-expected[0])<.00001
    assert abs(opened['meshLocal']['max'][2]-expected[1])<.00001
    assert abs(closed['canonical']['max'][2]-closed['canonical']['min'][2]-1.283)<.00001
    assert opened['canonical']['min'][0]>.21 and closed['canonical']['min'][0]>.21
    pivot=curtain.location
    curtain_nodes[name]={'room':curtain.parent.name,'side':side,'pivotCanonical':[pivot.x,pivot.z,-pivot.y],
                         'openBounds':opened,'closedBounds':closed,
                         'jambClearanceOpen':opened['canonical']['min'][0]-.21,
                         'jambClearanceClosed':closed['canonical']['min'][0]-.21}
for prefix in ['Piano','Blog','AI']:
    gap=curtain_closed[prefix+'CurtainRight']['canonical']['min'][2]-curtain_closed[prefix+'CurtainLeft']['canonical']['max'][2]
    assert abs(gap-.004)<.00001
    curtain_validation[prefix]={'closedCenterSeam':gap,'jambCrossing':False}
META['curtains']={'defaultPose':'open','openWidth':.48,'closedWidth':1.283,
                  'closedScaleThree':[.72,1,1.283/.48],'nodes':curtain_nodes,'validation':curtain_validation,
                  'previews':['assets/four-rooms-curtain-open.png','assets/four-rooms-curtain-closed.png']}
if CURTAIN_BASELINE:
    current=noncurtain_geometry_fingerprints()
    missing=sorted(CURTAIN_BASELINE.keys()-current.keys());added=sorted(current.keys()-CURTAIN_BASELINE.keys())
    changed=sorted(name for name in current.keys()&CURTAIN_BASELINE.keys() if current[name]!=CURTAIN_BASELINE[name])
    assert not missing and not added and not changed, {'missing':missing,'added':added,'changed':changed}
    META['curtains']['nonCurtainGeometryVerification']={'unchanged':True,'checkedMeshes':len(current),
        'method':'SHA256 of world-space vertices, flat normals, polygon topology and PBR material values rounded to 1e-6; AO compared separately.'}
    print('NON_CURTAIN_GEOMETRY_UNCHANGED '+str(len(current)),flush=True)
if PORTRAIT_BASELINE:
    current={name:value for name,value in noncurtain_geometry_fingerprints().items() if not name.startswith(('ArchiveFolio','Portrait'))}
    missing=sorted(PORTRAIT_BASELINE.keys()-current.keys());added=sorted(current.keys()-PORTRAIT_BASELINE.keys())
    changed=sorted(name for name in current.keys()&PORTRAIT_BASELINE.keys() if current[name]!=PORTRAIT_BASELINE[name])
    assert not missing and not added and not changed, {'missing':missing,'added':added,'changed':changed}
    META['portrait']['preservation']={'nonPortraitNonCurtainMeshesUnchanged':len(current),
        'method':'SHA256 of world-space vertices, normals, topology and PBR values; only ArchiveFolio is replaced.'}
    print('NON_PORTRAIT_GEOMETRY_UNCHANGED '+str(len(current)),flush=True)


def top_room(obj):
    while obj.parent:
        obj=obj.parent
    return obj if obj.name in ROOMS else None


def owner(obj):
    current=obj
    while current:
        if current.name in DYNAMIC:return current
        if current.name in ['Monitor','ResumeBoard','LeaderboardBoard','PortraitFrame','GameConsole','GameStart','Robot','BlogLamp','Piano','PianoBench','BlogChair','ArchiveStool','GameStool']:
            return current
        current=current.parent
    return top_room(obj)


FOCUS_GROUPS=['Piano','PianoBench','Monitor','BlogChair','ArchiveStool','GameStool','Robot']


def collect_focus_statistics():
    statistics={};graph=bpy.context.evaluated_depsgraph_get()
    for name in FOCUS_GROUPS:
        root=bpy.data.objects.get(name)
        if root is None:continue
        lower=[float('inf')]*3;upper=[float('-inf')]*3
        triangles=faces=large_faces=smooth=objects=0;roughness=[];metallic=[]
        for source in [root,*root.children_recursive]:
            if source.type!='MESH':continue
            objects+=1;evaluated=source.evaluated_get(graph);data=evaluated.to_mesh();data.calc_loop_triangles()
            triangles+=len(data.loop_triangles);faces+=len(data.polygons)
            large_faces+=sum(face.area>=.025 for face in data.polygons)
            smooth+=sum(face.use_smooth for face in data.polygons)
            transform=root.matrix_world.inverted()@evaluated.matrix_world
            for vertex in data.vertices:
                point=transform@vertex.co;xyz=(point.x,point.z,-point.y)
                for axis in range(3):lower[axis]=min(lower[axis],xyz[axis]);upper[axis]=max(upper[axis],xyz[axis])
            for mat in data.materials:
                bsdf=mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
                if bsdf:
                    roughness.append(bsdf.inputs['Roughness'].default_value)
                    metallic.append(bsdf.inputs['Metallic'].default_value)
            evaluated.to_mesh_clear()
        statistics[name]={'sourceMeshes':objects,'triangles':triangles,'polygons':faces,
                          'planesAtLeast025SquareMetres':large_faces,'smoothFaces':smooth,
                          'roughnessRange':[min(roughness),max(roughness)] if roughness else [],
                          'metallicRange':[min(metallic),max(metallic)] if metallic else [],
                          'boundsLocal':{'min':lower,'max':upper,'size':[b-a for a,b in zip(lower,upper)]}}
    return statistics


def export_web():
    """Merge only compatible static meshes; retain addressable moving pivots."""
    originals=[o for o in bpy.context.scene.objects if top_room(o) and not o.name.startswith('RenderOnly')]
    depsgraph=bpy.context.evaluated_depsgraph_get()
    batches={}; original_count=0
    canonical_bounds={name:{'min':[float('inf')]*3,'max':[float('-inf')]*3} for name in ROOMS}
    for obj in originals:
        if obj.type!='MESH':continue
        original_count+=1
        evaluated=obj.evaluated_get(depsgraph);data=evaluated.to_mesh()
        room=top_room(obj);bounds=canonical_bounds[room.name]
        to_canonical=room.matrix_world.inverted()@evaluated.matrix_world
        for vertex in data.vertices:
            point=to_canonical@vertex.co;xyz=(point.x,point.z,-point.y)
            for axis in range(3):
                bounds['min'][axis]=min(bounds['min'][axis],xyz[axis])
                bounds['max'][axis]=max(bounds['max'][axis],xyz[axis])
        root=owner(obj); transform=root.matrix_world.inverted()@evaluated.matrix_world
        for mi,mat in enumerate(data.materials):
            faces=[p for p in data.polygons if p.material_index==mi]
            if not faces:continue
            key=(root.name,mat.name)
            if key not in batches:batches[key]={'root':root,'material':mat,'vertices':[],'faces':[],'smooth':[],'normals':[]}
            batch=batches[key];offset=len(batch['vertices'])
            batch['vertices'].extend(transform@vertex.co for vertex in data.vertices)
            batch['faces'].extend(tuple(offset+index for index in face.vertices) for face in faces)
            batch['smooth'].extend(face.use_smooth for face in faces)
            normal_transform=transform.to_3x3().inverted().transposed()
            batch['normals'].extend((normal_transform@data.corner_normals[li].vector).normalized() for face in faces for li in face.loop_indices)
        evaluated.to_mesh_clear()
    for name,bounds in canonical_bounds.items():
        assert bounds['min'][0]>=-.0001 and bounds['min'][2]>=-.0001, (name,bounds)
        assert bounds['max'][0]<=5.6001 and bounds['max'][2]<=5.6001, (name,bounds)
        META['rooms'][name]['exactCanonicalBounds']=bounds
    META['sharedPartitions']={'halfWallInterval':[0,.10],'interiorPlasterOffset':.104,
                              'plinthFootprint':[0,5.6,0,5.6],
                              'windowRecessDepthInterval':[.008,.032],'windowGlassDepthInterval':[.037,.055],
                              'visibility':'All four room roots may remain visible simultaneously; each mesh stays within its own quadrant.'}
    copies=[]
    # Named dynamic meshes become exact-name Empty pivots in the export, with
    # baked geometry below. The original editable scene is restored afterwards.
    replacement={}
    for name in DYNAMIC:
        obj=bpy.data.objects.get(name)
        if obj and obj.type=='MESH':
            obj.name=name+'__authoring'
            pivot=empty(name,(0,0,0));pivot.matrix_world=obj.matrix_world.copy()
            parent(pivot,obj.parent)
            replacement[name]=(obj,pivot)
    for (name,matname),batch in batches.items():
        data=bpy.data.meshes.new(name+'_'+matname+'_Web')
        data.from_pydata(batch['vertices'],[],batch['faces']);data.materials.append(batch['material']);data.update()
        for polygon,smooth in zip(data.polygons,batch['smooth']):polygon.use_smooth=smooth
        data.normals_split_custom_set(batch['normals'])
        obj=bpy.data.objects.new(name+'_'+matname+'_Baked',data);bpy.context.collection.objects.link(obj)
        root=replacement[name][1] if name in replacement else batch['root']
        obj.parent=root;copies.append(obj)
    bpy.context.view_layer.update()
    # World-space BVHs per isolated room, independent of final yaw and camera.
    # Hemisphere rays bake near-field occlusion into exported COLOR_0. Floor and
    # wall grids give enough sample points for gradients beneath real objects.
    ao_stats={}
    for room in ROOMS.values():
        objects=[o for o in copies if top_room(o)==room]
        verts=[];faces=[]
        for obj in objects:
            offset=len(verts);verts.extend(obj.matrix_world@vertex.co for vertex in obj.data.vertices)
            faces.extend(tuple(offset+i for i in face.vertices) for face in obj.data.polygons)
        tree=BVHTree.FromPolygons(verts,faces,all_triangles=False,epsilon=.0001)
        cache={};samples=16
        hemisphere=[Vector((sqrt(1-((i+.5)/samples)**2)*cos(i*2.39996),sqrt(1-((i+.5)/samples)**2)*sin(i*2.39996),(i+.5)/samples)) for i in range(samples)]
        for obj in objects:
            data=obj.data
            attr=data.color_attributes.new(name='BakedContactAO',type='FLOAT_COLOR',domain='CORNER')
            data.color_attributes.active_color=attr
            normalmat=obj.matrix_world.to_3x3().inverted().transposed()
            for polygon in data.polygons:
                for li in polygon.loop_indices:
                    vi=data.loops[li].vertex_index
                    wp=obj.matrix_world@data.vertices[vi].co
                    normal=(normalmat@data.corner_normals[li].vector).normalized()
                    key=tuple(round(q,3) for q in wp)+tuple(round(q,2) for q in normal)
                    if key not in cache:
                        tangent=normal.cross(Vector((0,0,1)))
                        if tangent.length<.01:tangent=normal.cross(Vector((0,1,0)))
                        tangent.normalize();bitangent=normal.cross(tangent)
                        origin=wp+normal*.006
                        occlusion=0.
                        for h in hemisphere:
                            direction=tangent*h.x+bitangent*h.y+normal*h.z
                            location,hitnormal,index,distance=tree.ray_cast(origin,direction,1.15)
                            if location is not None:occlusion+=.45+.55*(1-distance/1.15)
                        minimum=.62 if obj.data.materials[0].get('paletteToken')=='brass' else .48
                        value=1-(1-minimum)*occlusion/samples
                        cache[key]=value
                    value=cache[key]
                    attr.data[li].color=(value,value,value,1)
        ao_stats[room.name]={'uniqueSamples':len(cache),'meshes':len(objects)}
        print('AO_ROOM '+room.name+' '+json.dumps(ao_stats[room.name]),flush=True)
    bpy.ops.object.select_all(action='DESELECT')
    keep=[o for o in originals if o.type=='EMPTY']+[pair[1] for pair in replacement.values()]+copies
    for obj in keep:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,export_apply=True,
                              export_yup=True,export_lights=False,export_cameras=False,export_extras=True,
                              export_vertex_color='ACTIVE',export_all_vertex_colors=False,
                              export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14,export_draco_normal_quantization=10,
                              export_draco_color_quantization=8)
    META['compression']='KHR_draco_mesh_compression; existing /draco/ decoder'
    triangles=0
    for obj in copies:
        obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    META.update({'asset':'/Room/four-rooms.glb','source':'assets/four-rooms.blend','fileBytes':GLB.stat().st_size,
                 'triangles':triangles,'exportMeshes':len(copies),'sourceMeshes':original_count,
                 'geometryStyle':'Macro-facet piano, monitor, seats and robot use tapered solids, raised ridges and explicitly planar surfaces with dedicated rough matte paints. Unrelated architectural and room furnishings are retained.',
                 'ambientOcclusion':{'method':'16 deterministic hemisphere rays per vertex normal, room geometry BVH, 1.15 m radius, COLOR_0 multiplier','rooms':ao_stats},
                 'dynamicObjects':sorted(DYNAMIC)})
    for obj in copies:
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(data)
    for name,(original,pivot) in replacement.items():
        bpy.data.objects.remove(pivot,do_unlink=True);original.name=name
    return originals


META['focusGroups']=collect_focus_statistics()
originals=export_web()
(ASSETS/'four-rooms-manifest.json').write_text(json.dumps(META,indent=2,default=str)+'\n')


def add_authoring_portrait():
    """A packed, original-image preview for Blender only; never exported to GLB."""
    image=bpy.data.images.load(str(ROOT/'public/images/bbangjo-portrait.jpg'),check_existing=True)
    image.name='BbangjoPortraitOriginal'
    assert tuple(image.size)==(4962,3308) and abs(image.size[0]/image.size[1]-1.5)<.000001
    # Match the original JPEG's embedded Display P3 ICC profile; do not grade,
    # resize, mirror or crop the photo, and do not let room lights tint it.
    image.colorspace_settings.name='Display P3'
    image.pack()
    image.filepath='//../public/images/bbangjo-portrait.jpg'
    mat=bpy.data.materials.new('RenderOnlyPortraitMaterial');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear()
    texture=nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Linear';texture.extension='EXTEND'
    coordinates=nodes.new('ShaderNodeTexCoord')
    emission=nodes.new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1
    output=nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(coordinates.outputs['UV'],texture.inputs['Vector'])
    mat.node_tree.links.new(texture.outputs['Color'],emission.inputs['Color'])
    mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
    nodes.active=texture
    data=bpy.data.meshes.new('RenderOnlyPortraitGeometry')
    points=[(-.90,-.60,0),(.90,-.60,0),(.90,.60,0),(-.90,.60,0)]
    data.from_pydata([v(point) for point in points],[],[(0,1,2,3)]);data.materials.append(mat);data.update()
    uv=data.uv_layers.new(name='PortraitOriginalUV')
    corners=[(0,0),(1,0),(1,1),(0,1)]
    for loop in data.loops:uv.data[loop.index].uv=corners[loop.vertex_index]
    obj=bpy.data.objects.new('RenderOnlyPortrait',data);bpy.context.collection.objects.link(obj)
    obj.parent=bpy.data.objects['PortraitScreenAnchor']
    obj['excludeFromWebExport']=True;obj['sourceImageSha256']=META['portrait']['sourceImageSha256']
    bpy.context.view_layer.update()
    normal=(obj.matrix_world.to_3x3()@data.polygons[0].normal).normalized()
    assert normal.dot(Vector((1,0,0)))>.99999
    return obj


# Include the render-only image in the same room visibility filters, while the
# GLB above remains geometry-only and its export function explicitly excludes it.
originals.append(add_authoring_portrait())

# Authoring render setup: same room-relative key/fill for four standalone views.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU'
scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.70,.77,.75,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.30
scene.view_settings.view_transform='AgX'
ground=box('RenderOnlyGround',(0,-.48,0),(200,.10,200),P['paper'],bevel=0)
light_objects=[]
for name,position,energy,size,color in [('Key',(-2,8,7),950,7,(1,.91,.76)),('Fill',(8,7,3),600,8,(.83,.94,1)),('Window',(-3,4,2),450,5,(1,1,.9))]:
    data=bpy.data.lights.new('RenderOnly'+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new('RenderOnly'+name,data);scene.collection.objects.link(obj);light_objects.append((obj,position))
camera_data=bpy.data.cameras.new('FourRoomPreviewCamera');camera=bpy.data.objects.new('FourRoomPreviewCamera',camera_data)
scene.collection.objects.link(camera);scene.camera=camera;camera_data.type='ORTHO';camera_data.ortho_scale=9.20
for name,room in ROOMS.items():
    for obj in originals:
        obj.hide_render=top_room(obj)!=room
    angle=META['rooms'][name]['rotationY']
    def rotate(p):return (p[0]*cos(angle)+p[2]*sin(angle),p[1],-p[0]*sin(angle)+p[2]*cos(angle))
    target=v(rotate((2.65,1.45,2.65)))
    camera.location=v(rotate((11.5,9.2,11.5)))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    for light,position in light_objects:
        light.location=v(rotate(position));light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(ASSETS/('four-rooms-'+name.replace('Room','').lower()+'.png'))
    if ('--portrait-preview' in sys.argv and name=='RoomDeveloper') or ('--skip-previews' not in sys.argv and ('--piano-preview-only' not in sys.argv or name=='RoomPiano')):
        bpy.ops.render.render(write_still=True)
for obj in originals:obj.hide_render=False
# Final authoring view shows the complete house with all four roots present.
# This catches cross-wall and shared-floor overlap that isolated renders cannot.
scene.render.resolution_x=1800;scene.render.resolution_y=1500
camera_data.ortho_scale=17.6
camera.location=v((12,22,16));house_target=v((0,1.0,0))
camera.rotation_euler=(house_target-camera.location).to_track_quat('-Z','Y').to_euler()
for (light,_),position,energy in zip(light_objects,[(-8,14,10),(9,11,-8),(0,14,0)],[1800,1300,900]):
    light.location=v(position);light.data.energy=energy;light.data.size=10
    light.rotation_euler=(house_target-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(ASSETS/'four-rooms-whole-house.png')
if '--skip-previews' not in sys.argv:
    bpy.ops.render.render(write_still=True)
# Keep millimetre-separated floor/plaster AO surfaces stable in the authoring
# viewport. The editable file opens on the complete-house camera, not a stale
# factory viewport with a needlessly wide depth range.
camera_data.clip_start=.2;camera_data.clip_end=250
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type!='VIEW_3D':continue
            space.clip_start=.2;space.clip_end=250
            space.shading.color_type='TEXTURE'
            if space.region_3d:
                space.region_3d.view_perspective='CAMERA'
                space.region_3d.view_camera_offset=(0,0)
                space.region_3d.view_camera_zoom=0
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'four-rooms.blend'))


def render_focus_views(suffix=''):
    """Same Blender studio angles for the before/after asset comparisons."""
    current=bpy.context.scene;current.render.engine='CYCLES';current.cycles.device='CPU'
    current.cycles.samples=24;current.cycles.use_denoising=True
    current.render.resolution_x=1200;current.render.resolution_y=1200;current.render.resolution_percentage=100
    current.render.image_settings.file_format='PNG'
    descriptions=[
        ('piano','RoomPiano',['Piano','PianoBench'],(2.8,1.22,1.75),(8.8,5.0,9.6),4.65,0),
        ('monitor','RoomBlog',['Monitor'],(2.8,1.96,.69),(6.6,4.75,6.3),2.35,1.30),
        ('chair','RoomBlog',['BlogChair'],(2.75,.79,3.13),(6.1,3.25,7.5),2.10,0),
        ('robot','RoomAI',['Robot'],(4.65,.60,4.35),(7.7,2.65,8.7),1.53,0),
    ]
    for label,room_name,names,look,eye,scale,floor_y in descriptions:
        if '--piano-preview-only' in sys.argv and label != 'piano':
            continue
        room=bpy.data.objects[room_name];wanted=set()
        for name in names:
            root=bpy.data.objects.get(name)
            if root:wanted.update([root,*root.children_recursive])
        for obj in current.objects:
            if obj.type=='MESH':obj.hide_render=obj not in wanted and obj.name!='RenderOnlyGround'
            elif obj.type=='EMPTY':obj.hide_render=False
        ground=bpy.data.objects.get('RenderOnlyGround')
        if ground:ground.location=v((0,floor_y-.06,0))
        target=room.matrix_world@v(look)
        camera=current.camera;camera.data.type='ORTHO';camera.data.ortho_scale=scale
        camera.location=room.matrix_world@v(eye)
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        for light_name,offset,energy,size in [('RenderOnlyKey',(-3,5,4),650,5),('RenderOnlyFill',(4,3,2),280,5),('RenderOnlyWindow',(-2,4,-3),180,4)]:
            light=bpy.data.objects.get(light_name)
            if light:
                light.location=room.matrix_world@v(tuple(a+b for a,b in zip(look,offset)))
                light.data.energy=energy;light.data.size=size
                light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
        current.render.filepath=str(ASSETS/('four-rooms-focus-'+label+suffix+'.png'))
        bpy.ops.render.render(write_still=True)


def render_curtain_previews():
    """Inspect the same real window open/closed without changing saved defaults."""
    current=bpy.context.scene;room=ROOMS['RoomBlog'];camera=current.camera
    previous_camera=camera.matrix_world.copy();previous_scale=camera.data.ortho_scale
    previous_render=(current.render.resolution_x,current.render.resolution_y,current.render.filepath,current.cycles.samples)
    previous_hidden={obj:obj.hide_render for obj in current.objects}
    previous_lights=[(light,light.matrix_world.copy(),light.data.energy,light.data.size) for light,_ in light_objects]
    try:
        for obj in originals:obj.hide_render=top_room(obj)!=room
        target=room.matrix_world@v((.22,2.17,2.52))
        camera.location=room.matrix_world@v((6.0,3.10,3.60))
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.ortho_scale=3.55
        current.render.resolution_x=1400;current.render.resolution_y=1100;current.cycles.samples=24
        for (light,_),position,energy in zip(light_objects,[(4.5,6,2),(4,3,5),(3,4,-1)],[650,280,160]):
            light.location=room.matrix_world@v(position);light.data.energy=energy;light.data.size=5
            light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
        for closed,label in [(False,'open'),(True,'closed')]:
            curtain_pose_bounds(closed)
            current.render.filepath=str(ASSETS/('four-rooms-curtain-'+label+'.png'))
            bpy.ops.render.render(write_still=True)
    finally:
        curtain_pose_bounds(False)
        camera.matrix_world=previous_camera;camera.data.ortho_scale=previous_scale
        current.render.resolution_x,current.render.resolution_y,current.render.filepath,current.cycles.samples=previous_render
        for obj,hidden in previous_hidden.items():obj.hide_render=hidden
        for light,transform,energy,size in previous_lights:
            light.matrix_world=transform;light.data.energy=energy;light.data.size=size
    # The .blend was saved before these temporary poses, with all six panels open.
    (ASSETS/'four-rooms-curtain-validation.json').write_text(json.dumps(META['curtains'],indent=2)+'\n')


if '--curtain-previews' in sys.argv:
    render_curtain_previews()


if '--skip-previews' not in sys.argv:
    render_focus_views()
    archive=ASSETS/'archive/four-rooms-pre-macrofacets.blend'
    if archive.exists():
        # The new editable scene is already saved. The archived scene is opened
        # only in this headless process and is never saved or overwritten.
        bpy.ops.wm.open_mainfile(filepath=str(archive))
        before_statistics=collect_focus_statistics()
        render_focus_views('-before')
        comparison={'before':before_statistics,'after':META['focusGroups']}
        (ASSETS/'four-rooms-focus-statistics.json').write_text(json.dumps(comparison,indent=2)+'\n')
print('FOUR_ROOM_METRICS '+json.dumps({k:META[k] for k in ['fileBytes','triangles','exportMeshes','sourceMeshes']}),flush=True)
