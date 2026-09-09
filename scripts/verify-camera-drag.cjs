/* Exercise the real World pointer handlers without a renderer or browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

class Surface {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(type, [...(this.listeners.get(type) || []), { callback, capture }]);
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.callback !== callback || entry.capture !== capture));
  }
  fire(event, capture) {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      if (event.stopped) break;
      if (entry.capture === capture) entry.callback(event);
    }
  }
  count() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.length, 0); }
}

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/Application/World/World.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const window = new Surface();
  const canvas = new Surface();
  canvas.style = {};
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    dispatch('lostpointercapture', { pointerId: id });
  };
  const calls = { room: [], seat: [], clicks: [], events: [], picks: 0 };
  const camera = {
    transitioning: false,
    lookRoom: (dx, dy) => calls.room.push([dx, dy]),
    lookSeated: (dx, dy) => calls.seat.push([dx, dy]),
    navigate() {},
  };
  const sandbox = {
    exports: {}, window, performance: { now: () => 1000 },
    require(name) {
      if (name === 'three') return THREE;
      if (name.endsWith('/Camera')) return { isReadingView: (view) => view === 'resume' || view === 'monitor' };
      if (name.endsWith('/EventBus')) return { EventBus: { dispatch: (name) => calls.events.push(name) } };
      if (name.endsWith('/rooms')) return { isRoomId: (view) => ['developer', 'piano', 'blog', 'ai'].includes(view) };
      return {};
    },
  };
  vm.runInNewContext(code, sandbox);
  const world = Object.create(sandbox.exports.default.prototype);
  Object.assign(world, {
    application: { renderer: { instance: { domElement: canvas } }, camera },
    ready: true, view: 'developer', activeRoom: 'developer', error: undefined,
    dragPointer: null, dragging: false, lastDrag: new THREE.Vector2(), pointerDown: new THREE.Vector2(),
    canvasListeners: [], markers: new Map(), hover: null, lastPick: 0,
    pick: () => { calls.picks++; return 'resume'; },
    interact: (id) => calls.clicks.push(id),
    // Navigation collaborators are unrelated to input ownership.
    curtains: { isDragging: false, cancelDrag() {} },
    room: { show() {} }, guide: { setRoom() {}, setReading() {} },
    monitorScreen: { setInteractive() {} }, resumeScreen: { setInteractive() {} },
    environment: { setRoom() {} }, reducedMotion: { matches: false },
    syncScreens() {}, publish() {}, stopRoomActivity() {},
  });
  function dispatch(type, values = {}, outside = false) {
    const event = {
      type, target: outside ? window : canvas, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 100, clientY: 100,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...values,
    };
    window.fire(event, true);
    if (!outside) { canvas.fire(event, true); canvas.fire(event, false); }
    window.fire(event, false);
    return event;
  }
  world.bindCanvas();
  return { world, camera, canvas, window, captured, calls, dispatch };
}

let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const down = (h, values) => h.dispatch('pointerdown', values);
const move = (h, values, outside = false) => h.dispatch('pointermove', values, outside);
const up = (h, values, outside = false) => h.dispatch('pointerup', values, outside);

check('a short primary click activates once; a release without a matching down does nothing', () => {
  const h = harness(); up(h); assert.equal(h.calls.clicks.length, 0);
  down(h); move(h, { clientX: 102 }); up(h, { clientX: 102 }); up(h, { clientX: 102 });
  assert.deepEqual(h.calls.clicks, ['resume']); assert.equal(h.calls.room.length, 0);
  assert.equal(h.captured.size, 0); h.world.disposeInput();
});

check('room drag follows outside movement and remains a drag after returning to its starting point', () => {
  const h = harness(); down(h);
  move(h, { clientX: 145, clientY: 120 }, true);
  move(h, { clientX: 100, clientY: 100 }, true);
  up(h, {}, true);
  assert.deepEqual(h.calls.room, [[45, 20], [-45, -20]]);
  assert.equal(h.calls.seat.length, 0); assert.equal(h.calls.clicks.length, 0);
  assert.deepEqual(h.calls.events, ['camera-drag-start']);
  assert.equal(h.canvas.style.cursor, 'grab'); assert.equal(h.captured.size, 0);
  h.world.disposeInput();
});

check('seated drag retains its own look method and does not activate a piano key', () => {
  const h = harness(); h.world.view = 'piano-seat'; h.world.activeRoom = 'piano';
  down(h); move(h, { clientX: 60, clientY: 130 }); up(h, { clientX: 60, clientY: 130 });
  assert.deepEqual(h.calls.seat, [[-40, 30]]); assert.equal(h.calls.room.length, 0);
  assert.equal(h.calls.clicks.length, 0); h.world.disposeInput();
});

check('right-button and nonprimary presses do not create ownership; secondary pointers cannot steal it', () => {
  const h = harness();
  down(h, { button: 2, buttons: 2 }); move(h, { clientX: 180, buttons: 2 }); up(h, { button: 2 });
  down(h, { isPrimary: false, pointerId: 2, pointerType: 'touch' }); up(h, { pointerId: 2, pointerType: 'touch' });
  assert.equal(h.calls.clicks.length + h.calls.room.length, 0); assert.equal(h.captured.size, 0);
  down(h, { pointerType: 'touch' });
  down(h, { pointerId: 2, isPrimary: false, pointerType: 'touch' });
  move(h, { pointerId: 2, isPrimary: false, pointerType: 'touch', clientX: 240 });
  up(h, { pointerId: 2, isPrimary: false, pointerType: 'touch' });
  assert.equal(h.world.dragPointer, 1); assert.equal(h.calls.room.length, 0);
  move(h, { pointerType: 'touch', clientX: 150 }); up(h, { pointerType: 'touch', clientX: 150 });
  up(h, { pointerId: 2, pointerType: 'touch' });
  assert.deepEqual(h.calls.room, [[50, 0]]); assert.equal(h.calls.clicks.length, 0);
  h.world.disposeInput();
});

check('cancel, lost capture, blur, resize, and Escape cannot turn a canceled gesture into a click', () => {
  for (const reason of ['explicit', 'pointercancel', 'lostpointercapture', 'blur', 'resize', 'keydown']) {
    const h = harness(); down(h); move(h, { clientX: 150 });
    if (reason === 'explicit') h.world.cancelCameraDrag();
    else h.dispatch(reason, { key: 'Escape' }, reason !== 'lostpointercapture');
    assert.equal(h.captured.size, 0, reason);
    up(h); assert.equal(h.calls.clicks.length, 0, reason);
    down(h); up(h); assert.equal(h.calls.clicks.length, 1, `${reason}: a fresh click works`);
    h.world.disposeInput();
  }
});

check('navigation ends the old pointer gesture before a destination object can receive its release', () => {
  const h = harness(); down(h);
  h.world.navigate('blog'); assert.equal(h.world.view, 'blog'); assert.equal(h.captured.size, 0);
  up(h); assert.equal(h.calls.clicks.length, 0);
  down(h); up(h); assert.equal(h.calls.clicks.length, 1); h.world.disposeInput();
});

check('no-buttons mouse movement clears a missed release and restores ordinary input', () => {
  const h = harness(); down(h); move(h, { clientX: 160 });
  move(h, { clientX: 170, buttons: 0 });
  assert.equal(h.world.dragPointer, null); assert.equal(h.captured.size, 0);
  up(h); assert.equal(h.calls.clicks.length, 0); assert.equal(h.calls.room.length, 1);
  down(h); up(h); assert.equal(h.calls.clicks.length, 1); h.world.disposeInput();
});

check('loading, readers, camera transitions, and errors block both starting and continuing a gesture', () => {
  const gates = [
    (h) => { h.world.ready = false; },
    (h) => { h.world.view = 'resume'; },
    (h) => { h.world.view = 'monitor'; },
    (h) => { h.camera.transitioning = true; },
    (h) => { h.world.error = 'context lost'; },
  ];
  for (const gate of gates) {
    for (const started of [false, true]) {
      const h = harness(); if (started) down(h); gate(h);
      if (!started) down(h);
      move(h, { clientX: 160 }); up(h, { clientX: 160 });
      assert.equal(h.calls.room.length + h.calls.seat.length + h.calls.clicks.length, 0);
      assert.equal(h.captured.size, 0); h.world.disposeInput();
    }
  }
});

check('a curtain capture handler keeps exclusive ownership of its drag', () => {
  const h = harness();
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    h.window.addEventListener(type, (event) => event.stopImmediatePropagation(), true);
  }
  down(h); move(h, { clientX: 200 }); up(h, { clientX: 200 });
  assert.equal(h.calls.room.length + h.calls.seat.length + h.calls.clicks.length, 0);
  assert.equal(h.captured.size, 0); h.world.disposeInput();
});

check('disposing input releases capture and removes every owned listener while preserving unrelated ones', () => {
  const h = harness(); let unrelated = 0;
  h.canvas.addEventListener('pointerdown', () => unrelated++);
  h.window.addEventListener('pointerup', () => unrelated++);
  down(h); move(h, { clientX: 150 });
  h.world.disposeInput();
  assert.equal(h.captured.size, 0); assert.equal(h.canvas.count(), 1); assert.equal(h.window.count(), 1);
  const count = h.calls.room.length;
  down(h); move(h, { clientX: 220 }); up(h);
  assert.equal(h.calls.room.length, count); assert.equal(h.calls.clicks.length, 0); assert.equal(unrelated, 3);
  h.world.disposeInput(); assert.equal(h.canvas.count() + h.window.count(), 2);
});

if (failures) { console.error(`${failures} camera drag checks failed`); process.exitCode = 1; }
else console.log('All camera drag checks passed');
