# 조병근 · bbangjo

A personal Three.js space with four rooms arranged around central cross walls. All four rooms remain in one continuous scene. The camera rotates around the shared center, with neighboring and rear rooms visible wherever the physical walls allow. A traveling robot guides the visitor; previous/next arrows keep navigation simple.

## Run

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Use Node.js 24. The existing Vercel project `buffalo` deploys `main` automatically to [bbangjo.kr](https://bbangjo.kr). `vercel.json` configures Vite, `npm ci`, `npm run build` and the `dist` output. For a manual production deployment, run `sh build.sh` from the repository root. `.vercelignore` excludes authoring assets, design references and scripts from the deployment upload.

## Explore

- **Summary:** select the framed profile or the portrait beside it to read the GoD (Goal-oriented Developer) and CoD (Core-oriented Developer) introduction and four concise education/career entries: Korea University, Buffalo exchange, Doeat (through March 2026), and 인포시즈 FDE (from June 2026). The original 3:2 photograph also appears in Summary and opens at full size when selected there. `public/story.html` keeps this short profile; the old résumé URL redirects to it.
- **Piano:** select the bench to sit at the piano in first person. Drag to look around, play the real 3D keys or keyboard, and use **일어나기** / Escape to stand. All 24 physical keys (MIDI 60–83), including the black keys, can be clicked. The accessible panel has eight white and five black keys in their piano layout (C4–C5): **A/S/D/F/G/H/J/K** for white keys, **W/E/T/Y/U** for C♯/D♯/F♯/G♯/A♯. Shortcuts follow physical keyboard positions, including when the Korean input method is selected. **연주 듣기** uses the internal score player: the instrument sounds the notes and holds its physical keys for their written durations. Pause, continue and stop are available beside the keyboard controls. No video player, arpeggio demo or metronome is present.
- **Blog:** one computer displays the real [blog](https://blog.bbangjo.kr). Read inside its monitor, or follow Blog from the left profile links. The desk lamp and the sun/moon icon at the top right control the same lighting state. The icon toggle is available across the rooms and while seated at the piano; the lighting choice remains in effect while reading.
- **Curtains:** drag either panel toward the window center to draw both curtains, or away from the center to open them. Partial positions remain in place, independently in the piano, blog and game rooms. Mouse and touch follow the room's rail direction even as the camera rotates. Navigation, Escape, resize or focus loss ends the gesture without passing its release to another object.
- **Memory game:** watch four numbered, shaped pads, then repeat their order using the model, buttons, or keys 1–4. The sequence grows over five rounds. Wrong input ends the attempt; retry starts a new sequence. Highest completed round is stored locally.

The same robot travels between spaces, explains the local interaction, and reacts to game results. Closing a hint permanently disables automatic hints in that browser, including after reload or in another open tab. The help button can still show a hint on explicit request. The left identity area contains **bbangjo**, **LinkedIn**, **GitHub** and **Blog**, configured in `src/design/profile.ts`. GitHub ownership is verified from the repository remote and the author's projects. Summary and monitor reading views show only a floating **방으로 나가기** button with an Escape hint, styled like the piano stand control, without a header bar or open-in-new-tab action. No named room tabs are displayed.

Arrow navigation supports keyboard and touch. Reduced motion removes spatial movement. Once started, piano score playback continues across room navigation, Summary and monitor reading, and piano sitting/standing. Navigation cancels game activity and manual/game sound effects while preserving the score and its animated piano keys. A manual piano key or the stop control stops the score and resets its position. Pause preserves the position for explicit continuation; hiding the tab also pauses playback and does not resume automatically. Direct blog access and a retry path remain available if the model or WebGL cannot load.

## Color and design

The shared **조병근 · Structured Curiosity** system was established before the four-room models: petrol structure, ivory surfaces, teal interactions, satin brass, and restrained sage-lime signals.

- Canonical palette: `src/design/jo-colors.json`
- Portable web tokens: `tokens.css`
- Research, color rationale, and visual references: `design/jo-byeonggeun-color-system.md`
- Interactive color board: `design/palette.html` (available through the development server)

The model and website use the same named colors. Résumé facts are treated as source material; private contact details, the complete PDF, and internal cost totals are not included in web assets.

## Blender source and export

Editable source: `assets/four-rooms.blend`.
Website asset: `public/Room/four-rooms.glb`.
Reproducible generation:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build_four_rooms.py
```

The generator uses `scripts/rooms/common.py` and `scripts/rooms/piano.py`, writes room previews, matching before/after object studies and `assets/four-rooms-manifest.json`, and exports Draco-compressed geometry with baked vertex ambient occlusion. The superseded two-room `diorama` source, export, manifest and generator remain local and are excluded from Git and deployment. Models are authored through Blender's actual `bpy` mesh API and saved as editable objects in the `.blend` source.

Current model statistics are recorded in `assets/four-rooms-manifest.json`. The piano combines the earlier upright proportions, thin top and wood frame with matte colors and angular edges. Its music book is moved forward onto a separate support, clear of the cabinet and all 24 key hit paths from the seated eye. The monitor retains its deep tapered casing, the other chairs their folded panels, and the robot its angular joints and wedge feet. The piano revision preserves all 882 unrelated meshes. Earlier stages under `assets/archive/` are local backups excluded from Git and deployment.

Each canonical room occupies x/z 0..5.6 with Y up, full walls at x=0 and z=0, and a distinct root rotated around the world origin:

| Root | Rotation around Y |
|---|---|
| RoomDeveloper | 0° |
| RoomPiano | 90° |
| RoomBlog | 180° |
| RoomAI | 270° |

Preserve root names, reading anchors, `PianoKey60` through `PianoKey83`, `GamePad0` through `GamePad3`, and robot/head/arm/guide-anchor nodes when editing. `MonitorScreenAnchor` is canonical (2.8, 2.05, 0.82), facing +Z, with a 1.40×0.84 opening; the blog root rotates it into place. The timeline surface uses `ResumeScreenAnchor` at canonical (3, 2, 0.22) with a 2.30×2.78 opening. Robot geometry is authored relative to its feet; the runtime detaches it from the game quadrant into a shared guide. The bench has its own `PianoBench` root plus `PianoSeatAnchor`, `PianoEyeAnchor` and `PianoLookAnchor`; those anchors define the seated viewpoint without changing the instrument. Save a separate copy before regenerating to retain manual edits.

## Runtime notes

`World.ts` coordinates navigation, readers, input and lifecycle. `Room.ts` binds named asset nodes; `Curtains.ts` owns rail-constrained pointer dragging and six independently exported curtain pivots; `GuideRobot.ts` controls the shared character; `MemoryGame.ts` owns the five-round game state and timer cancellation. Run `node scripts/verify-curtains.cjs` for rotated-room ray/plane and pointer-ownership checks.

`Portrait.ts` places a normal HTML image on a depth-tested CSS3D surface inside the modeled side-wall frame. The photograph is copied unchanged to `public/images/bbangjo-portrait.jpg`, remains outside the GLB, and loads independently of scene readiness. Its aperture uses `PortraitScreenAnchor` at canonical (0.29, 2.16, 2.65), facing +X, with a 1.80×1.20 opening. Failed image loading leaves the modeled backing visible; disposal removes the image and its aperture.

Both documents use persistent CSS3D iframes with black, zero-alpha WebGL apertures. The CSS viewport cannot scroll and the iframe surface remains unclipped for pointer hit testing. Reading resolution matches projected CSS pixels to keep text legible. The perspective camera adjusts near/far to its distance during transitions, preserving depth precision; furniture is never toggled off as the camera moves. Identity, guide and controls return after the reading or seated transition settles. Room selection does not move the geometry or lights. Both mounted documents stay in the scene and are naturally occluded by walls.

Fonts match the roles inspected on [junepark.kr/about](https://junepark.kr/about): Clash Display/Wanted Sans display, General Sans/Noto Serif KR body, and Pretendard controls. OFL font files and licenses are included locally. Fontshare fonts load from the official service rather than redistributing restricted binaries. See `public/fonts/README.md`.

Validation covers build/typecheck, reader exit frames, rapid navigation and resize, desktop/mobile layout, real document scrolling, piano audio, all five memory-game rounds, loss/retry, guide visibility across four spaces, keyboard/touch inputs and cleanup. Additional checks cover persistent guide dismissal, the shortened timeline, LinkedIn and score playback cleanup. Run `node scripts/verify-piano-performance.cjs` for deterministic AudioContext scheduling, chords, held keys, pause/resume and cancellation checks.

The latest geometry revision was verified against the exact exported GLB loaded in the browser: all 24 physical keys resolve to their own interaction, ASDF produces audio, the seated eye matches its anchor, the monitor opening remains clear, reader exit frames preserve geometry, and the guide's animated pivots return to their rest transforms. All four rooms remain visible throughout navigation. No browser page errors were observed.

Blender authoring views use a 0.2–250 clipping range to keep closely spaced wall/floor surfaces stable and open in the whole-house camera view. Browser captures, model previews and comparison recordings are local QA output excluded from Git and deployment.

## Workflow references

Community skills installed and reviewed for this project:

- [Blender Web Pipeline](https://skills.sh/freshtechbro/claudedesignskills/blender-web-pipeline)
- [Three.js Interaction](https://skills.sh/cloudai-x/threejs-skills/threejs-interaction)
- [Three.js Loaders](https://skills.sh/cloudai-x/threejs-skills/threejs-loaders)

Original concept inspired by [Henry Heffernan](https://henryheffernan.com) and [Bruno Simon](https://bruno-simon.com/). Original project listed in [portfolio-ideas](https://github.com/Evavic44/portfolio-ideas).

## Score playback

Configuration: `src/design/piano-performance.ts`. The performance uses the user-provided nine-page *En avril, à Paris* PDF, credited to Charles Trenet / Alexis Weissenberg, realized by Ryo.K from M-A Hamelin's recording and edited/typeset by Shota Ezaki. All 144 measures were manually checked after local optical recognition, with 1,796 reviewed source events becoming 1,747 audible attacks after tied notes and a shared unison are merged. The rendered performance lasts about 3:40. Reviewed corrections and the performance audit are included under `assets/music-transcription/`; page renders, OMR drafts, extraction ledgers and logs remain local and are excluded from Git and deployment. The original PDF is preserved outside the repository.

Regenerate the timed score with `python3 scripts/music/build_performance.py`. `assets/music-transcription/performance-audit.json` traces every source event to the timed output. The initial quarter-note tempo of approximately 152 comes from the score; numerical rubato, fermata, ornament, rolled-chord and velocity settings are documented performance choices. The source's m83 octave annotation and the inferred m143 tuplet ratio remain explicitly recorded.

`PianoPerformance.ts` schedules notes against the same WebAudio clock used to animate keys. Audio retains the score's original pitches, including notes outside the stylized model's visible two-octave range; only existing matching keys move. The audio engine supports 64 simultaneous voices. Playback is synthesized from score data, not a recording of a pianist.

The audio engine distinguishes scheduled score voices from manual/game interactions. `stopInteractiveNotes()` cancels only the latter, including pending manual requests, so room cleanup cannot interrupt a running or starting performance. Verify that separation with `node scripts/verify-audio-channels.cjs`.
