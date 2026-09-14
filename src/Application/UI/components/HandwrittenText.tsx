import React, { memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import glyphData from '../../../design/handwriting-glyphs.json';

interface Stroke { d: string; length: number; width: number; }
interface Glyph { advance: number; bounds: [number, number, number, number]; outline: string; strokes: Stroke[]; }
interface HandwritingFont { unitsPerEm: number; baseline: number; lineHeight: number; glyphs: Record<string, Glyph>; kerning: Record<string, number>; }
interface TimedStroke extends Stroke { start: number; end: number; }
interface PlacedGlyph { shape: Glyph; x: number; start: number; end: number; strokes: TimedStroke[]; }
interface WrittenLine { left: number; width: number; glyphs: PlacedGlyph[]; }

// Authoring coordinates use 100 units per em, baseline 80, and downward-positive Y.
const FONT = glyphData as unknown as HandwritingFont;
const PAD = 4;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function planText(text: string) {
  let time = 0;
  const lines: WrittenLine[] = text.split('\n').map((line) => {
    let x = 0;
    let left = 0;
    let right = 0;
    let previous = '';
    const glyphs: PlacedGlyph[] = [];
    for (const character of Array.from(line)) {
      const shape = FONT.glyphs[character];
      x += FONT.kerning[previous + character] ?? 0;
      previous = character;
      if (!shape?.outline || !shape.strokes.length) {
        x += shape?.advance ?? 24;
        time += 22;
        continue;
      }
      const start = time;
      const strokes = shape.strokes.map((stroke) => {
        const strokeStart = time;
        time += Math.max(8, stroke.length);
        const result = { ...stroke, start: strokeStart - start, end: time - start };
        time += 5; // A brief lift between disconnected strokes, including dots and crossbars.
        return result;
      });
      glyphs.push({ shape, x, start, end: time, strokes });
      left = Math.min(left, x + shape.bounds[0]);
      right = Math.max(right, x + shape.bounds[2]);
      x += shape.advance;
      time += 4;
    }
    time += 34; // Lift the pen to the next line.
    return { left: left - PAD, width: Math.max(right, x, 1) - left + PAD * 2, glyphs };
  });
  return { lines, duration: Math.max(time, 1) };
}

const InkGlyph = memo(function InkGlyph({ glyph, progress, maskId }: { glyph: PlacedGlyph; progress: number; maskId: string }) {
  const local = progress * (glyph.end - glyph.start);
  return <g transform={`translate(${glyph.x} 0)`}>
    {progress < 1 && <defs>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={glyph.shape.bounds[0] - PAD} y={glyph.shape.bounds[1] - PAD}
        width={glyph.shape.bounds[2] - glyph.shape.bounds[0] + PAD * 2} height={glyph.shape.bounds[3] - glyph.shape.bounds[1] + PAD * 2} style={{ maskType: 'luminance' }}>
        {glyph.strokes.map((stroke, index) => {
          const amount = clamp((local - stroke.start) / (stroke.end - stroke.start));
          return <path key={index} d={stroke.d} fill="none" stroke="white" strokeWidth={stroke.width}
            strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - amount} opacity={amount > 0 ? 1 : 0} />;
        })}
      </mask>
    </defs>}
    <path className="handwritten-outline" d={glyph.shape.outline} fill="currentColor" mask={progress < 1 ? `url(#${maskId})` : undefined} />
  </g>;
});

/** Reveal filled calligraphic glyphs along their authored centerlines, following the actual pen tip. */
export default function HandwrittenText({ text, progress, writing }: { text: string; progress: number; writing: boolean }) {
  const plan = useMemo(() => planText(text), [text]);
  const prefix = useId().replace(/:/g, '');
  const tracingPath = useRef<SVGPathElement>(null);
  const nib = useRef<SVGGElement>(null);
  const measuredPath = useRef<{ element: SVGPathElement; d: string; length: number }>();
  const elapsed = clamp(progress) * plan.duration;
  let active: { line: number; x: number; stroke: TimedStroke; amount: number } | undefined;
  if (writing && progress > 0 && progress < 1) {
    plan.lines.some((line, lineIndex) => line.glyphs.some((glyph) => {
      const local = elapsed - glyph.start;
      const stroke = glyph.strokes.find((candidate) => local >= candidate.start && local < candidate.end);
      if (!stroke) return false;
      active = { line: lineIndex, x: glyph.x, stroke, amount: clamp((local - stroke.start) / (stroke.end - stroke.start)) };
      return true;
    }));
  }

  useLayoutEffect(() => {
    const path = tracingPath.current;
    if (!active || !path || !nib.current) return;
    if (measuredPath.current?.element !== path || measuredPath.current.d !== active.stroke.d) {
      measuredPath.current = { element: path, d: active.stroke.d, length: path.getTotalLength() };
    }
    const point = path.getPointAtLength(measuredPath.current.length * active.amount);
    nib.current.setAttribute('transform', `translate(${active.x + point.x} ${point.y}) scale(2.2) translate(-3 -43)`);
    nib.current.setAttribute('visibility', 'visible');
  });

  return <span className="handwritten-text">
    {plan.lines.map((line, lineIndex) => <svg key={lineIndex} className="handwritten-line-svg" aria-hidden="true"
      viewBox={`${line.left} 0 ${line.width} ${FONT.lineHeight}`}
      style={{ width: `${line.width / FONT.unitsPerEm}em` }}>
      {line.glyphs.map((glyph, glyphIndex) => <InkGlyph key={glyphIndex} glyph={glyph}
        progress={clamp((elapsed - glyph.start) / (glyph.end - glyph.start))} maskId={`${prefix}-${lineIndex}-${glyphIndex}`} />)}
      {active?.line === lineIndex && <>
        <path ref={tracingPath} d={active.stroke.d} fill="none" stroke="none" />
        <g ref={nib} className="handwritten-nib" visibility="hidden">
          <path d="m14 20 10-17q2-3 5-1t2 5L21 26Z" fill="currentColor" />
          <path d="m14 20-7 7-4 16 14-9 4-8Z" fill="var(--onboarding-paper)" />
          <path d="m14 20-7 7-4 16 14-9 4-8Z M3 43l10-14 M15 21l6 5" />
          <circle cx="14" cy="27" r="1.4" fill="currentColor" stroke="none" />
          <path d="m18 18 8-14" stroke="var(--onboarding-paper)" strokeWidth=".7" />
        </g>
      </>}
    </svg>)}
    <span className="sr-only">{text.replace(/\s+/g, ' ')}</span>
  </span>;
}
