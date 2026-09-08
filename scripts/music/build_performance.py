#!/usr/bin/env python3
"""Build timed piano data exclusively from the manually reviewed score ledger.

Notated quarter-beat data is preserved in the correction files. Tempo words,
ornaments, rolled chords and fermatas need performance choices; those choices
are explicit below and in the output provenance, never called recorded timing.
"""
import argparse
import copy
import hashlib
import json
import math
from collections import defaultdict
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "assets/music-transcription"


def score_beat(measure, beat=0):
    return (measure - 1) * 3 + beat


class Timing:
    def __init__(self):
        self.steps = [(0, 152)]
        self.ramps = []
        self.holds = [(score_beat(142, 2), 1.2), (score_beat(144, 3), 2.0)]
        self.step(13, 0, 104)
        self.ramp(19, 0, 22, 0, 114)
        self.ramp(23, 2, 25, 0, 98)
        self.step(25, 0, 104)
        self.step(49, 0, 128)
        self.step(81, 0, 112)
        self.step(83, 2.5, 128)
        self.ramp(89, 2, 91, 0, 110)
        self.step(91, 0, 128)
        self.ramp(94, 0, 95, 1.5, 100)
        self.step(95, 1.5, 128)
        self.step(96, 2, 112)
        self.ramp(104, 0, 105, 0, 96)
        self.step(105, 0, 112)
        self.ramp(112, 2, 113, 0, 104)
        self.ramp(113, 2, 114, 1.5, 72)
        self.step(114, 1.5, 112)
        self.ramp(115, 1, 121, 0, 128)
        self.ramp(127, 0, 129, 0, 92)
        self.step(129, 0, 152)
        self.ramp(136, 1, 137, 0, 128)
        self.step(137, 0, 152)
        self.ramp(142, 0, 142, 1, 96)
        self.step(142, 2, 152)
        self.step(144, 0, 76)

    def step(self, measure, beat, tempo):
        self.steps.append((score_beat(measure, beat), tempo))

    def tempo(self, beat):
        return max(enumerate(self.steps), key=lambda item: (item[1][0] if item[1][0] <= beat else -1, item[0]))[1][1]

    def ramp(self, m1, b1, m2, b2, target):
        start, end = score_beat(m1, b1), score_beat(m2, b2)
        self.ramps.append((start, end, self.tempo(start), target))
        self.steps.append((end, target))

    def seconds(self, beat):
        boundaries = sorted({0, beat, *[b for b, _ in self.steps if 0 < b < beat],
                             *[b for start, end, _, _ in self.ramps for b in (start, end) if 0 < b < beat]})
        seconds = 0
        for left, right in zip(boundaries, boundaries[1:]):
            middle = (left + right) / 2
            ramp = next((r for r in self.ramps if r[0] <= middle < r[1]), None)
            if ramp:
                start, end, t0, t1 = ramp
                slope = (t1 - t0) / (end - start)
                a, b = t0 + slope * (left - start), t0 + slope * (right - start)
                seconds += 60 * math.log(b / a) / slope if slope else 60 * (right - left) / a
            else:
                seconds += 60 * (right - left) / self.tempo(middle)
        return seconds + sum(seconds for boundary, seconds in self.holds if boundary <= beat + 1e-9)


def exact_number(note, name):
    value = note.get(name + "Fraction", note[name])
    return float(Fraction(str(value)))


def load_reviewed():
    measures = {}
    provenance = []
    for path in sorted((WORK / "corrections").glob("m*.json")):
        data = json.loads(path.read_text())
        provenance.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for row in data["measures"]:
            number = row["measure"]
            if number in measures:
                raise ValueError(f"Duplicate correction ownership: measure {number}")
            if not row.get("complete") or not row.get("verified"):
                raise ValueError(f"Measure {number} is not completely source-verified")
            if row.get("uncertainties"):
                raise ValueError(f"Unresolved measure {number}: {row['uncertainties']}")
            measures[number] = row
            for note in row["notes"]:
                beat, duration = exact_number(note, "beat"), exact_number(note, "duration")
                if not isinstance(note["midi"], int) or not 0 <= note["midi"] <= 127:
                    raise ValueError(f"Bad MIDI in {number}: {note}")
                if beat < 0 or duration < 0 or beat + duration > 3 + 1e-7:
                    raise ValueError(f"Notated duration outside 3/4 in {number}: {note}")
                if duration == 0 and not note.get("grace"):
                    raise ValueError(f"Non-grace zero duration in {number}: {note}")
    if sorted(measures) != list(range(1, 145)):
        raise ValueError(f"Missing measures: {sorted(set(range(1, 145)) - measures.keys())}")
    return measures, provenance


