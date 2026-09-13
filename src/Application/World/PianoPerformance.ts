import type { AudioPlayer } from '../AudioPlayer';
import { EventBus } from '../UI/EventBus';
import { PIANO_PERFORMANCE } from '../../design/piano-performance';

export type PianoPerformanceState = {
  status: 'loading' | 'ready' | 'buffering' | 'playing' | 'paused' | 'finished' | 'error';
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
    throw new Error('Could not read the performance data.');
  }
  const notes = score.notes.map((note) => {
    if (!note || ![note.time, note.duration, note.midi, note.velocity].every(Number.isFinite)
      || note.time < 0 || note.duration <= 0 || note.time + note.duration > score.duration! + 0.001
      || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127
      || note.velocity <= 0 || note.velocity > 1
      || (note.soundDuration !== undefined && (!Number.isFinite(note.soundDuration)
        || note.soundDuration <= 0 || note.time + note.soundDuration > score.duration! + 0.001))) {
      throw new Error('The performance contains invalid note data.');
    }
    return { time: note.time, duration: note.duration, midi: note.midi, velocity: note.velocity,
      ...(note.soundDuration === undefined ? {} : { soundDuration: note.soundDuration }) };
  }).sort((a, b) => a.time - b.time || a.midi - b.midi);
  return { title: score.title, duration: score.duration!, notes };
}

/** A pre-rendered recording supplies the only clock for the authored key animation. */
export default class PianoPerformance {
  private state: PianoPerformanceState = {
    status: 'loading', title: PIANO_PERFORMANCE.title, elapsed: 0, duration: 0,
  };
  private score?: Score;
  private loading?: Promise<boolean>;
  private abort = new AbortController();
  private generation = 0;
  private disposed = false;
  private wantPlaying = false;
  private nextVisualNote = 0;
  private activeKeys = new Set<number>();
  private lastPublished = -1;
  private media: HTMLAudioElement;
  private listeners: [string, EventListener][] = [];
  private unsubscribe: Array<() => void> = [];
  private readonly onVisibility = () => { if (document.hidden) this.pause(); };

  constructor(private audio: AudioPlayer, private callbacks: Callbacks) {
    this.media = document.createElement('audio');
    this.media.preload = 'auto';
    this.media.autoplay = false;
    this.media.hidden = true;
    this.media.muted = audio.muted;
    this.media.setAttribute('aria-hidden', 'true');
    this.media.dataset.pianoRecording = '';
    document.body.appendChild(this.media);
    this.listen('playing', () => {
      if (!this.wantPlaying) { this.media.pause(); return; }
      this.state.status = 'playing'; this.state.error = undefined;
      this.publishAssets(); this.publish();
    });
    this.listen('waiting', () => {
      if (!this.wantPlaying) return;
      this.state.status = 'buffering'; this.publish();
    });
    this.listen('pause', () => {
      if (this.wantPlaying && this.media.paused && !this.media.ended) this.pause();
    });
    this.listen('ended', () => { if (this.media.ended) this.finish(); });
    this.listen('timeupdate', () => this.update());
    this.listen('error', () => { if (this.media.error) this.fail('Could not load the recording. Please try again.'); });
    for (const event of ['progress', 'loadedmetadata', 'canplay', 'canplaythrough']) this.listen(event, () => this.publishAssets());
    this.unsubscribe.push(EventBus.on('world-state', ({ muted }: { muted?: boolean }) => {
      if (typeof muted === 'boolean') this.media.muted = muted;
    }));
    this.unsubscribe.push(EventBus.on('world-request-state', () => this.publishAssets()));
    this.unsubscribe.push(EventBus.on('piano-assets-retry', ({ id }: { id?: string }) => {
      if (id !== 'performance') return;
      this.stop(); this.media.load(); void this.load(); this.publishAssets();
    }));
    document.addEventListener('visibilitychange', this.onVisibility);
    this.media.src = PIANO_PERFORMANCE.audioUrl;
    this.media.load();
    this.publishAssets();
    void this.load();
  }

  private listen(type: string, callback: () => void): void {
    const listener = () => { if (!this.disposed) callback(); };
    this.listeners.push([type, listener]); this.media.addEventListener(type, listener);
  }

  getSnapshot(): PianoPerformanceState { return { ...this.state }; }

  async play(): Promise<void> {
    if (this.disposed || this.wantPlaying || document.hidden) return;
    const request = ++this.generation;
    this.audio.stopInteractiveNotes();
    if (this.state.status === 'finished') this.media.currentTime = 0;
    if (this.media.error) this.media.load();
    const time = this.elapsed();
    this.nextVisualNote = this.score?.notes.findIndex(note => note.time >= time) ?? 0;
    if (this.nextVisualNote < 0) this.nextVisualNote = this.score?.notes.length ?? 0;
    this.wantPlaying = true;
    this.state = { ...this.state, status: 'buffering', error: undefined };
    this.lastPublished = -1; this.publish();
    try {
      // Keep the input gesture: never wait for samples or score fetch before play().
      const playing = this.media.play();
      const [loaded] = await Promise.all([this.load(), playing]);
      if (this.disposed || request !== this.generation || !this.wantPlaying) {
        if (this.disposed || !this.wantPlaying) this.media.pause();
        return;
      }
      if (!loaded || document.hidden) { this.pause(); return; }
      this.state.status = 'playing'; this.update(); this.publish();
    } catch {
      if (!this.disposed && request === this.generation) this.fail('Could not start the recording. Press Listen to retry.');
    }
  }

