/* Real controller with a pure actor fixture: no THREE scene, timers, or assets. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

function harness(reduced = false) {
  const calls = [];
  const motion = { matches: reduced };
  const actor = {
    root: {
      position: { x: 99, y: 42, z: 99 }, rotation: { y: 1 },
      scale: { x: 1, y: 1, z: 1, setScalar(value) { this.x = value; this.y = value; this.z = value; } },
    },
    walking: false,
    setWalking(value) { this.walking = value; },
    walkTo(x, z, heading, moving) {
      assert(this.walking);
      this.root.position.x = x; this.root.position.z = z; this.root.rotation.y = heading;
      calls.push({ x, z, heading, moving });
    },
  };
  const filename = path.join(__dirname, '../src/Application/World/HamsterRoam.ts');
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS }, fileName: filename,
  });
  const sandbox = {
    exports: {},
    require: (name) => { throw new Error(`Unexpected runtime dependency: ${name}`); },
    window: { matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return motion; } },
  };
  vm.runInNewContext(result.outputText, sandbox, { filename });
  const roam = new sandbox.exports.default(actor);
  return { roam, actor, calls, motion, last: () => calls.at(-1) };
}

function pointToSegment(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
}
const samePosition = (a, b) => { assert(Math.abs(a.x - b.x) < 1e-9); assert(Math.abs(a.z - b.z) < 1e-9); assert(Math.abs(a.heading - b.heading) < 1e-9); };
let passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; }
}

check('resume owns walking and restores a safe Summary location without touching ground height', () => {
  const { roam, actor, calls, last } = harness();
  roam.update(100); assert.equal(calls.length, 0);
  roam.resume(); assert.equal(actor.walking, true);
  samePosition(last(), { x: 7.15, z: 11.3, heading: 0 });
  assert.deepEqual([actor.root.scale.x, actor.root.scale.y, actor.root.scale.z], [2.2, 2.2, 2.2]);
  assert.equal(actor.root.position.y, 42, 'ground positioning belongs to GuideRobot.walkTo');
});

check('complete route segments avoid the house, coffee, and diagonal entrance with bounded speed and turns', () => {
  const { roam, calls } = harness(); roam.resume();
  for (let frame = 0; frame < 6000; frame++) roam.update(100);
  let moved = 0, paused = 0;
  for (let index = 1; index < calls.length; index++) {
    const current = calls[index], previous = calls[index - 1];
    assert(current.x >= 6.6 - 1e-9 && current.x <= 7.15 + 1e-9);
    assert(current.z >= 11.2 - 1e-9 && current.z <= 15.3 + 1e-9);
    assert(current.x > 5.6 && current.z > 5.6);
    assert(current.z - 1.3 > 5.6, 'the giant body stays outside the house');
    assert(pointToSegment({ x: 11, z: 11 }, previous, current) >= 3.7);
    assert((current.z - current.x) / Math.SQRT2 > 1.3, 'the giant body stays west of the diagonal entry-to-coffee path');
    assert(Math.hypot(current.x - previous.x, current.z - previous.z) <= 0.045 + 1e-8);
    assert(Math.abs(Math.atan2(Math.sin(current.heading - previous.heading), Math.cos(current.heading - previous.heading))) <= 0.18 + 1e-8);
    if (current.moving) moved++; else paused++;
  }
  assert(moved > 3000 && paused > 300, 'route includes both gentle strides and sniffing rests');
  assert(Math.max(...calls.map((call) => call.z)) - Math.min(...calls.map((call) => call.z)) > 3.8);
});

check('visitor proximity pauses before a stride enters 2.8 metres and uses hysteresis', () => {
  const { roam, last } = harness(); roam.resume();
  for (let frame = 0; frame < 20; frame++) roam.update(100);
  const before = { ...last() };
  const visitor = { x: before.x, z: before.z + 2.805 };
  roam.update(100, visitor); samePosition(last(), before); assert.equal(last().moving, false);
  for (let frame = 0; frame < 50; frame++) roam.update(100, { x: before.x, z: before.z + 3 });
  samePosition(last(), before);
  roam.update(100, { x: before.x, z: before.z + 3.5 });
  assert(last().z > before.z);
  const near = { x: last().x, z: last().z };
  const stopped = { ...last() };
  roam.update(100, near); samePosition(last(), stopped);
  roam.update(100); assert.notEqual(last().z, stopped.z, 'leaving the courtyard clears stale visitor proximity');
});

check('reduced motion stays stationary and a live preference change stops existing strides', () => {
  const { roam, last, motion } = harness(true); roam.resume();
  const initial = { ...last() };
  for (let frame = 0; frame < 1000; frame++) roam.update(100);
  samePosition(last(), initial); assert.equal(last().moving, false);
  motion.matches = false;
  for (let frame = 0; frame < 30; frame++) roam.update(100);
  assert.notEqual(last().z, initial.z);
  const moving = { ...last() }; motion.matches = true;
  for (let frame = 0; frame < 100; frame++) roam.update(100);
  samePosition(last(), moving); assert.equal(last().moving, false);
});

check('dance cannot overwrite the saved route, heading, or scheduled rest state', () => {
  const a = harness(), b = harness(); a.roam.resume(); b.roam.resume();
  for (let frame = 0; frame < 97; frame++) { a.roam.update(100); b.roam.update(100); }
  const saved = { ...a.last() };
  a.actor.root.position.x = -4; a.actor.root.position.z = -3; a.actor.root.rotation.y = 2;
  a.actor.root.scale.setScalar(1);
  a.actor.walking = false; a.roam.resume();
  samePosition(a.last(), saved); assert.equal(a.last().moving, false);
  assert.deepEqual([a.actor.root.scale.x, a.actor.root.scale.y, a.actor.root.scale.z], [2.2, 2.2, 2.2], 'returning from the rhythm stage restores giant meadow scale');
  for (let frame = 0; frame < 200; frame++) {
    a.roam.update(100); b.roam.update(100); samePosition(a.last(), b.last());
  }
});

check('large frame deltas clamp to 100ms; invalid or negative deltas do not advance route', () => {
  const a = harness(), b = harness(); a.roam.resume(); b.roam.resume();
  for (let frame = 0; frame < 30; frame++) { a.roam.update(100); b.roam.update(100); }
  a.roam.update(10_000); b.roam.update(100); samePosition(a.last(), b.last());
  const before = { ...a.last() };
  for (const delta of [NaN, Infinity, -100, 0]) { a.roam.update(delta); samePosition(a.last(), before); }
  a.roam.update(100, { x: NaN, z: 0 }); b.roam.update(100); samePosition(a.last(), b.last());
});

if (!process.exitCode) console.log(`Hamster roam: ${passed} pure checks passed, including ten minutes of complete route clearance.`);
