import { createCommunityHandler } from '../server/community-http.mjs';
import { createCommunityStores } from '../server/community-stores.mjs';

let stores;
function leaderboardStore() {
  if (!stores) stores = createCommunityStores();
  return stores.leaderboard;
}

const handler = createCommunityHandler({
  kind: 'leaderboard', production: true,
  store: {
    list: () => leaderboardStore().list(),
    submit: (input, rateKey) => leaderboardStore().submit(input, rateKey),
  },
});

export default async function leaderboard(request, response) {
  await handler(request, response);
}
