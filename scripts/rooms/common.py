"""Small authoring helpers. All public coordinates are Three.js x/y/z."""
from math import pi, sin, cos
import bpy
from mathutils import Vector


def v(p):
    return Vector((p[0], -p[2], p[1]))


def parent(obj, root):
    if root:
        bpy.context.view_layer.update()
        transform = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = transform
    return obj


def empty(name, p, root=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = v(p)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = .10
    return parent(obj, root)


def finish(obj, name, mat, root, bevel=0., segments=1, smooth=False):
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Crafted edge', 'BEVEL')
        mod.width, mod.segments = bevel, 1
    # Low-poly is visible geometry: every face keeps its own planar normal.
    # The retained smooth argument is compatibility for authored call sites.
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return parent(obj, root)


def box(name, p, dimensions, mat, root=None, bevel=.025, segments=1, yaw=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=v(p))
    obj = bpy.context.object
    obj.dimensions = (dimensions[0], dimensions[2], dimensions[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = yaw
    return finish(obj, name, mat, root, bevel, segments)


def cyl(name, p, radius, height, mat, root=None, n=24, axis='y', bevel=.012, top=None):
    n=max(6,min(n,10))
    if top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=radius, depth=height, location=v(p))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=radius, radius2=top, depth=height, location=v(p))
    obj = bpy.context.object
    if axis == 'z':
        obj.rotation_euler.x = pi / 2
    elif axis == 'x':
        obj.rotation_euler.y = pi / 2
    return finish(obj, name, mat, root, bevel, segments=1)


def ellipsoid(name, p, scale, mat, root=None, n=20, rings=10):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=v(p))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, root)


def rod(name, a, b, radius, mat, root=None, n=10):
    n=max(6,min(n,8))
    av, bv = v(a), v(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=radius, depth=(bv-av).length, location=(av+bv)/2)
    obj = bpy.context.object
    obj.rotation_euler = (bv-av).to_track_quat('Z','Y').to_euler()
    return finish(obj, name, mat, root)


def mesh(name, points, faces, mat, root=None, smooth=False):
    data = bpy.data.meshes.new(name+'Geometry')
    data.from_pydata([v(p) for p in points], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, root, smooth=smooth)


def text(name, body, p, size, mat, root=None, axis='z', align='CENTER'):
    curve = bpy.data.curves.new(name+'Glyphs','FONT')
    curve.body, curve.size = body, size
    curve.align_x, curve.align_y = align, 'CENTER'
    curve.extrude, curve.bevel_depth, curve.resolution_u = .0015, 0, 3
    obj = bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    obj.location = v(p)
    obj.rotation_euler.x = 0 if axis == 'y' else pi/2
    if axis == 'x':
        obj.rotation_euler.z = pi/2
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return finish(obj,name,mat,root)


def grid(name, p, width, height, mat, root, axis='y', step=.26):
    """A surface with vertices to carry soft, baked contact illumination."""
    step=max(step,.26)
    nx, ny = max(1,round(width/step)), max(1,round(height/step))
    points=[]
    for j in range(ny+1):
        for i in range(nx+1):
            a=(i/nx-.5)*width; b=(j/ny-.5)*height
            if axis=='y': points.append((p[0]+a,p[1],p[2]+b))
            elif axis=='z': points.append((p[0]+a,p[1]+b,p[2]))
            else: points.append((p[0],p[1]+b,p[2]+a))
    faces=[]
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i
            # Three +y, +z, +x-facing surfaces, mapped to Blender correctly.
            face=(a,a+1,a+nx+2,a+nx+1)
            if axis in ['y','x']: face=tuple(reversed(face))
            faces.append(face)
    return mesh(name,points,faces,mat,root)


def plant(name,p,scale,palette,root):
    x,y,z=p
    pot=empty(name,p,root)
    cyl(name+'Pot',(x,y+.21*scale,z),.20*scale,.42*scale,palette['walnut'],pot,n=24,top=.27*scale)
    cyl(name+'Rim',(x,y+.405*scale,z),.27*scale,.055*scale,palette['wood'],pot,n=24)
    cyl(name+'Soil',(x,y+.438*scale,z),.235*scale,.012,palette['ink'],pot,n=20,bevel=0)
    for i in range(7):
        angle=i*2.39996
        h=(.58+.12*(i%4))*scale
        origin=Vector((x,y+.44*scale,z))
        joint=Vector((x+cos(angle)*.12*scale,y+h,z+sin(angle)*.12*scale))
        tip=Vector((x+cos(angle)*(.42+.07*(i%3))*scale,y+h+.28*scale,z+sin(angle)*(.42+.07*(i%3))*scale))
        rod(name+'Stem',origin,joint,.010*scale,palette['teal'],pot,n=6)
        direction=tip-joint
        side=direction.cross(Vector((0,1,0))).normalized()
        points=[]
        for j in range(4):
            t=j/3
            center=joint+direction*t+Vector((0,sin(t*pi)*.09*scale,0))
            w=sin(t*pi)*(.10+.025*(i%3))*scale
            points.extend([center-side*w,center+Vector((0,.018*scale,0)),center+side*w])
        faces=[]
        for j in range(3):
            for k in range(2):
                a=j*3+k
                faces.append((a,a+1,a+4,a+3))
        foliage=mesh(name+'CurvedLeaf',points,faces,palette['sage' if i%3 else 'teal'],pot,smooth=False)
        solid=foliage.modifiers.new('Leaf thickness','SOLIDIFY');solid.thickness=.003*scale
    return pot
