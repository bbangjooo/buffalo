/* Native rhythm transport with controllable media events/promises; no network/browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness({ duration = 20, fileDuration = 45, muted = false } = {}) {
  const events = [], subscriptions = new Map(), frames = new Map(), timers = new Map(), elements = [];
  let nextId = 1;
  const host = { hidden: false, style: { display: 'block' }, children: [], appendChild(child) { this.children.push(child); child.parent = this; } };
  class Audio {
    constructor() {
      this.listeners = new Map(); this.attributes = new Map(); this.paused = true; this.seeking = false; this.ended = false;
      this.readyState = 0; this.duration = NaN; this._time = 0; this.muted = false; this.error = null;
      this.playCalls = []; this.pauseCalls = 0; this.loadCalls = 0; this.seekWrites = []; this.removed = false; this.throwPlay = null;
    }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type) { [...(this.listeners.get(type) || [])].forEach((listener) => listener({ type, target: this })); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    set src(value) { this.attributes.set('src', value); }
    get src() { return this.attributes.get('src') || ''; }
    set currentTime(value) { this._time = value; this.seekWrites.push(value); this.ended = false; }
    get currentTime() { return this._time; }
    load() { this.loadCalls++; this.readyState = 0; this.duration = NaN; this._time = 0; this.paused = true; this.ended = false; this.error = null; this.seeking = false; }
    play() {
      const pending = deferred(); this.playCalls.push(pending);
      if (this.throwPlay) throw this.throwPlay;
      this.paused = false; this.emit('play'); return pending.promise;
    }
    pause() { this.pauseCalls++; const changed = !this.paused; this.paused = true; if (changed) this.emit('pause'); }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  }
  const EventBus = {
    on(type, listener) { subscriptions.set(type, listener); return () => subscriptions.delete(type); },
    dispatch(type, state) { events.push({ type, state }); },
  };
  const filename = path.join(__dirname, '../src/Application/World/RhythmMusic.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2016 } }).outputText;
  const sandbox = { exports: {}, require: (name) => { assert.equal(name, '../UI/EventBus'); return { EventBus }; },
    document: { createElement(type) { assert.equal(type, 'audio', 'transport must not create iframe, script, or video elements'); const audio = new Audio(); elements.push(audio); return audio; } },
    window: {
      setTimeout(fn, milliseconds) { const id = nextId++; timers.set(id, { fn, milliseconds }); return id; },
      clearTimeout(id) { timers.delete(id); },
      requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
  };
  vm.runInNewContext(output, sandbox, { filename });
  const music = new sandbox.exports.default(host, { audioUrl: '/audio/rhythm/lasso-lady.mp3', title: 'Lasso Lady', duration }, muted);
  const audio = elements[0];
  return {
    music, audio, host, events, subscriptions, frames, timers,
    get state() { return events.at(-1)?.state; },
    action(action, extra = {}) { subscriptions.get('rhythm-music-action')?.({ action, ...extra }); },
    request() { subscriptions.get('rhythm-music-request-state')?.(); },
    metadata(value = fileDuration) { audio.duration = value; audio.readyState = 1; audio.emit('loadedmetadata'); },
    ready(value = fileDuration) { audio.duration = value; audio.readyState = 4; audio.emit('canplay'); },
    time(value, emit = true) { audio._time = value; if (emit) audio.emit('timeupdate'); },
    frame() { const pending = [...frames]; frames.clear(); pending.forEach(([, fn]) => fn(999999)); },
    timeout() { const pending = [...timers]; timers.clear(); pending.forEach(([, { fn }]) => fn()); },
    resolvePlay(index = audio.playCalls.length - 1) { audio.paused = false; audio.seeking = false; audio.emit('playing'); audio.playCalls[index].resolve(); },
  };
}

async function main() {
  const failures = [];
  async function check(name, run) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
  }
  await check('hidden native audio waits for canplay data and never starts automatically', async () => {
    const h = harness({ duration: 60, fileDuration: 45 });
    assert(h.host.hidden && h.host.style.display === 'none' && h.audio.hidden);
    assert.equal(h.host.children.length, 1); assert.equal(h.audio.src, '/audio/rhythm/lasso-lady.mp3');
    assert.equal(h.audio.controls, false); assert.equal(h.audio.autoplay, false); assert.equal(h.audio.preload, 'auto');
    assert.equal(h.state.ready, false); assert.equal(h.state.playerState, 'unstarted');
    assert.equal(h.frames.size, 0); assert.equal([...h.timers.values()][0].milliseconds, 20000);
    h.action('play'); h.action('restart'); assert.equal(h.audio.playCalls.length, 0);
    h.metadata(); assert.equal(h.state.ready, false); assert.equal(h.state.duration, 45);
    h.action('play'); assert.equal(h.audio.playCalls.length, 0);
    h.ready(); assert.equal(h.state.ready, true); assert.equal(h.state.playerState, 'cued'); assert.equal(h.timers.size, 0);
    assert.equal(h.audio.playCalls.length, 0); h.music.dispose();
  });
  await check('play keeps the gesture synchronous and samples only the native audio clock', async () => {
    const h = harness(); h.ready(); h.action('play');
    assert.equal(h.audio.playCalls.length, 1, 'play() must run within action dispatch');
    assert.equal(h.state.playerState, 'buffering'); assert.equal(h.state.playing, false);
    h.resolvePlay(); await flush(); assert(h.state.playing); assert.equal(h.state.playerState, 'playing'); assert.equal(h.frames.size, 1);
    for (let frame = 0; frame < 4; frame++) h.frame(); assert.equal(h.state.time, 0, 'RAF timestamps must not advance the music');
    h.time(4.125, false); h.frame(); assert.equal(h.state.time, 4.125);
    h.time(NaN, false); h.frame(); assert.equal(h.state.time, 4.125, 'invalid media time cannot contaminate game state');
    h.time(4.75, false); h.request(); assert.equal(h.state.time, 4.75);
    h.music.dispose();
  });
  await check('pause/resume preserves position, seeking follows native events, and restart/stop return to zero', async () => {
    const h = harness(); h.ready(); h.action('play'); h.resolvePlay(); await flush(); h.time(4);
    h.action('pause'); assert(h.audio.paused); assert.equal(h.state.playerState, 'paused'); assert.equal(h.state.time, 4); assert.equal(h.frames.size, 0);
    h.audio.currentTime = 7; h.audio.seeking = true; h.audio.emit('seeking'); assert.equal(h.state.time, 7); assert.equal(h.state.playing, false);
    h.audio.seeking = false; h.audio.emit('seeked');
    h.action('play'); h.resolvePlay(); await flush(); assert.equal(h.state.time, 7); assert(h.state.playing);
    const calls = h.audio.playCalls.length; h.action('restart'); assert.equal(h.audio.playCalls.length, calls + 1);
    assert.equal(h.audio.currentTime, 0); assert.equal(h.state.time, 0); h.resolvePlay(); await flush();
    h.time(3); h.action('stop'); assert(h.audio.paused); assert.equal(h.audio.currentTime, 0); assert.equal(h.state.time, 0); assert.equal(h.frames.size, 0);
    h.music.dispose();
  });
  await check('segment end pauses once at the bounded duration and natural file endings use the shorter file', async () => {
    const h = harness({ duration: 20, fileDuration: 45 }); h.ready(); h.action('play'); h.resolvePlay(); await flush();
    h.time(20.1, false); h.frame(); assert(h.audio.paused); assert.equal(h.audio.currentTime, 20);
    assert.equal(h.state.playerState, 'ended'); assert.equal(h.state.time, 20); assert.equal(h.state.duration, 20); assert.equal(h.frames.size, 0);
    h.audio.emit('ended'); h.audio.emit('timeupdate'); assert.equal(h.state.playerState, 'ended');
    h.action('play'); assert.equal(h.audio.currentTime, 0); h.resolvePlay(); await flush(); assert(h.state.playing); h.music.dispose();
    const short = harness({ duration: 20, fileDuration: 12 }); short.ready(); short.action('play'); short.resolvePlay(); await flush();
    short.audio.ended = true; short.audio._time = 12; short.audio.emit('ended');
    assert.equal(short.state.time, 12); assert.equal(short.state.duration, 12); assert.equal(short.state.playerState, 'ended'); short.music.dispose();
  });
  await check('buffering and seeking pause the reported rhythm clock until native playback recovers', async () => {
    const h = harness(); h.ready(); h.action('play'); h.resolvePlay(); await flush(); h.time(2);
    h.audio.emit('waiting'); assert.equal(h.state.playing, false); assert.equal(h.state.playerState, 'buffering'); assert.equal(h.timers.size, 1);
    h.frame(); assert.equal(h.state.time, 2); h.ready(); assert(h.state.playing); assert.equal(h.timers.size, 0);
    h.audio.seeking = true; h.audio.emit('seeking'); assert.equal(h.state.playerState, 'buffering');
    h.audio.currentTime = 6; h.audio.seeking = false; h.audio.emit('seeked'); assert.equal(h.state.time, 6); assert(h.state.playing);
    h.music.dispose();
  });
  await check('pause, stop and dispose suppress late fulfillment of an earlier play request', async () => {
    for (const action of ['pause', 'stop', 'dispose']) {
      const h = harness(); h.ready(); h.action('play');
      if (action === 'dispose') h.music.dispose(); else h.action(action);
      const count = h.events.length;
      h.resolvePlay(0); await flush(); assert(h.audio.paused, `${action} must silence a stale resolved play`); assert.equal(h.frames.size, 0);
      if (action === 'dispose') assert.equal(h.events.length, count, 'disposed callbacks must not publish');
      else { assert.equal(h.state.playing, false); if (action === 'stop') assert.equal(h.state.time, 0); }
      h.music.dispose();
    }
  });
  await check('older promise resolution or rejection cannot pause or poison a newer successful play', async () => {
    for (const outcome of ['resolve', 'reject']) {
      const h = harness(); h.ready(); h.action('play'); h.action('pause'); h.action('play'); h.resolvePlay(1); await flush(); h.time(3);
      if (outcome === 'resolve') h.resolvePlay(0); else h.audio.playCalls[0].reject(new Error('Old request failed'));
      await flush(); assert.equal(h.audio.paused, false); assert(h.state.playing); assert.equal(h.state.error, undefined); assert.equal(h.state.time, 3);
      assert.equal(h.frames.size, 1); h.music.dispose();
    }
  });
  await check('autoplay denial remains ready and the same Start/Resume gesture can retry', async () => {
    const h = harness(); h.ready(); h.action('play'); h.audio.playCalls[0].reject({ name: 'NotAllowedError' }); await flush();
    assert.equal(h.state.ready, true); assert.equal(h.state.playing, false); assert(h.state.error.includes('Start')); assert(h.audio.paused);
    h.action('play'); assert.equal(h.audio.playCalls.length, 2); assert.equal(h.state.error, undefined);
    h.resolvePlay(1); await flush(); assert(h.state.playing); h.music.dispose();
    const sync = harness(); sync.ready(); sync.audio.throwPlay = { name: 'NotAllowedError' }; sync.action('restart');
    assert(sync.state.ready && sync.state.error); sync.audio.throwPlay = null; sync.action('play'); sync.resolvePlay(); await flush();
    assert(sync.state.playing); sync.music.dispose();
  });
  await check('load timeout and media errors support an honest reload with no queued automatic playback', async () => {
    const h = harness(); h.timeout(); assert.equal(h.state.ready, false); assert(h.state.error.includes('retry')); assert.equal(h.timers.size, 0);
    h.action('play'); assert.equal(h.audio.loadCalls, 2); assert.equal(h.state.error, undefined); assert.equal(h.state.ready, false);
    h.ready(); assert(h.state.ready); assert.equal(h.audio.playCalls.length, 0);
    h.action('restart'); h.resolvePlay(); await flush(); h.time(3);
    h.audio.error = { code: 3 }; h.audio.emit('error'); assert.equal(h.state.ready, false); assert(h.state.error.includes('decoded')); assert(h.audio.paused); assert.equal(h.frames.size, 0);
    h.action('restart'); assert.equal(h.audio.loadCalls, 3); assert.equal(h.audio.playCalls.length, 1); h.ready();
    assert.equal(h.state.time, 0); assert(h.state.ready); h.action('play'); h.resolvePlay(); await flush(); assert(h.state.playing); h.music.dispose();
  });
  await check('mute mirrors the media element without global feedback, and disposal removes media, handlers and timers', async () => {
    const h = harness({ muted: true }); assert(h.audio.muted && h.state.muted);
    h.action('mute', { muted: false }); assert.equal(h.audio.muted, false); assert.equal(h.state.muted, false);
    h.audio.muted = true; h.audio.emit('volumechange'); assert.equal(h.state.muted, true);
    assert(h.events.every(({ type }) => type === 'rhythm-music-state'));
    const listeners = [...h.audio.listeners.values()].flatMap((set) => [...set]);
    const loads = h.audio.loadCalls; h.music.dispose(); assert(h.audio.removed); assert(h.audio.paused); assert.equal(h.audio.src, '');
    assert.equal(h.audio.loadCalls, loads + 1, 'clearing src then load() aborts the media request');
    assert.equal(h.host.children.length, 0); assert.equal(h.host.hidden, false); assert.equal(h.host.style.display, 'block');
    assert.equal(h.subscriptions.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
    assert([...h.audio.listeners.values()].every((set) => set.size === 0));
    const count = h.events.length; listeners.forEach((fn) => fn()); h.action('play'); h.request(); h.music.dispose(); assert.equal(h.events.length, count);
  });
  if (failures.length) process.exitCode = 1;
  else console.log('All native rhythm music checks passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
