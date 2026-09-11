/* Exercise the real guide controller with THREE transforms and deterministic animation/time. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

function load(relative, resolve, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  const sandbox = { exports: {}, require: resolve, ...globals };
  vm.runInNewContext(result.outputText, sandbox, { filename });
  return sandbox.exports;
}

const { ROOMS } = load('src/design/rooms.ts', () => require('../src/design/jo-colors.json'));
const rhythmTrack = require('../src/design/rhythm-track.mjs');
const rhythmConfig = load('src/design/rhythm-game.ts', (name) => {
  if (name === './rhythm-track.mjs') return rhythmTrack;
  throw new Error(`Unexpected rhythm configuration dependency: ${name}`);
});
const rhythmStageModule = load('src/Application/World/RhythmStage.ts', (name) => {
  if (name === 'three') return THREE;
  if (name.endsWith('/rhythm-game')) return rhythmConfig;
  throw new Error(`Unexpected stage dependency: ${name}`);
});
const near = (actual, expected, label = '', tolerance = 1e-7) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
const sameRotation = (actual, expected) => near(new THREE.Vector3().setFromEuler(actual).distanceTo(new THREE.Vector3().setFromEuler(expected)), 0, 'joint rest rotation');
const ancestor = (object, parent) => { for (let node = object; node; node = node.parent) if (node === parent) return true; return false; };

function modelFixture(variant = 'character', withAnchor = true) {
  const model = new THREE.Group();
  model.name = variant === 'character' ? 'GuideCharacter' : 'OriginalRobot';
  model.position.set(9, 3, -7);
  model.rotation.set(.2, -.7, .1);
  model.userData = { interactiveId: 'old-guide', room: 'piano', keep: 'author extras' };
  const head = new THREE.Group(); head.name = variant === 'character' ? 'GuideHead' : 'RobotHead';
  head.position.set(0, 1, 0); head.rotation.set(.03, .05, -.04); model.add(head);
  const face = new THREE.Mesh(new THREE.BoxGeometry(.12, .04, .03), new THREE.MeshStandardMaterial());
  face.name = 'FaceDetails'; face.position.set(.12, .02, .31);
  face.userData = { interactiveId: 'old-eye', room: 'blog', keep: 'face' }; head.add(face);
  const arm = new THREE.Group(); arm.name = variant === 'character' ? 'GuideArm' : 'RobotArm';
  arm.position.set(-.32, .61, .12); arm.rotation.set(.07, -.09, .11); model.add(arm);
  const armMesh = face.clone(); armMesh.name = 'Hand'; arm.add(armMesh);
  const feet = [];
  if (variant === 'character') for (const [index, name] of ['GuideFootLeft', 'GuideFootRight'].entries()) {
    const joint = new THREE.Group(); joint.name = name; joint.position.set(index ? -.24 : .24, .08, .08);
    joint.rotation.set(index ? -.03 : .05, .02, -.04); model.add(joint); feet.push(joint);
  }
  let anchor;
  if (withAnchor) {
    anchor = new THREE.Object3D(); anchor.name = variant === 'character' ? 'GuideAnchor' : 'RobotGuideAnchor';
    anchor.position.set(0, 1.62, 0); model.add(anchor);
  }
  return { model, head, face, arm, feet, anchor, rest: {
    head: head.rotation.clone(), arm: arm.rotation.clone(), feet: feet.map((joint) => joint.rotation.clone()),
    footPositions: feet.map((joint) => joint.position.clone()),
  } };
}

function harness({ reduced = false, variant = 'character', withAnchor = true, withCamera = false, role } = {}) {
  const fixture = modelFixture(variant, withAnchor);
  const scene = new THREE.Scene();
  const existingRoom = new THREE.Group(); existingRoom.name = 'ExistingRoom'; existingRoom.position.set(4, 2, -3);
  scene.add(existingRoom); existingRoom.add(fixture.model);
  const application = { scene, time: { delta: 16 }, renderer: { instance: { shadowMap: { needsUpdate: false } } } };
  if (withCamera) {
    application.camera = { instance: new THREE.PerspectiveCamera(), view: 'developer', transitioning: false };
    application.camera.instance.position.set(12, 8, 12);
    scene.add(application.camera.instance);
  }
  const reducedMotion = { matches: reduced };
  const messages = [], subscriptions = new Map(), listeners = new Map(), timers = new Map(), timelines = [];
  const subscriptionCalls = [], listenerCalls = [], storageAccess = [];
  let now = 100, nextTimer = 1, focused = false;
  const EventBus = {
    on(name, callback) { subscriptionCalls.push(name); subscriptions.set(name, callback); return () => subscriptions.delete(name); },
    dispatch(name, data) { messages.push({ name, data }); },
  };
  class Timeline {
    constructor(options) { this.options = options; this.steps = []; this.killed = false; this.createdAt = now; }
    to(target, vars) { this.steps.push({ target, vars }); return this; }
    kill() { this.killed = true; }
    apply(index) {
      if (this.killed) return;
      const step = this.steps[index];
      for (const key of ['x', 'y', 'z']) if (typeof step.vars[key] === 'number') step.target[key] = step.vars[key];
      this.options.onUpdate?.();
    }
    finish(inspect = () => {}) {
      this.steps.forEach((_, index) => { this.apply(index); inspect(); });
      if (!this.killed) this.options.onComplete?.();
    }
  }
  const storage = new Map();
  const { default: Guide } = load('src/Application/World/GuideRobot.ts', (name) => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return { gsap: { timeline(options) { const result = new Timeline(options); timelines.push(result); return result; } } };
    if (name.endsWith('/EventBus')) return { EventBus };
    if (name.endsWith('/rooms')) return { ROOMS };
    if (name.endsWith('/RhythmStage')) return rhythmStageModule;
    throw new Error(`Unexpected guide dependency: ${name}`);
  }, {
    window: { matchMedia: () => reducedMotion,
      addEventListener: (name, fn) => { listenerCalls.push({ action: 'add', name }); listeners.set(name, fn); },
      removeEventListener: (name, fn) => { listenerCalls.push({ action: 'remove', name }); if (listeners.get(name) === fn) listeners.delete(name); },
    },
    localStorage: {
      getItem: (key) => { storageAccess.push({ action: 'get', key }); return storage.get(key) || null; },
      setItem: (key, value) => { storageAccess.push({ action: 'set', key }); storage.set(key, value); },
    },
    document: { activeElement: {}, querySelector: () => ({ contains: () => focused, matches: () => false }) },
    performance: { now: () => now },
    setTimeout: (callback, duration) => { const id = nextTimer++; timers.set(id, { callback, at: now + duration }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const guide = new Guide(application, fixture.model, role ? { role } : undefined);
  return {
    guide, ...fixture, application, existingRoom, messages, subscriptions, listeners, timers, timelines, reducedMotion,
    subscriptionCalls, listenerCalls, storageAccess,
    setNow(value) { now = value; },
    tick(deltaMs) { now += deltaMs; guide.update(deltaMs); },
    setFocused(value) { focused = value; },
    advanceTimers(delta) {
      now += delta;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    lastMessage: () => messages.at(-1)?.data,
    restFeet: () => fixture.feet.forEach((foot, i) => {
      sameRotation(foot.rotation, fixture.rest.feet[i]);
      near(foot.position.distanceTo(fixture.rest.footPositions[i]), 0, 'foot rest position');
    }),
  };
}

let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

check('new pivots bind and all descendant picking resolves to the traveling guide only', () => {
  const h = harness();
  assert.equal(h.guide.anchor, h.anchor);
  assert.equal(h.guide.root.userData.guideVariant, 'character');
  assert.equal(h.guide.root.parent, h.application.scene);
  assert.equal(h.model.parent, h.guide.root);
  near(h.model.position.length(), 0); near(h.model.quaternion.angleTo(new THREE.Quaternion()), 0);
  assert.equal(h.existingRoom.parent, h.application.scene);
  assert.deepEqual(h.existingRoom.position.toArray(), [4, 2, -3]);
  h.model.traverse((node) => {
    assert.equal(node.userData.interactiveId, undefined);
    assert.equal(node.userData.room, undefined);
    let owner = node;
    while (owner && !owner.userData.interactiveId) owner = owner.parent;
    assert.equal(owner, h.guide.root);
    if (node instanceof THREE.Mesh) assert(node.castShadow && node.receiveShadow);
  });
  assert.equal(h.model.userData.keep, 'author extras');
  assert.equal(h.face.userData.keep, 'face');
  h.guide.dispose();
});

check('character wave is bounded, facial meshes follow the head, and completion restores the authored pose', () => {
  const h = harness();
  const local = h.face.position.clone();
  const before = h.face.getWorldPosition(new THREE.Vector3());
  h.guide.react('success');
  const timeline = h.timelines.at(-1);
  assert(timeline && timeline.steps.length > 0);
  let maxArm = 0, faceMoved = false;
  timeline.finish(() => {
    maxArm = Math.max(maxArm, Math.abs(h.arm.rotation.z - h.rest.arm.z));
    faceMoved ||= before.distanceTo(h.face.getWorldPosition(new THREE.Vector3())) > .001;
    assert.equal(h.face.parent, h.head); near(h.face.position.distanceTo(local), 0);
  });
  assert(maxArm >= .2 && maxArm <= .4, `character arm wave ${maxArm} rad`);
  assert(faceMoved, 'face must inherit head animation');
  sameRotation(h.head.rotation, h.rest.head); sameRotation(h.arm.rotation, h.rest.arm); h.restFeet();
  assert(h.application.renderer.instance.shadowMap.needsUpdate);
  h.guide.dispose();
});

check('legacy RobotHead, RobotArm and RobotGuideAnchor retain expressive motion and fallback anchors remain usable', () => {
  const h = harness({ variant: 'robot' });
  assert.equal(h.guide.root.userData.guideVariant, 'robot'); assert.equal(h.guide.anchor, h.anchor);
  h.guide.react('success'); let raised = 0;
  h.timelines.at(-1).finish(() => { raised = Math.max(raised, Math.abs(h.arm.rotation.z - h.rest.arm.z)); });
  assert(raised > .8 && raised < 1.2);
  sameRotation(h.head.rotation, h.rest.head); sameRotation(h.arm.rotation, h.rest.arm);
  h.guide.dispose();
  const fallback = harness({ variant: 'robot', withAnchor: false });
  assert(ancestor(fallback.guide.anchor, fallback.model)); assert(fallback.guide.anchor.position.y > 1);
  fallback.guide.dispose();
});

check('room travel reaches the same pose as an instant change, without moving the house or leaving the scene', () => {
  const h = harness(), reference = harness();
  const radius = Math.hypot(h.guide.root.position.x, h.guide.root.position.z);
  for (const room of ['piano', 'blog', 'ai', 'developer']) {
    h.guide.setRoom(room); reference.guide.setRoom(room, true);
    let moving = false;
    for (let step = 0; step < 40; step++) {
      const previous = h.guide.root.position.clone(); h.guide.update(50);
      moving ||= previous.distanceTo(h.guide.root.position) > .00001;
      near(Math.hypot(h.guide.root.position.x, h.guide.root.position.z), radius);
      assert(h.guide.root.position.y >= -1e-8 && h.guide.root.position.y < .1);
    }
    assert(moving); near(h.guide.root.position.distanceTo(reference.guide.root.position), 0);
    near(h.guide.root.quaternion.angleTo(reference.guide.root.quaternion), 0);
    assert.equal(h.guide.root.userData.room, room); assert.equal(h.guide.root.parent, h.application.scene);
    assert.equal(h.lastMessage().visible, true); h.restFeet();
    h.timelines.at(-1)?.finish();
  }
  assert.deepEqual(h.existingRoom.position.toArray(), [4, 2, -3]);
  h.guide.dispose(); reference.guide.dispose();
});

check('reading hides the guide, cancels travel and reactions, and ignores later movement until walking resumes', () => {
  const h = harness(), reference = harness();
  h.guide.setRoom('blog'); h.guide.update(100); h.guide.react('failure');
  const reaction = h.timelines.at(-1); reaction.apply(0);
  h.guide.setReading(true); reference.guide.setRoom('blog', true);
  assert(!h.guide.root.visible); assert(reaction.killed); assert.equal(h.lastMessage().visible, false);
  assert.equal(h.timers.size, 0); near(h.guide.root.position.distanceTo(reference.guide.root.position), 0);
  sameRotation(h.head.rotation, h.rest.head); sameRotation(h.arm.rotation, h.rest.arm);
  const pose = h.guide.root.position.clone(), count = h.timelines.length;
  h.guide.update(100); h.guide.help(); h.guide.react('success');
  near(h.guide.root.position.distanceTo(pose), 0); assert.equal(h.timelines.length, count);
  h.guide.setReading(false); assert(h.guide.root.visible);
  h.guide.setWalking(true); h.guide.walkTo(20, 24, .7, true); h.guide.setReading(true);
  const readingPose = h.guide.root.position.clone();
  h.guide.walkTo(30, 34, 1.2, true);
  near(h.guide.root.position.distanceTo(readingPose), 0, 'walking must pause while reading');
  h.restFeet(); h.guide.dispose(); reference.guide.dispose();
});

check('walking animates both feet about their authored pose and resets them at rest or on stop', () => {
  const h = harness(); h.guide.setWalking(true); h.guide.walkTo(10, 14, 1.2, true);
  assert.equal(h.guide.root.position.x, 10); assert.equal(h.guide.root.position.z, 14); near(h.guide.root.rotation.y, 1.2);
  const offsets = h.feet.map((foot, i) => foot.rotation.x - h.rest.feet[i].x);
  assert(Math.abs(offsets[0]) > .02 && Math.abs(offsets[0]) <= .2); near(offsets[0] + offsets[1], 0);
  h.guide.walkTo(10, 14, 1.2, false); h.restFeet(); sameRotation(h.arm.rotation, h.rest.arm);
  h.setNow(230); h.guide.walkTo(11, 16, 1, true); h.guide.setWalking(false); h.restFeet();
  sameRotation(h.arm.rotation, h.rest.arm);
  const atRest = h.guide.root.position.clone(); h.guide.walkTo(99, 99, 0, true); near(h.guide.root.position.distanceTo(atRest), 0);
  h.guide.setWalking(true); h.guide.walkTo(12, 18, 0, true); h.guide.setRoom('piano', true); h.restFeet();
  h.guide.dispose();
});

check('reduced motion skips gestures, bobbing, and foot strides while preserving travel and walking destinations', () => {
  const h = harness({ reduced: true }), reference = harness();
  h.guide.setRoom('ai'); reference.guide.setRoom('ai', true);
  near(h.guide.root.position.distanceTo(reference.guide.root.position), 0);
  h.guide.help(); h.guide.react('success'); h.guide.react('failure'); assert.equal(h.timelines.length, 0);
  h.guide.setWalking(true); h.guide.walkTo(32, 30, -.7, true);
  assert.equal(h.guide.root.position.x, 32); assert.equal(h.guide.root.position.z, 30);
  near(h.guide.root.position.y, -.15); h.restFeet(); sameRotation(h.arm.rotation, h.rest.arm);
  const y = h.guide.root.position.y; h.setNow(600); h.guide.walkTo(33, 31, -.7, true); near(h.guide.root.position.y, y);
  h.guide.dispose(); reference.guide.dispose();
  const switching = harness(); switching.guide.setRoom('blog'); switching.guide.update(100);
  switching.reducedMotion.matches = true; switching.guide.update();
  const instant = harness(); instant.guide.setRoom('blog', true);
  near(switching.guide.root.position.distanceTo(instant.guide.root.position), 0); switching.restFeet();
  switching.guide.dispose(); instant.guide.dispose();
});

check('focused hint timers survive briefly, then dismissal and disposal clear timers, subscriptions, listeners and animation', () => {
  const h = harness(); h.guide.help(); assert.equal(h.timers.size, 1);
  h.setFocused(true); h.advanceTimers(6000); assert.equal(h.lastMessage().visible, true); assert.equal(h.timers.size, 1);
  h.setFocused(false); h.advanceTimers(1000); assert.equal(h.lastMessage().visible, false); assert.equal(h.timers.size, 0);
  h.guide.help(); h.listeners.get('storage')({ key: 'bbangjo.guide.dismissed', newValue: '1' });
  assert.equal(h.lastMessage().visible, false); assert.equal(h.timers.size, 0);
  h.guide.help(); const reaction = h.timelines.at(-1); reaction.apply(0);
  assert.equal(h.subscriptions.size, 1); assert.equal(h.listeners.size, 1);
  h.guide.dispose(); assert(reaction.killed); assert.equal(h.guide.root.parent, null);
  assert.equal(h.timers.size, 0); assert.equal(h.subscriptions.size, 0); assert.equal(h.listeners.size, 0);
  sameRotation(h.head.rotation, h.rest.head); sameRotation(h.arm.rotation, h.rest.arm); h.restFeet();
  const published = h.messages.length;
  const disposedPose = h.guide.root.position.clone();
  h.advanceTimers(20000); h.guide.dispose(); h.guide.update(); h.guide.react('success'); h.guide.help(); h.guide.setRoom('piano');
  h.guide.setWalking(true); h.guide.walkTo(99, 99, 0, true);
  near(h.guide.root.position.distanceTo(disposedPose), 0, 'disposed guide remains inactive');
  assert.equal(h.messages.length, published);
});

check('idle guide faces the camera by the shortest arc and gently follows its height without changing placement', () => {
  const h = harness({ withCamera: true });
  const camera = h.application.camera.instance;
  const standing = h.guide.root.position.clone();
  const targetYaw = -Math.PI + .04;
  h.guide.root.rotation.y = Math.PI - .04;
  camera.position.copy(standing).add(new THREE.Vector3(Math.sin(targetYaw) * 10, 5, Math.cos(targetYaw) * 10));
  const originalYaw = h.guide.root.rotation.y;
  h.tick(50);
  assert(h.guide.root.rotation.y > originalYaw, 'boundary crossing should turn through the short positive arc');
  assert(h.guide.root.rotation.y - originalYaw < .1, 'body should not spin the long way around');
  for (let frame = 0; frame < 40; frame++) h.tick(50);
  near(Math.sin(h.guide.root.rotation.y - targetYaw), 0, 'body faces the camera', .001);
  near(h.guide.root.position.distanceTo(standing), 0, 'gaze does not move the guide');
  assert(h.head.rotation.x < h.rest.head.x && h.head.rotation.x > h.rest.head.x - .4, 'head looks upward within a restrained range');
  assert.equal(h.timelines.length, 0, 'initial camera placement is not a movement greeting');
  h.guide.dispose();
  const missing = harness(); for (let frame = 0; frame < 20; frame++) missing.tick(50);
  assert.equal(missing.timelines.length, 0, 'missing camera integration safely skips gaze'); missing.guide.dispose();
});

check('stationary cameras never repeat greetings, and moving cameras receive waves no faster than every six seconds', () => {
  const h = harness({ withCamera: true });
  const camera = h.application.camera.instance;
  for (let frame = 0; frame < 160; frame++) h.tick(50);
  assert.equal(h.timelines.length, 0);
  camera.position.x += .1; h.tick(50); assert.equal(h.timelines.length, 1);
  h.timelines.at(-1).finish();
  for (let frame = 0; frame < 300; frame++) h.tick(50);
  assert.equal(h.timelines.length, 1, 'one old movement must not cause recurring greetings');
  for (let frame = 0; frame < 280; frame++) {
    camera.position.x += .03;
    const count = h.timelines.length; h.tick(50);
    if (h.timelines.length > count) h.timelines.at(-1).finish();
  }
  assert(h.timelines.length >= 3, 'continued camera movement should eventually receive another greeting');
  for (let index = 1; index < h.timelines.length; index++) assert(h.timelines[index].createdAt - h.timelines[index - 1].createdAt >= 6000 - 1e-7);
  h.guide.dispose();
  const rotationOnly = harness({ withCamera: true }); rotationOnly.tick(50);
  rotationOnly.application.camera.instance.rotation.y += .1; rotationOnly.tick(50);
  assert.equal(rotationOnly.timelines.length, 1, 'looking around without translating is camera movement'); rotationOnly.guide.dispose();
});

check('camera greetings stay inactive while reading, walking, dancing, transitioning, focused on content, or using reduced motion', () => {
  const cases = [
    (h) => h.guide.setReading(true),
    (h) => h.guide.setWalking(true),
    (h) => h.guide.setDancing(new THREE.Object3D()),
    (h) => { h.application.camera.transitioning = true; },
    (h) => { h.reducedMotion.matches = true; },
    ...['monitor', 'resume', 'piano-seat', 'courtyard', 'exhibit', 'rhythm'].map((view) => (h) => { h.application.camera.view = view; }),
  ];
  for (const prepare of cases) {
    const h = harness({ withCamera: true }); h.tick(50); prepare(h);
    for (let frame = 0; frame < 160; frame++) { h.application.camera.instance.position.x += .03; h.tick(50); }
    assert.equal(h.timelines.length, 0, 'excluded view/mode should not start a greeting');
    h.guide.dispose();
  }
});

check('dance body and feet approach the actual stage pads, stay on the platform, and return on pause or exit', () => {
  const h = harness({ withCamera: true });
  const { default: RhythmStage, RHYTHM_PAD_POSITIONS } = rhythmStageModule;
  assert.equal(RHYTHM_PAD_POSITIONS.length, 4);
  assert.equal(rhythmConfig.RHYTHM_KEYS.map((key) => key.label).join(','), 'D,F,J,K');
  const stage = new RhythmStage(h.application.scene);
  stage.root.position.set(-10, .3, 8); stage.root.rotation.y = .6; stage.setVisible(true);
  const anchor = stage.dancerAnchor;
  const plinth = stage.root.getObjectByName('StagePlinth');
  plinth.geometry.computeBoundingBox(); plinth.updateMatrix();
  const platform = plinth.geometry.boundingBox.clone().applyMatrix4(plinth.matrix);
  const anchorLocal = (object) => anchor.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const assertOnPlatform = () => {
    for (const object of [h.guide.root, ...h.feet]) {
      const point = stage.root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
      assert(point.x >= platform.min.x && point.x <= platform.max.x, `${object.name} leaves the stage width`);
      assert(point.z >= platform.min.z && point.z <= platform.max.z, `${object.name} leaves the stage depth`);
    }
  };
  h.guide.setDancing(anchor);
  near(h.guide.root.position.distanceTo(anchor.getWorldPosition(new THREE.Vector3())), 0);
  near(h.guide.root.quaternion.angleTo(anchor.getWorldQuaternion(new THREE.Quaternion())), 0);
  assert.equal(h.guide.root.parent, h.application.scene, 'dancing must not reparent the traveling guide');
  for (let lane = 0; lane < RHYTHM_PAD_POSITIONS.length; lane++) {
    h.guide.setDanceBeat(0, false, 120); h.tick(0); h.restFeet();
    const pad = anchorLocal(stage.root.getObjectByName(`RhythmPad${lane}`));
    const side = Math.sign(pad.x), row = Math.sign(pad.z);
    const active = h.feet.findIndex((_, index) => Math.sign(h.rest.footPositions[index].x) === side);
    const foot = h.feet[active], rest = h.rest.footPositions[active];
    const initialFoot = anchorLocal(foot), initialBody = anchorLocal(h.guide.root);
    h.guide.setDanceBeat(.25, true, 120); h.guide.danceStep(lane);
    // The 220ms step reaches its maximum excursion at 110ms, within the frame clamp.
    for (let frame = 0; frame < 11; frame++) { h.tick(10); assertOnPlatform(); }
    const peakFoot = anchorLocal(foot), peakBody = anchorLocal(h.guide.root);
    assert((foot.position.x - rest.x) * side > .05, 'the pad bank selects its matching foot');
    assert((foot.position.z - rest.z) * row > .05, 'front/back movement follows RhythmStage pad coordinates');
    assert((peakBody.x - initialBody.x) * side > .25, 'the body must travel toward the selected pad bank');
    assert((peakBody.z - initialBody.z) * row > .1, 'the body must travel toward the selected pad row');
    assert(horizontalDistance(peakBody, pad) < horizontalDistance(initialBody, pad) * .7, 'body remains too far from its target');
    assert(horizontalDistance(peakFoot, pad) < .06, `foot misses lane ${lane} at the step peak`);
    assert(horizontalDistance(peakFoot, pad) < horizontalDistance(initialFoot, pad) * .2);
    assert(foot.position.y > rest.y && foot.position.y < rest.y + .1);
    const other = 1 - active; near(h.feet[other].position.distanceTo(h.rest.footPositions[other]), 0);
    for (let frame = 0; frame < 15; frame++) { h.tick(10); assertOnPlatform(); }
    h.restFeet();
    h.guide.setDanceBeat(.3, false, 120); h.tick(0);
    near(h.guide.root.position.distanceTo(anchor.getWorldPosition(new THREE.Vector3())), 0, 'pause restores the stage anchor');
  }
  const chartMoments = new Map();
  for (const note of rhythmConfig.createOriginalChart()) {
    const moment = chartMoments.get(note.time) || []; moment.push(note.lane); chartMoments.set(note.time, moment);
  }
  const chartChords = [...chartMoments.values()].filter((moment) => moment.length === 2);
  assert(chartChords.length > 0);
  assert(chartChords.every((pair) => pair.some((lane) => lane < 2) && pair.some((lane) => lane >= 2)), 'each authored chord gives one pad to each foot');
  // Cover every left/right pair, including equal-row chords and both input orders.
  // The latter preserves both targets when simultaneous key events arrive reversed.
  for (const pair of [[0, 2], [0, 3], [1, 2], [1, 3]]) for (const input of [pair, [...pair].reverse()]) {
    h.guide.setDanceBeat(0, false, 120); h.tick(0); h.restFeet();
    h.guide.setDanceBeat(.25, true, 120); input.forEach((lane) => h.guide.danceStep(lane));
    for (let frame = 0; frame < 11; frame++) { h.tick(10); assertOnPlatform(); }
    const chordBody = anchorLocal(h.guide.root);
    assert(chordBody.y > .08 && chordBody.y < .2, 'a two-bank chord should add a small jump');
    for (let index = 0; index < h.feet.length; index++) {
      const side = Math.sign(h.rest.footPositions[index].x);
      const lane = pair.find((candidate) => Math.sign(RHYTHM_PAD_POSITIONS[candidate][0]) === side);
      const pad = anchorLocal(stage.root.getObjectByName(`RhythmPad${lane}`));
      assert((h.feet[index].position.x - h.rest.footPositions[index].x) * side > .4, 'a chord should spread both feet');
      assert(horizontalDistance(anchorLocal(h.feet[index]), pad) < .06, `chord ${input} misses lane ${lane} at the step peak`);
    }
    for (let frame = 0; frame < 15; frame++) { h.tick(10); assertOnPlatform(); }
    h.restFeet();
  }
  h.guide.setDanceBeat(.3, false, 120); h.tick(16);
  h.restFeet(); sameRotation(h.arm.rotation, h.rest.arm);
  near(h.guide.root.position.distanceTo(anchor.getWorldPosition(new THREE.Vector3())), 0, 'paused dancer stays planted');
  assert.equal(h.timelines.length, 0, 'dance motion should not trigger idle greeting timelines');
  h.guide.setDancing(null); h.restFeet();
  const reference = harness(); near(h.guide.root.position.distanceTo(reference.guide.root.position), 0, 'leaving the stage returns to room placement');
  h.guide.dispose(); reference.guide.dispose(); stage.dispose();
});

check('dance obeys reading/reduced-motion states and callbacks cannot revive a disposed guide', () => {
  const h = harness({ withCamera: true }); const anchor = new THREE.Object3D(); anchor.position.set(-5, .4, -7);
  h.guide.setDancing(anchor); h.guide.setDanceBeat(.25, true, 120); h.guide.danceStep(2); h.tick(100);
  h.guide.setReading(true); h.restFeet(); const readingPosition = h.guide.root.position.clone();
  h.guide.setDanceBeat(.4, true, 120); h.guide.danceStep(0); h.tick(100);
  assert(!h.guide.root.visible); near(h.guide.root.position.distanceTo(readingPosition), 0); h.restFeet();
  h.guide.setReading(false); h.reducedMotion.matches = true; h.tick(100);
  near(h.guide.root.position.distanceTo(anchor.position), 0); h.restFeet(); sameRotation(h.arm.rotation, h.rest.arm);
  h.reducedMotion.matches = false; h.guide.setDanceBeat(.5, true, 120); h.guide.danceStep(3); h.tick(100);
  h.guide.dispose(); h.restFeet(); const pose = h.guide.root.position.clone(), messages = h.messages.length;
  h.guide.setDanceBeat(10, true, 180); h.guide.danceStep(2); h.guide.setDancing(anchor); h.tick(100);
  assert.equal(h.guide.root.parent, null); near(h.guide.root.position.distanceTo(pose), 0); h.restFeet();
  assert.equal(h.messages.length, messages); assert.equal(h.timers.size, 0);
});

check('the companion can walk and dance without owning guide interactions, preferences, messages or subscriptions', () => {
  const h = harness({ role: 'companion', withCamera: true });
  assert.equal(h.guide.root.name, 'MeadowHamster');
  const assertIndependent = () => {
    assert.equal(h.messages.length, 0, 'companion must never publish guide-message');
    assert.equal(h.subscriptionCalls.length, 0, 'companion must never subscribe to guide requests');
    assert.equal(h.subscriptions.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.listenerCalls.filter(({ name }) => name === 'storage').length, 0);
    assert.equal(h.storageAccess.length, 0, 'companion must not read or change guide preferences');
    h.guide.root.traverse((node) => {
      assert.equal(node.userData.interactiveId, undefined, `${node.name} must not capture guide picking`);
      assert.equal(node.userData.room, undefined, `${node.name} must not acquire a guide room`);
    });
  };
  assertIndependent();
  const idlePosition = h.guide.root.position.clone(), idleRotation = h.guide.root.quaternion.clone();
  for (let frame = 0; frame < 160; frame++) { h.application.camera.instance.position.x += .03; h.tick(50); }
  assert.equal(h.timelines.length, 0, 'companion does not greet moving cameras');
  near(h.guide.root.position.distanceTo(idlePosition), 0); near(h.guide.root.quaternion.angleTo(idleRotation), 0);
  for (const action of [() => h.guide.help(), () => h.guide.dismiss(), () => h.guide.hide(), () => h.guide.setRoom('ai', true),
    () => h.guide.react('success'), () => h.guide.react('failure'), () => h.guide.setReading(true), () => h.guide.setReading(false)]) {
    action(); assertIndependent();
  }
  h.guide.setWalking(true); h.guide.walkTo(15, 18, .7, true);
  near(h.guide.root.position.x, 15); near(h.guide.root.position.z, 18); near(h.guide.root.rotation.y, .7);
  assert(h.feet.some((foot, index) => Math.abs(foot.rotation.x - h.rest.feet[index].x) > .01), 'companion still animates its walking feet');
  h.guide.walkTo(15, 18, .7, false); h.restFeet(); assertIndependent();
  const anchor = new THREE.Object3D(); anchor.position.set(-8, .2, -6);
  h.guide.setDancing(anchor); h.guide.setDanceBeat(.25, true, 120); h.guide.danceStep(0); h.tick(100);
  assert(h.feet.some((foot, index) => foot.position.distanceTo(h.rest.footPositions[index]) > .05), 'companion still takes dance steps');
  assert(h.guide.root.position.x < anchor.position.x, 'companion body moves toward its dance pad'); assertIndependent();
  h.guide.setDanceBeat(.3, false, 120); h.tick(16); h.restFeet();
  near(h.guide.root.position.distanceTo(anchor.position), 0); h.guide.setDancing(null); assertIndependent();
  h.guide.dispose(); h.restFeet(); assertIndependent();
  const disposedPosition = h.guide.root.position.clone();
  h.guide.setWalking(true); h.guide.walkTo(99, 99, 0, true); h.guide.setDancing(anchor);
  h.guide.setDanceBeat(10, true, 180); h.guide.danceStep(3); h.tick(100); h.guide.dispose();
  assert.equal(h.guide.root.parent, null); near(h.guide.root.position.distanceTo(disposedPosition), 0); assertIndependent();
});

check('the original robot retains camera greetings and sole guide-message ownership', () => {
  const h = harness({ variant: 'robot', withCamera: true }); h.tick(50);
  assert.equal(h.guide.root.name, 'VisitorGuide'); assert.equal(h.guide.root.userData.interactiveId, 'guide');
  assert.equal(h.subscriptions.size, 1); assert.equal(h.listeners.size, 1);
  h.application.camera.instance.position.x += 2; h.tick(50);
  assert.equal(h.timelines.length, 1, 'robot continues to greet camera movement');
  h.timelines.at(-1).finish(); h.guide.help();
  assert.equal(h.lastMessage().visible, true); assert.equal(h.timers.size, 1);
  const companionModel = modelFixture();
  const companion = new h.guide.constructor(h.application, companionModel.model, { role: 'companion' });
  const published = h.messages.length;
  companion.help(); companion.setWalking(true); companion.walkTo(16, 19, .4, true); companion.dispose();
  assert.equal(h.messages.length, published, 'coexisting companion never overwrites the robot bubble');
  assert.equal(h.subscriptions.size, 1); assert.equal(h.listeners.size, 1); assert.equal(h.timers.size, 1);
  h.subscriptions.get('world-request-state')(); assert.equal(h.messages.length, published + 1);
  assert.equal(h.lastMessage().visible, true, 'disposing the companion leaves the robot state subscription active');
  assert.equal(h.guide.root.parent, h.application.scene);
  h.guide.dismiss(); assert(h.storageAccess.some(({ action }) => action === 'set'));
  h.guide.dispose(); assert.equal(h.subscriptions.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

check('world sources always include the smooth companion independently of legacy guide query values', () => {
  function sources(search) {
    return load('src/Application/sources.ts', (name) => {
      assert.equal(name, '../types'); return { SourceType: { GLTF_MODEL: 'gltfModel' } };
    }, { window: { location: { search } }, URLSearchParams }).default;
  }
  for (const query of ['', '?guide=character', '?guide=smooth', '?guide=faceted', '?guide=balanced', '?guide=robot',
    '?other=robot', '?guide=', '?guide=unknown', '?guide=../smooth', '?guide=%2FRoom%2Fother.glb', '?guide=https%3A%2F%2Fexample.com%2Fguide.glb']) {
    const list = sources(query); const companion = list.filter((source) => source.name === 'guideCharacterModel');
    assert.equal(companion.length, 1); assert.equal(companion[0].path, '/Room/character-guide-smooth.glb');
    assert.equal(companion[0].type, 'gltfModel');
    assert.deepEqual(Array.from(list, (source) => source.name).sort(), ['courtyardModel', 'dioramaModel', 'guideCharacterModel']);
  }
});

function inspectAsset(filename, minimumTriangles, maximumTriangles, style) {
  const file = path.join(__dirname, '../public/Room', filename);
  assert(fs.existsSync(file), 'character asset must exist before final verification');
  const binary = fs.readFileSync(file);
  assert.equal(binary.readUInt32LE(0), 0x46546c67); assert.equal(binary.readUInt32LE(4), 2); assert.equal(binary.readUInt32LE(8), binary.length);
  assert.equal(binary.readUInt32LE(16), 0x4e4f534a);
  const data = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
  assert.equal(data.images?.length || 0, 0); assert.equal(data.textures?.length || 0, 0);
  assert(binary.length > 10000 && binary.length < 1000000, 'web guide should have substantive geometry within a 1MB budget');
  assert((data.buffers || []).every((buffer) => !buffer.uri), 'GLB must contain its geometry without external downloads');
  const nodes = data.nodes.map((node) => {
    const result = new THREE.Object3D(); result.name = node.name;
    if (node.matrix) { result.matrix.fromArray(node.matrix); result.matrix.decompose(result.position, result.quaternion, result.scale); }
    if (node.translation) result.position.fromArray(node.translation);
    if (node.rotation) result.quaternion.fromArray(node.rotation);
    if (node.scale) result.scale.fromArray(node.scale);
    return result;
  });
  data.nodes.forEach((node, index) => node.children?.forEach((child) => nodes[index].add(nodes[child])));
  const scene = new THREE.Group(); data.scenes[data.scene || 0].nodes.forEach((index) => scene.add(nodes[index])); scene.updateMatrixWorld(true);
  const character = scene.getObjectByName('GuideCharacter'), head = scene.getObjectByName('GuideHead');
  assert(character && head && ancestor(head, character));
  if (style) assert.equal(data.nodes.find((node) => node.name === 'GuideCharacter').extras?.style, style);
  const pivots = {};
  for (const name of ['GuideHead', 'GuideArm', 'GuideArmLeft', 'GuideFootLeft', 'GuideFootRight', 'GuideAnchor']) {
    const pivot = scene.getObjectByName(name);
    assert(pivot && ancestor(pivot, character), `missing or detached ${name}`);
    assert.equal(nodes.filter((node) => node.name === name).length, 1, `ambiguous ${name}`);
    pivots[name] = pivot.getWorldPosition(new THREE.Vector3());
  }
  const left = scene.getObjectByName('GuideFootLeft').getWorldPosition(new THREE.Vector3());
  const right = scene.getObjectByName('GuideFootRight').getWorldPosition(new THREE.Vector3());
  assert(left.x * right.x < 0 && left.y < .2 && right.y < .2, 'foot pivots must be separated near ground level');
  const bounds = new THREE.Box3(); let triangles = 0, headParts = 0;
  data.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return;
    for (const primitive of data.meshes[node.mesh].primitives) {
      const positions = data.accessors[primitive.attributes.POSITION];
      assert(positions.min && positions.max, 'geometry must declare position bounds');
      assert([...positions.min, ...positions.max].every(Number.isFinite), 'position bounds must be finite');
      const normals = data.accessors[primitive.attributes.NORMAL];
      assert(normals && normals.type === 'VEC3' && normals.count === positions.count, 'each vertex must have exported normals');
      const box = new THREE.Box3(new THREE.Vector3().fromArray(positions.min), new THREE.Vector3().fromArray(positions.max));
      bounds.union(box.applyMatrix4(nodes[index].matrixWorld));
      const count = primitive.indices === undefined ? positions.count : data.accessors[primitive.indices].count;
      triangles += count / 3;
      const materialName = data.materials[primitive.material]?.name || '';
      if (/eyes|nose|mouth|cheeks/i.test(materialName)) {
        assert(ancestor(nodes[index], head), `${materialName} detached from head pivot`); headParts++;
      }
    }
  });
  const size = bounds.getSize(new THREE.Vector3());
  assert(Math.abs(bounds.min.y) < .03, `feet should touch Y=0, got ${bounds.min.y}`);
  assert(size.y > 1.2 && size.y < 1.8 && size.x > .9 && size.x < 1.5);
  assert(size.z > .95 && size.z < 1.3, 'the plush guide should have the fuller front/back silhouette');
  assert(triangles > minimumTriangles && triangles < maximumTriangles, `${filename} has ${triangles} triangles, outside its style budget`);
  assert(headParts >= 4, 'articulated eyes, nose, mouth, and cheeks must remain geometry');
  assert(scene.getObjectByName('GuideAnchor').getWorldPosition(new THREE.Vector3()).y > bounds.max.y);
  console.log(`  ${filename}: ${triangles.toLocaleString()} triangles, ${binary.length.toLocaleString()} bytes, ${size.y.toFixed(3)}m tall, ${size.z.toFixed(3)}m deep`);
  return { triangles, size, pivots };
}

check('real base GLB has a grounded body, named articulated pivots, head-owned face geometry, and no embedded photos', () => {
  inspectAsset('character-guide.glb', 1000, 6500);
});

check('faceted and smooth GLBs retain comparable silhouettes and the same rig while using distinct geometry budgets', () => {
  const base = inspectAsset('character-guide.glb', 1000, 6500);
  const faceted = inspectAsset('character-guide-faceted.glb', 400, 3500, 'faceted');
  const smooth = inspectAsset('character-guide-smooth.glb', 3500, 100000, 'smooth');
  assert(smooth.triangles > faceted.triangles * 3, 'smooth should use denser geometry than the deliberate broad facets');
  for (const variant of [faceted, smooth]) {
    for (const axis of ['x', 'y', 'z']) assert(Math.abs(variant.size[axis] / base.size[axis] - 1) <= .05, `${axis} silhouette differs from base by more than 5%`);
    for (const [name, position] of Object.entries(base.pivots)) near(variant.pivots[name].distanceTo(position), 0, `${name} changed between variants`, .001);
  }
});

if (failures) process.exitCode = 1;
else console.log('All guide character checks passed');
