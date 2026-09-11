import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { guestbookPlugin } from './server/guestbook-store.mjs';
import { leaderboardPlugin } from './server/leaderboard-store.mjs';

export default defineConfig({
  plugins: [guestbookPlugin({
    filePath: process.env.GUESTBOOK_DATA_FILE || fileURLToPath(new URL('./.local-data/guestbook.json', import.meta.url)),
  }), leaderboardPlugin({
    filePath: process.env.LEADERBOARD_DATA_FILE || fileURLToPath(new URL('./.local-data/leaderboard.json', import.meta.url)),
  })],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        guidePreview: fileURLToPath(new URL('./guide-preview.html', import.meta.url)),
        leaderboard: fileURLToPath(new URL('./leaderboard.html', import.meta.url)),
      },
    },
  },
});
