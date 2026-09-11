import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CommunityHttpError as LeaderboardError, createCommunityHandler, createCommunityRateLimit } from './community-http.mjs';
import { TRACK, createOriginalChart, RHYTHM_MAX_SCORE } from '../src/design/rhythm-track.mjs';

const TOTAL_NOTES = createOriginalChart().length;
const MAX_ENTRIES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeName(value) {
  if (typeof value !== 'string') throw new LeaderboardError(400, 'Name is required.');
  const name = value.replace(/\s+/gu, ' ').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > 24) {
    throw new LeaderboardError(400, 'Name must be between 1 and 24 characters.');
  }
  return name;
}

function validateCounts(input, totalNotes) {
  for (const key of ['perfect', 'great', 'good', 'misses', 'maxCombo']) {
    if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > totalNotes) {
      throw new LeaderboardError(400, 'Judgement counts and combo must be valid whole numbers.');
    }
  }
  const hits = input.perfect + input.great + input.good;
  if (hits + input.misses !== totalNotes) throw new LeaderboardError(400, 'Only a completed run can be submitted.');
  if (input.maxCombo > hits || input.maxCombo < Math.ceil(hits / (input.misses + 1))) {
    throw new LeaderboardError(400, 'The maximum combo does not match this run.');
  }
}

function normalizeSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LeaderboardError(400, 'A completed run is required.');
  if (typeof input.runId !== 'string' || !UUID.test(input.runId)) throw new LeaderboardError(400, 'A valid run ID is required.');
  if (input.trackId !== TRACK.id) throw new LeaderboardError(400, 'This track is not available on the leaderboard.');
  validateCounts(input, TOTAL_NOTES);
  return {
    runId: input.runId.toLowerCase(), name: normalizeName(input.name), trackId: input.trackId,
    perfect: input.perfect, great: input.great, good: input.good, misses: input.misses, maxCombo: input.maxCombo,
  };
}

function calculateResult(input, totalNotes) {
  const credit = input.perfect + input.great * 0.75 + input.good * 0.5;
  return {
    score: Math.round(credit / totalNotes * RHYTHM_MAX_SCORE),
    accuracy: Math.round(credit / totalNotes * 10_000) / 100,
  };
}

function sameSubmission(a, b) {
  return ['runId', 'name', 'trackId', 'perfect', 'great', 'good', 'misses', 'maxCombo'].every((key) => a[key] === b[key]);
}

export function compareLeaderboardEntries(a, b) {
  return b.score - a.score || b.accuracy - a.accuracy || b.maxCombo - a.maxCombo
    || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateDocument(document) {
  if (!document || document.version !== 1 || !Array.isArray(document.entries)) {
    throw new Error('Invalid leaderboard data');
  }
  const runIds = new Set();
  const entryIds = new Set();
  const trackCounts = new Map();
  for (const entry of document.entries) {
    if (!entry || typeof entry.trackId !== 'string' || !entry.trackId || !UUID.test(entry.runId) || !UUID.test(entry.id)
      || !validDate(entry.createdAt) || normalizeName(entry.name) !== entry.name || entryIds.has(entry.id) || runIds.has(entry.runId)
      || !Number.isInteger(entry.totalNotes) || entry.totalNotes < 1 || entry.totalNotes > 100_000
      || (entry.trackId === TRACK.id && entry.totalNotes !== TOTAL_NOTES)) throw new Error('Invalid leaderboard entry');
    validateCounts(entry, entry.totalNotes);
    const result = calculateResult(entry, entry.totalNotes);
    if (result.score !== entry.score || result.accuracy !== entry.accuracy) throw new Error('Invalid leaderboard score');
    runIds.add(entry.runId);
    entryIds.add(entry.id);
    trackCounts.set(entry.trackId, (trackCounts.get(entry.trackId) || 0) + 1);
    if (trackCounts.get(entry.trackId) > MAX_ENTRIES) throw new Error('Leaderboard exceeds its entry limit');
  }
  return document;
}

export function validateLeaderboardDocument(document) {
  try { return validateDocument(document); }
  catch { throw new Error('Invalid leaderboard data'); }
}

export function listLeaderboardEntries(document) {
  return document.entries.filter((entry) => entry.trackId === TRACK.id).sort(compareLeaderboardEntries);
}

/** Generate once before CAS retries, which must not mint another identity. */
export function prepareLeaderboardEntry(input) {
  const normalized = normalizeSubmission(input);
  return {
    id: randomUUID(), ...normalized, ...calculateResult(normalized, TOTAL_NOTES),
    totalNotes: TOTAL_NOTES, createdAt: new Date().toISOString(),
  };
}

export function mutateLeaderboardDocument(document, candidate, beforeNew = () => {}) {
  const existing = document.entries.find((entry) => entry.runId === candidate.runId);
  if (existing && !sameSubmission(existing, candidate)) {
    throw new LeaderboardError(409, 'This run was already submitted with different details.');
  }
  const entry = existing || candidate;
  const ranked = listLeaderboardEntries(document).filter((item) => item.runId !== entry.runId);
  ranked.push(entry); ranked.sort(compareLeaderboardEntries);
  const rank = ranked.findIndex((item) => item.runId === entry.runId) + 1;
  const saved = rank <= MAX_ENTRIES;
  const result = { entry: saved ? entry : null, rank, saved, duplicate: Boolean(existing) };
  if (existing) return { result };
  beforeNew();
  if (!saved) return { result };
  return {
    document: { version: 1, entries: [...document.entries.filter((item) => item.trackId !== TRACK.id), ...ranked.slice(0, MAX_ENTRIES)] },
    result,
  };
}

/**
 * Single-process local storage. Judgements are client-reported, not anti-cheat.
 * Entries are capped at 200 per track. UUID retries are idempotent while an
 * entry remains ranked; no permanent identity or submission history is kept.
 */
export function createLeaderboardStore(filePath, { rateLimitMs = 0 } = {}) {
  const file = resolve(filePath);
  const limiter = createCommunityRateLimit(rateLimitMs);
  let queue = Promise.resolve();
  function serial(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function readDocument() {
    try { return validateLeaderboardDocument(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: [] };
      // Stored-data failures are availability errors, never user-input errors.
      throw new Error('Could not read leaderboard data', { cause: error });
    }
  }

  async function writeDocument(document) {
    await mkdir(dirname(file), { recursive: true });
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporaryFile, file);
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (handle) await handle.close();
      await unlink(temporaryFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async function submit(input, rateKey = 'local') {
    const candidate = prepareLeaderboardEntry(input);
    return serial(async () => {
      const document = await readDocument();
      const mutation = mutateLeaderboardDocument(document, candidate, () => limiter.check(rateKey));
      if (mutation.document) await writeDocument(mutation.document);
      if (!mutation.result.duplicate) limiter.record(rateKey);
      return mutation.result;
    });
  }
  return {
    list: () => serial(async () => listLeaderboardEntries(await readDocument())),
    submit,
    add: submit,
  };
}

export function createLeaderboardMiddleware({
  filePath = resolve(process.env.LEADERBOARD_DATA_FILE || '.local-data/leaderboard.json'), rateLimitMs = 2000,
} = {}) {
  const store = createLeaderboardStore(filePath, { rateLimitMs });
  const handler = createCommunityHandler({ store, kind: 'leaderboard', rateLimitMs });
  return function leaderboardMiddleware(request, response, next) {
    if ((request.url || '').split('?')[0] !== '/api/leaderboard') return next();
    return handler(request, response);
  };
}

export function leaderboardPlugin(options) {
  const middleware = createLeaderboardMiddleware(options);
  return {
    name: 'local-leaderboard',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
