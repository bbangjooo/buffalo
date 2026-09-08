import type { AudioPlayer } from '../AudioPlayer';
import { PIANO_PERFORMANCE } from '../../design/piano-performance';

export type PianoPerformanceState = {
  status: 'loading' | 'ready' | 'playing' | 'paused' | 'finished' | 'error';
  title: string;
  elapsed: number;
  duration: number;
  error?: string;
};
export type ScoreNote = { time: number; duration: number; midi: number; velocity: number; soundDuration?: number };
type Score = { title: string; duration: number; notes: ScoreNote[] };
type Callbacks = {
  onKeys: (keys: ReadonlySet<number>) => void;
  onRepeatedAttack?: (keys: ReadonlyArray<number>) => void;
  onState: (state: PianoPerformanceState) => void;
};

export function readScore(value: unknown): Score {
  const score = value as Partial<Score> | null;
  if (!score || typeof score.title !== 'string' || !score.title.trim()
    || !Array.isArray(score.notes) || !score.notes.length || score.notes.length > 100000
    || !Number.isFinite(score.duration) || score.duration! <= 0 || score.duration! > 7200) {
    throw new Error('악보 데이터를 읽지 못했어요.');
  }
  const notes = score.notes.map((note) => {
    if (!note || ![note.time, note.duration, note.midi, note.velocity].every(Number.isFinite)
      || note.time < 0 || note.duration <= 0 || note.time + note.duration > score.duration! + 0.001
      || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127
      || note.velocity <= 0 || note.velocity > 1
      || (note.soundDuration !== undefined && (!Number.isFinite(note.soundDuration)
        || note.soundDuration <= 0 || note.time + note.soundDuration > score.duration! + 0.001))) {
      throw new Error('악보의 음표 정보를 확인해 주세요.');
    }
    return { time: note.time, duration: note.duration, midi: note.midi, velocity: note.velocity,
      ...(note.soundDuration === undefined ? {} : { soundDuration: note.soundDuration }) };
  }).sort((a, b) => a.time - b.time || a.midi - b.midi);
  return { title: score.title, duration: score.duration!, notes };
}

/** Sound and physical keys share the AudioContext clock, including after a pause. */
export default class PianoPerformance {
  private state: PianoPerformanceState = {
    status: 'loading', title: PIANO_PERFORMANCE.title, elapsed: 0, duration: 0,
  };
  private score?: Score;
  private loading?: Promise<boolean>;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private disposed = false;
  private startTime = 0;
  private offset = 0;
  private nextNote = 0;
  private nextVisualNote = 0;
  private activeKeys = new Set<number>();
  private lastPublished = -1;
  private readonly onVisibility = () => { if (document.hidden) this.pause(); };

  constructor(private audio: AudioPlayer, private callbacks: Callbacks) {
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.load();
  }

  getSnapshot(): PianoPerformanceState { return { ...this.state }; }

  async play(): Promise<void> {
    if (this.disposed || this.state.status === 'playing') return;
    const request = ++this.generation;
    // Unlock from the input gesture, even if the score is still loading.
    const unlocked = this.audio.unlock();
    const loaded = await this.load();
    const soundReady = await unlocked;
    if (this.disposed || request !== this.generation || !loaded || document.hidden) return;
    if (!soundReady) {
      this.state = { ...this.state, status: 'error', error: '소리를 시작하지 못했어요. 다시 눌러 주세요.' };
      this.publish();
      return;
    }
    this.offset = this.state.status === 'paused' ? this.state.elapsed : 0;
    this.clearPlayback();
    this.startTime = this.audio.currentTime + 0.06;
    this.nextNote = 0;
    const notes = this.score!.notes;
    while (this.nextNote < notes.length && notes[this.nextNote].time < this.offset) {
      const note = notes[this.nextNote++];
      const remaining = note.time + (note.soundDuration ?? note.duration) - this.offset;
      if (remaining > 0) this.audio.scheduleNote(note.midi, note.velocity, this.startTime, remaining);
    }
    this.nextVisualNote = this.nextNote;
    this.state = { ...this.state, status: 'playing', elapsed: this.offset, error: undefined };
    this.lastPublished = -1;
    this.pump();
    this.timer = setInterval(() => this.pump(), 25);
    this.publish();
  }

