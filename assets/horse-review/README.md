# Horse asset review

Current rig: **v3**.

- `horses-contact-sheet.png`: v3 upright anatomy in both themes.
- `horses-grazing-contact-sheet.png`: v3 grazing with the barrel at normal height. Lip height 0.09 m; lowest head/jaw vertex 0.0756 m.
- `manifest.json`: v3 geometry, joint, and grazing measurements.
- `horses-walk-v3-contact-sheet.png`: eight equally spaced actual runtime walk poses in strict side view, in both themes. Full source: `walk-v3-poses.json` (16 poses).
- `horses-graze-v3-contact-sheet.png`: actual runtime settle, lower, feed, raise, and resume sequence in strict side view. Full source: `graze-v3-poses.json` (18 timed poses).
- `horses-gait-v2-superseded.png` and `gait-v2-poses.json`: **superseded v2 evidence**. These show the rejected permanently bent stance and must not be used to assess v3.

The temporal sheets apply the final runtime joint quaternions, local joint translations, and body displacement directly. Both themes use the same measured transforms.

Reproduce all current images and GLBs with Blender in a separate background process:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build_horses.py -- --gait-poses assets/horse-review/walk-v3-poses.json --graze-poses assets/horse-review/graze-v3-poses.json
```

Anatomy references: [AMNH Muybridge walk frames](https://www.amnh.org/content/download/213774/3146546/file/horse_walk-flipbook.pdf), [UMN horse conformation](https://extension.umn.edu/agriculture/animals-and-livestock/horse/conformation-of-the-horse), [UMN equine limb anatomy](https://vanat.ahc.umn.edu/run/plate8.html).
