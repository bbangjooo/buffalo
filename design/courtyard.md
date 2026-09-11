# Four rooms, four open meadows

This space introduces Byeong-geun Jo through piano, travel, reflections and play. The house's x=0 and z=0 boundaries continue outward into four open grasslands. The rooms and meadows share one scene, so the landscape remains visible indoors. The room labels are **About**, **Piano**, **Blog** and **Play**; their meadows are **Coffee**, **Piano pieces**, **Blog** and **Guestbook**.

The scene keeps the petrol, ivory, teal, brass and sage palette, with low-poly grass, flowers and rocks. Narrow paths extend along the quadrant boundaries. The 13 personal displays retain a relaxed arrangement. Technical career articles and their route are outside the current personal-space concept.

| Room and meadow | World x / z | Displays |
| --- | --- | --- |
| About · Coffee | + / + | 1 coffee panel |
| Piano · Piano pieces | + / − | 5 played pieces |
| Blog | − / − | 3 exchange stories from 2023 and 3 reflections on 2025 |
| Play · Guestbook | − / + | 1 guestbook |

All interface labels, buttons, status messages, help text, biography and personal panel prose are English. Existing blog titles and article bodies remain in Korean, and visitor-written guestbook entries retain their original language. French, German and Italian musical names remain in their familiar form.

## Walking and reading

**Explore** beside the profile enters the selected room's meadow from the robot's first-person viewpoint. Entrances are Coffee (7, 7), Piano (7, −7), Blog (−7, −7) and Play (−7, 7). The Coffee entrance faces the display at (11, 11).

Arrow keys, physical WASD and touch direction buttons move relative to the current horizontal view. Walking speed is 8.4 m/s; holding **Shift** runs at 16.8 m/s. **Space** jumps approximately 0.93 m and lands after about 0.64 seconds. Another jump requires landing and a fresh keypress. Dragging changes the viewing direction. The camera follows jump height and returns to its normal eye height after landing. Leaving the scene or losing focus clears input. The house and display footprints remain solid during walking, running and jumping; there is no outer meadow boundary.

Near a piano piece, blog post or guestbook, the HUD offers the title and **Read** or **Open guestbook**. **Enter / E** and object clicks open the same physical reading screen. **Esc** or **Back to exploring** restores the visitor's position and view. **Previous** and **Next** move between piano pieces or blog posts. The map and **Contents** provide direct approaches to the displays. **Back to rooms** or **Esc** while walking returns indoors.

The screens omit the colored heading strip, lower number plate and repeated approach instructions. The useful movement shortcuts remain in one compact control area. Each sculpture and its podium is placed 0.8 m forward of its screen to keep the object clear of the reading surface; the screen anchors and openings are unchanged. There is no `StationLabel`, nameplate or upper trim in the exported model.

Coffee opens an external link. Clicking its nearby object, pressing **Enter / E** or using its HUD button opens the confirmed destination in a new tab. The panel also offers the supplied QR code. Only piano and blog have reading progress; coffee and guestbook have no visit or progress counts.

## Personal content

The Coffee screen contains **If you enjoyed this space**, the functional **Buy me a coffee** action and the author's QR code. There is no duplicate coffee title or support narration. Both the link in `PROFILE.buyMeACoffeeUrl` and the unchanged image at `public/support/buymeacoffee-qr.png` lead to [buymeacoffee.com/dreamvender](https://buymeacoffee.com/dreamvender).

The indoor Summary retains a short introduction to piano, travel and writing, followed by Korea University / Department of Cyber Defense, the University at Buffalo CSE exchange, DoEat and INFOCZ. Detailed technical articles are absent from the outdoor content. Superseded authoring records are kept only in the local `assets/archive/technical-exhibits/` backup and are not referenced by the app or public assets.

Piano panels contain one short personal note, composer and performer credits, and a reference performance. They omit score explanations, publisher links and inferred practice stories. The display order does not imply a performance chronology, and no performance dates are claimed.

| Piece | Personal note | Reference performer |
| --- | --- | --- |
| En avril, à Paris | My all-time favorite. | Marc-André Hamelin |
| Pathétique Sonata — II. Adagio cantabile | The first piece I learned to play, and the one that sparked my love of classical music. | Daniel Barenboim |
| Last Rag | The piece that got me through some of my most stressful days. | Akira Eguchi |
| Graceful Ghost Rag | One of my all-time favorites. | Yeol Eum Son |
| Träumerei | The piece I get most absorbed in. | Yeol Eum Son |

The player loads on **Watch performance** and retains **Watch on YouTube** as a direct fallback. These recordings feature the credited pianists; they are not recordings of the site owner. Sources, selected IDs, public embedding checks and their limits are documented in `design/piano-sources.md`. The indoor piano's existing automatic performance remains available separately.

The Blog meadow contains three exchange-student posts and three reflections on 2025, grouped around the 2023 and 2025 year markers. The latter were published on January 17, 2026, so subject year and publication date remain distinct. Opening a screen immediately displays the original Korean article, including paragraphs, lists and images, with an **Original post** link at the end. The surrounding controls are English.

