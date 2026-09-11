import {
  createInitialRhythmState, createOriginalChart, RHYTHM_KEYS,
  RHYTHM_MAX_SCORE, RHYTHM_WINDOWS, TRACK,
} from '../../design/rhythm-game';
import type { RhythmHitEvent, RhythmJudgement, RhythmNote, RhythmState } from '../../design/rhythm-game';

export type { RhythmHitEvent, RhythmJudgement, RhythmSnapshot, RhythmState } from '../../design/rhythm-game';

export interface RhythmGameOptions {
  onState?: (state: RhythmState) => void;
  onPad?: (lane: number, on: boolean) => void;
  onHit?: (lane: number, judgement: RhythmJudgement) => void;
  onJudgement?: (event: RhythmHitEvent) => void;
  onResult?: (state: RhythmState) => void;
}

const STORAGE_KEY = `bbangjo.rhythm.best.${TRACK.id}`;
const JUDGEMENT_SECONDS = 0.7;
const CLOCK_JITTER_SECONDS = 0.075;
const EPSILON = 1e-7;

/**
 * Renderer-independent tap-note game. Only update() advances the song clock.
 * Keyboard/touch handlers supply stable source IDs and release them on keyup.
 * The caller rejects KeyboardEvent.repeat and pauses the player on focus loss.
 */
export default class RhythmGame {
  private readonly options: RhythmGameOptions;
  private readonly notes: RhythmNote[] = createOriginalChart();
  private readonly consumed = new Set<string>();
  private readonly heldSources = new Map<string, number>();
  private snapshot: RhythmState;
  private judgementTime = -Infinity;
  private judgementId = 0;
  private disposed = false;

  constructor(options: RhythmGameOptions = {}) {
    this.options = options;
    this.snapshot = createInitialRhythmState(this.readBest(), this.notes.length);
  }

  get state(): RhythmState { return this.getSnapshot(); }

  getSnapshot(): RhythmState {
    return {
      ...this.snapshot,
      visibleNotes: this.snapshot.visibleNotes.map((note) => ({ ...note })),
      heldLanes: [...this.snapshot.heldLanes],
    };
  }

  /** Start only after the transport has accepted a fresh playback/restart. */
  start(): void {
    if (this.disposed) return;
    this.resetRun();
    this.snapshot.phase = 'countdown';
    this.refreshNotes();
    this.publish();
  }

  /** An external song clock is the sole authority for note travel and scoring. */
  update(timeSeconds: number, playing: boolean): void {
    if (this.disposed || this.snapshot.phase === 'idle' || this.snapshot.phase === 'finished') return;
    if (!playing) {
      this.pause();
      return;
    }
    if (!Number.isFinite(timeSeconds)) return;
    const time = Math.max(0, Math.min(this.snapshot.duration, timeSeconds));

    // A deliberate backwards seek starts a fresh attempt. Tiny player-clock
    // corrections are ignored so an imprecise video timestamp cannot farm hits.
    if (time < this.snapshot.time - CLOCK_JITTER_SECONDS) this.resetRun();
    this.snapshot.time = Math.max(time, this.snapshot.time);
    this.snapshot.phase = this.snapshot.time < TRACK.firstNoteTime - RHYTHM_WINDOWS.good
      ? 'countdown' : 'playing';

    for (const note of this.notes) {
      if (note.time >= this.snapshot.time - RHYTHM_WINDOWS.good - EPSILON) break;
      if (!this.consumed.has(note.id)) this.judge(note, 'Miss');
    }
    if (this.snapshot.time - this.judgementTime > JUDGEMENT_SECONDS) {
      this.snapshot.judgement = null;
      this.snapshot.judgementLane = null;
    }
    this.refreshNotes();
    if (this.snapshot.time >= this.snapshot.duration) {
      this.finish();
      return;
    }
    this.publish();
  }

  press(lane: number, source: string): void {
    if (this.disposed || !Number.isInteger(lane) || lane < 0 || lane >= RHYTHM_KEYS.length
      || typeof source !== 'string' || !source || this.heldSources.has(source)
      || (this.snapshot.phase !== 'playing' && this.snapshot.phase !== 'countdown')) return;

    const wasHeld = this.laneHeld(lane);
    this.heldSources.set(source, lane);
    this.refreshHeldLanes();
    if (!wasHeld) this.options.onPad?.(lane, true);

    // A second physical input can keep the pad lit, but cannot retrigger a lane
    // until every owner has released it. Countdown taps never score.
    if (!wasHeld && this.snapshot.phase === 'playing') {
      let nearest: RhythmNote | undefined;
      let distance = RHYTHM_WINDOWS.good + EPSILON;
      for (const note of this.notes) {
        if (note.time > this.snapshot.time + RHYTHM_WINDOWS.good + EPSILON) break;
        if (note.lane !== lane || this.consumed.has(note.id)) continue;
        const candidateDistance = Math.abs(note.time - this.snapshot.time);
        if (candidateDistance < distance) {
          distance = candidateDistance;
          nearest = note;
        }
      }
      if (nearest) {
        const judgement = distance <= RHYTHM_WINDOWS.perfect + EPSILON ? 'Perfect'
          : distance <= RHYTHM_WINDOWS.great + EPSILON ? 'Great' : 'Good';
        this.judge(nearest, judgement);
        this.options.onHit?.(lane, judgement);
      }
    }
    this.refreshNotes();
    this.publish();
  }

