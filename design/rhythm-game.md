# Four-key rhythm game

The Play room opens a four-lane rhythm game. Physical keys **D F J K** map to lanes 1–4, with four touch buttons providing the same press/release actions. Lettered tiles fall down centered lanes toward matching outlined D/F/J/K keycaps; score, combo, accuracy and the latest judgement remain visible. The on-screen input buttons and three-dimensional dance pads carry the same D/F/J/K letters, without direction arrows. The smooth meadow hamster dances on four matching pads at its normal 1× scale. Leaving the game restores its saved meadow route and giant 2.2× scale.

The dancer has a separate measured `.rhythm-character-window`, keeping it clear of the centered lanes on desktop and mobile. Successful hits produce a receptor flash, beam, ring and particles. Every 25 successful consecutive hits triggers a combo milestone. Miss feedback stays distinct from success. Reduced motion suppresses moving effects, and pause, restart, focus loss and exit clear transient feedback.

## Music and chart sources

| Field | Current value |
| --- | --- |
| Song | Lasso Lady |
| Artist | congusbongus |
| License | CC0 1.0 Universal |
| Tempo | 140 BPM |
| Track ID | `lasso-lady-four-key-v1` |
| Playback file | `/audio/rhythm/lasso-lady.mp3` |
| Measured duration | 73.723923 seconds |
| Chart | Original four-key arrangement |
| First note / countdown | `0.012 + 8 × 60 / 140`, approximately 3.440571 seconds |
| Visible approach time | 2.4 seconds |

The author describes [Lasso Lady](https://opengameart.org/content/lasso-lady-seamless-loop) as an upbeat NES-style action loop and explicitly supplies its 140 BPM tempo and CC0 dedication. The [original Ogg](https://opengameart.org/sites/default/files/lassolady_4.ogg) is retained as `public/audio/rhythm/lasso-lady.ogg`. The playback MP3 was transcoded with `libmp3lame` quality 3, with no trimming or looping. It is 1,207,776 bytes; the original Ogg is 917,124 bytes.

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) permits copying, modification and redistribution, including commercial use, without required attribution. The project still records `Lasso Lady by congusbongus`, its source and license in `public/audio/rhythm/LICENSE.txt`. `public/audio/rhythm/manifest.json` records both file hashes, sizes, source URLs, measured duration, conversion and alignment method. Playback uses these self-hosted files through native browser audio.

`src/design/rhythm-track.mjs` defines the shared song metadata and `createOriginalChart()`. `src/design/rhythm-game.ts` reexports those values and defines the physical keys. The original chart alternates the D/F and J/K hands with short eighth-note patterns, occasional two-key accents and mirrored eight-bar phrases. It is authored for this site and is not an official Pump It Up chart.

The first note follows eight beats of preparation plus a 12-millisecond recording alignment. The manifest records that alignment as the strongest phase in a 20-second low-frequency attack grid at 140 BPM. This estimate is not a device-latency guarantee. The **Timing** control permits ±250 ms adjustment in 10 ms steps, applied on the next start or restart and remembered in that browser. The chart stops adding notes three seconds before the track ends.

## Playback and timing

`RhythmMusic.ts` owns a native audio element for the local MP3. Mounting prepares the track without autoplay. **Start** and **Restart** begin at the recording's start through a user gesture; **Pause** freezes the run and **Resume** continues from the current song position. **Back / Esc** returns to Play and tears down playback. The site's mute setting applies to the music.

The audio element's actual `currentTime`, duration and playback state are published through `rhythm-music-state`. This clock drives notes and judgements; wall-clock time does not advance the chart while the audio is paused or buffering. A new run begins only after playback is confirmed near the start. A backward clock jump resets the run, and small corrections cannot score the same note twice.

A key must be released before its lane can score another press. Repeated keydowns are ignored. Pointer, touch and focused-button input retain separate ownership, so releasing one source does not release another source's hold. Keyup, pointer cancellation, lost capture, focus loss and exit clear held inputs. Losing window focus or hiding the tab pauses audio and gameplay; returning does not resume automatically.

**Perfect**, **Great** and **Good** use 45, 90 and 140 ms windows; other late notes are **Miss**. Weighted scoring is capped at 1,000,000. Finished runs report judgement counts, highest combo and the browser's track-specific personal best. Audio fetch, decode or playback failure displays an English error and **Retry music**, without pretending a silent session is playing. Browser/device output latency still requires calibration where needed.

## Score submission and leaderboard

Only a finished run mounts **Name** and **Submit score**. Names allow 24 characters. The immutable result supplies a run UUID, track ID, judgement counts and maximum combo; there is no editable score field. Once a request begins, the form keeps its complete payload and UUID for identical retries. Each new round gets a new UUID. A successful response shows rank and **View leaderboard**; an unqualified run is explicitly not ranked. Errors preserve a retry path and never report a false save.

Play's **Leaderboard** button and the framed wall open the same `/leaderboard.html` document. The camera focuses its persistent CSS3D surface in the `leaderboard` reading view, owned by room `ai` (Play). The page displays rank, name, score, accuracy and combo for **Lasso Lady**, with English loading, empty, error, refresh and retry states. **Back to room / Esc** returns to Play. The common room buttons share one style, with a primary accent reserved for **Rhythm game**.

After a confirmed submission, **View leaderboard** exits the game, stops the native music, restores room geometry and focuses this wall reader. Saved scores and submission identities are unchanged. `LeaderboardScreen.ts` keeps the iframe mounted and sends its active/night/refresh state through same-origin messages. A GET occurs when Play is activated, on an explicit refresh, or following a confirmed score update; an update while inactive waits until activation. The document does not poll in other rooms.

