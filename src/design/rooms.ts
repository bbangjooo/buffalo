import palette from './jo-colors.json';

export const ROOM_IDS = ['developer', 'piano', 'blog', 'ai'] as const;
export type RoomId = typeof ROOM_IDS[number];
export type RoomView = RoomId | 'monitor' | 'resume' | 'leaderboard' | 'piano-seat' | 'courtyard' | 'exhibit' | 'rhythm';
export type ObjectId = 'resume' | 'pianoSeat' | 'monitor' | 'leaderboard' | 'blogLamp' | 'game' | 'guide' | 'curtainLeft' | 'curtainRight' | 'gamePad0' | 'gamePad1' | 'gamePad2' | 'gamePad3' | `key${number}`;

export const ROOMS: Record<RoomId, { name: string; group: string; angle: number; color: string; actions: { id: ObjectId; label: string }[] }> = {
  developer: {
    name: 'About', group: 'RoomDeveloper', angle: 0, color: palette.colors.teal,
    actions: [{ id: 'resume', label: 'About me' }],
  },
  piano: {
    name: 'Piano', group: 'RoomPiano', angle: Math.PI / 2, color: palette.colors.brass,
    actions: [{ id: 'pianoSeat', label: 'Sit at the piano' }],
  },
  blog: {
    name: 'Blog', group: 'RoomBlog', angle: Math.PI, color: palette.colors.slate,
    actions: [{ id: 'monitor', label: 'Read the blog' }, { id: 'blogLamp', label: 'Desk lamp' }],
  },
  ai: {
    name: 'Play', group: 'RoomAI', angle: Math.PI * 1.5, color: palette.colors.sage,
    actions: [{ id: 'game', label: 'Rhythm game' }, { id: 'leaderboard', label: 'Leaderboard' }],
  },
};

export const COLORS = palette.colors;
export const ROOM_SIZE = 5.6;
export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && (ROOM_IDS as readonly string[]).includes(value);
}
