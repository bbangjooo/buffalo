// Open /scripts/render-piano.html on Vite; run scripts/receive-piano-render.py first.
// This authoring-only adapter reuses the real instrument graph and strike envelope.
import { AudioPlayer } from '/src/Application/AudioPlayer.ts';
import { PIANO_SAMPLES } from '/src/design/piano-samples.ts';

const status = document.querySelector('#status');
document.querySelector('#render').onclick = async () => {
  document.querySelector('#render').disabled = true;
  const OriginalContext = window.AudioContext;
  try {
    const score = await (await fetch('/Piano/en-avril-a-paris.json')).json();
    const context = new OfflineAudioContext(2, Math.ceil((score.duration + 1) * 44100), 44100);
    window.AudioContext = class { constructor() { return context; } };
    const instrument = new AudioPlayer();
    instrument.ensureContext();
    window.AudioContext = OriginalContext;
    let next = 0, decoded = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < PIANO_SAMPLES.length) {
        const sample = PIANO_SAMPLES[next++];
        // Render from the higher-quality original bank, not its compact derivative.
        const response = await fetch('/audio/piano/' + sample.url.split('/').pop());
        if (!response.ok) throw new Error('Sample unavailable');
        instrument.buffers.set(sample.url, await context.decodeAudioData(await response.arrayBuffer()));
        status.textContent = `Preparing ${++decoded} / ${PIANO_SAMPLES.length} recordings`;
      }
    }));
    // Offline scheduling registers the whole song in advance. The live 64-voice
    // cap would incorrectly discard future scheduled notes, so use offline ownership.
    instrument.newVoice = () => {
      const voice = { sources: [], nodes: [], dispose: () => {
        voice.sources.forEach(source => { source.onended = null; source.disconnect(); });
        voice.nodes.forEach(node => node.disconnect());
      } };
      return voice;
    };
    for (const note of score.notes) instrument.strike(context, note.midi, note.velocity, note.time, 'score', note.soundDuration ?? note.duration);
    status.textContent = `Rendering ${score.notes.length} notes…`;
    const audio = await context.startRendering();
    const wav = new ArrayBuffer(44 + audio.length * 4);
    const view = new DataView(wav);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 176400, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, wav.byteLength - 44, true);
    const left = audio.getChannelData(0), right = audio.getChannelData(1);
    let peak = 0;
    for (let i = 0; i < audio.length; i++) for (let channel = 0; channel < 2; channel++) {
      const value = (channel ? right : left)[i]; peak = Math.max(peak, Math.abs(value));
      view.setInt16(44 + (i * 2 + channel) * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
    }
    if (peak >= 1) throw new Error('Rendered signal clips; lower the render gain before exporting.');
    const response = await fetch('http://127.0.0.1:5182/render.wav', { method: 'POST', body: wav });
    if (!response.ok) throw new Error('Could not save render');
    status.textContent = `Saved render.wav\n${audio.duration.toFixed(3)} seconds · ${score.notes.length} notes · stereo 44.1 kHz\nPeak: ${peak.toFixed(4)}\nNo sound was played.`;
  } catch (error) { status.textContent = `Failed: ${error.message}`; }
  finally { window.AudioContext = OriginalContext; document.querySelector('#render').disabled = false; }
};
