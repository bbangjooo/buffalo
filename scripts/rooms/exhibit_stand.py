"""Architectural display base and broad chamfered frame, with an exact clear window."""
from rooms.exhibit_geometry import FacetKit, clipped


def build_stand(root, palette, layout, station):
    k=FacetKit(palette,root)
    # A deeper, unlabelled plinth places the sculpture in front of the display.
    # Its back edge still supports the frame, and its clipped front corners
    # stay inside the existing two-metre collision circle.
    k.block('StoneOctagonalFoot',(0,-.06,.5),(3.06,.20,1.85),'chalk',cut=.20,taper=.95)
    k.block('PedestalShadowReveal',(0,.055,.5),(2.83,.10,1.70),'ink',cut=.18,taper=1)
    k.block('TaperedPedestalBody',(0,.13,.5),(2.87,.17,1.75),'paper',cut=.17,taper=.96)
    k.block('SculptureTableLip',(0,.237,.5),(2.96,.075,1.83),'chalk',cut=.20,taper=.985)
    # Two asymmetric cut planes produce sturdy, tapered uprights clear of the art.
    for sign in [-1,1]:
        outline=[(sign*1.21,.275),(sign*1.40,.275),(sign*1.39,1.36),(sign*1.29,1.44)]
        k.extrude('TaperedFrameSupport',outline,-.19,.00,'walnut')
        k.block('SupportBrassShoe',(sign*1.30,.36,-.095),(.17,.16,.22),'brass',cut=.025,taper=.93)
    width,height,cy=layout['reader']['width'],layout['reader']['height'],layout['reader']['y']
    outer=clipped(width+.39,height+.40,.15)
    inner=[(max(-width/2,min(width/2,x)),max(-height/2,min(height/2,y))) for x,y in outer]
    points=[]
    for ring,z,scale in [(outer,.11,1),(inner,.035,1),(outer,-.17,.982),(inner,-.085,1)]:
        points.extend((x*scale,cy+y*scale,z) for x,y in ring)
    faces=[];n=8
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,j+n,i+n),(i+n,j+n,j+3*n,i+3*n),
                      (2*n+i,2*n+j,j,i),(2*n+j,2*n+i,3*n+i,3*n+j)])
    k.poly('SinglePieceFacetFrame',points,faces,'wood',orient=False)
    # Recessed back panel; HTML aperture is at z=.015 in front of it.
    k.block('ReaderRecessBacking',(0,cy,-.12),(width+.10,height+.10,.04),'ink',cut=.035)
    # Four purposeful fasteners sit beyond the opening, on the outer planes.
    for x,y in [(-width/2-.095,cy-height/2-.05),(width/2+.095,cy-height/2+.05),
                (-width/2-.095,cy+height/2-.05),(width/2+.095,cy+height/2+.05)]:
        k.cylinder('FrameOctagonalPin',(x,y,.122),.028,.014,'brass',n=8,axis='z')
