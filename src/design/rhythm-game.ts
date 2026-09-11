import { TRACK, RHYTHM_MAX_SCORE, createOriginalChart as createSharedOriginalChart } from './rhythm-track.mjs';

export { TRACK, RHYTHM_MAX_SCORE };

export type RhythmPhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'finished';
export type RhythmJudgement = 'Perfect' | 'Great' | 'Good' | 'Miss';

export interface RhythmHitEvent {
  /** Monotonic per engine instance, including across restarts and seeks. */
  id: number;
  lane: number;
  judgement: RhythmJudgement;
  combo: number;
  /** External song-clock time when this note was judged. */
  time: number;
}

export interface RhythmNote {
  id: string;
  lane: number;
  /** Seconds on the song player's clock, including the opening countdown. */
  time: number;
}

export interface RhythmState {
  phase: RhythmPhase;
  time: number;
  duration: number;
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  judgement: RhythmJudgement | null;
  judgementLane: number | null;
  visibleNotes: RhythmNote[];
  heldLanes: number[];
  perfect: number;
  great: number;
  good: number;
  misses: number;
  best: number;
  totalNotes: number;
  countdown: number;
}

export type RhythmSnapshot = RhythmState;

export const RHYTHM_KEYS = [
  { lane: 0, label: 'D', code: 'KeyD', color: '#dac96b' },
  { lane: 1, label: 'F', code: 'KeyF', color: '#93c69a' },
  { lane: 2, label: 'J', code: 'KeyJ', color: '#76c7c8' },
  { lane: 3, label: 'K', code: 'KeyK', color: '#88b4e5' },
];

export const RHYTHM_WINDOWS = { perfect: 0.045, great: 0.09, good: 0.14 };

export function createOriginalChart(): RhythmNote[] {
  return createSharedOriginalChart();
}

export function createInitialRhythmState(best = 0, totalNotes = createOriginalChart().length): RhythmState {
  return {
    phase: 'idle', time: 0, duration: TRACK.duration, score: 0,
    combo: 0, maxCombo: 0, accuracy: 0, judgement: null, judgementLane: null,
    visibleNotes: [], heldLanes: [], perfect: 0, great: 0, good: 0, misses: 0,
    best, totalNotes, countdown: 0,
  };
}
