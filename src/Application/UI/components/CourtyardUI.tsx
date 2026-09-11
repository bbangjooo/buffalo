import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventBus } from '../EventBus';
import { COURTYARD, EXHIBITIONS, type HistoryEntry } from '../../../design/history';
import { ROOMS, type RoomId } from '../../../design/rooms';
import type { CourtyardState } from '../../World/Courtyard';
import type { WalkDirection } from '../../World/CourtyardWalk';
import Guestbook from './Guestbook';
import './CourtyardUI.css';

const DIRECTIONS: { direction: WalkDirection; label: string; glyph: string }[] = [
  { direction: 'up', label: 'Move forward', glyph: '↑' },
  { direction: 'left', label: 'Move left', glyph: '←' },
  { direction: 'down', label: 'Move backward', glyph: '↓' },
  { direction: 'right', label: 'Move right', glyph: '→' },
];
const stationRecord = (station: typeof COURTYARD.stations[number] | undefined) => {
  const exhibition = EXHIBITIONS.find((item) => item.id === station?.exhibitionId);
  return { exhibition, entry: station ? exhibition?.entries[station.entryIndex] : undefined };
};
const mapPosition = (value: number) => 50 + Math.max(-42, Math.min(42, value / 60 * 42));
const recordYear = (entry?: HistoryEntry) => entry?.year || entry?.date.match(/\d{4}/)?.[0] || 'Archive';
const isSupportEntry = (entry?: HistoryEntry) => entry?.kind === 'coffee';
const hasReadingProgress = (room?: string) => room === 'piano' || room === 'blog';

function SupportIcon() {
  return <svg className="meadow-support-icon" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M23 35h48v25a24 24 0 0 1-48 0V35Z" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
    <path d="M72 40h4a12 12 0 0 1 0 24h-5M18 85h62M36 22v-9m20 9V9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>;
}

function SupportAction({ entry, disabled, compact = false, onActivate }: { entry: HistoryEntry; disabled: boolean; compact?: boolean; onActivate?: () => void }) {
  const className = compact ? 'meadow-read meadow-support-action' : 'meadow-support-action';
  const label = entry.actionLabel || 'Buy me a coffee';
  if (!entry.actionUrl) return <button className={className} disabled>Support link coming soon</button>;
  return <a className={className} href={disabled ? undefined : entry.actionUrl} target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={onActivate}>
    {label} <span aria-hidden="true">↗</span><span className="sr-only"> (new tab)</span>
  </a>;
}

function SupportPanel({ entry, disabled }: { entry: HistoryEntry; disabled: boolean }) {
  return <section className="meadow-support" data-kind={entry.kind}>
    <SupportIcon />
    <h1 id="meadow-record-title">{entry.title}</h1>
    {(entry.paragraphs?.length ? entry.paragraphs : [entry.text]).filter(Boolean).map((paragraph, index) => <p className="meadow-record-text" key={index}>{paragraph}</p>)}
    <SupportAction entry={entry} disabled={disabled} />
  </section>;
}

