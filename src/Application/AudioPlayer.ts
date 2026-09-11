import { EventBus } from "./UI/EventBus";
import { PIANO_SAMPLES, pianoSampleMix } from "../design/piano-samples";

type VoiceKind = "interactive" | "score";
type Voice = { kind: VoiceKind; sources: AudioBufferSourceNode[]; nodes: AudioNode[]; dispose: () => void };
type PianoAudioState = { status: "idle" | "loading" | "ready" | "error"; error?: string };

/** A two-velocity, stereo Salamander piano on the same clock as the score transport. */
export class AudioPlayer {
  muted = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private dry: GainNode | null = null;
  private roomSend: GainNode | null = null;
  private room: ConvolverNode | null = null;
  private roomImpulse: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<boolean> | null = null;
  private loadingAbort: AbortController | null = null;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private audioState: PianoAudioState = { status: "idle" };
  private voices = new Set<Voice>();
  private noteRequest = 0;
  private interactiveRequest = 0;
  private disposed = false;
  private unsubscribe: Array<() => void>;

  constructor() {
    this.unsubscribe = [
      EventBus.on("sound-toggle", () => { void this.toggle(); }),
      EventBus.on("world-request-state", () => this.publish()),
    ];
  }

  /** Warm the sample cache on piano-room entry without starting sound or resuming audio. */
  async preload(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    return this.loadSamples(context);
  }

  async toggle(): Promise<void> {
    if (this.disposed) return;
    this.muted = !this.muted;
    ++this.noteRequest;
    if (this.master && this.context) this.master.gain.setValueAtTime(this.muted ? 0 : .75, this.context.currentTime);
    if (this.muted) { this.stopVoices(); this.clearRoomTail(); }
    this.publish();
  }

  /** Resume synchronously from the input gesture, then wait until scheduling is safe. */
  async unlock(): Promise<boolean> {
    if (this.disposed || this.muted) return false;
    const request = this.noteRequest;
    const context = await this.readyContext();
    if (!context || this.disposed || this.muted || request !== this.noteRequest) return false;
    const loaded = await this.loadSamples(context);
    return loaded && !this.disposed && !this.muted && request === this.noteRequest && context.state === "running";
  }

  get currentTime(): number { return this.context?.currentTime ?? 0; }

  async playNote(midi: number, velocity = .75): Promise<void> {
    if (this.disposed || this.muted || !Number.isFinite(midi) || !Number.isFinite(velocity)) return;
    if (midi < 0 || midi > 127 || velocity <= 0) return;
    const request = this.noteRequest, interaction = this.interactiveRequest;
    const context = await this.readyContext();
    if (!context || this.disposed || this.muted || request !== this.noteRequest || interaction !== this.interactiveRequest) return;
    const loaded = await this.loadSamples(context);
    if (!loaded || this.disposed || this.muted || context.state !== "running" || request !== this.noteRequest || interaction !== this.interactiveRequest) return;
    this.strike(context, midi, velocity, context.currentTime, "interactive");
  }

  /** Absolute AudioContext seconds; the supplied sounding duration determines note-off. */
  scheduleNote(midi: number, velocity: number, startTime: number, duration: number): void {
    const context = this.context;
    if (this.disposed || this.muted || !context || context.state !== "running" || this.audioState.status !== "ready") return;
    if (![midi, velocity, startTime, duration].every(Number.isFinite)) return;
    if (midi < 0 || midi > 127 || velocity <= 0 || startTime < 0 || duration <= 0) return;
    const noteOff = startTime + duration;
    if (!Number.isFinite(noteOff) || noteOff <= context.currentTime) return;
    const start = Math.max(startTime, context.currentTime);
    // Enter an already sounding recording at its elapsed position, preserving its original end.
    this.strike(context, midi, velocity, start, "score", noteOff - start, start - startTime);
  }

  private strike(context: AudioContext, midi: number, velocity: number, start: number, kind: VoiceKind, duration?: number, elapsed = 0): void {
    const strength = Math.min(1, velocity);
    const layers = pianoSampleMix(midi, strength).map(({ sample, gain }) => ({
      buffer: this.buffers.get(sample.url), gain, rate: Math.pow(2, (midi - sample.midi) / 12),
    })).filter(({ buffer, rate }) => buffer && buffer.duration / rate > elapsed + .003);
    if (!layers.length) return;
    const voice = this.newVoice(kind);
    let playing = layers.length;
    try {
      for (const layer of layers) {
        const buffer = layer.buffer!;
        const source = context.createBufferSource();
        const envelope = context.createGain();
        voice.sources.push(source); voice.nodes.push(envelope);
        const remaining = buffer.duration / layer.rate - elapsed;
        const release = .12 + .1 * Math.max(0, Math.min(1, (84 - midi) / 63));
        const noteOff = start + (duration ?? remaining);
        const end = Math.min(noteOff + release, start + remaining);
        const attackEnd = start + Math.min(.003, (end - start) * .25);
        const releaseStart = Math.max(attackEnd, Math.min(noteOff, end - .015));
        const peak = Math.max(1e-6, .55 * Math.pow(strength, .72) * layer.gain);
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(layer.rate, start);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(peak, attackEnd);
        // The recording supplies the hammer transient, changing partials and natural decay.
        envelope.gain.setValueAtTime(peak, releaseStart);
        envelope.gain.exponentialRampToValueAtTime(peak * .001, end);
        envelope.gain.linearRampToValueAtTime(0, end + .005);
        source.connect(envelope); envelope.connect(this.dry!); envelope.connect(this.roomSend!);
        source.onended = () => { if (--playing === 0) voice.dispose(); };
        source.start(start, elapsed * layer.rate);
        source.stop(end + .01);
      }
    } catch {
      voice.dispose();
      this.audioState = { status: "error", error: "The piano could not play. Please try again." };
      this.publish();
    }
  }

