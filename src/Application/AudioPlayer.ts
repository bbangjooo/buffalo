import { EventBus } from "./UI/EventBus";

type VoiceKind = "interactive" | "score";

type Voice = {
  kind: VoiceKind;
  oscillators: OscillatorNode[];
  nodes: AudioNode[];
  dispose: () => void;
};

export class AudioPlayer {
  muted = false;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
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

  async toggle(): Promise<void> {
    if (this.disposed) return;
    this.muted = !this.muted;
    ++this.noteRequest;
    if (this.master && this.context) {
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.7, this.context.currentTime);
    }
    if (this.muted) {
      this.stopVoices();
    }
    this.publish();
  }

  /** Call from the playback gesture before scheduling against currentTime. */
  async unlock(): Promise<boolean> {
    if (this.disposed || this.muted) return false;
    const request = this.noteRequest;
    const context = await this.readyContext();
    return !!context && !this.disposed && !this.muted && request === this.noteRequest;
  }

  get currentTime(): number { return this.context?.currentTime ?? 0; }

  async playNote(midi: number, velocity = 0.75): Promise<void> {
    if (this.disposed || this.muted || !Number.isFinite(midi) || !Number.isFinite(velocity)) return;
    if (midi < 0 || midi > 127 || velocity <= 0) return;
    const request = this.noteRequest;
    const interactiveRequest = this.interactiveRequest;
    const context = await this.readyContext();
    if (!context || this.disposed || this.muted || request !== this.noteRequest ||
      interactiveRequest !== this.interactiveRequest) return;

    this.strike(context, midi, velocity, context.currentTime, "interactive");
  }

  /** Absolute AudioContext seconds; note-off starts a short damped release. */
  scheduleNote(midi: number, velocity: number, startTime: number, duration: number): void {
    const context = this.context;
    if (this.disposed || this.muted || !context || context.state !== "running") return;
    if (![midi, velocity, startTime, duration].every(Number.isFinite)) return;
    if (midi < 0 || midi > 127 || velocity <= 0 || startTime < 0 || duration <= 0) return;
    const noteOff = startTime + duration;
    if (!Number.isFinite(noteOff) || noteOff <= context.currentTime) return;
    // A delayed transport must not replay elapsed notes or extend their ends.
    const start = Math.max(startTime, context.currentTime);
    if (noteOff <= start) return;
    this.strike(context, midi, velocity, start, "score", noteOff - start);
  }

  private strike(context: AudioContext, midi: number, velocity: number, start: number, kind: VoiceKind, duration?: number): void {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const strength = Math.min(1, velocity);
    const decay = Math.min(3.2, Math.max(1.4, 2.4 * Math.pow(220 / frequency, 0.2)));
    const voice = this.newVoice(kind);
    const body = context.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.setValueAtTime(Math.min(9000, 2200 + frequency * 3), start);
    body.frequency.exponentialRampToValueAtTime(Math.min(6000, 1100 + frequency * 2), start + 0.3);
    body.Q.value = 0.35;
    body.connect(this.master!);
    voice.nodes.push(body);

    // The upper partials fade first, leaving a soft resonant body after the strike.
    const partials = [
      { multiple: 1, volume: 0.12, length: 1, type: "triangle" as OscillatorType },
      { multiple: 2, volume: 0.037, length: 0.62, type: "sine" as OscillatorType },
      { multiple: 3, volume: 0.017, length: 0.38, type: "sine" as OscillatorType },
      { multiple: 4, volume: 0.006, length: 0.18, type: "sine" as OscillatorType },
    ];
    partials.forEach((partial, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const naturalLength = decay * partial.length;
      const heldLength = duration === undefined ? naturalLength : duration;
      const kneeLength = 0.12 * partial.length;
      const attackLength = Math.min(0.004, heldLength * 0.25);
      const end = start + heldLength;
      const peak = Math.max(1e-9, partial.volume * strength);
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(frequency * partial.multiple, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(peak, start + attackLength);

      // Retain the existing piano decay, cutting it at the score's actual note-off.
      // Very short notes release after their attack, without out-of-order ramps.
      if (heldLength >= kneeLength) {
        envelope.gain.exponentialRampToValueAtTime(peak * 0.45, start + kneeLength);
      }
      const decayProgress = Math.min(1, Math.max(0, (heldLength - kneeLength) / (naturalLength - kneeLength)));
      const releaseLevel = heldLength < kneeLength
        ? peak * Math.pow(0.45, (heldLength - attackLength) / (kneeLength - attackLength))
        : peak * 0.45 * Math.pow(0.001 / 0.45, decayProgress);
      envelope.gain.exponentialRampToValueAtTime(releaseLevel, start + Math.min(heldLength, naturalLength));
      if (heldLength > naturalLength) envelope.gain.setValueAtTime(releaseLevel, end);
      const release = duration === undefined ? 0 : 0.08 + partial.length * 0.12;
      if (release > 0) envelope.gain.exponentialRampToValueAtTime(releaseLevel * 0.001, end + release);
      envelope.gain.linearRampToValueAtTime(0, end + release + 0.02);
      oscillator.connect(envelope);
      envelope.connect(body);
      voice.oscillators.push(oscillator);
      voice.nodes.push(envelope);
      // The fundamental has the longest tail and owns complete voice cleanup.
      if (index === 0) oscillator.onended = voice.dispose;
      oscillator.start(start);
      oscillator.stop(end + release + 0.025);
    });
  }

  /** Cancel room interactions, including pending input, while score playback continues. */
  stopInteractiveNotes(): void {
    ++this.interactiveRequest;
    this.stopVoices("interactive");
  }

  stopNotes(): void {
    ++this.noteRequest;
    this.stopVoices();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.noteRequest;
    this.stopVoices();
    this.unsubscribe.forEach((off) => off());
    this.master?.disconnect();
    this.compressor?.disconnect();
    if (this.context && this.context.state !== "closed") {
      void this.context.close().catch(() => { /* Already closed by the browser. */ });
    }
    this.context = null;
    this.master = null;
    this.compressor = null;
  }

  private async readyContext(): Promise<AudioContext | null> {
    try {
      if (this.disposed) return null;
      if (!this.context) {
        const AudioContextConstructor = window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) return null;
        const context = new AudioContextConstructor({ latencyHint: "interactive" });
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.2;
        this.master.connect(this.compressor);
        this.compressor.connect(context.destination);
      }
      const context = this.context;
      // Called before the first await, while the physical input gesture is active.
      if (context.state !== "running") await context.resume();
      return !this.disposed && context === this.context && context.state === "running" ? context : null;
    } catch {
      return null;
    }
  }

  private newVoice(kind: VoiceKind): Voice {
    if (this.voices.size >= 64) this.voices.values().next().value?.dispose();
    const voice: Voice = {
      kind,
      oscillators: [],
      nodes: [],
      dispose: () => {
        if (!this.voices.delete(voice)) return;
        voice.oscillators.forEach((oscillator) => {
          oscillator.onended = null;
          try { oscillator.stop(); } catch { /* Already ended. */ }
          oscillator.disconnect();
        });
        voice.nodes.forEach((node) => node.disconnect());
      },
    };
    this.voices.add(voice);
    return voice;
  }

  private stopVoices(kind?: VoiceKind): void {
    this.voices.forEach((voice) => {
      if (kind === undefined || voice.kind === kind) voice.dispose();
    });
  }

  private publish(): void {
    if (!this.disposed) EventBus.dispatch("world-state", {
      muted: this.muted,
    });
  }
}
