"""Hand-authored broad-plane modelling tools. Coordinates are Three.js x/y/z.

FacetKit creates real Blender meshes with intentionally planar painted faces.
No subdivision, smoothing, dense bevel strips or runtime substitute geometry.
"""
from math import sin, cos, pi
import bpy
from mathutils import Vector
from rooms.common import mesh

_MATERIALS = {}


def clipped(width, height, cut):
    x,y=width/2,height/2
    cut=min(cut,x*.7,y*.7)
    return [(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),
            (x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)]


class FacetKit:
    def __init__(self, palette, root):
        self.palette,self.root=palette,root

    def material(self, token):
        key=('metal' if token=='brass' else 'paint',id(self.palette))
        if key not in _MATERIALS:
            source=self.palette[token]
            mat=bpy.data.materials.new('Sculpture satin metal' if token=='brass' else 'Sculpture matte paint')
            mat.use_nodes=True
            bsdf=mat.node_tree.nodes['Principled BSDF']
            bsdf.inputs['Base Color'].default_value=(1,1,1,1)
            bsdf.inputs['Roughness'].default_value=.9 if token!='brass' else .62
            bsdf.inputs['Metallic'].default_value=.12 if token=='brass' else 0
            color=mat.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='ExhibitTone'
            mat.node_tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
            mat.diffuse_color=source.diffuse_color
            mat['paletteToken']='vertex-colour palette';mat['finish']='broad-plane matte'
            _MATERIALS[key]=mat
        return _MATERIALS[key]

    def poly(self,name,points,faces,token,tones=None,orient=True):
        pts=[Vector(p) for p in points]
        center=sum(pts,Vector())/len(pts)
        corrected=[];strength=[]
        light=Vector((-.55,.88,.40)).normalized()
        for index,raw in enumerate(faces):
            face=[]
            for vertex in raw:
                if not face or (pts[vertex]-pts[face[-1]]).length>1e-9:face.append(vertex)
            if len(face)>1 and (pts[face[0]]-pts[face[-1]]).length<1e-9:face.pop()
            if len(set(face))<3:continue
            normal=(pts[face[1]]-pts[face[0]]).cross(pts[face[2]]-pts[face[0]])
            if normal.length<1e-10:continue
            middle=sum((pts[i] for i in face),Vector())/len(face)
            if orient and normal.dot(middle-center)<0:face.reverse();normal=-normal
            normal.normalize()
            shade=tones[index] if tones is not None else (1.08 if normal.dot(light)>.55 else .74 if normal.dot(light)<-.35 else 1)
            # Explicitly triangulate only truly non-planar polygons.
            if len(face)>3 and max(abs(normal.dot(pts[i]-pts[face[0]])) for i in face)>1e-6:
                for i in range(1,len(face)-1):corrected.append((face[0],face[i],face[i+1]));strength.append(shade)
            else:corrected.append(face);strength.append(shade)
        obj=mesh(name,points,corrected,self.material(token),self.root)
        tint=obj.data.color_attributes.new(name='ExhibitTone',type='FLOAT_COLOR',domain='CORNER')
        obj.data.color_attributes.active_color=tint
        base=self.palette[token].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
        for face,shade in zip(obj.data.polygons,strength):
            face.use_smooth=False
            for loop in face.loop_indices:tint.data[loop].color=(*[min(1,c*shade) for c in base[:3]],1)
        obj['broadPlane']=True;obj['paletteToken']=token
        return obj

    def extrude(self,name,outline,back,front,token):
        """Closed x/y outline extruded between z=back and z=front."""
        if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))<0:
            outline=list(reversed(outline))
        n=len(outline)
        points=[(x,y,z) for z in [back,front] for x,y in outline]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        return self.poly(name,points,faces,token,orient=False)

    def block(self,name,center,size,token,cut=.06,taper=1,yaw=0):
        """An 8-sided footprint with a structurally tapered upper ring, not bevel strips."""
        x,y,z=center;w,h,d=size
        ring=clipped(w,d,cut)
        points=[]
        for py,scale in [(y-h/2,1),(y+h/2,taper)]:
            for px,pz in ring:
                a,b=px*scale,pz*scale
                points.append((x+a*cos(yaw)+b*sin(yaw),py,z+b*cos(yaw)-a*sin(yaw)))
        n=len(ring);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        return self.poly(name,points,faces,token)

    def cylinder(self,name,center,radius,depth,token,n=8,axis='y',top_radius=None,phase=0):
        top_radius=radius if top_radius is None else top_radius
        x,y,z=center;points=[]
        for distance,r in [(-depth/2,radius),(depth/2,top_radius)]:
            for i in range(n):
                a=phase+i*2*pi/n;u,v=cos(a)*r,sin(a)*r
                p=(u,distance,v) if axis=='y' else (u,v,distance) if axis=='z' else (distance,u,v)
                points.append((x+p[0],y+p[1],z+p[2]))
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        return self.poly(name,points,faces,token)

    def beam(self,name,a,b,radius,token,n=6):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized()
        side=axis.cross(Vector((0,1,0)))
        if side.length<.01:side=Vector((1,0,0))
        side.normalize();up=axis.cross(side).normalized()
        points=[p+radius*(side*cos(i*2*pi/n)+up*sin(i*2*pi/n)) for p in [a,b] for i in range(n)]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        return self.poly(name,points,faces,token)

    def ring(self,name,center,outer,inner,depth,token,n=8,axis='z'):
        x,y,z=center;points=[]
        for offset,r in [(-depth/2,outer),(depth/2,outer),(-depth/2,inner),(depth/2,inner)]:
            for i in range(n):
                a=i*2*pi/n;u,v=cos(a)*r,sin(a)*r
                p=(u,offset,-v) if axis=='y' else (u,v,offset) if axis=='z' else (offset,u,v)
                points.append((x+p[0],y+p[1],z+p[2]))
        faces=[]
        for i in range(n):
            j=(i+1)%n
            faces.extend([(i,j,j+n,i+n),(i+n,j+n,j+3*n,i+3*n),(i+3*n,j+3*n,j+2*n,i+2*n),(i+2*n,j+2*n,j,i)])
        return self.poly(name,points,faces,token,orient=False)
