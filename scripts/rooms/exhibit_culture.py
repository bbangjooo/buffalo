"""Close-up cultural objects authored as broad, deliberate Blender mesh planes.

All coordinates use the shared Three.js frame. Objects sit above the .24 m
plinth and stay below the reader, so the interactive display remains usable.
"""
from math import cos, sin


def _slab(kit, name, x0, x1, y0, y1, z0, z1, token):
    """A crisp rectangular part: useful for keys and broad cover surfaces."""
    return kit.poly(name, [(x, y, z) for z in (z0, z1)
                          for x, y in ((x0,y0),(x1,y0),(x1,y1),(x0,y1))],
                    [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),
                     (2,3,7,6),(3,0,4,7)], token)


def _ribbon(kit, name, x, y, depth, token, width=.075, drop=.19):
    # A folded ribbon crosses the page, rolls over its edge and has a V cut.
    z0, z1 = -depth*.68, depth
    w=width/2
    points=[(x-w,y,z0),(x+w,y,z0),(x-w,y,z1),(x+w,y,z1),
            (x-w,y-.06,z1+.022),(x+w,y-.06,z1+.022),
            (x-w,y-drop,z1+.022),(x,y-drop+.045,z1+.022),
            (x+w,y-drop,z1+.022)]
    return kit.poly(name,points,[(0,1,3,2),(2,3,5,4),(4,5,8,7,6)],token,
                    tones=[1.08,.82,.95],orient=False)


def _closed_book(kit, name, center, size, token, yaw=0):
    """A single thick volume with clipped, offset cover and inset page edges."""
    x,y,z=center;w,h,d=size
    made=[]
    made.append(kit.block(name+' LowerCover',(x,y+.02,z),(w,.04,d),token,cut=.055))
    made.append(_slab(kit,name+' PageBlock',x-w/2+.045,x+w/2-.025,
                      y+.04,y+h-.035,z-d/2+.035,z+d/2-.035,'paper'))
    made.append(kit.block(name+' UpperCover',(x+.008,y+h-.017,z-.008),
                          (w,.034,d),token,cut=.06))
    # The solid fore-edge and square spine are intentionally distinct.
    made.append(_slab(kit,name+' BoundSpine',x-w/2,x-w/2+.055,
                      y+.02,y+h-.015,z-d/2,z+d/2,token))
    if yaw:
        # Rotate raw vertices in the X/Z plane about the local book centre.
        # Meshes are stored in Blender's x/-z/y frame by rooms.common.mesh.
        for obj in made:
            for v in obj.data.vertices:
                dx,dz=v.co.x-x,-v.co.y-z
                v.co.x=x+dx*cos(yaw)+dz*sin(yaw)
                v.co.y=-(z+dz*cos(yaw)-dx*sin(yaw))
    return made


def _open_book(kit,name,x,y,z,width,depth,token,ribbon=True):
    """Two substantial wedge page blocks with peaked gutter and folded covers."""
    half=width/2
    for side in (-1,1):
        # The change of slope halfway along each page is a visible paper fold.
        profile=[(x,y+.075),(x+side*half,y+.018),
                 (x+side*half,y+.102),(x+side*half*.58,y+.119),
                 (x+side*.055,y+.198),(x,y+.181)]
        kit.extrude(name+(' LeftPages' if side<0 else ' RightPages'),
                    profile,z-depth/2+.024,z+depth/2-.024,'paper')
        # Covers project outside the leaves; these are broad 6-face slabs.
        cover=[(x,y+.033),(x+side*(half+.04),y-.026),
               (x+side*(half+.04),y+.015),(x,y+.076)]
        kit.extrude(name+' SplayedCover',cover,z-depth/2,z+depth/2,token)
        # Two sparse end bands show layered paper without dense thin geometry.
        for offset in (.034,.057):
            points=[(x+side*.075,y+.073+offset,z+depth/2-.023),
                    (x+side*(half-.022),y+.004+offset,z+depth/2-.023),
                    (x+side*(half-.022),y+.010+offset,z+depth/2-.023),
                    (x+side*.075,y+.079+offset,z+depth/2-.023)]
            kit.poly(name+' Endgrain',points,[(0,1,2,3)],'wood',
                     tones=[.90],orient=False)
    # A rounded square spine, made with four large longitudinal planes.
    kit.extrude(name+' Spine',[(x-.044,y+.03),(x+.044,y+.03),
                (x+.062,y+.08),(x,y+.17),(x-.062,y+.08)],
                z-depth/2-.006,z+depth/2+.006,token)
    if ribbon:
        _ribbon(kit,name+' Ribbon',x+.12,y+.187,depth/2-.017,'brass',
                width=.065,drop=.18)


