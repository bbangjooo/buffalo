/* Project real camera poses: vertical arrival, room labels, complete orbit, and cancellation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

function load(file, resolve, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const scope = { exports: {}, require: resolve, ...extra };
  vm.runInNewContext(code, scope, { filename: file });
  return scope.exports;
}
const rooms = load('src/design/rooms.ts', () => require('../src/design/jo-colors.json'));
const onboarding = load('src/design/onboarding.ts', () => ({}));

function harness(width = 1440, height = 900, reduced = false) {
  const application = { sizes: { width, height } };
  const timelines = [];
  class Timeline {
    constructor(options) { this.options = options; this.entries = []; this.killed = false; }
    to(target, vars) { this.entries.push({ target, vars }); return this; }
    kill() { this.killed = true; }
    step(value) { if (this.killed) return; for (const { target, vars } of this.entries) { target.value = value; vars.onUpdate?.(); } }
    complete() { if (!this.killed) { this.step(1); this.options.onComplete?.(); } }
  }
  const { default: Camera } = load('src/Application/Camera/Camera.ts', name => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return { timeline(options) { const timeline = new Timeline(options); timelines.push(timeline); return timeline; } };
    if (name.endsWith('/Application')) return class Application { constructor() { return application; } };
    if (name.endsWith('/Eventemitter')) return class EventEmitter { trigger() {} };
    if (name.endsWith('/rooms')) return rooms;
    if (name.endsWith('/onboarding')) return onboarding;
    throw new Error(`Unexpected dependency ${name}`);
  }, { window: { matchMedia: () => ({ matches: reduced }) } });
  const camera = new Camera();
  return { camera, application, timelines };
}
function near(actual, expected, message, epsilon = 1e-7) {
  assert(Math.abs(actual - expected) < epsilon, `${message}: ${actual} != ${expected}`);
}
function project(camera, sizes, x, z) {
  const point = new THREE.Vector3(x, 0, z).project(camera.instance);
  return { x: (point.x + 1) / 2 * sizes.width, y: (1 - point.y) / 2 * sizes.height };
}
let passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.stack}`); }
}

check('all four room floors fit an exact vertical north-up view at desktop, phone, and landscape sizes', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
    const { camera, application } = harness(width, height);
    camera.beginOnboarding();
    assert(camera.instance instanceof THREE.OrthographicCamera);
    assert.equal(camera.transitioning, true);
    const direction = camera.instance.getWorldDirection(new THREE.Vector3());
    near(direction.x, 0, 'no horizontal tilt'); near(direction.y, -1, 'vertical downward'); near(direction.z, 0, 'no horizontal tilt');
    const bounds = onboarding.onboardingLayout(width, height);
    const upperLeft = project(camera, application.sizes, -rooms.ROOM_SIZE, -rooms.ROOM_SIZE);
    const lowerRight = project(camera, application.sizes, rooms.ROOM_SIZE, rooms.ROOM_SIZE);
    near(upperLeft.x, bounds.left, 'west edge'); near(upperLeft.y, bounds.top, 'north edge');
    near(lowerRight.x, bounds.left + bounds.size, 'east edge'); near(lowerRight.y, bounds.top + bounds.size, 'south edge');
    assert(upperLeft.x >= 0 && lowerRight.x <= width && upperLeft.y > 35 && lowerRight.y < height - 25);
    for (const room of onboarding.ONBOARDING_ROOMS) {
      const center = new THREE.Vector3(2.8, 0, 2.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), rooms.ROOMS[room.id].angle);
      const projected = project(camera, application.sizes, center.x, center.z);
      near(projected.x, bounds.left + bounds.size * (.25 + room.column * .5), `${room.id} annotation column`);
      near(projected.y, bounds.top + bounds.size * (.25 + room.row * .5), `${room.id} annotation row`);
    }
    const before = camera.instance.matrixWorld.clone();
    camera.lookRoom(120, 140); camera.navigate('piano', true);
    assert(camera.instance.matrixWorld.equals(before), 'writing blocks pointer and navigation changes');
  }
});

check('one continuous descending flight turns overhead, decelerates into Summary and survives resize', () => {
  const { camera, application, timelines } = harness();
  let completions = 0;
  camera.beginOnboarding();
  const startPosition = camera.instance.position.clone();
  const startRotation = camera.instance.quaternion.clone();
  camera.finishOnboarding(() => completions++);
  assert.equal(camera.onboarding, 'tour');
  const timeline = timelines.at(-1);
  assert(timeline.entries[0].vars.duration >= 6 && timeline.entries[0].vars.duration <= 8, 'allow a measured drone arrival');
  timeline.step(0);
  near(camera.instance.position.distanceTo(startPosition), 0, 'no initial camera cut');
  near(camera.instance.quaternion.angleTo(startRotation), 0, 'no initial roll cut');
  let previous;
  let revolution = 0;
  const samples = [];
  for (let i = 1; i <= 200; i++) {
    const t = i / 200;
    timeline.step(t);
    const forward = camera.instance.getWorldDirection(new THREE.Vector3());
    const angle = Math.atan2(forward.x, forward.z);
    if (previous !== undefined) revolution += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
    previous = angle;
    samples.push({ position: camera.instance.position.clone(), rotation: camera.instance.quaternion.clone(), span: camera.pose.span });
    assert.equal(camera.transitioning, true);
    assert(camera.instance.position.y > 12, 'flight remains above the walls throughout');
    assert(Number.isFinite(camera.instance.position.length()));
    if (i === 40) {
      assert(revolution > .5, 'orbit starts while the camera is still overhead');
      assert(forward.y < -.99, 'early orbit remains a high drone view');
    }
    if (i === 120) {
      Object.assign(application.sizes, { width: 390, height: 844 }); camera.resize();
      assert.equal(camera.onboarding, 'tour'); assert.equal(camera.transitioning, true); assert.equal(timeline.killed, false);
      const after = camera.instance.getWorldDirection(new THREE.Vector3());
      near(after.distanceTo(forward), 0, 'resize preserves flight progress');
    }
  }
  assert(revolution > Math.PI * 2 && revolution < Math.PI * 2.3, 'pass around all sides before facing Summary');
  const rotationStep = i => samples[i].rotation.angleTo(samples[i - 1].rotation);
  const midSpeed = rotationStep(80);
  assert(rotationStep(195) < midSpeed * .01, 'long, smooth angular deceleration');
  assert(samples[199].position.distanceTo(samples[198].position) < .02, 'position comes to rest before UI restoration');
  assert(Math.abs(samples[199].span - samples[198].span) < .01, 'zoom settles before UI restoration');
  for (let i = 2; i < samples.length; i++) {
    assert(rotationStep(i) < .1, 'no discontinuity at a tilt/orbit phase boundary');
  }
  const beforeFinish = camera.instance.matrixWorld.clone();
  timeline.complete();
  assert.equal(completions, 1); assert.equal(camera.onboarding, 'done'); assert.equal(camera.transitioning, false);
  for (let i = 0; i < 16; i++) near(camera.instance.matrixWorld.elements[i], beforeFinish.elements[i], 'no landing cut');
  const expected = harness(390, 844).camera;
  near(camera.instance.position.distanceTo(expected.instance.position), 0, 'original About position');
  near(camera.instance.quaternion.angleTo(expected.instance.quaternion), 0, 'original About orientation');
  near(camera.instance.top, expected.instance.top, 'original About framing');
});

check('resize during handwriting keeps the vertical pose and input lock', () => {
  const { camera, application, timelines } = harness();
  camera.beginOnboarding(); Object.assign(application.sizes, { width: 320, height: 568 }); camera.resize();
  assert.equal(camera.onboarding, 'writing'); assert.equal(camera.transitioning, true); assert.equal(timelines.length, 0);
  near(camera.instance.getWorldDirection(new THREE.Vector3()).y, -1, 'still vertical');
  const corner = project(camera, application.sizes, 5.6, 5.6);
  assert(corner.x <= 320 && corner.y < 568);
});

check('explicit camera cancellation settles once, and reduced motion never starts an orbit', () => {
  for (const duringTour of [false, true]) {
    const { camera, timelines } = harness(); let original = 0; let skipped = 0;
    camera.beginOnboarding();
    if (duringTour) { camera.finishOnboarding(() => original++); timelines.at(-1).step(.43); }
    camera.finishOnboarding(() => skipped++, true);
    for (const timeline of timelines) timeline.complete();
    assert.equal(skipped, 1); assert.equal(original, 0); assert.equal(camera.onboarding, 'done'); assert.equal(camera.view, 'developer');
    camera.navigate('resume', true); assert.equal(camera.view, 'resume');
  }
  const { camera, timelines } = harness(390, 844, true); let completed = 0;
  camera.beginOnboarding(); camera.finishOnboarding(() => completed++);
  assert.equal(completed, 1); assert.equal(timelines.length, 0); assert.equal(camera.transitioning, false);
});

check('disposal cancels a running tour without a stale completion callback', () => {
  const { camera, timelines } = harness(); let completed = 0;
  camera.beginOnboarding(); camera.finishOnboarding(() => completed++); timelines.at(-1).step(.3);
  camera.cancelOnboarding(); timelines.at(-1).complete();
  assert.equal(completed, 0); assert.equal(timelines.at(-1).killed, true); assert.equal(camera.transitioning, false);
});

if (!process.exitCode) console.log(`All ${passed} onboarding camera checks passed`);
