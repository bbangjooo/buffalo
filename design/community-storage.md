# Guestbook and leaderboard persistence

The project includes two awaited Node Function entry points, `api/guestbook.js` and `api/leaderboard.js`, backed by a private Vercel Blob store. The configured store is **buffalo-community**, in **icn1**, connected to the project’s Production and Preview environments. `@vercel/blob` is pinned to **2.8.0**. The Vercel team is on the Hobby plan.

This document describes the configured target and implementation. A release is complete only after the corresponding deployment and live API responses have been verified; adding the code or connecting a store does not itself establish that production serves it.

## Environment boundaries

| Runtime | Guestbook | Leaderboard |
| --- | --- | --- |
| Vercel Production | Private `community/guestbook.json` | Private `community/leaderboard.json` |
| Vercel Preview | Private `community-preview/guestbook.json` | Private `community-preview/leaderboard.json` |
| Local Vite dev or preview | `.local-data/guestbook.json` | `.local-data/leaderboard.json` |

`server/community-stores.mjs` chooses the preview prefix only when `VERCEL_ENV` is `preview`. Vite’s `npm run preview` remains a local server, with the same file adapters as `npm run dev`. `GUESTBOOK_DATA_FILE` and `LEADERBOARD_DATA_FILE` can override those local paths. Local server activity does not implicitly edit the production Blob documents.

The Blob objects are private; the site reads and writes them through its server API, not public object URLs. The SDK obtains its store credentials from the Function environment. Credentials are not passed to the browser or stored in application source. `.local-data/` and local environment files are excluded from both Git and Vercel uploads. The existing guestbook and leaderboard files remain separate and are not deleted by the migration.

## HTTP contracts

Both APIs return JSON with `Cache-Control: no-store`. The Function entry points await the shared handler through durable completion before returning.

| Route | GET | POST |
| --- | --- | --- |
| `/api/guestbook` | `{ entries }` | `{ author, body, submissionId? }` → `{ entry, duplicate }` |
| `/api/leaderboard` | `{ entries }` for the current track | `{ runId, name, trackId, perfect, great, good, misses, maxCombo }` → `{ entry, rank, saved, duplicate }` |

A new accepted submission returns HTTP 201; an identical retained-ID retry returns HTTP 200 with `duplicate: true`. Malformed inputs, conflicting identities, rate limits and unavailable storage produce explicit errors. The handler accepts either Vercel’s already-parsed body or a streamed local request, limits JSON bodies to 4,096 bytes, validates UTF-8, checks the request origin and accounts for HTTPS termination in front of the Function.

The API is public to visitors and has no login requirement. Same-origin checks reduce unintended cross-site use but are not proof of visitor identity. The in-memory two-second per-IP check is best effort for each Function instance. Separate instances do not share that map, so it is not a global anti-abuse guarantee.

## Retention and retries

The guestbook retains its latest **200 entries**. Names allow 24 Unicode characters and messages 120 after whitespace normalization. A supplied `submissionId` becomes the entry ID. While it is retained, the same ID and normalized content return the original entry; changing the content under that ID returns a conflict. Without an ID, the server creates a UUID. There is no permanent receipt after an entry is evicted.

`Guestbook.tsx` keeps a UUID for the same normalized draft after a timeout, lost response or failed request. Whitespace-only edits keep that ID; meaningful author/body changes clear it. Confirmed success clears it so a later intentionally identical message is a new submission. Failure leaves the draft visible.

The leaderboard retains the top **200 runs per track**, with GET exposing the current track: **Lasso Lady**, `lasso-lady-four-key-v1`. New submissions must use that ID and the current four-key chart length. Existing Beethoven Virus records remain under their original track ID and stored note count; document validation checks them against their own counts, and new current-track writes preserve them. They do not appear in Lasso Lady rankings. Runs are ordered by score, accuracy and maximum combo descending, then earlier creation date and ID. Different runs can use the same name. A retained run UUID makes an identical retry return the same entry; a changed payload conflicts. Evicted and unqualified runs have no historical receipt. An unqualified result returns `entry: null`, `saved: false` and a rank below the retained top 200.

`ScoreSubmission.tsx` mounts only for a finished run. It displays a read-only final score and submits judgement counts with a stable UUID and complete payload across retries. A new run gets a new UUID. The server derives score and accuracy from the counts and current chart length, checking totals and feasible combo bounds. It does not authoritatively observe the gameplay that generated those counts. This remains a casual, client-reported leaderboard rather than an anti-cheat system.

## Leaderboard wall reader

The current leaderboard UI is the same-origin `/leaderboard.html` document in Play's framed wall. `LeaderboardScreen.ts` keeps it mounted as a CSS3D iframe. Selecting the room's **Leaderboard** button or its wall focuses the `leaderboard` reading view; **Back to room / Esc** returns to Play. **View leaderboard** after a rhythm-game submission leaves the game and stops its music before focusing the wall.

The iframe performs a fresh `GET /api/leaderboard` when Play becomes active, on the page's explicit refresh action, or after a confirmed score update. Updates received while inactive are marked for the next activation. Loading, empty, error and retry states remain in English. The reader does not poll while another room is active. These display changes preserve the existing POST contract, stable run IDs, score derivation, historical-track retention and separate Production/Preview Blob namespaces.

## Concurrent document updates

`server/blob-document.mjs` provides the private JSON document adapter. A read uses `get(..., { access: 'private', useCache: false })`, checks the returned ETag, validates the document and bounds its decoded UTF-8 size to 256 KiB. A missing object is treated as an empty collection in memory; GET does not create it.

Updates follow this sequence:

