import { createCommunityHandler } from '../server/community-http.mjs';
import { createCommunityStores } from '../server/community-stores.mjs';

let stores;
function guestbookStore() {
  if (!stores) stores = createCommunityStores();
  return stores.guestbook;
}

const handler = createCommunityHandler({
  kind: 'guestbook', production: true,
  store: {
    list: () => guestbookStore().list(),
    submit: (input, rateKey) => guestbookStore().submit(input, rateKey),
  },
});

export default async function guestbook(request, response) {
  await handler(request, response);
}
