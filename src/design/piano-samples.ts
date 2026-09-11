/** Alexander Holm's Salamander Grand Piano V3; credits: /audio/piano/. */
export type PianoSample = { midi: number; layer: 5 | 11; url: string };

const PITCH_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
export const PIANO_SAMPLE_ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
export const PIANO_SAMPLES = PIANO_SAMPLE_ROOTS.reduce<PianoSample[]>((samples, midi) => {
  const name = `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  for (const layer of [5, 11] as const) samples.push({ midi, layer, url: `/audio/piano/v${layer}-${name}.mp3` });
  return samples;
}, []);

/** Adjacent semitones keep their original pitch; velocity changes timbre as well as gain. */
export function pianoSampleMix(midi: number, velocity: number): { sample: PianoSample; gain: number }[] {
  const index = Math.max(0, Math.min(PIANO_SAMPLE_ROOTS.length - 1, Math.round((midi - 21) / 3)));
  const blend = Math.max(0, Math.min(1, (velocity - .45) / .4));
  const mix = [
    { sample: PIANO_SAMPLES[index * 2], gain: Math.cos(blend * Math.PI / 2) },
    { sample: PIANO_SAMPLES[index * 2 + 1], gain: Math.sin(blend * Math.PI / 2) },
  ];
  return mix.filter(({ gain }) => gain > .0001);
}
