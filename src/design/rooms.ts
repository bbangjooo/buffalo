import palette from './jo-colors.json';

export const ROOM_IDS = ['developer', 'piano', 'blog', 'ai'] as const;
export type RoomId = typeof ROOM_IDS[number];
export type RoomView = RoomId | 'monitor' | 'resume' | 'piano-seat';
export type ObjectId = 'resume' | 'pianoSeat' | 'monitor' | 'blogLamp' | 'game' | 'guide' | 'curtainLeft' | 'curtainRight' | 'gamePad0' | 'gamePad1' | 'gamePad2' | 'gamePad3' | `key${number}`;

export const ROOMS: Record<RoomId, { name: string; group: string; angle: number; color: string; actions: { id: ObjectId; label: string }[] }> = {
  developer: {
    name: '개발', group: 'RoomDeveloper', angle: 0, color: palette.colors.teal,
    actions: [{ id: 'resume', label: 'Summary 보기' }],
  },
  piano: {
    name: '피아노', group: 'RoomPiano', angle: Math.PI / 2, color: palette.colors.brass,
    actions: [{ id: 'pianoSeat', label: '의자에 앉아 연주' }],
  },
  blog: {
    name: '블로그', group: 'RoomBlog', angle: Math.PI, color: palette.colors.slate,
    actions: [{ id: 'monitor', label: '모니터에서 읽기' }, { id: 'blogLamp', label: '책상 조명' }],
  },
  ai: {
    name: '게임', group: 'RoomAI', angle: Math.PI * 1.5, color: palette.colors.sage,
    actions: [{ id: 'game', label: '순서 기억 게임' }],
  },
};

export const COLORS = palette.colors;
export const ROOM_SIZE = 5.6;
export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && (ROOM_IDS as readonly string[]).includes(value);
}
