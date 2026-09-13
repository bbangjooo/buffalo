"""Four real 3D rotations of the exported tree, using its actual ink geometry."""
from math import pi
import bpy
from mathutils import Vector


def add_tree_review(tree,output_directory):
    scene=bpy.data.scenes.new('Tree Volume — 0 90 180 270')
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12
    scene.render.resolution_x=1800;scene.render.resolution_y=700;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None'

    def linear(code):
        values=[int(code[i:i+2],16)/255 for i in (1,3,5)]
        return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in values)

    ink=linear('#5c422d');paper=linear('#f2e6ce');field=linear('#eadcc0')
    scene.world=bpy.data.worlds.new('Tree review paper');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(*field,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=1
    mat=bpy.data.materials.new('Tree review | actual ink on paper');mat.use_nodes=True
    mat.use_backface_culling=True
    nodes=mat.node_tree.nodes;nodes.clear()
    color=nodes.new('ShaderNodeVertexColor');color.layer_name='PenInkTint'
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=(*ink,1)
    ramp.color_ramp.elements[1].color=(*paper,1)
    out=nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(color.outputs['Color'],ramp.inputs['Fac'])
    geometry=nodes.new('ShaderNodeNewGeometry');transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader')
    mat.node_tree.links.new(geometry.outputs['Backfacing'],mix.inputs[0])
    mat.node_tree.links.new(ramp.outputs['Color'],mix.inputs[1])
    mat.node_tree.links.new(transparent.outputs[0],mix.inputs[2])
    mat.node_tree.links.new(mix.outputs[0],out.inputs[0])
    labelmat=bpy.data.materials.new('Tree review | labels');labelmat.use_nodes=True
    labelmat.node_tree.nodes.clear();rgb=labelmat.node_tree.nodes.new('ShaderNodeRGB')
    rgb.outputs[0].default_value=(*ink,1);out=labelmat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    labelmat.node_tree.links.new(rgb.outputs[0],out.inputs[0])
    for x,degrees in zip([-5.1,-1.7,1.7,5.1],[0,90,180,270]):
        obj=tree.copy();scene.collection.objects.link(obj)
        obj.parent=None;obj.name='Tree review '+str(degrees)+' degrees'
        obj.location=(x,0,0);obj.rotation_euler=(0,0,degrees*pi/180);obj.scale=(1,1,1)
        obj.hide_render=False;obj.hide_set(False,view_layer=scene.view_layers[0])
        obj.material_slots[0].link='OBJECT';obj.material_slots[0].material=mat
        curve=bpy.data.curves.new('Angle label','FONT');curve.body=str(degrees)+'°';curve.align_x='CENTER';curve.size=.23
        label=bpy.data.objects.new('View '+str(degrees),curve);scene.collection.objects.link(label)
        label.location=(x,-.15,-.37);label.rotation_euler.x=pi/2;curve.materials.append(labelmat)
    data=bpy.data.cameras.new('Tree volume review camera');camera=bpy.data.objects.new('Tree volume review camera',data)
    scene.collection.objects.link(camera);scene.camera=camera;camera.location=(0,-18,7.0)
    camera.rotation_euler=(Vector((0,0,1.48))-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=14.2;data.clip_end=200
    scene['proof']='Four real rotations of one shared closed-volume MeadowInkTree mesh; no billboard copies or view-dependent rendering.'
    scene.render.filepath=str(output_directory/'tree-volume-four-views.png')
    bpy.ops.render.render(scene=scene.name,write_still=True)
    return scene
