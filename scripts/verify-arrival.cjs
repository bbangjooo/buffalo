/* Exercise World ownership of arrival; the camera geometry has its own checks. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/Application/World/World.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { exports: {}, require(name) {
  if (name === 'three') return THREE;
  if (name.endsWith('/Camera')) return { isReadingView: value => ['resume', 'monitor', 'leaderboard'].includes(value) };
  return {};
} };
vm.runInNewContext(code, scope);
const World = scope.exports.default;
function harness(phase = 'writing') {
  const calls = [];
  const callbacks = [];
  const world = Object.create(World.prototype);
  Object.assign(world, {
    ready: true, onboarding: phase, view: 'developer', activeRoom: 'developer', error: undefined,
    application: { camera: { transitioning: true, finishOnboarding(done, instant) {
      calls.push(['camera', instant]); callbacks.push(done);
      if (instant) { this.transitioning = false; done(); }
    } } },
    guide: { setReading: value => calls.push(['reading', value]), setRoom: value => calls.push(['guide', value]) },
    room: { show: () => calls.push(['show']) },
    syncScreens: () => calls.push(['screens']),
    publish: () => calls.push(['publish', world.onboarding]),
  });
  return { world, calls, callbacks };
}

for (const phase of ['loading', 'writing', 'tour']) {
  const { world, calls } = harness(phase);
  world.navigate('piano');
  world.interact('resume');
  world.keydown({ key: 'ArrowRight' });
  assert.equal(world.view, 'developer', `${phase}: navigation cannot escape arrival`);
  assert.deepEqual(calls, []);
}
console.log('PASS arrival blocks room navigation, object activation and keyboard shortcuts');

{
  const { world, calls } = harness('loading');
  world.finishOnboarding();
  world.finishOnboarding(true);
  assert.deepEqual(calls, []);
}
console.log('PASS arrival cannot finish before the scene is ready');

{
  const { world, calls, callbacks } = harness();
  world.finishOnboarding();
  assert.equal(world.onboarding, 'tour');
  assert(!calls.some(item => item[0] === 'guide'));
  world.finishOnboarding();
  assert.equal(callbacks.length, 1, 'duplicate completion cannot restart the tour');
  world.application.camera.transitioning = false;
  callbacks[0]();
  assert.equal(world.onboarding, 'done');
  assert.equal(world.view, 'developer');
  assert.equal(world.activeRoom, 'developer');
  assert(calls.some(item => item[0] === 'guide' && item[1] === 'developer'));
  assert(calls.some(item => item[0] === 'screens'));
}
console.log('PASS automatic tour publishes its phase and restores the Summary-facing room only at completion');

for (const phase of ['writing', 'tour']) {
  const { world, calls } = harness(phase);
  world.finishOnboarding(true);
  assert.equal(world.onboarding, 'done');
  assert(calls.some(item => item[0] === 'camera' && item[1] === true));
  const count = calls.length;
  world.finishOnboarding(true);
  assert.equal(calls.length, count, 'completed arrival remains complete');
}
console.log('PASS Skip works while writing or orbiting and is idempotent');
