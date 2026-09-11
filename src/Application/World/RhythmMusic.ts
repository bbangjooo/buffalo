import { EventBus } from '../UI/EventBus';

export type RhythmMusicStatus = 'unstarted' | 'cued' | 'playing' | 'paused' | 'buffering' | 'ended';
export interface RhythmMusicState {
  ready: boolean;
  playing: boolean;
  time: number;
  duration: number;
  playerState: RhythmMusicStatus;
  muted: boolean;
  error?: string;
}
export interface RhythmMusicAction {
  action: 'play' | 'pause' | 'restart' | 'stop' | 'mute';
  muted?: boolean;
}

export const initialRhythmMusicState = (): RhythmMusicState => ({
  ready: false, playing: false, time: 0, duration: 0, playerState: 'unstarted', muted: false,
});

const playbackDenied = (error: unknown) => Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'NotAllowedError');

/** Native, self-hosted audio supplies the rhythm game's only music clock. */
export default class RhythmMusic {
  private readonly audio: HTMLAudioElement;
  private readonly offAction: () => void;
  private readonly offRequest: () => void;
  private readonly listeners: [string, EventListener][] = [];
  private readonly previousHidden: boolean;
  private readonly previousDisplay: string;
  private state = initialRhythmMusicState();
  private disposed = false;
  private generation = 0;
  private wantPlaying = false;
  private started = false;
  private waiting = false;
  private finished = false;
  private frame = 0;
  private readyTimer = 0;

  constructor(private host: HTMLElement, private track: { audioUrl: string; title: string; duration: number }, muted = false) {
    this.previousHidden = host.hidden;
    this.previousDisplay = host.style.display;
    host.hidden = true; host.style.display = 'none';
    this.audio = document.createElement('audio');
    this.audio.title = track.title;
    this.audio.preload = 'auto';
    this.audio.controls = false;
    this.audio.autoplay = false;
    this.audio.hidden = true;
    this.audio.tabIndex = -1;
    this.audio.setAttribute('aria-hidden', 'true');
    this.audio.muted = muted;
    this.state.muted = muted;
    host.appendChild(this.audio);
    this.listen('loadedmetadata', () => this.sample());
    this.listen('durationchange', () => this.sample());
    this.listen('canplay', () => this.canPlay());
    this.listen('canplaythrough', () => this.canPlay());
    this.listen('playing', () => {
      if (!this.wantPlaying) { this.audio.pause(); this.sample(); return; }
      this.started = true; this.waiting = false; this.clearTimeout();
      this.state.ready = true; this.state.error = undefined;
      this.sample(); this.startFrame();
    });
    this.listen('pause', () => {
      // A delayed pause event from a restart must not cancel a newer play.
      if (!this.audio.paused) return;
      this.wantPlaying = false; this.started = false; this.waiting = false;
      ++this.generation; this.stopFrame(); this.clearTimeout(); this.sample();
    });
    this.listen('waiting', () => {
      if (!this.wantPlaying) return;
      this.waiting = true; this.startTimeout(); this.sample(); this.startFrame();
    });
    this.listen('seeking', () => { this.waiting = this.wantPlaying; this.sample(); });
    this.listen('seeked', () => { this.waiting = false; this.sample(); this.startFrame(); });
    this.listen('timeupdate', () => this.sample());
    this.listen('ended', () => this.finish());
    this.listen('volumechange', () => { this.state.muted = this.audio.muted; this.publish(); });
    this.listen('error', () => {
      if (!this.audio.error) return;
      this.fail(this.audio.error.code === 3 || this.audio.error.code === 4
        ? 'This audio could not be decoded. Please retry the music.'
        : 'The music could not load. Please retry.');
    });
    this.offAction = EventBus.on('rhythm-music-action', (action: RhythmMusicAction) => this.action(action));
    this.offRequest = EventBus.on('rhythm-music-request-state', () => this.sample());
    this.load();
  }

  private listen(type: string, callback: () => void) {
    const listener = () => { if (!this.disposed) callback(); };
    this.listeners.push([type, listener]); this.audio.addEventListener(type, listener);
  }

  private load() {
    if (this.disposed) return;
    ++this.generation; this.wantPlaying = false; this.started = false; this.waiting = false; this.finished = false;
    this.stopFrame(); this.clearTimeout();
    this.state = { ...this.state, ready: false, playing: false, time: 0, duration: this.duration(), playerState: 'unstarted', error: undefined };
    this.audio.pause();
    this.startTimeout(); this.publish();
    try {
      this.audio.src = this.track.audioUrl;
      this.audio.load();
      if (this.audio.readyState >= 3) this.canPlay();
    } catch { this.fail('The music could not load. Please retry.'); }
  }

