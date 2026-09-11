/* Real camera transforms and locomotion; no WebGL renderer required. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
const layout = require('../src/design/courtyard-layout.json');

function load(relative, resolve, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = { exports: {}, require: resolve, ...extras };
  vm.runInNewContext(code, sandbox);
  return sandbox.exports;
}
const { CourtyardWalk } = load('../src/Application/World/CourtyardWalk.ts', () => ({ COURTYARD: layout }));
const { ROOMS, ROOM_SIZE } = load('../src/design/rooms.ts', () => require('../src/design/jo-colors.json'));

function cameraHarness() {
  const application = { sizes: { width: 1440, height: 900 }, time: { delta: 16 } };
  const reducedMotion = { matches: false };
  const timelines = [];
  class Timeline {
    constructor(options) { this.options = options; this.entries = []; this.killed = false; }
    to(target, vars) { this.entries.push({ target, vars }); return this; }
    call(fn) { this.entries.push({ fn }); return this; }
    kill() { this.killed = true; }
    finish(inspect = () => {}) {
      for (const entry of this.entries) {
        if (this.killed) return;
        if (entry.fn) { entry.fn(); continue; }
        const { target, vars } = entry;
        vars.onStart?.();
        for (const value of [0.1, 0.5, 1]) {
          target.value = value;
          vars.onUpdate?.();
          inspect();
        }
        vars.onComplete?.();
      }
      if (!this.killed) this.options?.onComplete?.();
    }
  }
  class Application { constructor() { return application; } }
  class EventEmitter {
    constructor() { this.events = []; }
    trigger(name, args) { this.events.push({ name, args }); }
  }
  const gsap = { timeline(options) { const timeline = new Timeline(options); timelines.push(timeline); return timeline; } };
  const { default: Camera } = load('../src/Application/Camera/Camera.ts', (name) => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return gsap;
    if (name === '../Application') return Application;
    if (name.endsWith('/Eventemitter')) return EventEmitter;
    if (name.endsWith('/rooms')) return { ROOMS, ROOM_SIZE };
    throw new Error(`Unexpected camera dependency: ${name}`);
  }, { window: { matchMedia: () => reducedMotion } });
  const camera = new Camera();
  return { camera, application, reducedMotion, finish: (inspect) => timelines.at(-1).finish(inspect), timelines };
}

let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function near(actual, expected, label = '', epsilon = 1e-8) {
  assert(Math.abs(actual - expected) < epsilon, `${label}: ${actual} != ${expected}`);
}
function direction(camera) { return camera.instance.getWorldDirection(new THREE.Vector3()); }
function advance(walk, heading, directions, ms = 1000, inspect = () => {}) {
  walk.stop();
  directions.forEach((direction, index) => walk.setInput(`input-${index}`, direction));
  for (let time = 0; time < ms; time += 10) { walk.update(10, heading); inspect(walk); }
}

check('tour uses a perspective camera at visitor eye height on desktop and mobile', () => {
  const { camera, application } = cameraHarness();
  camera.followCourtyard(9, 12, true);
  camera.setCourtyardHeading(Math.PI / 3);
  camera.navigate('courtyard', true);
  assert(camera.instance instanceof THREE.PerspectiveCamera);
  near(camera.instance.position.x, 9); near(camera.instance.position.y, 1.49); near(camera.instance.position.z, 12);
  near(camera.instance.fov, 65);
  near(direction(camera).x, Math.sin(Math.PI / 3)); near(direction(camera).z, Math.cos(Math.PI / 3));
  application.sizes.width = 390; application.sizes.height = 844; camera.resize();
  near(camera.instance.fov, 75); near(camera.getCourtyardYaw(), Math.PI / 3);
  near(camera.instance.position.y, 1.49);
});

check('jump height follows the physical eye without changing look direction, and landing restores eye height', () => {
  const { camera, application } = cameraHarness();
  camera.navigate('courtyard', true);
  camera.lookCourtyard(72, -28);
  const look = direction(camera);
  const walk = new CourtyardWalk(); walk.x = 80; walk.z = 80;
  assert(walk.jump());
  let peak = 0;
  for (let step = 0; step < 80; step++) {
    walk.update(10, camera.getCourtyardYaw());
    camera.followCourtyard(walk.x, walk.z, false, walk.y);
    peak = Math.max(peak, walk.y);
    near(camera.instance.position.y, 1.49 + walk.y);
    near(direction(camera).distanceTo(look), 0);
    if (step === 20) {
      Object.assign(application.sizes, { width: 390, height: 844 }); camera.resize();
      near(camera.instance.position.y, 1.49 + walk.y);
    }
  }
  assert(peak > .9 && peak < 1); near(walk.y, 0); near(camera.instance.position.y, 1.49);
  camera.followCourtyard(walk.x, walk.z, false, NaN);
  near(camera.instance.position.y, 1.49);
  walk.jump(); walk.update(100); walk.stop();
  camera.followCourtyard(walk.x, walk.z, true, walk.y);
  near(camera.instance.position.y, 1.49);
});

check('all headings keep W forward and D visually right at 8.4 m/s', () => {
  const { camera } = cameraHarness();
  camera.navigate('courtyard', true);
  for (const heading of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const walk = new CourtyardWalk(); walk.x = 0; walk.z = 70;
    camera.setCourtyardHeading(heading);
    const forward = direction(camera);
    advance(walk, heading, ['up']);
    near(walk.x, forward.x * 8.4); near(walk.z - 70, forward.z * 8.4);
    walk.x = 0; walk.z = 70;
    advance(walk, heading, ['right']);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.instance.quaternion);
    near(walk.x, right.x * 8.4); near(walk.z - 70, right.z * 8.4);
    walk.x = 0; walk.z = 70;
    advance(walk, heading, ['up', 'right']);
    near(Math.hypot(walk.x, walk.z - 70), 8.4);
  }
});

check('drag turns naturally without moving the eye; pitch stays bounded and survives resize', () => {
  const { camera } = cameraHarness(); camera.navigate('courtyard', true); camera.setCourtyardHeading(0);
  const eye = camera.instance.position.clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.instance.quaternion);
  camera.lookCourtyard(100, 60);
  assert(direction(camera).dot(right) > 0, 'drag right must turn toward screen-right');
  assert(direction(camera).y < 0, 'drag down must look down');
  near(camera.instance.position.distanceTo(eye), 0);
  camera.lookCourtyard(0, 100000); assert(direction(camera).y > -0.91);
  camera.lookCourtyard(0, -100000); assert(direction(camera).y < 0.91);
  const before = direction(camera); camera.resize();
  near(direction(camera).distanceTo(before), 0);
  camera.followCourtyard(18, 16); near(camera.instance.position.x, 18); near(camera.instance.position.z, 16);
  near(direction(camera).distanceTo(before), 0); near(camera.instance.position.y, 1.49);
});

check('exhibit reading returns to the visitor position and previous yaw/pitch, including a new map location', () => {
  const h = cameraHarness(); const { camera } = h;
  camera.followCourtyard(11, 10); camera.navigate('courtyard', true);
  camera.lookCourtyard(84, -42); const heading = camera.getCourtyardYaw(); const before = direction(camera);
  const anchor = new THREE.Object3D(); anchor.position.set(10, 1.8, 10);
  anchor.rotation.y = Math.PI / 4; camera.setExhibit(anchor, 2.6, 1.8);
  camera.navigate('exhibit');
  const assertProjection = () => {
    assert(camera.instance instanceof THREE.PerspectiveCamera);
    assert(camera.instance.fov > 0 && camera.instance.fov < 180);
    assert(camera.instance.position.toArray().every(Number.isFinite));
  };
  camera.lookCourtyard(100, 100); near(camera.getCourtyardYaw(), heading);
  h.finish(assertProjection);
  near(anchor.getWorldPosition(new THREE.Vector3()).project(camera.instance).x, 0);
  near(anchor.getWorldPosition(new THREE.Vector3()).project(camera.instance).y, 0);
  camera.followCourtyard(24, 13, true);
  camera.navigate('courtyard'); h.finish(assertProjection);
  near(camera.instance.position.x, 24); near(camera.instance.position.z, 13);
  near(direction(camera).distanceTo(before), 0); near(camera.getCourtyardYaw(), heading);
});

check('all 13 readers remain centered and within 2.5m of their anchors on narrow and wide screens', () => {
  const { camera, application } = cameraHarness();
  const stations = layout.stations;
  assert.equal(stations.length, 13);
  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
    Object.assign(application.sizes, { width, height });
    for (const station of stations) {
      const anchor = new THREE.Object3D();
      anchor.position.set(station.x + Math.sin(station.yaw) * .015, 2.1, station.z + Math.cos(station.yaw) * .015);
      anchor.rotation.y = station.yaw;
      camera.setExhibit(anchor, 2.6, 1.7);
      camera.navigate('exhibit', true);
      const eye = camera.instance.position;
      const center = anchor.getWorldPosition(new THREE.Vector3());
      assert(eye.distanceTo(center) > 0 && eye.distanceTo(center) <= 2.5 + 1e-8, `reader eye too far from ${station.id} at ${width}px`);
      const projected = center.clone().project(camera.instance);
      near(projected.x, 0); near(projected.y, 0);
    }
  }
});

check('room projection bridge settles in first person; exit and interruption restore requested room', () => {
  const h = cameraHarness(); const { camera } = h;
  camera.followCourtyard(7, 7); camera.navigate('courtyard');
  assert(camera.transitioning); assert(camera.instance instanceof THREE.PerspectiveCamera);
  h.finish(); assert(!camera.transitioning); near(camera.instance.position.y, 1.49);
  camera.navigate('piano'); h.finish(); assert(camera.instance instanceof THREE.OrthographicCamera);
  camera.navigate('courtyard'); camera.navigate('blog', true);
  assert(h.timelines.at(-1).killed); assert.equal(camera.view, 'blog'); assert(!camera.transitioning);
  assert(camera.instance instanceof THREE.OrthographicCamera);
});

check('monitor surface stays exactly centered before and after outdoor navigation at every tested size', () => {
  const h = cameraHarness(); const { camera, application } = h;
  const anchor = new THREE.Object3D(); anchor.position.set(-2.8, 2.05, -0.82); anchor.rotation.y = Math.PI;
  camera.setMonitor(anchor, 1.4, 0.84);
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    Object.assign(application.sizes, { width, height });
    camera.navigate('monitor', true);
    let center = anchor.getWorldPosition(new THREE.Vector3()).project(camera.instance);
    near(center.x, 0); near(center.y, 0);
    camera.navigate('courtyard', true); camera.navigate('monitor', true);
    center = anchor.getWorldPosition(new THREE.Vector3()).project(camera.instance);
    near(center.x, 0); near(center.y, 0);
  }
});

check('leaderboard defaults face the Play wall and the complete reader remains centered through resize', () => {
  const h = cameraHarness();
  const { camera, application } = h;
  const defaultCenter = new THREE.Vector3(-.22, 2, 3);
  camera.navigate('leaderboard', true);
  const fallback = defaultCenter.clone().project(camera.instance);
  near(fallback.x, 0); near(fallback.y, 0);
  const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 1.5);
  assert(camera.instance.position.clone().sub(defaultCenter).dot(front) > 0, 'camera must face the front of the Play wall');

  const wall = new THREE.Object3D(); wall.position.copy(defaultCenter); wall.rotation.y = Math.PI * 1.5;
  const anchor = new THREE.Object3D(); anchor.position.z = .01; wall.add(anchor);
  camera.setLeaderboard(anchor, 2.3, 2.78);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
    Object.assign(application.sizes, { width, height }); camera.resize();
    assert.equal(camera.view, 'leaderboard'); assert(camera.instance instanceof THREE.PerspectiveCamera);
    const center = anchor.getWorldPosition(new THREE.Vector3()).project(camera.instance);
    near(center.x, 0); near(center.y, 0);
    for (const x of [-1.15, 1.15]) for (const y of [-1.39, 1.39]) {
      const corner = anchor.localToWorld(new THREE.Vector3(x, y, 0)).project(camera.instance);
      assert(Math.abs(corner.x) < .95 && Math.abs(corner.y) < .95, `leaderboard clipped at ${width}×${height}`);
    }
    const position = camera.instance.position.clone(); const rotation = camera.instance.quaternion.clone();
    camera.lookRoom(100, 50); camera.lookSeated(100, 50); camera.lookCourtyard(100, 50);
    near(camera.instance.position.distanceTo(position), 0); near(camera.instance.quaternion.angleTo(rotation), 0);
  }
});

check('leaderboard animated, instant and interrupted returns preserve the Play owner and existing Summary framing', () => {
  for (const instant of [false, true]) {
    const h = cameraHarness(); const { camera } = h;
    camera.navigate('ai', true); camera.navigate('leaderboard'); h.finish();
    const before = camera.events.length;
    camera.navigate('ai', instant); if (!instant) h.finish();
    assert.equal(camera.view, 'ai'); assert(camera.instance instanceof THREE.OrthographicCamera);
    const returned = camera.events.slice(before).filter((event) => event.name === 'reading-return-safe');
    assert.equal(returned.length, 1);
    assert.equal(returned[0].args[0].view, 'leaderboard'); assert.equal(returned[0].args[0].ownerRoom, 'ai');
    const reference = cameraHarness(); reference.camera.navigate('ai', true);
    near(camera.instance.position.distanceTo(reference.camera.instance.position), 0);
    near(camera.instance.quaternion.angleTo(reference.camera.instance.quaternion), 0, 'restored Play rotation', 1e-7);
  }
  const h = cameraHarness(); h.camera.navigate('leaderboard', true);
  h.camera.navigate('ai'); const returning = h.timelines.at(-1);
  h.camera.navigate('leaderboard', true); assert(returning.killed);
  assert.equal(h.camera.view, 'leaderboard'); assert(h.camera.instance instanceof THREE.PerspectiveCamera);
  h.camera.navigate('blog', true);
  const event = h.camera.events.filter((entry) => entry.name === 'reading-return-safe').at(-1);
  assert.equal(event.args[0].view, 'leaderboard'); assert.equal(event.args[0].ownerRoom, 'ai');

  const summary = new THREE.Object3D(); summary.position.set(3, 2, .22);
  h.camera.setResume(summary, 2.3, 2.78); h.camera.navigate('resume', true);
  const center = summary.getWorldPosition(new THREE.Vector3()).project(h.camera.instance);
  near(center.x, 0); near(center.y, -.03, 'existing Summary offset is preserved');
});

check('input guards, opposing controls, and long-frame clamp prevent invalid or runaway movement', () => {
  const { camera } = cameraHarness(); const original = camera.getCourtyardYaw();
  camera.lookCourtyard(20, 20); near(camera.getCourtyardYaw(), original);
  camera.navigate('courtyard', true);
  camera.lookCourtyard(NaN, 1); camera.lookCourtyard(1, Infinity); camera.setCourtyardHeading(NaN);
  near(camera.getCourtyardYaw(), original);
  const walk = new CourtyardWalk(); walk.x = 0; walk.z = 70; walk.setInput('W', 'up');
  walk.update(10000, 0); near(walk.z - 70, 0.42);
  for (const delta of [NaN, Infinity, -Infinity, -10, 0]) assert.equal(walk.update(delta, 0), false);
  assert.equal(walk.update(10, NaN), false);
  walk.setInput('S', 'down'); assert.equal(walk.update(10, 0), false);
  walk.stop(); assert.equal(walk.update(10, 0), false);
});

check('faster first-person walking cannot enter the house or exhibit pedestals', () => {
  const assertClear = (walk) => {
    assert(!(Math.abs(walk.x) < layout.houseHalfSize + 0.4 && Math.abs(walk.z) < layout.houseHalfSize + 0.4));
    for (const station of layout.stations) assert(Math.hypot(walk.x - station.x, walk.z - station.z) >= 2 - 1e-8, station.id);
  };
  for (const [x, z] of [[8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [-8, -8]]) {
    const walk = new CourtyardWalk(); walk.x = x; walk.z = z;
    advance(walk, Math.atan2(-x, -z), ['up'], 3000, assertClear);
  }
  for (const station of layout.stations) {
    const walk = new CourtyardWalk(); walk.place(station.id); assertClear(walk);
    near(Math.sin(walk.heading), -Math.sin(station.yaw)); near(Math.cos(walk.heading), -Math.cos(station.yaw));
    advance(walk, walk.heading, ['up'], 3000, assertClear);
  }
});

if (failures) process.exitCode = 1;
else console.log('All first-person checks passed');
