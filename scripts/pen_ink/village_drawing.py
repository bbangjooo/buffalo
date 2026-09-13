"""Small, deterministic paper/ink mesh authoring kit in Three.js coordinates."""
from math import cos, sin, pi
import bpy
from mathutils import Vector

WHITE=(1,1,1,1)
INK=(.009,.009,.009,1)
SOFT=(.04,.04,.04,1)

def v(p): return Vector((p[0],-p[2],p[1]))

def unlit(name,color=WHITE,vertex=False):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial')
    if vertex:
        pigment=nodes.new('ShaderNodeVertexColor');pigment.layer_name='PenVillageTint'
    else:
        pigment=nodes.new('ShaderNodeRGB');pigment.outputs['Color'].default_value=color
    mat.node_tree.links.new(pigment.outputs['Color'],out.inputs['Surface'])
    mat.diffuse_color=color;mat['penInkAuthored']=True
    return mat

class Drawing:
    material=None
    def __init__(self):self.vertices=[];self.faces=[];self.colors=[]
    def polygon(self,points,color=WHITE):
        offset=len(self.vertices);self.vertices.extend([tuple(v(p)) for p in points])
        self.faces.append(tuple(range(offset,offset+len(points))));self.colors.append(color)
    def stroke(self,points,width=.014,color=INK,cyclic=False):
        pts=[Vector(p) for p in points]
        if cyclic:pts.append(pts[0])
        for a,b in zip(pts,pts[1:]):
            delta=b-a
            if delta.length<.000001:continue
            side=delta.normalized().cross(Vector((0,0,1)))
            if side.length<.01:side=delta.normalized().cross(Vector((0,1,0)))
            side.normalize();other=delta.normalized().cross(side)
            off=len(self.vertices)
            for p,scale in [(a,1),(b,.95)]:
                for i in range(3):self.vertices.append(tuple(v(p+(side*cos(i*2*pi/3)+other*sin(i*2*pi/3))*width*.5*scale)))
            for i in range(3):
                self.faces.append((off+i,off+(i+1)%3,off+3+(i+1)%3,off+3+i));self.colors.append(color)
    def box(self,center,size,color=WHITE,outline=True):
        x,y,z=center;w,h,d=[n*.5 for n in size]
        pts=[(x+a*w,y+b*h,z+c*d) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        for f in [(0,1,2,3),(5,4,7,6),(4,0,3,7),(1,5,6,2),(3,2,6,7),(4,5,1,0)]:self.polygon([pts[i] for i in f],color)
        if outline:
            for a,b in [(0,1),(1,2),(2,3),(3,0),(4,5),(5,6),(6,7),(7,4),(0,4),(1,5),(2,6),(3,7)]:self.stroke([pts[a],pts[b]],.016)
    def beam(self,a,b,width=.12,depth=None,color=WHITE):
        a,b=Vector(a),Vector(b);direction=(b-a).normalized()
        side=direction.cross(Vector((0,0,1)))
        if side.length<.1:side=direction.cross(Vector((0,1,0)))
        side.normalize();other=direction.cross(side)
        side*=width*.5;other*=(depth or width)*.5
        pts=[p+side*s+other*t for p in [a,b] for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        for f in [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]:self.polygon([pts[i] for i in f],color)
        for i in range(4):self.stroke([pts[i],pts[i+4]],.018)
        self.stroke(pts[:4],.014,cyclic=True);self.stroke(pts[4:],.014,cyclic=True)
    def cylinder(self,center,radius,height,n=12,color=WHITE,outline=True):
        x,y,z=center
        rings=[[(x+cos(i*2*pi/n)*radius,y+h,z+sin(i*2*pi/n)*radius) for i in range(n)] for h in [-height*.5,height*.5]]
        for i in range(n):self.polygon([rings[0][i],rings[0][(i+1)%n],rings[1][(i+1)%n],rings[1][i]],color)
        self.polygon(rings[0][::-1],color);self.polygon(rings[1],color)
        if outline:
            for ring in rings:self.stroke(ring,.014,cyclic=True)
            for i in range(0,n,3):self.stroke([rings[0][i],rings[1][i]],.011)
    def object(self,name,parent=None):
        mesh=bpy.data.meshes.new(name+'Geometry');mesh.from_pydata(self.vertices,[],self.faces);mesh.update()
        color=mesh.color_attributes.new(name='PenVillageTint',type='FLOAT_COLOR',domain='CORNER')
        for face,tint in zip(mesh.polygons,self.colors):
            for idx in face.loop_indices:color.data[idx].color=tint
        mesh.color_attributes.active_color=color
        if Drawing.material is None:Drawing.material=unlit('PenVillagePaperInk',vertex=True)
        mesh.materials.append(Drawing.material)
        obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);obj.parent=parent
        obj['penInkAuthored']=True;obj['villageEnvironment']=True
        return obj
