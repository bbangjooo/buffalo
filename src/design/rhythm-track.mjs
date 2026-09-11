/** Shared runtime data for the browser and production Node Functions. */
/** Native audio owns playback; these values describe the licensed track's clock. */
export const TRACK = {
  id: 'lasso-lady-four-key-v1',
  title: 'Lasso Lady',
  artist: 'congusbongus',
  audioUrl: '/audio/rhythm/lasso-lady.mp3',
  bpm: 140,
  duration: 73.723923,
  // Two bars to prepare. The 12ms phase comes from this recording's attacks;
  // the Timing control remains available for device/output latency.
  firstNoteTime: .012 + 8 * 60 / 140,
  countdownSeconds: .012 + 8 * 60 / 140,
  approachSeconds: 2.4,
};

export const RHYTHM_MAX_SCORE = 1_000_000;

/**
 * An original, moderate-density four-key arrangement, not a Pump It Up chart.
 * Quarter-note hand alternation uses D/F and J/K, with a few eighth notes
 * and distinct two-key accents. Mirrored eight-bar phrases balance both hands.
 */
export function createOriginalChart() {
  const phrases = [
    [[0, [0]], [1, [2]], [2, [1]], [3, [3]]],
    [[0, [1]], [1.5, [3]], [3, [0]]],
    [[0, [2]], [1, [0]], [2, [3]], [3, [1]]],
    [[0, [0, 2]], [2, [1]], [3, [3]]],
    [[0, [0]], [1, [2]], [2, [1]], [2.5, [3]], [3, [0]]],
    [[0, [3]], [1.5, [1]], [3, [2]]],
    [[0, [1]], [1, [3]], [2, [0]], [3, [2]]],
    [[0, [1, 3]], [2, [2]], [3, [0]]],
  ];
  const beatSeconds = 60 / TRACK.bpm;
  const notes = [];
  const lastNoteTime = TRACK.duration - 3;
  for (let bar = 0; ; bar++) {
    const barTime = TRACK.firstNoteTime + bar * 4 * beatSeconds;
    if (barTime > lastNoteTime) break;
    const phrase = phrases[bar % phrases.length];
    for (const [beat, lanes] of phrase) {
      const time = barTime + beat * beatSeconds;
      if (time > lastNoteTime) continue;
      for (const lane of lanes) {
        const balancedLane = Math.floor(bar / phrases.length) % 2 ? 3 - lane : lane;
        notes.push({ id: `note-${notes.length}`, lane: balancedLane, time });
      }
    }
  }
  return notes;
}