def _piano(kit,station):
    variant=(int(station.get('order',1))-1)%5
    body=('walnut','ink','walnut','paper','ink')[variant]
    trim=('wood','walnut','ink','wood','walnut')[variant]
    # A broad shoulder chamfer and tapered cabinet give a recognizable upright
    # silhouette even in flat lighting. No generic subdivided bevel is used.
    cabinet=[(-.69,.33),(.69,.33),(.748,.43),(.716,.94),
             (.639,.995),(-.639,.995),(-.716,.94),(-.748,.43)]
    kit.extrude('Piano ChamferedCabinet',cabinet,-.232,.137,body)
    kit.block('Piano OverhangingCrown',(0,1.001,-.047),(1.56,.068,.45),
              trim,cut=.075,taper=.94)
    # Recessed fallboard and keyboard carry large quiet negative spaces.
    _slab(kit,'Piano RecessedFallboard',-.60,.60,.76,.925,.139,.155,trim)
    _slab(kit,'Piano MakersPlaque',-.125,.125,.858,.883,.156,.169,'brass')
    kit.extrude('Piano CantileverKeybed',[(-.788,.604),(.788,.604),
                (.75,.65),(-.75,.65)],.115,.465,trim)
    _slab(kit,'Piano KeyboardShadow',-.67,.67,.648,.669,.126,.451,'ink')
    # Ten actual white keys and seven short raised black keys. Their gaps and
    # recessed dark bed read at walking distance; no texture stands in for keys.
    pitch=.128
    for i in range(10):
        left=-.636+i*pitch
        _slab(kit,'Piano IvoryKey',left,left+.119,.668,.704,.159,.445,'paper')
    for i in (0,1,3,4,5,7,8):
        x=-.636+(i+1)*pitch-.033
        _slab(kit,'Piano EbonyKey',x,x+.058,.704,.743,.16,.302,'ink')
    for side in (-1,1):
        # Structural cheeks and tapered front legs are sizeable planar pieces.
        lo,hi=sorted((side*.68,side*.79))
        kit.extrude('Piano SculptedCheek',[(lo,.65),(hi,.65),(hi,.732),
                    (side*.724,.797),(side*.68,.778)],.07,.452,body)
        kit.block('Piano TaperedFrontLeg',(side*.66,.444,.303),
                  (.122,.388,.145),body,cut=.032,taper=.76)
    _slab(kit,'Piano PedalBase',-.24,.24,.257,.292,.174,.305,trim)
    for x in (-.096,.096):
        kit.extrude('Piano BroadPedal',[(x-.034,.278),(x+.034,.278),
                    (x+.042,.306),(x-.042,.306)],.256,.418,'brass')
    if variant==0:
        # En avril à Paris: a restrained faceted bud vase; one sculptural flower.
        kit.cylinder('Paris CeramicVase',(.998,.395,-.04),.13,.29,'teal',
                     n=6,top_radius=.069,phase=.25)
        kit.beam('Paris FlowerStem',(.998,.523,-.04),(.964,.806,-.04),.021,'teal',n=4)
        kit.poly('Paris FoldedBloom',[(.964,.92,-.04),(.856,.824,-.04),
                    (.964,.787,.06),(1.072,.824,-.04),(.964,.787,-.14)],
                    [(0,1,2),(0,2,3),(0,3,4),(0,4,1),(1,4,3,2)],'paper')
    elif variant==1:
        # Beethoven: a wide pyramid metronome with a clear inset and pendulum.
        kit.block('Sonata Metronome',(.999,.516,-.024),(.332,.528,.306),
                  'walnut',cut=.035,taper=.35)
        kit.extrude('Sonata MetronomeFace',[(.878,.32),(1.119,.32),
                    (1.039,.73),(.959,.73)],.132,.146,'ink')
        kit.beam('Sonata Pendulum',(.999,.355,.166),(1.045,.686,.166),.019,'brass',n=4)
        _slab(kit,'Sonata PendulumWeight',.998,1.052,.548,.605,.159,.189,'brass')
    elif variant==2:
        # Last Rag: a substantial player-piano paper roll, with polygonal endcaps.
        kit.cylinder('Rag PaperRoll',(.988,.515,-.031),.156,.382,'paper',n=8,axis='y')
        for y in (.306,.724):
            kit.cylinder('Rag RollSpool',(.988,y,-.031),.182,.037,'ink',n=8)
        _slab(kit,'Rag MusicRibbon',.828,.916,.33,.636,.088,.102,'brass')
    elif variant==3:
        # Graceful Ghost: the folded score on top forms an angular open lid.
        _open_book(kit,'Ghost Score',-.07,1.026,-.04,.57,.272,'walnut',ribbon=False)
        # Keep the score inside the existing display clearance by reducing its
        # vertical relief only; actual separate paper and cover surfaces remain.
        for obj in kit.root.children:
            if obj.name.startswith('Ghost Score') and obj.type=='MESH':
                for v in obj.data.vertices:
                    v.co.z=1.024+(v.co.z-1.024)*.58
    else:
        # Träumerei: a single architectural candle; quiet, broad six-sided form.
        kit.cylinder('Dream CandleFoot',(1.001,.285,-.025),.15,.06,'brass',n=6)
        kit.cylinder('Dream CandleColumn',(1.001,.508,-.025),.046,.41,'brass',n=6)
        kit.cylinder('Dream Wax',(1.001,.812,-.025),.085,.232,'paper',n=6)
        kit.poly('Dream FacetedFlame',[(1.001,1.03,-.025),(.958,.948,-.025),
                    (1.001,.924,.006),(1.039,.948,-.025),(1.001,.924,-.056)],
                    [(0,1,2),(0,2,3),(0,3,4),(0,4,1),(1,4,3,2)],'brass')


