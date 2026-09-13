# Sampled piano audio

## Source and license

- Instrument: Salamander Grand Piano V3, Alexander Holm; a sampled Yamaha C5 grand piano.
- Sample license: **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**, verified against the [upstream README and LICENSE](https://github.com/sfzinstruments/SalamanderGrandPiano/tree/3382bf9496bba2486f5ab0de55a264d1dfc38404) and the [SFZ Instruments catalog](https://sfzinstruments.github.io/pianos/salamander/).
- MP3 distribution: Jan Forst / darosh, [samples-piano-mp3](https://github.com/darosh/samples-piano-mp3/tree/9ec2c634691bd9071b525b6fd231abdbba1589bf); `@audio-samples/piano-mp3-velocity5@1.0.5` and `@audio-samples/piano-mp3-velocity11@1.0.5`.
- The distribution repository's MIT packaging license does not change the sample recordings' CC BY 3.0 license. Both license notices are stored in `public/audio/piano/`.
- Visible credits: the header's **Information → Credits** menu opens `/audio/piano/index.html` in a new tab. The explicit filename avoids Vite development's main-page fallback for `/audio/piano/`. The menu supports keyboard navigation, Escape dismissal and focus restoration; sample credits are reached from this shared menu. Full local attribution remains at `public/audio/piano/README.md`, and the attribution content and license files remain unchanged.

## Acquisition and transformations

Retrieved on 2026-09-10 from the versioned npm registry archives. SHA-512 archive integrity was checked against each package's registry metadata. The original MP3 files total 11,103,588 bytes. Sixty samples cover two original velocity layers (5 and 11), with 30 roots per layer at MIDI 21, 24, 27, …, 108. Nearest-root playback covers the 88-key range with at most one semitone of transposition.

Original bank naming: `/audio/piano/v{5|11}-{note}.mp3`, where notes are `A0`, `C1`, `Ds1`, `Fs1`, `A1`, …, `A7`, `C8`. `s` represents a sharp in the local filename only; manifest note names use normal sharp spelling.

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

## Pre-rendered automatic performance

`PianoPerformance` owns a hidden native HTMLAudioElement, preloaded asynchronously after scene initialization. It streams `/audio/piano/performance-b402484fb237/en-avril-a-paris.mp3` (3,527,836 bytes, 221.204218 seconds). Listen calls `play()` synchronously in the input gesture, without `AudioPlayer.unlock()`, bank download, or Web Audio decoding. The authored score JSON is used only for key animation; `currentTime` of the media element is the only playback clock. Buffering freezes that clock. Pause, resume, stop, hidden-tab cancellation, mute, errors/retry, and pending-play cancellation keep media and UI aligned. The one-second render tail plays through before the ended state.

`PianoAssetProgress` shows recording readiness separately from interactive-key preparation. The recording uses buffered seconds, not an invented byte count. It is marked ready on `canplay`, even with only a portion buffered; the entire file is not a prerequisite to listening. Each asset has its own Retry target and four-second completion dismissal.

### Reproducing the recording

1. Start Vite on `127.0.0.1:5173` and `python3 scripts/receive-piano-render.py`.
2. Open `/scripts/render-piano.html` and click Render recording. The authoring-only page renders without audible playback, using OfflineAudioContext and the real AudioPlayer instrument graph/strike envelope. All 1,747 notes are scheduled offline with the live voice cap disabled; original higher-quality bank files are decoded, not compact derivatives.
3. The localhost-only receiver saves one fixed file, `.vercel/piano-render/render.wav`. It accepts only the local authoring origin and validates the WAV header/size; it does not touch app storage. Stop it after authoring.
4. Run `python3 scripts/package-piano-recording.py`. It produces the MP3, content-derived path, provenance manifest, and audioUrl. The original WAV is not deployed. Current PCM peak is 0.6256, below clipping.

The original source bank and score remain unchanged. The recording is an adaptation of the existing authored performance, not extracted from YouTube or another pianist's recording.

## Interactive keys and caching

Opening the keyboard, sitting at it, or pressing a physical shortcut starts the interactive sample preparation. Merely entering the Piano room or pressing Listen does not create the sample AudioContext or request compact MP3s. The rendered keyboard exposes MIDI 60–83, requiring 18 recordings (roots 60–84, two velocities), rather than the full 60-file bank. `PianoDownloads` fetches only those recordings, at most four low-priority requests at a time. Two decode workers prepare them for interactive playback. Source coverage for the rendered song is independent of this smaller interactive set.

Byte progress, 30-second per-request inactivity deadlines, one automatic retry, retained successful downloads, and retry of failed decodes without another fetch remain in place. The UI labels these as Piano keys, separate from Piano recording. Disposal aborts pending requests and prevents stale callbacks from refilling caches.

Content-versioned compact and performance directories receive `Cache-Control: public, max-age=31536000, immutable` on Vercel. New encoded bytes produce a new URL. Native media playback supports starting before the complete recording downloads; caching alone is not relied on for the first-visit improvement.

## Verification

- `node scripts/verify-audio-channels.cjs` exercises the real transpiled AudioPlayer with controlled Web Audio nodes, asynchronous loading, and timers. It verifies pitch/velocity mapping, absolute starts and note-offs, late offsets, cancellation during resume/load, independent voice channels, error/retry behavior, timeout/disposal cleanup, reverb shutdown, and the voice cap. It also verifies every local MP3 against its recorded SHA-256, root/layer metadata, and license record.
- `node scripts/verify-piano-performance.cjs` exercises the native recording transport: partial buffering, no sample calls, the media clock, chords/repeated strikes, physical key duration versus sustain, pause/resume, pending-play cancellation, hidden tabs, mute, failure/retry, end/tail and disposal.
- Acquisition checks decoded all sixty MP3s completely with ffmpeg and checked stereo channels, durations, package integrity, and output hashes.
- These automated checks establish content integrity and scheduling behavior. They do not substitute for hearing the mix in the browser or measuring a particular device's output latency; root browser QA handles the in-app sound check.
