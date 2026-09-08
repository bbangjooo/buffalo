/* Deterministic transport regression checks; no browser, network, or real audio. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fixture = {
  title: 'Transport fixture', duration: 2,
  notes: [
    { time: 0.35, duration: 0.5, midi: 67, velocity: 0.6 },
    { time: 0, duration: 1.1, midi: 60, velocity: 0.75 },
    { time: 0.08, duration: 0.12, midi: 48, velocity: 0.5 },
    { time: 0, duration: 0.2, midi: 64, velocity: 0.7 },
    { time: 0.2, duration: 0.25, midi: 84, velocity: 0.5 },
    { time: 0.35, duration: 0.2, midi: 60, velocity: 0.65 },
    { time: 1.8, duration: 0.2, midi: 72, velocity: 0.7 },
  ],
};
const near = (actual, expected, label = 'time') => assert(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

function evaluate(file, dependencies, globals) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sandbox = { exports: {}, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, AbortController, ...globals };
  vm.runInNewContext(output, sandbox, { filename: file });
  return sandbox.exports;
}

function createHarness(options = {}) {
  let now = 10;
  let nextTimer = 0;
  const intervals = new Map();
  const visibilityListeners = new Set();
  const document = {
    hidden: false,
    addEventListener: (name, callback) => { assert.equal(name, 'visibilitychange'); visibilityListeners.add(callback); },
    removeEventListener: (name, callback) => { assert.equal(name, 'visibilitychange'); visibilityListeners.delete(callback); },
  };
  const audio = options.makeAudio ? options.makeAudio({ get currentTime() { return now; } }) : {
    get currentTime() { return now; },
    scheduled: [], stopCount: 0, unlockCount: 0,
    unlock() { this.unlockCount++; return options.unlock ? options.unlock() : Promise.resolve(true); },
    scheduleNote(midi, velocity, time, duration) { this.scheduled.push({ midi, velocity, time, duration, cancelled: false }); },
    stopNotes() { this.stopCount++; this.scheduled.forEach((note) => { note.cancelled = true; }); },
  };
  const states = [];
  const keyChanges = [];
  const repeatedAttacks = [];
  let fetchCount = 0;
  let fetchSignal;
  const module = evaluate('src/Application/World/PianoPerformance.ts', {
    '../../design/piano-performance': { PIANO_PERFORMANCE: { title: fixture.title, scoreUrl: '/fixture.json' } },
  }, {
    document,
    fetch: (url, request) => {
      assert.equal(url, '/fixture.json'); fetchCount++; fetchSignal = request.signal;
      return options.fetch ? options.fetch(fetchCount) : Promise.resolve({ ok: true, json: async () => options.score || fixture });
    },
    setInterval: (callback, milliseconds) => {
      assert.equal(milliseconds, 25); intervals.set(++nextTimer, { callback, step: milliseconds / 1000, at: now + milliseconds / 1000 }); return nextTimer;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  const performance = new module.default(audio, {
    onState: (state) => states.push(state),
    onKeys: (keys) => keyChanges.push({ at: now, keys: Array.from(keys).sort((a, b) => a - b) }),
    onRepeatedAttack: (keys) => repeatedAttacks.push({ at: now, keys: Array.from(keys) }),
  });
  const advance = (seconds, frames = true) => {
    const target = now + seconds;
    let guard = 0;
    while (true) {
      const next = [...intervals].filter(([, timer]) => timer.at <= target + 1e-12).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++guard > 100000) throw new Error('Unbounded timer');
      now = next[1].at;
      next[1].at += next[1].step;
      next[1].callback();
      if (frames) performance.update();
    }
    now = target;
    if (frames) performance.update();
  };
  return {
    performance, audio, states, keyChanges, repeatedAttacks, intervals, visibilityListeners, readScore: module.readScore, advance,
    get keys() { return keyChanges.length ? keyChanges[keyChanges.length - 1].keys : []; },
    get fetchSignal() { return fetchSignal; },
    get fetchCount() { return fetchCount; },
    visibility(hidden) { document.hidden = hidden; visibilityListeners.forEach((callback) => callback()); },
  };
}

const failures = [];
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function main() {
  await check('score bounds, pitch validation, sorted copy, and invalid fetch retry', async () => {
    const h = createHarness(); await flush();
    const score = h.readScore(fixture);
    assert.equal(score.notes[0].midi, 60); assert.equal(score.notes[1].midi, 64); assert.equal(fixture.notes[0].midi, 67);
    for (const invalid of [null, {}, { ...fixture, title: ' ' }, { ...fixture, duration: NaN }, { ...fixture, duration: 7201 },
      { ...fixture, notes: [] }, { ...fixture, notes: Array(100001).fill(fixture.notes[0]) }]) assert.throws(() => h.readScore(invalid));
    for (const patch of [{ time: -1 }, { time: NaN }, { duration: 0 }, { duration: Infinity }, { duration: 3 },
      { midi: -1 }, { midi: 128 }, { midi: 60.5 }, { velocity: 0 }, { velocity: 1.01 }, { velocity: NaN },
      { soundDuration: NaN }, { soundDuration: Infinity }, { soundDuration: 0 }, { soundDuration: -1 }, { soundDuration: 3 }]) {
      assert.throws(() => h.readScore({ ...fixture, notes: [{ ...fixture.notes[1], ...patch }] }));
    }
    h.performance.dispose();
    const retry = createHarness({ fetch: async (count) => count === 1 ? { ok: false } : { ok: true, json: async () => fixture } });
    await flush(); assert.equal(retry.performance.getSnapshot().status, 'error'); await retry.performance.play();
    assert.equal(retry.fetchCount, 2); assert.equal(retry.performance.getSnapshot().status, 'playing'); retry.performance.dispose();
  });

  await check('absolute audio timing, simultaneous chords, original out-of-range pitches, and held keys', async () => {
    const h = createHarness(); await flush(); await h.performance.play();
    assert.equal(h.audio.unlockCount, 1); assert.equal(h.intervals.size, 1);
    assert.deepEqual(h.audio.scheduled.map((note) => note.midi), [60, 64, 48]);
    near(h.audio.scheduled[0].time, 10.06); near(h.audio.scheduled[1].time, 10.06); near(h.audio.scheduled[2].time, 10.14);
    h.advance(0.04); assert.deepEqual(h.keys, [], 'keys must wait for scheduled attack');
    h.advance(0.03); assert.deepEqual(h.keys, [60, 64]);
    h.advance(0.21); assert.deepEqual(h.keys, [60], 'out-of-range MIDI48/84 must not map to visible keys');
    assert(h.audio.scheduled.some((note) => note.midi === 84));
    h.advance(0.15); assert.deepEqual(h.keys, [60, 67]);
    h.advance(0.5); assert.deepEqual(h.keys, [60], 'long note stays down after repeated same-key note releases');
    h.advance(0.3); assert.deepEqual(h.keys, []); h.performance.dispose();
  });

  await check('pause freezes time, cancels audio, and resumes held notes for their remaining durations', async () => {
    const h = createHarness(); await flush(); await h.performance.play(); h.advance(0.46);
    near(h.performance.getSnapshot().elapsed, 0.4); h.performance.pause(); assert.equal(h.performance.getSnapshot().status, 'paused');
    assert.equal(h.intervals.size, 0); assert.deepEqual(h.keys, []); assert(h.audio.scheduled.every((note) => note.cancelled));
    h.advance(1); near(h.performance.getSnapshot().elapsed, 0.4);
    const before = h.audio.scheduled.length; await h.performance.play();
    const restarted = h.audio.scheduled.slice(before);
    assert.deepEqual(restarted.map((note) => note.midi), [60, 84, 60, 67]);
    near(restarted[0].time, 11.52); near(restarted[0].duration, 0.7); near(restarted[1].duration, 0.05);
    near(restarted[2].duration, 0.15); near(restarted[3].duration, 0.45);
    h.advance(0.04); assert.deepEqual(h.keys, []); h.advance(0.03); assert.deepEqual(h.keys, [60, 67]); h.performance.dispose();
  });

  await check('pedal soundDuration outlasts physical keys and resumes only the remaining audio tail', async () => {
    const score = { title: 'Pedal fixture', duration: 2, notes: [
      { time: 0, duration: 0.2, soundDuration: 1.2, midi: 60, velocity: 0.7 },
      { time: 1.6, duration: 0.2, midi: 64, velocity: 0.6 },
    ] };
    const h = createHarness({ score }); await flush();
    assert.equal(h.readScore(score).notes[0].soundDuration, 1.2);
    assert.equal(h.readScore(score).notes[1].soundDuration, undefined);
    await h.performance.play(); near(h.audio.scheduled[0].duration, 1.2, 'pedal schedules acoustic duration');
    h.advance(0.07); assert.deepEqual(h.keys, [60]);
    h.advance(0.2); assert.deepEqual(h.keys, [], 'physical key releases after written0.2, not acoustic1.2');
    assert.equal(h.audio.scheduled[0].cancelled, false, 'pedal tail remains sounding after key release');
    h.advance(0.39); near(h.performance.getSnapshot().elapsed, 0.6);
    h.performance.pause(); assert(h.audio.scheduled.every((note) => note.cancelled)); h.advance(0.5);
    const before = h.audio.scheduled.length; await h.performance.play();
    const tail = h.audio.scheduled.slice(before); assert.equal(tail.length, 1); assert.equal(tail[0].midi, 60);
    near(tail[0].duration, 0.6, 'resume retains only remaining pedal tail'); near(tail[0].time, 11.22);
    h.advance(0.07); assert.deepEqual(h.keys, [], 'audio-only resumed tail must never depress its expired physical key');
    h.advance(0.73); near(h.performance.getSnapshot().elapsed, 1.34); h.performance.pause();
    const afterTail = h.audio.scheduled.length; await h.performance.play();
    assert.equal(h.audio.scheduled.length, afterTail, 'expired pedal tail cannot restart on a later resume');
    h.performance.dispose();
  });

  await check('adjacent repeated pitch restrikes once at its onset and never on held-key updates or mid-note resume', async () => {
    const score = { title: 'Repeated key fixture', duration: 1.4, notes: [
      { time: 0, duration: 0.5, midi: 60, velocity: 0.7 },
      { time: 0.5, duration: 0.5, midi: 60, velocity: 0.65 },
    ] };
    const h = createHarness({ score }); await flush(); await h.performance.play();
    h.advance(0.06); assert.deepEqual(h.keys, [60]); assert.equal(h.repeatedAttacks.length, 0);
    h.advance(0.49); assert.equal(h.repeatedAttacks.length, 0, 'held key cannot restrike at every25ms update');
    h.advance(0.01); assert.equal(h.repeatedAttacks.length, 1); assert.deepEqual(h.repeatedAttacks[0].keys, [60]);
    near(h.repeatedAttacks[0].at, 10.56, 'same-key second attack occurs at score0.5');
    assert.deepEqual(h.keys, [60], 'adjacent notes keep identical active-key membership');
    h.advance(0.15); assert.equal(h.repeatedAttacks.length, 1);
    h.performance.pause(); near(h.performance.getSnapshot().elapsed, 0.65); h.advance(1);
    await h.performance.play(); h.advance(0.07); assert.deepEqual(h.keys, [60]);
    assert.equal(h.repeatedAttacks.length, 1, 'resume of partially held note does not replay its original attack callback');
    h.advance(0.4); assert.deepEqual(h.keys, []); assert.equal(h.repeatedAttacks.length, 1);
    h.performance.dispose();
  });

  await check('explicit stop cancels pending unlock, active timers, and scheduled notes', async () => {
    const pending = deferred(); const h = createHarness({ unlock: () => pending.promise }); await flush();
    const request = h.performance.play(); h.performance.stop(); pending.resolve(true); await request;
    assert.equal(h.performance.getSnapshot().status, 'ready'); assert.equal(h.audio.scheduled.length, 0); assert.equal(h.intervals.size, 0);
    await h.performance.play(); h.advance(0.1); h.performance.stop(); const count = h.audio.scheduled.length;
    h.advance(10); assert.equal(h.audio.scheduled.length, count); assert(h.audio.scheduled.every((note) => note.cancelled));
    assert.deepEqual(h.keys, []); near(h.performance.getSnapshot().elapsed, 0); h.performance.dispose();
  });

  await check('latest play wins when two unlock requests resolve out of order', async () => {
    const first = deferred(); const second = deferred(); let unlocks = 0;
    const h = createHarness({ unlock: () => ++unlocks === 1 ? first.promise : second.promise }); await flush();
    const p1 = h.performance.play(); const p2 = h.performance.play(); second.resolve(true); await p2;
    const scheduled = h.audio.scheduled.length; first.resolve(true); await p1;
    assert.equal(h.audio.scheduled.length, scheduled); assert.equal(h.intervals.size, 1); h.performance.dispose();
  });

  await check('hidden tab pauses active playback without automatic restart', async () => {
    const h = createHarness(); await flush(); await h.performance.play(); h.advance(0.3); h.visibility(true);
    assert.equal(h.performance.getSnapshot().status, 'paused'); assert.equal(h.intervals.size, 0); assert.deepEqual(h.keys, []);
    assert(h.audio.scheduled.every((note) => note.cancelled)); h.advance(3); h.visibility(false);
    assert.equal(h.performance.getSnapshot().status, 'paused'); h.performance.dispose();
  });

  await check('dispose aborts fetch and pending unlock, unsubscribes, and cannot publish late state', async () => {
    const response = deferred(); const sound = deferred();
    const h = createHarness({ fetch: () => response.promise, unlock: () => sound.promise });
    const playing = h.performance.play(); h.performance.dispose(); const stateCount = h.states.length;
    assert.equal(h.fetchSignal.aborted, true); assert.equal(h.visibilityListeners.size, 0); assert.equal(h.intervals.size, 0);
    response.resolve({ ok: true, json: async () => fixture }); sound.resolve(true); await playing; await flush();
    assert.equal(h.states.length, stateCount); assert.equal(h.audio.scheduled.length, 0); await h.performance.play(); assert.equal(h.states.length, stateCount);
  });

  await check('finished state releases keys and timers while allowing the final audio release', async () => {
    const h = createHarness(); await flush(); await h.performance.play(); h.advance(2.061);
    assert.equal(h.performance.getSnapshot().status, 'finished'); near(h.performance.getSnapshot().elapsed, 2);
    assert.deepEqual(h.keys, []); assert.equal(h.intervals.size, 0);
    const last = h.audio.scheduled.at(-1); assert.equal(last.midi, 72); near(last.time, 11.86); near(last.duration, 0.2);
    assert.equal(last.cancelled, false, 'natural release must not be cut at score end');
    const count = h.audio.scheduled.length; h.advance(3); assert.equal(h.audio.scheduled.length, count); h.performance.dispose();
  });

  await check('real AudioPlayer API integration schedules partials on the shared clock and cancels them', async () => {
    let context;
    class Param {
      constructor() { this.events = []; this.value = 0; }
      add(kind, value, time) {
        assert(Number.isFinite(value) && Number.isFinite(time));
        if (kind === 'exp') assert(value > 0);
        if (this.events.length) assert(time >= this.events.at(-1).time, 'unordered WebAudio envelope');
        this.events.push({ value, time });
      }
      setValueAtTime(value, time) { this.add('set', value, time); }
      linearRampToValueAtTime(value, time) { this.add('linear', value, time); }
      exponentialRampToValueAtTime(value, time) { this.add('exp', value, time); }
    }
    class Node {
      constructor() { this.disconnected = false; }
      connect() { return this; }
      disconnect() { this.disconnected = true; }
    }
    const h = createHarness({ makeAudio: (clock) => {
      class Context {
        constructor() { this.state = 'suspended'; this.destination = new Node(); this.oscillators = []; context = this; }
        get currentTime() { return clock.currentTime; }
        createGain() { return Object.assign(new Node(), { gain: new Param() }); }
        createBiquadFilter() { return Object.assign(new Node(), { frequency: new Param(), Q: { value: 0 } }); }
        createDynamicsCompressor() { return Object.assign(new Node(), { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }); }
        createOscillator() {
          const node = Object.assign(new Node(), {
            frequency: new Param(), stopTimes: [], onended: null,
            start(time) { this.startTime = time; }, stop(time) { this.stopTimes.push(time); },
          });
          this.oscillators.push(node); return node;
        }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
      }
      const { AudioPlayer } = evaluate('src/Application/AudioPlayer.ts', {
        './UI/EventBus': { EventBus: { on: () => () => {}, dispatch() {} } },
      }, { window: { AudioContext: Context } });
      return new AudioPlayer();
    } });
    await flush(); await h.performance.play();
    assert.equal(context.oscillators.length, 12, 'initial three notes each retain four piano partials');
    near(context.oscillators[0].startTime, 10.06); near(context.oscillators[4].startTime, 10.06);
    near(context.oscillators[0].frequency.events[0].value, 440 * Math.pow(2, (60 - 69) / 12));
    near(context.oscillators[8].frequency.events[0].value, 440 * Math.pow(2, (48 - 69) / 12));
    near(context.oscillators[0].stopTimes[0], 10.06 + 1.1 + 0.2 + 0.025);
    h.advance(0.4); h.performance.pause(); assert(context.oscillators.every((node) => node.disconnected));
    await h.performance.play(); assert(context.oscillators.some((node) => !node.disconnected));
    h.performance.stop(); assert(context.oscillators.every((node) => node.disconnected));
    h.performance.dispose(); h.audio.dispose(); assert.equal(context.state, 'closed');
  });

  await check('explicit stop also cancels the final release after finished state', async () => {
    const h = createHarness(); await flush(); await h.performance.play(); h.advance(2.061); h.performance.stop();
    assert(h.audio.scheduled.every((note) => note.cancelled), 'stop leaves finished performance audio release playing'); h.performance.dispose();
  });

  await check('hide and return while unlock is pending must not start playback afterward', async () => {
    const sound = deferred(); const h = createHarness({ unlock: () => sound.promise }); await flush();
    const playing = h.performance.play(); h.visibility(true); h.visibility(false); sound.resolve(true); await playing;
    assert.notEqual(h.performance.getSnapshot().status, 'playing', 'hidden-tab cancellation did not invalidate pending play');
    assert.equal(h.audio.scheduled.length, 0); h.performance.dispose();
  });

  await check('pause cancels a play request waiting for audio unlock', async () => {
    const sound = deferred(); const h = createHarness({ unlock: () => sound.promise }); await flush();
    const playing = h.performance.play(); h.performance.pause(); sound.resolve(true); await playing;
    assert.notEqual(h.performance.getSnapshot().status, 'playing', 'pause did not invalidate pending play'); h.performance.dispose();
  });

  console.log(`\n${failures.length ? `${failures.length} failing checks` : 'All transport checks passed'}`);
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
