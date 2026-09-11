import layout from './courtyard-layout.json';
import blogHistory from './blog-history.json';
import { PROFILE } from './profile';
import pianoHistory from './piano-history.json';
import type { RoomId } from './rooms';

export interface HistoryEntry {
  id: string;
  date: string;
  title: string;
  text: string;
  paragraphs?: string[];
  articleHtml?: string;
  composer?: string;
  performer?: string;
  youtubeId?: string;
  youtubeUrl?: string;
  videoTitle?: string;
  objectKind?: string;
  objectLabel?: string;
  kind?: 'guestbook' | 'coffee';
  actionUrl?: string | null;
  actionLabel?: string;
  qrCodeUrl?: string;
  year?: string;
  url?: string;
  sourceLabel?: string;
  room?: RoomId;
}
export interface Exhibition { id: string; title: string; introduction: string; entries: HistoryEntry[]; }
export const COURTYARD = layout;
export const EXHIBITIONS: Exhibition[] = [
  {
    id: 'coffee', title: 'Buy Me a Coffee', introduction: '',
    entries: [{ id: 'support', date: '', title: 'If you enjoyed this space',
      text: '',
      kind: 'coffee', objectKind: 'coffee', objectLabel: 'Coffee',
      actionUrl: PROFILE.buyMeACoffeeUrl, actionLabel: 'Buy me a coffee',
      qrCodeUrl: '/support/buymeacoffee-qr.png' }],
  },
  {
    id: 'piano', title: 'Piano pieces',
    introduction: 'Five pieces I have played, and what they mean to me.',
    entries: pianoHistory,
  },
  {
    id: 'writing', title: 'Blog',
    introduction: 'Exchange stories and reflections.',
    entries: blogHistory.map(entry => ({ ...entry, sourceLabel: 'Original post' })),
  },
  {
    id: 'guestbook', title: 'Guestbook', introduction: '',
    entries: [{ id: 'visitors', date: '', title: 'Guestbook', text: '', kind: 'guestbook', objectKind: 'guestbook', objectLabel: 'Guestbook' }],
  },
];