1. Read the current document and ETag from private storage.
2. Apply a synchronous pure mutation to a copy of that document. IDs and timestamps were generated once before this retry loop.
3. Create a missing object with overwrite disabled, or write an existing object using `ifMatch` with its observed ETag.
4. On a create collision or changed version, read the latest document and rerun the same mutation. Retained IDs make a committed write with a lost response safe to recognize.
5. Stop after five conditional write attempts or the 20-second update deadline. Reads have a 10-second deadline. Errors produce an unavailable response; the driver never switches to unconditional overwrite to force success.

Local file adapters reuse the same validation and mutation rules, with their own serialized durable file writes. Pure mutations return without a write for duplicates or unqualified leaderboard scores. Unknown write failures with an unchanged version propagate instead of being blindly retried. Corrupt or oversized documents are not replaced with an empty collection.

## Free Hobby budget

The included allowances documented for Hobby are:

| Resource | Included allowance |
| --- | ---: |
| Storage | 1 GB |
| Read operations | 10,000 |
| Write/list operations | 2,000 |
| Data transfer | 10 GB |

See [Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) for the current allowance definitions and reset periods. Hobby does not silently charge paid overage: exhausted limits can make Blob inaccessible until the allowance is available again. The APIs then report unavailable storage, and the form does not claim a successful save. No paid plan upgrade or overage authorization is part of this implementation.

Production and preview requests both use the configured Blob service. Every fresh read and conditional-update retry consumes operations. The 200-entry caps keep documents small but do not bound visitor request volume, and the per-instance rate check is not a substitute for a global usage budget.

## Migration

`scripts/migrate-community-data.mjs` uses production store credentials already supplied in its process environment. It does not print credentials or inspect auth files. Run it only when a production data migration is intended:

```sh
node scripts/migrate-community-data.mjs
```

The script reads and validates each `.local-data/guestbook.json` / `.local-data/leaderboard.json` file. Missing or empty local files need no remote write. For a nonempty source, it uses the same conditional-update adapter to copy the document into `community/` only when the remote collection is empty. Identical existing JSON is an idempotent no-op; any differing nonempty remote collection causes a refusal rather than a replacement. This script does not merge differing records or seed the preview prefix.

After each migration or identical-content no-op, it reads fresh remote content and checks equality, rereads the local file to verify that its bytes were preserved, and reports the local SHA-256. It never deletes local files. If the source changes during migration or production already has different records, stop and reconcile those records deliberately rather than overriding the check.

## Verification and rollback

- `node scripts/verify-guestbook.cjs`: local guestbook validation and persistence.
- `node scripts/verify-leaderboard.cjs`: local ranked scores, retention, UUID retry/conflict behavior and validation.
- `node scripts/verify-community-api.cjs`: shared API contracts, private namespace separation, no-write GET, CAS retries/concurrency, parsed/streamed requests, proxy origin handling, errors and awaited completion.
- `node --test scripts/verify-blob-document.mjs`: isolated Blob-driver tests for create/update races, fresh reads, lost write responses, bounded retries, document validation and stream cleanup.

The isolated tests do not read or mutate real visitor collections. A separate temporary private verification object was used to check the live service’s conditional-write race behavior and fresh reads, then deleted; that check does not assert that a production Function deployment is complete. The release was then verified on 2026-09-10. Preview deployment `dpl_92E52WDt7jrdes2zuSSm4D8Y4QZ6` passed real browser guestbook POST201, retry200 with the same ID, score POST201 with server-derived1000000 points, conflicting retry409, and fresh-page leaderboard display. A separate SDK process read both stored verification entries before conditional cleanup. Production deployment `dpl_9hUYF8CSzDQfvjsnNEqtZZoDQ7k8` serves `bbangjo.kr`: both GET routes return200, the original guestbook entry is visible, a retained-ID POST returns200 without mutation, and invalid score submission returns400. The production namespace contains no test records; the local source bytes were preserved.

Rolling back to an older static deployment does **not** delete the Blob store or either namespace. That deployment may lack the API routes, leaving the community forms unavailable until a Function-capable revision is restored. Local `.local-data/` files also remain untouched. Preserve the private store and credentials during a code rollback; deleting a store is a separate destructive operation and is not part of this procedure.

The shared song metadata and chart generator live in `src/design/rhythm-track.mjs`. The browser TypeScript module reexports them, and the Node Functions import the JavaScript module directly. This avoids relying on a `.ts` pathname that the Vercel Function builder emits under a different extension. The current module defines Lasso Lady at 140 BPM with an original four-key chart; server score derivation uses that same chart. The deployment checks above record the earlier community-storage release with the former 254-note Beethoven Virus chart. They do not establish deployment or live validation of this new song, chart or native audio transport.

The leaderboard wall and lazy-read UI are a subsequent revision to the deployment records above. Their new navigation and display behavior still require a separate release check; those records do not establish a new deployment.

## Wall reader release verification — 2026-09-11

Deployment `dpl_39xjKxVHEysvNiVDHRBubvY5g7kY` at `bbangjo.kr` serves the Play wall reader (`main.4293b3c5.js`). Both Play buttons match the Summary button's44pxheight,12pxradius andpadding; only Rhythmgame has the accent fill. Production verified the embedded page, pointer-driven Refresh returning200, iframe Escape returning to Play and absence of dialogs. Local tests used40intercepted GET-only fixture rows to verify mouse-wheel scrolling and a359pxmobile document without horizontal overflow, then removed the interception. Initial About made0leaderboardrequests; enteringPlay made1, and changingnightmode made0additionalrequests. Rhythm→wallnavigation stopsnativeaudio and returns the hamster to2.2×meadow scale. No visitor records were written by these checks.
