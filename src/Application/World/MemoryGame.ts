export type GamePhase = 'idle' | 'showing' | 'input' | 'won' | 'lost';

export interface GameState {
  phase: GamePhase;
  round: number;
  totalRounds: number;
  sequenceLength: number;
  inputIndex: number;
  best: number;
  lastPad: number | null;
}

export interface MemoryGameOptions {
  onPad: (index: number, on: boolean) => void;
  onState: (state: GameState) => void;
  onResult: (result: 'won' | 'lost') => void;
  random?: () => number;
}

const TOTAL_ROUNDS = 5;
const STORAGE_KEY = 'bbangjo.memory.best';
const PAD_ON_MS = 450;
const PAD_GAP_MS = 180;

/** Four physical pads, one cumulative sequence, and no input before playback ends. */
export default class MemoryGame {
  private readonly options: MemoryGameOptions;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly litPads = new Set<number>();
  private sequence: number[] = [];
  private generation = 0;
  private pressGeneration = 0;
  private disposed = false;
  private snapshot: GameState;

  constructor(options: MemoryGameOptions) {
    this.options = options;
    this.snapshot = {
      phase: 'idle', round: 0, totalRounds: TOTAL_ROUNDS,
      sequenceLength: 0, inputIndex: 0, best: this.readBest(), lastPad: null,
    };
  }

  get state(): GameState { return this.getSnapshot(); }

  getSnapshot(): GameState { return { ...this.snapshot }; }

  start() {
    if (this.disposed) return;
    this.clearPending();
    this.sequence = [];
    this.snapshot = { ...this.snapshot, phase: 'showing', round: 0, sequenceLength: 0, inputIndex: 0, lastPad: null };
    this.nextRound();
  }

  press(index: number) {
    if (this.disposed || this.snapshot.phase !== 'input'
      || !Number.isInteger(index) || index < 0 || index > 3) return;

    const correct = index === this.sequence[this.snapshot.inputIndex];
    const pressGeneration = ++this.pressGeneration;
    this.allPadsOff();
    this.setPad(index, true);

    if (!correct) {
      this.snapshot = { ...this.snapshot, phase: 'lost' };
      this.publish();
      this.later(() => {
        if (pressGeneration !== this.pressGeneration) return;
        this.setPad(index, false);
        this.publish();
      }, 280);
      this.options.onResult('lost');
      return;
    }

    this.snapshot = { ...this.snapshot, inputIndex: this.snapshot.inputIndex + 1 };
    const roundComplete = this.snapshot.inputIndex === this.sequence.length;
    if (roundComplete) {
      this.recordBest(this.snapshot.round);
      this.snapshot = { ...this.snapshot, phase: this.snapshot.round === TOTAL_ROUNDS ? 'won' : 'showing' };
    }
    this.publish();
    this.later(() => {
      if (pressGeneration !== this.pressGeneration) return;
      this.setPad(index, false);
      this.publish();
    }, 160);

    if (!roundComplete) return;
    if (this.snapshot.phase === 'won') {
      this.options.onResult('won');
    } else {
      this.later(() => this.nextRound(), 600);
    }
  }

  cancel() {
    if (this.disposed) return;
    this.clearPending();
    this.sequence = [];
    this.snapshot = { ...this.snapshot, phase: 'idle', round: 0, sequenceLength: 0, inputIndex: 0, lastPad: null };
    this.publish();
  }

  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  private nextRound() {
    // Retire short player-feedback timers before replaying the new sequence.
    this.clearPending();
    this.sequence.push(this.nextPad());
    this.snapshot = {
      ...this.snapshot, phase: 'showing', round: this.sequence.length,
      sequenceLength: this.sequence.length, inputIndex: 0, lastPad: null,
    };
    this.publish();
    this.showStep(0);
  }

  private showStep(step: number) {
    if (step >= this.sequence.length) {
      this.snapshot = { ...this.snapshot, phase: 'input', lastPad: null };
      this.publish();
      return;
    }
    const index = this.sequence[step];
    this.setPad(index, true);
    this.publish();
    this.later(() => {
      this.setPad(index, false);
      this.publish();
      this.later(() => this.showStep(step + 1), PAD_GAP_MS);
    }, PAD_ON_MS);
  }

  private nextPad(): number {
    let value = 0;
    try { value = (this.options.random || Math.random)(); } catch { /* A failed random source still yields a playable pad. */ }
    return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value * 4))) : 0;
  }

  private setPad(index: number, on: boolean) {
    if (on) this.litPads.add(index);
    else this.litPads.delete(index);
    this.snapshot = { ...this.snapshot, lastPad: on ? index : this.snapshot.lastPad === index ? null : this.snapshot.lastPad };
    this.options.onPad(index, on);
  }

  private allPadsOff() {
    this.litPads.forEach((index) => this.setPad(index, false));
  }

  private later(callback: () => void, delay: number) {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed && generation === this.generation) callback();
    }, delay);
    this.timers.add(timer);
  }

  private clearPending() {
    this.generation++;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.allPadsOff();
  }

  private publish() { this.options.onState(this.getSnapshot()); }

  private readBest(): number {
    try {
      const best = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isInteger(best) && best >= 0 && best <= TOTAL_ROUNDS ? best : 0;
    } catch { return 0; }
  }

  private recordBest(round: number) {
    if (round <= this.snapshot.best) return;
    this.snapshot = { ...this.snapshot, best: round };
    try { localStorage.setItem(STORAGE_KEY, String(round)); } catch { /* Private browsing may disallow persistence. */ }
  }
}
