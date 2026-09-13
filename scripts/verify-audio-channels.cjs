/* Real sampled AudioPlayer with deterministic Web Audio and local-asset checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function evaluate(file, requireModule, globals = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {}, require: requireModule, ...globals };
  vm.runInNewContext(js, sandbox, { filename: file });
  return sandbox.exports;
}
const samples = evaluate('src/design/piano-samples.ts', () => { throw new Error('Unexpected sample dependency'); });
const activeCount = samples.PIANO_INTERACTIVE_SAMPLES.length;
const near = (a, b, label = '') => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

function createAudioHarness(options = {}) {
  const contexts = [], requests = [], messages = [], timers = new Map(), subscriptions = new Set();
  let timerId = 0;
  class Param {
    constructor(value = 0) { this.value = value; this.events = []; }
    record(type, value, time) { assert(Number.isFinite(value) && Number.isFinite(time)); this.value = value; this.events.push({ type, value, time }); }
    setValueAtTime(value, time) { this.record('set', value, time); }
    linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
    exponentialRampToValueAtTime(value, time) { assert(value > 0); this.record('exponential', value, time); }
  }
  class Node {
    constructor() { this.disconnected = false; this.connections = new Set(); }
    connect(target) { assert(target, 'cannot connect to a missing graph node'); this.disconnected = false; this.connections.add(target); return target; }
    disconnect() { this.disconnected = true; this.connections.clear(); }
  }
  class Context {
    constructor() {
      this.state = options.suspended ? 'suspended' : 'running'; this.destination = new Node();
      this.sources = []; this.gains = []; this.convolvers = []; this.resumes = []; this.resumeCount = 0;
      this.sampleRate = 44100; contexts.push(this);
    }
    get currentTime() { return options.clock?.currentTime ?? 10; }
    createGain() { const result = Object.assign(new Node(), { gain: new Param(1) }); this.gains.push(result); return result; }
    createDynamicsCompressor() { return Object.assign(new Node(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((key) => [key, new Param()]))); }
    createConvolver() { const result = new Node(); this.convolvers.push(result); return result; }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (channel) => data[channel] };
    }
    createBufferSource() {
      const result = Object.assign(new Node(), { playbackRate: new Param(1), onended: null, stopTimes: [], buffer: null,
        start(when, offset = 0) { this.startTime = when; this.offset = offset; assert(this.buffer); },
        stop(when) { this.stopTimes.push(when); },
      });
      this.sources.push(result); return result;
    }
    createOscillator() { throw new Error('A piano note must play recorded samples, not an oscillator fallback'); }
    decodeAudioData(bytes) {
      if (options.decode) return options.decode(bytes, this);
      return Promise.resolve({ duration: 8, length: 352800, numberOfChannels: 2, sampleRate: 44100, sampleUrl: bytes.url });
    }
    resume() {
      this.resumeCount++;
      if (!options.pendingResume) { this.state = 'running'; return Promise.resolve(); }
      return new Promise((resolve) => this.resumes.push(resolve));
    }
    finishResume() { this.state = 'running'; this.resumes.splice(0).forEach((resolve) => resolve()); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const eventBus = { EventBus: {
    on: (event, callback) => { const entry = { event, callback }; subscriptions.add(entry); return () => subscriptions.delete(entry); },
    dispatch: (event, state) => messages.push({ event, state }),
  } };
  const globals = {
    window: { AudioContext: Context }, AbortController,
    fetch: async (url, request) => {
      requests.push({ url, request });
      const response = await (options.fetch ? options.fetch(url, request, requests.length) : { ok: true, arrayBuffer: async () => ({ url }) });
      if (response.body) return response;
      return { ...response, arrayBuffer: async () => {
        const data = await response.arrayBuffer();
        if (data.byteLength !== undefined) return data;
        return { ...data, byteLength: samples.PIANO_SAMPLES.find(s => s.url === url).bytes, slice() { return this; } };
      } };
    },
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  const downloads = evaluate('src/Application/PianoDownloads.ts', (name) => {
    if (name === '../design/piano-samples') return samples;
    if (name === './UI/EventBus') return eventBus;
    throw new Error(`Unexpected download dependency: ${name}`);
  }, globals);
  const { AudioPlayer } = evaluate('src/Application/AudioPlayer.ts', (name) => {
    if (name === '../design/piano-samples') return samples;
    if (name === './UI/EventBus') return eventBus;
    if (name === './PianoDownloads') return downloads;
    throw new Error(`Unexpected audio dependency: ${name}`);
  }, globals);
  return { player: new AudioPlayer(), contexts, requests, messages, timers, subscriptions, samples,
    get context() { return contexts[0]; },
  };
}

function blockedFetch() {
  const waiting = [];
  let blocked = true;
  return {
    fetch(url, { signal }) {
      if (!blocked) return Promise.resolve({ ok: true, arrayBuffer: async () => ({ url }) });
      return new Promise((resolve, reject) => {
        waiting.push(() => resolve({ ok: true, arrayBuffer: async () => ({ url }) }));
        if (signal.aborted) reject(new Error('Aborted'));
        else signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
    },
    release() { blocked = false; waiting.splice(0).forEach((resolve) => resolve()); },
  };
}

async function seeded() {
  const h = createAudioHarness(); await h.player.playNote(60);
  const interaction = [...h.player.voices][0];
  h.player.scheduleNote(64, .75, 11, 2);
  return { ...h, interaction, score: [...h.player.voices][1] };
}

async function main() {
  const failures = [];
  async function check(name, run) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
  }
  await check('interactive downloads are silent and shared with decoding without duplicate requests', async () => {
    const blocked = blockedFetch(), h = createAudioHarness({ suspended: true, fetch: blocked.fetch });
    const background = h.player.download(); await flush();
    assert.equal(h.contexts.length, 0, 'background download must not allocate decoded audio');
    assert.equal(h.requests.length, 4);
    const preload = h.player.preload(); blocked.release();
    assert(await background); assert(await preload);
    assert.equal(h.requests.length, activeCount); assert.equal(h.context.resumeCount, 0); assert.equal(h.context.sources.length, 0);
    assert(h.messages.some(m => m.event === 'piano-assets' && m.state.phase === 'downloaded'));
    assert(h.messages.some(m => m.event === 'piano-assets' && m.state.phase === 'ready'));
    assert.equal(h.player.downloads.snapshot().received, h.player.downloads.snapshot().total);
    assert.equal(h.player.downloads.bytes.size, 0, 'encoded buffers are released after decoding');
    h.player.dispose();
  });
  await check('streamed byte progress advances before files finish and never reports premature completion', async () => {
    const gate = deferred();
    const h = createAudioHarness({ fetch: async (url) => {
      const size = samples.PIANO_SAMPLES.find(s => s.url === url).bytes;
      let part = 0;
      return { ok: true, body: { getReader: () => ({
        async read() {
          if (part++ === 0) return { done: false, value: new Uint8Array(Math.floor(size / 2)) };
          if (part === 2) { await gate.promise; return { done: false, value: new Uint8Array(size - Math.floor(size / 2)) }; }
          return { done: true };
        }, releaseLock() {},
      }) } };
    } });
    const downloading = h.player.download(); await flush();
    const partial = h.player.downloads.snapshot();
    assert.equal(partial.phase, 'downloading'); assert.equal(partial.completed, 0);
    assert(partial.received > 0 && partial.received < partial.total);
    gate.resolve(); assert(await downloading);
    assert.equal(h.player.downloads.snapshot().phase, 'downloaded');
    assert.equal(h.contexts.length, 0); assert.equal(h.timers.size, 0);
    h.player.dispose();
  });
  await check('sample preload is lazy, deduplicated and silent, with reusable stereo buffers and a short room response', async () => {
    const h = createAudioHarness({ suspended: true });
    assert.equal(h.contexts.length, 0); assert.equal(h.requests.length, 0);
    assert(await h.player.preload()); assert.equal(h.context.resumeCount, 0); assert.equal(h.context.sources.length, 0);
    assert.equal(h.requests.length, activeCount); assert.equal(h.player.buffers.size, activeCount); assert.equal(h.timers.size, 0);
    assert.equal(h.player.roomImpulse.numberOfChannels, 2); assert(h.player.roomImpulse.duration < .8);
    assert.notDeepEqual(h.player.roomImpulse.getChannelData(0), h.player.roomImpulse.getChannelData(1));
    assert(await h.player.preload()); assert.equal(h.requests.length, activeCount);
    assert(await h.player.unlock()); assert.equal(h.context.resumeCount, 1);
    h.player.dispose();
  });
  await check('pitches cover the interactive keyboard and velocity selects or blends actual recordings', async () => {
    const h = createAudioHarness(); assert(await h.player.unlock());
    for (const midi of [60, 61, 72, 82, 83]) {
      for (const velocity of [.2, .65, 1]) {
        const before = h.context.sources.length; h.player.scheduleNote(midi, velocity, 11, .5);
        const created = h.context.sources.slice(before); assert(created.length >= 1 && created.length <= 2);
        for (const source of created) {
          const sample = samples.PIANO_SAMPLES.find(({ url }) => url === source.buffer.sampleUrl); assert(sample);
          near(sample.midi + 12 * Math.log2(source.playbackRate.events[0].value), midi, 'original pitch preserved');
          if (midi >= 21 && midi <= 108) assert(Math.abs(sample.midi - midi) <= 1);
          if (velocity === .2) assert.equal(sample.layer, 5);
          if (velocity === 1) assert.equal(sample.layer, 11);
        }
      }
    }
    h.player.dispose();
  });
  await check('absolute scheduling, sounding durations and late offsets preserve note ends and release ordering', async () => {
    const h = createAudioHarness(); await h.player.unlock();
    h.player.scheduleNote(61, .3, 11, 2); const source = h.context.sources.at(-1);
    near(source.startTime, 11); near(source.offset, 0);
    assert(source.stopTimes[0] > 13 && source.stopTimes[0] < 13.25);
    const envelope = [...source.connections][0]; const release = envelope.gain.events.findLast((event) => event.type === 'set');
    near(release.time, 13);
    h.player.scheduleNote(61, .3, 9, 2); const late = h.context.sources.at(-1);
    near(late.startTime, 10); near(late.offset, Math.pow(2, 1 / 12));
    near(late.stopTimes[0] - source.stopTimes[0], -2, 'late attack must not extend its end');
    const count = h.context.sources.length;
    for (const args of [[60, .7, 9, .5], [60, 0, 11, 1], [NaN, .7, 11, 1], [128, .7, 11, 1], [60, .7, -1, 1], [60, .7, 11, Infinity]]) h.player.scheduleNote(...args);
    assert.equal(h.context.sources.length, count);
    h.player.scheduleNote(60, .3, 11, .0001);
    const events = [...h.context.sources.at(-1).connections][0].gain.events;
    for (let index = 1; index < events.length; index++) assert(events[index].time >= events[index - 1].time);
    h.player.dispose();
  });
  await check('interactive cancellation leaves score voices alive and future input remains usable', async () => {
    const { player, interaction, score } = await seeded();
    player.stopInteractiveNotes(); assert.equal(player.voices.size, 1); assert(player.voices.has(score));
    assert(interaction.sources.every((source) => source.disconnected)); assert(score.sources.every((source) => !source.disconnected));
    await player.playNote(62); assert.equal(player.voices.size, 2);
    player.stopInteractiveNotes(); player.stopInteractiveNotes(); assert.equal(player.voices.size, 1); player.dispose();
  });
  await check('gesture resume runs immediately and canceled input cannot survive pending resume or sample loading', async () => {
    const h = createAudioHarness({ suspended: true, pendingResume: true });
    const note = h.player.playNote(60), unlocked = h.player.unlock();
    assert.equal(h.context.resumeCount, 2, 'resume must be invoked before either first await');
    h.player.stopInteractiveNotes(); h.context.finishResume(); await note; assert(await unlocked);
    assert.equal(h.player.voices.size, 0); h.player.scheduleNote(64, .7, 10, 1); assert.equal(h.player.voices.size, 1); h.player.dispose();
    const blocked = blockedFetch(), loading = createAudioHarness({ fetch: blocked.fetch });
    const pendingNote = loading.player.playNote(60), pendingUnlock = loading.player.unlock(); await flush();
    assert.equal(loading.requests.length, 4, 'network/decode concurrency should be bounded');
    loading.player.stopInteractiveNotes(); blocked.release(); await pendingNote; assert(await pendingUnlock);
    assert.equal(loading.player.voices.size, 0); assert.equal(loading.requests.length, activeCount, 'concurrent callers share one sample load'); loading.player.dispose();
  });
  await check('stop, mute and dispose cancel both voice channels and all pending note requests', async () => {
    for (const action of ['stopNotes', 'toggle', 'dispose']) {
      const h = await seeded(); const room = h.player.room;
      await h.player[action](); assert.equal(h.player.voices.size, 0);
      assert([...h.interaction.sources, ...h.score.sources].every((source) => source.disconnected));
      assert(room.disconnected, `${action} must disconnect the old reverb tail`); h.player.dispose();
      const blocked = blockedFetch(), pending = createAudioHarness({ fetch: blocked.fetch });
      const note = pending.player.playNote(60), unlock = pending.player.unlock(); await flush();
      await pending.player[action](); blocked.release(); await note; assert.equal(await unlock, false);
      assert.equal(pending.player.voices.size, 0); pending.player.dispose(); assert.equal(pending.timers.size, 0);
      const suspended = createAudioHarness({ suspended: true, pendingResume: true });
      const suspendedNote = suspended.player.playNote(60), suspendedUnlock = suspended.player.unlock();
      await suspended.player[action](); suspended.context.finishResume();
      await suspendedNote; assert.equal(await suspendedUnlock, false, `${action} also cancels pending gesture resume`);
      assert.equal(suspended.context.sources.length, 0); suspended.player.dispose();
    }
  });
  await check('failed fetch or decode returns an honest error and retries only the missing samples without synthesis', async () => {
    for (const failure of ['fetch', 'decode']) {
      let failed = false, fetchFailures = 0;
      const h = createAudioHarness({
        fetch: async (url) => ({ ok: !(failure === 'fetch' && url === samples.PIANO_INTERACTIVE_SAMPLES[0].url && fetchFailures++ < 2), arrayBuffer: async () => ({ url }) }),
        decode: async (bytes) => {
          if (failure === 'decode' && !failed) { failed = true; throw new Error('Decoder failed'); }
          return { duration: 8, length: 352800, numberOfChannels: 2, sampleUrl: bytes.url };
        },
      });
      assert.equal(await h.player.unlock(), false); assert.equal(h.context.sources.length, 0);
      assert.equal(h.messages.at(-1).state.pianoAudio.status, 'error');
      assert.equal(h.player.buffers.size, activeCount - 1); assert(await h.player.unlock()); assert.equal(h.requests.length, failure === 'fetch' ? activeCount + 2 : activeCount);
      assert.equal(h.messages.at(-1).state.pianoAudio.status, 'ready'); h.player.dispose();
    }
  });
  await check('sample timeout and dispose abort pending downloads and stale decodes cannot repopulate disposed caches', async () => {
    const blocked = blockedFetch(), h = createAudioHarness({ fetch: blocked.fetch });
    const pending = h.player.unlock(); await flush();
    for (let round = 0; round < 40 && h.timers.size; round++) { [...h.timers.values()].forEach(timer => timer.callback()); await flush(); }
    assert.equal(await pending, false); assert.equal(h.timers.size, 0); assert(h.requests.every(({ request }) => request.signal.aborted)); h.player.dispose();
    const decoding = deferred(), late = createAudioHarness({ decode: () => decoding.promise });
    const load = late.player.preload(); await flush(); late.player.dispose();
    assert.equal(late.timers.size, 0, 'dispose clears the loading timeout before decoding finishes');
    decoding.resolve({ duration: 8, length: 352800, numberOfChannels: 2 }); assert.equal(await load, false);
    assert.equal(late.player.buffers.size, 0); assert.equal(late.context.state, 'closed');
    assert.equal(late.subscriptions.size, 0); assert.equal(late.timers.size, 0);
  });
  await check('all layer endings clean a voice and repeated playing stays bounded at 64 voices', async () => {
    const h = await seeded();
    const voice = h.interaction; voice.sources[0].onended(); assert(h.player.voices.has(voice));
    voice.sources[1].onended(); assert(!h.player.voices.has(voice)); assert(voice.nodes.every((node) => node.disconnected));
    const oldest = [...h.player.voices][0];
    for (let index = 0; index < 70; index++) await h.player.playNote(60 + index % 12);
    assert.equal(h.player.voices.size, 64); assert(oldest.sources.every((source) => source.disconnected));
    assert(h.context.sources.filter((source) => !source.disconnected).length <= 128);
    h.player.dispose(); assert(h.context.sources.every((source) => source.disconnected));
  });
  await check('every declared root/layer is a licensed local MP3 and covers all authored score pitches', async () => {
    assert.equal(samples.PIANO_SAMPLES.length, 60); assert.equal(new Set(samples.PIANO_SAMPLES.map(({ url }) => url)).size, 60);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', samples.PIANO_BANK_PATH, 'manifest.json'), 'utf8'));
    assert.equal(manifest.license, 'CC-BY-3.0'); assert.equal(manifest.author, 'Alexander Holm');
    let bytes = 0;
    for (const sample of samples.PIANO_SAMPLES) {
      const file = fs.readFileSync(path.join(root, 'public', sample.url)); bytes += file.length;
      assert(file.length > 10000, 'sample is not a real audio payload');
      assert(file.subarray(0, 3).toString() === 'ID3' || file[0] === 0xff, 'sample has no MP3 header');
      const metadata = manifest.samples.find((entry) => entry.file === path.basename(sample.url));
      assert(metadata, 'sample is missing its attribution/integrity record');
      assert.equal(metadata.midi, sample.midi); assert.equal(metadata.velocityLayer, sample.layer);
      assert.equal(file.length, metadata.bytes); assert.equal(crypto.createHash('sha256').update(file).digest('hex'), metadata.sha256);
      assert.equal(metadata.channels, 2); assert(metadata.durationSeconds > 0 && metadata.durationSeconds <= 8.1);
    }
    assert(bytes < 12000000); assert.equal(bytes, manifest.totalAudioBytes);
    const score = JSON.parse(fs.readFileSync(path.join(root, 'public/Piano/en-avril-a-paris.json'), 'utf8'));
    for (const note of score.notes) for (const { sample } of samples.pianoSampleMix(note.midi, note.velocity)) {
      assert(Math.abs(sample.midi - note.midi) <= 1);
      const metadata = manifest.samples.find((entry) => entry.file === path.basename(sample.url));
      const available = metadata.durationSeconds / Math.pow(2, (note.midi - sample.midi) / 12);
      assert(available >= (note.soundDuration ?? note.duration), 'recording is too short for an authored sounding duration');
    }
    assert(fs.existsSync(path.join(root, 'public/audio/piano/index.html')));
    console.log(`  Local piano bank: 60 recordings, ${bytes.toLocaleString()} bytes`);
  });
  if (failures.length) process.exitCode = 1;
  else console.log('All sampled piano audio checks passed');
}
module.exports = { createAudioHarness, samples };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