  release(source: string): void {
    if (this.disposed || !this.heldSources.has(source)) return;
    const lane = this.heldSources.get(source)!;
    this.heldSources.delete(source);
    this.refreshHeldLanes();
    if (!this.laneHeld(lane)) this.options.onPad?.(lane, false);
    this.publish();
  }

  pause(): void {
    if (this.disposed || this.snapshot.phase === 'idle' || this.snapshot.phase === 'finished') return;
    const changed = this.snapshot.phase !== 'paused' || this.heldSources.size > 0;
    this.clearHolds();
    this.snapshot.phase = 'paused';
    if (changed) this.publish();
  }

  cancel(): void {
    if (this.disposed) return;
    this.resetRun();
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  private resetRun(): void {
    this.clearHolds();
    this.consumed.clear();
    this.judgementTime = -Infinity;
    this.snapshot = createInitialRhythmState(this.snapshot.best, this.notes.length);
  }

  private judge(note: RhythmNote, judgement: RhythmJudgement): void {
    if (this.consumed.has(note.id)) return;
    this.consumed.add(note.id);
    if (judgement === 'Perfect') this.snapshot.perfect++;
    else if (judgement === 'Great') this.snapshot.great++;
    else if (judgement === 'Good') this.snapshot.good++;
    else this.snapshot.misses++;
    this.snapshot.combo = judgement === 'Miss' ? 0 : this.snapshot.combo + 1;
    this.snapshot.maxCombo = Math.max(this.snapshot.maxCombo, this.snapshot.combo);
    const credit = this.snapshot.perfect + this.snapshot.great * 0.75 + this.snapshot.good * 0.5;
    this.snapshot.score = Math.round(credit / this.notes.length * RHYTHM_MAX_SCORE);
    this.snapshot.accuracy = Math.round(credit / this.consumed.size * 10_000) / 100;
    this.snapshot.judgement = judgement;
    this.snapshot.judgementLane = note.lane;
    this.judgementTime = this.snapshot.time;
    const id = ++this.judgementId;
    this.options.onJudgement?.({
      id, lane: note.lane, judgement,
      combo: this.snapshot.combo, time: this.snapshot.time,
    });
  }

  private finish(): void {
    this.clearHolds();
    this.snapshot.phase = 'finished';
    this.snapshot.countdown = 0;
    this.snapshot.visibleNotes = [];
    if (this.snapshot.score > this.snapshot.best) {
      this.snapshot.best = this.snapshot.score;
      try { localStorage.setItem(STORAGE_KEY, String(this.snapshot.best)); } catch { /* Keep this session's best when storage is unavailable. */ }
    }
    const result = this.getSnapshot();
    this.publish();
    this.options.onResult?.(result);
  }

  private refreshNotes(): void {
    this.snapshot.visibleNotes = this.notes.filter((note) => !this.consumed.has(note.id)
      && note.time >= this.snapshot.time - RHYTHM_WINDOWS.good - EPSILON
      && note.time <= this.snapshot.time + TRACK.approachSeconds);
    this.snapshot.countdown = this.snapshot.phase === 'countdown'
      ? Math.max(1, Math.ceil(TRACK.firstNoteTime - this.snapshot.time)) : 0;
  }

  private laneHeld(lane: number): boolean {
    for (const ownerLane of this.heldSources.values()) if (ownerLane === lane) return true;
    return false;
  }

  private refreshHeldLanes(): void {
    this.snapshot.heldLanes = [...new Set(this.heldSources.values())].sort((a, b) => a - b);
  }

  private clearHolds(): void {
    const lanes = [...new Set(this.heldSources.values())];
    this.heldSources.clear();
    this.snapshot.heldLanes = [];
    lanes.forEach((lane) => this.options.onPad?.(lane, false));
  }

  private publish(): void { this.options.onState?.(this.getSnapshot()); }

  private readBest(): number {
    try {
      const best = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isInteger(best) && best >= 0 && best <= RHYTHM_MAX_SCORE ? best : 0;
    } catch { return 0; }
  }
}