  pause(): void {
    if (this.disposed) return;
    ++this.generation; this.wantPlaying = false;
    const active = this.state.status === 'playing' || this.state.status === 'buffering';
    this.media.pause(); this.setKeys(new Set());
    if (active) {
      this.state = { ...this.state, status: 'paused', elapsed: this.elapsed() };
      this.publish();
    }
  }

  stop(): void {
    if (this.disposed) return;
    ++this.generation; this.wantPlaying = false;
    this.media.pause();
    try { this.media.currentTime = 0; } catch { /* No metadata yet. */ }
    this.nextVisualNote = 0; this.setKeys(new Set());
    this.state = { ...this.state, elapsed: 0, error: undefined, status: this.score ? 'ready' : 'loading' };
    this.publish();
  }

  update(): void {
    if (this.disposed || !this.wantPlaying || !this.score) return;
    const elapsed = this.elapsed();
    const keys = new Set<number>();
    const repeatedAttacks: number[] = [];
    for (const note of this.score.notes) {
      if (note.time > elapsed) break;
      if (note.time + note.duration > elapsed && note.midi >= 60 && note.midi <= 83) keys.add(note.midi);
    }
    while (this.nextVisualNote < this.score.notes.length && this.score.notes[this.nextVisualNote].time <= elapsed) {
      const note = this.score.notes[this.nextVisualNote++];
      if (note.time + note.duration > elapsed && this.activeKeys.has(note.midi)) repeatedAttacks.push(note.midi);
    }
    this.setKeys(keys);
    if (repeatedAttacks.length) this.callbacks.onRepeatedAttack?.(repeatedAttacks);
    this.state.elapsed = elapsed;
    this.state.duration = this.duration();
    if (this.media.ended) this.finish();
    else if (elapsed - this.lastPublished >= .2) { this.lastPublished = elapsed; this.publish(); }
  }

  private duration(): number {
    return Number.isFinite(this.media.duration) && this.media.duration > 0 ? this.media.duration : this.score?.duration ?? 0;
  }
  private elapsed(): number {
    return Math.min(this.duration(), Number.isFinite(this.media.currentTime) ? Math.max(0, this.media.currentTime) : 0);
  }
  private setKeys(keys: Set<number>): void {
    if (keys.size === this.activeKeys.size && [...keys].every(key => this.activeKeys.has(key))) return;
    this.activeKeys = keys; this.callbacks.onKeys(keys);
  }
  private finish(): void {
    if (this.disposed) return;
    ++this.generation; this.wantPlaying = false;
    this.media.pause(); this.setKeys(new Set());
    this.state = { ...this.state, status: 'finished', elapsed: this.duration(), duration: this.duration() };
    this.publish();
  }
  private fail(error: string): void {
    ++this.generation; this.wantPlaying = false;
    this.media.pause(); this.setKeys(new Set());
    this.state = { ...this.state, status: 'error', error, elapsed: this.elapsed() };
    this.publishAssets(); this.publish();
  }
  private publishAssets(): void {
    if (this.disposed) return;
    let buffered = 0;
    for (let i = 0; i < this.media.buffered.length; i++) buffered += this.media.buffered.end(i) - this.media.buffered.start(i);
    const duration = this.duration();
    EventBus.dispatch('piano-assets', { id: 'performance', label: 'Piano recording', unit: 'seconds',
      phase: this.media.error ? 'error' : this.media.readyState >= 3 ? 'ready' : 'downloading',
      received: Math.min(buffered, duration), total: duration, completed: this.media.readyState >= 3 ? 1 : 0, count: 1 });
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(); this.disposed = true;
    this.abort.abort(); this.unsubscribe.forEach(off => off());
    this.listeners.forEach(([type, listener]) => this.media.removeEventListener(type, listener));
    this.media.removeAttribute('src'); this.media.load(); this.media.remove();
    document.removeEventListener('visibilitychange', this.onVisibility);
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
        this.state = { status: this.wantPlaying ? 'buffering' : 'ready', title: score.title, duration: this.duration(), elapsed: this.elapsed() };
        this.publish();
        return true;
      } catch {
        if (!this.disposed) {
          this.state = { ...this.state, status: 'error', error: 'Could not load the performance. Please try again.' };
          this.publish();
        }
        return false;
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  }

  private publish(): void { if (!this.disposed) this.callbacks.onState(this.getSnapshot()); }
}