`blog-history.json` stores sanitized `articleHtml` in the build. Source sentences and order are preserved; only permitted document tags and safe links/images remain. Scripts, iframes and executable attributes are removed. `python3 scripts/sync-blog-articles.py` refreshes the six bodies; `--check` validates the cache offline. Source URLs and content hashes are documented in `design/blog-source-notes.md`. Article text does not depend on a live blog response; external images still depend on their original servers.

The Play meadow contains a **Guestbook** heading, **Name** / **Message** form and entry list. Empty, error and submission feedback remain available; there is no extra introduction, visitor count, entry count or displayed date. Opening the guestbook does not affect reading progress. The indoor Play room opens the four-key rhythm game with **D F J K**, native Lasso Lady audio and the smooth hamster dancing on four pads; see `design/rhythm-game.md`.

Visitors complete donations on Buy Me a Coffee. The site does not perform payment actions on their behalf or show simulated donation counts. The global **GitHub** profile link remains available beside the other identity links.

Current content lives in `src/design/history.ts`, `piano-history.json` and `blog-history.json`; `profile.ts` owns external destinations. Original résumé and score PDFs, private contact details and internal cost totals are not public assets.

## Guestbook persistence

The guestbook uses the shared `GET /api/guestbook` and `POST /api/guestbook` contracts, retaining the latest 200 entries with 24-character names and 120-character messages. The deployed Vercel Functions use the private **buffalo-community** Blob store, with separate Production and Preview namespaces. Local Vite dev and preview use the ignored `.local-data/guestbook.json`, shared across browser contexts on that server and preserved through restarts. Existing visitor text and the separate leaderboard collection are preserved.

An unavailable server or failed save produces an English error rather than a false success notice. `design/community-storage.md` documents the persistence boundaries, retries, conditional writes and prior verified deployment. Updating the meadow does not itself verify a new production release.

## Light and atmosphere

The indoor lamp and sun/moon button share one lighting state. Night lowers sunlight, ambient and fill light, disables the daytime environment map and reduces renderer exposure. The sky, meadow, covers and CSS background darken together, including the Coffee and Guestbook displays. The state persists across rooms, seating, reading and walking.

First-person transitions use a neutral blue-gray horizon and linear fog from 18 to 48 physical metres. `Camera.getAtmosphereDistanceOffset()` separates the camera's virtual 500 m perspective bridge from real atmospheric depth. `Meadow.update()` compensates every frame, avoiding the former green wash on entry. The adjustment clears after settling, resizing or interruption.

## Blender and runtime

The stands, sculptures and reusable grass, flowers and rocks are modeled directly with Blender `bpy`. `exhibit_geometry.py` provides broad polygon faces; culture and support modules define the sculptures; `exhibit_stand.py` defines the frame and forward podium; `exhibit_ao.py` adds restrained contact shading. Flat normals, substantial profiles, matte colors and vertex shading retain the low-poly appearance at close range.

`assets/courtyard.blend` is the editable source. `public/Room/courtyard.glb` contains **13 display groups and screen anchors** and both blog year markers. After regeneration, `scripts/verify-exhibit-model.py` records current triangle, mesh, byte and footprint totals in `assets/courtyard-model-quality.json`. `assets/meadow-review.blend` combines the meadows with the existing house for inspection; the original house source and export remain separate.

```sh
node scripts/build-courtyard-layout.cjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build_courtyard.py
```

Blender and the runtime share `src/design/courtyard-layout.json`, which defines display IDs, history references, quadrants, positions and orientations. `Meadow.ts` streams a fixed 5×5 pool of 24 m ground tiles with instanced foliage, so travel does not accumulate geometry. `CourtyardWalk.ts` handles movement and footprint collisions. `Courtyard.ts` owns proximity, reading transitions, external actions and progress. `ExhibitScreen.ts` mounts the CSS3D reader at its anchor; `CourtyardUI.tsx` and `Guestbook.tsx` supply its content and controls.

## Verification

- `npm run build`: TypeScript and production bundle.
- `node scripts/verify-courtyard.cjs`: movement, sprint/jump, collision, input cleanup, all 13 history references and reachable panel actions.
- `python3 scripts/verify-exhibit-model.py`: source/export groups and anchors, moved sculpture bounds, topology, flat normals, materials and vertex colors. Browser checks additionally establish visible screen clearance.
- `node scripts/verify-first-person.cjs`: eye height, heading-relative movement, jump/landing, drag/pitch limits, resize, reader return, interruption and monitor centering.
- `node scripts/verify-tour-atmosphere.cjs`: entry fog, return and resize behavior, reduced motion, interruption and day/night restoration.
- `python3 scripts/sync-blog-articles.py --check`: cached article lengths, permitted tags and link/image URLs.
- `node scripts/verify-guestbook.cjs`: isolated API, validation and persistence checks, without touching visitor data.

Browser checks cover all four entrances, screen/object separation, removed strips and plates, English controls, unchanged Korean articles, confirmed Coffee link/QR, full article reading, minimal guestbook, movement and return, map navigation, night lighting, videos and desktop/mobile layouts. Link verification does not submit a payment. Existing piano, four-key rhythm game, giant meadow hamster, curtains, indoor reading and camera behavior remain in scope.

Controlled iframe responses may isolate indoor blog interaction tests from a Vercel challenge; they do not establish live blog availability. Public YouTube metadata confirms current embed eligibility, not playback in every browser or region. Local verification and public deployment are separate.
