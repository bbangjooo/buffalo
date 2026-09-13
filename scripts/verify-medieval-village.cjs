/* Atlas contract: curated scenery, protected navigation and night lifecycle.
 * Retains the historical script name so existing verification commands work.
 * Run alongside verify-pen-ink.cjs to prove the protected original rooms.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const THREE = require('three');
const ROOT = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const layout = JSON.parse(read('src/design/medieval-village-layout.json'));
const courtyard = JSON.parse(read('src/design/courtyard-layout.json'));
const RADIUS = .4;
const colorsClose = (a, b, tolerance = 1e-10) => a.toArray().every((value, i) => Math.abs(value - b.toArray()[i]) < tolerance);
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.message}`); }
}
function loadTS(file, resolve, extra = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2016,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const sandbox = { exports: {}, require: resolve, ...extra };
  vm.runInNewContext(code, sandbox, { filename: file }); return sandbox.exports;
}
const { CourtyardWalk } = loadTS('src/Application/World/CourtyardWalk.ts', name => {
  if (name.endsWith('/history')) return { COURTYARD: courtyard };
  throw new Error(`Unexpected walker dependency ${name}`);
});
function oldClear(x, z, slack = 0) {
  if (Math.abs(x) < courtyard.houseHalfSize + RADIUS + slack && Math.abs(z) < courtyard.houseHalfSize + RADIUS + slack) return false;
  return courtyard.obstacles.every(o => Math.hypot(x - o.x, z - o.z) >= o.radius + RADIUS + slack)
    && courtyard.stations.every(s => Math.hypot(x - s.x, z - s.z) >= 2 + slack);
}
function clear(x, z, margin = RADIUS) {
  return oldClear(x, z, Math.max(0, margin - RADIUS)) && layout.obstacles.every(o => Math.hypot(x - o.x, z - o.z) >= o.radius + margin - 1e-8);
}
function segmentClear(a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .08);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    if (!clear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, RADIUS + .005)) return false;
  }
  return true;
}
function moveTo(walker, x, z) {
  const distance = Math.hypot(x - walker.x, z - walker.z), heading = Math.atan2(x - walker.x, z - walker.z);
  walker.stop(); walker.setInput('route', 'up');
  for (let remaining = distance / 8.4 * 1000; remaining > 1e-7;) {
    const delta = Math.min(10, remaining); walker.update(delta, heading); remaining -= delta;
    assert(clear(walker.x, walker.z), 'route entered a solid');
  }
  assert(Math.hypot(x - walker.x, z - walker.z) < 1e-5, `route blocked before (${x},${z})`);
}
function verifyMovement() {
  check('solid geometry has finite unique collision circles and does not cover protected spawns or roads', () => {
    assert(layout.obstacles.length > 0, 'no village solids');
    assert.equal(new Set(layout.obstacles.map(o => o.id)).size, layout.obstacles.length, 'duplicate collider id');
    for (const o of layout.obstacles) {
      assert([o.x, o.z, o.radius].every(Number.isFinite) && o.radius > 0, o.id);
      assert(Math.abs(o.x) - o.radius >= layout.crossPathHalfWidth - 1e-5, `${o.id}: covers north/south road`);
      assert(Math.abs(o.z) - o.radius >= layout.crossPathHalfWidth - 1e-5, `${o.id}: covers east/west road`);
      for (const s of courtyard.stations) assert(Math.hypot(s.x - o.x, s.z - o.z) >= o.radius + 2, `${o.id}: original station solid ${s.id}`);
    }
    const destinations = [...courtyard.quadrants.map(q => ({ name: q.room, x: q.spawn[0], z: q.spawn[1] })),
      ...courtyard.stations.map(s => ({ name: s.id, x: s.x + Math.sin(s.yaw) * 2.7, z: s.z + Math.cos(s.yaw) * 2.7 }))];
    for (const p of destinations) assert(clear(p.x, p.z), `${p.name}: visitor spawn overlaps a solid`);
  });
  check('the public walker blocks village circles while sprinting/jumping and clearing the set restores open ground', () => {
    const walker = new CourtyardWalk();
    assert.equal(typeof walker.setVillageObstacles, 'function');
    for (const sprint of [false, true]) {
      walker.stop(); walker.x = 2.5; walker.z = 100;
      walker.setVillageObstacles([{ id: 'test-well', x: 0, z: 100, radius: 1.2 }]);
      walker.setInput('forward', 'up'); walker.setSprint('ShiftLeft', sprint); walker.jump();
      for (let i = 0; i < 40; i++) {
        walker.update(50, -Math.PI / 2);
        assert(Math.hypot(walker.x, walker.z - 100) >= 1.6 - 1e-8, 'entered the supplied solid');
      }
      assert(walker.x >= 1.6 && walker.x < 1.8, 'never approached the obstacle boundary');
    }
    walker.setVillageObstacles([]); walker.update(50, -Math.PI / 2);
    assert(walker.x < 1.6, 'old collision remains after clearing the auxiliary village');
  });
  check('the authored atlas landmarks remain solid from all available approach angles', () => {
    const walker = new CourtyardWalk(); walker.setVillageObstacles(layout.obstacles);
    let approaches = 0;
    for (const o of layout.obstacles) {
      let exercised = 0;
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, distance = o.radius + RADIUS + .6;
        const start = { x: o.x + Math.sin(a) * distance, z: o.z + Math.cos(a) * distance };
        if (!clear(start.x, start.z)) continue;
        walker.stop(); walker.x = start.x; walker.z = start.z;
        walker.setInput('approach', 'up'); walker.setSprint('ShiftLeft', true); walker.jump();
        for (let step = 0; step < 30; step++) {
          walker.update(50, a + Math.PI);
          assert(clear(walker.x, walker.z), `${o.id}: sprint/jump entered a solid at angle ${i}`);
        }
        exercised++; approaches++;
      }
      assert(exercised > 0, `${o.id}: no testable free approach; possible enclosed pocket`);
    }
    console.log(`  ${approaches} solid approaches exercised with sprint and jump.`);
  });
  check('every existing screen and quadrant spawn connects to the entrance through actual walker motion', () => {
    const spacing = .4, min = -40, count = 201;
    const allowed = new Uint8Array(count * count), visited = new Uint8Array(allowed.length);
    const parent = new Int32Array(allowed.length).fill(-1);
    const point = index => ({ x: min + index % count * spacing, z: min + Math.floor(index / count) * spacing });
    for (let i = 0; i < allowed.length; i++) { const p = point(i); allowed[i] = clear(p.x, p.z, RADIUS + .005) ? 1 : 0; }
    const attach = p => {
      const ix = Math.round((p.x - min) / spacing), iz = Math.round((p.z - min) / spacing), candidates = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx, z = iz + dz, id = z * count + x;
        if (x < 0 || z < 0 || x >= count || z >= count || !allowed[id]) continue;
        if (segmentClear(p, point(id))) candidates.push(id);
      }
      return candidates;
    };
    const entrance = { x: courtyard.entrance[0], z: courtyard.entrance[1] }, roots = attach(entrance);
    assert(roots.length, 'entrance has no exit');
    const queue = roots.slice(); roots.forEach(id => { visited[id] = 1; });
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor], x = id % count, z = Math.floor(id / count);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, next = nz * count + nx;
        if (nx < 0 || nz < 0 || nx >= count || nz >= count || visited[next] || !allowed[next]) continue;
        if (!segmentClear(point(id), point(next))) continue;
        visited[next] = 1; parent[next] = id; queue.push(next);
      }
    }
    const destinations = [...courtyard.quadrants.map(q => ({ name: q.room, x: q.spawn[0], z: q.spawn[1] })),
      ...courtyard.stations.map(s => ({ name: s.id, x: s.x + Math.sin(s.yaw) * 2.7, z: s.z + Math.cos(s.yaw) * 2.7 }))];
    const walker = new CourtyardWalk(); walker.setVillageObstacles(layout.obstacles);
    for (const destination of destinations) {
      const end = attach(destination).find(id => visited[id]);
      assert(end !== undefined, `${destination.name}: disconnected by village solids`);
      const route = []; for (let id = end; id !== -1; id = parent[id]) route.push(point(id)); route.reverse();
      walker.place();
      for (const p of [...route, destination]) moveTo(walker, p.x, p.z);
    }
    // Cross roads have a physical width. The visitor centre stays one radius
    // inside that width, rather than requiring extra scenery clearance beyond it.
    for (const side of [-1, 1]) for (const offset of [0, layout.crossPathHalfWidth - RADIUS - .02, -layout.crossPathHalfWidth + RADIUS + .02]) {
      for (const horizontal of [false, true]) {
        const start = horizontal ? [side * 7, offset] : [offset, side * 7];
        const end = horizontal ? [side * 30, offset] : [offset, side * 30];
        walker.stop(); [walker.x, walker.z] = start; moveTo(walker, ...end);
      }
    }
    console.log(`  ${destinations.length} destinations and 12 cross-road traversals completed.`);
  });
}

async function decodeVillage(filename = 'public/Room/medieval-village.glb') {
  const bytes = fs.readFileSync(path.join(ROOT, filename));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12), data = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength), parents = new Map();
  data.nodes.forEach((n, i) => n.children?.forEach(child => parents.set(child, i)));
  const world = i => {
    const n = data.nodes[i], local = n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(n.translation || [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(n.scale || [1, 1, 1]));
    return parents.has(i) ? world(parents.get(i)).multiply(local) : local;
  };
  const decoderPath = path.join(ROOT, 'public/draco/gltf/draco_decoder.js');
  const sandbox = { module: { exports: {} }, exports: {}, require, __filename: decoderPath, __dirname: path.dirname(decoderPath),
    process, console, Buffer, TextDecoder, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(decoderPath, 'utf8'), sandbox);
  const { draco } = await new Promise(resolve => sandbox.module.exports().then(draco => resolve({ draco })));
  const root = new THREE.Group();
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i]; if (node.mesh === undefined) continue;
    for (const primitive of data.meshes[node.mesh].primitives) {
      const ext = primitive.extensions.KHR_draco_mesh_compression, view = data.bufferViews[ext.bufferView];
      const payload = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), mesh = new draco.Mesh();
      buffer.Init(new Int8Array(payload), payload.length);
      assert(decoder.DecodeBufferToMesh(buffer, mesh).ok(), node.name);
      const geometry = new THREE.BufferGeometry();
      for (const [name, semantic] of [['position', 'POSITION'], ['color', 'COLOR_0']]) {
        if (ext.attributes[semantic] === undefined) continue;
        const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes[semantic]), values = new draco.DracoFloat32Array();
        decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
        const array = new Float32Array(values.size()); for (let j = 0; j < array.length; j++) array[j] = values.GetValue(j);
        geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.num_components())); draco.destroy(values);
      }
      const faces = new Uint32Array(mesh.num_faces() * 3), face = new draco.DracoInt32Array();
      for (let j = 0; j < mesh.num_faces(); j++) { decoder.GetFaceFromMesh(mesh, j, face); for (let k = 0; k < 3; k++) faces[j * 3 + k] = face.GetValue(k); }
      geometry.setIndex(new THREE.BufferAttribute(faces, 1));
      const gltfMaterial = data.materials[primitive.material];
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: geometry.hasAttribute('color') });
      material.name = gltfMaterial.name;
      material.color.fromArray(gltfMaterial.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1]);
      const rendered = new THREE.Mesh(geometry, material);
      rendered.name = node.name; rendered.matrix.copy(world(i)); rendered.matrixAutoUpdate = false;
      rendered.userData = { ...node.extras, nodeIndex: i, gltfMaterial }; root.add(rendered);
      [face, mesh, buffer, decoder].forEach(value => draco.destroy(value));
    }
  }
  root.updateMatrixWorld(true);
  return { root, data, parents, world };
}
function verifyGeometry(asset) {
  const { root, data, world } = asset;
  check('background structures match the explicit landmark inventory and stay within its detail budget', () => {
    const features = [...layout.cottages.map(c => ({ node: `VillageCottage_${c.id}`, collider: `cottage-${c.id}` })),
      ...layout.props.map(p => ({ node: `VillageProp_${p.id}`, collider: p.id }))];
    assert.equal(layout.landmarkCount, features.length);
    assert(layout.landmarkCount <= layout.limits.maxLandmarks, 'background landmark budget exceeded');
    assert.deepEqual(layout.obstacles.map(o => o.id).sort(), features.map(f => f.collider).sort());
    const village = data.nodes.find(node => node.name === 'MedievalVillage');
    assert(village);
    assert.deepEqual(village.children.map(index => data.nodes[index].name).sort(), features.map(f => f.node).sort());
    const triangles = data.meshes.flatMap(mesh => mesh.primitives).reduce((total, primitive) => total + data.accessors[primitive.indices].count / 3, 0);
    assert(triangles <= layout.limits.maxTriangles, 'background geometry overtook its authored detail budget');
    for (const node of data.nodes) {
      if (node.mesh === undefined) continue;
      let index = data.nodes.indexOf(node), owner;
      while (asset.parents.has(index)) { index = asset.parents.get(index); if (/^Village(Cottage|Prop)_/.test(data.nodes[index].name)) owner = data.nodes[index].name; }
      assert(features.some(f => f.node === owner), `${node.name}: undeclared background object`);
    }
  });
  check('the auxiliary GLB contains every authored cottage/torch and neutral unlit pen geometry', () => {
    assert(!data.images?.length && !data.textures?.length, 'village unexpectedly contains image textures');
    const names = new Set(data.nodes.map(n => n.name));
    for (const object of [...layout.cottages.map(c => ({ ...c, node: `VillageCottage_${c.id}` })),
      ...layout.props.map(p => ({ ...p, node: `VillageProp_${p.id}` }))]) {
      assert(names.has(object.node), object.id);
      const index = data.nodes.findIndex(n => n.name === object.node), transform = world(index);
      const position = new THREE.Vector3().setFromMatrixPosition(transform);
      assert(position.distanceTo(new THREE.Vector3(object.x, layout.groundY, object.z)) < .0001, `${object.id}: placement differs from collision layout`);
      const rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      transform.decompose(new THREE.Vector3(), rotation, scale);
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), object.yaw);
      assert(rotation.angleTo(expected) < .0001, `${object.id}: incorrect authored orientation`);
      assert(scale.distanceTo(new THREE.Vector3().setScalar(object.scale || 1)) < .0001, `${object.id}: incorrect authored scale`);
    }
    for (const torch of layout.torches) {
      const i = data.nodes.findIndex(n => n.name === `TorchAnchor_${torch.id}`); assert(i >= 0, torch.id);
      const p = new THREE.Vector3().setFromMatrixPosition(world(i));
      assert(p.distanceTo(new THREE.Vector3(torch.x, torch.y, torch.z)) < .0001, `${torch.id}: fire anchor mismatch`);
      const cottage = layout.cottages.find(item => item.id === torch.id);
      if (cottage) {
        const scale = new THREE.Vector3().setFromMatrixScale(world(i));
        assert(scale.distanceTo(new THREE.Vector3().setScalar(cottage.scale || 1)) < .0001, `${torch.id}: torch lost its cottage scale`);
      }
    }
    assert(layout.torches.length > 0, 'no authored fire anchors');
    for (const mesh of root.children) {
      const material = mesh.userData.gltfMaterial; assert(material.extensions?.KHR_materials_unlit, `${mesh.name}: shaded paper`);
      const factor = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
      assert(Math.abs(factor[0] - factor[1]) < .001 && Math.abs(factor[1] - factor[2]) < .001, `${mesh.name}: coloured daytime material`);
      const color = mesh.geometry.getAttribute('color');
      if (!color) continue;
      for (let i = 0; i < color.count; i++) {
        const r = color.getX(i), g = color.getY(i), b = color.getZ(i);
        assert(Math.abs(r - g) < .004 && Math.abs(g - b) < .004, `${mesh.name}: non-neutral vertex colour`);
      }
    }
  });
  check('actual walk-height village vertices are covered by solid collision footprints', () => {
    const p = new THREE.Vector3(); let sampled = 0, worst = -Infinity, offender = '';
    for (const mesh of root.children) {
      if (mesh.name.includes('Cobble')) continue;
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (p.y < layout.groundY + .04 || p.y > layout.groundY + 1.8) continue;
        const outside = Math.min(...layout.obstacles.map(o => Math.hypot(p.x - o.x, p.z - o.z) - o.radius));
        if (outside > worst) { worst = outside; offender = mesh.name; }
        sampled++;
      }
    }
    assert(sampled > 0, 'no village body vertices checked');
    assert(worst <= .025, `${offender}: body extends ${worst.toFixed(3)}m beyond every collider`);
    console.log(`  ${sampled.toLocaleString()} decoded body vertices covered by collision geometry.`);
  });
  check('village geometry leaves all original station screens visible from their real facing spawns', () => {
    const ray = new THREE.Raycaster(); let rays = 0;
    for (const s of courtyard.stations) {
      const front = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const center = new THREE.Vector3(s.x, courtyard.reader.y, s.z).addScaledVector(front, .015);
      for (const eyeY of [1.49, courtyard.reader.y]) for (const u of [-.46, 0, .46]) for (const v of [-.46, 0, .46]) {
        const eye = new THREE.Vector3(s.x, eyeY, s.z).addScaledVector(front, 2.7);
        const target = center.clone().addScaledVector(right, courtyard.reader.width * u); target.y += courtyard.reader.height * v;
        const direction = target.sub(eye), distance = direction.length(); ray.set(eye, direction.normalize()); ray.far = distance;
        const hit = ray.intersectObjects(root.children, false)[0];
        assert(!hit, `${s.id}: ${hit?.object.name} obstructs original screen at (${u},${v}), eye ${eyeY}`); rays++;
      }
    }
    console.log(`  ${rays} screen sight lines clear at walking and reading eye heights.`);
  });
}

function nightHarness(reduced = false, modelMeshes = [], torchScale = 1) {
  const pen = loadTS('src/Application/World/PenInk.ts', name => {
    assert.equal(name, 'three'); return THREE;
  });
  const listeners = new Set(), killed = [], tweens = [];
  const motion = { matches: reduced, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const gsap = {
    to(target, options) { tweens.push({ target, options }); target.value = options.value; return {}; },
    killTweensOf(target) { killed.push(target); },
  };
  const document = { createElement: type => {
    assert.equal(type, 'canvas'); return { width: 0, height: 0, getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '',
    }) };
  } };
  const { default: MedievalVillage } = loadTS('src/Application/World/MedievalVillage.ts', name => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return { gsap };
    if (name.endsWith('/PenInk')) return pen;
    if (name.endsWith('medieval-village-layout.json')) return layout;
    throw new Error(`Unexpected village dependency ${name}`);
  }, { window: { matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return motion; } }, document });
  const root = new THREE.Group(), room = new THREE.Group(), scene = new THREE.Scene(); scene.add(room);
  for (const source of modelMeshes) {
    const mesh = source.clone(false); mesh.geometry = source.geometry.clone(); mesh.material = source.material.clone(); root.add(mesh);
  }
  const torchParent = new THREE.Group(); torchParent.scale.setScalar(torchScale); root.add(torchParent);
  for (const torch of layout.torches) {
    const anchor = new THREE.Object3D(); anchor.name = `TorchAnchor_${torch.id}`; anchor.userData.torch = true;
    anchor.position.set(torch.x / torchScale, torch.y / torchScale, torch.z / torchScale); torchParent.add(anchor);
  }
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#484848' }));
  pane.name = 'RoomCandleWindow_test'; pane.userData.nightWindow = true; room.add(pane);
  const originalPaneMaterial = pane.material, originalColor = pane.material.color.clone();
  const walkingSets = [];
  const application = { scene, resources: { items: { medievalVillageModel: { scene: root } } },
    camera: { instance: new THREE.PerspectiveCamera() }, world: { view: 'courtyard', courtyard: {
      walk: { setVillageObstacles: list => walkingSets.push(list) },
    } } };
  const village = new MedievalVillage(application, room);
  const dayPaneColor = new THREE.Color(pen.ATLAS_OBJECT_PAPER).convertSRGBToLinear();
  return { village, pen, motion, listeners, tweens, killed, application, pane, originalPaneMaterial, originalColor, dayPaneColor, walkingSets,
    changeMotion(value) { motion.matches = value; listeners.forEach(fn => fn()); } };
}
function verifyNight(asset) {
  check('miniature cottage world scale proportionally reduces flame geometry, halos and fire influence', () => {
    const miniatureScale = layout.cottages.find(cottage => cottage.id === 'scribe').scale || 1;
    assert(miniatureScale > 0 && miniatureScale < 1, 'miniature-cottage regression requires an actually scaled landmark');
    const full = nightHarness(true), miniature = nightHarness(true, [], miniatureScale);
    full.village.setNight(true); miniature.village.setNight(true); full.village.update(0); miniature.village.update(0);
    const flameScale = (h, index) => {
      const matrix = new THREE.Matrix4(); h.village.effects.getObjectByName('AnimatedTorchFlames').getMatrixAt(index, matrix);
      return new THREE.Vector3().setFromMatrixScale(matrix);
    };
    for (let i = 0; i < layout.torches.length; i++) {
      assert(full.village.firePositions[i].distanceTo(miniature.village.firePositions[i]) < 1e-7, 'scaled hierarchy changed an authored world flame anchor');
      assert(flameScale(miniature, i).distanceTo(flameScale(full, i).multiplyScalar(miniatureScale)) < 1e-6, 'miniature flame retained full-size geometry');
      const fullHalo = full.village.effects.getObjectByName(`TorchHalo${i}`), smallHalo = miniature.village.effects.getObjectByName(`TorchHalo${i}`);
      assert(smallHalo.scale.distanceTo(fullHalo.scale.clone().multiplyScalar(miniatureScale)) < 1e-7, 'miniature halo retained full size');
      assert(Math.abs(miniature.pen.inkNight.fires.value[i].w - full.pen.inkNight.fires.value[i].w * miniatureScale) < 1e-7, 'miniature fire retained full influence');
    }
    full.village.dispose(); miniature.village.dispose();
    for (const h of [full, miniature]) { h.pane.geometry.dispose(); h.originalPaneMaterial.dispose(); }
  });
  check('mobile interior focus removes the real well occluder, preserves central content and restores outdoor scenery', () => {
    const wellMeshes = asset.root.children.filter(mesh => mesh.name === 'VillagePropMesh_well').map(source => {
      // Keep the former mobile occlusion placement as a regression fixture;
      // the current well intentionally lives elsewhere in the sparse atlas.
      const mesh = source.clone(false); mesh.matrix.makeTranslation(3.4, layout.groundY, 9.4); return mesh;
    });
    assert(wellMeshes.length > 0, 'actual well geometry missing from regression fixture');
    const h = nightHarness(false, wellMeshes), root = h.village.root;
    const eye = new THREE.Vector3(3, 2.081, 8.7996), target = new THREE.Vector3(3, 2, .22);
    const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0, eye.distanceTo(target));
    const renderedMeshes = () => { const meshes = []; root.traverseVisible(object => { if (object instanceof THREE.Mesh) meshes.push(object); }); return meshes; };
    root.updateMatrixWorld(true);
    assert(ray.intersectObjects(renderedMeshes(), false).length > 0, 'the real narrow-screen camera must reproduce the original well occlusion');
    const paneMaterial = h.pane.material, paneParent = h.pane.parent, childCount = root.children.length;
    for (const view of ['resume', 'monitor', 'leaderboard', 'piano-seat']) {
      h.application.world.view = view; h.village.update(16, true);
      assert.equal(root.visible, false, `${view}: auxiliary village still covers the interior camera`);
      assert.equal(ray.intersectObjects(renderedMeshes(), false).length, 0);
      assert.equal(h.pane.parent, paneParent); assert.equal(h.pane.material, paneMaterial);
      assert(h.pane.visible && paneParent.visible, `${view}: central room content was hidden`);
      assert.equal(root.children.length, childCount, 'focus should preserve village geometry for the return trip');
    }
    h.application.world.view = 'courtyard'; h.village.update(16, false);
    assert(root.visible); assert(ray.intersectObjects(renderedMeshes(), false).length > 0, 'outdoor village was not restored');
    h.village.dispose(); h.pane.geometry.dispose(); h.originalPaneMaterial.dispose();
  });
  check('night material preparation preserves character colours and composes each prior shader hook only once', () => {
    const h = nightHarness(); let calls = 0;
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff' }); material.name = 'PenTest';
    material.onBeforeCompile = () => { calls++; };
    h.pen.preparePenInkMaterial(material); const hook = material.onBeforeCompile, key = material.customProgramCacheKey();
    h.pen.preparePenInkMaterial(material);
    assert.equal(material.onBeforeCompile, hook); assert.equal(material.customProgramCacheKey(), key);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader, {}); assert.equal(calls, 1);
    assert.equal(shader.uniforms.inkNightAmount, h.pen.inkNight.amount);
    assert.equal(shader.uniforms.inkFires, h.pen.inkNight.fires);
    const character = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#32bdaa' }));
    character.name = 'Robot'; const color = character.material.color.clone(), callback = character.material.onBeforeCompile;
    h.pen.preparePenInkModel(character);
    assert(character.material.color.equals(color)); assert.equal(character.material.onBeforeCompile, callback);
    assert.equal(h.pen.inkNight.amount.value, 0, 'default mounting must preserve daytime');
    h.village.dispose(); character.geometry.dispose(); character.material.dispose(); material.dispose();
  });
  check('night fire effects remain bounded, day restores window colour, and rhythm hides village effects', () => {
    const h = nightHarness(), { village, pen } = h;
    assert(!village.effects.visible, 'fire must be hidden in daytime');
    assert(colorsClose(h.pane.material.color, h.dayPaneColor), 'window does not use the atlas object-paper pigment');
    village.setNight(true); village.update(16);
    assert(village.effects.visible); assert.equal(pen.inkNight.amount.value, 1);
    assert(!colorsClose(h.pane.material.color, h.dayPaneColor), 'night did not change the window');
    const objects = village.effects.children.map(object => object.uuid);
    const flame = village.effects.getObjectByName('AnimatedTorchFlames');
    assert(flame instanceof THREE.InstancedMesh && flame.count > 0 && flame.count <= pen.INK_FIRE_LIMIT);
    const flameAttribute = flame.instanceMatrix;
    for (let i = 0; i < 400; i++) village.update(16);
    assert.deepEqual(village.effects.children.map(object => object.uuid), objects, 'per-frame effect objects accumulate');
    assert.equal(flame.instanceMatrix, flameAttribute, 'per-frame instance buffers accumulate');
    assert(pen.inkNight.time.value > 0 && pen.inkNight.fires.value.every(fire => fire.toArray().every(Number.isFinite)));
    h.application.world.view = 'rhythm'; village.update(16); assert(!village.root.visible && !village.effects.visible);
    h.application.world.view = 'courtyard'; village.setNight(false); village.update(16);
    assert(!village.effects.visible); assert(colorsClose(h.pane.material.color, h.dayPaneColor), 'atlas day pigment was not restored');
    village.dispose();
  });
  check('reduced motion freezes fire deformation/flicker, hides embers and responds to a live preference change', () => {
    for (const initiallyReduced of [true, false]) {
      const h = nightHarness(initiallyReduced); h.village.setNight(true); h.village.update(40);
      if (!initiallyReduced) { assert(h.pen.inkNight.time.value > 0); h.changeMotion(true); h.village.update(0); }
      const fires = h.pen.inkNight.fires.value.map(fire => fire.toArray()), color = h.pane.material.color.clone();
      for (let i = 0; i < 80; i++) h.village.update(50);
      assert.equal(h.pen.inkNight.time.value, 0);
      assert.deepEqual(h.pen.inkNight.fires.value.map(fire => fire.toArray()), fires);
      assert(h.pane.material.color.equals(color));
      assert.equal(h.village.effects.getObjectByName('RisingTorchEmbers').visible, false);
      h.changeMotion(false); h.village.update(16); assert(h.pen.inkNight.time.value > 0);
      h.village.dispose();
    }
  });
  check('village disposal releases generated GPU resources/listeners, removes invisible solids and restores borrowed room panes', () => {
    const h = nightHarness(), resources = new Set(), disposed = new Map();
    h.village.effects.traverse(object => {
      // Three.js sprites share one engine-owned quad; the village owns only
      // its flame/point geometries and each effect material/texture.
      if (object.geometry && !(object instanceof THREE.Sprite)) resources.add(object.geometry);
      if (object.material) for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        resources.add(material); if (material.map) resources.add(material.map);
      }
    });
    resources.add(h.pane.material);
    resources.forEach(resource => resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1)));
    h.village.setNight(true); h.village.update(16); h.village.dispose(); h.village.dispose();
    assert.equal(h.listeners.size, 0, 'motion preference listener leaked');
    assert.equal(h.village.root.parent, null); assert.equal(h.village.effects.parent, null);
    assert.equal(h.pen.inkNight.amount.value, 0); assert(h.pen.inkNight.fires.value.every(fire => fire.w === 0));
    for (const resource of resources) assert.equal(disposed.get(resource), 1, `${resource.type || 'GPU buffer'} not disposed exactly once`);
    assert.equal(h.walkingSets.at(-1).length, 0, 'removed village leaves invisible walking obstacles');
    assert.equal(h.pane.material, h.originalPaneMaterial, 'borrowed original room pane still points at a disposed replacement');
    const uniforms = h.pen.inkNight.fires.value.map(fire => fire.toArray());
    h.village.update(16); h.village.setNight(true); assert.equal(h.pen.inkNight.amount.value, 0);
    assert.deepEqual(h.pen.inkNight.fires.value.map(fire => fire.toArray()), uniforms);
    h.pane.geometry.dispose(); h.originalPaneMaterial.dispose();
  });
}

async function verifyAtlasPresentation() {
  const sourceAsset = await decodeVillage('public/Room/pen-ink-courtyard.glb');
  const landscape = JSON.parse(read('src/design/atlas-landscape.json'));
  check('curated plants match the bounded placement plan, preserve source geometry and stay fixed while the paper moves', () => {
    const pen = loadTS('src/Application/World/PenInk.ts', () => THREE);
    const { default: Meadow } = loadTS('src/Application/World/Meadow.ts', name => {
      if (name === 'three') return THREE;
      if (name.endsWith('/history')) return { COURTYARD: courtyard };
      if (name.endsWith('/PenInk')) return pen;
      if (name.endsWith('/atlas-landscape.json')) return landscape;
      if (name.endsWith('/medieval-village-layout.json')) return layout;
      throw new Error(name);
    });
    const data = sourceAsset.data;
    // Reconstruct the shipped hierarchy using actual Draco-decoded geometry.
    const nodes = data.nodes.map((node, index) => {
      const sources = sourceAsset.root.children.filter(mesh => mesh.userData.nodeIndex === index);
      const clone = source => { const mesh = source.clone(false); mesh.geometry = source.geometry.clone(); mesh.material = source.material.clone(); mesh.matrix.identity(); return mesh; };
      const object = sources.length === 1 ? clone(sources[0]) : new THREE.Group();
      if (sources.length > 1) sources.forEach(source => object.add(clone(source)));
      object.name = node.name; object.matrixAutoUpdate = false;
      if (node.matrix) object.matrix.fromArray(node.matrix);
      else object.matrix.compose(new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale || [1, 1, 1]));
      return object;
    });
    data.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
    const model = new THREE.Group(); data.scenes[data.scene || 0].nodes.forEach(index => model.add(nodes[index]));
    const scene = new THREE.Scene(); scene.add(model);
    const application = { scene, camera: { getAtmosphereDistanceOffset: () => 0 } };
    const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
    const templates = Object.entries(landscape.templates).map(([kind, template]) => {
      const source = model.getObjectByName(template.name); assert(source instanceof THREE.Mesh, template.name);
      return { kind, template, source, positionHash: hash(source.geometry.attributes.position.array), colorHash: hash(source.geometry.attributes.color.array), materialColor: source.material.color.clone() };
    });
    let sourceDisposals = 0;
    templates.forEach(({ source }) => {
      source.geometry.addEventListener('dispose', () => sourceDisposals++);
      source.material.addEventListener('dispose', () => sourceDisposals++);
    });
    const meadow = new Meadow(application, model);
    scene.updateMatrixWorld(true);
    const meshes = []; meadow.root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    const planes = meshes.filter(mesh => !mesh.isInstancedMesh), batches = meshes.filter(mesh => mesh.isInstancedMesh);
    assert.equal(planes.length, 1, 'ground was split into a repeating field');
    assert.equal(batches.length, Object.keys(landscape.templates).length);
    const ground = planes[0]; assert(ground.geometry instanceof THREE.PlaneGeometry);
    assert.equal(ground.geometry.getAttribute('position').count, 4); assert.equal(ground.geometry.index.count, 6);
    assert(!ground.material.map && !ground.material.alphaMap, 'ground gained a grass/flower image texture');
    assert(landscape.placements.length <= landscape.limits.maxPlacements);
    assert(landscape.clusters.length <= landscape.limits.maxClusters);
    assert.equal(new Set(landscape.placements.map(p => p.id)).size, landscape.placements.length);
    assert(landscape.placements.filter(p => p.kind === 'tree').length <= landscape.limits.maxTrees);
    const kindLimits = { grass: 'maxGrass', flower: 'maxFlowers', shrub: 'maxShrubs', tree: 'maxTrees', rock: 'maxRocks' };
    const allIds = [], matrix = new THREE.Matrix4(), expected = new THREE.Matrix4();
    const vertices = new THREE.Vector3(); let maxTreeHeight = 0;
    for (const { kind, template, source, positionHash, colorHash, materialColor } of templates) {
      const batch = batches.find(mesh => mesh.userData.templateName === template.name); assert(batch, template.name);
      const placements = landscape.placements.filter(p => p.kind === kind);
      assert.equal(batch.count, placements.length, `${kind}: configured plants omitted or a field pool added`);
      assert(batch.count <= landscape.limits[kindLimits[kind]], kind);
      assert.notEqual(batch.geometry, source.geometry); assert.notEqual(batch.material, source.material);
      assert.equal(hash(source.geometry.attributes.position.array), positionHash); assert.equal(hash(source.geometry.attributes.color.array), colorHash);
      assert(source.material.color.equals(materialColor), 'template pigment mutated');
      assert.equal(hash(batch.geometry.attributes.position.array), positionHash, 'template shape changed');
      const ids = Array.from(batch.userData.placementIds); allIds.push(...ids);
      for (let i = 0; i < batch.count; i++) {
        const p = placements.find(item => item.id === ids[i]); assert(p, `${kind}: unknown instance id`);
        batch.getMatrixAt(i, matrix); matrix.premultiply(batch.matrixWorld);
        expected.compose(new THREE.Vector3(p.x, courtyard.groundY + landscape.groundOffset, p.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(p.scale, p.scale, p.scale));
        assert(matrix.elements.every((value, j) => Math.abs(value - expected.elements[j]) < 2e-6), `${p.id}: unexpected instance placement`);
        const positions = batch.geometry.attributes.position; let radius = 0, height = 0;
        for (let j = 0; j < positions.count; j++) {
          vertices.fromBufferAttribute(positions, j).applyMatrix4(matrix);
          radius = Math.max(radius, Math.hypot(vertices.x - p.x, vertices.z - p.z));
          height = Math.max(height, vertices.y - courtyard.groundY - landscape.groundOffset);
        }
        assert(radius <= template.radius * p.scale + .01, `${p.id}: actual canopy exceeds its clearance footprint`);
        assert(height <= template.height * p.scale + .01, `${p.id}: actual plant exceeds declared height`);
        if (kind === 'tree') maxTreeHeight = Math.max(maxTreeHeight, height);
        const clearance = landscape.clearance, safeRadius = template.radius * p.scale;
        assert(Math.abs(p.x) - safeRadius >= courtyard.houseHalfSize + clearance.housePadding || Math.abs(p.z) - safeRadius >= courtyard.houseHalfSize + clearance.housePadding, `${p.id}: central house crowded`);
        assert(Math.abs(p.x) - safeRadius >= clearance.crossHalfWidth && Math.abs(p.z) - safeRadius >= clearance.crossHalfWidth, `${p.id}: central route covered`);
        for (const station of courtyard.stations) {
          assert(Math.hypot(p.x - station.x, p.z - station.z) >= safeRadius + (kind === 'tree' ? clearance.treeStationRadius : clearance.stationRadius), `${p.id}: exhibit envelope`);
          const x = station.x + Math.sin(station.yaw) * 2.7, z = station.z + Math.cos(station.yaw) * 2.7;
          assert(Math.hypot(p.x - x, p.z - z) >= safeRadius + clearance.spawnPadding, `${p.id}: exact facing spawn covered`);
        }
        for (const q of courtyard.quadrants) assert(Math.hypot(p.x - q.spawn[0], p.z - q.spawn[1]) >= safeRadius + clearance.spawnPadding, `${p.id}: room spawn covered`);
        for (const obstacle of [...courtyard.obstacles, ...layout.obstacles]) assert(Math.hypot(p.x - obstacle.x, p.z - obstacle.z) >= safeRadius + obstacle.radius + clearance.solidPadding, `${p.id}: intersects a solid landmark`);
      }
    }
    assert(maxTreeHeight <= landscape.limits.maxTreeHeight);
    assert.deepEqual(allIds.sort(), landscape.placements.map(p => p.id).sort());
    const hiddenGroups = ['MeadowTemplates', 'PenInkGarden'].map(name => {
      const group = model.getObjectByName(name); assert(group, `missing preserved group ${name}`); return group;
    });
    const vegetation = new Set(); hiddenGroups.forEach(group => group.traverse(object => vegetation.add(object)));
    const geometry = ground.geometry, material = ground.material;
    const batchState = batches.map(batch => ({ batch, geometry: batch.geometry, material: batch.material, buffer: batch.instanceMatrix, hash: hash(batch.instanceMatrix.array) }));
    for (const [x, z] of [[0, 0], [7, -7], [-70, 95], [10_000, -10_000]]) {
      meadow.setOutdoor(true); meadow.update(x, z); scene.updateMatrixWorld(true);
      const visible = []; model.traverseVisible(object => { if (vegetation.has(object)) visible.push(object); });
      assert.equal(visible.length, 0, 'legacy vegetation reappeared');
      assert.equal(ground.geometry, geometry); assert.equal(ground.material, material);
      for (const previous of batchState) {
        assert.equal(previous.batch.geometry, previous.geometry); assert.equal(previous.batch.material, previous.material);
        assert.equal(previous.batch.instanceMatrix, previous.buffer); assert.equal(hash(previous.buffer.array), previous.hash, 'walking relocated or repeated the gardens');
      }
      const bounds = new THREE.Box3().setFromObject(ground);
      assert(bounds.containsPoint(new THREE.Vector3(x, courtyard.groundY, z)), 'moving paper no longer covers the visitor');
    }
    // r147's approximate sRGB round trip differs by up to 3.5e-6 here;
    // compare below two thousandths of an 8-bit display channel step.
    assert(colorsClose(scene.background, new THREE.Color('#eadcc0'), 5e-6));
    pen.inkNight.amount.value = 1; meadow.setNight(true); meadow.update(0, 0);
    assert(colorsClose(scene.background, new THREE.Color('#050607')), 'night background must be near black');
    pen.inkNight.amount.value = 0; meadow.setNight(false); assert(colorsClose(scene.background, new THREE.Color('#eadcc0'), 5e-6));
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader, {});
    assert.equal(shader.uniforms.atlasGroundSurface.value, 1);
    const colorNear = (actual, color) => assert(colorsClose(actual, new THREE.Color(color).convertSRGBToLinear()));
    colorNear(shader.uniforms.atlasGround.value, '#eadcc0'); colorNear(shader.uniforms.atlasInk.value, '#5c422d');
    const resources = new Set([geometry, material, ...batches.flatMap(batch => [batch, batch.geometry, batch.material])]), disposals = new Map();
    resources.forEach(resource => resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) || 0) + 1)));
    meadow.dispose(); assert.equal(meadow.root.parent, null); resources.forEach(resource => assert.equal(disposals.get(resource), 1, 'owned plant GPU resource leaked'));
    assert.equal(sourceDisposals, 0, 'disposing planted instances retired a borrowed source asset');
    templates.forEach(({ source, colorHash }) => assert.equal(hash(source.geometry.attributes.color.array), colorHash, 'disposing plants mutated shared source colours'));
    model.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); } });
    console.log(`  ${allIds.length} curated plants in ${batches.length} fixed batches; tallest tree ${maxTreeHeight.toFixed(3)}m; no repeating field.`);
  });
  check('the actual compass renders four accessible room selectors and dispatches the selected destination', () => {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const rooms = loadTS('src/design/rooms.ts', () => JSON.parse(read('src/design/jo-colors.json')));
    const events = [];
    const { default: Compass } = loadTS('src/Application/UI/components/AtlasCompass.tsx', name => {
      if (name === 'react') return React;
      if (name.endsWith('/EventBus')) return { EventBus: { dispatch: (name, data) => events.push({ name, data }) } };
      if (name.endsWith('/rooms')) return rooms;
      if (name.endsWith('.css')) return {};
      throw new Error(name);
    });
    const collect = (element, type) => {
      const found = [];
      const visit = value => { if (!React.isValidElement(value)) return; if (value.type === type) found.push(value);
        React.Children.forEach(value.props.children, visit); }; visit(element); return found;
    };
    for (const current of rooms.ROOM_IDS) {
      const tree = Compass({ room: current, hidden: false, disabled: false });
      assert.equal(tree.type, 'nav'); assert.equal(tree.props['aria-label'], 'Room compass');
      const buttons = collect(tree, 'button'); assert.equal(buttons.length, 4);
      assert.equal(buttons.filter(button => button.props['aria-current'] === 'page').length, 1);
      assert.equal(buttons.find(button => button.props['aria-current'] === 'page').props['aria-label'], rooms.ROOMS[current].name);
      buttons.forEach((button, index) => {
        assert.equal(button.props.disabled, false); assert.equal(button.props.type, 'button');
        assert.equal(button.props['aria-label'], rooms.ROOMS[rooms.ROOM_IDS[index]].name);
        button.props.onClick(); const event = events.at(-1);
        assert.equal(event.name, 'navigate'); assert.equal(event.data.view, rooms.ROOM_IDS[index]);
      });
    }
    const disabled = Compass({ room: 'developer', hidden: true, disabled: true });
    assert.equal(disabled.props.hidden, true); assert(collect(disabled, 'button').every(button => button.props.disabled));
    const html = renderToStaticMarkup(disabled);
    assert.equal((html.match(/disabled=""/g) || []).length, 4, 'native buttons do not enforce the disabled state');
    assert(html.includes('hidden=""'), 'hidden compass remains exposed');
  });
  sourceAsset.root.children.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
}

async function main() {
  verifyMovement();
  const village = await decodeVillage(); verifyGeometry(village);
  verifyNight(village);
  await verifyAtlasPresentation();
  for (const mesh of village.root.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
  if (!process.exitCode) console.log(`Atlas scene: ${passed} independent checks passed (historical verify-medieval-village command).`);
}
main().catch(error => { process.exitCode = 1; console.error(error.stack); });