def _book(kit,station):
    variant=int(station.get('entryIndex',station.get('order',1)))%6
    color=('teal','walnut','ink','brass','slate','wood')[variant]
    offset=(-.11,.025,-.055,.09,-.02,.065)[variant]
    # A casually turned substantial volume supports the open journal. The
    # silhouette changes per article, while repeated book structure stays legible.
    _closed_book(kit,'Blog ArchiveVolume',(0,.254,-.015),(1.62,.168,.70),
                 color,yaw=(-.07,.05,-.04,.08,-.055,.025)[variant])
    _open_book(kit,'Blog OpenJournal',offset,.449,.006,1.42,.70,
               ('walnut','wood','teal')[variant%3])
    # One tall folded page at the gutter makes this an authored book sculpture,
    # with broad triangular planes rather than an array of tiny decorative marks.
    if variant in (1,3,5):
        x=offset-.11
        kit.poly('Blog TurningLeaf',[(x,.62,-.288),(x,.62,.28),
                    (x-.30,.923,-.248),(x-.24,.884,.24),
                    (x-.54,.79,-.207),(x-.48,.758,.2)],
                    [(0,1,3,2),(2,3,5,4)],'paper',tones=[.86,1.08],orient=False)


def _guestbook(kit,station):
    # A special oversize leather register and an actual segmented fountain pen.
    _closed_book(kit,'Guestbook Register',(-.145,.254,0),(1.69,.186,.774),'teal')
    _open_book(kit,'Guestbook OpenRegister',-.145,.473,0,1.62,.77,'teal')
    kit.cylinder('Guestbook InkwellBody',(.99,.361,-.067),.17,.214,
                 'ink',n=8,top_radius=.145,phase=.392699)
    kit.cylinder('Guestbook InkwellShoulder',(.99,.486,-.067),.145,.064,
                 'teal',n=8,top_radius=.09,phase=.392699)
    kit.ring('Guestbook InkOpening',(.99,.524,-.067),.096,.059,.028,
             'brass',n=8,axis='y')
    # The broad pen is supported by its inkwell, with distinct nib, grip and cap.
    a=(.989,.546,-.069);b=(.893,1.052,-.16)
    kit.beam('Guestbook FountainPenBarrel',a,b,.047,'walnut',n=6)
    kit.beam('Guestbook FountainPenGrip',(.989,.546,-.069),(.966,.665,-.09),
             .052,'ink',n=6)
    kit.beam('Guestbook FountainPenBand',(.965,.67,-.091),(.958,.708,-.098),
             .055,'brass',n=6)
    kit.beam('Guestbook FountainPenCap',(.91,.964,-.144),(.89,1.074,-.164),
             .052,'ink',n=6)
    # A visible brass nib is laid on the page edge as a clear writing cue.
    kit.poly('Guestbook FountainPenNib',[(.987,.546,-.065),(.962,.609,-.061),
                 (1.01,.609,-.061),(.987,.613,-.032),(.987,.538,-.034)],
                 [(0,1,3),(0,3,2),(1,2,3),(0,2,4),(0,4,1),(1,4,2)],'brass')


def build(shape,kit,station):
    """Build the relevant sculpture; return False for unowned object kinds."""
    if shape=='piano' or shape.startswith('piano-'):
        _piano(kit,station)
    elif shape=='book':
        _book(kit,station)
    elif shape=='guestbook':
        _guestbook(kit,station)
    else:
        return False
    return True
