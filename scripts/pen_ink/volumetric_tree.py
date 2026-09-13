"""A compact 360-degree pen tree: closed crown volumes and branched timber.

Only mutates a passed Drawing instance. No scene, files, shared templates or
global RNG are touched. Geometry stays within the existing meadow footprint.
"""
from math import sin, cos, pi
from mathutils import Vector


def build_tree(Drawing, white, ink, soft):
    d=Drawing();surface_vertices=0;canopy_faces=0

    def vertex(point):
        d.vertices.append((float(point[0]),-float(point[2]),float(point[1])))
        return len(d.vertices)-1

    def face(indices,color=white):
        d.faces.append(tuple(indices));d.colors.append(color)

    def surface(points,faces,color=white):
        nonlocal surface_vertices
        if color==white:
            volume=sum(Vector(points[indices[0]]).dot(Vector(points[indices[j]]).cross(Vector(points[indices[j+1]])))/6
                       for indices in faces for j in range(1,len(indices)-1))
            if volume<0:faces=[tuple(reversed(indices)) for indices in faces]
        offset=len(d.vertices)
        for point in points:vertex(point)
        for indices in faces:face([offset+i for i in indices],color)
        surface_vertices+=len(points)
        return faces

    def tube(points,radii,sides=7,outline=True):
        points=[Vector(p) for p in points];rings=[]
        for i,(center,radius) in enumerate(zip(points,radii)):
            direction=(points[min(i+1,len(points)-1)]-points[max(i-1,0)]).normalized()
            side=direction.cross(Vector((0,0,1)))
            if side.length<.1:side=direction.cross(Vector((1,0,0)))
            side.normalize();other=direction.cross(side).normalized()
            rings.append([center+radius*(side*cos(j*2*pi/sides)+other*sin(j*2*pi/sides)) for j in range(sides)])
        faces=[tuple(reversed(range(sides))),tuple(range((len(rings)-1)*sides,len(rings)*sides))]
        for i in range(len(rings)-1):
            for j in range(sides):faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
        surface([point for ring in rings for point in ring],faces)
        if outline:
            for j in range(0,sides,2):d.stroke([ring[j] for ring in rings],.011,ink)
        return rings

    trunk=tube([(0,.012,0),(-.032,.55,.024),(.042,1.03,-.020),(-.038,1.51,.035),(.026,2.12,.012)],
               [.158,.138,.108,.077,.030],sides=8)
    # Four buttress roots are closed wedges with genuine depth, not a flat base.
    for j in range(4):
        a=j*pi/2+.28
        side=Vector((-sin(a),0,cos(a)))
        base=Vector((cos(a)*.30,.009,sin(a)*.30))
        shoulder=Vector((cos(a)*.115,.28,sin(a)*.115))
        inner=Vector((cos(a)*.065,.008,sin(a)*.065))
        points=[base,inner+side*.055,inner-side*.055,shoulder]
        surface(points,[(0,2,1),(0,1,3),(1,2,3),(2,0,3)])
        d.stroke([base,shoulder],.014,ink)
    # A bent central trunk forks into front, rear and lateral branches.
    branches=[
        [(-.01,1.03,.01),(-.22,1.42,.03),(-.52,1.81,.11),(-.71,2.27,.08)],
        [(.02,1.14,0),(.22,1.49,.045),(.48,1.84,.13),(.72,2.29,.08)],
        [(0,1.19,.015),(-.05,1.48,.22),(-.14,1.73,.48),(-.18,2.08,.77)],
        [(.015,1.10,-.01),(.10,1.46,-.26),(.17,1.79,-.49),(.13,2.15,-.76)],
        [(-.025,1.48,.025),(.015,1.91,-.035),(-.045,2.26,-.02),(.035,2.65,0)],
    ]
    for path in branches:tube(path,[.075,.061,.039,.013],sides=6)
    for path in [
        [(-.22,1.42,.03),(-.40,1.68,-.21),(-.53,1.96,-.48)],
        [(.22,1.49,.045),(.43,1.64,.33),(.61,1.99,.58)],
        [(-.05,1.48,.22),(-.35,1.68,.45),(-.53,1.99,.57)],
        [(.10,1.46,-.26),(.39,1.73,-.42),(.55,2.06,-.49)],
    ]:tube(path,[.044,.031,.011],sides=5,outline=False)
    # Bark is engraved on several sides so rotation never reveals a blank card.
    for j in range(8):
        a=j*pi/4
        for k in range(2):
            h=.16+k*.37+.045*(j%3)
            d.stroke([(cos(a)*.140,h,sin(a)*.140),
                      (cos(a+.14)*.130,h+.22,sin(a+.14)*.130)],.007,soft)

    lobes=[
        ((-.62,2.31,.08),(.74,.59,.66)),
        ((.60,2.39,.03),(.75,.58,.67)),
        ((.03,2.85,-.015),(.80,.58,.78)),
        ((-.14,2.23,.77),(.72,.56,.71)),
        ((.10,2.28,-.75),(.71,.54,.72)),
        ((.55,2.11,.58),(.63,.47,.64)),
        ((-.48,2.08,-.53),(.60,.46,.63)),
    ]
    longitude=16;latitude=6
    for c,(center,radii) in enumerate(lobes):
        cx,cy,cz=center;rx,ry,rz=radii
        points=[Vector((cx,cy-ry,cz))]
        rings=[]
        for j in range(1,latitude):
            lat=-pi/2+j*pi/latitude;ring=[]
            for i in range(longitude):
                a=i*2*pi/longitude
                # Irregular rounded bulges remain real closed surface volume.
                ripple=1+.034*sin(a*5+c*.71)*cos(lat)**2+.018*sin(a*9-c*.47)*cos(lat)
                y=cy+ry*sin(lat)+.022*sin(a*4+c)*cos(lat)**2
                point=Vector((cx+rx*cos(lat)*cos(a)*ripple,y,cz+rz*cos(lat)*sin(a)*ripple))
                ring.append(point);points.append(point)
            rings.append(ring)
        top_index=len(points);points.append(Vector((cx,cy+ry,cz)))
        faces=[]
        for i in range(longitude):
            nxt=(i+1)%longitude
            faces.append((0,1+i,1+nxt))
            faces.append((top_index,1+(latitude-2)*longitude+nxt,1+(latitude-2)*longitude+i))
        for j in range(latitude-2):
            for i in range(longitude):
                nxt=(i+1)%longitude;a=1+j*longitude+i;b=1+j*longitude+nxt
                faces.extend([(a,a+longitude,b+longitude),(a,b+longitude,b)])
        faces=surface(points,faces);canopy_faces+=len(faces)

        def raised(point,amount=.005):
            delta=point-Vector(center)
            normal=Vector((delta.x/(rx*rx),delta.y/(ry*ry),delta.z/(rz*rz))).normalized()
            return point+normal*amount

        # A thin inward-facing expanded shell supplies a true 360-degree pen
        # silhouette. Both shell and paper body share one vertex-colour mesh.
        # Front-face rendering is part of the tree material's GLB contract.
        surface([raised(p,.010) for p in points],[tuple(reversed(f)) for f in faces],ink)

        def sample(lon,lat):
            """Barycentric point on the exact authored surface triangle."""
            lon=lon%longitude
            i=int(lon)%longitude;u=lon-int(lon)
            j=max(0,min(len(rings)-2,int(lat)));t=max(0,min(1,lat-j))
            a=rings[j][i];b=rings[j][(i+1)%longitude]
            cc=rings[j+1][i];dd=rings[j+1][(i+1)%longitude]
            if t>=u:
                point=a*(1-t)+cc*(t-u)+dd*u
                normal=(cc-a).cross(dd-a).normalized()
            else:
                point=a*(1-u)+dd*t+b*(u-t)
                normal=(dd-a).cross(b-a).normalized()
            if normal.dot(point-Vector(center))<0:normal=-normal
            return point+normal*.012

        # A loose scalloped foliage seam and little leaf tufts replace the
        # latitude/meridian grid; volume comes from the actual solid lobes.
        d.stroke([sample(i,2.34+.22*sin(i*2.35+c)) for i in range(longitude)],.0063,ink,cyclic=True)
        for i in range(10):
            a=i*longitude/10+c*.29;row=1.57+.42*sin(i*2.1+c)
            d.stroke([sample(a,row),sample(a+.23,row+.24),sample(a+.53,row+.34),sample(a+.81,row+.12)],.0058,ink)
        # Seven closely spaced curved marks on each outward-facing flank.
        # A given view exposes one or two patches, leaving the lit crowns open.
        # Four short surface-following segments avoid chords buried in a lobe.
        if c in [0,1,3,4]:
            outward={0:8.0,1:0.0,3:4.0,4:12.0}[c]
            for i in range(7):
                a=outward-1.20+i*.32;lo=1.15+.055*sin(i*.7+c)
                d.stroke([sample(a+.32*t,lo+.94*t) for t in [0,.25,.50,.75,1]],.0095,soft)

    d.tree_stats={'closedCanopyLobes':len(lobes),'majorBranches':len(branches),
                  'secondaryBranches':4,'canopySurfaceFaces':canopy_faces,
                  'surfaceVertices':surface_vertices,'planarCanopyCards':0,
                  'invertedHullContours':len(lobes),'requiresFrontFaces':True,
                  'selectiveHatchPatches':4,'parallelMarksPerPatch':7,
                  'style':'Closed irregular round crowns; true contour hulls; tapered branching timber; foliage tufts and triangle-attached hatching.'}
    return d