function PerformanceVideo({ entry, disabled }: { entry: HistoryEntry; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const videoId = entry.youtubeId && /^[\w-]{11}$/.test(entry.youtubeId) ? entry.youtubeId : null;
  const videoUrl = entry.youtubeUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  if (!videoUrl) return null;
  return <section className="meadow-performance" aria-label={`${entry.title} Performance video`}>
    {videoId && <div className="meadow-video">
      {open && !disabled ? <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=0&hl=en&playsinline=1`}
        title={entry.videoTitle || `${entry.title} · ${entry.performer || 'Performer'}`}
        allow="encrypted-media; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        tabIndex={disabled ? -1 : 0}
      /> : <button className="meadow-video-open" disabled={disabled} onClick={() => setOpen(true)}>
        <span className="meadow-video-play" aria-hidden="true">▷</span>
        <span>Watch performance</span>
      </button>}
    </div>}
    <a className="meadow-video-link" href={videoUrl} target="_blank" rel="noopener noreferrer" tabIndex={disabled ? -1 : undefined}>
      Watch on YouTube <span aria-hidden="true">↗</span><span className="sr-only"> (new tab)</span>
    </a>
  </section>;
}

export default function CourtyardUI({ disabled }: { disabled: boolean; night?: boolean }) {
  const [state, setState] = useState<CourtyardState>({ active: true, nearby: null, visited: [], x: 7, z: 7, room: 'developer', reading: null });
  const [listOpen, setListOpen] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const walkSurface = useRef<HTMLDivElement>(null);
  const readTrigger = useRef<HTMLButtonElement>(null);
  const listToggle = useRef<HTMLButtonElement>(null);
  const recordScroll = useRef<HTMLDivElement>(null);
  const heldPointers = useRef(new Map<number, HTMLButtonElement>());
  const wasReading = useRef(false);
  const reading = Boolean(state.reading);
  const nearbyStation = COURTYARD.stations.find((item) => item.id === state.nearby);
  const nearbyRecord = stationRecord(nearbyStation);
  const currentStation = COURTYARD.stations.find((item) => item.id === state.reading);
  const { exhibition, entry } = stationRecord(currentStation);
  const quadrant = COURTYARD.quadrants.find((item) => item.room === state.room) || COURTYARD.quadrants[0];
  const roomStations = COURTYARD.stations.filter((item) => item.room === (currentStation?.room || state.room));
  const recordIndex = roomStations.findIndex((item) => item.id === state.reading);
  const visitedCount = roomStations.filter((item) => state.visited.includes(item.id)).length;
  const recordGroups: { year: string; stations: typeof roomStations; start: number }[] = [];
  roomStations.forEach((station, index) => {
    const year = state.room === 'blog' ? recordYear(stationRecord(station).entry) : '';
    let group = recordGroups[recordGroups.length - 1];
    if (!group || group.year !== year) { group = { year, stations: [], start: index + 1 }; recordGroups.push(group); }
    group.stations.push(station);
  });
  const portalHost = document.getElementById('exhibit-screen-content');

  const stopInputs = useCallback(() => {
    heldPointers.current.forEach((button, pointerId) => {
      EventBus.dispatch('courtyard-input', { source: `pointer-${pointerId}`, direction: null });
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    });
    heldPointers.current.clear();
    DIRECTIONS.forEach(({ direction }) => EventBus.dispatch('courtyard-input', { source: `button-${direction}`, direction: null }));
  }, []);

  useEffect(() => {
    const off = EventBus.on('courtyard-state', (next: CourtyardState) => setState(next));
    EventBus.dispatch('world-request-state', {});
    walkSurface.current?.focus({ preventScroll: true });
    window.addEventListener('blur', stopInputs);
    document.addEventListener('visibilitychange', stopInputs);
    return () => {
      off();
      stopInputs();
      window.removeEventListener('blur', stopInputs);
      document.removeEventListener('visibilitychange', stopInputs);
    };
  }, [stopInputs]);

  useEffect(() => {
    if (reading || disabled) stopInputs();
    if (disabled) return;
    if (reading && !wasReading.current) {
      setListOpen(false);
      back.current?.focus({ preventScroll: true });
    } else if (!reading && wasReading.current) {
      (readTrigger.current || back.current)?.focus({ preventScroll: true });
    }
    wasReading.current = reading;
  }, [reading, disabled, stopInputs]);

  useEffect(() => { if (recordScroll.current) recordScroll.current.scrollTop = 0; }, [state.reading]);
  useEffect(() => { setListOpen(false); }, [state.room]);

  function release(event: React.PointerEvent<HTMLButtonElement>) {
    heldPointers.current.delete(event.pointerId);
    EventBus.dispatch('courtyard-input', { source: `pointer-${event.pointerId}`, direction: null });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function visit(id: string) {
    stopInputs();
    EventBus.dispatch('courtyard-visit', { id });
    setListOpen(false);
    listToggle.current?.focus({ preventScroll: true });
  }

  const recordDocument = reading && currentStation && exhibition && entry && portalHost ? createPortal(
    <main className="meadow-record" role="document" aria-labelledby={entry.kind === 'guestbook' ? 'guestbook-heading' : 'meadow-record-title'} data-room={currentStation.room}>
      <div className="meadow-record-scroll" ref={recordScroll} tabIndex={disabled ? -1 : 0} aria-label={entry.kind === 'guestbook' ? 'Guestbook' : 'Article'}>
        <article key={entry.id}>
          {entry.kind === 'guestbook' ? <Guestbook /> : isSupportEntry(entry) ? <SupportPanel entry={entry} disabled={disabled} /> : <>
            {entry.date && <p className="meadow-record-date">{entry.date}</p>}
            <h1 id="meadow-record-title">{entry.title}</h1>
            {(entry.composer || entry.performer) && <dl className="meadow-music-credits">
              {entry.composer && <div><dt>Composer</dt><dd>{entry.composer}</dd></div>}
              {entry.performer && <div><dt>Performer</dt><dd>{entry.performer}</dd></div>}
            </dl>}
            {entry.articleHtml ? <div className="reader-article" dangerouslySetInnerHTML={{ __html: entry.articleHtml }} />
              : (entry.paragraphs?.length ? entry.paragraphs : [entry.text]).filter(Boolean).map((paragraph, index) => <p className="meadow-record-text" key={index}>{paragraph}</p>)}
            {(entry.youtubeId || entry.youtubeUrl) && <PerformanceVideo key={entry.id} entry={entry} disabled={disabled} />}
            <div className="meadow-record-links">
              {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer" tabIndex={disabled ? -1 : undefined}>{entry.sourceLabel || 'Original post'}<span aria-hidden="true"> ↗</span><span className="sr-only"> (new tab)</span></a>}
              {entry.room === 'piano' && <button disabled={disabled} onClick={() => EventBus.dispatch('navigate', { view: 'piano' })}>Visit the piano room</button>}
            </div>
          </>}
        </article>
      </div>
      {hasReadingProgress(currentStation.room) && roomStations.length > 1 && <nav className="meadow-record-navigation" aria-label="Reading order">
        <button disabled={disabled || recordIndex <= 0} onClick={() => EventBus.dispatch('exhibit-step', { offset: -1 })}><span aria-hidden="true">←</span> Previous</button>
        <span>{currentStation.room === 'blog' ? recordYear(entry) : exhibition.title}</span>
        <button disabled={disabled || recordIndex >= roomStations.length - 1} onClick={() => EventBus.dispatch('exhibit-step', { offset: 1 })}>Next <span aria-hidden="true">→</span></button>
      </nav>}
    </main>, portalHost,
  ) : null;

  return <>
    <div ref={walkSurface} tabIndex={-1} className="meadow-interface" data-reading={reading} data-room={state.room}>
      <header className="meadow-heading">
        <button ref={back} className="meadow-back" disabled={disabled} onClick={() => EventBus.dispatch(reading ? 'close-exhibit' : 'leave-courtyard', {})} aria-keyshortcuts="Escape">
          <span aria-hidden="true">←</span><span>{reading ? 'Back to exploring' : 'Back to rooms'}</span><kbd>Esc</kbd>
        </button>
        {!reading && <div className="meadow-location"><span className="meadow-location-dot" aria-hidden="true" /><h1>{quadrant.name}</h1>{hasReadingProgress(state.room) && <span>{visitedCount} / {roomStations.length} read</span>}</div>}
      </header>

      {!reading && <>
        {nearbyRecord.entry && <section className="meadow-nearby" aria-label="Nearby display">
            <div aria-live="polite">{nearbyRecord.entry.kind !== 'guestbook' && !isSupportEntry(nearbyRecord.entry) && <p>{nearbyStation?.room === 'blog' ? recordYear(nearbyRecord.entry) : nearbyRecord.exhibition?.title}</p>}<h2>{nearbyRecord.entry.title}</h2></div>
            {isSupportEntry(nearbyRecord.entry) ? <SupportAction entry={nearbyRecord.entry} disabled={disabled} compact onActivate={stopInputs} />
              : <button ref={readTrigger} disabled={disabled} className="meadow-read" onClick={() => { stopInputs(); EventBus.dispatch('open-exhibit', {}); }}>{nearbyRecord.entry.kind === 'guestbook' ? 'Open guestbook' : 'Read'} <kbd>Enter</kbd></button>}
        </section>}

        <nav className="meadow-map" aria-label="Meadow map">
          <div className="meadow-map-grid">
            {COURTYARD.quadrants.map((item) => <button key={item.room} className="meadow-sector" data-room={item.room} aria-current={item.room === state.room ? 'location' : undefined} disabled={disabled} aria-label={`Visit ${item.name}`} onClick={() => { stopInputs(); EventBus.dispatch('courtyard-room', { room: item.room }); setListOpen(false); }}>
              <span>{ROOMS[item.room as RoomId].name}</span>
            </button>)}
            <span className="meadow-map-house" aria-hidden="true">⌂</span>
            <span className="meadow-map-robot" style={{ left: `${mapPosition(state.x)}%`, top: `${mapPosition(state.z)}%` }} aria-hidden="true" />
          </div>
          <button ref={listToggle} className="meadow-list-toggle" aria-expanded={listOpen} aria-controls="meadow-record-list" onClick={() => setListOpen(!listOpen)}>Contents <span aria-hidden="true">{listOpen ? '−' : '+'}</span></button>
          {listOpen && <section className="meadow-list" id="meadow-record-list" aria-label={`${quadrant.name} Contents`}>
            <header><h2>{quadrant.name}</h2><button aria-label="Close contents" onClick={() => { setListOpen(false); listToggle.current?.focus({ preventScroll: true }); }}>×</button></header>
            <div className="meadow-list-groups">{recordGroups.map((group) => <section className="meadow-list-group" key={group.year}>
              {group.year && <h3>{group.year}</h3>}
              <ol start={group.start}>{group.stations.map((station) => {
                const record = stationRecord(station).entry;
                return <li key={station.id}><button disabled={disabled} aria-current={state.nearby === station.id ? 'location' : undefined} onClick={() => visit(station.id)}><span>{record?.title || station.label}</span>{hasReadingProgress(station.room) && state.visited.includes(station.id) && <span className="meadow-list-read">Read</span>}</button></li>;
              })}</ol>
            </section>)}</div>
          </section>}
        </nav>

        <div className="meadow-walk-controls">
          <p>Arrows · WASD to move<span>Shift to run · Space to jump</span><span>Drag to look around</span></p>
          <div className="meadow-walk-pad" role="group" aria-label="First-person movement">
            {DIRECTIONS.map(({ direction, label, glyph }) => <button key={direction} className={`meadow-walk-key meadow-walk-key--${direction}`} disabled={disabled} aria-label={label}
              onPointerDown={(event) => {
                if (event.button !== 0 || disabled || reading) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                heldPointers.current.set(event.pointerId, event.currentTarget);
                EventBus.dispatch('courtyard-input', { source: `pointer-${event.pointerId}`, direction });
              }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
              onKeyDown={(event) => { if (!disabled && !reading && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); EventBus.dispatch('courtyard-input', { source: `button-${direction}`, direction }); } }}
              onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); EventBus.dispatch('courtyard-input', { source: `button-${direction}`, direction: null }); } }}
              onBlur={() => EventBus.dispatch('courtyard-input', { source: `button-${direction}`, direction: null })}>{glyph}</button>)}
          </div>
        </div>
      </>}
    </div>
    {recordDocument}
  </>;
}
