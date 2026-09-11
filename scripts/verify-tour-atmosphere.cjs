/* Real camera + meadow state: catch projection-induced fog before WebGL drawing. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
const layout = require('../src/design/courtyard-layout.json');

function load(relative, resolve, extras = {}) {
  const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = { exports: {}, require: resolve, ...extras };
  vm.runInNewContext(code, sandbox);
  return sandbox.exports;
}
const { ROOMS, ROOM_SIZE } = load('../src/design/rooms.ts', () => require('../src/design/jo-colors.json'));
const { default: Meadow } = load('../src/Application/World/Meadow.ts', (name) => {
  if (name === 'three') return THREE;
  if (name.endsWith('/history')) return { COURTYARD: layout };
  throw new Error(`Unexpected meadow dependency: ${name}`);
});

function harness() {
  const application = {
    sizes: { width: 1440, height: 900 }, scene: new THREE.Scene(),
    renderer: { instance: { shadowMap: {} } },
  };
  const reducedMotion = { matches: false }, timelines = [];
  class Timeline {
    constructor(options) { this.options = options; this.entries = []; }
    to(target, vars) { this.entries.push({ target, vars }); return this; }
    kill() { this.killed = true; }
    finish(inspect = () => {}) {
      for (const { target, vars } of this.entries) {
        if (this.killed) return;
        vars.onStart?.();
        for (const value of [0, .1, .25, .5, .75, .9, .99, 1]) {
          target.value = value; vars.onUpdate?.(); inspect();
        }
        vars.onComplete?.();
      }
      if (!this.killed) this.options?.onComplete?.();
    }
  }
  class Application { constructor() { return application; } }
  class EventEmitter { trigger() {} }
  const gsap = { timeline(options) { const timeline = new Timeline(options); timelines.push(timeline); return timeline; } };
  const { default: Camera } = load('../src/Application/Camera/Camera.ts', (name) => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return gsap;
    if (name === '../Application') return Application;
    if (name.endsWith('/Eventemitter')) return EventEmitter;
    if (name.endsWith('/rooms')) return { ROOMS, ROOM_SIZE };
    throw new Error(`Unexpected camera dependency: ${name}`);
  }, { window: { matchMedia: () => reducedMotion } });
  const camera = application.camera = new Camera();
  const model = new THREE.Group();
  for (const name of ['MeadowGrassClump', 'MeadowFlower', 'MeadowRock']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial());
    mesh.name = name; model.add(mesh);
  }
  const meadow = new Meadow(application, model);
  const update = () => meadow.update(7, 7);
  const finish = (inspect) => { timelines.at(-1).finish(() => { update(); inspect?.(); }); update(); };
  const enter = (instant = false) => {
    camera.followCourtyard(7, 7); meadow.setOutdoor(true); camera.navigate('courtyard', instant); update();
  };
  return { application, camera, meadow, update, finish, enter, reducedMotion };
}
function fogFactor(fog, depth) {
  const t = THREE.MathUtils.clamp((depth - fog.near) / (fog.far - fog.near), 0, 1);
  return t * t * (3 - 2 * t);
}
function neutralSky(scene) {
  assert(scene.background.b > scene.background.g && scene.background.g > scene.background.r, 'sky must be blue, not green');
  assert(scene.fog.color.equals(scene.background), 'far ground must fade into the same horizon');
}
let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

check('the artificial 500m bridge adds no fog to nearby scenery, at every transition sample', () => {
  const h = harness(); h.enter();
  const before = 1 - Math.exp(-Math.pow(.012 * 500, 2));
  assert(before > .99999, 'the original exponential fog reproduces full-scene wash');
  assert(h.camera.getAtmosphereDistanceOffset() > 400);
  h.finish(() => {
    const { scene } = h.application;
    assert(scene.fog instanceof THREE.Fog); neutralSky(scene);
    // Geometry within five metres of the interpolated focus must retain its own color.
    const depth = h.camera.pose.distance + 5;
    assert.equal(fogFactor(scene.fog, depth), 0);
  });
  assert.equal(h.camera.getAtmosphereDistanceOffset(), 0);
  assert.equal(h.application.scene.fog.near, 18);
  assert.equal(h.application.scene.fog.far, 48);
  assert.equal(fogFactor(h.application.scene.fog, 10), 0);
  assert.equal(fogFactor(h.application.scene.fog, 48), 1);
});

check('enter, reader, return and leave restore atmosphere without stale virtual depth', () => {
  const h = harness(); assert.equal(h.application.scene.background, null); h.enter(); h.finish();
  const anchor = new THREE.Object3D(); anchor.position.set(9, 1.8, 10);
  h.camera.setExhibit(anchor, 2.6, 1.7);
  h.meadow.setReading(true); h.camera.navigate('exhibit');
  assert.equal(h.application.scene.fog, null); h.finish();
  h.meadow.setReading(false); neutralSky(h.application.scene);
  assert.equal(h.camera.getAtmosphereDistanceOffset(), 0);
  h.meadow.setReading(true); h.camera.navigate('courtyard'); h.finish(); h.meadow.setReading(false);
  assert.equal(h.application.scene.fog.near, 18);
  h.meadow.setOutdoor(false); h.camera.navigate('developer'); h.finish();
  assert.equal(h.application.scene.fog, null); assert.equal(h.application.scene.background, null);
  assert(h.camera.instance instanceof THREE.OrthographicCamera);
});

check('resize, reduced motion and interrupted entry settle without atmosphere offsets', () => {
  for (const mode of ['resize', 'reduced', 'interrupted']) {
    const h = harness();
    if (mode === 'reduced') h.reducedMotion.matches = true;
    h.enter();
    if (mode === 'resize') { h.application.sizes.width = 390; h.camera.resize(); }
    if (mode === 'interrupted') { h.camera.navigate('exhibit'); h.finish(); }
    h.update();
    assert(!h.camera.transitioning); assert.equal(h.camera.getAtmosphereDistanceOffset(), 0);
    assert.equal(h.application.scene.fog.near, 18); neutralSky(h.application.scene);
  }
});

check('day/night changes retain blue sky, darken grass, and restore exact daytime materials', () => {
  const h = harness(); h.enter(true);
  const daySky = h.application.scene.background.clone();
  const dayGrass = h.meadow.floorMaterials.map(material => material.color.clone());
  h.meadow.setNight(true); neutralSky(h.application.scene);
  assert(h.application.scene.background.g < daySky.g * .05);
  h.meadow.floorMaterials.forEach((material, index) => {
    assert(Math.abs(material.color.g / dayGrass[index].g - .4) < 1e-8);
  });
  h.meadow.setNight(false);
  assert(h.application.scene.background.equals(daySky));
  h.meadow.floorMaterials.forEach((material, index) => assert(material.color.equals(dayGrass[index])));
  h.meadow.setOutdoor(false); h.meadow.setNight(true);
  assert.equal(h.application.scene.background, null); assert.equal(h.application.scene.fog, null);
});

if (failures) process.exitCode = 1;
else console.log('All tour atmosphere checks passed');
