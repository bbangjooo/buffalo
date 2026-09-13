import { PIANO_INTERACTIVE_SAMPLES as PIANO_SAMPLES, PianoSample } from '../design/piano-samples';
import { EventBus } from './UI/EventBus';

export type PianoAssetState = {
  id: 'keys' | 'performance';
  label: string;
  unit?: 'seconds';
  phase: 'idle' | 'downloading' | 'downloaded' | 'preparing' | 'ready' | 'error';
  received: number;
  total: number;
  completed: number;
  count: number;
};

/** Download compressed bytes without creating an AudioContext or blocking the scene. */
export class PianoDownloads {
  private bytes = new Map<string, ArrayBuffer>();
  private completed = new Set<string>();
  private received = new Map<string, number>();
  private requests = new Map<AbortController, ReturnType<typeof setTimeout>>();
  private loading: Promise<boolean> | null = null;
  private disposed = false;
  private phase: PianoAssetState['phase'] = 'idle';
  private lastProgress = '';

  snapshot(): PianoAssetState {
    return { id: 'keys', label: 'Piano keys', phase: this.phase, received: [...this.received.values()].reduce((sum, size) => sum + size, 0),
      total: PIANO_SAMPLES.reduce((sum, sample) => sum + sample.bytes, 0), completed: this.completed.size, count: PIANO_SAMPLES.length };
  }

  publish(force = false): void {
    if (this.disposed) return;
    const state = this.snapshot();
    const key = `${state.phase}:${Math.floor(state.received / state.total * 100)}:${state.completed}`;
    if (!force && key === this.lastProgress) return;
    this.lastProgress = key;
    EventBus.dispatch('piano-assets', state);
  }

  setPhase(phase: PianoAssetState['phase']): void { this.phase = phase; this.publish(); }
  get(url: string): ArrayBuffer | undefined { return this.bytes.get(url); }
  release(url: string): void { this.bytes.delete(url); }

  download(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.loading) return this.loading;
    if (this.completed.size === PIANO_SAMPLES.length) return Promise.resolve(true);
    this.setPhase('downloading');
    // The typing shortcuts come first, followed by the remaining 3D keys.
    const missing = PIANO_SAMPLES.filter(s => !this.completed.has(s.url))
      .sort((a, b) => Number(b.midi >= 60 && b.midi <= 72) - Number(a.midi >= 60 && a.midi <= 72));
    let next = 0;
    const worker = async () => {
      while (next < missing.length && !this.disposed) {
        const sample = missing[next++];
        for (let attempt = 0; attempt < 2 && !this.disposed; attempt++) {
          if (await this.fetchSample(sample)) break;
        }
      }
    };
    this.loading = (async () => {
      try {
        await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
        if (this.disposed) return false;
        const done = this.completed.size === PIANO_SAMPLES.length;
        this.setPhase(done ? 'downloaded' : 'error');
        return done;
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  private async fetchSample(sample: PianoSample): Promise<boolean> {
    const abort = new AbortController();
    this.received.set(sample.url, 0);
    // Timeout a stalled individual request, not a whole bank on a slow connection.
    const resetTimeout = () => {
      clearTimeout(this.requests.get(abort));
      this.requests.set(abort, setTimeout(() => abort.abort(), 30000));
    };
    resetTimeout();
    try {
      const response = await fetch(sample.url, { signal: abort.signal, priority: 'low' } as RequestInit);
      if (!response.ok) throw new Error('Sample unavailable');
      let data: ArrayBuffer;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (this.disposed || abort.signal.aborted) throw new Error('Canceled');
            chunks.push(value); length += value.byteLength;
            if (length > sample.bytes) throw new Error('Unexpected sample size');
            this.received.set(sample.url, Math.min(sample.bytes, length));
            this.publish(); resetTimeout();
          }
        } finally { reader.releaseLock(); }
        const combined = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
        data = combined.buffer;
      } else { data = await response.arrayBuffer(); }
      if (this.disposed || abort.signal.aborted || data.byteLength !== sample.bytes) throw new Error('Incomplete sample');
      this.bytes.set(sample.url, data); this.completed.add(sample.url);
      this.received.set(sample.url, sample.bytes); this.publish();
      return true;
    } catch {
      abort.abort(); this.received.delete(sample.url); this.publish();
      return false;
    } finally { clearTimeout(this.requests.get(abort)); this.requests.delete(abort); }
  }

  dispose(): void {
    this.disposed = true;
    this.requests.forEach((timer, abort) => { clearTimeout(timer); abort.abort(); });
    this.requests.clear(); this.bytes.clear(); this.completed.clear(); this.received.clear();
  }
}
