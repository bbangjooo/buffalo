import { isIP } from 'node:net';

const MAX_REQUEST_BYTES = 4096;

export class CommunityHttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Best-effort spam control only: Function instances do not share this map. */
export function createCommunityRateLimit(rateLimitMs = 2000) {
  const recent = new Map();
  return {
    check(key) {
      if (rateLimitMs > 0 && recent.has(key) && Date.now() - recent.get(key) < rateLimitMs) {
        throw new CommunityHttpError(429, 'Please wait a moment before posting again.');
      }
    },
    record(key) {
      if (rateLimitMs <= 0) return;
      const now = Date.now();
      recent.forEach((time, address) => { if (now - time >= rateLimitMs) recent.delete(address); });
      if (recent.size >= 1000) recent.delete(recent.keys().next().value);
      recent.set(key, now);
    },
  };
}

function sendJSON(response, status, document) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(document));
}

function sameOrigin(request, production) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const host = request.headers.host;
  // Never select the origin from x-forwarded-host or a comma-separated header.
  if (typeof host !== 'string' || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  try {
    // Vercel terminates HTTPS before the Node Function socket; public Functions
    // use HTTPS even when request.socket.encrypted is false behind that proxy.
    const protocol = production || request.socket?.encrypted ? 'https:' : 'http:';
    const expected = new URL(`${protocol}//${host}`);
    const actual = new URL(origin);
    return actual.origin === origin && actual.origin === expected.origin;
  } catch { return false; }
}

async function readJSON(request) {
  const type = request.headers['content-type'];
  if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(type)) {
    throw new CommunityHttpError(415, 'Please send the submission as JSON.');
  }
  const declaredLength = request.headers['content-length'];
  if (declaredLength !== undefined && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength) > MAX_REQUEST_BYTES)) {
    throw new CommunityHttpError(413, 'The submission is too large.');
  }
  let buffer;
  if (request.body !== undefined) {
    // Vercel may already have parsed JSON. Check both the wire Content-Length
    // above and its encoded representation before accepting that object.
    try {
      buffer = Buffer.isBuffer(request.body) ? request.body
        : Buffer.from(typeof request.body === 'string' ? request.body : JSON.stringify(request.body), 'utf8');
    } catch { throw new CommunityHttpError(400, 'Could not read the submission.'); }
    if (buffer.length > MAX_REQUEST_BYTES) throw new CommunityHttpError(413, 'The submission is too large.');
  } else {
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += part.length;
        if (size > MAX_REQUEST_BYTES) throw new CommunityHttpError(413, 'The submission is too large.');
        chunks.push(part);
      }
    } catch (error) {
      if (error instanceof CommunityHttpError) throw error;
      throw new CommunityHttpError(400, 'The request was interrupted. Please try again.');
    }
    buffer = Buffer.concat(chunks);
  }
  try {
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid body');
    return input;
  } catch { throw new CommunityHttpError(400, 'Could not read the submission.'); }
}

function rateKey(request, production) {
  if (production) {
    const forwarded = request.headers['x-forwarded-for'];
    const address = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
    if (isIP(address)) return address;
  }
  return request.socket?.remoteAddress || 'local';
}

/** Awaited by Node Functions; the same handler also serves local Vite APIs. */
export function createCommunityHandler({ store, kind, production = false, rateLimitMs = 2000 }) {
  return async function communityHandler(request, response) {
    try {
      if (!sameOrigin(request, production)) throw new CommunityHttpError(403, `Please use the ${kind} from this site.`);
      if (request.method === 'GET') {
        sendJSON(response, 200, { entries: await store.list() });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        throw new CommunityHttpError(405, 'This request method is not supported.');
      }
      const input = await readJSON(request);
      const result = await store.submit(input, rateKey(request, production));
      sendJSON(response, result.duplicate ? 200 : 201, result);
    } catch (error) {
      if (error instanceof CommunityHttpError && error.status === 429 && !response.destroyed && !response.writableEnded) {
        response.setHeader('Retry-After', String(Math.ceil(rateLimitMs / 1000)));
      }
      sendJSON(response, error instanceof CommunityHttpError ? error.status : 503, {
        error: error instanceof CommunityHttpError ? error.message : `Could not reach the ${kind}. Please try again shortly.`,
      });
    }
  };
}
