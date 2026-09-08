# Source-grounded transcription review

Source: the user-provided nine-page PDF. Preserve the original; no score upload or alternate recording is used to obtain notes.

## Source page map

| PDF page | Engraved measures |
| --- | --- |
| 1 | 1–16 |
| 2 | 17–32 |
| 3 | 33–52 |
| 4 | 53–68 |
| 5 | 69–84 |
| 6 | 85–98 |
| 7 | 99–112 |
| 8 | 113–128 |
| 9 | 129–144 |

The dotted separator inside measure 142 is not another bar. No written repeat/DC/DS/coda navigation has been found. `Tempo I` at measure 129 means return to the original tempo, not restart the score.

## Complete replacement file

Each reviewer owns a distinct JSON file in `corrections/`:

```json
{
  "source": "user-provided score",
  "measures": [
    {
      "measure": 33,
      "complete": true,
      "verified": true,
      "notes": [
        {"beat": 0, "duration": 0.5, "midi": 60, "staff": 1, "pitch": "C4"}
      ],
      "rests": [],
      "uncertainties": []
    }
  ]
}
```

- Every `beat` and `duration` is in **quarter-note units**; ordinary 3/4 bars span [0,3]. Use rational expressions in optional `beatFraction` / `durationFraction` fields where helpful (e.g. `1/3`).
- Supply **all pitched noteheads** in the bar, not only changes to OMR. `complete` means complete replacement.
- `midi` is the actual **sounding pitch**, including clef, key, accidentals and octave-shift lines. The assembler must not apply 8va again.
- Separate voices may overlap in time. Cross-staff beams are one rhythmic group, not separate sequential hands. Chord notes share an onset.
- An actual tie to/from the same sounding pitch may use `tieStart: true` / `tieStop: true`. A phrase slur is not a tie. Tied continuation noteheads remain in the review data and are merged only for playback.
- Grace notes must be labeled `grace: true`; record written type, relative ordering, and the associated principal-note onset. Do not silently invent metric duration. The final performance renderer will need a disclosed interpretation of non-metric graces.
- Rest events may be included for validation, but playback silence is represented by the gaps between notes. Do not pad gaps with made-up notes.
- Keep dynamics/pedal/arpeggio/fermata as explicit annotations when observed. Written note duration and sustain-pedal sound duration are distinct.
- `verified: true` is reserved for a source-checked bar with no unresolved pitch/rhythm ambiguity. Put any remaining question in `uncertainties` and keep `verified: false`.
- OMR drafts are **not** proof: first-page tests found phantom chords, missing notes, wrong clefs/octaves and fingering numbers mistaken for tuplets.

## Performance timing

The printed opening tempo is quarter note = approximately 152. Qualitative `rit.`, `accel.`, fermatas, arpeggiation and grace notes do not specify unique time values in seconds. They must remain explicit source annotations; a deterministic rendering interpretation must be identified as such rather than represented as the timing of a human recording.
