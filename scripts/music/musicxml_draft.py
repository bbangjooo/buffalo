#!/usr/bin/env python3
"""Extract an explicitly UNVERIFIED, measure-local OMR review draft.

This tool never writes the public performance dataset. Beat/duration units are
quarter notes. The source PDF is the authority; OMR voices, clefs and tuplets
are known to contain errors in this score.
"""

import argparse
import json
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

PAGE_MEASURES = [[1, 16], [17, 32], [33, 52], [53, 68], [69, 84],
                 [85, 98], [99, 112], [113, 128], [129, 144]]
SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def load_musicxml(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            filename = next(name for name in archive.namelist()
                            if name.endswith(".xml") and not name.startswith("META-INF"))
            return ET.fromstring(archive.read(filename))
    return ET.parse(path).getroot()


def extract(path):
    root = load_musicxml(path)
    measures = []
    for part in root.findall("part"):
        divisions = 1
        expected = Fraction(3)
        page = 1
        system = 1
        for ordinal, measure in enumerate(part.findall("measure"), 1):
            printed = measure.find("print")
            if printed is not None and ordinal > 1:
                if printed.get("new-page") == "yes":
                    page += 1
                    system = 1
                elif printed.get("new-system") == "yes":
                    system += 1
            cursor = Fraction(0)
            last_onset = Fraction(0)
            notes, rests, directions, problems = [], [], [], []
            clefs = []
            for element in measure:
                if element.tag == "attributes":
                    divisions = int(element.findtext("divisions", str(divisions)))
                    time = element.find("time")
                    if time is not None:
                        beats = time.findtext("beats")
                        beat_type = time.findtext("beat-type")
                        if beats and beat_type:
                            expected = sum(Fraction(value) for value in beats.split("+")) * 4 / int(beat_type)
                    for clef in element.findall("clef"):
                        clefs.append({"beat": float(cursor), "staff": int(clef.get("number", "1")),
                                      "sign": clef.findtext("sign"), "line": clef.findtext("line")})
                elif element.tag in ("backup", "forward"):
                    cursor += Fraction(int(element.findtext("duration", "0")), divisions) * (-1 if element.tag == "backup" else 1)
                elif element.tag == "direction":
                    directions.append({"beat": float(cursor + Fraction(int(element.findtext("offset", "0")), divisions)),
                                       "staff": element.findtext("staff"),
                                       "xml": ET.tostring(element, encoding="unicode")})
                elif element.tag == "note":
                    grace = element.find("grace") is not None
                    chord = element.find("chord") is not None
                    duration = Fraction(int(element.findtext("duration", "0")), divisions)
                    onset = last_onset if chord else cursor
                    if not chord:
                        last_onset = onset
                        if not grace:
                            cursor += duration
                    data = {"beat": float(onset), "duration": float(duration),
                            "beatFraction": str(onset), "durationFraction": str(duration),
                            "staff": int(element.findtext("staff", "1")),
                            "voice": element.findtext("voice"), "type": element.findtext("type"),
                            "defaultX": element.get("default-x"), "stem": element.findtext("stem"),
                            "dots": len(element.findall("dot")), "grace": grace,
                            "beams": [{"number": b.get("number"), "value": b.text} for b in element.findall("beam")]}
                    pitch = element.find("pitch")
                    if pitch is not None:
                        step = pitch.findtext("step")
                        alter = int(float(pitch.findtext("alter", "0")))
                        octave = int(pitch.findtext("octave"))
                        data["midi"] = (octave + 1) * 12 + SEMITONES[step] + alter
                        data["pitch"] = step + ({-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}.get(alter, str(alter))) + str(octave)
                        tie_types = {tie.get("type") for tie in element.findall("tie")}
                        if "start" in tie_types:
                            data["tieStart"] = True
                        if "stop" in tie_types:
                            data["tieStop"] = True
                        notation = element.find("notations")
                        if notation is not None:
                            data["notations"] = ET.tostring(notation, encoding="unicode")
                        modification = element.find("time-modification")
                        if modification is not None:
                            data["tuplet"] = {"actual": modification.findtext("actual-notes"),
                                              "normal": modification.findtext("normal-notes")}
                        notes.append(data)
                    else:
                        rests.append(data)
                    if onset < 0 or onset + duration > expected:
                        problems.append({"reason": "outside-measure", "voice": data["voice"],
                                         "staff": data["staff"], "beat": float(onset), "end": float(onset + duration)})
            number = measure.get("number", str(ordinal))
            measures.append({"measure": int(number) if number.isdigit() else number,
                             "omrOrdinal": ordinal, "omrPage": page, "system": system,
                             "part": part.get("id"), "expectedBeats": float(expected),
                             "complete": False, "verified": False,
                             "notes": notes, "rests": rests, "clefs": clefs,
                             "directions": directions, "uncertainties": problems})
    return {"title": "En avril, à Paris", "status": "UNVERIFIED OMR DRAFT — DO NOT PUBLISH",
            "source": "user-provided score", "quarterNoteTempoPrinted": "152 ca.",
            "pdfPageMeasureRanges": PAGE_MEASURES,
            "warning": "OMR can invent chords, omit notes, misread fingerings as tuplets and miss clefs or octave lines. MIDI below is OMR pitch, not verified sounding pitch.",
            "measures": measures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if "public" in args.output.resolve().parts:
        parser.error("An unverified draft cannot be exported into public/.")
    result = extract(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"measures": len(result["measures"]),
                      "pitchedNoteheads": sum(len(m["notes"]) for m in result["measures"]),
                      "rhythmFlaggedMeasures": [m["measure"] for m in result["measures"] if m["uncertainties"]]}, ensure_ascii=False))
