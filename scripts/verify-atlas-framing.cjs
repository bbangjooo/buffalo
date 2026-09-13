/* Project the shipped room geometry through the actual old and current Camera.
 * No renderer or screenshot assumptions: the baseline is an unchanged source
 * snapshot, document corners use GLB anchors, and the organ uses decoded vertices.
 * Optional: node scripts/verify-atlas-framing.cjs --baseline /path/to/Camera.ts
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const ROOT = path.resolve(__dirname, '..');
const CURRENT = path.join(ROOT, 'src/Application/Camera/Camera.ts');
const baselineIndex = process.argv.indexOf('--baseline');
const BASELINE = baselineIndex < 0 ? path.join(__dirname, 'fixtures/atlas-camera-before-focus.ts')
  : path.resolve(process.argv[baselineIndex + 1] || '');
const SIZES = [[1200, 760], [1440, 900], [390, 844]];
const manifest = require('../assets/pen-ink-rooms-manifest.json');
let passed = 0;
let failed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
function near(a, b, label, epsilon = 1e-7) {
  assert(Math.abs(a - b) < epsilon, `${label}: ${a} != ${b}`);
}
function load(filename, resolve, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = { exports: {}, require: resolve, ...extras };
  vm.runInNewContext(code, sandbox, { filename });
  return sandbox.exports;
}
const { ROOMS, ROOM_SIZE } = load(path.join(ROOT, 'src/design/rooms.ts'), () => require('../src/design/jo-colors.json'));

function harness(filename, width, height) {
  const application = { sizes: { width, height }, time: { delta: 16 } };
  const timelines = [];
  const reducedMotion = { matches: false };
  class Timeline {
    constructor(options) { this.options = options; this.entries = []; this.killed = false; }
    to(target, vars) { this.entries.push({ target, vars }); return this; }
    call(fn) { this.entries.push({ fn }); return this; }
    kill() { this.killed = true; }
    finish(inspect = () => {}) {
      for (const entry of this.entries) {
        if (this.killed) return;
        if (entry.fn) { entry.fn(); inspect(); continue; }
        entry.vars.onStart?.();
        for (const value of [0, .25, .5, .75, 1]) {
          entry.target.value = value;
          entry.vars.onUpdate?.();
          inspect();
        }
        entry.vars.onComplete?.();
      }
      if (!this.killed) this.options?.onComplete?.();
    }
  }
  class Application { constructor() { return application; } }
  class EventEmitter {
    constructor() { this.events = []; }
    trigger(name, args) { this.events.push({ name, args }); }
  }
  const gsap = { timeline(options) { const t = new Timeline(options); timelines.push(t); return t; } };
  const { default: Camera } = load(filename, name => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return gsap;
    if (name === '../Application') return Application;
    if (name.endsWith('/Eventemitter')) return EventEmitter;
    if (name.endsWith('/rooms')) return { ROOMS, ROOM_SIZE };
    throw new Error(`Unexpected Camera dependency: ${name}`);
  }, { window: { matchMedia: () => reducedMotion } });
  return { camera: new Camera(), application, reducedMotion, timelines, finish: inspect => timelines.at(-1).finish(inspect) };
}

function loadRooms() {
  const bytes = fs.readFileSync(path.join(ROOT, 'public/Room/pen-ink-rooms.glb'));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const chunks = new Map();
  for (let at = 12; at < bytes.length;) {
    const length = bytes.readUInt32LE(at);
    chunks.set(bytes.readUInt32LE(at + 4), bytes.subarray(at + 8, at + 8 + length));
    at += 8 + length;
  }
  const data = JSON.parse(chunks.get(0x4e4f534a));
  const bin = chunks.get(0x004e4942);
  const nodes = data.nodes.map(node => {
    const object = new THREE.Object3D(); object.name = node.name;
    if (node.matrix) object.matrix.fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      object.position.fromArray(node.translation || [0, 0, 0]);
      object.quaternion.fromArray(node.rotation || [0, 0, 0, 1]);
      object.scale.fromArray(node.scale || [1, 1, 1]);
    }
    return object;
  });
  data.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const scene = new THREE.Group();
  nodes.filter(node => !node.parent).forEach(node => scene.add(node));
  scene.updateMatrixWorld(true);
  return { data, bin, nodes, scene };
}
async function dracoModule() {
  const filename = path.join(ROOT, 'public/draco/gltf/draco_decoder.js');
  const sandbox = { module: { exports: {} }, exports: {}, require, __filename: filename,
    __dirname: path.dirname(filename), process, console, Buffer, TextDecoder, TextEncoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return new Promise(resolve => sandbox.module.exports().then(module => resolve({ module })));
}
function organVertices(asset, draco) {
  const points = [];
  const owner = asset.scene.getObjectByName('Piano');
  assert(owner, 'The shipped organ owner is missing');
  asset.nodes.forEach((node, index) => {
    let parent = node;
    while (parent && parent !== owner) parent = parent.parent;
    if (!parent || asset.data.nodes[index].mesh === undefined) return;
    for (const primitive of asset.data.meshes[asset.data.nodes[index].mesh].primitives) {
      const compressed = primitive.extensions?.KHR_draco_mesh_compression;
      assert(compressed, `${node.name}: expected shipped Draco geometry`);
      const view = asset.data.bufferViews[compressed.bufferView];
      const bytes = asset.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const decoder = new draco.Decoder();
      const buffer = new draco.DecoderBuffer();
      const mesh = new draco.Mesh();
      const output = new draco.DracoFloat32Array();
      try {
        buffer.Init(new Int8Array(bytes), bytes.length);
        const status = decoder.DecodeBufferToMesh(buffer, mesh);
        assert(status.ok() && mesh.ptr, `${node.name}: invalid Draco mesh`);
        const attr = decoder.GetAttributeByUniqueId(mesh, compressed.attributes.POSITION);
        decoder.GetAttributeFloatForAllPoints(mesh, attr, output);
        assert.equal(attr.num_components(), 3);
        for (let i = 0; i < output.size(); i += 3) points.push(new THREE.Vector3(
          output.GetValue(i), output.GetValue(i + 1), output.GetValue(i + 2)).applyMatrix4(node.matrixWorld));
      } finally {
        draco.destroy(output); draco.destroy(mesh); draco.destroy(buffer); draco.destroy(decoder);
      }
    }
  });
  assert(points.length > 1000, 'The complete authored organ geometry must be inspected');
  return points;
}
function aperture(asset, definition) {
  const anchor = asset.scene.getObjectByName(definition.anchor);
  assert(anchor, `Missing content anchor ${definition.anchor}`);
  return [-.5, .5].flatMap(x => [-.5, .5].map(y => anchor.localToWorld(
    new THREE.Vector3(x * definition.width, y * definition.height, 0))));
}
function frame(points, camera, width, height) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  let minDepth = Infinity, maxDepth = -Infinity;
  for (const point of points) {
    const projected = point.clone().project(camera);
    const x = (projected.x + 1) * width / 2;
    const y = (1 - projected.y) * height / 2;
    assert([x, y, projected.z].every(Number.isFinite), 'Non-finite projected content');
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    minDepth = Math.min(minDepth, projected.z); maxDepth = Math.max(maxDepth, projected.z);
  }
  return { left, right, top, bottom, width: right - left, height: bottom - top,
    margin: Math.min(left, width - right, top, height - bottom), minDepth, maxDepth };
}
function assertVisible(box, label, minimumMargin = 12) {
  assert(box.margin >= minimumMargin, `${label}: content clips; smallest viewport edge margin ${box.margin.toFixed(2)}px`);
  assert(box.minDepth > -1 && box.maxDepth < 1, `${label}: content crosses the near/far plane`);
}
function assertSamePose(actual, expected, label) {
  assert.equal(actual.constructor.name, expected.constructor.name, `${label}: projection type`);
  actual.projectionMatrix.elements.forEach((n, i) => near(n, expected.projectionMatrix.elements[i], `${label}: projection[${i}]`));
  actual.matrixWorld.elements.forEach((n, i) => near(n, expected.matrixWorld.elements[i], `${label}: world[${i}]`));
}
function bindFocus(camera, asset) {
  for (const [method, definition] of [['setMonitor', manifest.monitorScreen], ['setResume', manifest.resumeScreen], ['setLeaderboard', manifest.leaderboardScreen]]) {
    camera[method](asset.scene.getObjectByName(definition.anchor), definition.width, definition.height);
  }
  camera.setPianoSeat(asset.scene.getObjectByName('PianoEyeAnchor'), asset.scene.getObjectByName('PianoLookAnchor'));
}

async function main() {
  const asset = loadRooms();
  const { module: draco } = await dracoModule();
  const organ = organVertices(asset, draco);
  const organTop = organ.reduce((top, point) => Math.max(top, point.y), -Infinity);
  const organHead = organ.filter(point => point.y >= organTop - .5);
  assert(organHead.length > 30, 'Actual pipe crowns must be represented');
  const cores = {
    developer: aperture(asset, manifest.resumeScreen),
    piano: organ,
    blog: aperture(asset, manifest.monitorScreen),
    ai: aperture(asset, manifest.leaderboardScreen),
  };
  console.log(`Inspecting ${organ.length.toLocaleString()} actual organ vertices (${organHead.length.toLocaleString()} at the crown), 3 document apertures and the portrait.`);

  for (const [width, height] of SIZES) {
    const before = harness(BASELINE, width, height), after = harness(CURRENT, width, height);
    for (const room of Object.keys(ROOMS)) {
      check(`${width}×${height} ${room}: core content is visibly larger without clipping`, () => {
        before.camera.navigate(room, true); after.camera.navigate(room, true);
        const oldBox = frame(cores[room], before.camera.instance, width, height);
        const box = frame(cores[room], after.camera.instance, width, height);
        const ratioX = box.width / oldBox.width, ratioY = box.height / oldBox.height;
        const areaRatio = ratioX * ratioY;
        console.log(`  ${room}: ${oldBox.width.toFixed(1)}×${oldBox.height.toFixed(1)} → ${box.width.toFixed(1)}×${box.height.toFixed(1)}px; scale ${ratioX.toFixed(3)}×${ratioY.toFixed(3)}; area ${areaRatio.toFixed(3)}; edge margin ${box.margin.toFixed(1)}px`);
        assert(ratioX >= 1.15, `${room}: needs at least 15% width enlargement, got ${ratioX.toFixed(3)}`);
        assert(areaRatio >= 1.30, `${room}: needs at least 30% projected-area enlargement, got ${areaRatio.toFixed(3)}`);
        assert(ratioX >= 1 && ratioY >= 1, `${room}: neither projected axis may shrink, got ${ratioX.toFixed(3)}×${ratioY.toFixed(3)}`);
        assertVisible(box, `${width}×${height} ${room}`);
        if (room === 'developer') assertVisible(frame(aperture(asset, manifest.portrait), after.camera.instance, width, height), 'portrait');
        if (room === 'piano') assertVisible(frame(organHead, after.camera.instance, width, height), 'organ crown');
      });
    }

    check(`${width}×${height}: animated room navigation and reader returns settle to the enlarged framing`, () => {
      const h = harness(CURRENT, width, height);
      bindFocus(h.camera, asset);
      const assertFinite = () => {
        assert(h.camera.instance.matrixWorld.elements.every(Number.isFinite));
        assert(h.camera.instance.projectionMatrix.elements.every(Number.isFinite));
      };
      for (const [room, focus] of [['developer', 'resume'], ['piano', 'piano-seat'], ['blog', 'monitor'], ['ai', 'leaderboard']]) {
        h.camera.navigate(room); if (h.camera.transitioning) h.finish(assertFinite);
        const reference = harness(CURRENT, width, height); reference.camera.navigate(room, true);
        assertSamePose(h.camera.instance, reference.camera.instance, `animated ${room}`);
        h.camera.navigate(focus); h.finish(assertFinite);
        h.camera.navigate(room); h.finish(assertFinite);
        assertSamePose(h.camera.instance, reference.camera.instance, `${focus} return`);
        assertVisible(frame(cores[room], h.camera.instance, width, height), `${focus} return core`);
      }
      h.camera.navigate('monitor'); h.camera.navigate('piano', true);
      assert(h.timelines.at(-1).killed, 'Interrupted reader animation remains active');
      assert.equal(h.camera.view, 'piano');
      h.camera.navigate('courtyard'); h.finish(assertFinite);
      h.camera.navigate('blog'); h.finish(assertFinite);
      const reference = harness(CURRENT, width, height); reference.camera.navigate('blog', true);
      assertSamePose(h.camera.instance, reference.camera.instance, 'courtyard return');
    });

    check(`${width}×${height}: document readers, piano seat and first-person poses preserve their baseline behavior`, () => {
      bindFocus(before.camera, asset); bindFocus(after.camera, asset);
      for (const focus of ['resume', 'monitor', 'leaderboard', 'piano-seat', 'courtyard', 'rhythm']) {
        before.camera.navigate(focus, true); after.camera.navigate(focus, true);
        assertSamePose(after.camera.instance, before.camera.instance, focus);
        const definition = { resume: manifest.resumeScreen, monitor: manifest.monitorScreen, leaderboard: manifest.leaderboardScreen }[focus];
        if (definition) assertVisible(frame(aperture(asset, definition), after.camera.instance, width, height), focus);
      }
    });
  }
  check('resizing and reduced-motion navigation preserve the requested room and core visibility', () => {
    const h = harness(CURRENT, ...SIZES[0]); h.reducedMotion.matches = true;
    for (const [width, height] of SIZES) for (const room of Object.keys(ROOMS)) {
      h.camera.navigate(room);
      Object.assign(h.application.sizes, { width, height }); h.camera.resize();
      const reference = harness(CURRENT, width, height); reference.camera.navigate(room, true);
      assert(!h.camera.transitioning); assert.equal(h.camera.view, room);
      assertSamePose(h.camera.instance, reference.camera.instance, `resized ${room}`);
      assertVisible(frame(cores[room], h.camera.instance, width, height), `resized ${room}`);
    }
  });
  console.log(`${passed} atlas framing checks passed; ${failed} failed.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
