import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EventBus } from '../EventBus';
import { ONBOARDING_ROOMS, onboardingLayout, type OnboardingPhase } from '../../../design/onboarding';
import './RoomOnboarding.css';
import HandwrittenText from './HandwrittenText';

const TITLE_SPEED = 140;
const TEXT_SPEED = 90;
const ROOM_PAUSE = 1450;
let nextStart = 450;
const WRITING = ONBOARDING_ROOMS.map((room) => {
  const start = nextStart;
  const titleEnd = start + room.title.length * TITLE_SPEED;
  const end = titleEnd + 240 + room.text.length * TEXT_SPEED;
  nextStart = end + ROOM_PAUSE;
  return { start, titleEnd, end };
});
const WRITING_DURATION = nextStart + 1000;

export default function RoomOnboarding({ phase }: { phase: OnboardingPhase }) {
  const [elapsed, setElapsed] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [layout, setLayout] = useState(() => onboardingLayout(innerWidth, innerHeight));
  const elapsedTime = useRef(0);
  const writingFinished = useRef(false);
  const gesture = useRef<{ x: number; y: number; pointerId: number; moved: boolean }>();
  const section = useRef<HTMLElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const active = phase === 'writing' || phase === 'tour';

  const finishWriting = useCallback(() => {
    if (writingFinished.current) return;
    writingFinished.current = true;
    elapsedTime.current = WRITING_DURATION;
    setElapsed(WRITING_DURATION);
    EventBus.dispatch('onboarding-finish', {});
  }, []);

  const advanceNote = useCallback(() => {
    if (phase !== 'writing' || reducedMotion || writingFinished.current) return;
    const current = WRITING.findIndex((_, index) => elapsedTime.current < (WRITING[index + 1]?.start ?? Infinity));
    const following = WRITING[current + 1];
    if (!following) { finishWriting(); return; }
    // The RAF and click handlers share one clock, so the next frame cannot
    // overwrite a user's jump with the old elapsed duration.
    elapsedTime.current = following.start + 1;
    setElapsed(elapsedTime.current);
  }, [phase, reducedMotion, finishWriting]);

  const skipIntro = useCallback(() => {
    if (phase === 'writing') {
      writingFinished.current = true;
      elapsedTime.current = WRITING_DURATION;
      setElapsed(WRITING_DURATION);
    }
    EventBus.dispatch('onboarding-skip', {});
  }, [phase]);

  function clickScreen(event: React.MouseEvent<HTMLElement>) {
    const pointer = gesture.current;
    gesture.current = undefined;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    if (!pointer || pointer.moved || event.button !== 0 || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) return;
    advanceNote();
  }

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(query.matches);
    const resize = () => setLayout(onboardingLayout(innerWidth, innerHeight));
    query.addEventListener('change', changed);
    window.addEventListener('resize', resize);
    return () => { query.removeEventListener('change', changed); window.removeEventListener('resize', resize); };
  }, []);

  useEffect(() => {
    if (phase !== 'writing' || reducedMotion) return undefined;
    let frame: number;
    let previous: number | undefined;
    let stopped = false;
    elapsedTime.current = 0;
    writingFinished.current = false;
    setElapsed(0);
    const write = (now: number) => {
      if (stopped || writingFinished.current) return;
      // Resume where the pen stopped after a background tab or slow frame.
      if (previous !== undefined && !document.hidden) elapsedTime.current += Math.min(now - previous, 80);
      previous = now;
      setElapsed(elapsedTime.current);
      if (elapsedTime.current >= WRITING_DURATION) finishWriting();
      else frame = window.requestAnimationFrame(write);
    };
    frame = window.requestAnimationFrame(write);
    return () => { stopped = true; window.cancelAnimationFrame(frame); };
  }, [phase, reducedMotion, finishWriting]);

  useEffect(() => {
    if (!active) return undefined;
    (phase === 'writing' && !reducedMotion ? next.current : skip.current)?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.repeat && ['Escape', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        skipIntro();
      } else if (event.key === 'Tab') {
        const buttons = Array.from(section.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
    };
  }, [active, phase, reducedMotion, skipIntro]);

  const previousPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'done' && previousPhase.current !== 'done') {
      document.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus({ preventScroll: true });
    }
    previousPhase.current = phase;
  }, [phase]);

  if (!active) return null;
  const completed = reducedMotion ? ONBOARDING_ROOMS.length : WRITING.filter((timing) => elapsed >= timing.end).length;
  const liveText = phase === 'tour' ? 'Let me show you around my space.'
    : completed ? `${ONBOARDING_ROOMS[completed - 1].title} ${ONBOARDING_ROOMS[completed - 1].text.replace(/\n/g, ' ')}` : 'Hi, I’m bbangjo. These are a few things I love.';

  return <section ref={section} className="room-onboarding" data-phase={phase} data-landscape={layout.landscape}
    role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onClick={clickScreen}
    onPointerDown={(event) => {
      gesture.current = event.isPrimary && event.button === 0
        ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false } : undefined;
    }}
    onPointerMove={(event) => {
      const pointer = gesture.current;
      if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) pointer.moved = true;
    }}
    onPointerCancel={() => { gesture.current = undefined; }}>
    <div className="onboarding-heading">
      <h1 id="onboarding-title">Hi, I’m <span className="onboarding-wordmark">bbangjo</span>.</h1>
      <p>These are a few things I love.</p>
    </div>
    <div className="onboarding-plan" style={{ left: layout.left, top: layout.top, width: layout.size, height: layout.size,
      '--annotation-width': `${layout.landscape ? Math.max(100, Math.min(180, (innerWidth - layout.size) / 2 - 34)) : layout.size / 2 - 28}px`,
    } as React.CSSProperties}>
      {ONBOARDING_ROOMS.map((room, index) => {
        const timing = WRITING[index];
        const titleCount = reducedMotion ? room.title.length : Math.max(0, Math.min(room.title.length, (elapsed - timing.start) / TITLE_SPEED));
        const textCount = reducedMotion ? room.text.length : Math.max(0, Math.min(room.text.length, (elapsed - timing.titleEnd - 240) / TEXT_SPEED));
        const visible = reducedMotion || elapsed >= timing.start;
        const writing = !reducedMotion && phase === 'writing' && elapsed >= timing.start && elapsed < timing.end;
        return <div key={room.id} className="onboarding-annotation" data-room={room.id} data-column={room.column}
          data-writing={writing} data-visible={visible} style={{ left: `${room.column * 50 + 25}%`, top: `${room.row * 50 + 25}%` }}>
          <div className="onboarding-handwriting" aria-hidden="true">
            <h2><HandwrittenText text={room.title} progress={titleCount / room.title.length} writing={writing && elapsed < timing.titleEnd} /></h2>
            <svg className="onboarding-underline" viewBox="0 0 150 10" data-drawn={titleCount === room.title.length}>
              <path d="M3 6C36 8 64 1 99 4S138 8 147 3" pathLength="1" />
            </svg>
            <p><HandwrittenText text={room.text} progress={textCount / room.text.length} writing={writing && elapsed >= timing.titleEnd + 240} /></p>
          </div>
          <span className="sr-only">{room.title} {room.text}</span>
        </div>;
      })}
    </div>
    <div className="onboarding-footer">
      {phase === 'writing' && !reducedMotion
        ? <button ref={next} type="button" className="onboarding-progress onboarding-next" onClick={advanceNote}>Click anywhere for the next note.</button>
        : <p className="onboarding-progress" aria-hidden="true">{phase === 'tour' ? 'A quick look around…' : 'Come in when you’re ready.'}</p>}
      <div className="onboarding-controls">
        {reducedMotion && phase === 'writing' && <button className="onboarding-continue" onClick={finishWriting}>Enter my space</button>}
        <button ref={skip} className="onboarding-skip" onClick={skipIntro} aria-keyshortcuts="Escape">{phase === 'tour' ? 'Skip tour' : 'Skip intro'}<span aria-hidden="true">Esc</span></button>
      </div>
    </div>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveText}</p>
  </section>;
}
