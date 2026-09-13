/* Inspect the shipped GLBs, not screenshots or generator assertions.
 * Uses the already-shipped Draco decoder to inspect actual vertex colours,
 * keyboard visibility and preserved compressed robot data without a browser.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const THREE = require('three');

const ROOT = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name));
const json = name => JSON.parse(read(name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.message}`); }
}
function near(a, b, message, tolerance = 5e-5) {
  assert.equal(a.length, b.length, message);
  assert(a.every((value, i) => Math.abs(value - b[i]) <= tolerance), `${message}: ${a} != ${b}`);
}
function glb(name) {
  const bytes = read(`public/Room/${name}.glb`);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const chunks = new Map();
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    chunks.set(type, bytes.subarray(offset + 8, offset + 8 + length)); offset += 8 + length;
  }
  const data = JSON.parse(chunks.get(0x4e4f534a));
  const bin = chunks.get(0x004e4942);
  const nodes = new Map(data.nodes.map((node, index) => [node.name, { ...node, index }]));
  assert.equal(nodes.size, data.nodes.length, `${name}: duplicate node names`);
  const parents = new Map();
  data.nodes.forEach((node, index) => node.children?.forEach(child => parents.set(child, index)));
  const result = { name, bytes, data, bin, nodes, parents };
  result.within = (index, ancestor) => {
    while (index !== undefined) {
      if (data.nodes[index].name === ancestor) return true;
      index = parents.get(index);
    }
    return false;
  };
  result.world = index => {
    const node = data.nodes[index];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale || [1, 1, 1]));
    return parents.has(index) ? result.world(parents.get(index)).multiply(local) : local;
  };
  result.view = index => {
    const view = data.bufferViews[index];
    assert.equal(view.buffer, 0, 'GLB payload must remain self-contained');
    return bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  };
  // Character payload transplantation may retain unused mesh definitions.
  // Count only meshes actually referenced by scene nodes, once per geometry.
  const referencedMeshes = new Set(data.nodes.filter(node => node.mesh !== undefined).map(node => node.mesh));
  result.triangles = [...referencedMeshes].flatMap(index => data.meshes[index].primitives).reduce((sum, primitive) =>
    sum + (primitive.indices === undefined ? data.accessors[primitive.attributes.POSITION].count : data.accessors[primitive.indices].count) / 3, 0);
  return result;
}
function preserveTransforms(before, after, names) {
  for (const name of names) {
    const a = before.nodes.get(name), b = after.nodes.get(name);
    assert(a && b, `${after.name}: missing ${name}`);
    near(before.world(a.index).elements, after.world(b.index).elements, `${name} world transform`);
    const parentName = (asset, node) => asset.data.nodes[asset.parents.get(node.index)]?.name;
    assert.equal(parentName(after, b), parentName(before, a), `${name} parent/pivot ownership`);
  }
}
function primitiveFingerprint(asset, primitive) {
  function accessor(index) {
    const value = asset.data.accessors[index];
    const { bufferView, ...rest } = value;
    return { ...rest, ...(bufferView === undefined ? {} : { bytes: sha(asset.view(bufferView)) }) };
  }
  const compression = primitive.extensions?.KHR_draco_mesh_compression;
  return {
    attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, accessor(index)])),
    indices: primitive.indices === undefined ? null : accessor(primitive.indices),
    material: asset.data.materials[primitive.material],
    mode: primitive.mode ?? 4,
    compression: compression ? { attributes: compression.attributes, bytes: sha(asset.view(compression.bufferView)) } : null,
  };
}

async function loadDraco() {
  const filename = path.join(ROOT, 'public/draco/gltf/draco_decoder.js');
  const sandbox = { module: { exports: {} }, exports: {}, require, __filename: filename,
    __dirname: path.dirname(filename), process, console, Buffer, TextDecoder, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  // This decoder is an old thenable; wrapping it prevents recursive promise
  // assimilation of the module's own .then method.
  return new Promise(resolve => sandbox.module.exports().then(module => resolve({ module })));
}
function decode(asset, primitive, draco) {
  const compression = primitive.extensions?.KHR_draco_mesh_compression;
  assert(compression, `${asset.name}: expected the shipped compressed mesh contract`);
  const decoder = new draco.Decoder();
  const buffer = new draco.DecoderBuffer();
  const bytes = asset.view(compression.bufferView);
  buffer.Init(new Int8Array(bytes), bytes.length);
  const mesh = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  assert(status.ok() && mesh.ptr, `${asset.name}: corrupt Draco mesh`);
  const values = {};
  for (const name of ['POSITION', 'COLOR_0']) {
    if (compression.attributes[name] === undefined) continue;
    const attribute = decoder.GetAttributeByUniqueId(mesh, compression.attributes[name]);
    const output = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attribute, output);
    const array = new Float32Array(output.size());
    for (let i = 0; i < array.length; i++) array[i] = output.GetValue(i);
    values[name] = { array, size: attribute.num_components() };
    draco.destroy(output);
  }
  const faces = new Uint32Array(mesh.num_faces() * 3), face = new draco.DracoInt32Array();
  for (let i = 0; i < mesh.num_faces(); i++) {
    decoder.GetFaceFromMesh(mesh, i, face);
    for (let j = 0; j < 3; j++) faces[i * 3 + j] = face.GetValue(j);
  }
  draco.destroy(face); draco.destroy(mesh); draco.destroy(buffer); draco.destroy(decoder);
  return { ...values, indices: faces };
}
function makeDecodedScene(asset, draco) {
  const root = new THREE.Group();
  for (const node of asset.nodes.values()) {
    if (node.mesh === undefined) continue;
    for (const primitive of asset.data.meshes[node.mesh].primitives) {
      const decoded = decode(asset, primitive, draco);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(decoded.POSITION.array, decoded.POSITION.size));
      geometry.setIndex(new THREE.BufferAttribute(decoded.indices, 1));
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = node.name; mesh.userData.nodeIndex = node.index; mesh.userData.decoded = decoded;
      mesh.userData.primitive = primitive;
      mesh.matrix.copy(asset.world(node.index)); mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
  }
  root.updateMatrixWorld(true);
  return root;
}

async function main() {
  const original = glb('four-rooms'), rooms = glb('pen-ink-rooms');
  const oldCourtyard = glb('courtyard'), courtyard = glb('pen-ink-courtyard');
  const originalManifest = json('assets/four-rooms-manifest.json');
  const manifest = json('assets/pen-ink-rooms-manifest.json');
  check('all original room groups, interactions and dynamic pivots keep their names, parents and world transforms', () => {
    const names = new Set([...original.nodes.values()].filter(node => node.mesh === undefined).map(node => node.name));
    originalManifest.dynamicObjects.forEach(name => names.add(name));
    preserveTransforms(original, rooms, names);
  });
  check('every original outdoor exhibition and screen anchor keeps its transform and aperture', () => {
    const names = [...oldCourtyard.nodes.values()].filter(node => node.mesh === undefined).map(node => node.name);
    preserveTransforms(oldCourtyard, courtyard, names);
    for (const name of names.filter(value => value.startsWith('ScreenAnchor_'))) {
      const a = oldCourtyard.nodes.get(name).extras, b = courtyard.nodes.get(name).extras;
      near([a.width, a.height], [b.width, b.height], name);
    }
  });
  check('robot mesh data, compressed vertex colours, materials and transforms are byte-preserved', () => {
    const before = [...original.nodes.values()].filter(node => original.within(node.index, 'Robot'));
    const after = [...rooms.nodes.values()].filter(node => rooms.within(node.index, 'Robot'));
    assert.deepEqual(after.map(node => node.name).sort(), before.map(node => node.name).sort());
    preserveTransforms(original, rooms, before.map(node => node.name));
    for (const node of before) {
      if (node.mesh === undefined) continue;
      const target = rooms.nodes.get(node.name);
      const a = original.data.meshes[node.mesh].primitives.map(primitive => primitiveFingerprint(original, primitive));
      const b = rooms.data.meshes[target.mesh].primitives.map(primitive => primitiveFingerprint(rooms, primitive));
      assert.deepEqual(b, a, node.name);
      assert(!target.extras?.penInkAuthored, `${node.name} was marked as environment`);
    }
  });
  check('all three hamster variants and the original models remain unchanged from the branch baseline', () => {
    for (const name of ['character-guide', 'character-guide-smooth', 'character-guide-faceted', 'four-rooms', 'courtyard']) {
      const filename = `public/Room/${name}.glb`;
      const baseline = execFileSync('git', ['show', `HEAD:${filename}`], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
      assert.equal(sha(read(filename)), sha(baseline), filename);
    }
  });
  check('all environment materials are unlit neutral ink/paper with no inherited AO or texture wash', () => {
    for (const asset of [rooms, courtyard]) for (const node of asset.nodes.values()) {
      if (node.mesh === undefined || asset.within(node.index, 'Robot')) continue;
      assert(node.extras?.penInkAuthored, `${asset.name}/${node.name}: missing authored marker`);
      for (const primitive of asset.data.meshes[node.mesh].primitives) {
        const material = asset.data.materials[primitive.material];
        assert(material.extensions?.KHR_materials_unlit, `${asset.name}/${material.name}: physically shaded`);
        const color = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
        near(color.slice(0, 3), [color[0], color[0], color[0]], material.name, 1e-5);
        assert(color[0] < .2 || color[0] > .95, `${material.name}: broad grey wash`);
        assert(!material.occlusionTexture && !material.pbrMetallicRoughness?.baseColorTexture, `${material.name}: inherited texture`);
        if (asset === rooms) assert(primitive.attributes.COLOR_0 === undefined, `${node.name}: inherited room AO`);
      }
    }
  });
  check('legacy botanical geometry remains isolated in the two groups hidden by the sparse atlas', () => {
    for (const name of ['MeadowGrassClump', 'MeadowFlower', 'MeadowRock', 'MeadowInkShrub', 'MeadowInkTree']) {
      const node = courtyard.nodes.get(name);
      assert(node && node.mesh !== undefined, name);
      assert(courtyard.within(node.index, 'MeadowTemplates'), `${name}: template not hidden with its source group`);
    }
    const garden = courtyard.nodes.get('PenInkGardenPlanting');
    assert(garden && courtyard.within(garden.index, 'PenInkGarden'), 'legacy border planting escaped its hideable group');
  });
  check('the exported scenes contain more actual geometry and authored furnishings in every room', () => {
    assert(rooms.triangles > original.triangles && courtyard.triangles > oldCourtyard.triangles, 'detail did not increase');
    assert.equal(manifest.triangles, rooms.triangles, 'room manifest no longer matches actual export');
    assert.equal(manifest.fileBytes, rooms.bytes.length, 'room manifest file size is stale');
    for (const name of Object.keys(originalManifest.rooms)) {
      assert(manifest.penInk.addedObjects[name] > 0, `${name}: no additional furnishings`);
      assert([...rooms.nodes.values()].some(node => rooms.within(node.index, name) && node.extras?.penInkStroke && node.mesh !== undefined), `${name}: no physical pen strokes`);
    }
    console.log(`  Geometry: rooms ${original.triangles.toLocaleString()} → ${rooms.triangles.toLocaleString()} triangles; courtyard ${oldCourtyard.triangles.toLocaleString()} → ${courtyard.triangles.toLocaleString()}.`);
  });

  const { module: draco } = await loadDraco();
  const oldScene = makeDecodedScene(original, draco), roomScene = makeDecodedScene(rooms, draco);
  const gardenScene = makeDecodedScene(courtyard, draco);
  check('decoded outdoor vertex colours contain discrete neutral paper/ink and no old coloured AO', () => {
    let white = 0, ink = 0;
    for (const mesh of gardenScene.children) {
      const color = mesh.userData.decoded.COLOR_0;
      if (!color) continue;
      for (let i = 0; i < color.array.length; i += color.size) {
        const [r, g, b] = color.array.subarray(i, i + 3);
        near([r, g, b], [r, r, r], `${mesh.name}: coloured vertex`, .006);
        assert(r < .2 || r > .95, `${mesh.name}: grey AO ${r}`);
        if (r > .95) white++; else ink++;
      }
    }
    assert(white > 0 && ink > 0, 'botanical vertex colours must contain both paper and ink');
    console.log(`  Decoded outdoor vertex samples: ${white.toLocaleString()} paper; ${ink.toLocaleString()} ink.`);
  });
  check('all piano key solids remain within their original bounds plus a narrow physical ink margin', () => {
    const bounds = (asset, scene, name) => {
      const box = new THREE.Box3();
      for (const mesh of scene.children) if (asset.within(mesh.userData.nodeIndex, name)) box.union(new THREE.Box3().setFromObject(mesh));
      assert(!box.isEmpty(), `${name}: missing key geometry`); return box;
    };
    for (let midi = 60; midi <= 83; midi++) {
      const name = `PianoKey${midi}`, before = bounds(original, oldScene, name), after = bounds(rooms, roomScene, name);
      assert(before.clone().expandByScalar(.02).containsBox(after), `${name}: ink geometry blocks neighbouring keys`);
      assert(after.clone().expandByScalar(.02).containsBox(before), `${name}: original key surface missing`);
    }
  });
  check('the seated view still reaches the same piano key surfaces without a new roof or decoration blocking them', () => {
    const eye = new THREE.Vector3().setFromMatrixPosition(original.world(original.nodes.get('PianoEyeAnchor').index));
    const ray = new THREE.Raycaster(); let compared = 0;
    const owner = (asset, hit) => {
      let index = hit?.object.userData.nodeIndex;
      while (index !== undefined) {
        const name = asset.data.nodes[index].name;
        if (/^PianoKey\d+$/.test(name)) return name;
        index = asset.parents.get(index);
      }
      return hit?.object.name;
    };
    for (let midi = 60; midi <= 83; midi++) {
      const name = `PianoKey${midi}`, box = new THREE.Box3();
      for (const mesh of oldScene.children) if (original.within(mesh.userData.nodeIndex, name)) box.union(new THREE.Box3().setFromObject(mesh));
      const point = box.getCenter(new THREE.Vector3()); point.y = box.max.y - .001;
      ray.set(eye, point.sub(eye).normalize());
      const before = ray.intersectObjects(oldScene.children, false)[0];
      if (owner(original, before) !== name) continue; // Compare only keys visible in the approved baseline.
      const after = ray.intersectObjects(roomScene.children, false)[0];
      assert.equal(owner(rooms, after), name, `${name}: new foreground surface ${after?.object.name}`);
      compared++;
    }
    assert(compared > 0, 'seated-view rays did not exercise any baseline key');
    console.log(`  Seated keyboard: ${compared} independently visible baseline keys remain reachable.`);
  });
  for (const scene of [oldScene, roomScene, gardenScene]) for (const mesh of scene.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
  if (!process.exitCode) console.log(`Pen-and-ink asset contract: ${passed} checks passed.`);
}
main().catch(error => { process.exitCode = 1; console.error(error.stack); });
