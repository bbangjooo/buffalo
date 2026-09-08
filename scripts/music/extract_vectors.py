#!/usr/bin/env python3
"""Read-only PDF geometry ledger for the supplied En Avril, a Paris score.

Requires pdfplumber. No OCR, pitch conversion, duration inference, deduplication,
or modification of the source PDF is performed. Positions use PDF points with
an upper-left origin; glyph baselineY is exactly page.height - matrix[5].

Example:
  python extract_vectors.py --pdf '/path/En Avril, a Paris.pdf' \
    --output assets/music-transcription/vector-ledger.json

The page-start measure numbers were supplied from the manual score audit. They
anchor numbering; the number of measures within each page is derived from the
source PDF's full grand-staff bar lines, including grouped double/end bars.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics
from typing import Any

import pdfplumber

DEFAULT_STARTS = [1, 17, 33, 53, 69, 85, 99, 113, 129]
NOTE_GLYPHS = {'œ': 'filled', '˙': 'open', 'w': 'whole-candidate'}
ACCIDENTALS = {'#': 'sharp', 'n': 'natural', 'b': 'flat', '∫': 'double-flat',
               'Ü': 'double-sharp-candidate', '‹': 'double-sharp-candidate'}
CLEFS = {'&': 'treble', '?': 'bass', 'B': 'c-clef-candidate'}
RESTS = {'Œ', '‰', '∑', 'Ó', 'Ù', '≈', '®'}


def rounded(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    return value


def bbox(obj: dict) -> dict:
    return {key: obj[key] for key in ('x0', 'top', 'x1', 'bottom')}


def distance_to_band(y: float, top: float, bottom: float) -> float:
    return max(top - y, 0, y - bottom)


def geometric_assignment(x: float, y: float, systems: list[dict], staves: list[dict]) -> dict:
    """Keep alternatives; physical staff assignment is not voice/hand assignment."""
    empty = {'systemId': None, 'systemIndex': None, 'staffId': None, 'staffIndex': None,
             'measureId': None, 'measureGlobalNumber': None,
             'positionInSystem': 'outside-system', 'staffCandidates': []}
    if not systems:
        return empty
    system = min(systems, key=lambda s: distance_to_band(y, s['top'], s['bottom']))
    if distance_to_band(y, system['top'], system['bottom']) > 48:
        return empty
    result = {**empty, 'systemId': system['id'], 'systemIndex': system['systemIndex']}
    candidates = []
    for staff in staves:
        if staff['systemId'] != system['id']:
            continue
        raw = (staff['bottomLineY'] - y) / (staff['interline'] / 2)
        step = int(round(raw))
        residual = abs(raw - step) * staff['interline'] / 2
        band_distance = distance_to_band(y, staff['topLineY'], staff['bottomLineY'])
        center_distance = abs(y - staff['centerY'])
        # The lattice is informative only near the staff; retain both alternatives.
        score = band_distance + center_distance * .08 + min(residual, 1) * 6
        candidates.append({'staffId': staff['id'], 'staffIndex': staff['staffIndex'],
                           'staffBottomLineY': staff['bottomLineY'], 'staffInterline': staff['interline'],
                           'rawStepsFromBottomLine': raw, 'stepsFromBottomLine': step,
                           'snapErrorPt': residual, 'distanceOutsideStaffPt': band_distance,
                           'distanceToStaffCenterPt': center_distance, 'assignmentScore': score})
    candidates.sort(key=lambda c: c['assignmentScore'])
    chosen = candidates[0]
    result.update({'staffId': chosen['staffId'], 'staffIndex': chosen['staffIndex'],
                   'staffBottomLineY': chosen['staffBottomLineY'], 'staffInterline': chosen['staffInterline'],
                   'writtenStaffPosition': {'stepsFromBottomLine': chosen['stepsFromBottomLine'],
                                            'rawStepsFromBottomLine': chosen['rawStepsFromBottomLine'],
                                            'snapErrorPt': chosen['snapErrorPt'],
                                            'positionType': 'line' if chosen['stepsFromBottomLine'] % 2 == 0 else 'space',
                                            'outsideFiveLines': not 0 <= chosen['stepsFromBottomLine'] <= 8},
                   'staffCandidates': candidates,
                   'staffAssignmentAmbiguous': len(candidates) > 1 and candidates[1]['assignmentScore'] - chosen['assignmentScore'] < 4})
    measures = system['measureSpans']
    if measures and measures[0]['x0'] - .5 <= x < measures[-1]['x1'] + .5:
        measure = next((m for m in measures if x < m['x1'] - .15), measures[-1])
        result.update({'measureId': measure['id'], 'measureGlobalNumber': measure['measureGlobalNumber'],
                       'measureIndexInSystem': measure['measureIndexInSystem'], 'positionInSystem': 'measure'})
    elif measures and x >= measures[-1]['x1'] + .5:
        result.update({'positionInSystem': 'after-final-bar',
                       'precedingMeasureGlobalNumber': measures[-1]['measureGlobalNumber'],
                       'followingMeasureGlobalNumber': measures[-1]['measureGlobalNumber'] + 1})
    elif measures:
        result.update({'positionInSystem': 'before-first-bar',
                       'followingMeasureGlobalNumber': measures[0]['measureGlobalNumber']})
    return result


def detect_layout(page, page_no: int, page_start: int, warnings: list) -> tuple[list, list, list, set, set]:
    # Match five equal-length horizontal rules, not long ottava/crescendo rules.
    bins = defaultdict(list)
    for index, line in enumerate(page.lines):
        if abs(line['top'] - line['bottom']) < .1 and line['width'] > page.width * .45:
            bins[(round(line['x0'], 1), round(line['x1'], 1))].append((index, line))
    groups = []
    for lines in bins.values():
        lines.sort(key=lambda item: item[1]['top'])
        cursor = 0
        while cursor + 5 <= len(lines):
            group = lines[cursor:cursor + 5]
            gaps = [group[j + 1][1]['top'] - group[j][1]['top'] for j in range(4)]
            if min(gaps) > 3 and max(gaps) < 6 and max(gaps) - min(gaps) < .15:
                groups.append(group)
                cursor += 5
            else:
                cursor += 1
    groups.sort(key=lambda g: g[0][1]['top'])
    if len(groups) % 2:
        raise ValueError(f'Page {page_no}: detected odd number of piano staves ({len(groups)})')
    staves, systems, measures = [], [], []
    staff_line_ids, bar_line_ids = set(), set()
    next_number = page_start
    for index in range(0, len(groups), 2):
        number = index // 2 + 1
        system_id = f'p{page_no:02d}-s{number:02d}'
        pair = groups[index:index + 2]
        top = pair[0][0][1]['top']
        bottom = pair[1][-1][1]['top']
        system = {'id': system_id, 'pageNumber': page_no, 'systemIndex': number,
                  'top': top, 'bottom': bottom,
                  'x0': min(g[0][1]['x0'] for g in pair), 'x1': max(g[0][1]['x1'] for g in pair),
                  'staffIds': [], 'barlineGroups': [], 'measureSpans': []}
        for staff_index, group in enumerate(pair, 1):
            ys = [obj['top'] for _, obj in group]
            ids = [f'p{page_no:02d}-line{i:04d}' for i, _ in group]
            staff_line_ids.update(ids)
            staff = {'id': f'{system_id}-staff{staff_index}', 'pageNumber': page_no,
                     'systemId': system_id, 'systemIndex': number, 'staffIndex': staff_index,
                     'physicalRole': 'upper' if staff_index == 1 else 'lower',
                     'x0': min(obj['x0'] for _, obj in group), 'x1': max(obj['x1'] for _, obj in group),
                     'lineYs': ys, 'topLineY': ys[0], 'bottomLineY': ys[-1],
                     'centerY': statistics.mean(ys), 'interline': (ys[-1] - ys[0]) / 4,
                     'lineGaps': [ys[j + 1] - ys[j] for j in range(4)],
                     'sourceLineIds': ids, 'noteheadIds': []}
            staves.append(staff)
            system['staffIds'].append(staff['id'])
        verticals = [(i, line) for i, line in enumerate(page.lines)
                     if abs(line['x0'] - line['x1']) < .15
                     and abs(line['top'] - top) < .7 and abs(line['bottom'] - bottom) < .7]
        verticals.sort(key=lambda item: item[1]['x0'])
        clusters = []
        for item in verticals:
            if not clusters or item[1]['x0'] - clusters[-1][-1][1]['x0'] > 4:
                clusters.append([])
            clusters[-1].append(item)
        if len(clusters) < 2:
            raise ValueError(f'Page {page_no} system {number}: fewer than two full-staff bar boundaries')
        for cluster in clusters:
            ids = [f'p{page_no:02d}-line{i:04d}' for i, _ in cluster]
            bar_line_ids.update(ids)
            system['barlineGroups'].append({'x': statistics.mean(line['x0'] for _, line in cluster),
                                           'rawXs': [line['x0'] for _, line in cluster], 'sourceLineIds': ids,
                                           'grouping': 'double-or-final-bar' if len(cluster) > 1 else 'single-bar'})
        for measure_index, (left, right) in enumerate(zip(system['barlineGroups'], system['barlineGroups'][1:]), 1):
            measure = {'id': f'm{next_number:03d}', 'pageNumber': page_no, 'systemId': system_id,
                       'systemIndex': number, 'measureIndexInSystem': measure_index,
                       'measureGlobalNumber': next_number, 'x0': left['x'], 'x1': right['x'],
                       'top': top, 'bottom': bottom, 'leftBarlineIds': left['sourceLineIds'],
                       'rightBarlineIds': right['sourceLineIds'], 'noteheadIds': []}
            measures.append(measure)
            system['measureSpans'].append({key: measure[key] for key in ('id', 'measureGlobalNumber', 'measureIndexInSystem', 'x0', 'x1')})
            next_number += 1
        systems.append(system)
    return systems, staves, measures, staff_line_ids, bar_line_ids


def extract(source: Path, starts: list[int]) -> dict:
    warnings = []
    ledger = {'schemaVersion': 1, 'source': {'filename': source.name, 'path': str(source.resolve()),
              'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sizeBytes': source.stat().st_size,
              'extractor': 'pdfplumber', 'extractorVersion': pdfplumber.__version__},
              'conventions': {
                  'coordinateUnit': 'PDF point (1/72 inch)', 'coordinateOrigin': 'upper-left',
                  'baselineFormula': 'baselineY = page.height - char.matrix[5]',
                  'headCenter': 'centerX is glyph advance-box midpoint; baselineY is the music-font notehead anchor. Ink bbox is not measured.',
                  'staffPosition': '0 = bottom staff line, +1 = half-interline upward; values are written physical positions, not pitch, hand, voice, duration or MIDI.',
                  'staffAssignment': 'Physical proximity plus lattice residual; alternatives and ambiguity flags retained. Cross-staff voice ownership is not inferred.',
                  'numbering': {'pageStarts': starts, 'anchorSource': 'manual page-start numbers supplied by the score audit',
                                'withinPage': 'consecutive intervals between full-grand-staff bar lines; boundaries <=4pt apart grouped, all raw lines retained'},
                  'keySignatures': 'Only geometric candidates. Local/cautionary accidentals, key changes, clef effects and octava are not resolved.',
                  'retention': 'Every PDF char, line, rect and curve retained. Noteheads are never deduplicated, merged, quantized away or filtered by glyph size.',
                  'noteGlyphFilter': 'œ/˙/w in fonts containing œ or ˙. Same-looking literal glyphs from text fonts kept separately.'},
              'pages': [], 'systems': [], 'staves': [], 'measures': [], 'noteheads': [],
              'nonMusicNoteGlyphs': [], 'clefs': [], 'accidentals': [], 'keySignatureCandidates': [],
              'otherMusicSymbols': [], 'rawChars': [], 'geometry': []}
    with pdfplumber.open(source) as pdf:
        if len(pdf.pages) != len(starts):
            raise ValueError(f'{len(pdf.pages)} PDF pages but {len(starts)} page-start anchors')
        music_fonts = sorted({char['fontname'] for page in pdf.pages for char in page.chars if char['text'] in {'œ', '˙'}})
        ledger['source']['pageCount'] = len(pdf.pages)
        ledger['source']['musicFonts'] = music_fonts
        for page_no, page in enumerate(pdf.pages, 1):
            systems, staves, measures, staff_lines, bar_lines = detect_layout(page, page_no, starts[page_no - 1], warnings)
            if page_no < len(starts) and starts[page_no] - starts[page_no - 1] != len(measures):
                warnings.append({'kind': 'page-measure-count-mismatch', 'pageNumber': page_no,
                                 'expected': starts[page_no] - starts[page_no - 1], 'observed': len(measures)})
            ledger['systems'].extend(systems)
            ledger['staves'].extend(staves)
            ledger['measures'].extend(measures)
            page_info = {'pageNumber': page_no, 'width': page.width, 'height': page.height,
                         'systemIds': [s['id'] for s in systems], 'staffCount': len(staves),
                         'measureCount': len(measures), 'firstMeasure': measures[0]['measureGlobalNumber'],
                         'lastMeasure': measures[-1]['measureGlobalNumber'],
                         'rawCharCount': len(page.chars), 'rawLineCount': len(page.lines),
                         'rawRectCount': len(page.rects), 'rawCurveCount': len(page.curves),
                         'fontGlyphCounts': {}, 'noteheadCount': 0}
            font_counts = defaultdict(Counter)
            for char_index, char in enumerate(page.chars):
                matrix = list(char['matrix'])
                baseline_y = page.height - matrix[5]
                center_x = (char['x0'] + char['x1']) / 2
                glyph = char['text']
                music_font = char['fontname'] in music_fonts
                font_counts[char['fontname']][glyph] += 1
                record = {'id': f'p{page_no:02d}-c{char_index:04d}', 'pageNumber': page_no,
                          'sourceCharIndex': char_index, 'glyph': glyph, 'fontName': char['fontname'],
                          'size': char['size'], 'width': char['width'], 'height': char['height'], 'advance': char['adv'],
                          'x0': char['x0'], 'x1': char['x1'], 'centerX': center_x,
                          'baselineX': matrix[4], 'baselineY': baseline_y, 'matrix': matrix,
                          'bbox': bbox(char), 'upright': char['upright'], 'musicFont': music_font,
                          'nonStrokingColor': char.get('non_stroking_color')}
                record.update(geometric_assignment(center_x, baseline_y, systems, staves))
                ledger['rawChars'].append(record)
                if glyph in NOTE_GLYPHS:
                    note = {**record, 'headType': NOTE_GLYPHS[glyph],
                            'smallGlyph': char['size'] < 16,
                            'noteCenterBaselineY': baseline_y}
                    if music_font:
                        ledger['noteheads'].append(note)
                        page_info['noteheadCount'] += 1
                    else:
                        note['exclusionReason'] = 'Literal note-like character in a non-music font; retained, not counted as a score notehead.'
                        ledger['nonMusicNoteGlyphs'].append(note)
                elif music_font and glyph in CLEFS:
                    ledger['clefs'].append({**record, 'clefGlyphMeaning': CLEFS[glyph]})
                elif music_font and glyph in ACCIDENTALS:
                    ledger['accidentals'].append({**record, 'accidentalGlyphMeaning': ACCIDENTALS[glyph],
                                                   'keySignatureCandidateId': None})
                elif music_font and not glyph.isspace():
                    ledger['otherMusicSymbols'].append({**record, 'symbolClass': 'rest-candidate' if glyph in RESTS else 'unresolved-music-symbol'})
            page_info['fontGlyphCounts'] = {font: dict(counts) for font, counts in sorted(font_counts.items())}
            ledger['pages'].append(page_info)
            for kind, objects in [('line', page.lines), ('rect', page.rects), ('curve', page.curves)]:
                for index, obj in enumerate(objects):
                    geometry_id = f'p{page_no:02d}-{kind}{index:04d}'
                    path = obj.get('path', [])
                    control_points = [point for command in path for point in command[1:]
                                      if isinstance(point, (list, tuple)) and len(point) == 2]
                    control_box = {'x0': min((p[0] for p in control_points), default=obj['x0']),
                                   'x1': max((p[0] for p in control_points), default=obj['x1']),
                                   'top': min((p[1] for p in control_points), default=obj['top']),
                                   'bottom': max((p[1] for p in control_points), default=obj['bottom'])}
                    if geometry_id in staff_lines:
                        classification = 'staff-line'
                    elif geometry_id in bar_lines:
                        classification = 'system-barline'
                    elif kind == 'line' and abs(obj['x0'] - obj['x1']) < .15:
                        classification = 'vertical-segment'
                    elif kind == 'curve' and obj.get('fill') and not any(command[0] in {'c', 'q'} for command in path) and obj['width'] > 2.5 and obj['height'] < 18 and obj['height'] < obj['width'] * .6:
                        classification = 'beam-polygon-candidate'
                    else:
                        classification = kind
                    geometry = {'id': geometry_id, 'pageNumber': page_no, 'sourceType': kind, 'sourceIndex': index,
                                'classification': classification, 'bbox': bbox(obj), 'controlPointBounds': control_box,
                                'width': obj['width'], 'height': obj['height'], 'lineWidth': obj.get('linewidth'),
                                'stroke': obj.get('stroke'), 'fill': obj.get('fill'), 'evenOdd': obj.get('evenodd'),
                                'dash': obj.get('dash'), 'points': obj.get('pts'), 'path': path,
                                'strokingColor': obj.get('stroking_color'), 'nonStrokingColor': obj.get('non_stroking_color')}
                    assignment = geometric_assignment((obj['x0'] + obj['x1']) / 2,
                                                        (control_box['top'] + control_box['bottom']) / 2, systems, staves)
                    geometry.update({key: assignment.get(key) for key in ('systemId', 'systemIndex', 'staffId', 'staffIndex', 'measureId', 'measureGlobalNumber', 'positionInSystem')})
                    geometry['staffIntersectionIds'] = [staff['id'] for staff in staves
                        if staff['systemId'] == assignment.get('systemId')
                        and control_box['bottom'] >= staff['topLineY'] - staff['interline'] * 3
                        and control_box['top'] <= staff['bottomLineY'] + staff['interline'] * 3]
                    ledger['geometry'].append(geometry)
    # Build derived indexes without dropping or merging any source glyph records.
    staff_by_id = {s['id']: s for s in ledger['staves']}
    measure_by_id = {m['id']: m for m in ledger['measures']}
    for note in ledger['noteheads']:
        if note['staffId']:
            staff_by_id[note['staffId']]['noteheadIds'].append(note['id'])
        if note['measureId']:
            measure_by_id[note['measureId']]['noteheadIds'].append(note['id'])
    for staff in ledger['staves']:
        notes = [n for n in ledger['noteheads'] if n['staffId'] == staff['id']]
        first_x = min((n['x0'] for n in notes), default=math.inf)
        prefix = sorted([a for a in ledger['accidentals'] if a['staffId'] == staff['id']
                         and staff['x0'] <= a['x0'] < min(first_x - 6, staff['x0'] + 65)], key=lambda a: a['x0'])
        groups = []
        for accidental in prefix:
            if not groups or accidental['x0'] - groups[-1][-1]['x0'] > 9:
                groups.append([])
            groups[-1].append(accidental)
        for group in groups:
            if len(group) < 2:
                continue
            key_id = f"key-candidate-{len(ledger['keySignatureCandidates']) + 1:03d}"
            ledger['keySignatureCandidates'].append({'id': key_id, 'pageNumber': staff['pageNumber'],
                'systemId': staff['systemId'], 'staffId': staff['id'],
                'glyphIds': [a['id'] for a in group], 'glyphs': ''.join(a['glyph'] for a in group),
                'x0': min(a['x0'] for a in group), 'x1': max(a['x1'] for a in group),
                'reason': 'Two or more close accidentals after staff start and before its first note; candidate only.',
                'confirmed': False})
            for accidental in group:
                accidental['keySignatureCandidateId'] = key_id
    note_counts = Counter(n['glyph'] for n in ledger['noteheads'])
    unassigned = [n['id'] for n in ledger['noteheads'] if n['measureGlobalNumber'] is None or n['staffId'] is None]
    off_lattice = [n['id'] for n in ledger['noteheads'] if n.get('writtenStaffPosition', {}).get('snapErrorPt', 999) > .25]
    ambiguous = [n['id'] for n in ledger['noteheads'] if n.get('staffAssignmentAmbiguous')]
    ledger['summary'] = {'pageCount': len(ledger['pages']), 'systemCount': len(ledger['systems']),
        'staffCount': len(ledger['staves']), 'measureCount': len(ledger['measures']),
        'noteheadCount': len(ledger['noteheads']), 'noteheadsByGlyph': dict(note_counts),
        'noteheadsByFont': dict(Counter(n['fontName'] for n in ledger['noteheads'])),
        'noteheadsBySize': dict(sorted(Counter(str(round(n['size'], 3)) for n in ledger['noteheads']).items())),
        'smallNoteheadCount': sum(n['smallGlyph'] for n in ledger['noteheads']),
        'nonMusicNoteGlyphCount': len(ledger['nonMusicNoteGlyphs']),
        'clefGlyphCount': len(ledger['clefs']), 'accidentalGlyphCount': len(ledger['accidentals']),
        'keySignatureCandidateCount': len(ledger['keySignatureCandidates']),
        'rawCharCount': len(ledger['rawChars']), 'geometryCount': len(ledger['geometry']),
        'geometryByClass': dict(Counter(g['classification'] for g in ledger['geometry'])),
        'lastMeasure': max(m['measureGlobalNumber'] for m in ledger['measures'])}
    ledger['audit'] = {'warnings': warnings, 'unassignedNoteheadIds': unassigned,
                       'offStaffLatticeNoteheadIds': off_lattice, 'ambiguousStaffNoteheadIds': ambiguous,
                       'allSourceCharsRetained': len(ledger['rawChars']) == sum(p['rawCharCount'] for p in ledger['pages']),
                       'allSourceGeometryRetained': len(ledger['geometry']) == sum(p['rawLineCount'] + p['rawRectCount'] + p['rawCurveCount'] for p in ledger['pages']),
                       'noPitchOrDurationInferred': True}
    return rounded(ledger)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--page-starts', default=','.join(map(str, DEFAULT_STARTS)))
    args = parser.parse_args()
    starts = [int(value) for value in args.page_starts.split(',')]
    ledger = extract(args.pdf, starts)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'summary': ledger['summary'], 'audit': ledger['audit']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
