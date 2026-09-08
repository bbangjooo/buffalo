const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/Application/AudioPlayer.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function param() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }; }
function node() { return { disconnected: false, connect() {}, disconnect() { this.disconnected = true; } }; }
let pendingResume = false;
class MockContext {
  constructor() { this.currentTime = 10; this.state = pendingResume ? 'suspended' : 'running'; this.destination = node(); this.resumes = []; }
  createGain() { return { ...node(), gain: param() }; }
  createBiquadFilter() { return { ...node(), frequency: param(), Q: param() }; }
  createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
  createOscillator() { return { ...node(), frequency: param(), onended: null, stopped: 0, start() {}, stop() { this.stopped++; } }; }
  resume() { return new Promise(resolve => this.resumes.push(resolve)); }
  finishResume() { this.state = 'running'; this.resumes.splice(0).forEach(resolve => resolve()); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
const exportsObject = {};
vm.runInNewContext(js, { exports: exportsObject, require: () => ({ EventBus: { on: () => () => {}, dispatch() {} } }), window: { AudioContext: MockContext } });
const { AudioPlayer } = exportsObject;
async function seeded() {
  pendingResume = false;
  const player = new AudioPlayer();
  await player.playNote(60);
  const interaction = [...player.voices][0];
  player.scheduleNote(64, .75, 11, 2);
  const score = [...player.voices][1];
  return { player, interaction, score };
}
(async () => {
  assert.equal(typeof AudioPlayer.prototype.stopInteractiveNotes, 'function', 'navigation needs independent interactive cancellation');
  const { player, interaction, score } = await seeded();
  player.stopInteractiveNotes();
  assert.equal(player.voices.size, 1);
  assert(player.voices.has(score), 'scheduled score voice must survive');
  assert(!player.voices.has(interaction));
  assert(interaction.oscillators.every(o => o.disconnected));
  assert(score.oscillators.every(o => !o.disconnected));
  await player.playNote(62);
  assert.equal(player.voices.size, 2, 'subsequent interactions must work');
  player.stopInteractiveNotes();
  player.stopInteractiveNotes();
  assert.equal(player.voices.size, 1, 'repeat cancellation is idempotent');
  player.dispose();

  pendingResume = true;
  const suspended = new AudioPlayer();
  const pendingNote = suspended.playNote(60);
  const pendingUnlock = suspended.unlock();
  suspended.stopInteractiveNotes();
  suspended.context.finishResume();
  await pendingNote;
  assert.equal(await pendingUnlock, true, 'pending score unlock must survive');
  assert.equal(suspended.voices.size, 0, 'pending interaction must be canceled');
  suspended.scheduleNote(64, .7, suspended.currentTime, 1);
  assert.equal(suspended.voices.size, 1, 'score scheduling must still work after unlock');
  suspended.dispose();

  for (const action of ['stopNotes', 'toggle', 'dispose']) {
    const { player, interaction, score } = await seeded();
    await player[action]();
    assert.equal(player.voices.size, 0, action + ' clears both channels');
    assert([...interaction.oscillators, ...score.oscillators].every(o => o.disconnected));
    player.dispose();
    pendingResume = true;
    const pending = new AudioPlayer();
    const note = pending.playNote(60);
    const unlock = pending.unlock();
    const context = pending.context;
    await pending[action]();
    context.finishResume();
    await note;
    assert.equal(await unlock, false, action + ' cancels pending score unlock');
    assert.equal(pending.voices.size, 0, action + ' cancels pending interaction');
    pending.dispose();
  }
  const capped = await seeded();
  for (let i = 0; i < 70; i++) await capped.player.playNote(60 + i % 12);
  assert.equal(capped.player.voices.size, 64, 'shared voice cap preserved');
  assert(capped.interaction.oscillators.every(o => o.disconnected), 'oldest voice evicted');
  capped.player.dispose();
  process.stdout.write('PASS: channel cancellation, pending unlock isolation, global cancellation, and 64-voice cap\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
