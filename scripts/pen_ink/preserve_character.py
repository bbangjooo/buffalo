"""Copy compressed baseline robot attributes, including baked AO, into new GLB.

The room source .blend intentionally has no web AO bake. Transplanting the
original compressed primitives avoids changing the character while replacing
the environment's materials and authoring method.
"""
import copy
import hashlib
import json
import struct


def read_glb(path):
    raw=path.read_bytes()
    size=struct.unpack_from('<I',raw,12)[0]
    document=json.loads(raw[20:20+size])
    binary=raw[28+size:]
    return document,binary


def transplant_robot(source_path,destination_path):
    baseline,old_bin=read_glb(source_path)
    output,new_bin=read_glb(destination_path)
    old_nodes={node.get('name'):node for node in baseline['nodes']}
    robot_root=next(i for i,node in enumerate(baseline['nodes']) if node.get('name')=='Robot')
    queue=[robot_root];robot_names=set()
    while queue:
        node=baseline['nodes'][queue.pop()]
        robot_names.add(node['name'])
        queue.extend(node.get('children',[]))
    matches=[node for node in output['nodes'] if node.get('name') in robot_names and 'mesh' in old_nodes[node['name']]]
    if not matches:raise ValueError('No baseline robot meshes matched')
    # Offsets retain the compressed byte payload verbatim. Only referenced
    # bufferViews/accessors/materials are copied into the new JSON tables.
    binary_offset=len(new_bin)
    material_map={};accessor_map={};view_map={};hashes=[]
    def view(index):
        if index not in view_map:
            original=baseline['bufferViews'][index]
            item=copy.deepcopy(original);item['buffer']=0
            item['byteOffset']=item.get('byteOffset',0)+binary_offset
            view_map[index]=len(output.setdefault('bufferViews',[]))
            output['bufferViews'].append(item)
            start=original.get('byteOffset',0)
            hashes.append(hashlib.sha256(old_bin[start:start+original['byteLength']]).hexdigest())
        return view_map[index]
    def accessor(index):
        if index not in accessor_map:
            item=copy.deepcopy(baseline['accessors'][index])
            if 'bufferView' in item:item['bufferView']=view(item['bufferView'])
            if 'sparse' in item:
                for part in ['indices','values']:item['sparse'][part]['bufferView']=view(item['sparse'][part]['bufferView'])
            accessor_map[index]=len(output.setdefault('accessors',[]))
            output['accessors'].append(item)
        return accessor_map[index]
    def material(index):
        if index not in material_map:
            item=copy.deepcopy(baseline['materials'][index])
            material_map[index]=len(output.setdefault('materials',[]))
            output['materials'].append(item)
        return material_map[index]
    count=0
    for node in matches:
        original=old_nodes[node['name']]
        cloned=copy.deepcopy(baseline['meshes'][original['mesh']])
        for primitive in cloned['primitives']:
            primitive['attributes']={name:accessor(index) for name,index in primitive['attributes'].items()}
            if 'indices' in primitive:primitive['indices']=accessor(primitive['indices'])
            if 'material' in primitive:primitive['material']=material(primitive['material'])
            draco=primitive.get('extensions',{}).get('KHR_draco_mesh_compression')
            if draco:draco['bufferView']=view(draco['bufferView'])
            if 'COLOR_0' in primitive['attributes']:count+=1
        node['mesh']=len(output['meshes']);output['meshes'].append(cloned)
        node.setdefault('extras',{})['originalRobotPayloadPreserved']=True
    if count!=len(matches):raise ValueError(f'Robot AO preservation failed: {count}/{len(matches)}')
    # Remove replaced mesh descriptors so manifest triangle totals describe the
    # actual asset, with no orphan copy of the newly exported robot remaining.
    referenced=sorted({node['mesh'] for node in output['nodes'] if 'mesh' in node})
    mesh_map={old:new for new,old in enumerate(referenced)}
    output['meshes']=[output['meshes'][old] for old in referenced]
    for node in output['nodes']:
        if 'mesh' in node:node['mesh']=mesh_map[node['mesh']]
    combined=new_bin+old_bin
    output['buffers']=[{'byteLength':len(combined)}]
    for category in ['extensionsUsed','extensionsRequired']:
        output[category]=sorted(set(output.get(category,[])+baseline.get(category,[])))
    encoded=json.dumps(output,separators=(',',':')).encode()
    encoded+=b' '*((-len(encoded))%4)
    combined+=b'\0'*((-len(combined))%4)
    total=12+8+len(encoded)+8+len(combined)
    destination_path.write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(combined),0x004e4942)+combined)
    return {'meshPrimitives':len(matches),'colorAOPrimitives':count,'compressedPayloadsCopied':len(view_map),
            'payloadSha256':hashes,'method':'Original compressed bufferView bytes and material/accessor descriptors transplanted without re-encoding.'}
