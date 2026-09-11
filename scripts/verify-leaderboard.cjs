/* Run against isolated temporary stores and ephemeral servers, never visitor data. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { createServer, request: httpRequest } = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

async function main() {
  const { TRACK, createOriginalChart } = await import('../src/design/rhythm-game.ts');
  const { createLeaderboardMiddleware, createLeaderboardStore, compareLeaderboardEntries, leaderboardPlugin } = await import('../server/leaderboard-store.mjs');
  const totalNotes = createOriginalChart().length;
  const directory = await mkdtemp(join(tmpdir(), 'buffalo-leaderboard-'));
  const filePath = join(directory, 'data', 'leaderboard.json');
  let server, baseURL;
  const run = (overrides = {}) => ({
    runId: randomUUID(), name: 'Player', trackId: TRACK.id,
    perfect: 20, great: 10, good: 10, misses: totalNotes - 40, maxCombo: 20, ...overrides,
  });
  async function start(options = {}) {
    const middleware = createLeaderboardMiddleware({ filePath, rateLimitMs: 0, ...options });
    server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server) return;
    const closing = server; server = undefined;
    await new Promise((resolve) => closing.close(resolve));
  }
  async function api(input, options = {}) {
    const init = input === undefined ? options : {
      ...options, method: options.method || 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', ...options.headers },
      body: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input),
    };
    const response = await fetch(`${baseURL}/api/leaderboard`, init);
    return { status: response.status, headers: response.headers, document: await response.json() };
  }

  try {
    await start();
    const empty = await api();
    assert.deepEqual(empty.document, { entries: [] });
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    const submitted = run({ name: '  한 줄\n\t이름 ', score: 1_000_000, accuracy: 100 });
    const first = await api(submitted);
    assert.equal(first.status, 201);
    assert.equal(first.document.entry.name, '한 줄 이름');
    assert.equal(first.document.entry.score, Math.round(32.5 / totalNotes * 1_000_000));
    assert.equal(first.document.entry.accuracy, Math.round(32.5 / totalNotes * 10_000) / 100);
    assert.equal(first.document.entry.totalNotes, totalNotes);
    assert.equal(first.document.saved, true); assert.equal(first.document.rank, 1); assert.equal(first.document.duplicate, false);
    const retry = await api(submitted);
    assert.equal(retry.status, 200); assert.equal(retry.document.duplicate, true);
    assert.deepEqual(retry.document.entry, first.document.entry);
    assert.equal((await api({ ...submitted, name: 'Changed' })).status, 409);
    assert.equal((await api({ ...submitted, maxCombo: 21 })).status, 409);
    assert.equal((await api()).document.entries.length, 1);
    await stop(); await start();
    assert.deepEqual((await api()).document.entries[0], first.document.entry);
    assert.equal((await api(submitted)).status, 200, 'retained retry is idempotent after server restart');

    const legacyFile = join(directory, 'legacy-track.json');
    const legacyEntry = { ...first.document.entry, id: randomUUID(), runId: randomUUID(), trackId: 'beethoven-virus-original-eight-key-v1' };
    await writeFile(legacyFile, JSON.stringify({ version: 1, entries: [legacyEntry] }));
    const mixedTracks = createLeaderboardStore(legacyFile);
    assert.deepEqual(await mixedTracks.list(), [], 'old eight-key results never appear in the current four-key table');
    const currentResult = await mixedTracks.add(run());
    assert.equal(currentResult.entry.trackId, TRACK.id);
    assert.equal((await mixedTracks.list()).length, 1);
    assert.deepEqual(JSON.parse(await readFile(legacyFile, 'utf8')).entries.find((entry) => entry.id === legacyEntry.id), legacyEntry,
      'saving a four-key run preserves stored historical-track entries exactly');

    const parallel = await Promise.all(Array.from({ length: 24 }, () => api(run())));
    assert(parallel.every((result) => result.status === 201));
    const entries = (await api()).document.entries;
    assert.equal(entries.length, 25, 'queued writes keep distinct runs even with the same name');
    assert.equal(new Set(entries.map((entry) => entry.runId)).size, 25);
    const concurrentInput = run();
    const concurrentRetries = await Promise.all(Array.from({ length: 8 }, () => api(concurrentInput)));
    assert.equal(concurrentRetries.filter((result) => result.status === 201).length, 1);
    assert.equal(concurrentRetries.filter((result) => result.status === 200).length, 7);
    assert.equal(new Set(concurrentRetries.map((result) => result.document.entry.id)).size, 1);

    assert.equal((await api(run({ name: '😀'.repeat(24) }))).status, 201);
    const invalid = [
      { name: '' }, { name: '  ' }, { name: '😀'.repeat(25) }, { name: 3 },
      { runId: 'not-a-uuid' }, { trackId: 'unknown-track' }, { perfect: -1 }, { good: 1.5 },
      { great: '10' }, { misses: totalNotes }, { maxCombo: 41 }, { maxCombo: 0 },
      { perfect: totalNotes, great: 0, good: 0, misses: 0, maxCombo: totalNotes - 1 },
    ];
    for (const fields of invalid) assert.equal((await api(run(fields))).status, 400, JSON.stringify(fields));
    for (const input of ['[]', '{bad JSON', '{}', Buffer.from([0xc0, 0x80])]) assert.equal((await api(input)).status, 400);
    assert.equal((await api(run(), { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await api('x'.repeat(4097))).status, 413);
    const chunkedStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${baseURL}/api/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.write('x'.repeat(2100)); request.end('x'.repeat(2100));
    });
    assert.equal(chunkedStatus, 413);
    assert.equal((await api(undefined, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(`${baseURL}/unrelated`)).status, 404);
    assert.equal((await api(run(), { headers: { origin: 'https://elsewhere.example' } })).status, 403);
    assert.equal((await api(run(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await api(run(), { headers: { origin: baseURL } })).status, 201);
    assert.equal((await api()).headers.get('access-control-allow-origin'), null);

    // Comparator contract: descending score, accuracy, combo; earlier timestamp/id.
    const tie = { score: 100, accuracy: 99, maxCombo: 5, createdAt: '2026-01-02T00:00:00.000Z', id: 'b' };
    assert(compareLeaderboardEntries({ ...tie, score: 101 }, tie) < 0);
    assert(compareLeaderboardEntries({ ...tie, accuracy: 99.1 }, tie) < 0);
    assert(compareLeaderboardEntries({ ...tie, maxCombo: 6 }, tie) < 0);
    assert(compareLeaderboardEntries({ ...tie, createdAt: '2026-01-01T00:00:00.000Z' }, tie) < 0);
    assert(compareLeaderboardEntries({ ...tie, id: 'a' }, tie) < 0);

    const capFile = join(directory, 'capped.json');
    const cap = createLeaderboardStore(capFile);
    for (let index = 1; index <= 200; index++) {
      const perfect = Math.min(index, totalNotes - 1);
      const item = await cap.add(run({ perfect, great: 0, good: 0, misses: totalNotes - perfect, maxCombo: perfect }));
      assert.equal(item.saved, true);
    }
    assert.equal((await cap.list()).length, 200);
    const rejected = run({ perfect: 0, great: 0, good: 0, misses: totalNotes, maxCombo: 0 });
    const beforeCap = await readFile(capFile, 'utf8');
    assert.deepEqual(await cap.add(rejected), { entry: null, rank: 201, saved: false, duplicate: false });
    assert.equal(await readFile(capFile, 'utf8'), beforeCap, 'unranked runs do not create hidden history');
    const lowest = (await cap.list()).at(-1);
    const top = await cap.add(run({ perfect: totalNotes, great: 0, good: 0, misses: 0, maxCombo: totalNotes }));
    assert.equal(top.rank, 1); assert.equal(top.entry.score, 1_000_000);
    assert.equal((await cap.list()).length, 200); assert(!(await cap.list()).some((entry) => entry.id === lowest.id));
    const evictedRetry = await cap.add(lowest);
    assert.equal(evictedRetry.saved, false); assert.equal(evictedRetry.entry, null); assert.equal(evictedRetry.rank, 201);
    const capDocument = JSON.parse(await readFile(capFile, 'utf8'));
    assert.deepEqual(Object.keys(capDocument).sort(), ['entries', 'version']);
    assert.equal(capDocument.entries.length, 200);

    await stop(); await start({ filePath: join(directory, 'limited.json'), rateLimitMs: 2000 });
    const limitedInput = run(); assert.equal((await api(limitedInput)).status, 201);
    assert.equal((await api(limitedInput)).status, 200, 'same run retries bypass rate limit');
    assert.equal((await api({ ...limitedInput, name: 'Changed' })).status, 409);
    const limited = await api(run());
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '2');
    await stop(); await start({ filePath: join(directory, 'limited-concurrent.json'), rateLimitMs: 2000 });
    const limitedParallel = await Promise.all([api(run()), api(run())]);
    assert.deepEqual(limitedParallel.map((result) => result.status).sort(), [201, 429]);

    await stop();
    const corruptFile = join(directory, 'corrupt.json');
    await writeFile(corruptFile, 'broken JSON'); await start({ filePath: corruptFile });
    assert.equal((await api()).status, 503);
    const failure = await api(run()); assert.equal(failure.status, 503);
    assert(!failure.document.error.includes(directory));
    assert.equal(await readFile(corruptFile, 'utf8'), 'broken JSON');
    await stop();
    const corruptDocument = { version: 1, entries: [{ ...first.document.entry, score: 1_000_000 }] };
    await writeFile(corruptFile, JSON.stringify(corruptDocument)); await start({ filePath: corruptFile });
    assert.equal((await api(run())).status, 503, 'stored score corruption is not an input error or silently replaced');
    assert.deepEqual(JSON.parse(await readFile(corruptFile, 'utf8')), corruptDocument);

    await stop();
    const locked = join(directory, 'read-only'); await mkdir(locked); await chmod(locked, 0o500);
    try {
      await start({ filePath: join(locked, 'leaderboard.json') });
      assert.equal((await api(run())).status, 503, 'failed durable write cannot claim a saved score');
    } finally { await stop(); await chmod(locked, 0o700); }

    // Both real Vite hooks, without the shared app, dist, or its local data.
    const vite = await import('vite');
    const viteFile = join(directory, 'vite-leaderboard.json');
    const dev = await vite.createServer({ configFile: false, root: directory, logLevel: 'silent', plugins: [leaderboardPlugin({ filePath: viteFile, rateLimitMs: 0 })], server: { host: '127.0.0.1', port: 0 } });
    const viteInput = run({ name: 'Vite player' });
    try {
      await dev.listen();
      const url = `http://127.0.0.1:${dev.httpServer.address().port}/api/leaderboard`;
      assert.deepEqual(await (await fetch(url)).json(), { entries: [] });
      const posted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(viteInput) });
      assert.equal(posted.status, 201);
    } finally { await dev.close(); }
    await mkdir(join(directory, 'preview'));
    await writeFile(join(directory, 'preview', 'index.html'), '<!doctype html><title>Leaderboard verification</title>');
    const preview = await vite.preview({ configFile: false, root: directory, logLevel: 'silent', build: { outDir: 'preview' }, plugins: [leaderboardPlugin({ filePath: viteFile, rateLimitMs: 0 })], preview: { host: '127.0.0.1', port: 0 } });
    try {
      const url = `http://127.0.0.1:${preview.httpServer.address().port}/api/leaderboard`;
      assert.equal((await (await fetch(url)).json()).entries[0].name, 'Vite player');
      const retryResponse = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(viteInput) });
      assert.equal(retryResponse.status, 200);
      const posted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run({ name: 'Preview player' })) });
      assert.equal(posted.status, 201);
    } finally { await new Promise((resolve) => preview.httpServer.close(resolve)); }
    console.log(`Leaderboard verified: ${totalNotes}-note score derivation, validation, stable ties, retained UUID retries/conflicts, concurrent writes, bounded top200, restart, same-origin, rate/body limits, honest storage errors, and Vite dev/preview. All data stayed in temporary directories.`);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
