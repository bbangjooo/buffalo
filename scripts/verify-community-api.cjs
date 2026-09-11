/* Production contracts with in-memory CAS documents only: no Blob or local data IO. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { Readable } = require('node:stream');

const clone = (value) => structuredClone(value);

function documentFixture(empty) {
  let document, version = 0;
  const stats = { reads: 0, writes: 0, retries: 0, proposals: [] };
  return {
    stats,
    stored: () => document && clone(document),
    read: async () => { stats.reads++; return clone(document || empty()); },
    update: async (mutator) => {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const before = version;
        const mutation = mutator(clone(document || empty()));
        if (mutation.result.entry) stats.proposals.push(clone(mutation.result.entry));
        await Promise.resolve(); // Competing request mutators see the same version.
        if (before !== version) { stats.retries++; continue; }
        if (mutation.document) { document = clone(mutation.document); version++; stats.writes++; }
        return clone(mutation.result);
      }
      throw new Error('Fixture CAS retries exhausted');
    },
  };
}

function requestFixture(body, options = {}) {
  const request = Readable.from([]);
  request.method = options.method || (body === undefined ? 'GET' : 'POST');
  request.headers = {
    host: 'portfolio.example', origin: 'https://portfolio.example',
    'content-type': 'application/json', ...options.headers,
  };
  request.socket = { encrypted: false, remoteAddress: '127.0.0.1' };
  if (body !== undefined) request.body = body;
  return request;
}

function responseFixture() {
  return {
    status: null, headers: {}, writableEnded: false, destroyed: false, document: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; Object.entries(headers).forEach(([key, value]) => this.setHeader(key, value)); },
    end(body) { this.document = JSON.parse(body); this.writableEnded = true; },
  };
}

async function main() {
  const { TRACK, createOriginalChart } = await import('../src/design/rhythm-game.ts');
  const { createCommunityStores } = await import('../server/community-stores.mjs');
  const { createCommunityHandler } = await import('../server/community-http.mjs');
  const totalNotes = createOriginalChart().length;
  const run = (overrides = {}) => ({
    runId: randomUUID(), name: 'Player', trackId: TRACK.id,
    perfect: 20, great: 10, good: 10, misses: totalNotes - 40, maxCombo: 20, ...overrides,
  });
  function storesFixture(rateLimitMs = 0) {
    const guestbookDocument = documentFixture(() => ({ entries: [] }));
    const leaderboardDocument = documentFixture(() => ({ version: 1, entries: [] }));
    return { guestbookDocument, leaderboardDocument, stores: createCommunityStores({ guestbookDocument, leaderboardDocument, rateLimitMs }) };
  }
  async function invoke(handler, body, options) {
    const response = responseFixture();
    await handler(requestFixture(body, options), response);
    return response;
  }

  // Namespace selection can be checked without creating, reading, or uploading objects.
  const originalEnvironment = process.env.VERCEL_ENV;
  try {
    for (const [environment, prefix] of [['preview', 'community-preview'], ['production', 'community']]) {
      process.env.VERCEL_ENV = environment;
      const paths = [];
      createCommunityStores({ documentFactory(pathname, options) {
        paths.push(pathname); options.validate(options.empty()); return documentFixture(options.empty);
      } });
      assert.deepEqual(paths, [`${prefix}/guestbook.json`, `${prefix}/leaderboard.json`]);
    }
  } finally {
    if (originalEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnvironment;
  }

  const fixture = storesFixture();
  const guestbookHandler = createCommunityHandler({ store: fixture.stores.guestbook, kind: 'guestbook', production: true, rateLimitMs: 0 });
  const leaderboardHandler = createCommunityHandler({ store: fixture.stores.leaderboard, kind: 'leaderboard', production: true, rateLimitMs: 0 });
  const empty = await invoke(guestbookHandler);
  assert.equal(empty.status, 200); assert.deepEqual(empty.document, { entries: [] });
  assert.equal(empty.headers['cache-control'], 'no-store'); assert.equal(empty.headers['x-content-type-options'], 'nosniff');
  assert.equal(fixture.guestbookDocument.stats.writes, 0, 'GET never materializes an empty object');
  assert.equal((await invoke(leaderboardHandler)).status, 200);
  assert.equal(fixture.leaderboardDocument.stats.writes, 0);

  const submission = { submissionId: randomUUID(), author: '  Visitor  ', body: 'A\nsmall message' };
  const first = await invoke(guestbookHandler, submission);
  assert.equal(first.status, 201); assert.equal(first.document.entry.id, submission.submissionId);
  assert.equal(first.document.entry.author, 'Visitor'); assert.equal(first.document.entry.body, 'A small message');
  const retry = await invoke(guestbookHandler, submission);
  assert.equal(retry.status, 200); assert.equal(retry.document.duplicate, true); assert.deepEqual(retry.document.entry, first.document.entry);
  assert.equal((await invoke(guestbookHandler, { ...submission, body: 'Changed' })).status, 409);
  assert.equal((await invoke(guestbookHandler, { ...submission, submissionId: 'invalid' })).status, 400);
  assert.equal((await invoke(guestbookHandler, { author: 'Legacy client', body: 'No ID still works' })).status, 201);

  const parallelGuestbook = await Promise.all(Array.from({ length: 24 }, (_, index) => fixture.stores.guestbook.submit({
    submissionId: randomUUID(), author: `Visitor ${index}`, body: 'Parallel write',
  })));
  assert.equal((await fixture.stores.guestbook.list()).length, 26);
  assert.equal(new Set(parallelGuestbook.map((result) => result.entry.id)).size, 24);
  assert(fixture.guestbookDocument.stats.retries > 0, 'CAS reload path was exercised');
  const same = { submissionId: randomUUID(), author: 'Same run', body: 'Retried concurrently' };
  const simultaneousRetries = await Promise.all(Array.from({ length: 8 }, () => fixture.stores.guestbook.submit(same)));
  assert.equal(simultaneousRetries.filter((result) => !result.duplicate).length, 1);
  assert.equal(new Set(simultaneousRetries.map((result) => result.entry.id)).size, 1);
  assert.equal((await fixture.stores.guestbook.list()).length, 27);
  const conflictId = randomUUID();
  const conflicts = await Promise.allSettled(['First body', 'Second body'].map((body) => fixture.stores.guestbook.submit({ submissionId: conflictId, author: 'Conflict', body })));
  assert.equal(conflicts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(conflicts.find((result) => result.status === 'rejected').reason.status, 409);

  const parallelRuns = await Promise.all(Array.from({ length: 16 }, () => fixture.stores.leaderboard.submit(run())));
  assert.equal((await fixture.stores.leaderboard.list()).length, 16);
  assert(fixture.leaderboardDocument.stats.retries > 0);
  assert.equal(parallelRuns[0].entry.score, Math.round(32.5 / totalNotes * 1_000_000));
  const identities = new Map();
  for (const proposal of fixture.leaderboardDocument.stats.proposals) {
    const identity = `${proposal.id}/${proposal.createdAt}`;
    if (identities.has(proposal.runId)) assert.equal(identities.get(proposal.runId), identity, 'CAS retries preserve request identity/date');
    identities.set(proposal.runId, identity);
  }
  const scoreInput = run({ score: 1_000_000 });
  const scoreRetries = await Promise.all(Array.from({ length: 6 }, () => invoke(leaderboardHandler, scoreInput)));
  assert.equal(scoreRetries.filter((result) => result.status === 201).length, 1);
  assert.equal(scoreRetries.filter((result) => result.status === 200).length, 5);
  assert.equal(new Set(scoreRetries.map((result) => result.document.entry.id)).size, 1);
  assert.equal((await invoke(leaderboardHandler, { ...scoreInput, name: 'Changed' })).status, 409);
  assert.equal((await invoke(leaderboardHandler, run({ misses: 0 }))).status, 400);

  const cap = storesFixture();
  for (let index = 1; index <= 205; index++) {
    await cap.stores.guestbook.submit({ submissionId: randomUUID(), author: 'Visitor', body: String(index) });
    const perfect = Math.min(index, totalNotes - 1);
    await cap.stores.leaderboard.submit(run({ perfect, great: 0, good: 0, misses: totalNotes - perfect, maxCombo: perfect }));
  }
  assert.equal((await cap.stores.guestbook.list()).length, 200);
  assert.equal((await cap.stores.guestbook.list())[0].body, '205');
  assert.equal((await cap.stores.leaderboard.list()).length, 200);
  const beforeUnranked = cap.leaderboardDocument.stats.writes;
  assert.deepEqual(await cap.stores.leaderboard.submit(run({ perfect: 0, great: 0, good: 0, misses: totalNotes, maxCombo: 0 })), {
    entry: null, rank: 201, saved: false, duplicate: false,
  });
  assert.equal(cap.leaderboardDocument.stats.writes, beforeUnranked, 'unranked run is a write-free no-op');

  const limited = storesFixture(2000);
  const limitedHandler = createCommunityHandler({ store: limited.stores.guestbook, kind: 'guestbook', production: true });
  assert.equal((await invoke(limitedHandler, submission)).status, 201);
  assert.equal((await invoke(limitedHandler, submission)).status, 200, 'idempotent retry bypasses best-effort rate limit');
  const blocked = await invoke(limitedHandler, { ...submission, submissionId: randomUUID() });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers['retry-after'], '2');

  for (const headers of [
    { origin: 'https://elsewhere.example' }, { origin: 'http://portfolio.example' },
    { origin: 'https://portfolio.example/path' }, { origin: 'null' },
    { host: 'portfolio.example,elsewhere.example' }, { host: 'portfolio.example@elsewhere.example' },
    { origin: 'https://elsewhere.example', 'x-forwarded-host': 'elsewhere.example' },
    { 'sec-fetch-site': 'cross-site' },
  ]) assert.equal((await invoke(guestbookHandler, submission, { headers })).status, 403);
  assert.equal((await invoke(guestbookHandler, undefined, { method: 'DELETE' })).status, 405);
  assert.equal((await invoke(guestbookHandler, submission, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(guestbookHandler, { author: 'Visitor', body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await invoke(guestbookHandler, submission, { headers: { 'content-length': '4097' } })).status, 413);
  for (const body of [[], '{bad JSON', Buffer.from([0xc0, 0x80]), null]) assert.equal((await invoke(guestbookHandler, body)).status, 400);

  const broken = createCommunityHandler({ kind: 'guestbook', production: true, store: {
    list: async () => { throw new Error('secret token and private filesystem details'); },
    submit: async () => { throw new Error('secret token and private filesystem details'); },
  } });
  for (const body of [undefined, submission]) {
    const response = await invoke(broken, body); assert.equal(response.status, 503);
    assert(!JSON.stringify(response.document).includes('secret'));
  }
  const corrupt = createCommunityStores({
    guestbookDocument: { read: async () => ({ entries: [{}] }) }, leaderboardDocument: fixture.leaderboardDocument,
  });
  assert.equal((await invoke(createCommunityHandler({ store: corrupt.guestbook, kind: 'guestbook', production: true }))).status, 503);

  let finishWrite;
  const writeGate = new Promise((resolve) => { finishWrite = resolve; });
  const awaitedHandler = createCommunityHandler({ kind: 'guestbook', production: true, store: {
    list: async () => [], submit: async () => { await writeGate; return { entry: first.document.entry, duplicate: false }; },
  } });
  const pendingResponse = responseFixture();
  const pending = awaitedHandler(requestFixture(submission), pendingResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingResponse.writableEnded, false, 'Function must not return success before storage completes');
  finishWrite(); await pending; assert.equal(pendingResponse.status, 201);

  // Raw streamed Node requests use the same awaited handler as auto-parsed Functions.
  const server = createServer((request, response) => { void guestbookHandler(request, response); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const host = `127.0.0.1:${server.address().port}`;
    const response = await fetch(`http://${host}/api/guestbook`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${host}` },
      body: JSON.stringify({ submissionId: randomUUID(), author: 'Proxy visitor', body: 'HTTPS terminates before the Function socket.' }),
    });
    assert.equal(response.status, 201); assert.equal((await response.json()).entry.author, 'Proxy visitor');
  } finally { await new Promise((resolve) => server.close(resolve)); }

  assert.equal(typeof (await import('../api/guestbook.js')).default, 'function');
  assert.equal(typeof (await import('../api/leaderboard.js')).default, 'function');
  console.log('Community API verified: private namespace separation, no-write GET, shared validation, CAS retry/concurrency/idempotency/caps, server-derived scores, parsed+streamed bodies, proxy HTTPS/origin, rate/body limits, honest 503, and awaited durable completion. No remote or visitor data was accessed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
