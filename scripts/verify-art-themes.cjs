/* Exercise both real GLB visual sets and the runtime theme ownership contract.
 * No WebGL renderer, image snapshots, network requests or storage writes.
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
const json = name => JSON.parse(read(name));
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.stack}`); }
}
function loadTS(file, resolve, extra = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2016,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const scope = { exports: {}, require: resolve, ...extra }; vm.runInNewContext(code, scope, { filename: file }); return scope.exports;
}
const arrayHash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
function geometryHash(geometry) {
  return JSON.stringify({ index: geometry.index && arrayHash(geometry.index.array),
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, arrayHash(attribute.array)])) });
}
function materialState(material) {
  return { name: material.name, type: material.type, color: material.color?.toArray(), emissive: material.emissive?.toArray(),
    roughness: material.roughness, metalness: material.metalness, vertexColors: material.vertexColors, opacity: material.opacity };
}
function within(object, names) { for (let o = object; o; o = o.parent) if (names.includes(o.name)) return true; return false; }
function meshes(root) { const found = []; root.traverse(object => { if (object instanceof THREE.Mesh) found.push(object); }); return found; }
function cloneScene(root) {
  const clone = root.clone(true), materials = new Map();
  clone.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const copy = material => { if (!materials.has(material)) materials.set(material, material.clone()); return materials.get(material); };
    object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
  });
  return clone;
}
async function decoderModule() {
  const filename = path.join(ROOT, 'public/draco/gltf/draco_decoder.js');
  const scope = { module: { exports: {} }, exports: {}, require, __filename: filename, __dirname: path.dirname(filename),
    process, console, Buffer, TextEncoder, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), scope);
  return new Promise(resolve => scope.module.exports().then(draco => resolve({ draco })));
}
function loadGLB(file, draco) {
  const bytes = fs.readFileSync(path.join(ROOT, file)); assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12), data = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  assert(!data.images?.length, `${file}: loader fixture requires the actual texture-free source contract`);
  const materials = data.materials.map(source => {
    const material = source.extensions?.KHR_materials_unlit ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();
    material.name = source.name; material.userData = { ...source.extras };
    material.color.fromArray(source.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1]);
    material.opacity = source.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.roughness = source.pbrMetallicRoughness?.roughnessFactor ?? 1;
      material.metalness = source.pbrMetallicRoughness?.metallicFactor ?? 1;
      material.emissive.fromArray(source.emissiveFactor || [0, 0, 0]);
    }
    material.side = source.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    return material;
  });
  const geometries = data.meshes.map(mesh => mesh.primitives.map(primitive => {
    const ext = primitive.extensions.KHR_draco_mesh_compression, view = data.bufferViews[ext.bufferView];
    const encoded = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), output = new draco.Mesh();
    buffer.Init(new Int8Array(encoded), encoded.length); assert(decoder.DecodeBufferToMesh(buffer, output).ok(), `${file}: bad Draco payload`);
    const geometry = new THREE.BufferGeometry();
    for (const [semantic, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['COLOR_0', 'color']]) {
      if (ext.attributes[semantic] === undefined) continue;
      const attribute = decoder.GetAttributeByUniqueId(output, ext.attributes[semantic]), values = new draco.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(output, attribute, values);
      const array = new Float32Array(values.size()); for (let i = 0; i < array.length; i++) array[i] = values.GetValue(i);
      geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.num_components())); draco.destroy(values);
    }
    const indices = new Uint32Array(output.num_faces() * 3), face = new draco.DracoInt32Array();
    for (let i = 0; i < output.num_faces(); i++) { decoder.GetFaceFromMesh(output, i, face); for (let j = 0; j < 3; j++) indices[i * 3 + j] = face.GetValue(j); }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); materials[primitive.material].vertexColors ||= geometry.hasAttribute('color');
    [face, output, buffer, decoder].forEach(object => draco.destroy(object));
    return { geometry, material: materials[primitive.material] };
  }));
  const nodes = data.nodes.map(node => {
    const primitives = node.mesh === undefined ? [] : geometries[node.mesh];
    const object = primitives.length === 1 ? new THREE.Mesh(primitives[0].geometry, primitives[0].material) : new THREE.Group();
    if (primitives.length > 1) primitives.forEach(p => object.add(new THREE.Mesh(p.geometry, p.material)));
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.name || ''); object.userData = { ...node.extras };
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale); }
    else { object.position.fromArray(node.translation || [0, 0, 0]); object.quaternion.fromArray(node.rotation || [0, 0, 0, 1]); object.scale.fromArray(node.scale || [1, 1, 1]); }
    return object;
  });
  data.nodes.forEach((node, i) => node.children?.forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group(); data.scenes[data.scene || 0].nodes.forEach(index => root.add(nodes[index])); root.updateMatrixWorld(true);
  return root;
}

function verifyStorage() {
  check('style storage accepts only the two themes and survives missing, corrupt and denied storage', () => {
    for (const value of [null, '', 'unknown', 'null', '{}', 'INK', 'classic', 'ink']) {
      const writes = [];
      const api = loadTS('src/design/art-themes.ts', () => {}, { localStorage: {
        getItem: key => { assert.equal(key, 'bbangjo.art-theme'); return value; }, setItem: (...args) => writes.push(args),
      } });
      assert.equal(api.readArtTheme(), value === 'classic' ? 'classic' : 'ink');
      for (const theme of ['ink', 'classic']) { api.writeArtTheme(theme); assert.deepEqual(writes.at(-1), ['bbangjo.art-theme', theme]); }
      for (const invalid of [null, undefined, '', 'dark', 1, {}, []]) assert.equal(api.isArtTheme(invalid), false);
    }
    for (const extras of [{}, { localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } }]) {
      const api = loadTS('src/design/art-themes.ts', () => {}, extras);
      assert.equal(api.readArtTheme(), 'ink'); assert.doesNotThrow(() => api.writeArtTheme('classic'));
    }
  });
}
function verifyGrafts(assets, ArtThemeMeshes) {
  for (const [label, inkAsset, classicAsset, exclusions] of [
    ['rooms', assets.inkRooms, assets.classicRooms, ['Robot']],
    ['courtyard', assets.inkCourtyard, assets.classicCourtyard, ['MeadowTemplates']],
  ]) check(`${label}: actual GLB styles are exclusive, preserve live owners, reuse geometry and release only owned materials`, () => {
    const ink = cloneScene(inkAsset), classic = cloneScene(classicAsset);
    const sourceMeshes = meshes(classic).filter(mesh => !within(mesh, exclusions)), inkMeshes = meshes(ink).filter(mesh => !within(mesh, exclusions));
    assert(sourceMeshes.length > 0 && inkMeshes.length > 0);
    // Authored hidden leaves must stay hidden in either style.
    sourceMeshes[0].visible = false; inkMeshes[0].visible = false;
    const sourceBefore = sourceMeshes.map(mesh => ({ mesh, parent: mesh.parent, matrix: mesh.matrixWorld.clone(), geometry: geometryHash(mesh.geometry),
      materials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(materialState) }));
    const originals = []; ink.traverse(object => originals.push({ object, parent: object.parent, local: object.matrix.clone(), visible: object.visible }));
    const robotBefore = meshes(ink).filter(mesh => within(mesh, ['Robot'])).map(mesh => ({ mesh, visible: mesh.visible, geometry: geometryHash(mesh.geometry), material: mesh.material }));
    const theme = new ArtThemeMeshes(ink, classic, exclusions);
    const grafts = meshes(ink).filter(mesh => mesh.userData.artTheme === 'classic');
    assert.equal(grafts.length, sourceMeshes.length);
    for (const source of sourceMeshes) {
      const graft = grafts.find(mesh => mesh.name === `Classic_${source.name}`); assert(graft, source.name);
      assert.equal(graft.parent.name, source.parent.name);
      assert.equal(graft.geometry, source.geometry, `${source.name}: geometry copied/rebuilt`);
      assert.notEqual(graft.material, source.material); assert.deepEqual(materialState(graft.material), materialState(source.material));
      ink.updateMatrixWorld(true); assert(graft.matrixWorld.elements.every((value, i) => Math.abs(value - source.matrixWorld.elements[i]) < 1e-5), source.name);
    }
    const key = ink.getObjectByName('PianoKey60'), curtain = ink.getObjectByName('BlogCurtainLeft');
    if (key) key.position.y -= .045;
    if (curtain) curtain.scale.z *= 2.1;
    const keyPose = key?.position.clone(), curtainScale = curtain?.scale.clone();
    const initialMeshCount = meshes(ink).length;
    for (let i = 0; i < 40; i++) {
      const selected = i % 2 ? 'ink' : 'classic'; theme.setArtTheme(selected);
      assert.equal(theme.stats.theme, selected); assert.equal(meshes(ink).length, initialMeshCount);
      assert(inkMeshes.every((mesh, index) => mesh.visible === (selected === 'ink' && index !== 0)));
      assert(grafts.every(mesh => mesh.visible === (selected === 'classic' && mesh.name !== `Classic_${sourceMeshes[0].name}`)));
      for (const { object, parent } of originals) { assert.equal(object.parent, parent); assert.equal(ink.getObjectByName(object.name), object); }
      if (key) { assert.equal(ink.getObjectByName('PianoKey60'), key); assert(key.position.equals(keyPose)); }
      if (curtain) { assert.equal(ink.getObjectByName('BlogCurtainLeft'), curtain); assert(curtain.scale.equals(curtainScale)); }
    }
    for (const before of sourceBefore) {
      assert.equal(before.mesh.parent, before.parent); assert(before.mesh.matrixWorld.equals(before.matrix));
      assert.equal(geometryHash(before.mesh.geometry), before.geometry);
      assert.deepEqual((Array.isArray(before.mesh.material) ? before.mesh.material : [before.mesh.material]).map(materialState), before.materials);
    }
    for (const before of robotBefore) { assert.equal(before.mesh.visible, before.visible); assert.equal(before.mesh.material, before.material); assert.equal(geometryHash(before.mesh.geometry), before.geometry); }
    let borrowedDisposals = 0; const owned = new Map();
    sourceMeshes.forEach(mesh => { mesh.geometry.addEventListener('dispose', () => borrowedDisposals++); mesh.material.addEventListener('dispose', () => borrowedDisposals++); });
    grafts.forEach(mesh => mesh.material.addEventListener('dispose', () => owned.set(mesh.material, (owned.get(mesh.material) || 0) + 1)));
    theme.dispose(); theme.dispose(); theme.setArtTheme('classic');
    assert(grafts.every(mesh => mesh.parent === null)); assert.equal(borrowedDisposals, 0);
    assert.equal(owned.size, new Set(grafts.map(mesh => mesh.material)).size); assert([...owned.values()].every(count => count === 1));
    console.log(`  ${label}: ${inkMeshes.length} ink / ${sourceMeshes.length} original leaves; 40 switches, no owner replacement or mesh growth.`);
  });
}

function verifyRoom(assets, ArtThemeMeshes, pen) {
  check('Room theme changes preserve actual held keyboard notes, curtain pivots, character and reading anchors', () => {
    const ink = cloneScene(assets.inkRooms), classic = cloneScene(assets.classicRooms);
    const app = { scene: new THREE.Scene(), resources: { items: { dioramaModel: { scene: ink }, classicRoomModel: { scene: classic } } },
      renderer: { instance: { shadowMap: { needsUpdate: false } } } };
    const { ROOMS, ROOM_IDS, COLORS } = loadTS('src/design/rooms.ts', () => json('src/design/jo-colors.json'));
    const gsap = { killTweensOf() {}, to(target, values) {
      for (const [key, value] of Object.entries(values)) if (typeof value === 'number' && !['duration', 'delay'].includes(key)) target[key] = value;
      values.onUpdate?.(); values.onComplete?.(); return {};
    } };
    const { default: Room } = loadTS('src/Application/World/Room.ts', name => {
      if (name === 'three') return THREE; if (name === 'gsap') return { gsap };
      if (name.endsWith('/BaseObject')) return { BaseObject: class { constructor() { this.application = app; this.resources = app.resources; this.scene = app.scene; } } };
      if (name.endsWith('/rooms')) return { ROOMS, ROOM_IDS, COLORS };
      if (name.endsWith('/PenInk')) return pen;
      if (name.endsWith('/ArtThemeMeshes')) return ArtThemeMeshes;
      throw new Error(name);
    });
    const room = new Room(), keys = Array.from({ length: 24 }, (_, i) => ink.getObjectByName(`PianoKey${i + 60}`));
    const anchors = [room.monitorAnchor, room.resumeAnchor, room.leaderboardAnchor, room.pianoEyeAnchor, room.pianoLookAnchor];
    const robot = room.robot, materials = meshes(robot).map(mesh => mesh.material), keyY = keys[0].position.y;
    const curtain = ink.getObjectByName('BlogCurtainLeft'); curtain.scale.z = 2.2;
    room.holdKeys(new Set([60, 64, 67]), true);
    assert(Math.abs(keys[0].position.y - keyY + .045) < 1e-8);
    for (const theme of ['classic', 'ink', 'classic', 'ink']) {
      room.setArtTheme(theme); assert.equal(room.themeVisuals.stats.theme, theme);
      keys.forEach((key, i) => assert.equal(room.targets.get(`key${i + 60}`), key));
      assert(Math.abs(keys[0].position.y - keyY + .045) < 1e-8); assert.equal(curtain.scale.z, 2.2);
      assert.deepEqual([room.monitorAnchor, room.resumeAnchor, room.leaderboardAnchor, room.pianoEyeAnchor, room.pianoLookAnchor], anchors);
      assert.equal(room.robot, robot); assert.deepEqual(meshes(robot).map(mesh => mesh.material), materials);
    }
    room.holdKeys(new Set(), true); assert.equal(keys[0].position.y, keyY); room.disposeThemeVisuals();
  });
}

class Surface {
  constructor() { this.listeners = new Map(); this.style = {}; }
  addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== fn)); }
  emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ type: name, ...event }); }
}
function worldHarness(options = {}) {
  const timers = new Map(), writes = [], events = [], calls = [], values = new Map(); let now = 0, nextTimer = 0;
  if (options.stored !== undefined) values.set('bbangjo.art-theme', options.stored);
  const storage = { getItem(key) { if (options.denied) throw new Error('denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (options.denied) throw new Error('denied'); writes.push([key, value]); values.set(key, value); } };
  const art = loadTS('src/design/art-themes.ts', () => {}, { localStorage: storage });
  const rooms = loadTS('src/design/rooms.ts', () => json('src/design/jo-colors.json'));
  const track = require(path.join(ROOT, 'src/design/rhythm-track.mjs'));
  const rhythm = loadTS('src/design/rhythm-game.ts', () => track);
  const game = loadTS('src/Application/World/RhythmGame.ts', () => rhythm, { localStorage: storage });
  const window = new Surface(), document = new Surface(), canvas = new Surface(), bus = new Surface();
  window.location = { origin: 'https://portfolio.example' };
  const motion = { matches: !!options.reduced }; window.matchMedia = () => motion;
  window.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, due: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  document.body = { dataset: {} }; document.hidden = false; document.querySelector = () => null;
  canvas.hasPointerCapture = () => false; canvas.releasePointerCapture = () => {}; canvas.setPointerCapture = () => {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 760 });
  bus.on = bus.addEventListener.bind(bus); bus.dispatch = (name, data = {}) => { events.push({ name, data }); for (const fn of bus.listeners.get(name) || []) fn(data); };
  const camera = new Surface(); camera.on = camera.addEventListener.bind(camera); camera.transitioning = false;
  camera.instance = new THREE.PerspectiveCamera(); camera.instance.position.set(3, 2, 8); camera.setRhythmViewport = () => {};
  const resources = new Surface(); resources.on = resources.addEventListener.bind(resources);
  const application = { camera, resources, scene: new THREE.Scene(), sizes: { width: 1200, height: 760 }, time: { delta: 16 },
    renderer: { instance: { domElement: canvas, shadowMap: { needsUpdate: false } } }, audioPlayer: {} };
  const { default: World } = loadTS('src/Application/World/World.ts', name => {
    if (name === 'three') return THREE;
    if (name === '../Application') return class { constructor() { return application; } };
    if (name.endsWith('/Camera')) return { isReadingView: view => ['monitor', 'resume', 'leaderboard'].includes(view) };
    if (name.endsWith('/EventBus')) return { EventBus: bus };
    if (name.endsWith('/rooms')) return rooms;
    if (name.endsWith('/art-themes')) return art;
    if (name.endsWith('/rhythm-game')) return rhythm;
    if (name.endsWith('/RhythmGame')) return game;
    if (name.endsWith('/piano-keys')) return { pianoMidiForKeyboard: () => undefined };
    return {};
  }, { window, document, Element: class {}, innerWidth: 1200, innerHeight: 760, performance: { now: () => now }, localStorage: storage });
  const world = new World();
  const owner = name => ({ root: new THREE.Group(), setArtTheme(theme) { calls.push({ name, theme }); }, setNight(night) { calls.push({ name, night }); } });
  world.room = owner('room'); world.environment = owner('environment'); world.village = owner('village'); world.rhythmStage = owner('rhythm');
  world.rhythmStage.setVisible = () => {};
  world.courtyard = { ...owner('courtyard'), meadow: { ...owner('meadow'), setOutdoor() {} } };
  const screen = name => ({ object: new THREE.Object3D(), mesh: new THREE.Object3D(), setVisible(value) { this.object.visible = value; },
    setArtTheme(theme) { calls.push({ name, theme }); }, setDisplay(active, night, theme) { this.display = { active, night, theme }; } });
  world.monitorScreen = screen('monitor'); world.resumeScreen = screen('resume'); world.leaderboardScreen = screen('leaderboard');
  world.performance = { getSnapshot: () => ({ status: 'playing', time: 17 }) };
  world.ready = true; world.view = 'piano-seat'; world.activeRoom = 'piano';
  return { world, application, camera, window, document, bus, writes, values, calls, events, timers, motion,
    advance(ms) { const end = now + ms; while (true) {
      const due = [...timers].filter(([, value]) => value.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break; now = due[1].due; timers.delete(due[0]); due[1].fn();
    } now = end; } };
}
function verifyWorld() {
  check('World applies one delayed style change, ignores rapid repeat clicks and preserves night, view and live readers', () => {
    const h = worldHarness(), { world } = h;
    const camera = h.camera.instance, position = camera.position.clone();
    const readers = [world.monitorScreen, world.resumeScreen, world.leaderboardScreen];
    h.bus.dispatch('night-toggle'); assert.equal(world.night, true);
    h.bus.dispatch('art-theme-toggle', { theme: 'classic' });
    assert.equal(world.artTheme, 'ink'); assert.equal(world.artThemeTransitioning, true); assert.equal(h.timers.size, 1);
    h.bus.dispatch('art-theme-toggle', { theme: 'ink' }); h.bus.dispatch('art-theme-toggle', { theme: 'classic' }); assert.equal(h.timers.size, 1);
    h.advance(199); assert.equal(world.artTheme, 'ink'); h.advance(1);
    assert.equal(world.artTheme, 'classic'); assert.equal(world.artThemeTransitioning, false); assert.equal(h.timers.size, 0);
    assert.equal(world.night, true); assert.equal(world.view, 'piano-seat'); assert.equal(world.activeRoom, 'piano');
    assert.equal(h.camera.instance, camera); assert(camera.position.equals(position));
    assert.deepEqual([world.monitorScreen, world.resumeScreen, world.leaderboardScreen], readers);
    for (const name of ['room', 'courtyard', 'rhythm', 'environment', 'village', 'resume']) assert.equal(h.calls.filter(call => call.name === name && call.theme === 'classic').length, 1, name);
    assert.equal(world.leaderboardScreen.display.theme, 'classic'); assert.equal(world.leaderboardScreen.display.night, true);
    assert.deepEqual(h.writes.filter(([key]) => key === 'bbangjo.art-theme'), [['bbangjo.art-theme', 'classic']]);
    h.bus.dispatch('art-theme-toggle', { theme: 'classic' }); assert.equal(h.timers.size, 0);
    h.bus.dispatch('art-theme-toggle', { theme: 'ink' }); h.advance(200);
    assert.equal(world.artTheme, 'ink'); assert.equal(world.night, true); assert.equal(h.document.body.dataset.artTheme, 'ink');
    world.disposeInput();
  });
  check('World storage denial and reduced motion remain usable; transition guards and disposal prevent stale theme timers', () => {
    for (const options of [{ stored: 'classic', reduced: true }, { denied: true, reduced: true }]) {
      const h = worldHarness(options), before = h.world.artTheme;
      h.bus.dispatch('art-theme-toggle'); assert.notEqual(h.world.artTheme, before); assert.equal(h.timers.size, 0);
      assert.equal(h.world.artThemeTransitioning, false); assert.equal(h.world.night, false); h.world.disposeInput();
    }
    for (const gate of ['loading', 'error', 'camera']) {
      const h = worldHarness(); if (gate === 'loading') h.world.ready = false; if (gate === 'error') h.world.error = 'context lost'; if (gate === 'camera') h.camera.transitioning = true;
      h.bus.dispatch('art-theme-toggle'); assert.equal(h.timers.size, 0, gate); assert.equal(h.world.artTheme, 'ink'); h.world.disposeInput();
    }
    const h = worldHarness(); h.bus.dispatch('art-theme-toggle'); assert.equal(h.timers.size, 1);
    h.world.disposeInput(); h.advance(1000);
    assert.equal(h.timers.size, 0); assert.equal(h.world.artTheme, 'ink'); assert.equal(h.world.artThemeTransitioning, false);
    assert.equal(h.calls.filter(call => call.theme).length, 0, 'a disposed transition changed visuals');
  });
}

function verifyMeadow(assets, pen) {
  check('only the active meadow controls visibility and atmosphere; round trips preserve night and allocate no new meshes', () => {
    const layout = json('src/design/courtyard-layout.json'), landscape = json('src/design/atlas-landscape.json'), village = json('src/design/medieval-village-layout.json');
    const { default: ClassicMeadow } = loadTS('src/Application/World/ClassicMeadow.ts', name => name === 'three' ? THREE : { COURTYARD: layout });
    const { default: Meadow } = loadTS('src/Application/World/Meadow.ts', name => {
      if (name === 'three') return THREE; if (name.endsWith('/PenInk')) return pen;
      if (name.endsWith('/history')) return { COURTYARD: layout };
      if (name.endsWith('/atlas-landscape.json')) return landscape;
      if (name.endsWith('/medieval-village-layout.json')) return village;
      if (name.endsWith('/ClassicMeadow')) return ClassicMeadow;
      throw new Error(name);
    });
    const original = cloneScene(assets.classicCourtyard), ink = cloneScene(assets.inkCourtyard);
    const sourceBefore = [...meshes(original), ...meshes(ink)].map(mesh => ({ mesh, hash: geometryHash(mesh.geometry), materials: materialState(mesh.material) }));
    const app = { scene: new THREE.Scene(), resources: { items: { classicCourtyardModel: { scene: original } } },
      camera: { getAtmosphereDistanceOffset: () => 0 }, renderer: { instance: { shadowMap: { needsUpdate: false } } } };
    const meadow = new Meadow(app, ink), classicRoot = meadow.root.getObjectByName('ClassicLowPolyMeadow'); assert(classicRoot);
    const inkLeaves = meshes(meadow.planting), classicLeaves = meshes(classicRoot), rootCount = meshes(meadow.root).length;
    const inkBuffers = inkLeaves.map(mesh => ({ mesh, buffer: mesh.instanceMatrix, hash: arrayHash(mesh.instanceMatrix.array) }));
    const visible = () => { const found = new Set(); meadow.root.traverseVisible(object => { if (object instanceof THREE.Mesh) found.add(object); }); return found; };
    meadow.setOutdoor(true); pen.inkNight.amount.value = 1; meadow.setNight(true);
    const paperNight = new THREE.Color(pen.ATLAS_NIGHT);
    const nearColor = (a, b) => a.toArray().every((value, i) => Math.abs(value - b.toArray()[i]) < 1e-5);
    assert(nearColor(app.scene.background, paperNight));
    const owned = new Set(); meadow.setArtTheme('classic');
    meadow.root.traverse(object => { if (object instanceof THREE.Mesh) {
      owned.add(object.geometry); for (const material of (Array.isArray(object.material) ? object.material : [object.material])) owned.add(material);
      if (object.isInstancedMesh) owned.add(object);
    } });
    const classicNight = app.scene.background.clone(); assert(!nearColor(classicNight, paperNight));
    for (let i = 0; i < 30; i++) {
      const theme = i % 2 ? 'ink' : 'classic'; meadow.setArtTheme(theme);
      const active = visible();
      assert(inkLeaves.every(mesh => active.has(mesh) === (theme === 'ink')));
      assert(classicLeaves.every(mesh => active.has(mesh) === (theme === 'classic')));
      assert.equal(meshes(meadow.root).length, rootCount); assert.equal(pen.inkNight.amount.value, 1);
      meadow.update(100 + i * 25, -90 - i * 25); meadow.setOutdoor(true);
      assert(nearColor(app.scene.background, theme === 'ink' ? paperNight : classicNight), `${theme}: inactive meadow overwrote the sky`);
      meadow.setReading(true); assert.equal(app.scene.fog, null); meadow.setReading(false); assert(app.scene.fog instanceof THREE.Fog);
    }
    for (const { mesh, buffer, hash } of inkBuffers) { assert.equal(mesh.instanceMatrix, buffer); assert.equal(arrayHash(buffer.array), hash); }
    for (const before of sourceBefore) { assert.equal(geometryHash(before.mesh.geometry), before.hash); assert.deepEqual(materialState(before.mesh.material), before.materials); }
    const disposed = new Map(); owned.forEach(resource => resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1)));
    meadow.dispose(); assert.equal(meadow.root.parent, null); assert([...owned].every(resource => disposed.get(resource) === 1), 'meadow GPU resource leaked or double-disposed');
  });
}
function verifyVillage(assets) {
  check('classic hides every ink village solid/effect and returning ink safely recovers a visitor inside any added obstacle', () => {
    const layout = json('src/design/courtyard-layout.json'), villageLayout = json('src/design/medieval-village-layout.json');
    const { CourtyardWalk } = loadTS('src/Application/World/CourtyardWalk.ts', () => ({ COURTYARD: layout }));
    const pen = loadTS('src/Application/World/PenInk.ts', () => THREE);
    const window = new Surface(), motion = new Surface(); motion.matches = true; window.matchMedia = () => motion;
    const document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
    const gsap = { killTweensOf() {}, to(target, vars) { target.value = vars.value; } };
    const { default: Village } = loadTS('src/Application/World/MedievalVillage.ts', name => {
      if (name === 'three') return THREE; if (name === 'gsap') return { gsap }; if (name.endsWith('/PenInk')) return pen;
      if (name.endsWith('/medieval-village-layout.json')) return villageLayout; throw new Error(name);
    }, { window, document });
    const walk = new CourtyardWalk(), follows = [];
    const app = { scene: new THREE.Scene(), resources: { items: { medievalVillageModel: { scene: cloneScene(assets.village) } } },
      camera: { instance: new THREE.PerspectiveCamera(), followCourtyard: (...args) => follows.push(args) }, world: { view: 'courtyard', courtyard: { walk } } };
    const village = new Village(app, new THREE.Group()); village.setNight(true); village.update(0);
    assert(village.effects.visible); const heading = .53; walk.heading = heading;
    for (const obstacle of villageLayout.obstacles) {
      village.setArtTheme('classic'); assert(!village.root.visible && !village.effects.visible); assert.equal(pen.inkNight.amount.value, 1);
      walk.stop(); walk.x = obstacle.x; walk.z = obstacle.z;
      assert.equal(walk.ensureSafePosition(), false, `${obstacle.id}: hidden village left an invisible collider`);
      const beforeFollow = follows.length; village.setArtTheme('ink');
      assert(village.root.visible && village.effects.visible); assert.equal(pen.inkNight.amount.value, 1);
      assert.equal(walk.heading, heading); assert.equal(app.world.view, 'courtyard');
      assert.equal(follows.length, beforeFollow + 1, `${obstacle.id}: recovered position did not reach the camera`);
      for (const solid of villageLayout.obstacles) assert(Math.hypot(walk.x - solid.x, walk.z - solid.z) >= solid.radius + .4 - 1e-8, `${obstacle.id}: recovery is inside ${solid.id}`);
      assert(!(Math.abs(walk.x) < layout.houseHalfSize + .4 && Math.abs(walk.z) < layout.houseHalfSize + .4));
      assert(layout.stations.every(station => Math.hypot(walk.x - station.x, walk.z - station.z) >= 2));
      assert.equal(walk.ensureSafePosition(), false, 'safe recovered visitor should stay in place');
    }
    village.setArtTheme('classic'); village.setNight(false); village.update(0); assert.equal(pen.inkNight.amount.value, 0);
    village.setArtTheme('ink'); assert(village.root.visible && !village.effects.visible, 'returning ink accidentally enabled night');
    village.dispose(); village.setArtTheme('ink');
    walk.x = villageLayout.obstacles[0].x; walk.z = villageLayout.obstacles[0].z;
    assert.equal(walk.ensureSafePosition(), false, 'a disposed village reintroduced invisible collisions');
    console.log(`  ${villageLayout.obstacles.length} original obstacle centres recovered safely after classic → ink.`);
  });
}

function verifyThemeMenu() {
  check('the real theme menu exposes two radio choices, dispatches only changed selections and releases focus listeners', () => {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const events = [], window = new Surface(), document = new Surface(), slots = []; let cursor = 0, effects = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
    const hooks = { ...React,
      useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
      useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    };
    const { default: Toggle } = loadTS('src/Application/UI/components/ArtThemeToggle.tsx', name => {
      if (name === 'react') return hooks; if (name.endsWith('/EventBus')) return { EventBus: { dispatch: (name, data) => events.push({ name, data }) } };
      if (name.endsWith('.css')) return {}; throw new Error(name);
    }, { window, document });
    function elements(tree, predicate) {
      const result = []; const visit = element => { if (!React.isValidElement(element)) return; if (predicate(element)) result.push(element); React.Children.forEach(element.props.children, visit); }; visit(tree); return result;
    }
    function mount(element, parent = null) {
      if (!React.isValidElement(element)) return;
      const node = { parent, disabled: !!element.props.disabled, focus() { if (!this.disabled) document.activeElement = this; },
        contains(other) { for (let item = other; item; item = item.parent) if (item === this) return true; return false; } };
      if (typeof element.ref === 'function') element.ref(node); else if (element.ref) element.ref.current = node;
      React.Children.forEach(element.props.children, child => mount(child, node));
    }
    function render(theme, disabled = false) { cursor = 0; effects = []; const tree = Toggle({ theme, disabled }); mount(tree); const run = effects; effects = []; run.forEach(fn => fn()); return tree; }
    const button = tree => elements(tree, element => element.type === 'button' && element.props['aria-haspopup'] === 'menu')[0];
    const radios = tree => elements(tree, element => element.props.role === 'menuitemradio');
    let tree = render('ink'); assert.equal(button(tree).props['aria-label'], 'Theme: Pen drawing'); assert.equal(button(tree).props['aria-expanded'], false);
    button(tree).props.onClick(); tree = render('ink');
    let choices = radios(tree); assert.equal(choices.length, 2); assert.deepEqual(choices.map(choice => choice.props.children[0].props.children), ['Pen drawing', 'Low-poly']);
    assert.deepEqual(choices.map(choice => choice.props['aria-checked']), [true, false]);
    choices[1].props.onClick(); tree = render('classic');
    assert.equal(radios(tree).length, 0); assert.equal(button(tree).props['aria-label'], 'Theme: Low-poly');
    assert.equal(events.length, 1); assert.equal(events[0].name, 'art-theme-toggle'); assert.equal(events[0].data.theme, 'classic');
    button(tree).props.onClick(); tree = render('classic'); choices = radios(tree);
    assert.deepEqual(choices.map(choice => choice.props['aria-checked']), [false, true]);
    choices[1].props.onClick(); render('classic'); assert.equal(events.length, 1, 'selecting the active theme dispatched again');
    tree = render('classic'); button(tree).props.onKeyDown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }); tree = render('classic');
    assert.equal(radios(tree).length, 2);
    let stopped = false; window.emit('keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
    tree = render('classic'); assert.equal(radios(tree).length, 0); assert(stopped, 'Escape escaped to the scene while closing the menu');
    button(tree).props.onClick(); render('classic'); render('classic', true); tree = render('classic', true);
    assert.equal(radios(tree).length, 0); assert(button(tree).props.disabled); assert(renderToStaticMarkup(tree).includes('disabled=""'));
    slots.forEach(slot => slot?.cleanup?.());
    assert([...window.listeners.values(), ...document.listeners.values()].every(list => list.length === 0), 'theme menu listeners leaked');
  });
}

async function main() {
  verifyStorage();
  const { draco } = await decoderModule();
  const assets = { inkRooms: loadGLB('public/Room/pen-ink-rooms.glb', draco), classicRooms: loadGLB('public/Room/four-rooms.glb', draco),
    inkCourtyard: loadGLB('public/Room/pen-ink-courtyard.glb', draco), classicCourtyard: loadGLB('public/Room/courtyard.glb', draco),
    village: loadGLB('public/Room/medieval-village.glb', draco) };
  const { default: ArtThemeMeshes } = loadTS('src/Application/World/ArtThemeMeshes.ts', () => THREE);
  const pen = loadTS('src/Application/World/PenInk.ts', () => THREE);
  verifyGrafts(assets, ArtThemeMeshes); verifyRoom(assets, ArtThemeMeshes, pen); verifyWorld(); verifyMeadow(assets, pen); verifyVillage(assets); verifyThemeMenu();
  if (!process.exitCode) console.log(`Art themes: ${passed} checks passed.`);
}
main().catch(error => { process.exitCode = 1; console.error(error.stack); });