  pause(): void {
    if (this.disposed) return;
    ++this.generation;
    if (this.state.status !== 'playing') return;
    const elapsed = this.elapsed();
    this.clearPlayback();
    this.state = { ...this.state, status: 'paused', elapsed };
    this.publish();
  }

  stop(): void {
    if (this.disposed) return;
    ++this.generation;
    if (this.state.status === 'playing' || this.state.status === 'paused' || this.state.status === 'finished') this.clearPlayback();
    else this.setKeys(new Set());
    this.offset = 0;
    this.state = { ...this.state, elapsed: 0, status: this.score ? 'ready' : this.state.status };
    this.publish();
  }

  update(): void {
    if (this.disposed || this.state.status !== 'playing' || !this.score) return;
    const elapsed = this.elapsed();
    const keys = new Set<number>();
    const repeatedAttacks: number[] = [];
    // Only animate the authored two-octave keyboard. Other notes retain their
    // original audio pitch instead of being mapped to an incorrect visible key.
    if (this.audio.currentTime >= this.startTime) {
      for (const note of this.score.notes) {
        if (note.time > elapsed) break;
        if (note.time + note.duration > elapsed && note.midi >= 60 && note.midi <= 83) keys.add(note.midi);
      }
      while (this.nextVisualNote < this.score.notes.length && this.score.notes[this.nextVisualNote].time <= elapsed) {
        const note = this.score.notes[this.nextVisualNote++];
        if (note.time + note.duration > elapsed && this.activeKeys.has(note.midi)) repeatedAttacks.push(note.midi);
      }
    }
    this.setKeys(keys);
    if (repeatedAttacks.length) this.callbacks.onRepeatedAttack?.(repeatedAttacks);
    this.state.elapsed = elapsed;
    if (elapsed >= this.state.duration) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.setKeys(new Set());
      this.state.status = 'finished';
      this.publish();
    } else if (elapsed - this.lastPublished >= 0.2) {
      this.lastPublished = elapsed;
      this.publish();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.clearPlayback();
    this.disposed = true;
    this.abort.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private elapsed(): number {
    return Math.min(this.state.duration, this.offset + Math.max(0, this.audio.currentTime - this.startTime));
  }

  private pump(): void {
    if (this.disposed || this.state.status !== 'playing' || !this.score) return;
    const until = this.elapsed() + 0.15;
    while (this.nextNote < this.score.notes.length && this.score.notes[this.nextNote].time <= until) {
      const note = this.score.notes[this.nextNote++];
      this.audio.scheduleNote(note.midi, note.velocity, this.startTime + note.time - this.offset, note.soundDuration ?? note.duration);
    }
  }

  private setKeys(keys: Set<number>): void {
    if (keys.size === this.activeKeys.size && [...keys].every((key) => this.activeKeys.has(key))) return;
    this.activeKeys = keys;
    this.callbacks.onKeys(keys);
  }

  private clearPlayback(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.audio.stopNotes();
    this.setKeys(new Set());
  }

  private async load(): Promise<boolean> {
    if (this.score) return true;
    if (this.loading) return this.loading;
    this.state = { ...this.state, status: 'loading', error: undefined };
    this.publish();
    this.loading = (async () => {
      try {
        const response = await fetch(PIANO_PERFORMANCE.scoreUrl, { signal: this.abort.signal });
        if (!response.ok) throw new Error('Score unavailable');
        const score = readScore(await response.json());
        if (this.disposed) return false;
        this.score = score;
        this.state = { status: 'ready', title: score.title, duration: score.duration, elapsed: 0 };
        this.publish();
        return true;
      } catch {
        if (!this.disposed) {
          this.state = { ...this.state, status: 'error', error: '악보를 불러오지 못했어요. 다시 시도해 주세요.' };
          this.publish();
        }
        return false;
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  }

  private publish(): void { if (!this.disposed) this.callbacks.onState(this.getSnapshot()); }
}
