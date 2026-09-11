/* Exercise actual locomotion and the exhibit data contract without a renderer. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const layout = require('../src/design/courtyard-layout.json');
function loadTypeScript(relativePath, resolve) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = { exports: {}, require: resolve };
  vm.runInNewContext(code, sandbox);
  return sandbox.exports;
}
const { CourtyardWalk, walkDirection } = loadTypeScript('../src/Application/World/CourtyardWalk.ts', () => ({ COURTYARD: layout }));
const { PROFILE } = loadTypeScript('../src/design/profile.ts', (request) => { throw new Error(`Unexpected profile dependency: ${request}`); });
const { EXHIBITIONS } = loadTypeScript('../src/design/history.ts', (request) => {
  if (request === './profile') return { PROFILE };
  return require(path.join(__dirname, '../src/design', request));
});
let failures = 0;
function check(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function advance(w, heading, directions, ms = 1000, inspect = () => {}) {
  w.stop();
  directions.forEach((direction, index) => w.setInput(`test-${index}`, direction));
  for (let t = 0; t < ms; t += 10) { w.update(10, heading); inspect(w); }
  return w;
}
function walkTo(w, x, z, inspect = assertClear) {
  const distance = Math.hypot(x - w.x, z - w.z);
  const heading = Math.atan2(x - w.x, z - w.z);
  w.stop(); w.setInput('route-walk', 'up');
  for (let remaining = distance / 8.4 * 1000; remaining > 1e-8;) {
    const delta = Math.min(10, remaining);
    w.update(delta, heading); inspect(w); remaining -= delta;
  }
  w.stop();
  assert(Math.hypot(w.x - x, w.z - z) < 1e-7, `walking route blocked before (${x}, ${z})`);
}
function walk(direction, ms = 1000, heading = 0) {
  const w = new CourtyardWalk(); w.x = 0; w.z = 70;
  return advance(w, heading, [direction], ms);
}
function assertClear(w) {
  const houseRadius = layout.houseHalfSize + 0.4;
  assert(!(Math.abs(w.x) < houseRadius && Math.abs(w.z) < houseRadius), 'robot entered the house');
  for (const s of layout.stations) assert(Math.hypot(w.x - s.x, w.z - s.z) >= 2 - 1e-8, `robot entered ${s.id}`);
  for (const obstacle of layout.obstacles) assert(Math.hypot(w.x - obstacle.x, w.z - obstacle.z) >= obstacle.radius + 0.4 - 1e-8, 'robot entered a meadow obstacle');
}
check('arrows and physical WASD use the current first-person heading at 8.4 m/s', () => {
  for (const [code, expected] of Object.entries({ ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' })) assert.equal(walkDirection(code), expected);
  assert.equal(walkDirection('KeyP'), undefined);
  const right = walk('right'); assert(right.x < 0); assert.equal(right.z, 70);
  const down = walk('down'); assert.equal(down.x, 0); assert(down.z < 70);
  const up = walk('up'); assert.equal(up.x, 0); assert(up.z > 70);
  const left = walk('left'); assert(left.x > 0); assert.equal(left.z, 70);
  assert(Math.abs(Math.hypot(right.x, right.z - 70) - 8.4) < 1e-8);
  const east = walk('up', 1000, Math.PI / 2); assert(Math.abs(east.x - 8.4) < 1e-8); assert.equal(east.z, 70);
});
check('diagonals do not move faster and opposing keys cancel', () => {
  const w = new CourtyardWalk(); w.x = 0; w.z = 70;
  advance(w, 0, ['up', 'right']);
  assert(Math.abs(Math.hypot(w.x, w.z - 70) - 8.4) < 1e-8);
  w.stop(); w.setInput('a', 'left'); w.setInput('b', 'right');
  assert.equal(w.update(20), false);
});
check('sprinting doubles speed to 16.8 m/s without speeding up diagonals', () => {
  for (const directions of [['up'], ['up', 'right']]) {
    const w = new CourtyardWalk(); w.x = 0; w.z = 70;
    directions.forEach((direction, index) => w.setInput(`move-${index}`, direction));
    w.setSprint('ShiftLeft', true);
    for (let frame = 0; frame < 100; frame++) w.update(10, 0);
    assert(Math.abs(Math.hypot(w.x, w.z - 70) - 16.8) < 1e-8);
    w.setSprint('ShiftLeft', false);
    const start = [w.x, w.z];
    for (let frame = 0; frame < 100; frame++) w.update(10, 0);
    assert(Math.abs(Math.hypot(w.x - start[0], w.z - start[1]) - 8.4) < 1e-8);
  }
});
check('each Shift source owns its release and sprint alone does not move', () => {
  const w = new CourtyardWalk(); w.x = 0; w.z = 70;
  assert.equal(w.sprinting, false);
  w.setSprint('ShiftLeft', true); w.setSprint('ShiftRight', true);
  w.setSprint('ShiftLeft', true); // Key repeat must not require extra releases.
  assert.equal(w.update(50), false);
  w.setSprint('ShiftLeft', false); assert.equal(w.sprinting, true);
  w.setInput('KeyW', 'up'); w.update(50, 0);
  assert(Math.abs(w.z - 70 - 0.84) < 1e-8);
  w.setSprint('ShiftRight', false); assert.equal(w.sprinting, false);
  w.update(50, 0); assert(Math.abs(w.z - 70 - 1.26) < 1e-8);
});
check('standing jumps rise naturally, reject double jumps, land exactly and stay landed', () => {
  const w = new CourtyardWalk(); w.x = 0; w.z = 70;
  assert.equal(w.y, 0); assert.equal(w.jump(), true);
  assert.equal(w.jump(), false, 'a second press before the first frame must not restart takeoff');
  let highest = 0;
  for (let frame = 0; frame < 65; frame++) {
    assert.equal(w.update(10, 0), true, 'vertical motion alone must update the camera');
    highest = Math.max(highest, w.y);
    assert(w.y >= 0);
    if (frame < 63) assert.equal(w.jump(), false, 'airborne presses must not restart or queue a jump');
  }
  assert(Math.abs(highest - 5.8 * 5.8 / (2 * 18)) < 0.001);
  assert.equal(w.y, 0); assert.deepEqual([w.x, w.z], [0, 70]);
  for (let frame = 0; frame < 100; frame++) assert.equal(w.update(10, 0), false);
  assert.equal(w.y, 0); assert.equal(w.jump(), true, 'a new press after landing starts the next jump');
});
check('moving jumps retain walking or sprint speed and are consistent across frame rates', () => {
  for (const sprint of [false, true]) {
    const positions = [];
    for (const delta of [5, 10, 20, 50]) {
      const w = new CourtyardWalk(); w.x = 0; w.z = 70;
      w.setInput('KeyW', 'up'); w.setSprint('ShiftLeft', sprint); w.jump();
      for (let time = 0; time < 500; time += delta) assert.equal(w.update(delta, 0), true);
      assert(Math.abs(w.y - (5.8 * 0.5 - 18 * 0.5 * 0.5 / 2)) < 1e-10);
      assert(Math.abs(w.z - 70 - (sprint ? 16.8 : 8.4) * 0.5) < 1e-8);
      positions.push([w.x, w.y, w.z]);
      for (let time = 500; time < 1000; time += delta) w.update(delta, 0);
      assert.equal(w.y, 0);
      assert(Math.abs(w.z - 70 - (sprint ? 16.8 : 8.4)) < 1e-8);
    }
    for (const position of positions) {
      for (let axis = 0; axis < 3; axis++) assert(Math.abs(position[axis] - positions[0][axis]) < 1e-8);
    }
  }
});
check('stop and every placement clear movement, sprint and vertical momentum', () => {
  for (const reset of [(w) => w.stop(), (w) => w.place(), (w) => w.place(layout.stations[0].id), (w) => w.placeRoom('piano')]) {
    const w = new CourtyardWalk(); w.x = 0; w.z = 70;
    w.setInput('KeyW', 'up'); w.setSprint('ShiftLeft', true); w.setSprint('ShiftRight', true);
    w.jump(); w.update(50, 0); assert(w.y > 0);
    reset(w);
    assert.equal(w.y, 0); assert.equal(w.sprinting, false); assert.equal(w.held.size, 0);
    assert.equal(w.update(50, 0), false);
    assert.equal(w.jump(), true, 'reset must clear the old vertical velocity');
    w.update(50, 0); assert(Math.abs(w.y - 0.2675) < 1e-10);
  }
});
check('keyboard and pointer ownership are independent; cancel clears held input', () => {
  const w = new CourtyardWalk(); w.x = 0; w.z = 70;
  w.setInput('ArrowRight', 'right'); w.setInput('pointer-1', 'right'); w.setInput('pointer-1', null);
  assert.equal(w.update(10), true); w.stop(); assert.equal(w.update(50), false);
  assert.equal(w.held.size, 0);
});
check('long frames are clamped; invalid deltas cannot corrupt position', () => {
  const w = walk('right', 0); w.update(10000);
  assert(Math.abs(Math.hypot(w.x, w.z - 70) - 0.42) < 1e-8);
  for (const delta of [NaN, Infinity, -Infinity, -10, 0]) assert.equal(w.update(delta), false);
  assert(Number.isFinite(w.x) && Number.isFinite(w.z));
  w.stop(); w.setInput('KeyW', 'up'); w.setSprint('ShiftLeft', true); w.jump();
  const before = [w.x, w.y, w.z];
  for (const delta of [NaN, Infinity, -Infinity, -10, 0]) assert.equal(w.update(delta, 0), false);
  for (const heading of [NaN, Infinity, -Infinity]) assert.equal(w.update(20, heading), false);
  assert.deepEqual([w.x, w.y, w.z], before);
  w.update(10000, 0);
  assert(Math.abs(w.z - before[2] - 0.84) < 1e-8);
  assert(Math.abs(w.y - 0.2675) < 1e-10, 'gravity must use the same clamped frame as horizontal movement');
});
check('the meadow has no movement boundary in any direction', () => {
  for (const [heading, axis, sign] of [[Math.PI / 2, 'x', 1], [-Math.PI / 2, 'x', -1], [0, 'z', 1], [Math.PI, 'z', -1]]) {
    const w = new CourtyardWalk(); w.x = sign * 10000; w.z = sign * 10000;
    const start = w[axis];
    advance(w, heading, ['up'], 20000);
    assert(Math.abs((w[axis] - start) * sign - 168) < 1e-6);
  }
});
check('all four meadow quadrants connect by walking around the house', () => {
  // A full perimeter tour exercises heading and quadrant transitions independently
  // of each room's spawn and of the intentional routes between nearby exhibits.
  const w = new CourtyardWalk(); w.x = 80; w.z = 80;
  for (const [x, z, room] of [[-80, 80, 'ai'], [-80, -80, 'blog'], [80, -80, 'piano'], [80, 80, 'developer']]) {
    walkTo(w, x, z);
    assert.equal(w.getRoom(), room);
  }
});
check('the house is solid from every face and its corners', () => {
  for (const [x, z] of [[8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [-8, -8], [8, -8], [-8, 8]]) {
    const w = new CourtyardWalk(); w.x = x; w.z = z;
    advance(w, Math.atan2(-x, -z), ['up'], 5000, assertClear);
  }
  const w = new CourtyardWalk(); w.x = 6.02; w.z = 0;
  advance(w, -Math.PI / 4, ['up'], 1000, assertClear);
  assert.equal(w.x, 6.02); assert(w.z > 3.9, 'robot should slide along the wall');
});
check('every freestanding screen remains solid during sustained approach', () => {
  for (const station of layout.stations) {
    const w = new CourtyardWalk(); w.place(station.id);
    advance(w, station.yaw + Math.PI, ['up'], 3000, assertClear);
  }
});
check('optional circular obstacles include the robot radius', () => {
  const obstacle = { x: 0, z: 100, radius: 1.2 };
  layout.obstacles.push(obstacle);
  try {
    const w = new CourtyardWalk(); w.x = 4; w.z = 100;
    advance(w, -Math.PI / 2, ['up'], 3000, () => assert(Math.hypot(w.x, w.z - 100) >= 1.6 - 1e-8));
    assert(w.x < 1.7 && w.x >= 1.6);
  } finally { layout.obstacles.pop(); }
});
check('sprint collision substeps block grazing obstacles even during a jump', () => {
  const obstacle = { x: 0, z: 100, radius: 1.2 };
  layout.obstacles.push(obstacle);
  try {
    const w = new CourtyardWalk(); w.x = -0.42; w.z = 101.57;
    // Both endpoints of a full 0.84m sprint frame are clear, but its path crosses
    // the obstacle. Checking only the frame endpoint would tunnel through it.
    assert(Math.hypot(0.42, 1.57) > 1.6); assertClear(w);
    w.setInput('KeyW', 'up'); w.setSprint('ShiftLeft', true); w.jump();
    w.update(50, Math.PI / 2); assertClear(w);
    assert(w.x < 0, 'a sprint frame must stop on the entry side of a grazing obstacle');
    assert(w.y > 0, 'airborne movement still collides horizontally');
  } finally { layout.obstacles.pop(); }
});
check('sprinting preserves house wall sliding and solid screens while airborne', () => {
  const wall = new CourtyardWalk(); wall.x = 6.02; wall.z = 0;
  wall.setInput('KeyW', 'up'); wall.setSprint('ShiftRight', true); wall.jump();
  for (let frame = 0; frame < 6; frame++) { wall.update(50, -Math.PI / 4); assertClear(wall); }
  assert.equal(wall.x, 6.02); assert(wall.z > 3.5);
  for (const station of layout.stations) {
    const w = new CourtyardWalk(); w.place(station.id);
    w.setInput('KeyW', 'up'); w.setSprint('ShiftLeft', true); w.jump();
    for (let frame = 0; frame < 30; frame++) { w.update(50, station.yaw + Math.PI); assertClear(w); }
    assert.equal(w.y, 0);
  }
});
check('each map destination places the robot in front of its own screen', () => {
  const w = new CourtyardWalk();
  for (const station of layout.stations) {
    w.setInput('stale-key', 'up'); w.place(station.id);
    assert.equal(w.nearest(), station.id); assert.equal(w.held.size, 0);
    assert(Math.abs(w.x - station.x - Math.sin(station.yaw) * 2.7) < 1e-8);
    assert(Math.abs(w.z - station.z - Math.cos(station.yaw) * 2.7) < 1e-8);
    assert.equal(w.getRoom(), station.room); assertClear(w);
  }
  w.place(); assert.equal(w.nearest(), null);
  assert.deepEqual([w.x, w.z], layout.entrance);
});
check('room entrances preserve quadrant identity and clear movement', () => {
  const w = new CourtyardWalk();
  for (const quadrant of layout.quadrants) {
    w.setInput('pointer-1', 'left'); w.placeRoom(quadrant.room);
    assert.deepEqual([w.x, w.z], quadrant.spawn);
    assert.equal(w.getRoom(), quadrant.room); assert.equal(w.held.size, 0); assertClear(w);
  }
});
check('the coffee panel remains reachable on foot from its room entrance', () => {
  const station = layout.stations.find((entry) => entry.exhibitionId === 'coffee');
  const w = new CourtyardWalk(); w.placeRoom(station.room);
  walkTo(w, station.x + Math.sin(station.yaw) * 2.7, station.z + Math.cos(station.yaw) * 2.7);
  assert.equal(w.nearest(), station.id);
});
check('proximity picks the nearest screen and hysteresis prevents edge flicker', () => {
  const w = new CourtyardWalk(); const s = layout.stations[0];
  // Use the outer side so no neighbouring screen is in range.
  w.x = s.x; w.z = s.z - 3.4;
  assert.equal(w.nearest(), s.id);
  w.z = s.z - 3.6;
  assert.equal(w.nearest(s.id), s.id); assert.equal(w.nearest(), null);
  w.z = s.z - 3.81; assert.equal(w.nearest(s.id), null);
  const next = layout.stations[1]; w.x = next.x - 2.8; w.z = next.z;
  assert.equal(w.nearest(), next.id);
});
check('all 13 panels reference exactly one current entry in their own quadrant', () => {
  assert.equal(layout.stations.length, 13);
  assert.equal(new Set(layout.stations.map((s) => s.id)).size, layout.stations.length);
  const counts = { developer: 0, piano: 0, blog: 0, ai: 0 };
  const references = new Set();
  const expectedRoom = { coffee: 'developer', piano: 'piano', writing: 'blog', guestbook: 'ai' };
  assert.deepEqual(Array.from(EXHIBITIONS, (e) => e.id), Object.keys(expectedRoom), 'only the personal space and support panels belong in this tour');
  for (const station of layout.stations) {
    const exhibition = EXHIBITIONS.find((e) => e.id === station.exhibitionId);
    assert(exhibition, `missing exhibition for ${station.id}`);
    const entry = exhibition.entries[station.entryIndex];
    assert(entry, `missing entry for ${station.id}`);
    assert.equal(station.id, `${exhibition.id}--${entry.id}`);
    assert.equal(station.room, expectedRoom[exhibition.id]);
    assert.equal(station.shape, entry.objectKind);
    assert.equal(references.has(station.id), false); references.add(station.id);
    counts[station.room]++;
    const w = new CourtyardWalk(); w.x = station.x; w.z = station.z;
    assert.equal(w.getRoom(), station.room);
  }
  assert.deepEqual(counts, { developer: 1, piano: 5, blog: 6, ai: 1 });
  assert.equal(EXHIBITIONS.reduce((sum, e) => sum + e.entries.length, 0), references.size);
});
check('the personal tour removes technical articles, diagrams and the former work route', () => {
  assert.equal(Object.hasOwn(layout, 'workRoute'), false);
  assert.doesNotMatch(JSON.stringify({ layout, EXHIBITIONS }), /work--|doeat-|prov2vec|maskedgae|maksedgae|Engineeer Experience|technicalSections|technicalSources|\/diagrams\/engineer/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../public/diagrams/engineer')), false);
});
check('the coffee panel keeps its explicitly configured support profile', () => {
  const coffee = EXHIBITIONS.find((e) => e.id === 'coffee');
  assert.equal(coffee.entries.length, 1);
  const entry = coffee.entries[0];
  assert.equal(entry.kind, 'coffee'); assert.equal(entry.objectKind, 'coffee');
  assert(entry.title && entry.actionLabel);
  assert.equal(coffee.entries[0].actionUrl, PROFILE.buyMeACoffeeUrl);
  if (PROFILE.buyMeACoffeeUrl !== null) {
    const url = new URL(PROFILE.buyMeACoffeeUrl);
    assert.equal(url.protocol, 'https:');
    assert(['buymeacoffee.com', 'www.buymeacoffee.com'].includes(url.hostname));
    assert.match(url.pathname, /^\/[A-Za-z0-9][A-Za-z0-9._-]*\/?$/, 'coffee link must name the configured recipient, never the generic homepage');
    assert.equal(url.username + url.password + url.port + url.search + url.hash, '');
  }
});
check('five played piano works have composers, descriptions, reference performers and safe YouTube videos', () => {
  const entries = EXHIBITIONS.find((e) => e.id === 'piano').entries;
  assert.deepEqual(Array.from(entries, (entry) => entry.id), ['en-avril', 'pathetique', 'last-rag', 'graceful-ghost', 'traumerei']);
  for (const entry of entries) {
    assert(entry.composer && entry.performer && entry.videoTitle && entry.title && entry.text);
    assert.equal(entry.paragraphs.length, 1);
    assert.equal(entry.paragraphs[0], entry.text);
    assert.doesNotMatch(JSON.stringify(entry), /[가-힣]|sheet music|score description/i);
    assert.match(entry.youtubeId, /^[A-Za-z0-9_-]{11}$/);
    const video = new URL(entry.youtubeUrl);
    assert.equal(video.protocol, 'https:'); assert.equal(video.hostname, 'www.youtube.com');
    assert.equal(video.pathname, '/watch'); assert.equal(video.searchParams.get('v'), entry.youtubeId);
    assert.equal(entry.url, undefined, 'publisher and score links are no longer part of the personal notes');
  }
});
check('writing contains only six exchange/reflection posts, grouped by story year with two year markers', () => {
  const entries = EXHIBITIONS.find((e) => e.id === 'writing').entries;
  assert.deepEqual(Array.from(entries, (entry) => entry.id), ['exchange-student-1', 'exchange-student-2', 'exchange-student-3', '2025-1', '2025-2', '2025-3']);
  assert.deepEqual(Array.from(entries, (entry) => entry.year), ['2023', '2023', '2023', '2025', '2025', '2025']);
  let previous = '';
  for (const entry of entries) {
    const url = new URL(entry.url); assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'blog.bbangjo.kr');
    assert.equal(url.pathname, `/${entry.id}`); assert(entry.title && entry.text);
    assert(entry.date >= previous); previous = entry.date;
    assert.equal(layout.stations.find((station) => station.id === `writing--${entry.id}`).year, entry.year);
  }
  assert.deepEqual(layout.yearMarkers.map((marker) => marker.year), ['2023', '2025']);
  for (const marker of layout.yearMarkers) {
    assert.equal(marker.room, 'blog'); assert(marker.x < 0 && marker.z < 0);
    assert(layout.obstacles.some((obstacle) => obstacle.x === marker.x && obstacle.z === marker.z));
  }
  // Group by the year being remembered, even when the reflection was published later.
  assert(entries.filter((entry) => entry.year === '2025').every((entry) => entry.date.startsWith('2026')));
});
check('all six blog articles are immediately readable from complete, sanitized local HTML', () => {
  const entries = EXHIBITIONS.find((e) => e.id === 'writing').entries;
  const expectedParagraphs = [32, 40, 2, 7, 11, 8];
  const expectedImages = [7, 11, 1, 3, 0, 0];
  for (const [index, entry] of entries.entries()) {
    assert.equal(typeof entry.articleHtml, 'string');
    const html = entry.articleHtml;
    assert(html.replace(/<[^>]*>/g, '').trim().length >= 800, `missing full article: ${entry.id}`);
    assert.equal((html.match(/<p>/g) || []).length, expectedParagraphs[index]);
    assert.equal((html.match(/<img\s/g) || []).length, expectedImages[index]);
    assert.doesNotMatch(html, /<(?:script|iframe|style|svg|form|object|embed)\b/i);
    assert.doesNotMatch(html, /\s(?:on[a-z]+|style|srcset|id)\s*=/i);
    assert.doesNotMatch(html, /(?:href|src)=["']\s*(?:javascript|data):/i);
    assert.equal(entry.sourceLabel, 'Original post');
  }
  // Use the same strict HTML parser as the authoring sync, without network access.
  const validation = spawnSync('python3', [path.join(__dirname, 'sync-blog-articles.py'), '--check'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.error?.message || validation.stdout);
});
check('the game meadow contains only the minimal guestbook and no Star exhibit', () => {
  const exhibition = EXHIBITIONS.find((e) => e.id === 'guestbook');
  assert.equal(exhibition.title, 'Guestbook'); assert.equal(exhibition.introduction, '');
  const entries = exhibition.entries;
  assert.equal(entries.length, 1); assert.equal(entries[0].kind, 'guestbook'); assert.equal(entries[0].objectKind, 'guestbook');
  assert.equal(entries[0].title, 'Guestbook'); assert.equal(entries[0].text, '');
  const station = layout.stations.filter((entry) => entry.exhibitionId === 'guestbook');
  assert.equal(station.length, 1); assert.equal(station[0].exhibitionId, 'guestbook');
  assert.equal(station[0].room, 'ai');
  assert.deepEqual(layout.stations.filter((entry) => entry.room === 'ai').map((entry) => entry.exhibitionId), ['guestbook']);
  assert.equal(layout.quadrants.find((quadrant) => quadrant.room === 'ai').name, 'Guestbook');
  assert.equal(EXHIBITIONS.some((item) => item.id === 'star' || item.entries.some((entry) => entry.kind === 'star')), false);
  assert.equal(layout.stations.some((entry) => entry.exhibitionId === 'star' || entry.shape === 'star' || entry.id.startsWith('star--')), false);
});
check('all objects keep 5.5m clearance; piano and blog retain their scattered layout', () => {
  for (let index = 0; index < layout.stations.length; index++) {
    const station = layout.stations[index];
    assert([station.x, station.z, station.yaw].every(Number.isFinite));
    for (const other of layout.stations.slice(index + 1)) {
      assert(Math.hypot(station.x - other.x, station.z - other.z) >= 5.5, `${station.id} too close to ${other.id}`);
    }
  }
  for (const quadrant of layout.quadrants) {
    if (!['piano', 'blog'].includes(quadrant.room)) continue;
    const stations = layout.stations.filter((station) => station.room === quadrant.room);
    assert.equal(new Set(stations.map((station) => station.z)).size, stations.length, `${quadrant.room} repeats a row`);
    if (stations.length > 2) assert(new Set(stations.map((station) => station.x)).size > 2, `${quadrant.room} remains a grid`);
  }
});
if (failures) process.exit(1);
console.log('All courtyard checks passed');
