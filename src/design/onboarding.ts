import type { RoomId } from './rooms';

export type OnboardingPhase = 'loading' | 'writing' | 'tour' | 'done';

export const ONBOARDING_ROOMS: { id: RoomId; title: string; text: string; column: number; row: number }[] = [
  { id: 'developer', title: 'I build.', text: 'I turn ideas\ninto things\nwith code.', column: 1, row: 1 },
  { id: 'piano', title: 'I play piano.', text: 'I like playing\nthe piano.', column: 1, row: 0 },
  { id: 'blog', title: 'I write.', text: 'I write about\nwhat I feel\nand learn.', column: 0, row: 0 },
  { id: 'ai', title: 'Come play.', text: 'Take a break,\nplay a little,\nand stay a while.', column: 0, row: 1 },
];

/** One layout drives both the world projection and its handwritten annotations. */
export function onboardingLayout(width: number, height: number) {
  const landscape = width > height * 1.35 && height < 540;
  const size = Math.max(120, Math.min(width - 24, height - (landscape ? 100 : 180), 760));
  return { size, left: (width - size) / 2, top: (height - size) / 2 + (landscape ? 6 : 14), landscape };
}
