import { createBlobDocument } from './blob-document.mjs';
import { createCommunityRateLimit } from './community-http.mjs';
import { mutateGuestbookDocument, prepareGuestbookEntry, validateGuestbookDocument } from './guestbook-store.mjs';
import {
  listLeaderboardEntries, mutateLeaderboardDocument, prepareLeaderboardEntry, validateLeaderboardDocument,
} from './leaderboard-store.mjs';

/** Production and preview use separate private objects; local Vite keeps files. */
export function createCommunityStores({
  guestbookDocument, leaderboardDocument, documentFactory = createBlobDocument, rateLimitMs = 2000,
} = {}) {
  const prefix = process.env.VERCEL_ENV === 'preview' ? 'community-preview' : 'community';
  const guestbook = guestbookDocument || documentFactory(`${prefix}/guestbook.json`, {
    empty: () => ({ entries: [] }), validate: validateGuestbookDocument,
  });
  const leaderboard = leaderboardDocument || documentFactory(`${prefix}/leaderboard.json`, {
    empty: () => ({ version: 1, entries: [] }), validate: validateLeaderboardDocument,
  });
  const guestbookRateLimit = createCommunityRateLimit(rateLimitMs);
  const leaderboardRateLimit = createCommunityRateLimit(rateLimitMs);

  return {
    guestbook: {
      list: async () => validateGuestbookDocument(await guestbook.read()).entries,
      submit: async (input, rateKey = 'local') => {
        // Stable UUID/date belong to the request, never to an individual CAS try.
        const candidate = prepareGuestbookEntry(input);
        const result = await guestbook.update((document) => mutateGuestbookDocument(
          validateGuestbookDocument(document), candidate, () => guestbookRateLimit.check(rateKey),
        ));
        if (!result.duplicate) guestbookRateLimit.record(rateKey);
        return result;
      },
    },
    leaderboard: {
      list: async () => listLeaderboardEntries(validateLeaderboardDocument(await leaderboard.read())),
      submit: async (input, rateKey = 'local') => {
        const candidate = prepareLeaderboardEntry(input);
        const result = await leaderboard.update((document) => mutateLeaderboardDocument(
          validateLeaderboardDocument(document), candidate, () => leaderboardRateLimit.check(rateKey),
        ));
        if (!result.duplicate) leaderboardRateLimit.record(rateKey);
        return result;
      },
    },
  };
}
