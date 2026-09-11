import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBlobDocument } from '../server/blob-document.mjs';
import { validateGuestbookDocument } from '../server/guestbook-store.mjs';
import { validateLeaderboardDocument } from '../server/leaderboard-store.mjs';

// Run with production Blob credentials in the environment. This preserves the
// original files and refuses to replace any differing production records.
for (const [name, validate, empty] of [
  ['guestbook', validateGuestbookDocument, () => ({ entries: [] })],
  ['leaderboard', validateLeaderboardDocument, () => ({ version: 1, entries: [] })],
]) {
  const file = fileURLToPath(new URL(`../.local-data/${name}.json`, import.meta.url));
  let source;
  try { source = await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(`${name}: no local file to migrate`);
    continue;
  }
  const document = validate(JSON.parse(source.toString('utf8')));
  if (!document.entries.length) {
    console.log(`${name}: local document is empty; no remote write needed`);
    continue;
  }
  const store = createBlobDocument(`community/${name}.json`, { empty, validate });
  const result = await store.update((current) => {
    if (current.entries.length) {
      if (JSON.stringify(current) === JSON.stringify(document)) return { result: 'already migrated' };
      throw new Error(`${name}: production already contains different records; refusing to replace them`);
    }
    return { document, result: 'migrated' };
  });
  if (JSON.stringify(await store.read()) !== JSON.stringify(document)) throw new Error(`${name}: remote verification failed`);
  const after = await readFile(file);
  if (!after.equals(source)) throw new Error(`${name}: local file changed during migration`);
  console.log(JSON.stringify({ collection: name, result, entries: document.entries.length,
    localPreserved: true, sha256: createHash('sha256').update(source).digest('hex') }));
}
