export type PianoKey = {
  midi: number;
  note: string;
  octave: number;
  key: string;
  code: string;
  black: boolean;
  whiteIndex?: number;
  blackAfter?: number;
};

// Keep the playable panel and physical keyboard shortcuts on the same pitches.
export const PIANO_KEYS: PianoKey[] = [
  { midi: 60, note: 'C', octave: 4, key: 'A', code: 'KeyA', black: false, whiteIndex: 0 },
  { midi: 61, note: 'C♯', octave: 4, key: 'W', code: 'KeyW', black: true, blackAfter: 0 },
  { midi: 62, note: 'D', octave: 4, key: 'S', code: 'KeyS', black: false, whiteIndex: 1 },
  { midi: 63, note: 'D♯', octave: 4, key: 'E', code: 'KeyE', black: true, blackAfter: 1 },
  { midi: 64, note: 'E', octave: 4, key: 'D', code: 'KeyD', black: false, whiteIndex: 2 },
  { midi: 65, note: 'F', octave: 4, key: 'F', code: 'KeyF', black: false, whiteIndex: 3 },
  { midi: 66, note: 'F♯', octave: 4, key: 'T', code: 'KeyT', black: true, blackAfter: 3 },
  { midi: 67, note: 'G', octave: 4, key: 'G', code: 'KeyG', black: false, whiteIndex: 4 },
  { midi: 68, note: 'G♯', octave: 4, key: 'Y', code: 'KeyY', black: true, blackAfter: 4 },
  { midi: 69, note: 'A', octave: 4, key: 'H', code: 'KeyH', black: false, whiteIndex: 5 },
  { midi: 70, note: 'A♯', octave: 4, key: 'U', code: 'KeyU', black: true, blackAfter: 5 },
  { midi: 71, note: 'B', octave: 4, key: 'J', code: 'KeyJ', black: false, whiteIndex: 6 },
  { midi: 72, note: 'C', octave: 5, key: 'K', code: 'KeyK', black: false, whiteIndex: 7 },
];

export function pianoMidiForKeyboard(event: Pick<KeyboardEvent, 'code' | 'key'>): number | undefined {
  // Physical positions also work with the Korean input method selected.
  const key = PIANO_KEYS.find((entry) => entry.code === event.code)
    || PIANO_KEYS.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
  return key?.midi;
}
