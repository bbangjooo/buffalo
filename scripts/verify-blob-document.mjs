/* Offline production-driver checks. No Blob credentials or service requests are used. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobError, BlobPreconditionFailedError } from '@vercel/blob';
import { createBlobDocument } from '../server/blob-document.mjs';

const PATHNAME = 'test/documents/shared.json';
const empty = () => ({ version: 1, items: [] });
const encoder = new TextEncoder();

function validate(document) {
  assert(document && document.version === 1 && Array.isArray(document.items), 'Invalid document');
  assert(document.items.every((item) => item && typeof item.id === 'string' && item.id && Number.isFinite(item.value)), 'Invalid item');
  assert.equal(new Set(document.items.map((item) => item.id)).size, document.items.length, 'Duplicate item ID');
  return document;
}

function streamText(text, chunkSize = 17) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } });
}

function rendezvous(count) {
  let arrived = 0, release;
  const ready = new Promise((resolve) => { release = resolve; });
  return async () => { if (++arrived <= count) { if (arrived === count) release(); await ready; } };
}

function backend(initial = null) {
  let raw = initial === null ? null : JSON.stringify(initial);
  let revision = initial === null ? 0 : 1;
  let readGate = null;
  let lostReply = false;
  let conflicts = 0;
  let createConflict = () => new BlobError('This blob already exists. Use allowOverwrite to replace it.');
  const reads = [], puts = [], commits = [], sleeps = [];
  const etag = () => `"revision-${revision}"`;
  const api = {
    reads, puts, commits, sleeps,
    get current() { return raw === null ? null : JSON.parse(raw); },
    get raw() { return raw; },
    synchronizeReads(count) { readGate = rendezvous(count); },
    loseNextCommitReply() { lostReply = true; },
    conflictNextWrites(count = Infinity) { conflicts = count; },
    createCollisionWith(factory) { createConflict = factory; },
    overwriteFromOtherInstance(document) { raw = JSON.stringify(document); revision++; },
    sdk: {
      async get(pathname, options) {
        assert.equal(pathname, PATHNAME); assert.equal(options.access, 'private'); assert.equal(options.useCache, false);
        reads.push({ pathname, options });
        const snapshot = raw === null ? null : { statusCode: 200, stream: streamText(raw), blob: { etag: etag(), size: encoder.encode(raw).length } };
        if (readGate) await readGate();
        return snapshot;
      },
      async put(pathname, body, options) {
        assert.equal(pathname, PATHNAME); assert.equal(options.access, 'private'); assert.equal(options.addRandomSuffix, false);
        assert.equal(typeof options.allowOverwrite, 'boolean', 'create/overwrite intent must be explicit');
        const text = typeof body === 'string' ? body : await new Response(body).text();
        puts.push({ pathname, text, options });
        if (conflicts > 0) { conflicts--; throw new BlobPreconditionFailedError(); }
        if (options.allowOverwrite) {
          assert.equal(typeof options.ifMatch, 'string', 'overwriting requires a real ETag');
          assert(options.ifMatch.length > 0);
          if (raw === null || options.ifMatch !== etag()) throw new BlobPreconditionFailedError();
        } else {
          assert.equal(options.ifMatch, undefined, 'create must not attach a made-up ETag');
          if (raw !== null) throw createConflict();
        }
        const document = JSON.parse(text); raw = text; revision++; commits.push(document);
        if (lostReply) { lostReply = false; throw new Error('Connection closed after commit'); }
        return { pathname, etag: etag(), size: encoder.encode(raw).length, url: `https://example.invalid/${pathname}` };
      },
      async sleep(milliseconds) { sleeps.push(milliseconds); },
    },
  };
  return api;
}

const controller = (storage, settings = {}) => createBlobDocument(PATHNAME, { empty, validate, ...settings }, storage.sdk);
const insert = (id, value = 1) => (document) => document.items.some((item) => item.id === id)
  ? { result: id }
  : { document: { ...document, items: [...document.items, { id, value }] }, result: id };

test('missing reads are independent empty documents and no-op updates never create or rewrite a blob', async () => {
  const storage = backend(), first = controller(storage), second = controller(storage);
  const read = await first.read(); assert.deepEqual(read, empty()); read.items.push({ id: 'local-only', value: 1 });
  assert.deepEqual(await second.read(), empty());
  assert.equal(await first.update(() => ({ result: 'nothing' })), 'nothing');
  assert.equal(storage.puts.length, 0);
  await first.update(insert('existing'));
  const original = storage.raw, writes = storage.puts.length;
  assert.equal(await second.update((document) => { document.items[0].value = 999; return { result: 'unchanged' }; }), 'unchanged');
  assert.equal(storage.raw, original); assert.equal(storage.puts.length, writes);
});

test('independent instances racing to create merge both mutations without overwriting the winner', async () => {
  const storage = backend(); storage.synchronizeReads(2);
  const first = controller(storage), second = controller(storage);
  const results = await Promise.all([first.update(insert('first', 2)), second.update(insert('second', 3))]);
  assert.deepEqual(results.sort(), ['first', 'second']);
  assert.deepEqual(storage.current.items.map(({ id }) => id).sort(), ['first', 'second']);
  assert.equal(storage.commits.length, 2); assert(storage.puts.length >= 3);
  assert.equal(storage.puts[0].options.allowOverwrite, false); assert.equal(storage.puts[1].options.allowOverwrite, false);
  assert(storage.puts.slice(2).every(({ options }) => options.allowOverwrite === true && options.ifMatch));
});

test('independent instances racing on the same ETag retry their mutator against the latest committed state', async () => {
  const storage = backend({ version: 1, items: [{ id: 'initial', value: 1 }] }); storage.synchronizeReads(2);
  const first = controller(storage), second = controller(storage); let calls = 0;
  const append = (id) => (document) => { calls++; return insert(id)(document); };
  await Promise.all([first.update(append('first')), second.update(append('second'))]);
  assert.deepEqual(storage.current.items.map(({ id }) => id).sort(), ['first', 'initial', 'second']);
  assert.equal(calls, 3, 'only the conflicting mutator should execute again');
  assert.equal(storage.commits.length, 2);
  assert.equal(storage.puts[0].options.ifMatch, storage.puts[1].options.ifMatch);
  assert.notEqual(storage.puts[2].options.ifMatch, storage.puts[1].options.ifMatch);
});

test('each read fetches private origin content and sees writes from a different instance', async () => {
  const storage = backend(empty()), document = controller(storage);
  assert.deepEqual(await document.read(), empty());
  storage.overwriteFromOtherInstance({ version: 1, items: [{ id: 'remote', value: 4 }] });
  assert.deepEqual((await document.read()).items, [{ id: 'remote', value: 4 }]);
  assert.equal(storage.reads.length, 2); assert(storage.reads.every(({ options }) => options.useCache === false));
});

test('create-collision named errors also retry through a fresh conditional write', async () => {
  const storage = backend();
  storage.createCollisionWith(() => Object.assign(new Error('This blob already exists'), { name: 'BlobAlreadyExistsError' }));
  storage.synchronizeReads(2);
  await Promise.all([controller(storage).update(insert('one')), controller(storage).update(insert('two'))]);
  assert.deepEqual(storage.current.items.map(({ id }) => id).sort(), ['one', 'two']);
  assert.equal(storage.commits.length, 2);
});

test('persistent CAS conflicts stop within five put attempts and never switch to unconditional overwrite', async () => {
  for (const initial of [null, empty()]) {
    const storage = backend(initial); storage.conflictNextWrites();
    let calls = 0;
    await assert.rejects(controller(storage).update((document) => { calls++; return insert('never-written')(document); }));
    assert(storage.puts.length >= 2 && storage.puts.length <= 5, `unbounded attempts: ${storage.puts.length}`);
    assert.equal(calls, storage.puts.length); assert.equal(storage.commits.length, 0);
    assert.equal(storage.sleeps.length, storage.puts.length - 1, 'only actual retry intervals should sleep');
    assert(storage.sleeps.every((delay) => Number.isFinite(delay) && delay >= 0 && delay <= 5000));
    assert.deepEqual(storage.current, initial);
  }
});

test('a committed write whose response is lost is safely retried with the same caller-generated item ID', async () => {
  const storage = backend(); storage.loseNextCommitReply();
  const first = await controller(storage).update(insert('stable-id', 7)).then((result) => ({ result }), (error) => ({ error }));
  assert(first.error || first.result === 'stable-id');
  assert.equal(await controller(storage).update(insert('stable-id', 7)), 'stable-id');
  assert.deepEqual(storage.current.items, [{ id: 'stable-id', value: 7 }]);
  assert.equal(storage.commits.length, 1); assert.equal(storage.puts.length, 1, 'idempotent retry must be a no-op after the original commit');
});

test('an unknown write failure with an unchanged ETag propagates without blind retries', async () => {
  const storage = backend(empty()), failure = new Error('Permission or network failure');
  storage.sdk.put = async (pathname, body, options) => { storage.puts.push({ pathname, body, options }); throw failure; };
  await assert.rejects(controller(storage).update(insert('not-saved')), (error) => error === failure);
  assert.equal(storage.puts.length, 1); assert.equal(storage.sleeps.length, 0);
  assert.equal(storage.commits.length, 0); assert.deepEqual(storage.current, empty());
});

test('corrupt documents, missing ETags, malformed response streams and unexpected statuses fail closed', async () => {
  const validText = JSON.stringify(empty());
  const malformedUtf8 = new Uint8Array([
    ...encoder.encode('{"version":1,"items":[{"id":"'), 0xff, ...encoder.encode('","value":1}]}'),
  ]);
  const invalidResponses = [
    () => ({ statusCode: 200, stream: streamText('{broken'), blob: { etag: 'known', size: 7 } }),
    () => ({ statusCode: 200, stream: streamText('{"version":1,"items":{}}'), blob: { etag: 'known', size: 24 } }),
    () => ({ statusCode: 200, stream: streamText(validText), blob: { size: validText.length } }),
    () => ({ statusCode: 200, stream: streamText(validText), blob: { etag: '', size: validText.length } }),
    () => ({ statusCode: 200, stream: null, blob: { etag: 'known', size: validText.length } }),
    () => ({ statusCode: 200, stream: {}, blob: { etag: 'known', size: validText.length } }),
    () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { c.error(new Error('Truncated body')); } }), blob: { etag: 'known', size: validText.length } }),
    () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue({ invalid: 'chunk' }); c.close(); } }), blob: { etag: 'known', size: validText.length } }),
    () => ({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(malformedUtf8); c.close(); } }), blob: { etag: 'known', size: malformedUtf8.length } }),
    () => ({ statusCode: 304, stream: null, blob: { etag: 'known', size: validText.length } }),
    () => ({ statusCode: 500, stream: streamText(validText), blob: { etag: 'known', size: validText.length } }),
  ];
  for (const response of invalidResponses) {
    const storage = backend(empty()); storage.sdk.get = async () => response();
    const document = controller(storage); let invoked = false;
    await assert.rejects(document.read());
    await assert.rejects(document.update((state) => { invoked = true; return insert('unsafe')(state); }));
    assert.equal(invoked, false, 'mutator must not execute against an untrusted document');
    assert.equal(storage.puts.length, 0); assert.deepEqual(storage.current, empty());
  }
});

test('invalid next documents and UTF-8 byte limits are rejected before any upload', async () => {
  const storage = backend(empty()), document = controller(storage, { maxBytes: 128 });
  await assert.rejects(document.update(() => ({ document: { version: 1, items: 'invalid' }, result: 'bad' })));
  const large = { ...empty(), padding: '🙂'.repeat(30) };
  assert(JSON.stringify(large).length < 128 && encoder.encode(JSON.stringify(large)).length > 128, 'fixture must distinguish bytes from string length');
  await assert.rejects(document.update(() => ({ document: large, result: 'too large' })));
  assert.equal(storage.puts.length, 0); assert.deepEqual(storage.current, empty());
});

test('mutators must be synchronous and their errors cannot trigger a partial write', async () => {
  const storage = backend(empty()), document = controller(storage), failure = new Error('Mutation rejected');
  await assert.rejects(document.update(async (current) => insert('async')(current)));
  await assert.rejects(document.update(() => null));
  await assert.rejects(document.update(() => { throw failure; }), (error) => error === failure);
  assert.equal(storage.puts.length, 0); assert.deepEqual(storage.current, empty());
});

test('oversized reads fail even when metadata underreports the streamed body size', async () => {
  const text = JSON.stringify({ ...empty(), padding: 'x'.repeat(180) });
  for (const declaredSize of [encoder.encode(text).length, 1]) {
    const storage = backend(empty());
    storage.sdk.get = async () => ({ statusCode: 200, stream: streamText(text), blob: { etag: 'known', size: declaredSize } });
    await assert.rejects(controller(storage, { maxBytes: 128 }).read());
    await assert.rejects(controller(storage, { maxBytes: 128 }).update(insert('unsafe')));
    assert.equal(storage.puts.length, 0);
  }
});

test('the stream reader cancels promptly after its byte budget is exceeded', async () => {
  let cancelled = false, chunks = 0;
  const storage = backend(empty());
  storage.sdk.get = async () => ({ statusCode: 200, blob: { etag: 'known', size: 1 }, stream: new ReadableStream({
    pull(c) { chunks++; c.enqueue(new Uint8Array(129)); if (chunks >= 4) c.close(); },
    cancel() { cancelled = true; },
  }) });
  await assert.rejects(controller(storage, { maxBytes: 128 }).read());
  assert(cancelled, 'oversized body should be cancelled rather than fully buffered');
  assert(chunks <= 2, `too many chunks consumed after the limit: ${chunks}`);
});
