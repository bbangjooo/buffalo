# Sampled piano audio

## Source and license

- Instrument: Salamander Grand Piano V3, Alexander Holm; a sampled Yamaha C5 grand piano.
- Sample license: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, verified against the [upstream README and LICENSE](https://github.com/sfzinstruments/SalamanderGrandPiano/tree/3382bf9496bba2486f5ab0de55a264d1dfc38404) and the [SFZ Instruments catalog](https://sfzinstruments.github.io/pianos/salamander/).
- MP3 distribution: Jan Forst / darosh, [samples-piano-mp3](https://github.com/darosh/samples-piano-mp3/tree/9ec2c634691bd9071b525b6fd231abdbba1589bf); `@audio-samples/piano-mp3-velocity5@1.0.5` and `@audio-samples/piano-mp3-velocity11@1.0.5`.
- The distribution repository's MIT packaging license does not change the sample recordings' CC BY 3.0 license. Both license notices are stored in `public/audio/piano/`.
- Visible credits: the header's **Information → Credits** menu opens `/audio/piano/index.html` in a new tab. The explicit filename avoids Vite development's main-page fallback for `/audio/piano/`. The menu supports keyboard navigation, Escape dismissal and focus restoration; sample credits are reached from this shared menu. Full local attribution remains at `public/audio/piano/README.md`, and the attribution content and license files remain unchanged.

## Acquisition and transformations

Retrieved on 2026-09-10 from the versioned npm registry archives. SHA-512 archive integrity was checked against each package's registry metadata. The original MP3 files total 11,103,588 bytes. Sixty samples cover two original velocity layers (5 and 11), with 30 roots per layer at MIDI 21, 24, 27, …, 108. Nearest-root playback covers the 88-key range with at most one semitone of transposition.

Naming: `/audio/piano/v{5|11}-{note}.mp3`, where notes are `A0`, `C1`, `Ds1`, `Fs1`, `A1`, …, `A7`, `C8`. `s` represents a sharp in the local filename only; manifest note names use normal sharp spelling.

Long notes are capped at 8 seconds and faded over the final 0.4 seconds to bound decoded memory while preserving the score's longest note (about 5.08 seconds). Shorter recordings keep their original bytes. The adaptation is disclosed in both visible and file-level credits.

Conversion command:

```sh
ffmpeg -i INPUT -t 8 -af afade=t=out:st=7.6:d=0.4 -c:a libmp3lame -q:a 2 -ar 44100 -ac 2 -map_metadata -1 OUTPUT
```

`public/audio/piano/manifest.json` records exact acquisition URLs and archive members, original/derived SHA-256 hashes and sizes, measured channels/sample rate/duration, package integrity, and the conversion tool version. This process adds no project dependencies and does not redistribute any YouTube performance audio.

## Runtime

`AudioPlayer` now uses native Web Audio `AudioBufferSourceNode` playback. There is no oscillator fallback. Each note chooses the closest recorded root, transposes with `2 ** ((midi - rootMidi) / 12)`, and blends the soft/bright recordings across middle velocities. Note velocity controls both timbre and gain. The original recording supplies the hammer attack, resonant partials, stereo image, and decay.

The existing public APIs remain: `playNote`, `unlock`, `currentTime`, `scheduleNote`, `stopInteractiveNotes`, `stopNotes`, `toggle`, and `dispose`. `scheduleNote` still accepts absolute AudioContext seconds and a sounding duration. The transport continues to pass `soundDuration` when present, independently of the key animation's physical `duration`. A late scheduled note enters the recording at its elapsed position and retains the originally scheduled note-off; pause/resume uses the existing transport's re-attack behavior.

The gain envelope adds a short anti-click attack and a 120–220ms damped release at score note-off. It does not synthesize a decay over the recording. Recordings play once rather than looping; the natural tail or eight-second adaptation ends even if a caller requests a longer hold. A quiet 680ms stereo convolution room sits beside the dry signal, followed by the existing compressor. The room impulse is generated noise, not a musical recording. Global stop and mute disconnect its previous tail immediately.

`preload(): Promise<boolean>` loads and decodes the bank without resuming the AudioContext or playing a note. Room-entry integration can call it to warm the cache. `unlock()` invokes `context.resume()` synchronously while the user's gesture is active, then waits for the bank. A failed fetch, decode, or timeout returns `false`, publishes an English retry message, and retains successfully decoded files for the next attempt. `world-state.pianoAudio` reports `idle`, `loading`, `ready`, or `error`; it never pretends a mechanical fallback is ready.

Loading uses at most four fetch/decode workers and one shared promise, with a 30-second timeout. Disposal aborts downloads, clears that timer, disconnects all voices and output nodes, closes the context, and discards decoded samples. Pending resumes, loads, and interactive strikes retain independent cancellation generations. `stopInteractiveNotes()` leaves score voices running; global stop, mute, and dispose cancel both channels. The voice limit is 64 notes, each using at most two sample sources.

The final bank is **5,966,897 bytes** on disk (about 5.69MiB). Full decoded stereo buffers use approximately **144.25MiB at 44.1kHz** or **157.01MiB at 48kHz**, plus Web Audio overhead. They are loaded only when the piano is requested; this is a deliberate timbre/coverage tradeoff. The bank covers every authored En avril pitch (MIDI29–106) with at most one semitone of transposition and preserves all supplied sounding durations up to about 5.08 seconds.

## Verification

- `node scripts/verify-audio-channels.cjs` exercises the real transpiled AudioPlayer with controlled Web Audio nodes, asynchronous loading, and timers. It verifies pitch/velocity mapping, absolute starts and note-offs, late offsets, cancellation during resume/load, independent voice channels, error/retry behavior, timeout/disposal cleanup, reverb shutdown, and the voice cap. It also verifies every local MP3 against its recorded SHA-256, root/layer metadata, and license record.
- `node scripts/verify-piano-performance.cjs` retains the existing transport tests and exercises actual sampled AudioPlayer scheduling against the shared clock. Chords, bass pitches, key holds, sustain durations, repeated strikes, pause/resume, stop, hidden tabs, and disposal remain covered.
- Acquisition checks decoded all sixty MP3s completely with ffmpeg and checked stereo channels, durations, package integrity, and output hashes.
- These automated checks establish content integrity and scheduling behavior. They do not substitute for hearing the mix in the browser or measuring a particular device's output latency; root browser QA handles the in-app sound check.
