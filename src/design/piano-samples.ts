// BEGIN GENERATED BANK
export const PIANO_BANK_PATH = '/audio/piano/compact-88aebbf569b9';
const SAMPLE_BYTES = [55995, 63663, 57797, 62425, 60846, 69016, 62368, 68057, 62108, 69939, 61807, 71564, 64904, 69911, 61558, 69779, 64017, 71697, 58135, 64820, 62111, 66380, 56403, 66495, 56840, 67974, 61005, 70171, 54636, 60185, 51092, 59165, 49538, 55234, 48580, 53016, 46848, 51917, 42205, 46615, 39164, 45132, 31126, 41364, 38544, 42480, 28815, 33192, 32010, 33057, 21038, 23931, 23584, 27728, 27438, 33199, 19894, 21773, 17902, 24462];
// END GENERATED BANK
/** Alexander Holm's Salamander Grand Piano V3; credits: /audio/piano/. */
export type PianoSample = { midi: number; layer: 5 | 11; url: string; bytes: number };

const PITCH_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
export const PIANO_SAMPLE_ROOTS = Array.from({ length: 30 }, (_, index) => 21 + index * 3);
export const PIANO_SAMPLES = PIANO_SAMPLE_ROOTS.reduce<PianoSample[]>((samples, midi) => {
  const name = `${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  for (const layer of [5, 11] as const) samples.push({ midi, layer, url: `${PIANO_BANK_PATH}/v${layer}-${name}.mp3`, bytes: SAMPLE_BYTES[samples.length] });
  return samples;
}, []);

// The 3D keyboard exposes MIDI 60–83; the last B uses the nearest C6 root.
export const PIANO_INTERACTIVE_SAMPLES = PIANO_SAMPLES.filter(sample => sample.midi >= 60 && sample.midi <= 84);

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
