/* Wall-reader lifecycle proof using the real World and game; no browser or API writes. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

function load(relative, resolve, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: filename,
  });
  const sandbox = { exports: {}, require: resolve, ...globals };
  vm.runInNewContext(result.outputText, sandbox, { filename });
  return sandbox.exports;
}

class Surface {
  constructor() { this.listeners = new Map(); this.style = {}; }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback)); }
  emit(name, event = {}) { for (const callback of [...(this.listeners.get(name) || [])]) callback({ type: name, ...event }); }
}
class ElementFixture extends Surface {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map();
    this.contentWindow = { postMessage() {} }; this.blurCount = 0;
  }
  appendChild(child) { this.children.push(child); child.parent = this; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  closest() { return null; }
  blur() { this.blurCount++; }
}

const rooms = load('src/design/rooms.ts', () => require('../src/design/jo-colors.json'));
const sharedTrack = require('../src/design/rhythm-track.mjs');
const rhythm = load('src/design/rhythm-game.ts', (name) => {
  if (name === './rhythm-track.mjs') return sharedTrack;
  throw new Error(`Unexpected rhythm dependency: ${name}`);
});

function harness() {
  const calls = { events: [], camera: [], guideReading: [], guideRoom: [], hamsterDance: [], roam: 0, roamUpdates: 0,
    audioStops: 0, screenMessages: [], storageWrites: [], requests: [], villageUpdates: [] };
  const subscriptions = new Map();
  const bus = {
    on(name, callback) {
      subscriptions.set(name, [...(subscriptions.get(name) || []), callback]);
      return () => subscriptions.set(name, (subscriptions.get(name) || []).filter((item) => item !== callback));
    },
    dispatch(name, data = {}) { calls.events.push({ name, data }); for (const callback of subscriptions.get(name) || []) callback(data); },
  };
  const window = new Surface(); window.location = { origin: 'https://portfolio.example' };
  window.matchMedia = () => ({ matches: false }); window.clearTimeout = () => {};
  const document = new Surface(); document.body = { dataset: {} }; document.hidden = false;
  document.querySelector = () => null; document.createElement = (tag) => new ElementFixture(tag);
  const canvas = new ElementFixture('canvas');
  canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => false; canvas.releasePointerCapture = () => {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1440, height: 900 });
  const camera = new Surface(); camera.instance = new THREE.PerspectiveCamera(35, 1.6, .02, 1000);
  camera.view = 'ai'; camera.transitioning = false; camera.on = camera.addEventListener.bind(camera);
  camera.navigate = (view, instant = false) => { calls.camera.push({ view, instant }); camera.view = view; camera.transitioning = !instant; };
  camera.setRhythmViewport = () => {};
  const resources = new Surface(); resources.on = resources.addEventListener.bind(resources);
  const application = {
    camera, resources, scene: new THREE.Scene(), cssScene: new THREE.Scene(),
    sizes: { width: 1440, height: 900 }, time: { delta: 16 },
    renderer: { instance: { domElement: canvas, shadowMap: { needsUpdate: false } } },
    audioPlayer: { stopInteractiveNotes() { calls.audioStops++; }, stopNotes() { calls.audioStops++; }, preload: async () => {} },
  };
  const storage = new Map([[`bbangjo.rhythm.best.${rhythm.TRACK.id}`, '345678']]);
  const storageApi = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { calls.storageWrites.push({ key, value }); storage.set(key, value); },
  };
  const gameModule = load('src/Application/World/RhythmGame.ts', () => rhythm, { localStorage: storageApi });
  const { default: World } = load('src/Application/World/World.ts', (name) => {
    if (name === 'three') return THREE;
    if (name === '../Application') return class Application { constructor() { return application; } };
    if (name.endsWith('/Camera')) return { isReadingView: (view) => ['monitor', 'resume', 'leaderboard'].includes(view) };
    if (name.endsWith('/EventBus')) return { EventBus: bus };
    if (name.endsWith('/rooms')) return rooms;
    if (name.endsWith('/rhythm-game')) return rhythm;
    if (name.endsWith('/RhythmGame')) return gameModule;
    if (name.endsWith('/piano-keys')) return { pianoMidiForKeyboard: () => undefined };
    return {};
  }, {
    window, document, Element: ElementFixture, innerWidth: 1440, innerHeight: 900,
    performance: { now: () => 1000 }, localStorage: storageApi,
    fetch: (...args) => { calls.requests.push(args); throw new Error('World must never submit leaderboard records'); },
  });
  const world = new World();
  function screen(id) {
    return {
      id, object: new THREE.Object3D(), mesh: new THREE.Object3D(), interactive: false, updates: 0, nightThemes: [],
      iframe: { contentWindow: { postMessage(data, origin) { calls.screenMessages.push({ id, data, origin }); } } },
      setInteractive(value) { this.interactive = value; },
      setVisible(value) { this.object.visible = this.mesh.visible = value; if (!value) this.setInteractive(false); },
      setDisplay(active, night) { this.display = { active, night }; },
      setNightTheme(night) { this.nightThemes.push(night); },
      update() { this.updates++; },
    };
  }
  world.monitorScreen = screen('monitor'); world.resumeScreen = screen('resume'); world.leaderboardScreen = screen('leaderboard');
  world.room = { root: new THREE.Group(), anchors: new Map(), show() {}, stopMotion() {} };
  world.guide = { root: new THREE.Group(), anchor: new THREE.Object3D(), update() {}, hide() {}, help() {},
    setReading(value) { calls.guideReading.push(value); }, setRoom(room) { calls.guideRoom.push(room); } };
  world.hamster = { root: new THREE.Group(), update() {}, react() {}, setDanceBeat() {}, danceStep() {},
    setDancing(anchor) { calls.hamsterDance.push(anchor); } };
  world.hamsterRoam = { resume() { calls.roam++; world.hamster.root.scale.setScalar(2.2); }, update() { calls.roamUpdates++; } };
  world.rhythmStage = { root: new THREE.Group(), dancerAnchor: new THREE.Object3D(), setVisible() {}, setPad() {} };
  world.performance = { update() {}, stop() {}, getSnapshot: () => ({ status: 'idle' }) };
  world.environment = { setRoom() {}, setNight() {}, setCourtyard() {} };
  world.village = { setNight() {}, update(delta, interiorFocus) { calls.villageUpdates.push({ delta, interiorFocus }); } };
  world.curtains = { isDragging: false, cancelDrag() {} };
  world.courtyard = { root: new THREE.Group(), meadow: { root: new THREE.Group(), setOutdoor() {} },
    walk: { x: 7, z: 7 }, leave() {}, update() {}, enter() {} };
  world.ready = true; world.view = 'ai'; world.activeRoom = 'ai';
  return { world, application, camera, calls, bus, window, document, storage, subscriptions,
    settle() { camera.transitioning = false; camera.emit('settled'); },
  };
}

let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

check('Play action and leaderboard event open the persistent reader and return to Play', () => {
  for (const open of [(h) => h.world.interact('leaderboard'), (h) => h.bus.dispatch('leaderboard-open')]) {
    const h = harness(); const screen = h.world.leaderboardScreen;
    open(h); assert.equal(h.world.view, 'leaderboard'); assert.equal(h.world.activeRoom, 'ai');
    assert.equal(h.world.readingOverlay, 'leaderboard'); assert.equal(h.calls.camera.at(-1).view, 'leaderboard');
    h.settle(); h.world.update();
    assert.equal(screen.interactive, true); assert.equal(screen.object.visible, true); assert.equal(screen.mesh.visible, true);
    assert.equal(h.world.resumeScreen.interactive, false); assert.equal(h.world.monitorScreen.interactive, false);
    h.bus.dispatch('close-reading'); assert.equal(h.world.view, 'ai'); assert.equal(h.calls.camera.at(-1).view, 'ai');
    h.settle(); h.world.update();
    assert.equal(h.world.leaderboardScreen, screen, 'return must retain the original iframe');
    assert.equal(screen.interactive, false); assert.equal(screen.object.visible, true); assert.equal(screen.mesh.visible, true);
    assert.equal(h.world.game.state.best, 345678); assert.equal(h.calls.storageWrites.length, 0); assert.equal(h.calls.requests.length, 0);
    h.world.disposeInput();
  }
});

check('night toggles reach both the local Summary page and persistent leaderboard display', () => {
  const h = harness(); h.world.update();
  assert.equal(h.world.resumeScreen.nightThemes.at(-1), false);
  assert.equal(h.world.leaderboardScreen.display.night, false);
  h.bus.dispatch('night-toggle'); h.world.update();
  assert.equal(h.world.resumeScreen.nightThemes.at(-1), true);
  assert.equal(h.world.leaderboardScreen.display.night, true);
  h.bus.dispatch('night-toggle'); h.world.update();
  assert.equal(h.world.resumeScreen.nightThemes.at(-1), false);
  assert.equal(h.world.leaderboardScreen.display.night, false);
  h.world.disposeInput();
});

check('all close interior views request village occlusion protection and ordinary views restore the scenery', () => {
  const h = harness();
  for (const [view, interiorFocus] of [['resume', true], ['monitor', true], ['leaderboard', true], ['piano-seat', true],
    ['developer', false], ['piano', false], ['blog', false], ['ai', false], ['courtyard', false], ['rhythm', false]]) {
    h.world.view = view; h.world.update();
    assert.equal(h.calls.villageUpdates.at(-1).interiorFocus, interiorFocus, view);
    assert.equal(h.calls.villageUpdates.at(-1).delta, h.application.time.delta);
  }
  h.world.disposeInput();
});

check('atlas room views hide outdoor exhibits while Explore restores the same content objects', () => {
  const h = harness(), exhibit = new THREE.Object3D(), content = new THREE.Object3D();
  h.world.courtyard.root.add(exhibit); h.world.room.root.add(content);
  const screens = [h.world.monitorScreen, h.world.resumeScreen, h.world.leaderboardScreen];
  for (const view of ['courtyard', 'exhibit', 'developer', 'resume', 'developer', 'piano', 'piano-seat', 'piano',
    'blog', 'monitor', 'blog', 'ai', 'leaderboard', 'ai', 'rhythm', 'ai', 'courtyard']) {
    h.world.navigate(view); h.settle(); h.world.update();
    assert.equal(h.world.courtyard.root.visible, view === 'courtyard' || view === 'exhibit', `${view}: outdoor exhibit visibility`);
    assert.equal(h.world.room.root.visible, view !== 'rhythm', `${view}: central content visibility`);
    assert.equal(h.world.courtyard.meadow.root.visible, view !== 'rhythm', `${view}: paper ground visibility`);
    assert.equal(exhibit.parent, h.world.courtyard.root); assert.equal(content.parent, h.world.room.root);
    assert.deepEqual([h.world.monitorScreen, h.world.resumeScreen, h.world.leaderboardScreen], screens, 'reader objects were replaced');
  }
  h.world.disposeInput();
});

check('wrong rooms, loading, transitions and errors cannot open the leaderboard', () => {
  for (const [label, gate] of [
    ['About', (h) => { h.world.view = h.world.activeRoom = 'developer'; }],
    ['Blog', (h) => { h.world.view = h.world.activeRoom = 'blog'; }],
    ['Piano', (h) => { h.world.view = h.world.activeRoom = 'piano'; }],
    ['loading', (h) => { h.world.ready = false; }],
    ['context error', (h) => { h.world.error = 'context lost'; }],
    ['camera transition', (h) => { h.camera.transitioning = true; }],
  ]) for (const [source, open] of [['wall', (h) => h.world.interact('leaderboard')], ['event', (h) => h.bus.dispatch('leaderboard-open')]]) {
    const h = harness(); gate(h); const before = h.world.view;
    open(h); assert.equal(h.world.view, before, `${source} must respect ${label}`); assert.equal(h.calls.camera.length, 0);
    assert.equal(h.calls.requests.length, 0); h.world.disposeInput();
  }
});

check('rhythm-to-leaderboard stops native music, restores the hamster, and preserves the personal best', () => {
  const h = harness();
  h.world.view = 'rhythm'; h.world.activeRoom = 'ai'; h.camera.view = 'rhythm';
  h.world.hamster.root.scale.setScalar(1);
  h.world.game.start(); h.world.game.update(rhythm.TRACK.firstNoteTime, true); h.world.game.press(0, 'held-key');
  const best = h.world.game.state.best;
  h.bus.dispatch('leaderboard-open');
  assert.equal(h.world.view, 'leaderboard'); assert.equal(h.world.game.state.phase, 'idle');
  assert.equal(h.world.game.state.heldLanes.length, 0); assert.equal(h.world.game.state.best, best);
  assert(h.calls.events.some((event) => event.name === 'rhythm-music-action' && event.data.action === 'stop'));
  assert.equal(h.calls.hamsterDance.at(-1), null); assert.equal(h.calls.roam, 1);
  assert.equal(h.world.hamster.root.scale.x, 2.2);
  assert.equal(h.calls.storageWrites.length, 0); assert.equal(h.calls.requests.length, 0);
  h.settle(); h.world.update();
  assert.equal(h.world.hamster.root.visible, false); assert.equal(h.calls.roamUpdates, 0, 'the companion stays still while reading');
  h.bus.dispatch('close-reading'); h.settle(); h.world.update();
  assert.equal(h.world.view, 'ai'); assert.equal(h.world.hamster.root.visible, true); assert(h.calls.roamUpdates > 0);
  h.world.disposeInput();
});

check('reader input cannot move rooms or score, and only its same-origin iframe can request Escape', () => {
  const h = harness(); h.bus.dispatch('leaderboard-open'); h.settle(); h.world.update();
  const before = h.calls.camera.length;
  for (const [key, code] of [['ArrowRight', 'ArrowRight'], ['d', 'KeyD'], [' ', 'Space']]) {
    h.document.emit('keydown', { key, code, target: null, preventDefault() {}, repeat: false });
  }
  assert.equal(h.calls.camera.length, before); assert.equal(h.world.game.state.score, 0);
  assert.equal(h.world.canLookAround(), false);
  const iframe = h.world.leaderboardScreen.iframe.contentWindow;
  for (const event of [
    { origin: 'https://elsewhere.example', source: iframe },
    { origin: h.window.location.origin, source: {} },
    { origin: 'https://blog.bbangjo.kr', source: h.world.monitorScreen.iframe.contentWindow },
  ]) h.window.emit('message', { ...event, data: { type: 'keydown', key: 'Escape' } });
  assert.equal(h.world.view, 'leaderboard');
  h.window.emit('message', { origin: h.window.location.origin, source: iframe, data: { type: 'keydown', key: 'Escape' } });
  assert.equal(h.world.view, 'ai'); assert.equal(h.calls.requests.length, 0);
  h.world.disposeInput();
});

check('Summary and blog readers retain their original return owners', () => {
  for (const [view, owner] of [['resume', 'developer'], ['monitor', 'blog']]) {
    const h = harness(); h.world.activeRoom = owner; h.world.view = view;
    h.world.closeReading(); assert.equal(h.world.view, owner);
    h.world.disposeInput();
  }
});

check('the real persistent screen pairs its iframe with the same transformed depth aperture', () => {
  const h = harness();
  class CSS3DObject extends THREE.Object3D { constructor(element) { super(); this.element = element; } }
  const { default: MonitorScreen } = load('src/Application/World/MonitorScreen.ts', (name) => {
    if (name === 'three') return THREE;
    if (name.endsWith('/CSS3DRenderer.js')) return { CSS3DObject };
    if (name === '../Application') return class Application { constructor() { return h.application; } };
    throw new Error(`Unexpected screen dependency: ${name}`);
  }, { document: h.document });
  const wall = new THREE.Object3D(); wall.position.set(-.22, 2, 3); wall.rotation.y = Math.PI * 1.5;
  const anchor = new THREE.Object3D(); wall.add(anchor);
  const screen = new MonitorScreen(anchor, { id: 'leaderboardScreen', src: '/leaderboard.html', width: 2.3, height: 2.78, pixels: 720, mobilePixels: 420 });
  screen.add();
  assert.equal(screen.mesh.parent, h.application.scene); assert.equal(screen.object.parent, h.application.cssScene);
  assert.equal(screen.iframe.src, '/leaderboard.html');
  assert(screen.mesh.position.distanceTo(screen.object.position) < 1e-8);
  assert(screen.mesh.quaternion.angleTo(screen.object.quaternion) < 1e-8);
  assert.equal(screen.mesh.material.depthTest, true); assert.equal(screen.mesh.material.depthWrite, true);
  assert.equal(screen.mesh.material.opacity, 0); assert.equal(screen.mesh.material.transparent, false);
  assert.equal(screen.iframe.tabIndex, -1); assert.equal(screen.iframe.style.pointerEvents, 'none');
  screen.setInteractive(true); assert.equal(screen.iframe.tabIndex, 0); assert.equal(screen.iframe.style.pointerEvents, 'auto');
  h.document.activeElement = screen.iframe; screen.setVisible(false);
  assert.equal(screen.iframe.tabIndex, -1); assert.equal(screen.iframe.blurCount, 1);
  assert.equal(screen.mesh.visible, false); assert.equal(screen.object.visible, false);
  screen.setVisible(true); assert.equal(screen.iframe.tabIndex, -1, 'visibility alone cannot steal keyboard focus');
  screen.dispose(); assert.equal(screen.mesh.parent, null); assert.equal(screen.object.parent, null);
  h.world.disposeInput();
});

check('wall iframe handshake, night state and refresh obey source ownership without repeated or hidden refreshes', () => {
  const h = harness(); const messages = [];
  class CSS3DObject extends THREE.Object3D { constructor(element) { super(); this.element = element; } }
  const monitor = load('src/Application/World/MonitorScreen.ts', (name) => {
    if (name === 'three') return THREE;
    if (name.endsWith('/CSS3DRenderer.js')) return { CSS3DObject };
    if (name === '../Application') return class Application { constructor() { return h.application; } };
    throw new Error(`Unexpected screen dependency: ${name}`);
  }, { document: h.document });
  const { default: LeaderboardScreen } = load('src/Application/World/LeaderboardScreen.ts', (name) => {
    if (name.endsWith('/MonitorScreen')) return monitor;
    if (name.endsWith('/EventBus')) return { EventBus: h.bus };
    if (name === 'three') return THREE;
    throw new Error(`Unexpected leaderboard screen dependency: ${name}`);
  }, { window: h.window });
  const originalListeners = h.window.listeners.get('message').length;
  const screen = new LeaderboardScreen(new THREE.Object3D()); screen.add();
  screen.iframe.contentWindow.postMessage = (data, origin) => messages.push({ data, origin });
  assert.equal(messages.length, 0, 'constructing the persistent wall cannot start a score refresh');
  assert.equal(screen.iframe.src, '/leaderboard.html');
  const ready = { data: { type: 'leaderboard-ready' }, origin: h.window.location.origin, source: screen.iframe.contentWindow };
  h.window.emit('message', { ...ready, origin: 'https://elsewhere.example' });
  h.window.emit('message', { ...ready, source: {} }); assert.equal(messages.length, 0);
  h.window.emit('message', ready);
  assert.equal(messages.at(-1).data.active, false); assert.equal(messages.at(-1).data.refresh, false);
  screen.setDisplay(true, false);
  assert.equal(messages.at(-1).data.type, 'leaderboard-display');
  assert.equal(messages.at(-1).data.refresh, true); assert.equal(messages.at(-1).data.active, true);
  assert.equal(messages.at(-1).origin, h.window.location.origin);
  const activeCount = messages.length;
  for (let frame = 0; frame < 120; frame++) screen.setDisplay(true, false);
  assert.equal(messages.length, activeCount, 'World updates do not refetch scores every frame');
  screen.setDisplay(true, true);
  assert.equal(messages.at(-1).data.night, true); assert.equal(messages.at(-1).data.refresh, false);
  h.bus.dispatch('leaderboard-updated'); assert.equal(messages.at(-1).data.refresh, true);
  screen.setDisplay(false, true); const hiddenCount = messages.length;
  assert.equal(messages.at(-1).data.active, false); assert.equal(messages.at(-1).data.refresh, false);
  h.bus.dispatch('leaderboard-updated'); assert.equal(messages.length, hiddenCount);
  screen.setDisplay(true, true); assert.equal(messages.at(-1).data.refresh, true, 'returning to Play refreshes a dirty wall');
  screen.dispose(); const disposedCount = messages.length;
  h.bus.dispatch('leaderboard-updated'); h.window.emit('message', ready); screen.iframe.emit('load');
  assert.equal(messages.length, disposedCount);
  assert.equal(h.window.listeners.get('message').length, originalListeners);
  assert.equal((h.subscriptions.get('leaderboard-updated') || []).length, 0);
  assert.equal(screen.mesh.parent, null); assert.equal(screen.object.parent, null);
  assert.equal(h.calls.requests.length, 0); h.world.disposeInput();
});

check('the real Renderer releases canvas hit testing for settled readers and restores it during transitions or room interaction', () => {
  const cameraModule = load('src/Application/Camera/Camera.ts', (name) => {
    if (name === 'three') return THREE;
    if (name === 'gsap') return {};
    if (name.endsWith('/Eventemitter')) return class EventEmitter {};
    if (name.endsWith('/Application')) return class Application {};
    if (name.endsWith('/rooms')) return rooms;
    throw new Error(`Unexpected camera dependency: ${name}`);
  });
  const { default: Renderer } = load('src/Application/Renderer.ts', (name) => {
    if (name === 'three') return THREE;
    if (name.endsWith('/Camera')) return cameraModule;
    if (name.endsWith('/CSS3DRenderer')) return {};
    if (name.endsWith('/Application')) return class Application {};
    throw new Error(`Unexpected renderer dependency: ${name}`);
  });
  const renderer = Object.create(Renderer.prototype);
  const scene = new THREE.Scene(), cssScene = new THREE.Scene();
  const camera = { view: 'ai', transitioning: false, instance: new THREE.PerspectiveCamera() };
  const cssCamera = new THREE.PerspectiveCamera();
  const canvas = { style: { pointerEvents: 'auto' } }; const draws = [];
  Object.assign(renderer, {
    application: { scene, cssScene }, camera,
    instance: { domElement: canvas, render: (drawScene, drawCamera) => draws.push({ layer: 'webgl', drawScene, drawCamera, pointer: canvas.style.pointerEvents }) },
    cssInstance: { render: (drawScene, drawCamera) => draws.push({ layer: 'css', drawScene, drawCamera }) },
    cssCamera: () => cssCamera,
  });
  for (const view of ['leaderboard', 'monitor', 'resume', 'exhibit']) {
    camera.view = view; camera.transitioning = false; renderer.update();
    assert.equal(canvas.style.pointerEvents, 'none', `${view}: clicks must reach the iframe instead of the covering WebGL canvas`);
    assert.equal(draws.at(-2).pointer, 'none', 'canvas hit testing must change before the frame renders');
    camera.transitioning = true; renderer.update();
    assert.equal(canvas.style.pointerEvents, 'auto', `${view}: a moving display must not acquire pointer input`);
  }
  for (const view of ['developer', 'piano', 'blog', 'ai', 'piano-seat', 'courtyard', 'rhythm']) {
    camera.view = view; camera.transitioning = false; renderer.update();
    assert.equal(canvas.style.pointerEvents, 'auto', `${view}: room/game controls must retain their canvas`);
  }
  camera.view = 'leaderboard'; renderer.update();
  assert.equal(canvas.style.pointerEvents, 'none', 're-entering the reader clears the prior room state');
  assert.equal(draws.length, 32, 'both render layers continue rendering while pointer ownership changes');
  for (let index = 0; index < draws.length; index += 2) {
    assert.equal(draws[index].drawScene, scene); assert.equal(draws[index].drawCamera, camera.instance);
    assert.equal(draws[index + 1].drawScene, cssScene); assert.equal(draws[index + 1].drawCamera, cssCamera);
  }
});

function hooksFixture() {
  const slots = []; let cursor = 0, effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() };
      });
    },
  };
  return {
    React,
    render(Component, props) { cursor = 0; effects = []; const tree = Component(props); const pending = effects; effects = []; pending.forEach((effect) => effect()); return tree; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

async function verifyPageContracts() {
  const h = harness(); const hooks = hooksFixture(); const messages = [];
  h.window.parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  h.document.getElementById = () => new ElementFixture('div');
  h.document.documentElement = { style: {} };
  let Page;
  load('src/leaderboard.tsx', (name) => {
    if (name === 'react') return hooks.React;
    if (name === 'react-dom/client') return { createRoot: () => ({ render: (element) => { Page = element.type; } }) };
    if (name.endsWith('/Leaderboard')) return () => null;
    throw new Error(`Unexpected iframe entry dependency: ${name}`);
  }, { window: h.window, document: h.document });
  let tree = hooks.render(Page);
  assert.equal(tree.props.active, false, 'embedded mount waits for parent visibility');
  assert.equal(messages[0].data.type, 'leaderboard-ready'); assert.equal(messages[0].origin, h.window.location.origin);
  const display = { type: 'leaderboard-display', active: true, night: true, refresh: true };
  h.window.emit('message', { origin: 'https://elsewhere.example', source: h.window.parent, data: display });
  h.window.emit('message', { origin: h.window.location.origin, source: {}, data: display });
  h.window.emit('message', { origin: h.window.location.origin, source: h.window.parent, data: { ...display, active: 'yes' } });
  tree = hooks.render(Page); assert.equal(tree.props.active, false); assert.equal(tree.props.refreshKey, 0);
  h.window.emit('message', { origin: h.window.location.origin, source: h.window.parent, data: display });
  tree = hooks.render(Page); assert.equal(tree.props.active, true); assert.equal(tree.props.refreshKey, 1);
  assert.equal(h.document.body.dataset.night, 'true'); assert.equal(h.document.documentElement.style.colorScheme, 'dark', 'the reading page follows the restored parent night state');
  const beforeEscape = messages.length;
  for (const repeat of [false, true]) h.document.emit('keydown', { key: 'Escape', repeat, preventDefault() {}, stopPropagation() {} });
  assert.equal(messages.length, beforeEscape + 1); assert.equal(messages.at(-1).data.key, 'Escape');
  assert.equal(messages.at(-1).origin, h.window.location.origin);
  hooks.unmount(); h.world.disposeInput();

  const componentHooks = hooksFixture(); const requests = [];
  const timers = new Set(); let nextTimer = 0;
  const componentWindow = {
    setTimeout: () => { const id = ++nextTimer; timers.add(id); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const { default: Leaderboard } = load('src/Application/UI/components/Leaderboard.tsx', (name) => {
    if (name === 'react') return componentHooks.React;
    if (name.endsWith('/rhythm-track.mjs')) return sharedTrack;
    if (name.endsWith('.css')) return {};
    throw new Error(`Unexpected leaderboard component dependency: ${name}`);
  }, {
    window: componentWindow, AbortController,
    fetch: (url, options) => new Promise((resolve) => { requests.push({ url, options, resolve }); }),
  });
  const finish = async (index) => {
    requests[index].resolve({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ entries: [] }) });
    await new Promise((resolve) => setImmediate(resolve));
  };
  componentHooks.render(Leaderboard, { active: false, refreshKey: 0 }); assert.equal(requests.length, 0);
  componentHooks.render(Leaderboard, { active: true, refreshKey: 0 }); assert.equal(requests.length, 1);
  await finish(0);
  for (let frame = 0; frame < 120; frame++) componentHooks.render(Leaderboard, { active: true, refreshKey: 0 });
  assert.equal(requests.length, 1, 'unchanged display props do not poll');
  componentHooks.render(Leaderboard, { active: true, refreshKey: 1 }); assert.equal(requests.length, 2);
  componentHooks.render(Leaderboard, { active: false, refreshKey: 1 });
  assert.equal(requests[1].options.signal.aborted, true, 'hiding the wall cancels the outstanding read');
  await finish(1);
  componentHooks.render(Leaderboard, { active: true, refreshKey: 2 }); assert.equal(requests.length, 3);
  await finish(2); componentHooks.unmount();
  assert(requests.every(({ url, options }) => url === '/api/leaderboard' && (options.method || 'GET') === 'GET'
    && options.body === undefined && options.cache === 'no-store'), 'the wall only reads; it never posts a score');
  assert.equal(timers.size, 0);
}

verifyPageContracts().then(() => {
  console.log('PASS actual iframe entry validates parent messages and the actual leaderboard component only issues bounded GET reads');
}).catch((error) => {
  failures++; console.error(`FAIL iframe/read-only page contract: ${error.stack}`);
}).finally(() => {
  if (failures) process.exitCode = 1;
  else console.log('Leaderboard wall verified: persistent physical screen, navigation and focus guards, rhythm exit, iframe message/refresh lifecycle, local-best preservation, and read-only score requests.');
});
