import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const SDK = { get, put, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** A small private JSON document, protected across independent Function instances. */
export function createBlobDocument(pathname, { empty, validate, maxBytes = 262144 }, dependencies = {}) {
  const client = { ...SDK, ...dependencies };
  if (!/^[a-z0-9][a-z0-9/_-]*\.json$/i.test(pathname)) throw new Error('Invalid storage pathname');

  async function snapshot(signal) {
    const response = await client.get(pathname, { access: 'private', useCache: false, abortSignal: signal });
    if (response === null) return { document: validate(empty()), etag: null };
    if (response.statusCode !== 200 || !response.stream || typeof response.blob?.etag !== 'string' || !response.blob.etag) {
      await response.stream?.cancel().catch(() => {});
      throw new Error('Storage returned an invalid document version');
    }
    if (response.blob.size > maxBytes) {
      await response.stream.cancel().catch(() => {});
      throw new Error('Stored document exceeds its size limit');
    }
    const reader = response.stream.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error('Stored document exceeds its size limit');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return { document: validate(JSON.parse(text)), etag: response.blob.etag };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  return {
    read: async () => (await snapshot(AbortSignal.timeout(10000))).document,
    // A mutator may run again after a conflict. Generate IDs/timestamps before
    // calling update, and check retained IDs inside the mutator on every retry.
    update: async (mutate) => {
      const signal = AbortSignal.timeout(20000);
      let current = await snapshot(signal);
      for (let attempt = 0; attempt < 5; attempt++) {
        signal.throwIfAborted();
        const change = mutate(structuredClone(current.document));
        if (!change || typeof change !== 'object' || typeof change.then === 'function') throw new Error('Invalid storage mutation');
        if (!Object.hasOwn(change, 'document')) return change.result;
        const next = validate(change.document);
        const body = JSON.stringify(next);
        if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('Document exceeds its size limit');
        try {
          await client.put(pathname, body, {
            access: 'private', contentType: 'application/json', addRandomSuffix: false,
            allowOverwrite: current.etag !== null, ...(current.etag ? { ifMatch: current.etag } : {}),
            cacheControlMaxAge: 60, abortSignal: signal,
          });
          return change.result;
        } catch (error) {
          if (attempt === 4 || signal.aborted) throw error;
          // The SDK reports create collisions as a generic BlobError. A new
          // version also covers a committed write whose response was lost.
          const latest = await snapshot(signal);
          if (!(error instanceof BlobPreconditionFailedError) && latest.etag === current.etag) throw error;
          current = latest;
          await client.sleep(20 * (attempt + 1));
        }
      }
      throw new Error('Could not save after concurrent updates');
    },
  };
}