| Request | Body | Response |
| --- | --- | --- |
| `GET /api/leaderboard` | None; current track only | `{ entries }`, ranked |
| `POST /api/leaderboard` | `{ runId, name, trackId, perfect, great, good, misses, maxCombo }` | `{ entry, rank, saved, duplicate }` |

The server derives score and accuracy from validated counts and the shared current chart length. New submissions must use `lasso-lady-four-key-v1`. Old Beethoven Virus records retain their own track ID and note count, remain separate from current rankings and are preserved by new writes. Retention is the top 200 runs per track, ordered by score, accuracy and maximum combo descending, then earlier creation date and ID. Same-name runs are allowed. Retained UUIDs protect identical retries; evicted or unqualified runs have no permanent receipt.

Local Vite dev and preview use `.local-data/leaderboard.json`, overridable with `LEADERBOARD_DATA_FILE`. Vercel Functions use the configured private Blob store with separate Production and Preview namespaces. Shared handlers use validated documents and conditional writes. The guestbook remains a separate collection. See `design/community-storage.md` for persistence, concurrency, migration and previously verified release evidence. This is a casual, client-reported leaderboard; it does not verify the original gameplay or provide an anti-cheat system.

## Runtime ownership

- `RhythmGame.ts` owns chart consumption, input ownership, scoring, pause/reset and local best-score preferences.
- `RhythmMusic.ts` owns native audio loading, the media clock, mute, errors and teardown.
- `RhythmGameUI.tsx` renders lanes, hit effects, results and touch controls, and publishes the dancer viewport. `ScoreSubmission.tsx` owns submission and the **View leaderboard** request.
- `LeaderboardScreen.ts` owns the persistent wall iframe and active/refresh messages; `public/leaderboard.html` owns the table, lazy API reads and English feedback. `MonitorScreen.ts` supplies CSS3D framing, interaction and teardown.
- `World.ts` owns physical bindings, focus loss, entry/exit and music-to-game coordination.
- `RhythmStage.ts` owns four pads. `GuideRobot.ts` receives lane and beat events for the hamster companion's dance.
- `Camera.ts` frames the dancer into its measured rectangle and disables room dragging during play. The separate `leaderboard` reading view focuses the wall screen; `World.ts` returns it to Play on close.

Entry stops the indoor piano performance. The room and meadow geometry is hidden during the focused game and restored on exit. The robot retains sole ownership of guide hints and camera-triggered greetings; the hamster is a separate companion. `/guide-preview.html` remains a visual comparison reference. Sampled piano playback remains separate, with its CC BY 3.0 attribution reached through **Information → Credits** at `/audio/piano/index.html`.

The physical wall is a clone of Summary's board, with a 2.30×2.78 opening. `LeaderboardBoard` and `LeaderboardScreenAnchor` sit at canonical (3, 2, 0.22), facing +Z; `LeaderboardAnchor` is at (4.48, 2.82, 0.28). Six former `MemoryArt` meshes were replaced. The saved-source preservation record is `assets/archive/leaderboard-wall-20260910T145917Z/preservation.json`; unrelated house and meadow-review geometry and transforms were checked before and after saving.

## Verification and release status

`node scripts/verify-rhythm-game.cjs` covers the four-key chart, input ownership, judgement windows, clock pause/reset, scoring and track-specific personal best. `node scripts/verify-guide-character.cjs` covers separate guide/companion ownership and dance cleanup. Leaderboard and community API checks use isolated collections and should include preservation of historical track records while listing and writing the new track.

Browser verification must cover actual local-audio playback, all four physical keys, touch release, centered desktop/mobile lanes, hit effects and reduced motion, pause/resume/restart, timing adjustment, focus loss, night mode, score submission and return to Play. Earlier YouTube playback checks are not evidence for this replacement. The four-key release was deployed on2026-09-10 as `dpl_7b7tctkGckxAXKv8U7ZgNnjie8Y8` at `bbangjo.kr` (`main.97086ba5.js`). Production confirmed four lanes, no rhythm iframe, native MP3 playback, a board center at720px on a1440px viewport, and both community APIs returning200. Local browser checks also confirmed the board center at195px on390px mobile, a153-note finished result, real25-combo effects, no particles/animation under reduced motion, timing expansion without overflow, pause/restart/focus cleanup and return to the robot plus2.2×meadow hamster. No verification scores were submitted to visitor storage.

The deployment evidence above describes the earlier four-key release. It does not verify the new leaderboard wall or room-button styling. This revision additionally requires browser checks for wall/button focus, iframe scrolling, Escape and Back from inside/outside the document, lazy reads, refresh and score-update propagation, night mode, and game-to-wall audio teardown. No new production deployment is established by these documentation changes.

## Historical Beethoven Virus version

The earlier eight-key prototype used BanYa's *Beethoven Virus* at 162 BPM through [NEVSISTER's visible YouTube BGA](https://www.youtube.com/watch?v=gYNJUBqr8Hc), with an original 254-note chart and a roughly 105-second session. [The official PIU song chart](https://xx.piugame.com/piu.prime2/topChart/songChart.php) supplied the artist and tempo. The [Andamiro Infinity USB Usage Manual, revision 2, pages 8–9](https://pumpitupdistrict.spb.ru/images/PIUD/SeMan/pump-it-up-infinity-usb-usage-r2.pdf) supplied its legacy offset reference; it did not establish that upload's precise downbeat. No YouTube audio was extracted. Those sources and older stored scores describe the historical version, not the current Lasso Lady audio or timing.
