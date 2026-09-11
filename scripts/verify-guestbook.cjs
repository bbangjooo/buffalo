const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { createServer, request: httpRequest } = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

async function main() {
  const { createGuestbookMiddleware, createGuestbookStore, guestbookPlugin } = await import('../server/guestbook-store.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'buffalo-guestbook-'));
  const filePath = join(directory, 'data', 'guestbook.json');
  let server;
  let baseURL;
  async function start(options = {}) {
    const middleware = createGuestbookMiddleware({ filePath, rateLimitMs: 0, ...options });
    server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server) await new Promise((resolve) => server.close(resolve)); }
  async function api(input, options = {}) {
    const response = await fetch(`${baseURL}/api/guestbook`, input === undefined ? options : {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...options.headers },
      body: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input), ...options,
    });
    return { status: response.status, headers: response.headers, document: await response.json() };
  }
  try {
    await start();
    assert.deepEqual((await api()).document, { entries: [] });
    const first = await api({ author: '  산책자  ', body: '  초원에서\n\t쉬었다 갑니다.  ' });
    assert.equal(first.status, 201);
    assert.equal(first.document.entry.author, '산책자');
    assert.equal(first.document.entry.body, '초원에서 쉬었다 갑니다.');
    assert.equal(JSON.parse(await readFile(filePath, 'utf8')).entries[0].id, first.document.entry.id);
    assert.equal((await api()).document.entries[0].id, first.document.entry.id);
    await stop();
    await start();
    assert.equal((await api()).document.entries[0].id, first.document.entry.id, 'survives a new server/store instance');

    const scriptText = '<script>alert("hi")</script>';
    const literal = await api({ author: '<b>name</b>', body: scriptText });
    assert.equal(literal.status, 201);
    assert.equal(literal.document.entry.body, scriptText, 'stored literally; the React component renders text');
    assert.equal((await api()).document.entries[0].author, '<b>name</b>');
    const parallel = await Promise.all(Array.from({ length: 32 }, (_, i) => api({ author: `방문자 ${i}`, body: `동시에 남긴 글 ${i}` })));
    assert.ok(parallel.every((result) => result.status === 201));
    const entries = (await api()).document.entries;
    assert.equal(entries.length, 34, 'all simultaneous writes retained');
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 34);
    assert.ok(entries.every((entry) => Object.keys(entry).sort().join(',') === 'author,body,createdAt,id'));
    assert.equal((await api({ author: '😀'.repeat(24), body: '한'.repeat(120) })).status, 201);
    for (const value of [{ author: '', body: 'ok' }, { author: 'ok', body: '  ' }, { author: 2, body: 'ok' }, { author: 'a'.repeat(25), body: 'ok' }, { author: 'ok', body: '가'.repeat(121) }, {}]) {
      assert.equal((await api(value)).status, 400);
    }
    assert.equal((await api('[]')).status, 400);
    assert.equal((await api('{bad JSON')).status, 400);
    assert.equal((await api(Buffer.from([0xc0, 0x80]))).status, 400, 'invalid UTF-8 rejected');
    assert.equal((await api({ author: 'ok', body: 'ok' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await api('x'.repeat(4097))).status, 413);
    assert.equal((await api(undefined, { method: 'DELETE' })).status, 405);
    const crossOrigin = await api({ author: 'ok', body: 'ok' }, { headers: { 'content-type': 'application/json', origin: 'https://unrelated.example' } });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null);
    assert.equal((await api({ author: 'ok', body: 'ok' }, { headers: { 'content-type': 'application/json', origin: baseURL } })).status, 201);

    const chunkedStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(`${baseURL}/api/guestbook`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.write('x'.repeat(2100)); request.end('x'.repeat(2100));
    });
    assert.equal(chunkedStatus, 413, 'chunked body cannot bypass byte limit');

    const cappedStore = createGuestbookStore(join(directory, 'capped.json'));
    for (let i = 0; i < 205; i += 1) await cappedStore.add({ author: 'visitor', body: `${i}` });
    const capped = await cappedStore.list();
    assert.equal(capped.length, 200);
    assert.equal(capped[0].body, '204');
    assert.equal(capped[199].body, '5');

    await stop();
    await start({ rateLimitMs: 2000 });
    assert.equal((await api({ author: 'visitor', body: 'first' })).status, 201);
    const limited = await api({ author: 'visitor', body: 'too fast' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '2');

    await stop();
    const corruptFile = join(directory, 'corrupt.json');
    await writeFile(corruptFile, 'broken JSON');
    await start({ filePath: corruptFile });
    const failed = await api({ author: 'visitor', body: 'must not claim success' });
    assert.equal(failed.status, 503);
    assert.ok(!failed.document.error.includes(directory), 'no local filesystem details exposed');
    assert.equal(await readFile(corruptFile, 'utf8'), 'broken JSON', 'existing unreadable data is preserved');

    // Real Vite hooks, isolated from the running site and its visitor data.
    const vite = await import('vite');
    const viteFile = join(directory, 'vite-guestbook.json');
    const dev = await vite.createServer({ configFile: false, root: directory, logLevel: 'silent', plugins: [guestbookPlugin({ filePath: viteFile, rateLimitMs: 0 })], server: { host: '127.0.0.1', port: 0 } });
    try {
      await dev.listen();
      const url = `http://127.0.0.1:${dev.httpServer.address().port}/api/guestbook`;
      assert.deepEqual(await (await fetch(url)).json(), { entries: [] });
      const posted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: 'vite visitor', body: 'dev to preview' }) });
      assert.equal(posted.status, 201);
    } finally { await dev.close(); }
    await mkdir(join(directory, 'preview'));
    await writeFile(join(directory, 'preview', 'index.html'), '<!doctype html><title>Guestbook verification</title>');
    const preview = await vite.preview({ configFile: false, root: directory, logLevel: 'silent', build: { outDir: 'preview' }, plugins: [guestbookPlugin({ filePath: viteFile, rateLimitMs: 0 })], preview: { host: '127.0.0.1', port: 0 } });
    try {
      const url = `http://127.0.0.1:${preview.httpServer.address().port}/api/guestbook`;
      assert.equal((await (await fetch(url)).json()).entries[0].body, 'dev to preview');
      const posted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: 'preview visitor', body: 'preview can write' }) });
      assert.equal(posted.status, 201);
      assert.equal((await (await fetch(url)).json()).entries.length, 2);
    } finally { await new Promise((resolve) => preview.httpServer.close(resolve)); }
    console.log('Guestbook verified: persistence/restart, parallel writes, 200-entry bound, literal text, UTF-8/field/body validation, same-origin, rate limit, durable-write failure, Vite dev and preview GET/POST.');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
