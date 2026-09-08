# En avril, à Paris: transcription evidence

The sole musical source is the PDF supplied by the user. It contains nine vector pages, no scanned images, and no embedded MIDI or MusicXML. The original PDF was not modified, uploaded, or copied into the web assets.

## Final data

- `public/Piano/en-avril-a-paris.json`: 144 measures represented by 1,747 performed note events, duration 220.204199 seconds under the disclosed rendering interpretation.
- `corrections/m*.json`: 1,796 source-checked note events in quarter-note units, including written grace notes and tied continuation heads.
- The original vector ledger has 1,809 drawn notehead glyphs. Thirteen are repeated/overprinted representations of shared heads; reviewers recorded those cases rather than creating extra piano attacks.
- Forty-eight actual tie continuations become held notes, and one coincident same-pitch attack is unified during rendering. `performance-audit.json` traces all 1,796 reviewed source events to the 1,747 outputs without losing a source event.
- `duration` is the performed key-hold duration. Optional `soundDuration` allows pedal and l.v. resonance without keeping the visual piano key depressed.

## Rebuild

From the repository root:

```sh
python3 scripts/music/build_performance.py
```

The builder refuses missing, duplicate, unverified or rhythmically invalid measures. It also rejects unmatched ties and non-positive performed durations. It does not use the automatic OMR draft as final input.

## Recognition and review

Audiveris 5.11.0 was obtained from the official Audiveris GitHub release and run locally with the official Tesseract English language data. Automatic recognition produced false barlines, omitted chords, wrong clefs and fingering numbers mistaken for tuplets. The recovered OMR draft had 147 bars and 1,627 pitched noteheads, so it was retained only as a review aid.

The final notes instead come from complete manual measure replacements, checked against high-resolution page views and the PDF's native notehead coordinates. Independent checks cover first-page clef/octave details, the third page's complete pitch multisets, and the implied 25-note group at measure 143. Shared-head exceptions are documented in the correction files.

`vector-ledger.json` preserves the original glyph coordinates and geometry. Its geometric count includes the dotted separator within printed measure 142 as a separate region; that region is not a new musical bar. The source navigation map and manually numbered replacements preserve the actual 144-bar sequence.

## Performance choices, not a recording

The opening tempo is printed as approximately quarter note = 152. Other numeric tempo values, accelerando/ritardando ramps, fermata holds, grace-note windows, arpeggio rolls, relative velocities and resonance lengths are explicit synthesis choices in `scripts/music/build_performance.py` and the output's `rendering` metadata. They are not measurements of Hamelin's or any other performer's recording.

- Measure 83 retains the editor's `[non 8va?]` question. The reviewed notes use the literal written register rather than silently extending the preceding octave line.
- Measure 143 prints `25` over 32nd notes between two sequential quarter notes. The normal count 8 is reconstructed from the unchanged 3/4 meter; an explicit `25:8` ratio is not printed.
- Grace notes stay non-metric (`duration: 0`) in the notation ledger. The performance builder gives them short positive durations, distinguishes before/after placement, and handles a grace tied into its principal note as one attack.
- Phrase slurs are not treated as ties. Open l.v. marks and sustain pedal affect sound duration separately from key duration.

Source score credits: Charles Trenet / Alexis Weissenberg; realized by Ryo.K from a recording of M-A Hamelin; edited and typeset by Shota Ezaki.

The OMR books, page images, logs and source-navigation evidence in this directory are local working material. Only the final JSON belongs in `public/Piano/`.
