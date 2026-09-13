"""Antique timber-and-iron detail layer; retains every interactive room anchor.

All coordinates below are canonical Three.js X / up Y / Z, before room yaw.
The caller supplies geometry helpers so this layer shares its batched ink mesh.
"""
from math import sin, cos, pi
import bpy
from mathutils import Vector


def build_medieval_rooms(api):
    rooms=api['rooms'];paper=api['paper'];ink=api['ink']
    newbox=api['newbox'];cylinder=api['cylinder'];mesh=api['mesh'];empty=api['empty'];v=api['v']
    stroke=api['stroke'];hatch=api['hatch_rect'];rng=api['rng'];added=api['added']
    atlas_mode=bool(api.get('atlas_mode'))
    torch_markers={};window_markers=[];stone_count=0

    def xyz(p):return Vector((p.x,p.z,-p.y))

    def line(points,root,width=.0028,closed=False):
        if closed:points=[*points,points[0]]
        inverse=root.matrix_world.inverted()
        stroke([xyz(inverse@v(p)) for p in points],root,width)

    def circle(p,rx,ry,root,plane='z',width=.003,steps=20):
        x,y,z=p
        points=[]
        for i in range(steps):
            a=i*2*pi/steps
            points.append((x+rx*cos(a),y+ry*sin(a),z) if plane=='z' else
                          (x,y+ry*sin(a),z+rx*cos(a)) if plane=='x' else
                          (x+rx*cos(a),y,z+ry*sin(a)))
        line(points,root,width,True)

    def part(name,p,d,root,dark=False,bevel=.01):
        obj=newbox('Medieval_'+name,p,d,root,bevel)
        if dark:
            for i in range(len(obj.data.materials)):obj.data.materials[i]=ink
        return obj

    def poly(name,points,faces,root,dark=False):
        obj=mesh('InkDetail_Medieval_'+name,points,faces,ink if dark else paper,root)
        obj['penInkAuthored']=True
        current=root
        while current.parent:current=current.parent
        added[current.name].append(obj.name)
        return obj

    def timber(name,a,b,width,depth,root):
        a,b=Vector(a),Vector(b);direction=(b-a).normalized()
        side=direction.cross(Vector((0,0,1)))
        if side.length<.01:side=Vector((1,0,0))
        side.normalize();up=direction.cross(side).normalized()
        points=[center+side*ss*width/2+up*tt*depth/2 for center in [a,b] for ss,tt in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        faces=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        obj=poly('Timber_'+name,points,faces,root)
        obj['medievalWood']=True
        return obj

    def tube(name,a,b,radius,root,dark=False,segments=12):
        a,b=Vector(a),Vector(b);direction=(b-a).normalized()
        side=direction.cross(Vector((0,1,0)))
        if side.length<.01:side=Vector((1,0,0))
        side.normalize();up=direction.cross(side).normalized()
        points=[p+radius*(side*cos(i*2*pi/segments)+up*sin(i*2*pi/segments)) for p in [a,b] for i in range(segments)]
        faces=[tuple(reversed(range(segments))),tuple(range(segments,segments*2))]
        faces += [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
        return poly(name,points,faces,root,dark)

    def rosette(p,r,root,plane='z'):
        x,y,z=p
        points=[]
        for i in range(49):
            a=i*2*pi/48;rr=r*(.76+.22*cos(4*a))
            points.append((x+rr*cos(a),y+rr*sin(a),z) if plane=='z' else (x,y+rr*sin(a),z+rr*cos(a)))
        line(points,root,.0023)
        circle(p,r*.30,r*.30,root,plane,.002)

    def quill(name,p,root):
        x,y,z=p
        cylinder('Medieval_'+name+'Inkwell',(x,y+.06,z),.083,.12,root,top=.066,n=16,mat=ink)
        start=Vector((x,y+.10,z));tip=start+Vector((.17,.50,-.035))
        line([start,tip],root,.003)
        side=Vector((.065,-.022,.0));points=[]
        for j in range(8):
            t=j/7;center=start.lerp(tip,t);spread=sin(t*pi)*side
            points.extend([center-spread,center+spread])
        faces=[(j*2,j*2+1,j*2+3,j*2+2) for j in range(7)]
        feather=poly(name+'Feather',points,faces,root);feather['skipInkEdges']=True
        line([points[j*2] for j in range(8)]+[points[j*2+1] for j in reversed(range(8))],root,.0023,True)
        for j in range(1,7):line([points[j*2],start.lerp(tip,(j+.35)/7),points[j*2+1]],root,.0016)

    def scroll(name,p,root,width=.80,depth=.38):
        x,y,z=p
        part(name+'Sheet',(x,y,z),(width,.012,depth),root,bevel=.002)
        for xx in [x-width/2,x+width/2]:
            tube(name+'CurledRoll',(xx,y+.05,z-depth/2-.025),(xx,y+.05,z+depth/2+.025),.053,root)
            circle((xx,y+.05,z+depth/2+.029),.040,.04,root,width=.0025)
        for j in range(5):
            zz=z-depth*.35+j*depth*.14
            line([(x-width*.32,y+.008,zz),(x+width*(.13+.13*(j%2)),y+.008,zz)],root,.0018)
        # Ink seal at lower corner, with a short folded paper tail.
        circle((x+width*.25,y+.009,z+depth*.23),.044,.044,root,'y',.005,16)

    def stone(name,p,w,h,d,root):
        nonlocal stone_count
        x,y,z=p;cut=min(w,h)*.16
        ring=[(-w/2+cut,-h/2),(w/2-cut,-h/2),(w/2,-h/2+cut),
              (w/2,h/2-cut),(w/2-cut,h/2),(-w/2+cut,h/2),(-w/2,h/2-cut),(-w/2,-h/2+cut)]
        points=[(x+xx+(.006*sin(i*2.8) if i%2 else 0),y+yy,z+zz) for zz in [-d/2,d/2] for i,(xx,yy) in enumerate(ring)]
        n=len(ring);faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        obj=poly(name,points,faces,root);obj['medievalStone']=True;stone_count+=1

    def lantern(root,room_name,p,desk=False):
        x,y,z=p
        if desk:
            # Keep original BlogLampAnchor in the middle of the open fire cage.
            cylinder('Medieval_LanternFoot',(x,1.348,z),.18,.045,root,n=16,mat=ink)
            tube('LanternColumn',(x,1.36,z),(x,1.57,z),.035,root,True)
            bottom=y-.26;top=y+.23;r=.16
            cylinder('Medieval_LanternTray',(x,bottom,z),.19,.04,root,n=12,mat=ink)
            cylinder('Medieval_LanternCandle',(x,y-.14,z),.045,.20,root,n=12)
            # A reflective rear plate also preserves a generous clickable body
            # behind the fire; front/sides of the iron cage remain open.
            part('LanternRearReflector',(x,y-.015,z-r+.008),(.285,.425,.012),root,False,.004)
            for dx,dz in [(-r,-r),(r,-r),(r,r),(-r,r)]:
                tube('LanternIronRib',(x+dx,bottom,z+dz),(x+dx,top,z+dz),.012,root,True,8)
            poly('LanternPitchedCap',[(x-r-.02,top,z-r-.02),(x+r+.02,top,z-r-.02),(x+r+.02,top,z+r+.02),(x-r-.02,top,z+r+.02),(x,top+.13,z)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],root,True)
            circle((x,top+.18,z),.046,.06,root,width=.009,steps=16)
        else:
            # Backplate lies on the left wall; bracket extends into the room.
            part(room_name+'TorchBackplate',(.155,y-.22,z),(.040,.42,.18),root,True,.014)
            tube(room_name+'TorchBracket',(.18,y-.24,z),(x,y-.24,z),.025,root,True)
            tube(room_name+'TorchHandle',(x,y-.43,z),(x,y-.08,z),.044,root)
            cylinder('Medieval_'+room_name+'TorchCup',(x,y-.10,z),.073,.15,root,top=.125,n=10,mat=ink)
            for k in range(6):
                a=k*2*pi/6
                tube(room_name+'TorchCrown',(x+.105*cos(a),y-.08,z+.105*sin(a)),(x+.135*cos(a),y+.075,z+.135*sin(a)),.010,root,True,6)
            for yy in [y-.34,y-.10]:circle((.181,yy,z),.05,.05,root,'x',.004,12)
        marker=empty('TorchAnchor_'+room_name,p,root)
        marker['torch']=True;marker['room']=room_name;marker['flameRadius']=.065
        marker['penInkAuthored']=True
        torch_markers[marker.name]={'room':room_name,'positionCanonical':list(p),'owner':root.name,'kind':'desk lantern' if desk else 'wall torch'}

    for room_name,root in rooms.items():
        short=room_name.replace('Room','')
        # Strong corner posts and a visible timber crown frame the existing
        # surfaces. No new beam crosses any screen or piano seating view.
        for zz in [.30,4.12,5.43]:
            beam=part(short+'TimberLeftPost',(.215,1.87,zz),(.19,3.38,.14),root)
            beam['medievalWood']=True
            for offset in [-.035,.033]:
                line([(.316,.35,zz+offset),(.316,1.62,zz+offset+.009),(.316,3.48,zz+offset-.004)],root,.002)
            for yy in [.43,3.30]:
                part(short+'IronPostTie',(.319,yy,zz),(.024,.050,.155),root,True,.003)
                circle((.333,yy,zz),.026,.026,root,'x',.004,12)
        for xx in [.34,5.42]:
            beam=part(short+'TimberBackPost',(xx,1.87,.181),(.14,3.38,.155),root)
            beam['medievalWood']=True
        left=part(short+'TimberLeftCrown',(.215,3.56,2.82),(.21,.15,5.44),root);left['medievalWood']=True
        back=part(short+'TimberBackCrown',(2.87,3.56,.183),(5.29,.15,.18),root);back['medievalWood']=True
        # Short corner braces sit at the empty upper corners, outside content.
        timber(short+'LeftCornerBrace',(.25,3.45,4.52),(.25,2.96,5.38),.13,.13,root)
        timber(short+'RearCornerBrace',(.42,3.46,.215),(1.02,3.15,.215),.10,.10,root)
        # Hand-jointed stone footing, shallow relief only at the open edge.
        for i in ([0,8] if atlas_mode else range(9)):
            xx=.43+i*.596
            stone(short+'FootingStone',(xx,.071,5.49),.56+(i%3)*.008,.14,.14,root)
        # A few irregular masonry courses beneath the left window/portrait.
        for row in ([] if atlas_mode else range(2)):
            yy=.40+row*.25
            for i in range(7):
                zz=.46+i*.72+(.28 if row%2 else 0)
                points=[(.111,yy-.09,zz-.27),(.112,yy-.098,zz+.22),(.112,yy+.085,zz+.28),(.111,yy+.105,zz-.24)]
                line(points,root,.0023,True)
        # Carved lower panels carry simple quatrefoil joinery.
        for zz in [.82,2.31,3.72,4.71]:
            panel=part(short+'CarvedTimberPanel',(.15,.65,zz),(.050,.42,.56),root,False,.007)
            panel['medievalWood']=True
            rosette((.180,.65,zz),.10,root,'x')
        # Forged shelf ties follow the existing shelves without moving books.
        for yy in [.11,.66,1.20,1.76,2.26]:
            part(short+'BookcaseIronBand',(5.388,yy,.48),(.020,.033,.425),root,True,.003)
            for zz in [.32,.64]:circle((5.401,yy,zz),.018,.018,root,'x',.005,10)
        # Scrolls and iron hasps sit beside the modern content, rather than
        # replacing documents, the computer, keyboard or any interaction.
        for yy in [.43,1.85]:
            part(short+'BookcaseHinge',(4.48,yy,.715),(.060,.14,.012),root,True,.003)
            circle((4.48,yy+.043,.724),.012,.012,root,width=.003,steps=10)
        if room_name!='RoomBlog':lantern(root,room_name,(.48,2.66,4.90))

        if room_name!='RoomDeveloper':
            window=empty('RoomCandleWindow_'+room_name,(.062,2.19,2.52),root)
            window['nightWindow']=True;window['penInkAuthored']=True;window['room']=room_name
            window_material=paper.copy();window_material.name='PenPaper_WindowGlow_'+room_name
            window_material['nightWindow']=True
            for yy,height in [(1.69,.82),(2.68,.83)]:
                for zz in [1.90,3.14]:
                    points=[(.062,yy-height/2,zz-.55),(.062,yy+height/2,zz-.55),(.062,yy+height/2,zz+.55),(.062,yy-height/2,zz+.55)]
                    pane=poly(room_name+'CandleGlass',points,[(3,2,1,0)],window)
                    pane.data.materials[0]=window_material;pane['skipInkEdges']=True
            window_markers.append(window.name)

    # Replace just the electric fixture meshes; preserve both named anchors.
    lamp=bpy.data.objects['BlogLamp']
    for obj in list(lamp.children_recursive):
        if obj.type=='MESH':obj['penInkSuperseded']=True;obj.hide_render=True;obj.hide_set(True)
    lantern(lamp,'RoomBlog',(4.20,1.90,1.12),desk=True)

    # Everyday instruments retain their readable surfaces within antique frames.
    blog=rooms['RoomBlog'];dev=rooms['RoomDeveloper'];piano=rooms['RoomPiano'];ai=rooms['RoomAI']
    quill('Writer',(1.22,1.307,.85),blog)
    scroll('ArchiveScroll',(2.94,.544,1.02),dev)
    # Keep the full quill silhouette beyond the resume's x=4.15 right edge.
    # The rear bench position previously projected over its lower text lines.
    quill('Archive',(4.62,.538,1.30),dev)
    if not atlas_mode:scroll('MusicScroll',(1.66,2.422,.99),piano,.66,.32)
    # Small roll group on the existing experiment cabinet, away from its pads.
    tube('AtelierMapRoll',(.34,.81,.45),(.72,.81,.45),.05,ai)
    for xx in [1.99,3.61]:
        for yy in [1.615,2.485]:
            part('MonitorIronCorner',(xx,yy,.865),(.095,.045,.014),bpy.data.objects['Monitor'],True,.003)
    if not atlas_mode:
        for xx in [1.50,4.10]:rosette((xx,1.95,1.409),.115,piano)
    for yy in [.38,.90]:
        for xx in [1.39,4.21]:
            part('DeskIronTie',(xx,yy,1.981),(.235,.040,.014),blog,True,.003)
            for dx in [-.074,.074]:circle((xx+dx,yy,1.992),.014,.014,blog,width=.004,steps=10)

    # Embossed old-book spines, derived from real cover bounds.
    candidates=[o for o in list(bpy.context.scene.objects) if o.type=='MESH' and 'Book' in o.name and 'Spine' in o.name and o.name.startswith('InkDetail_')]
    bpy.context.view_layer.update()
    for i,obj in enumerate(candidates):
        if i%3:continue
        pts=[xyz(obj.matrix_world@Vector(corner)) for corner in obj.bound_box]
        x=(min(p.x for p in pts)+max(p.x for p in pts))/2
        y=(min(p.y for p in pts)+max(p.y for p in pts))/2
        z=max(p.z for p in pts)+.004
        root=obj.parent
        rosette((x,y,z),.026,root)
        for yy in [y-.09,y+.09]:
            line([(x-.038,yy,z),(x+.038,yy,z)],root,.0033)

    return {'style':'antique timber, carved wood, rough stone footing, iron-bound furnishings and torch hardware',
            'torchMarkers':torch_markers,'nightWindowMarkers':window_markers,'stoneBlocks':stone_count,
            'preservation':'All baseline content, interaction identities and apertures retained; only electric BlogLamp hardware superseded by lantern.'}
