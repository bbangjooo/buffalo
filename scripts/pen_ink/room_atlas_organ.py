"""A carved chamber pipe organ around the untouched playable keyboard.

This is a visual instrument replacement only. MIDI key geometry/origins, score,
seat/eye/look anchors and the application's piano audio remain unchanged.
"""
from math import pi, sin, cos
import bpy
from mathutils import Vector


def build_atlas_organ(api):
    root=bpy.data.objects['Piano'];room=api['rooms']['RoomPiano']
    paper=api['paper'];ink=api['ink'];newbox=api['newbox'];cylinder=api['cylinder']
    mesh=api['mesh'];v=api['v'];stroke=api['stroke'];added=api['added']
    pipes=[];suppressed=[]

    def hide(obj):
        obj['penInkSuperseded']=True;obj.hide_render=True;obj.hide_set(True)
        suppressed.append(obj.name)

    # Keep the original keyboard, cheeks/feet and the small open score exactly.
    # Suppress the flat upright cabinet and contemporary acoustic panels.
    legacy=('PianoCabinet','PianoCrown','PianoUpperFrame','PianoUpperField','PianoCabinetStile',
            'PianoLowerFrame','PianoLowerField','PianoBasePlinth','PianoPedal')
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH' and (obj.name.startswith(legacy) or obj.name.startswith('PianoAcoustic')):hide(obj)

    def xyz(p):return Vector((p.x,p.z,-p.y))

    def line(points,owner=root,width=.0023,closed=False):
        if closed:points=[*points,points[0]]
        inverse=owner.matrix_world.inverted()
        stroke([xyz(inverse@v(p)) for p in points],owner,width)

    def poly(name,points,faces,owner=root,dark=False,wood=False):
        obj=mesh('InkDetail_Atlas_Organ'+name,points,faces,ink if dark else paper,owner)
        obj['penInkAuthored']=True
        if wood:obj['atlasWood']=True
        added['RoomPiano'].append(obj.name)
        return obj

    def box(name,p,d,owner=root,dark=False,wood=True,bevel=.012):
        obj=newbox('Atlas_Organ'+name,p,d,owner,bevel)
        if dark:
            for i in range(len(obj.data.materials)):obj.data.materials[i]=ink
        if wood:obj['atlasWood']=True
        return obj

    def loop(p,rx,ry,width=.0023,plane='z',owner=root,steps=28):
        x,y,z=p;points=[]
        for i in range(steps):
            a=i*2*pi/steps
            points.append((x+rx*cos(a),y+ry*sin(a),z) if plane=='z' else
                          (x+rx*cos(a),y,z+ry*sin(a)))
        line(points,owner,width,True)

    def rosette(p,r):
        x,y,z=p
        line([(x+r*(.76+.22*cos(4*a))*cos(a),y+r*(.76+.22*cos(4*a))*sin(a),z)
              for a in [i*2*pi/48 for i in range(49)]],width=.0024)
        loop(p,r*.30,r*.30,.002)

    def scroll(p,direction=1,size=.17):
        x,y,z=p;points=[]
        for i in range(31):
            t=i/30;a=t*pi*2.0;r=size*(1-t*.84)
            points.append((x+direction*r*cos(a),y+r*sin(a),z))
        line(points,width=.0036)
        # Two leaf cuts turn the spiral into carved foliage, not a wire coil.
        for side in [-1,1]:
            line([(x+direction*size*.70,y,z),(x+direction*size*.35,y+side*size*.62,z),
                  (x+direction*size*.10,y+side*size*.20,z)],width=.0020)

    def carved_arch(name,cx,base,top,width,z):
        # A true pierced arch: the middle remains open in front of the pipes.
        outer=[];inner=[]
        for i in range(17):
            t=i*pi/16
            outer.append((cx-width/2*cos(t),base+(top-base)*sin(t),z))
            inner.append((cx-(width/2-.045)*cos(t),base+(top-base-.055)*sin(t),z+.002))
        points=outer+inner
        faces=[(i,i+1,18+i,17+i) for i in range(16)]
        obj=poly(name+'PiercedArch',points,faces,wood=True)
        obj['skipInkEdges']=True
        line(outer,width=.0031);line(inner,width=.0025)
        for i in [3,6,10,13]:
            a=Vector(outer[i]);b=Vector(inner[i]);line([a,a.lerp(b,.45),b],width=.0017)

    # Wind chest and carved lower case take the previous upright's footprint.
    box('WindChest',(2.8,.645,.975),(3.48,1.07,.67),bevel=.026)
    box('MoldedFoot',(2.8,.145,1.00),(3.61,.17,.78),bevel=.025)
    box('WindChestTopRail',(2.8,1.175,1.04),(3.63,.115,.79),bevel=.019)
    for x in [1.20,2.00,2.80,3.60,4.40]:
        box('LowerCaseStile',(x,.69,1.333),(.055,.82,.075),bevel=.012)
    for x in [1.60,2.40,3.20,4.00]:
        box('InsetPanel',(x,.70,1.317),(.68,.61,.045),bevel=.018)
        rosette((x,.70,1.344),.145)
        for yy in [.455,.945]:line([(x-.27,yy,1.345),(x+.27,yy,1.345)],width=.0016)
    # A slim organ pedalboard replaces three modern pedal wedges.
    for i in range(9):
        x=2.08+i*.18
        box('PedalKey',(x,.115,1.68),(.145,.065,.59),wood=True,bevel=.008)
        if i in [1,3,4,6]:box('RaisedPedal',(x,.16,1.51),(.086,.055,.25),dark=True,wood=False,bevel=.006)

    # Carved towers deliberately step in depth and height, like a small chapel
    # organ. All new upper geometry lies behind z=1.23; keys start z=1.346.
    for x,height in [(1.13,3.29),(2.14,3.30),(3.46,3.30),(4.47,3.29)]:
        box('TowerPost',(x,(1.25+height)/2,.99),(.105,height-1.25,.21),bevel=.019)
        for yy in [1.41,height-.12]:
            box('PostCapital',(x,yy,.99),(.18,.080,.27),bevel=.012)
        for offset in [-.022,.022]:
            line([(x+offset,1.55,1.102),(x+offset+.005,2.12,1.102),(x+offset,height-.19,1.102)],width=.0017)
    for cx,width,height in [(1.62,.91,3.14),(2.80,1.20,3.41),(3.98,.91,3.14)]:
        # Backing stops below the arch, leaving the pipe tops visibly stepped.
        box('RankBack',(cx,2.20,.70),(width,1.75,.065),bevel=.009)
        box('PipeToeBoard',(cx,1.53,.965),(width+.08,.10,.43),bevel=.011)
        carved_arch('Tower',cx,height-.17,height+.15,width+.10,1.075)
        for dx in [-1,1]:scroll((cx+dx*(width/2+.015),height-.12,1.086),-dx,.11)
    # Fretwork below the three ranks is perforated geometry and engraved cuts.
    for cx,width in [(1.62,.90),(2.80,1.20),(3.98,.90)]:
        box('FretRail',(cx,1.635,1.115),(width,.075,.065),bevel=.008)
        for j in range(6):
            xx=cx-width*.41+j*width*.164
            loop((xx,1.715,1.153),.036,.065,.0026)
            line([(xx-.030,1.715,1.153),(xx,1.755,1.154),(xx+.030,1.715,1.153)],width=.0016)

    def pipe(index,x,height,radius=.073,z=1.005,start=1.69,rear=False):
        center=(start+height)/2
        body=cylinder('Atlas_OrganPipe'+str(index),(x,center,z),radius,height-start,root,n=20)
        body['atlasPipe']=True;body['skipInkEdges']=True
        # Open top, collars and polygonal foot are actual separate solids.
        cylinder('Atlas_OrganPipeCollar'+str(index),(x,start+.08,z),radius*1.10,.032,root,n=20)
        cylinder('Atlas_OrganPipeTopRing'+str(index),(x,height-.016,z),radius*1.045,.028,root,n=20)
        cylinder('Atlas_OrganPipeOpenTop'+str(index),(x,height+.001,z),radius*.81,.003,root,n=20,mat=ink)
        cylinder('Atlas_OrganPipeFoot'+str(index),(x,start-.055,z),radius*.50,.12,root,top=radius*.84,n=12)
        # Mouth opening has a shaped upper lip and beveled-looking side cuts.
        mouth_y=start+.19
        mouth=[(x-radius*.57,mouth_y-.045,z+radius+.004),(x+radius*.57,mouth_y-.045,z+radius+.004),
               (x+radius*.52,mouth_y+.048,z+radius+.004),(x,mouth_y+.072,z+radius+.004),
               (x-radius*.52,mouth_y+.048,z+radius+.004)]
        poly('PipeMouth'+str(index),mouth,[tuple(range(5))],dark=True)
        line([(x-radius*.65,mouth_y-.061,z+radius+.008),(x+radius*.65,mouth_y-.061,z+radius+.008)],width=.0023)
        # Six fine flute lines give cylindrical form from a moving camera.
        for k in range(6):
            a=k*pi/3;r=radius+.0025
            line([(x+r*cos(a),start+.28,z+r*sin(a)),(x+r*cos(a),height-.05,z+r*sin(a))],width=.0011)
        for yy in [start+.055,height+.004]:loop((x,yy,z),radius*1.065,radius*1.065,.0021,'y')
        pipes.append({'name':body.name,'x':x,'height':height,'rear':rear})

    # Rear rank adds real depth without obstructing the prominent main mouths.
    for i,x in enumerate([1.43,1.80,2.40,2.66,2.94,3.20,3.80,4.17]):
        pipe(100+i,x,2.63+(1-abs(x-2.8)/1.45)*.36,.052,.78,1.72,True)
    front=[(1.34,2.88),(1.53,3.12),(1.72,3.04),(1.91,2.79),
           (2.34,2.89),(2.56,3.16),(2.80,3.40),(3.04,3.16),(3.26,2.89),
           (3.69,2.79),(3.88,3.04),(4.07,3.12),(4.26,2.88)]
    for i,(x,height) in enumerate(front):pipe(i,x,height,.078 if i==6 else .069)

    # Small draw stops flank the original keybed; their row stays outside keys.
    for side,x in [(-1,1.135),(1,4.465)]:
        for j in range(3):
            yy=1.46+j*.14
            for label,radius,back,front,dark in [('StopStem',.019,1.085,1.390,True),('StopButton',.043,1.39,1.414,False)]:
                points=[(x+radius*cos(k*2*pi/12),yy+radius*sin(k*2*pi/12),z) for z in [back,front] for k in range(12)]
                faces=[tuple(reversed(range(12))),tuple(range(12,24))]+[(k,(k+1)%12,(k+1)%12+12,k+12) for k in range(12)]
                poly(label,points,faces,dark=dark)
            loop((x,yy,1.416),.042,.042,.0024)
    # Carved crest, with no large solid roof over the key or score view.
    scroll((2.66,3.53,1.085),1,.13);scroll((2.94,3.53,1.085),-1,.13)
    rosette((2.80,3.60,1.086),.073)

    # A wooden organ bench retains the original legs and seated anchor height.
    bench=bpy.data.objects['PianoBench']
    old=bpy.data.objects.get('PianoBenchCushion')
    if old:hide(old)
    box('BenchWoodSeat',(2.8,.79,2.86),(1.49,.095,.72),bench,bevel=.020)
    for z in [2.64,2.86,3.08]:line([(2.12,.840,z),(2.79,.840,z+.004),(3.48,.840,z)],bench,.0017)
    root['visualInstrument']='antique chamber pipe organ'
    root['audioContract']='Existing piano audio and MIDI key mappings intentionally preserved.'
    return {'instrument':'chamber pipe organ','pipeCount':len(pipes),'pipes':pipes,
            'keyboard':'All original PianoKey60..83 geometry and transforms retained.',
            'upperGeometryFrontLimit':1.23,'sourceKeyBackZ':1.346,
            'originalObjectsSuperseded':suppressed,'audioChanged':False}
