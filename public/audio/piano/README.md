# Piano sample credits

The piano uses **Salamander Grand Piano V3**, recorded by **Alexander Holm**, licensed under [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).

- Original instrument: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3).
- Author and license verification: [SFZ Instruments](https://sfzinstruments.github.io/pianos/salamander/) and [upstream source](https://github.com/sfzinstruments/SalamanderGrandPiano/tree/3382bf9496bba2486f5ab0de55a264d1dfc38404).
- Local copy of the original license: [LICENSE-CC-BY-3.0.txt](LICENSE-CC-BY-3.0.txt).
- MP3 distribution: [Jan Forst / darosh](https://github.com/darosh/samples-piano-mp3/tree/9ec2c634691bd9071b525b6fd231abdbba1589bf), `@audio-samples/piano-mp3-velocity5` and `@audio-samples/piano-mp3-velocity11`, version `1.0.5`.
- MP3 packaging license: [LICENSE-MP3-PACKAGING-MIT.txt](LICENSE-MP3-PACKAGING-MIT.txt). This MIT license covers the packaging; the underlying recordings remain **CC BY 3.0**.

## Changes

This site selects two of the original velocity layers (5 and 11), with 30 root notes per layer from A0 to C8. Files are renamed for local, URL-safe delivery (`D#` → `Ds`, `F#` → `Fs`). Notes longer than 8 seconds are shortened to 8 seconds with a 0.4-second fade at the end and re-encoded as stereo 44.1 kHz MP3 using libmp3lame quality 2. Shorter notes retain their original audio bytes. Playback can change pitch, volume, envelope, and room ambience.

The recordings were obtained from the versioned npm packages above. No performance-video audio is included. [manifest.json](manifest.json) records source archives and members, package integrity, original and derived SHA-256 hashes, note mapping, measured duration, and conversion settings.

The website serves a compact stereo MP3 version, re-encoded from this bank using libmp3lame VBR quality 5 at 44.1 kHz. There is no additional trimming or mono conversion. The [compact manifest](compact-88aebbf569b9/manifest.json) records the derived files and checksums; all 60 files total 3,022,649 bytes. The original bank remains available for provenance.

Human-readable credits are available at [/audio/piano/](/audio/piano/). The recorded instrument is a Yamaha C5 grand piano; naming the instrument does not imply endorsement by its manufacturer or the sample creator.

## Pre-rendered performance

The automatic performance of “En avril, à Paris” is rendered from the site's authored score using the original Salamander recordings, the existing velocity mix, envelopes, compressor, and room ambience. It includes a one-second reverb tail and is encoded as stereo 44.1 kHz MP3 using libmp3lame VBR quality 3. No performance-video audio is used. [Recording provenance and checksums](performance-b402484fb237/manifest.json). The Salamander sample attribution and CC BY 3.0 terms above apply to the adapted instrument recordings.
