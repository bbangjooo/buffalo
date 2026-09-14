import React, { useEffect, useRef, useState } from 'react';
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
  const section = useRef<HTMLElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const active = phase === 'writing' || phase === 'tour';

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
    let duration = 0;
    let stopped = false;
    setElapsed(0);
    const write = (now: number) => {
      if (stopped) return;
      // Resume where the pen stopped after a background tab or slow frame.
      if (previous !== undefined && !document.hidden) duration += Math.min(now - previous, 80);
      previous = now;
      setElapsed(duration);
      if (duration >= WRITING_DURATION) EventBus.dispatch('onboarding-finish', {});
      else frame = window.requestAnimationFrame(write);
    };
    frame = window.requestAnimationFrame(write);
    return () => { stopped = true; window.cancelAnimationFrame(frame); };
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (!active) return undefined;
    skip.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        EventBus.dispatch('onboarding-skip', {});
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
  }, [active]);

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
    role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
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
      <p className="onboarding-progress" aria-hidden="true">{phase === 'tour' ? 'A quick look around…' : reducedMotion ? 'Come in when you’re ready.' : 'Let me show you around.'}</p>
      <div className="onboarding-controls">
        {reducedMotion && phase === 'writing' && <button className="onboarding-continue" onClick={() => EventBus.dispatch('onboarding-finish', {})}>Enter my space</button>}
        <button ref={skip} className="onboarding-skip" onClick={() => EventBus.dispatch('onboarding-skip', {})} aria-keyshortcuts="Escape">Skip intro<span aria-hidden="true">Esc</span></button>
      </div>
    </div>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveText}</p>
  </section>;
}