def build(measures, provenance):
    timing = Timing()
    source_notes = []
    for number in range(1, 145):
        for index, source in enumerate(measures[number]["notes"]):
            note = copy.deepcopy(source)
            note["measure"] = number
            note["sourceEvent"] = f"m{number:03d}-n{index:03d}"
            note["absoluteBeat"] = score_beat(number, exact_number(note, "beat"))
            note["notatedDuration"] = exact_number(note, "duration")
            source_notes.append(note)
    source_notes.sort(key=lambda n: (n["absoluteBeat"], n["midi"], 0 if n.get("grace") else 1, n["staff"]))

    # A tied continuation extends the held key instead of striking it again.
    notes, active_ties, tie_merges = [], {}, []
    for note in source_notes:
        if note.get("grace"):
            if note.get("tieStart"):
                note["endBeat"] = note["absoluteBeat"]
                active_ties[note["midi"]] = note
            notes.append(note)
            continue
        midi = note["midi"]
        start, end = note["absoluteBeat"], note["absoluteBeat"] + note["notatedDuration"]
        if note.get("tieStop"):
            previous = active_ties.get(midi)
            if previous is None or abs(previous["endBeat"] - start) > 1e-6:
                raise ValueError(f"Unmatched/non-contiguous tie at {note['sourceEvent']} midi {midi}")
            previous["endBeat"] = end
            previous.setdefault("continuations", []).append(note["sourceEvent"])
            tie_merges.append({"from": previous["sourceEvent"], "continuation": note["sourceEvent"]})
            if not note.get("tieStart"):
                active_ties.pop(midi)
            continue
        note["endBeat"] = end
        notes.append(note)
        if note.get("tieStart"):
            active_ties[midi] = note
    if active_ties:
        raise ValueError(f"Dangling tie starts: {list(active_ties)}")

    # Relative dynamic levels; the printed score does not prescribe MIDI velocities.
    dynamics = [(1, .60), (17, .72), (33, .77), (81, .92), (83, .85),
                (84, .72), (96, .92), (105, .48), (113, .34), (129, .60),
                (137, .72), (144, .46)]
    explicit_pedal = {1, 2, 3, 4, 13, 14, 15, 16, 84, 85, 105, 106, 107,
                      113, 114, 115, 116, 117, 129, 130, 131, 132}
    # Apply the printed simile indications to the immediately following passage.
    pedal = explicit_pedal | set(range(86, 94)) | set(range(118, 129))

    grace_groups = defaultdict(list)
    arpeggio_groups = defaultdict(list)
    for note in notes:
        number = note["measure"]
        note["velocity"] = next(level for measure, level in reversed(dynamics) if measure <= number)
        if note.get("accent"):
            note["velocity"] = min(1, note["velocity"] + .06)
        if note.get("grace"):
            anchor_measure = note.get("principalMeasure", number)
            anchor_beat = note.get("principalBeat", note.get("graceAnchorBeat", exact_number(note, "beat")))
            absolute_anchor = score_beat(anchor_measure, anchor_beat)
            placement = note.get("gracePlacement", "before")
            grace_groups[(absolute_anchor, note["staff"], placement)].append(note)
            continue
        note["time"] = timing.seconds(note["absoluteBeat"])
        note["keyEnd"] = timing.seconds(note["endBeat"])
        if note.get("staccato"):
            note["keyEnd"] = note["time"] + (note["keyEnd"] - note["time"]) * .55
        note["soundEnd"] = note["keyEnd"]
        if number in pedal or note.get("letRing") or note.get("laissezVibrer"):
            note["soundEnd"] = max(note["soundEnd"], timing.seconds(score_beat(number, 3)))
        if number == 144:
            note["soundEnd"] += 1.5
        if note.get("arpeggio"):
            arpeggio_groups[note["absoluteBeat"]].append(note)

    for group in arpeggio_groups.values():
        # A single bottom-to-top roll, including shared cross-staff arpeggios.
        group.sort(key=lambda n: n["midi"])
        step = min(.022, .11 / max(1, len(group) - 1))
        for index, note in enumerate(group):
            note["time"] += index * step

    for (anchor, _, placement), group in grace_groups.items():
        group.sort(key=lambda n: (n.get("graceOrder", 0), n["sourceEvent"]))
        window = min(.18, .045 * len(group))
        start = timing.seconds(anchor) + (.025 if placement == "after" else -window)
        start = max(0, start)
        for index, note in enumerate(group):
            note["time"] = start + index * window / len(group)
            if note.get("continuations"):
                # A grace tied into its principal note is one early attack,
                # held for the principal's written duration (e.g. m56 Db5).
                note["keyEnd"] = timing.seconds(note["endBeat"])
            else:
                note["keyEnd"] = note["time"] + window / len(group) * .92
            note["soundEnd"] = note["keyEnd"]
            note["velocity"] *= .84

    # Unison/shared-head deduplication and ties remain in the source audit.
    rendered = []
    trace = []
    for note in sorted(notes, key=lambda n: (n["time"], n["midi"])):
        duration = note["keyEnd"] - note["time"]
        if duration <= 0:
            raise ValueError(f"Non-positive performed duration: {note['sourceEvent']}")
        event = {"time": round(note["time"], 6), "duration": round(duration, 6),
                 "midi": note["midi"], "velocity": round(note["velocity"], 4)}
        if note["soundEnd"] - note["keyEnd"] > 1e-6:
            event["soundDuration"] = round(note["soundEnd"] - note["time"], 6)
        if rendered and rendered[-1]["midi"] == event["midi"] and abs(rendered[-1]["time"] - event["time"]) < 1e-6:
            previous = rendered[-1]
            previous["duration"] = max(previous["duration"], event["duration"])
            previous["soundDuration"] = max(previous.get("soundDuration", previous["duration"]), event.get("soundDuration", event["duration"]))
            trace[-1]["sourceEvents"].append(note["sourceEvent"])
        else:
            rendered.append(event)
            trace.append({"eventIndex": len(rendered) - 1, "measure": note["measure"],
                          "sourceEvents": [note["sourceEvent"], *note.get("continuations", [])]})

    duration = round(max(n["time"] + max(n["duration"], n.get("soundDuration", 0)) for n in rendered) + .1, 6)
    policy = {
        "kind": "score-based synthesized performance; not a recording",
        "printedInitialTempo": "quarter note approximately 152",
        "tempoSteps": [{"quarterBeat": beat, "qpm": qpm} for beat, qpm in timing.steps],
        "tempoRamps": [{"startQuarterBeat": a, "endQuarterBeat": b, "fromQpm": c, "toQpm": d} for a, b, c, d in timing.ramps],
        "fermataHolds": [{"afterQuarterBeat": beat, "addedSeconds": seconds} for beat, seconds in timing.holds],
        "tempoDisclaimer": "Numeric values other than the opening 152 and Tempo I are disclosed performance choices for qualitative tempo words.",
        "graces": "Ordered 45ms notes (group capped at 180ms), before the principal unless explicitly marked after; no invented pitches.",
        "arpeggios": "Ascending roll up to 110ms, at most 22ms between notes.",
        "pedal": "Printed pedal bars and their immediate simile continuation ring to the bar boundary; open l.v. ties ring to the bar end. Key durations remain independent.",
        "pedalMeasures": sorted(pedal),
        "dynamicDisclaimer": "Velocity levels and staccato release ratios are synthesis choices, not numerical values printed in the score.",
        "sourceEditorialIssues": ["Measure 83 retains the source's [non 8va?] annotation; literal register is used.",
                                  "Measure 143 normal-count 8 is inferred from unchanged 3/4 and surrounding quarter notes; only 25 is printed."]
    }
    score = {"title": "En avril, à Paris", "source": "user-provided score", "duration": duration,
             "tempo": 152, "credits": "Charles Trenet / Alexis Weissenberg · realized by Ryo.K; edited and typeset by Shota Ezaki · 악보 기반 합성 연주",
             "notes": rendered, "rendering": policy}
    audit = {"sourceMeasureCount": 144, "sourceEvents": len(source_notes), "performanceEvents": len(rendered),
             "tieContinuationsMerged": tie_merges, "correctionFiles": provenance, "eventTrace": trace,
             "renderingPolicy": policy}
    return score, audit


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public/Piano/en-avril-a-paris.json")
    args = parser.parse_args()
    measures, provenance = load_reviewed()
    score, audit = build(measures, provenance)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(score, ensure_ascii=False, separators=(",", ":")) + "\n")
    (WORK / "performance-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"measures": 144, "notes": len(score["notes"]), "duration": score["duration"],
                      "sourceEvents": audit["sourceEvents"], "tiesMerged": len(audit["tieContinuationsMerged"])}))
