/* Deterministic proof of the real engine; no renderer, real timers, or player API. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

function load(relative, requireModule, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  const sandbox = { exports: {}, require: requireModule, ...globals };
  vm.runInNewContext(result.outputText, sandbox, { filename });
  return sandbox.exports;
}

const sharedTrack = require('../src/design/rhythm-track.mjs');
const config = load('src/design/rhythm-game.ts', (name) => {
  if (name === './rhythm-track.mjs') return sharedTrack;
  throw new Error(`Unexpected config dependency: ${name}`);
});
const { TRACK, RHYTHM_KEYS, RHYTHM_WINDOWS, RHYTHM_MAX_SCORE, createOriginalChart } = config;
const notes = createOriginalChart();
const first = notes[0];
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

function harness({ storage = new Map(), denyRead = false, denyWrite = false } = {}) {
  const states = [], pads = [], hits = [], judgements = [], results = [];
  const { default: RhythmGame } = load('src/Application/World/RhythmGame.ts', (module) => {
    assert(module.endsWith('/design/rhythm-game'));
    return config;
  }, {
    localStorage: {
      getItem(key) { if (denyRead) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (denyWrite) throw new Error('Storage unavailable'); storage.set(key, value); },
    },
  });
  const game = new RhythmGame({
    onState: (state) => states.push(state),
    onPad: (lane, on) => pads.push({ lane, on }),
    onHit: (lane, judgement) => hits.push({ lane, judgement }),
    onJudgement: (event) => judgements.push(event),
    onResult: (state) => results.push(state),
  });
  return { game, states, pads, hits, judgements, results, storage };
}

let passed = 0;
function check(name, run) {
  try { run(); passed++; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { process.stderr.write(`FAIL ${name}\n${error.stack}\n`); process.exitCode = 1; }
}

check('original chart uses four balanced keys, distinct two-note chords, and countdown/tail room', () => {
  assert.equal(JSON.stringify(notes), JSON.stringify(createOriginalChart()));
  assert.equal(RHYTHM_KEYS.map((key) => key.code).join(','), 'KeyD,KeyF,KeyJ,KeyK');
  assert.equal(RHYTHM_KEYS.map((key) => key.label).join(','), 'D,F,J,K');
  assert.match(TRACK.id, /four-key-v\d+$/);
  near(first.time, TRACK.firstNoteTime, 'first note follows the configured native audio phase');
  assert(first.time >= 8 * 60 / TRACK.bpm, 'at least two bars remain for the opening countdown');
  assert(first.time - 8 * 60 / TRACK.bpm < 0.1, 'first note retains the measured attack-phase offset');
  assert(notes.at(-1).time < TRACK.duration - 2);
  assert(notes.length / TRACK.duration < 4, 'moderate note density');
  const moments = new Map();
  const lanes = new Set();
  notes.forEach((note, index) => {
    assert(Number.isInteger(note.lane) && note.lane >= 0 && note.lane < RHYTHM_KEYS.length);
    assert(index === 0 || notes[index - 1].time <= note.time);
    const at = moments.get(note.time) || new Set();
    assert(!at.has(note.lane), 'no same-lane duplicate notes');
    at.add(note.lane); moments.set(note.time, at); lanes.add(note.lane);
  });
  assert.equal(lanes.size, 4);
  assert([...moments.values()].some((lanesAtTime) => lanesAtTime.size === 2));
  assert([...moments.values()].every((lanesAtTime) => lanesAtTime.size <= 2));
  const leftHand = notes.filter((note) => note.lane < 2).length;
  assert(Math.abs(leftHand - (notes.length - leftHand)) <= 4, 'mirrored phrases balance the two hands');
  assert([...moments.values()].filter((lanesAtTime) => lanesAtTime.size === 2).every((lanesAtTime) => {
    const pair = [...lanesAtTime]; return pair.some((lane) => lane < 2) && pair.some((lane) => lane >= 2);
  }), 'every accent uses a distinct key from each hand');
});

check('four-key phrase golden preserves its rhythm while alternating and mirroring hand roles', () => {
  const expected = [[0,0],[1,2],[2,1],[3,3],[4,1],[5.5,3],[7,0],[8,2],[9,0],[10,3],[11,1],
    [12,0],[12,2],[14,1],[15,3],[16,0],[17,2],[18,1],[18.5,3],[19,0],[20,3],[21.5,1],[23,2],
    [24,1],[25,3],[26,0],[27,2],[28,1],[28,3],[30,2],[31,0]];
  const beat = (note) => Math.round((note.time - TRACK.firstNoteTime) * TRACK.bpm / 60 * 1e6) / 1e6;
  assert.deepEqual(notes.slice(0, expected.length).map((note) => [beat(note), note.lane]), expected);
  assert.deepEqual(notes.slice(expected.length, expected.length * 2).map((note) => [beat(note) - 32, note.lane]),
    expected.map(([time, lane]) => [time, 3 - lane]));
});

check('browser types and production server use one identical runtime chart and scoring configuration', () => {
  assert.equal(config.TRACK, sharedTrack.TRACK);
  assert.equal(config.RHYTHM_MAX_SCORE, sharedTrack.RHYTHM_MAX_SCORE);
  assert.equal(JSON.stringify(notes), JSON.stringify(sharedTrack.createOriginalChart()));
  const backend = fs.readFileSync(path.join(__dirname, '../server/leaderboard-store.mjs'), 'utf8');
  assert(backend.includes("from '../src/design/rhythm-track.mjs'"));
  assert(!backend.includes("from '../src/design/rhythm-game.ts'"), 'Node Functions must not depend on a TS filename rewritten by their builder');
});

check('idle ignores input, start uses only external clock, countdown never scores', () => {
  const { game } = harness();
  game.update(first.time, true); game.press(first.lane, 'keyboard');
  assert.equal(game.state.phase, 'idle');
  game.start();
  assert.equal(game.state.phase, 'countdown');
  assert.equal(game.state.time, 0);
  game.update(1, true); game.press(first.lane, 'keyboard');
  assert.equal(game.state.score, 0);
  game.update(first.time, true);
  game.press(first.lane, 'keyboard');
  assert.equal(game.state.perfect, 0, 'holding through countdown does not score');
  game.release('keyboard'); game.press(first.lane, 'keyboard');
  assert.equal(game.state.perfect, 1);
});

check('early and late edges use the 45/90/140 ms judgement windows', () => {
  for (const [offset, judgement] of [[0, 'Perfect'], [-0.045, 'Perfect'], [0.045, 'Perfect'],
    [-0.09, 'Great'], [0.09, 'Great'], [-0.14, 'Good'], [0.14, 'Good']]) {
    const { game } = harness(); game.start();
    game.update(first.time + offset, true); game.press(first.lane, 'test');
    assert.equal(game.state.judgement, judgement, `${offset}s`);
    assert.equal(game.state.combo, 1);
  }
  const { game } = harness(); game.start();
  game.update(first.time - 0.141, true); game.press(first.lane, 'early'); game.release('early');
  assert.equal(game.state.score, 0);
  game.update(first.time + 0.141, true); game.press(first.lane, 'late');
  assert.equal(game.state.misses, 1);
  assert.equal(game.state.score, 0);
});

check('nearest matching lane scores once and expired notes miss only once', () => {
  const { game } = harness(); game.start(); game.update(first.time, true);
  game.press((first.lane + 1) % RHYTHM_KEYS.length, 'wrong'); assert.equal(game.state.score, 0);
  game.press(first.lane, 'right'); const score = game.state.score;
  game.release('right'); game.press(first.lane, 'right-again');
  assert.equal(game.state.score, score);
  game.update(notes[1].time + 0.2, true);
  const misses = game.state.misses;
  game.update(notes[1].time + 0.3, true);
  assert.equal(game.state.misses, misses);
});

check('two-note chords judge both lanes independently in either input order', () => {
  const chord = notes.filter((note) => note.time === notes.find((note, index) => notes[index + 1]?.time === note.time).time);
  for (const pair of [chord, [...chord].reverse()]) {
    const { game, hits, judgements } = harness(); game.start(); game.update(pair[0].time, true);
    pair.forEach((note) => game.press(note.lane, `key-${note.lane}`));
    assert.equal(game.state.perfect, 2);
    assert.equal(game.state.combo, 2);
    assert.equal(hits.length, 2);
    assert.equal(game.state.heldLanes.length, 2);
    const events = judgements.slice(-2);
    assert.equal(events[1].id, events[0].id + 1);
    assert.deepEqual(events.map((event) => event.lane), pair.map((note) => note.lane));
    assert.deepEqual(events.map((event) => event.combo), [1, 2]);
    assert(events.every((event) => event.judgement === 'Perfect' && event.time === pair[0].time));
  }
});

check('repeat and multi-source lane ownership cannot create extra hits or release another owner', () => {
  const { game, pads } = harness(); game.start(); game.update(first.time, true);
  game.press(first.lane, 'keyboard'); game.press(first.lane, 'keyboard');
  game.press(first.lane, 'touch');
  assert.equal(game.state.perfect, 1);
  assert.equal(pads.filter((pad) => pad.on).length, 1);
  game.release('keyboard');
  assert.equal(game.state.heldLanes.length, 1);
  assert.equal(pads.at(-1).on, true);
  const nextOnLane = notes.find((note) => note.lane === first.lane && note.time > first.time);
  game.update(nextOnLane.time, true); game.press(first.lane, 'keyboard');
  assert.equal(game.state.perfect, 1, 'new owner does not retrigger a held lane');
  game.release('keyboard'); game.release('touch');
  assert.equal(game.state.heldLanes.length, 0);
  assert.equal(pads.at(-1).on, false);
  game.press(first.lane, 'keyboard');
  assert.equal(game.state.perfect, 2);
});

check('pause and buffering freeze judgement and holds; resume uses song time', () => {
  const { game, pads } = harness(); game.start(); game.update(first.time, true);
  game.press(first.lane, 'keyboard'); const before = game.state;
  game.pause();
  assert.equal(game.state.phase, 'paused');
  assert.equal(game.state.heldLanes.length, 0);
  assert.equal(pads.at(-1).on, false);
  game.update(TRACK.duration, false); game.press(notes[1].lane, 'paused-key');
  assert.equal(game.state.score, before.score);
  assert.equal(game.state.time, before.time);
  assert.equal(game.state.misses, before.misses);
  game.update(notes[1].time, true); game.press(notes[1].lane, 'resumed-key');
  assert.equal(game.state.perfect, 2);
  assert.equal(game.state.phase, 'playing');
});

check('forward seeks miss skipped notes and backward seeks reset without duplicating points', () => {
  const { game } = harness(); game.start(); game.update(first.time, true); game.press(first.lane, 'first');
  game.update(notes[8].time, true);
  assert.equal(game.state.misses, notes.filter((note) => note.time < notes[8].time - RHYTHM_WINDOWS.good).length - 1);
  game.update(first.time, true);
  assert.equal(game.state.score, 0);
  assert.equal(game.state.misses, 0);
  assert.equal(game.state.heldLanes.length, 0);
  game.press(first.lane, 'first'); assert.equal(game.state.perfect, 1);
  game.update(first.time - 0.03, true);
  assert.equal(game.state.perfect, 1, 'small timestamp jitter does not reset');
  near(game.state.time, first.time, 'clock does not move backwards for jitter');
  game.update(notes[8].time, false);
  assert.equal(game.state.misses, 0, 'paused seek alone never auto-scores');
  game.update(notes[8].time, true);
  assert(game.state.misses > 0);
});

check('invalid timestamps and lanes do not alter a valid run', () => {
  const { game } = harness(); game.start(); game.update(first.time, true);
  for (const lane of [-1, 4, 5, 6, 7, 8, 1.5, NaN]) game.press(lane, `bad-${lane}`);
  game.press(first.lane, '');
  game.update(NaN, true); game.update(Infinity, true);
  assert.equal(game.state.score, 0); assert.equal(game.state.heldLanes.length, 0);
  near(game.state.time, first.time, 'finite clock stays intact');
});

check('full perfect play reaches maximum score with exactly one event per note and one result', () => {
  const { game, results, storage, judgements } = harness(); game.start();
  for (const note of notes) {
    game.update(note.time, true); game.press(note.lane, `lane-${note.lane}`); game.release(`lane-${note.lane}`);
  }
  assert.equal(game.state.perfect, notes.length);
  assert.equal(game.state.score, RHYTHM_MAX_SCORE);
  assert.equal(game.state.accuracy, 100);
  assert.equal(game.state.maxCombo, notes.length);
  assert.equal(judgements.length, notes.length);
  judgements.forEach((event, index) => {
    assert.equal(event.id, index + 1); assert.equal(event.combo, index + 1);
    assert.equal(event.lane, notes[index].lane); assert.equal(event.time, notes[index].time);
    assert.equal(event.judgement, 'Perfect');
  });
  game.update(TRACK.duration, true); game.update(TRACK.duration + 10, true);
  assert.equal(game.state.phase, 'finished'); assert.equal(results.length, 1);
  assert.equal(game.state.visibleNotes.length, 0); assert.equal(game.state.heldLanes.length, 0);
  assert.equal(game.state.best, RHYTHM_MAX_SCORE);
  assert.equal([...storage.values()][0], String(RHYTHM_MAX_SCORE));
  assert.equal(judgements.length, notes.length);
});

check('judgement IDs are monotonic across misses, restarts and seeks; idle or paused input emits nothing', () => {
  const { game, judgements } = harness();
  game.press(first.lane, 'idle'); game.update(first.time, true); assert.equal(judgements.length, 0);
  game.start(); game.update(1, true); game.press(first.lane, 'countdown'); game.release('countdown');
  assert.equal(judgements.length, 0);
  game.update(first.time + 0.06, true); game.press(first.lane, 'tap');
  assert.deepEqual(JSON.parse(JSON.stringify(judgements[0])), {
    id: 1, lane: first.lane, judgement: 'Great', combo: 1, time: first.time + 0.06,
  });
  game.press(first.lane, 'tap'); game.release('tap'); game.press(first.lane, 'same-note');
  assert.equal(judgements.length, 1);
  game.update(notes[1].time + 0.141, true);
  assert.equal(judgements.length, 2); assert.equal(judgements[1].judgement, 'Miss'); assert.equal(judgements[1].combo, 0);
  game.update(notes[1].time + 0.15, true); assert.equal(judgements.length, 2);
  game.pause(); game.press(notes[2].lane, 'paused'); game.update(TRACK.duration, false);
  assert.equal(judgements.length, 2);
  game.start(); game.update(first.time, true); game.press(first.lane, 'restart');
  assert.equal(judgements[2].id, 3);
  game.update(first.time + 0.2, true); game.update(first.time, true); game.press(first.lane, 'seek');
  assert.equal(judgements[3].id, 4);
  game.cancel(); game.press(first.lane, 'cancelled'); game.update(TRACK.duration, true);
  assert.equal(judgements.length, 4);
  game.dispose(); game.start(); game.update(first.time, true); game.press(first.lane, 'disposed');
  assert.equal(judgements.length, 4);
});

check('expired chords publish both misses once, with separate IDs and zero combo', () => {
  const chordIndex = notes.findIndex((note, index) => notes[index + 1]?.time === note.time);
  const { game, judgements } = harness(); game.start(); game.update(notes[chordIndex].time + 0.141, true);
  const missedChord = judgements.slice(-2);
  assert.equal(missedChord.length, 2);
  assert.deepEqual(missedChord.map((event) => event.lane), notes.slice(chordIndex, chordIndex + 2).map((note) => note.lane));
  assert(missedChord.every((event) => event.judgement === 'Miss' && event.combo === 0));
  assert.equal(missedChord[1].id, missedChord[0].id + 1);
  const count = judgements.length;
  game.update(notes[chordIndex].time + 0.2, true); assert.equal(judgements.length, count);
});

check('unplayed finish misses every note; partial results persist across reset and new instances', () => {
  const empty = harness(); empty.game.start(); empty.game.update(TRACK.duration, true);
  assert.equal(empty.game.state.misses, notes.length); assert.equal(empty.game.state.score, 0);
  const { game, storage } = harness(); game.start(); game.update(first.time, true); game.press(first.lane, 'one');
  game.update(TRACK.duration, true); const best = game.state.best; assert(best > 0);
  game.start(); assert.equal(game.state.best, best); assert.equal(game.state.score, 0);
  assert.equal(game.state.heldLanes.length, 0);
  game.cancel(); assert.equal(game.state.phase, 'idle'); assert.equal(game.state.best, best);
  assert.equal(harness({ storage }).game.state.best, best);
});

check('storage denial or corrupt best values cannot interrupt play', () => {
  const { game } = harness({ denyRead: true, denyWrite: true });
  game.start(); game.update(first.time, true); game.press(first.lane, 'one'); game.update(TRACK.duration, true);
  assert.equal(game.state.phase, 'finished'); assert(game.state.best > 0);
  for (const bad of ['NaN', '-1', '1000001', '8.5', 'Infinity']) {
    const storage = new Map([[`bbangjo.rhythm.best.${TRACK.id}`, bad]]);
    assert.equal(harness({ storage }).game.state.best, 0);
  }
});

check('the four-key track does not inherit or overwrite eight-key personal bests', () => {
  const oldKey = 'bbangjo.rhythm.best.beethoven-virus-original-eight-key-v1';
  const storage = new Map([[oldKey, String(RHYTHM_MAX_SCORE)]]);
  const { game } = harness({ storage });
  assert.equal(game.state.best, 0);
  game.start(); game.update(first.time, true); game.press(first.lane, 'new'); game.update(TRACK.duration, true);
  assert(game.state.best > 0); assert(game.state.best < RHYTHM_MAX_SCORE);
  assert.equal(storage.get(oldKey), String(RHYTHM_MAX_SCORE));
  assert.equal(storage.get(`bbangjo.rhythm.best.${TRACK.id}`), String(game.state.best));
});

check('snapshots cannot mutate engine state and dispose retires all inputs', () => {
  const { game, states } = harness(); game.start(); game.update(first.time, true); game.press(first.lane, 'held');
  const snapshot = game.getSnapshot();
  snapshot.heldLanes.push(9); snapshot.score = 999;
  if (snapshot.visibleNotes[0]) snapshot.visibleNotes[0].lane = 9;
  assert(!game.state.heldLanes.includes(9)); assert.notEqual(game.state.score, 999);
  assert(game.state.visibleNotes.every((note) => note.lane < RHYTHM_KEYS.length));
  game.dispose(); const count = states.length;
  game.start(); game.update(TRACK.duration, true); game.press(0, 'late'); game.release('late'); game.pause(); game.cancel();
  assert.equal(states.length, count); assert.equal(game.state.phase, 'idle');
});

if (!process.exitCode) process.stdout.write(`Rhythm engine: ${passed} deterministic checks passed (${notes.length} original notes).\n`);
