import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EventBus } from '../EventBus';
import { createInitialRhythmState, RHYTHM_KEYS, TRACK, type RhythmHitEvent } from '../../../design/rhythm-game';
import type { RhythmState } from '../../World/RhythmGame';
import RhythmMusic, { initialRhythmMusicState, type RhythmMusicState } from '../../World/RhythmMusic';
import ScoreSubmission from './ScoreSubmission';
import './RhythmGameUI.css';

const HIT_LINE_PERCENT = 84;
const NOTE_TRAVEL_PERCENT = 78;
const HIT_LIFETIME_MS = 650;
const MAX_HIT_EFFECTS = 12;
const formatTime = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${(`0${Math.floor(Math.max(0, value) % 60)}`).slice(-2)}`;
const TIMING_STORAGE_KEY = 'bbangjo.rhythm.timingOffsetMs';
const timingValue = (value: number) => Number.isFinite(value) ? Math.max(-250, Math.min(250, Math.round(value / 10) * 10)) : 0;
function readTimingOffset() {
  try { return timingValue(Number(localStorage.getItem(TIMING_STORAGE_KEY))); } catch { return 0; }
}

export default function RhythmGameUI({ disabled = false, night = false, muted = false }: { disabled?: boolean; night?: boolean; muted?: boolean }) {
  const [state, setState] = useState<RhythmState>(createInitialRhythmState);
  const [music, setMusic] = useState<RhythmMusicState>(initialRhythmMusicState);
  const [attempt, setAttempt] = useState(0);
  const [timingOffset, setTimingOffset] = useState(readTimingOffset);
  const [timingOpen, setTimingOpen] = useState(false);
  const [hitEffects, setHitEffects] = useState<RhythmHitEvent[]>([]);
  const [milestone, setMilestone] = useState<{ id: number; combo: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const highway = useRef<HTMLDivElement>(null);
  const character = useRef<HTMLDivElement>(null);
  const musicHost = useRef<HTMLDivElement>(null);
  const heldPointers = useRef(new Map<number, { lane: number; button: HTMLButtonElement }>());
  const initialMuted = useRef(muted);
  const hitTimers = useRef(new Map<number, number>());
  const liveHits = useRef<RhythmHitEvent[]>([]);
  const milestoneTimer = useRef(0);
  const lastHitId = useRef(-1);
  const canShowEffects = useRef(false);
  const active = state.phase === 'playing' || state.phase === 'countdown';
  const finished = state.phase === 'finished';
  const paused = state.phase === 'paused';
  const inputDisabled = disabled || !active || !music.playing;
  const score = new Intl.NumberFormat('en-US').format(state.score);
  const latestHit = hitEffects[hitEffects.length - 1];
  canShowEffects.current = active && music.playing && !disabled;

  const clearEffects = useCallback(() => {
    hitTimers.current.forEach(timer => window.clearTimeout(timer));
    hitTimers.current.clear();
    window.clearTimeout(milestoneTimer.current);
    liveHits.current = [];
    setHitEffects([]);
    setMilestone(null);
  }, []);

  const stopInputs = useCallback(() => {
    heldPointers.current.forEach(({ lane, button }, pointerId) => {
      EventBus.dispatch('rhythm-input', { lane, down: false, source: `pointer-${pointerId}` });
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    });
    heldPointers.current.clear();
    RHYTHM_KEYS.forEach(key => EventBus.dispatch('rhythm-input', { lane: key.lane, down: false, source: `button-${key.lane}` }));
  }, []);

  useEffect(() => {
    const offState = EventBus.on('rhythm-state', (next: RhythmState) => setState(next));
    const offMusic = EventBus.on('rhythm-music-state', (next: RhythmMusicState) => setMusic(next));
    EventBus.dispatch('world-request-state', {});
    EventBus.dispatch('rhythm-request-state', {});
    EventBus.dispatch('rhythm-music-request-state', {});
    window.addEventListener('blur', stopInputs);
    document.addEventListener('visibilitychange', stopInputs);
    return () => {
      offState();
      offMusic();
      stopInputs();
      window.removeEventListener('blur', stopInputs);
      document.removeEventListener('visibilitychange', stopInputs);
    };
  }, [stopInputs]);

  useEffect(() => {
    const off = EventBus.on('rhythm-hit', (hit: RhythmHitEvent) => {
      if (!canShowEffects.current || !Number.isInteger(hit.id) || hit.id <= lastHitId.current
        || !Number.isInteger(hit.lane) || hit.lane < 0 || hit.lane >= RHYTHM_KEYS.length
        || !['Perfect', 'Great', 'Good', 'Miss'].includes(hit.judgement)) return;
      lastHitId.current = hit.id;
      if (liveHits.current.length >= MAX_HIT_EFFECTS) {
        const oldest = liveHits.current.shift()!;
        window.clearTimeout(hitTimers.current.get(oldest.id));
        hitTimers.current.delete(oldest.id);
      }
      liveHits.current.push({ ...hit });
      setHitEffects([...liveHits.current]);
      hitTimers.current.set(hit.id, window.setTimeout(() => {
        hitTimers.current.delete(hit.id);
        liveHits.current = liveHits.current.filter(item => item.id !== hit.id);
        setHitEffects([...liveHits.current]);
      }, HIT_LIFETIME_MS));
      if (hit.judgement !== 'Miss' && hit.combo > 0 && hit.combo % 25 === 0) {
        window.clearTimeout(milestoneTimer.current);
        setMilestone({ id: hit.id, combo: hit.combo });
        milestoneTimer.current = window.setTimeout(() => setMilestone(null), 1100);
      }
    });
    return () => {
      off();
      hitTimers.current.forEach(timer => window.clearTimeout(timer));
      hitTimers.current.clear();
      window.clearTimeout(milestoneTimer.current);
      liveHits.current = [];
    };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => { if (!active || !music.playing || disabled) clearEffects(); }, [active, music.playing, disabled, clearEffects]);

  useEffect(() => {
    if (!musicHost.current) return undefined;
    const transport = new RhythmMusic(musicHost.current, TRACK, initialMuted.current);
    return () => transport.dispose();
  }, [attempt]);

  useEffect(() => {
    initialMuted.current = muted;
    EventBus.dispatch('rhythm-music-action', { action: 'mute', muted });
  }, [muted]);

  useEffect(() => {
    try { localStorage.setItem(TIMING_STORAGE_KEY, String(timingOffset)); } catch { /* Keep the adjustment for this session. */ }
    EventBus.dispatch('rhythm-timing', { offsetMs: timingOffset });
  }, [timingOffset]);

  useEffect(() => {
    if (!character.current) return undefined;
    const element = character.current;
    const publish = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      EventBus.dispatch('rhythm-viewport', { left, top, width, height });
    };
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    const body = element.closest('.rhythm-body');
    if (body) observer.observe(body);
    window.addEventListener('resize', publish);
    const frame = requestAnimationFrame(publish);
    return () => { observer.disconnect(); window.removeEventListener('resize', publish); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => { if (inputDisabled) stopInputs(); }, [inputDisabled, stopInputs]);

  function action(next: 'start' | 'pause' | 'resume' | 'restart' | 'exit') {
    stopInputs();
    clearEffects();
    EventBus.dispatch('rhythm-action', { action: next });
    if (next !== 'exit') highway.current?.focus({ preventScroll: true });
  }

  function release(event: React.PointerEvent<HTMLButtonElement>) {
    const held = heldPointers.current.get(event.pointerId);
    if (!held) return;
    heldPointers.current.delete(event.pointerId);
    EventBus.dispatch('rhythm-input', { lane: held.lane, down: false, source: `pointer-${event.pointerId}` });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <section className="rhythm-ui" data-night={night} data-phase={state.phase} data-reduced-motion={reducedMotion} aria-label="Four-key rhythm game">
    <header className="rhythm-topbar">
      <button className="rhythm-back" onClick={() => action('exit')} aria-keyshortcuts="Escape"><span aria-hidden="true">←</span> Back <kbd>Esc</kbd></button>
      <dl className="rhythm-scorebar">
        <div><dt>Score</dt><dd>{score}</dd></div>
        <div><dt>Combo</dt><dd>{state.combo}<span className="rhythm-score-unit">×</span></dd></div>
        <div><dt>Accuracy</dt><dd>{state.accuracy.toFixed(1)}<span className="rhythm-score-unit">%</span></dd></div>
      </dl>
    </header>

    <div className="rhythm-body">
      <aside className="rhythm-stage-area">
        <div ref={character} className="rhythm-character-window" aria-label="Dancing character" />
      </aside>
      <div ref={musicHost} className="rhythm-audio-host" hidden aria-hidden="true" />

      <div className="rhythm-play-area">
        <header className="rhythm-track-heading">
          <div><h1>{TRACK.title}</h1><p>{TRACK.artist} <span>{TRACK.bpm} BPM</span></p></div>
          {music.error && <div className="rhythm-music-error"><p role="alert">{music.error}</p><button onClick={() => { action('pause'); setAttempt(value => value + 1); }}>Retry music</button></div>}
        </header>
        <div ref={highway} className="rhythm-highway" tabIndex={-1} role="group" aria-label="Four letter lanes: D, F, J, K"
          style={{ '--rhythm-hit-line': `${HIT_LINE_PERCENT}%` } as React.CSSProperties}>
          <div className="rhythm-lanes" aria-hidden="true">
            {RHYTHM_KEYS.map(key => {
              const laneHits = hitEffects.filter(hit => hit.lane === key.lane);
              const last = laneHits[laneHits.length - 1];
              return <div key={key.lane} className="rhythm-lane" data-lane={key.lane} data-held={state.heldLanes.includes(key.lane)} style={{ '--lane-color': key.color } as React.CSSProperties}>
                <div key={last?.id || 'rest'} className="rhythm-receptor" data-key={key.label} data-hit={Boolean(last && last.judgement !== 'Miss')}><kbd className="rhythm-key-glyph">{key.label}</kbd></div>
                {state.visibleNotes.filter(note => note.lane === key.lane).map(note => <div key={note.id} className="rhythm-note" data-key={key.label}
                  style={{ top: `${HIT_LINE_PERCENT - (note.time - state.time) / TRACK.approachSeconds * NOTE_TRAVEL_PERCENT}%` }}><span className="rhythm-key-glyph">{key.label}</span></div>)}
                {laneHits.map(hit => <div key={hit.id} className="rhythm-hit-effect" data-judgement={hit.judgement}>
                  {hit.judgement !== 'Miss' && <><div className="rhythm-hit-beam" /><div className="rhythm-hit-ring" />
                    {!reducedMotion && Array.from({ length: 6 }, (_, index) => <i key={index} className="rhythm-hit-particle" style={{
                      '--particle-x': `${Math.cos(index * Math.PI / 3) * (28 + index % 2 * 16)}px`,
                      '--particle-y': `${Math.sin(index * Math.PI / 3) * 42 - 20}px`,
                      '--particle-turn': `${index * 65}deg`,
                    } as React.CSSProperties} />)}
                  </>}
                </div>)}
              </div>;
            })}
          </div>
          <div className="rhythm-judgement" data-judgement={latestHit?.judgement || ''} aria-hidden="true">
            {latestHit && <strong key={latestHit.id}>{latestHit.judgement}</strong>}
            {state.combo >= 2 && <span>{state.combo} combo</span>}
          </div>
          {milestone && <div key={milestone.id} className="rhythm-combo-milestone" aria-hidden="true"><strong>{milestone.combo}</strong> combo</div>}
          {!active && <div className="rhythm-board-message" data-finished={finished} role={finished ? undefined : 'status'} tabIndex={finished ? 0 : undefined} aria-label={finished ? 'Finished run' : undefined}>
            {finished ? <><strong>Nice dancing.</strong><span>{state.perfect} Perfect · {state.great} Great · {state.good} Good · {state.misses} Miss</span><span>Best combo {state.maxCombo} · Best score {new Intl.NumberFormat('en-US').format(state.best)}</span><ScoreSubmission result={state} /></>
              : paused ? <strong>Paused</strong>
                : <><div className="rhythm-ready-keys" aria-label="D F J K">{RHYTHM_KEYS.map(key => <kbd key={key.lane} style={{ '--lane-color': key.color } as React.CSSProperties}>{key.label}</kbd>)}</div>
                  <span>Press the matching letter when its tile reaches the outlined key.</span><span>On touch screens, tap the keys below.</span></>}
          </div>}
          {state.phase === 'countdown' && state.countdown > 0 && <div className="rhythm-countdown" role="status">{state.countdown}</div>}
          {active && !music.playing && <div className="rhythm-buffering" role="status">{music.error ? 'Music unavailable' : 'Waiting for the music…'}</div>}
        </div>

        <div className="rhythm-keypad" role="group" aria-label="Rhythm keys">
          {RHYTHM_KEYS.map(key => <button key={key.lane} type="button" className="rhythm-pad" data-lane={key.lane} data-held={state.heldLanes.includes(key.lane)}
            style={{ '--lane-color': key.color } as React.CSSProperties} disabled={inputDisabled} aria-label={`Play lane ${key.lane + 1}, key ${key.label}`} aria-keyshortcuts={key.label}
            onPointerDown={event => {
              if (event.button !== 0 || inputDisabled) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              heldPointers.current.set(event.pointerId, { lane: key.lane, button: event.currentTarget });
              highway.current?.focus({ preventScroll: true });
              EventBus.dispatch('rhythm-input', { lane: key.lane, down: true, source: `pointer-${event.pointerId}` });
            }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
            onKeyDown={event => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat && !inputDisabled) EventBus.dispatch('rhythm-input', { lane: key.lane, down: true, source: `button-${key.lane}` });
            }} onKeyUp={event => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              EventBus.dispatch('rhythm-input', { lane: key.lane, down: false, source: `button-${key.lane}` });
            }} onBlur={() => EventBus.dispatch('rhythm-input', { lane: key.lane, down: false, source: `button-${key.lane}` })}>
            <kbd>{key.label}</kbd>
          </button>)}
        </div>
      </div>
    </div>

    <footer className="rhythm-footer" data-timing-open={timingOpen}>
      <div className="rhythm-progress"><span>{formatTime(state.time)}</span><progress max={Math.max(1, state.duration)} value={Math.max(0, state.time)} aria-label="Song progress" /><span>{formatTime(state.duration)}</span></div>
      <details className="rhythm-timing" onToggle={event => setTimingOpen(event.currentTarget.open)}>
        <summary>Timing</summary>
        <div className="rhythm-timing-content">
          <label htmlFor="rhythm-timing-offset">Note timing</label>
          <input id="rhythm-timing-offset" type="range" min={-250} max={250} step={10} value={timingOffset}
            aria-describedby="rhythm-timing-help" aria-valuetext={`${Math.abs(timingOffset)} milliseconds ${timingOffset < 0 ? 'later' : timingOffset > 0 ? 'earlier' : 'offset'}`}
            onChange={event => setTimingOffset(timingValue(Number(event.target.value)))} />
          <output htmlFor="rhythm-timing-offset">{timingOffset > 0 ? '+' : ''}{timingOffset} ms</output>
          <button type="button" disabled={timingOffset === 0} onClick={() => setTimingOffset(0)}>Reset</button>
          <p id="rhythm-timing-help">Positive values show notes earlier. Applies on the next start or restart.</p>
        </div>
      </details>
      <div className="rhythm-actions">
        {active ? <button className="rhythm-primary" onClick={() => action('pause')}>Pause</button>
          : <button className="rhythm-primary" disabled={disabled || !music.ready} onClick={() => action(paused ? 'resume' : finished ? 'restart' : 'start')}>{!music.ready ? 'Loading music…' : paused ? 'Resume' : finished ? 'Play again' : 'Start'}</button>}
        {state.phase !== 'idle' && <button className="rhythm-restart" disabled={disabled || !music.ready} onClick={() => action('restart')}>Restart</button>}
      </div>
    </footer>
  </section>;
}
