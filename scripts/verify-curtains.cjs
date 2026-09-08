/* Real Three.js ray/plane math with deterministic capture-phase pointer events. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const ROOMS = {
  developer: { group: 'RoomDeveloper', angle: 0 },
  piano: { group: 'RoomPiano', angle: Math.PI / 2 },
  blog: { group: 'RoomBlog', angle: Math.PI },
  ai: { group: 'RoomAI', angle: Math.PI * 1.5 },
};
const prefixes = { piano: 'Piano', blog: 'Blog', ai: 'AI' };
const near = (actual, expected, text = 'value') => assert(Math.abs(actual - expected) < 1e-7, `${text}: ${actual} != ${expected}`);

class Surface {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(type, [...(this.listeners.get(type) || []), { callback, capture }]);
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(type, (this.listeners.get(type) || []).filter((listener) => listener.callback !== callback || listener.capture !== capture));
  }
  fire(event, capture) {
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      if (event.stopped) break;
      if (listener.capture === capture) listener.callback(event);
    }
  }
  count() { return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0); }
}

function harness(options = {}) {
  const window = new Surface();
  const canvas = new Surface();
  canvas.style = { cursor: 'grab' };
  canvas.captured = new Set();
  const rect = { left: 23, top: 37, width: 1000, height: 800 };
  canvas.getBoundingClientRect = () => rect;
  canvas.setPointerCapture = (id) => canvas.captured.add(id);
  canvas.hasPointerCapture = (id) => canvas.captured.has(id);
  canvas.releasePointerCapture = (id) => {
    canvas.captured.delete(id);
    dispatch('lostpointercapture', { pointerId: id });
  };
  const world = { down: 0, move: 0, up: 0, escape: 0 };
  canvas.addEventListener('pointerdown', () => world.down++);
  canvas.addEventListener('pointermove', () => world.move++);
  canvas.addEventListener('pointerup', () => world.up++);
  window.addEventListener('keydown', () => world.escape++);
  function dispatch(type, values = {}, outside = false) {
    const event = {
      type, target: outside ? window : canvas, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 0, clientY: 0,
      cancelable: true, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...values,
    };
    window.fire(event, true);
    if (!outside) { canvas.fire(event, true); canvas.fire(event, false); }
    window.fire(event, false);
    return event;
  }
  const root = new THREE.Group();
  root.position.set(0.7, 0.15, -0.4);
  root.scale.setScalar(1.1);
  const groups = {};
  Object.keys(ROOMS).forEach((id) => {
    const group = new THREE.Group(); group.name = ROOMS[id].group; group.rotation.y = ROOMS[id].angle;
    root.add(group); groups[id] = group;
    if (!prefixes[id] || options.legacy) return;
    ['Left', 'Right'].forEach((side) => {
      if (options.missingRight && id === 'blog' && side === 'Right') return;
      const panel = new THREE.Group(); panel.name = `${prefixes[id]}Curtain${side}`;
      panel.position.set(0.29, 3.16, side === 'Left' ? 1.24 : 3.81);
      panel.userData = { curtainOpenWidth: options.invalidWidths ? 8 : 0.48, curtainClosedWidth: 1.283 };
      group.add(panel);
    });
  });
  root.updateWorldMatrix(true, true);
  let room = 'piano';
  let camera;
  let picked = 'curtainLeft';
  let interactable = true;
  let changes = 0;
  let starts = 0;
  function setRoom(id, perspective = false) {
    room = id;
    camera = perspective ? new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 100)
      : new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100);
    camera.position.copy(new THREE.Vector3(8, 4, 7).applyMatrix4(groups[id].matrixWorld));
    camera.lookAt(new THREE.Vector3(0.29, 1.6, 2.5).applyMatrix4(groups[id].matrixWorld));
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  setRoom(room);
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/Application/World/Curtains.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sandbox = { exports: {}, window, require: (name) => name === 'three' ? THREE : { ROOMS } };
  vm.runInNewContext(code, sandbox);
  const curtains = new sandbox.exports.default({
    canvas, root, camera: () => camera, getRoom: () => room, pick: () => picked,
    canInteract: () => interactable, onChange: () => changes++, onDragStart: () => starts++,
  });
  function at(z, y = 2) {
    const point = new THREE.Vector3(0.29, y, z).applyMatrix4(groups[room].matrixWorld).project(camera);
    return { clientX: rect.left + (point.x + 1) / 2 * rect.width, clientY: rect.top + (1 - point.y) / 2 * rect.height };
  }
  return {
    curtains, root, groups, canvas, window, world, rect, dispatch, setRoom, at,
    setPicked: (id) => { picked = id; }, setInteractable: (value) => { interactable = value; },
    get camera() { return camera; }, get room() { return room; }, get changes() { return changes; }, get starts() { return starts; },
  };
}

const checks = [];
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { checks.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}

check('legacy assets skip cleanly; incomplete pairs fail; width metadata is validated as a pair', () => {
  const h = harness({ legacy: true }); assert.equal(h.changes, 0); h.dispatch('pointerdown', h.at(1.5)); assert.equal(h.world.down, 1);
  assert.equal(h.curtains.isDragging, false); h.curtains.dispose(); assert.throws(() => harness({ missingRight: true }), /Incomplete curtain pair/);
  const fallback = harness({ invalidWidths: true }); fallback.curtains.setClosure('piano', 1);
  near(fallback.root.getObjectByName('PianoCurtainLeft').scale.z, 1.283 / 0.48); fallback.curtains.dispose();
});

check('all three rotated rooms, both panel directions, and orthographic/perspective ray-plane projection', () => {
  const h = harness();
  for (const perspective of [false, true]) for (const room of ['piano', 'blog', 'ai']) {
    h.setRoom(room, perspective); h.curtains.setClosure(room, 0); h.setPicked('curtainLeft');
    h.dispatch('pointerdown', h.at(1.5)); assert(h.curtains.isDragging); assert.equal(h.canvas.style.cursor, 'grabbing');
    h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.5)); near(h.curtains.getClosure(room), 0.5);
    const left = h.root.getObjectByName(`${prefixes[room]}CurtainLeft`), right = h.root.getObjectByName(`${prefixes[room]}CurtainRight`);
    near(left.scale.z, 1 + (1.283 / 0.48 - 1) * 0.5); near(right.scale.z, left.scale.z); near(left.scale.x, 0.86); near(left.scale.y, 1);
    h.dispatch('pointerup', h.at(1.5 + 0.803 * 0.5)); assert(!h.curtains.isDragging); assert.equal(h.canvas.style.cursor, 'grab');
    h.setPicked('curtainRight'); h.dispatch('pointerdown', h.at(3.3)); h.dispatch('pointermove', h.at(3.3 + 0.803 * 0.4));
    near(h.curtains.getClosure(room), 0.1, `${room} right outward opens`); h.dispatch('pointerup', h.at(3.3 + 0.803 * 0.4));
    h.dispatch('pointerdown', h.at(3.3)); h.dispatch('pointermove', h.at(3.3 - 0.803 * 0.6));
    near(h.curtains.getClosure(room), 0.7, `${room} right inward closes`); h.dispatch('pointerup', h.at(3.3 - 0.803 * 0.6));
  }
  assert.equal(h.world.down + h.world.move + h.world.up, 0); assert.equal(h.starts, 18); h.curtains.dispose();
});

check('four-pixel threshold, bounded partial closure, room memory, and geometry invalidation', () => {
  const h = harness(); const initial = h.changes; const start = h.at(1.5);
  h.dispatch('pointerdown', start); h.dispatch('pointermove', { ...start, clientX: start.clientX + 3 });
  near(h.curtains.getClosure('piano'), 0); assert.equal(h.changes, initial);
  h.dispatch('pointermove', h.at(10)); near(h.curtains.getClosure('piano'), 1);
  h.dispatch('pointermove', h.at(-10)); near(h.curtains.getClosure('piano'), 0);
  h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.4)); h.curtains.cancelDrag(); near(h.curtains.getClosure('piano'), 0.4);
  h.dispatch('pointerup', h.at(1.5), true); h.setRoom('blog'); near(h.curtains.getClosure('blog'), 0);
  h.curtains.setClosure('blog', 0.8); h.setRoom('piano'); near(h.curtains.getClosure('piano'), 0.4);
  h.curtains.setClosure('piano', NaN); h.curtains.setClosure('piano', Infinity); near(h.curtains.getClosure('piano'), 0.4);
  h.curtains.setClosure('developer', 1); near(h.curtains.getClosure('developer'), 0); assert(h.changes > initial); h.curtains.dispose();
});

check('cancel/navigation keeps its partial position and swallows the eventual outside release', () => {
  const h = harness(); h.dispatch('pointerdown', h.at(1.5)); h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.3));
  h.curtains.cancelDrag(); h.setRoom('blog'); const up = h.dispatch('pointerup', h.at(2), true);
  assert(up.stopped && up.defaultPrevented); assert.equal(h.world.up, 0); near(h.curtains.getClosure('piano'), 0.3);
  h.dispatch('pointerdown', h.at(1.5)); h.setInteractable(false); h.dispatch('pointermove', h.at(2)); assert(!h.curtains.isDragging);
  h.dispatch('pointerup', h.at(2)); assert.equal(h.world.up, 0); h.setInteractable(true);
  h.dispatch('pointerdown', h.at(1.5)); h.setRoom('ai'); h.dispatch('pointermove', h.at(2)); assert(!h.curtains.isDragging);
  h.dispatch('pointerup', h.at(2)); assert.equal(h.world.up, 0); h.curtains.dispose();
});

check('secondary pointers cannot move curtains, orbit the camera, or click after primary release', () => {
  const h = harness(); h.dispatch('pointerdown', { ...h.at(1.5), pointerType: 'touch' });
  const second = h.dispatch('pointerdown', { ...h.at(3.5), pointerId: 2, pointerType: 'touch', isPrimary: false });
  assert(second.stopped); h.dispatch('pointermove', { ...h.at(2.2), pointerId: 2, pointerType: 'touch' }); near(h.curtains.getClosure('piano'), 0);
  h.dispatch('pointerup', { ...h.at(1.5), pointerType: 'touch' }); assert(!h.curtains.isDragging);
  h.dispatch('pointermove', { ...h.at(2.2), pointerId: 2, pointerType: 'touch' }); h.dispatch('pointerup', { ...h.at(2.2), pointerId: 2, pointerType: 'touch' }, true);
  assert.equal(h.world.down + h.world.move + h.world.up, 0); h.dispatch('pointermove', h.at(2)); assert.equal(h.world.move, 1); h.curtains.dispose();
});

check('cancel, lost capture, blur, resize, and Escape release capture without changing the partial position', () => {
  for (const event of ['pointercancel', 'lostpointercapture', 'blur', 'resize', 'keydown']) {
    const h = harness(); h.dispatch('pointerdown', h.at(1.5)); h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.55));
    h.dispatch(event, { pointerId: 1, key: 'Escape' }, true); assert(!h.curtains.isDragging); assert.equal(h.canvas.captured.size, 0);
    near(h.curtains.getClosure('piano'), 0.55); assert.equal(h.canvas.style.cursor, 'grab');
    if (event === 'keydown') assert.equal(h.world.escape, 1, 'Escape continues to existing navigation');
    if (event !== 'pointercancel') { h.dispatch('pointerup', h.at(2)); assert.equal(h.world.up, 0); }
    h.curtains.dispose();
  }
});

check('non-curtain input and interaction gates preserve existing handlers; fresh down clears lost-release ownership', () => {
  const h = harness(); h.setPicked('pianoSeat'); h.dispatch('pointerdown', h.at(1.5)); assert.equal(h.world.down, 1);
  h.setPicked('curtainLeft'); h.setInteractable(false); h.dispatch('pointerdown', h.at(1.5)); assert.equal(h.world.down, 2);
  h.setInteractable(true); h.dispatch('pointerdown', { ...h.at(1.5), button: 2 }); assert.equal(h.world.down, 3);
  h.dispatch('pointerdown', h.at(1.5)); h.dispatch('blur', {}, true); h.setPicked('pianoSeat');
  h.dispatch('pointerdown', h.at(1.5)); assert.equal(h.world.down, 4); assert.equal(h.starts, 1); h.curtains.dispose();
});

check('no-buttons mouse movement restores hover immediately after a missed release or blur', () => {
  for (const interruption of ['cancel', 'blur', 'none']) {
    const h = harness(); h.dispatch('pointerdown', h.at(1.5)); h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.35));
    if (interruption === 'cancel') h.curtains.cancelDrag();
    if (interruption === 'blur') h.dispatch('blur', {}, true);
    const hover = h.dispatch('pointermove', { ...h.at(2), buttons: 0 });
    assert.equal(hover.stopped, false); assert.equal(hover.defaultPrevented, false);
    assert.equal(h.world.move, 1, `${interruption}: hover must resume without another click`);
    assert.equal(h.curtains.isDragging, false); assert.equal(h.canvas.captured.size, 0);
    near(h.curtains.getClosure('piano'), 0.35, 'implicit release keeps partial curtain position');
    h.dispatch('pointermove', { ...h.at(2.2), buttons: 0 }); assert.equal(h.world.move, 2);
    h.curtains.dispose();
  }
});

check('edge-on rays and empty canvas bounds cannot start unstable drags; disposal removes all owned listeners', () => {
  const h = harness(); h.rect.width = 0; h.dispatch('pointerdown', { clientX: 100, clientY: 100 }); assert(!h.curtains.isDragging); h.rect.width = 1000;
  h.camera.position.copy(new THREE.Vector3(4, 2, 10).applyMatrix4(h.groups.piano.matrixWorld));
  h.camera.lookAt(new THREE.Vector3(4, 2, 0).applyMatrix4(h.groups.piano.matrixWorld)); h.camera.updateMatrixWorld(true);
  h.dispatch('pointerdown', h.at(1.5)); assert(!h.curtains.isDragging);
  h.setRoom('piano'); h.dispatch('pointerdown', h.at(1.5)); h.dispatch('pointermove', h.at(1.5 + 0.803 * 0.2));
  h.curtains.dispose(); assert.equal(h.canvas.captured.size, 0); assert.equal(h.canvas.count(), 3); assert.equal(h.window.count(), 1);
  h.curtains.setClosure('piano', 1); near(h.curtains.getClosure('piano'), 0.2); assert(!h.curtains.isDragging);
});

if (checks.length) { console.error(`${checks.length} curtain checks failed`); process.exitCode = 1; }
else console.log('All curtain checks passed');
