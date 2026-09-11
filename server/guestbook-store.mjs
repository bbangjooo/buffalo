import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CommunityHttpError as GuestbookError, createCommunityHandler, createCommunityRateLimit } from './community-http.mjs';

const MAX_ENTRIES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeField(value, maxLength, label) {
  if (typeof value !== 'string') throw new GuestbookError(400, `${label} is required.`);
  const text = value.replace(/\s+/gu, ' ').trim();
  const length = Array.from(text).length;
  if (length < 1 || length > maxLength) {
    throw new GuestbookError(400, `${label} must be between 1 and ${maxLength} characters.`);
  }
  return text;
}

function validateEntry(entry) {
  return entry && typeof entry.id === 'string' && typeof entry.createdAt === 'string'
    && Number.isFinite(Date.parse(entry.createdAt))
    && normalizeField(entry.author, 24, 'Name') === entry.author
    && normalizeField(entry.body, 120, 'Message') === entry.body;
}

export function validateGuestbookDocument(document) {
  try {
    if (!document || !Array.isArray(document.entries) || document.entries.length > MAX_ENTRIES
      || !document.entries.every(validateEntry) || new Set(document.entries.map((entry) => entry.id)).size !== document.entries.length) {
      throw new Error('Invalid document');
    }
    return document;
  } catch { throw new Error('Invalid guestbook data'); }
}

/** Stable identity and timestamp are created once, outside any storage retry. */
export function prepareGuestbookEntry(input) {
  const author = normalizeField(input?.author, 24, 'Name');
  const body = normalizeField(input?.body, 120, 'Message');
  if (input?.submissionId !== undefined && (typeof input.submissionId !== 'string' || !UUID.test(input.submissionId))) {
    throw new GuestbookError(400, 'A valid submission ID is required.');
  }
  return { id: input.submissionId?.toLowerCase() || randomUUID(), author, body, createdAt: new Date().toISOString() };
}

export function mutateGuestbookDocument(document, candidate, beforeNew = () => {}) {
  const existing = document.entries.find((entry) => entry.id === candidate.id);
  if (existing) {
    if (existing.author !== candidate.author || existing.body !== candidate.body) {
      throw new GuestbookError(409, 'This message was already submitted with different details.');
    }
    return { result: { entry: existing, duplicate: true } };
  }
  beforeNew();
  return {
    document: { entries: [candidate, ...document.entries].slice(0, MAX_ENTRIES) },
    result: { entry: candidate, duplicate: false },
  };
}

/** Single-process store. A queued read/modify/write avoids losing simultaneous posts. */
export function createGuestbookStore(filePath, { rateLimitMs = 0 } = {}) {
  const limiter = createCommunityRateLimit(rateLimitMs);
  const file = resolve(filePath);
  let queue = Promise.resolve();

  function serial(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function readEntries() {
    try {
      return validateGuestbookDocument(JSON.parse(await readFile(file, 'utf8'))).entries;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writeEntries(entries) {
    await mkdir(dirname(file), { recursive: true });
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryFile, file);
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (handle) await handle.close();
      await unlink(temporaryFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  function submit(input, rateKey = 'local') {
    const candidate = prepareGuestbookEntry(input);
    return serial(async () => {
      const entries = await readEntries();
      const mutation = mutateGuestbookDocument({ entries }, candidate, () => limiter.check(rateKey));
      if (mutation.document) await writeEntries(mutation.document.entries);
      if (!mutation.result.duplicate) limiter.record(rateKey);
      return mutation.result;
    });
  }
  return {
    list: () => serial(readEntries),
    submit,
    add: async (input) => (await submit(input)).entry,
  };
}

export function createGuestbookMiddleware({ filePath = resolve('.local-data/guestbook.json'), rateLimitMs = 2000 } = {}) {
  const store = createGuestbookStore(filePath, { rateLimitMs });
  const handler = createCommunityHandler({ store, kind: 'guestbook', rateLimitMs });
  return function guestbookMiddleware(request, response, next) {
    if ((request.url || '').split('?')[0] !== '/api/guestbook') return next();
    return handler(request, response);
  };
}

export function guestbookPlugin(options) {
  const middleware = createGuestbookMiddleware(options);
  return {
    name: 'local-guestbook',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
