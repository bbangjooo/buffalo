"""Deterministic, lightweight contact occlusion baked into authored vertex colours."""
from math import cos, sin, pi, sqrt
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def bake_station(root):
    # Station-local coordinates preserve exactly the same bake across all yaw rotations.
    objects=[obj for obj in root.children if obj.type=='MESH']
    vertices=[];faces=[]
    for obj in objects:
        base=len(vertices)
        vertices.extend(obj.matrix_local @ vertex.co for vertex in obj.data.vertices)
        faces.extend(tuple(base+i for i in face.vertices) for face in obj.data.polygons)
    if not faces:return
    bvh=BVHTree.FromPolygons(vertices,faces,all_triangles=False)
    directions=[]
    for i in range(10):
        angle=i*2.3999632297
        z=.24+.72*((i+.5)/10)
        r=sqrt(1-z*z)
        directions.append((r*cos(angle),r*sin(angle),z))
    cache={}
    for obj in objects:
        layer=obj.data.color_attributes.get('ExhibitTone')
        if not layer:continue
        transform=obj.matrix_local
        normal_matrix=transform.to_3x3().inverted().transposed()
        for face in obj.data.polygons:
            normal=(normal_matrix @ face.normal).normalized()
            tangent=normal.cross(Vector((0,0,1)))
            if tangent.length<.01:tangent=normal.cross(Vector((0,1,0)))
            tangent.normalize();bitangent=normal.cross(tangent).normalized()
            for index in face.loop_indices:
                vertex=obj.data.vertices[obj.data.loops[index].vertex_index]
                point=transform @ vertex.co
                key=tuple(round(value,4) for value in (*point,*normal))
                if key not in cache:
                    occlusion=0
                    for dx,dy,dz in directions:
                        direction=(tangent*dx+bitangent*dy+normal*dz).normalized()
                        hit,_,_,distance=bvh.ray_cast(point+normal*.003,direction,.30)
                        if hit is not None:occlusion+=1-distance/.30
                    cache[key]=max(.72,1-occlusion/len(directions)*.44)
                color=layer.data[index].color
                factor=cache[key]
                layer.data[index].color=(color[0]*factor,color[1]*factor,color[2]*factor,color[3])
    root['contactOcclusion']='10 hemisphere rays, 0.30m radius, minimum factor 0.72'