  private action(action: RhythmMusicAction) {
    if (this.disposed) return;
    if (action.action === 'mute') {
      this.audio.muted = Boolean(action.muted); this.state.muted = this.audio.muted; this.publish(); return;
    }
    if (action.action === 'pause' || action.action === 'stop') {
      ++this.generation; this.wantPlaying = false; this.started = false; this.waiting = false;
      this.stopFrame();
      if (action.action === 'stop') {
        this.finished = false;
        try { this.audio.currentTime = 0; } catch { /* Metadata may not be available yet. */ }
        this.state.time = 0;
      }
      this.state.playerState = action.action === 'stop' && this.state.ready ? 'cued' : 'paused';
      this.audio.pause(); this.sample(); return;
    }
    if (!this.state.ready) {
      // Loading requires a separate ready event; never queue a surprise start.
      if (this.state.error) this.load();
      return;
    }
    const request = ++this.generation;
    this.wantPlaying = true; this.started = false; this.waiting = false;
    this.state.error = undefined;
    try {
      if (action.action === 'restart' || this.finished) { this.finished = false; this.audio.currentTime = 0; }
      this.state.playerState = 'buffering'; this.state.playing = false;
      // Invoke before any await or microtask so the caller's input gesture is kept.
      const playing = this.audio.play();
      this.sample(); this.startFrame();
      void Promise.resolve(playing).then(() => {
        if (this.disposed || request !== this.generation) {
          if (this.disposed || !this.wantPlaying) this.audio.pause();
          return;
        }
        this.started = true; this.waiting = false;
        this.sample(); this.startFrame();
      }).catch((error: unknown) => {
        if (this.disposed || request !== this.generation) return;
        const blocked = playbackDenied(error);
        this.fail(blocked ? 'Playback was blocked. Press Start or Resume to try again.' : 'The music could not start. Please retry.', blocked);
      });
    } catch (error) {
      const blocked = playbackDenied(error);
      this.fail(blocked ? 'Playback was blocked. Press Start or Resume to try again.' : 'The music could not start. Please retry.', blocked);
    }
  }

  private canPlay() {
    if (this.audio.readyState < 3) return;
    this.clearTimeout(); this.waiting = false;
    this.state.ready = true; this.state.error = undefined;
    if (!this.wantPlaying && !this.finished && this.audio.currentTime === 0) this.state.playerState = 'cued';
    this.sample(); this.startFrame();
  }

  private duration() {
    const segment = Number.isFinite(this.track.duration) && this.track.duration > 0 ? this.track.duration : 0;
    const file = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : 0;
    return segment && file ? Math.min(segment, file) : segment || file;
  }

  private sample() {
    if (this.disposed) return;
    const duration = this.duration();
    const rawTime = Number.isFinite(this.audio.currentTime) ? Math.max(0, this.audio.currentTime) : this.state.time;
    if (this.state.ready && !this.finished && duration > 0 && (this.audio.ended || rawTime >= duration)) { this.finish(); return; }
    const playing = this.wantPlaying && this.started && !this.waiting && !this.audio.seeking && !this.audio.paused && !this.finished;
    const playerState: RhythmMusicStatus = this.finished ? 'ended'
      : this.wantPlaying ? (playing ? 'playing' : 'buffering')
        : !this.state.ready ? 'unstarted' : this.state.playerState === 'cued' && rawTime === 0 ? 'cued' : 'paused';
    this.state = {
      ...this.state, duration, time: this.finished ? duration : duration ? Math.min(rawTime, duration) : rawTime,
      playing, playerState, muted: this.audio.muted,
    };
    this.publish();
  }

  private finish() {
    if (this.disposed || this.finished) return;
    ++this.generation; this.finished = true; this.wantPlaying = false; this.started = false; this.waiting = false;
    this.stopFrame(); this.clearTimeout();
    const duration = this.duration();
    this.audio.pause();
    if (duration > 0 && this.audio.currentTime > duration) {
      try { this.audio.currentTime = duration; } catch { /* Keep the published segment endpoint. */ }
    }
    this.state = { ...this.state, playing: false, time: duration, duration, playerState: 'ended' };
    this.publish();
  }

  private startFrame() {
    if (!this.disposed && this.wantPlaying && !this.audio.paused && !this.frame) this.frame = window.requestAnimationFrame(this.tick);
  }
  private stopFrame() { if (this.frame) window.cancelAnimationFrame(this.frame); this.frame = 0; }
  private tick = () => { this.frame = 0; this.sample(); this.startFrame(); };
  private startTimeout() {
    if (!this.readyTimer) this.readyTimer = window.setTimeout(() => this.fail('The music is taking too long to load. Please retry.'), 20000);
  }
  private clearTimeout() { if (this.readyTimer) window.clearTimeout(this.readyTimer); this.readyTimer = 0; }

  private fail(error: string, canRetryPlay = false) {
    if (this.disposed) return;
    ++this.generation; this.wantPlaying = false; this.started = false; this.waiting = false;
    this.stopFrame(); this.clearTimeout();
    this.state = { ...this.state, ready: canRetryPlay && this.state.ready, playing: false, playerState: 'paused', error };
    this.audio.pause(); this.publish();
  }

  private publish() { if (!this.disposed) EventBus.dispatch('rhythm-music-state', { ...this.state }); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.generation; this.wantPlaying = false;
    this.offAction(); this.offRequest(); this.stopFrame(); this.clearTimeout();
    this.listeners.forEach(([type, listener]) => this.audio.removeEventListener(type, listener));
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio.remove();
    this.host.hidden = this.previousHidden; this.host.style.display = this.previousDisplay;
  }
}
