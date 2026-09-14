# Arrival and the outdoor horses

The first visit starts over the four rooms, looking exactly down. English notes introduce the author's software work, enjoyment of playing piano and writing, then invite visitors to stay and play. The piano note simply says “I like playing the piano.” Allura letterforms are written along ordered centerline strokes, with the fountain nib following each active path and lifting between disconnected marks. Each SVG mask uncovers the original filled glyph, retaining its thin upstrokes and thicker downstrokes. The introductory `bbangjo` uses the existing Clash Display bold wordmark. A 6.8-second descending flight then turns from the overhead view, opens the framing around the house and gradually settles into the existing About view facing the Summary wall. Rotation, descent and framing run continuously, without a separate tilt-then-orbit stage or a cut at arrival.

The handwriting takes about 26 seconds, including pauses. `scripts/build-handwriting.py` derives compact SVG outlines and ordered medial paths from the bundled Allura font, retaining its kerning. The generated data is `src/design/handwriting-glyphs.json`; no font-processing library runs in the browser. `scripts/verify-handwriting.py` independently rasterizes the original font and checks that each completed mask covers over 99% of its ink, so the final glyph does not suddenly pop into view. Both scripts use Python with fontTools, Pillow, numpy and scipy.

Click or tap the screen while writing to complete the current note and start the next one; advancing from the last note starts the flight. The footer offers the same action for keyboard users. Skip intro (or Escape while writing) bypasses the writing and plays the camera flight. During the flight, the button changes to Skip tour, which settles immediately; Escape does the same. Drags and pinch gestures do not advance notes, and held keys do not repeatedly skip stages. Reduced motion shows the complete descriptions and waits for “Enter my space”, then enters without an orbit. Resizing preserves the current arrival phase. Navigation stays locked until completion, then focus returns to About me. The sequence runs on each page load. Pen drawing remains the default; an existing saved theme preference is retained.

Eight horses replace the outdoor hamster, with a courtyard route and a meadow route in each quadrant: Maple/Clover by About, Oat/Ash by Piano, Sorrel/Fennel by Blog, and Pebble/Bramble by Play. Each follows a straight grazing lane with a four-beat walk, a quiet stepped turn and tail movement. Reference-based limb profiles keep supporting forelegs nearly straight and fold the returning leg. The hind stifle and hock articulate independently. Horses settle, lower the whole neck, bite and chew with the muzzle in the grass, then raise their head before walking again. See `design/horse-motion-reference.md` for the primary references and visual acceptance criteria. Horses stop near the visitor. Maple can join the rhythm stage and returns to its saved route afterward. Theme changes retain all positions and live joints.

The three original coat variants have matching pen and low-poly models. `assets/horses.blend` holds all six editable designs in a separate studio; existing Blender documents are not modified. Each horse has nineteen meshes, including an articulated jaw and separate anatomical leg segments. Its feet rest at Y=0 and it faces +Z in glTF. Both texture-free GLBs together are about 1.64 MB. The ink materials are unlit and participate in the existing day/night ink shader.

Regenerate from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build_horses.py
```

The script exports both GLBs, the Blender file, upright/grazing review sheets and measurements under `assets/horse-review/`. Stable runtime poses can also be rendered as a side-view gait sheet. Superseded motion samples are named explicitly.

The landscape contains 474 ink grass tufts (up from 274), including forage at the 16 lane endpoints. Classic meadow tiles have 88 grass slots (up from 52). Existing authored plants, paths, house floors, exhibition clearances and the number of instanced planting batches are preserved.

Focused validation:

```sh
npm run build
node scripts/verify-arrival.cjs
node scripts/verify-onboarding.cjs
node scripts/verify-horse-herd.cjs
node scripts/verify-leaderboard-wall.cjs
```

The horse check loads the actual GLBs and simulates ten minutes of movement against the house, exhibition readers, village obstacles, planting and other horses. Camera checks measure the vertical projection, simultaneous orbit/descent, continuous arrival, final deceleration, responsive framing, skip behavior and cancellation. Existing camera, first-person, atlas framing and art-theme checks also pass.

Integration baseline: `main` fast-forwarded to remote commit `b05a025`. Earlier local piano work was already present in that revision; its pre-sync stash remains available as a backup.