  /** Room navigation cancels input notes while an ongoing performance keeps its voices. */
  stopInteractiveNotes(): void { ++this.interactiveRequest; this.stopVoices("interactive"); }

  stopNotes(): void { ++this.noteRequest; this.stopVoices(); this.clearRoomTail(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.noteRequest;
    this.loadingAbort?.abort(); this.loadingAbort = null;
    if (this.loadingTimer !== null) clearTimeout(this.loadingTimer);
    this.loadingTimer = null; this.loading = null;
    this.stopVoices(); this.unsubscribe.forEach((off) => off());
    [this.dry, this.roomSend, this.room, this.master, this.compressor].forEach((node) => node?.disconnect());
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => { /* Browser already closed it. */ });
    this.buffers.clear(); this.roomImpulse = null;
    this.context = null; this.master = null; this.compressor = null; this.dry = null; this.roomSend = null; this.room = null;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    try {
      if (!this.context) {
        const Constructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) throw new Error("Audio unavailable");
        const context = new Constructor({ latencyHint: "interactive" });
        this.context = context;
        this.master = context.createGain(); this.master.gain.value = this.muted ? 0 : .75;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -12; this.compressor.knee.value = 12; this.compressor.ratio.value = 4;
        this.compressor.attack.value = .003; this.compressor.release.value = .2;
        this.master.connect(this.compressor); this.compressor.connect(context.destination);
        this.dry = context.createGain(); this.dry.gain.value = .92; this.dry.connect(this.master);
        this.roomSend = context.createGain(); this.roomSend.gain.value = .11;
        this.roomImpulse = this.makeRoomImpulse(context);
        this.clearRoomTail();
      }
      return this.context.state === "closed" ? null : this.context;
    } catch {
      this.audioState = { status: "error", error: "Audio is unavailable in this browser." }; this.publish(); return null;
    }
  }

  private async readyContext(): Promise<AudioContext | null> {
    const context = this.ensureContext();
    if (!context) return null;
    try {
      // This call happens before the first await, while the physical gesture is active.
      if (context.state !== "running") await context.resume();
      return !this.disposed && context === this.context && context.state === "running" ? context : null;
    } catch { return null; }
  }

  private loadSamples(context: AudioContext): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.buffers.size === PIANO_SAMPLES.length) {
      if (this.audioState.status !== "ready") { this.audioState = { status: "ready" }; this.publish(); }
      return Promise.resolve(true);
    }
    if (this.loading) return this.loading;
    this.audioState = { status: "loading" }; this.publish();
    const abort = new AbortController(); this.loadingAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 30000); this.loadingTimer = timeout;
    const missing = PIANO_SAMPLES.filter(({ url }) => !this.buffers.has(url));
    let next = 0, failed = false;
    const worker = async () => {
      while (next < missing.length && !abort.signal.aborted && !this.disposed) {
        const sample = missing[next++];
        try {
          const response = await fetch(sample.url, { signal: abort.signal });
          if (!response.ok) throw new Error("Sample unavailable");
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!buffer.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("Invalid sample");
          if (!this.disposed && context === this.context && !abort.signal.aborted) this.buffers.set(sample.url, buffer);
        } catch { failed = true; }
      }
    };
    this.loading = (async () => {
      try {
        await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
        if (this.disposed || context !== this.context) return false;
        const ready = !failed && !abort.signal.aborted && this.buffers.size === PIANO_SAMPLES.length;
        this.audioState = ready ? { status: "ready" } : { status: "error", error: "Piano sounds could not load. Please try again." };
        this.publish(); return ready;
      } finally {
        clearTimeout(timeout);
        if (this.loadingAbort === abort) { this.loadingAbort = null; this.loadingTimer = null; this.loading = null; }
      }
    })();
    return this.loading;
  }

  /** A short, diffuse stereo room; no recorded music or external reverb asset. */
  private makeRoomImpulse(context: AudioContext): AudioBuffer {
    const length = Math.ceil(context.sampleRate * .68);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    let seed = 7319;
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel); let filtered = 0;
      for (let index = Math.floor(context.sampleRate * .018); index < length; index++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        filtered = .6 * filtered + .4 * (seed / 4294967296 * 2 - 1);
        samples[index] = filtered * Math.exp(-7 * index / length);
      }
    }
    return impulse;
  }

  private clearRoomTail(): void {
    if (!this.context || !this.roomSend || !this.master || !this.roomImpulse || this.disposed) return;
    this.roomSend.disconnect(); this.room?.disconnect();
    this.room = this.context.createConvolver(); this.room.buffer = this.roomImpulse;
    this.roomSend.connect(this.room); this.room.connect(this.master);
  }

  private newVoice(kind: VoiceKind): Voice {
    if (this.voices.size >= 64) this.voices.values().next().value?.dispose();
    const voice: Voice = { kind, sources: [], nodes: [], dispose: () => {
      if (!this.voices.delete(voice)) return;
      voice.sources.forEach((source) => { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); });
      voice.nodes.forEach((node) => node.disconnect());
    } };
    this.voices.add(voice); return voice;
  }

  private stopVoices(kind?: VoiceKind): void {
    this.voices.forEach((voice) => { if (kind === undefined || voice.kind === kind) voice.dispose(); });
  }

  private publish(): void {
    if (!this.disposed) EventBus.dispatch("world-state", { muted: this.muted, pianoAudio: { ...this.audioState } });
  }
}
