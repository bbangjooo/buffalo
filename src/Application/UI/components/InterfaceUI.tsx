import React, { useEffect, useRef, useState } from "react";
import { EventBus } from "../EventBus";
import { COLORS, ROOM_IDS, ROOMS, isRoomId, ObjectId, RoomId, RoomView } from "../../../design/rooms";
import { PROFILE } from "../../../design/profile";
import { PIANO_KEYS } from "../../../design/piano-keys";
import RhythmGameUI from "./RhythmGameUI";
import InfoMenu from "./InfoMenu";
import type { PianoPerformanceState } from "../../World/PianoPerformance";
import CourtyardUI from './CourtyardUI';

interface WorldState {
  ready: boolean;
  transitioning?: boolean;
  view: RoomView;
  readingView?: "monitor" | "resume" | "leaderboard" | null;
  seated?: boolean;
  seatedTransition?: boolean;
  room: RoomId;
  muted: boolean;
  night: boolean;
  note: number | null;
  pianoAudio?: { status: "idle" | "loading" | "ready" | "error"; error?: string };
  performance: PianoPerformanceState;
  error?: string;
}
interface GuideMessage {
  text: string;
  actionId: ObjectId | null;
  actionLabel: string;
  visible: boolean;
}

const BLOG = PROFILE.blogUrl;
function linkedinProfileUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const linkedinHost = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");
    return url.protocol === "https:" && linkedinHost && !url.username && !url.password && !url.port
      && /^\/(in|pub)\/[^/]+(?:\/|$)/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}
const LINKEDIN_URL = linkedinProfileUrl(PROFILE.linkedinUrl);
const INITIAL_PERFORMANCE: PianoPerformanceState = { status: "loading", title: "", elapsed: 0, duration: 0 };
function performanceTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${(`0${seconds % 60}`).slice(-2)}`;
}
const WHITE_SHORTCUTS = PIANO_KEYS.filter((key) => !key.black).map((key) => key.key).join("");
const BLACK_SHORTCUTS = PIANO_KEYS.filter((key) => key.black).map((key) => key.key).join(" ");
const HOTSPOTS: { id: ObjectId; label: string; room: RoomId }[] = [];
ROOM_IDS.forEach((room) => ROOMS[room].actions
  .filter((action) => room !== "piano" || action.id === "pianoSeat")
  .forEach((action) => HOTSPOTS.push({ ...action, room })));

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    previous: <path d="m14 5-7 7 7 7" />,
    next: <path d="m10 5 7 7-7 7" />,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
    external: <><path d="M14 4h6v6m0-6-9 9M9 4H4v16h16v-5" /></>,
    sound: <><path d="M5 9H2v6h3l5 4V5Zm10-1a6 6 0 0 1 0 8m4-11a10 10 0 0 1 0 14" /></>,
    muted: <path d="M5 9H2v6h3l5 4V5Zm11 0 6 6m0-6-6 6" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />,
    piano: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M9 13v7m6-7v7M7 4v9h3V4m4 0v9h3V4" /></>,
    pianoSeat: <><path d="M5 11h14v5H5Zm2 5v5m10-5v5M8 11V4h8v7" /></>,
    performance: <path d="m8 4 12 8-12 8Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    monitor: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 21h8m-4-5v5" /></>,
    blogLamp: <><path d="m8 3-4 10h16L16 3Zm4 10v8m-5 0h10m1-8v4" /></>,
    resume: <><path d="M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h4" /></>,
    leaderboard: <path d="M3 21h18M5 21V11h4v10m0 0V5h6v16m0 0v-7h4v7" />,
    game: <><rect x="3" y="4" width="7" height="7" rx="1" /><rect x="14" y="4" width="7" height="7" rx="1" /><rect x="3" y="15" width="7" height="7" rx="1" /><rect x="14" y="15" width="7" height="7" rx="1" /></>,
    guide: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .2c0 1.8-2.5 1.8-2.5 3.8m0 3.5v.1" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    room: <><path d="m3 7 9-4 9 4v12l-9 3-9-3ZM12 3v19M3 7l9 4 9-4" /></>,
    warning: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3v.1" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const InterfaceUI: React.FC = () => {
  const [world, setWorld] = useState<WorldState>({
    ready: false, view: "developer", readingView: null, seated: false, seatedTransition: false, room: "developer", muted: false, night: false,
    note: null, performance: INITIAL_PERFORMANCE,
  });
  const [guide, setGuide] = useState<GuideMessage>({ text: "", actionId: null, actionLabel: "", visible: false });
  const [slowLoading, setSlowLoading] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [hideLabels, setHideLabels] = useState(false);
  const pianoTools = useRef<HTMLDivElement>(null);
  const pianoToggle = useRef<HTMLButtonElement>(null);
  const readingBack = useRef<HTMLButtonElement>(null);
  const readingTrigger = useRef<HTMLElement | null>(null);
  const standControl = useRef<HTMLButtonElement>(null);
  const seatTrigger = useRef<HTMLElement | null>(null);
  const guideHelp = useRef<HTMLButtonElement>(null);
  const readingType = world.readingView || (world.view === "monitor" || world.view === "resume" || world.view === "leaderboard" ? world.view : null);
  const inReading = readingType !== null;
  const inCourtyard = world.view === 'courtyard' || world.view === 'exhibit';
  const inRhythm = world.view === 'rhythm';
  const inSeat = !!world.seatedTransition || !!world.seated || world.view === "piano-seat";
  const room = isRoomId(world.room) ? world.room : "developer";
  const roomIndex = ROOM_IDS.indexOf(room);
  const unavailable = !world.ready || !!world.error;
  const actionsUnavailable = unavailable || !!world.transitioning;
  const seatAction = ROOMS.piano.actions.find((action) => action.id === "pianoSeat");
  const performance = world.performance || INITIAL_PERFORMANCE;
  const performanceActive = performance.status === "playing" || performance.status === "paused";
  const performanceLabel = performance.status === "loading" ? "Loading"
    : performance.status === "playing" ? "Pause"
    : performance.status === "paused" ? "Resume"
    : performance.status === "error" ? "Try again" : "Listen";

  useEffect(() => {
    const offState = EventBus.on("world-state", (detail: Partial<WorldState>) => {
      setWorld((previous) => ({
        ...previous, ...detail,
        room: detail.room || (isRoomId(detail.view) ? detail.view : previous.room),
      }));
    });
    const offGuide = EventBus.on("guide-message", (message: GuideMessage) => setGuide(message));
    EventBus.dispatch("world-request-state", {});
    const loadingTimeout = window.setTimeout(() => setSlowLoading(true), 10000);
    return () => {
      offState();
      offGuide();
      window.clearTimeout(loadingTimeout);
    };
  }, []);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", world.night ? COLORS.ink : COLORS.paper);
  }, [world.night]);

  useEffect(() => {
    if (!inReading) return undefined;
    readingBack.current?.focus({ preventScroll: true });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") EventBus.dispatch("close-reading", {});
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
      const trigger = readingTrigger.current;
      if (trigger?.isConnected && trigger.getClientRects().length && getComputedStyle(trigger).visibility !== "hidden") trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>(`[data-action="${readingType}"]`)?.focus({ preventScroll: true });
    };
  }, [inReading, readingType]);

  useEffect(() => {
    if (!inSeat) return undefined;
    setKeyboardOpen(false);
    standControl.current?.focus({ preventScroll: true });
    // World owns Escape so one key press starts exactly one return transition.
    return () => {
      setKeyboardOpen(false);
      const trigger = seatTrigger.current;
      if (trigger?.isConnected && !trigger.hasAttribute("disabled") && trigger.getClientRects().length
        && getComputedStyle(trigger).visibility !== "hidden") trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('[data-action="pianoSeat"]')?.focus({ preventScroll: true });
    };
  }, [inSeat]);

  useEffect(() => {
    if (!keyboardOpen) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (!pianoTools.current?.contains(event.target as Node)) setKeyboardOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inSeat) {
        setKeyboardOpen(false);
        pianoToggle.current?.focus({ preventScroll: true });
      }
    };
    const offCurtainDrag = EventBus.on("curtain-drag-start", () => setKeyboardOpen(false));
    const offCameraDrag = EventBus.on("camera-drag-start", () => setKeyboardOpen(false));
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onEscape);
      offCurtainDrag();
      offCameraDrag();
    };
  }, [keyboardOpen, inSeat]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setHideLabels(true); };
    const revealLabels = () => setHideLabels(false);
    document.addEventListener("keydown", onEscape);
    document.addEventListener("pointermove", revealLabels, { passive: true });
    document.addEventListener("focusin", revealLabels);
    return () => {
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("pointermove", revealLabels);
      document.removeEventListener("focusin", revealLabels);
    };
  }, []);

  function navigate(view: RoomId) {
    setKeyboardOpen(false);
    EventBus.dispatch("navigate", { view });
  }
  function interact(id: ObjectId) {
    if (id === "monitor" || id === "resume" || id === "leaderboard") readingTrigger.current = document.activeElement as HTMLElement;
    if (id === "pianoSeat") seatTrigger.current = document.activeElement as HTMLElement;
    EventBus.dispatch("interact", { id });
  }
  function actionPressed(id: ObjectId) {
    if (id === "blogLamp") return world.night;
    return undefined;
  }
  function dismissGuide() {
    setGuide((previous) => ({ ...previous, visible: false }));
    EventBus.dispatch("guide-dismiss", {});
    guideHelp.current?.focus({ preventScroll: true });
  }

  return (
    <div className={`room-interface${inSeat ? " room-interface--seated" : ""}`}>
      <aside className="personal-bio" hidden={inReading || inSeat || inCourtyard || inRhythm} aria-label="bbangjo">
        <h1>bbangjo</h1>
        <div className="profile-links">
          {LINKEDIN_URL && <a className="profile-link bio-linkedin" href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">LinkedIn<Icon name="external" /><span className="sr-only"> (new tab)</span></a>}
          <a className="profile-link" href={PROFILE.githubUrl} target="_blank" rel="noopener noreferrer">GitHub<Icon name="external" /><span className="sr-only"> (new tab)</span></a>
          <a className="profile-link" href={BLOG} target="_blank" rel="noopener noreferrer">Blog<Icon name="external" /><span className="sr-only"> (new tab)</span></a>
        </div>
        {!unavailable && <button className="tour-entry" disabled={actionsUnavailable} onClick={() => EventBus.dispatch('enter-courtyard', {})}>
          <span>Explore</span><Icon name="next" />
        </button>}
      </aside>
      {inCourtyard && <CourtyardUI disabled={actionsUnavailable} night={world.night} />}
      {inRhythm && <RhythmGameUI disabled={actionsUnavailable} night={world.night} muted={world.muted} />}

      <header hidden={inRhythm} className={`gallery-header${inReading ? " gallery-header--reading" : inSeat ? " gallery-header--seated" : ""}`}>
        {inReading && <button ref={readingBack} className="back-control stand-control" aria-label="Back to room" aria-keyshortcuts="Escape" title="Back to room (Esc)" onClick={() => EventBus.dispatch("close-reading", {})}><Icon name="back" /><span>Back to room</span><kbd aria-hidden="true">Esc</kbd></button>}
        {inSeat && !inReading && <button ref={standControl} className="back-control stand-control" aria-label="Stand up" aria-keyshortcuts="Escape" title="Stand up (Esc)" onClick={() => EventBus.dispatch("close-piano", {})}><Icon name="back" /><span>Stand up</span><kbd aria-hidden="true">Esc</kbd></button>}
        {!inReading && <div className="header-controls">
          {!inSeat && !inCourtyard && !inRhythm && <button ref={guideHelp} className="icon-control guide-help" disabled={unavailable} onClick={() => interact("guide")} aria-label="Show robot guide" title="Guide"><Icon name="guide" /></button>}
          <button className="icon-control sound-control" onClick={() => EventBus.dispatch("sound-toggle", {})} disabled={unavailable} aria-label={world.muted ? "Unmute" : "Mute"} aria-pressed={!world.muted} title={world.muted ? "Unmute" : "Mute"}><Icon name={world.muted ? "muted" : "sound"} /></button>
          <button type="button" className="icon-control night-switch" role="switch" aria-label="Dark mode" aria-checked={world.night}
            title={world.night ? "Turn off dark mode" : "Turn on dark mode"} disabled={unavailable}
            onClick={() => EventBus.dispatch("night-toggle", {})}>
            <Icon name={world.night ? "moon" : "sun"} />
          </button>
          <InfoMenu key={world.view} />
        </div>}
      </header>
      <p className="piano-seat-hint" hidden={!inSeat || inReading} role="status">White keys {WHITE_SHORTCUTS} · Black keys {BLACK_SHORTCUTS}<span>Play the keys · Drag to look around</span></p>

      <main className="gallery-stage" aria-label="Byeong-geun Jo's 3D space">
        <div className="hotspots" data-labels-hidden={hideLabels} hidden={unavailable || inReading || inSeat || inCourtyard || inRhythm}>
          {HOTSPOTS.map((action) => (
            <button key={action.id} data-hotspot={action.id} data-hotspot-room={action.room} className="hotspot" aria-label={action.label} aria-pressed={actionPressed(action.id)} disabled={unavailable} onClick={() => interact(action.id)}><span className="hotspot-dot" /><span className="hotspot-label">{action.label}</span></button>
          ))}
        </div>
        {unavailable && <div className="scene-status" role={world.error ? "alert" : "status"}>
          <span className="scene-status-icon"><Icon name={world.error ? "warning" : "room"} /></span>
          <p>{world.error || "Getting the space ready."}</p>
          {world.error ? <div className="status-controls"><button className="retry-control" onClick={() => window.location.reload()}>Reload</button><a className="status-link" href={BLOG}>Visit blog<Icon name="external" /></a></div>
            : <><span className="loading-track"><span /></span>{slowLoading && <a className="status-link" href={BLOG}>Read the blog<Icon name="external" /></a>}</>}
        </div>}
      </main>

      <aside className="guide-bubble" data-guide-bubble aria-label="Robot guide" hidden={inReading || inSeat || inCourtyard || inRhythm || unavailable || !guide.visible}>
        <button className="icon-control guide-close" onClick={dismissGuide} aria-label="Close guide"><Icon name="close" /></button>
        <p className="guide-text" role="status">{guide.visible ? guide.text : ""}</p>
        {guide.actionId && <button className="guide-action" onClick={() => interact(guide.actionId!)}>{guide.actionLabel}<Icon name="next" /></button>}
      </aside>

      <div className="gallery-dock" hidden={inReading || inCourtyard || inRhythm}>
        <div ref={pianoTools} className="piano-tools" hidden={room !== "piano" || unavailable}>
          <div className="piano-keyboard" id="piano-keys" role="group" aria-label="Piano keyboard" hidden={!keyboardOpen}>
            <div className="piano-keyboard-heading"><span>Keyboard</span><button className="icon-control" onClick={() => { setKeyboardOpen(false); pianoToggle.current?.focus({ preventScroll: true }); }} aria-label="Close keyboard"><Icon name="close" /></button></div>
            <div className="piano-keys">
              {PIANO_KEYS.map((key) => (
                <button key={key.midi} className={`piano-key piano-key--${key.black ? "black" : "white"}`}
                  style={key.black ? { "--black-after": key.blackAfter } as React.CSSProperties : { gridColumn: key.whiteIndex! + 1 }}
                  disabled={actionsUnavailable} data-midi={key.midi} data-black={key.black}
                  aria-label={`Play ${key.note}${key.octave}, ${key.black ? "black key" : "white key"}, keyboard shortcut ${key.key}`}
                  aria-keyshortcuts={key.key} data-playing={world.note === key.midi}
                  onClick={() => EventBus.dispatch("play-note", { midi: key.midi })}>
                  <span>{key.note}<small>{key.octave}</small></span><kbd>{key.key}</kbd>
                </button>
              ))}
            </div>
            <p className="piano-keyboard-shortcuts">White keys {WHITE_SHORTCUTS}<span>Black keys {BLACK_SHORTCUTS}</span></p>
          </div>
          <div className="piano-toolbar">
            {!inSeat && seatAction && <button className="room-action piano-seat-entry" data-action="pianoSeat" disabled={actionsUnavailable} aria-label={seatAction.label} onClick={() => interact("pianoSeat")}><Icon name="pianoSeat" /><span>{seatAction.label}</span></button>}
            <button ref={pianoToggle} className="keyboard-control" aria-expanded={keyboardOpen} aria-controls="piano-keys" onClick={() => setKeyboardOpen((open) => !open)}><Icon name="piano" /><span>Keyboard</span></button>
          </div>
          <div className="piano-performance" data-status={performance.status} role="group" aria-label="Piano performance">
            <div className="performance-controls">
              <button className="room-action performance-play" disabled={actionsUnavailable || performance.status === "loading"}
                aria-busy={performance.status === "loading" || undefined}
                onClick={() => EventBus.dispatch("piano-performance", { action: performance.status === "playing" ? "pause" : "play" })}>
                <Icon name={performance.status === "playing" ? "pause" : "performance"} /><span>{performanceLabel}</span>
              </button>
              {performanceActive && <button className="room-action performance-stop" disabled={actionsUnavailable} onClick={() => EventBus.dispatch("piano-performance", { action: "stop" })}>Stop</button>}
            </div>
            {(performance.title || performance.duration > 0) && <div className="performance-info">
              {performance.title && <span className="performance-title" title={performance.title}>{performance.title}</span>}
              {performance.duration > 0 && <output className="performance-time" aria-label="Playback time">{performanceTime(performance.elapsed)} / {performanceTime(performance.duration)}</output>}
            </div>}
            {world.pianoAudio?.status === "loading" && <p className="performance-info" role="status">Loading grand piano…</p>}
            {world.pianoAudio?.status === "error" && <p className="performance-error" role="alert">{world.pianoAudio.error}</p>}
            {performance.status === "error" && <p className="performance-error" role="alert">{performance.error || "Could not load the performance. Please try again."}</p>}
          </div>
        </div>
        <div className="room-actions" hidden={room === "piano"} role="group" aria-label="Object interactions">
          {(room === "piano" ? [] : ROOMS[room].actions).filter((action) => action.id !== "pianoSeat").map((action) => <button key={action.id} className={`room-action${action.id === "game" ? " room-action--primary" : ""}`} data-action={action.id} disabled={actionsUnavailable} aria-label={action.label} aria-pressed={actionPressed(action.id)} onClick={() => interact(action.id)}><Icon name={action.id} /><span>{action.label}</span></button>)}
        </div>
        <nav className="room-navigation" aria-label="Room navigation" hidden={inSeat}>
          <button className="room-step" disabled={unavailable} aria-label="Previous room" onClick={() => navigate(ROOM_IDS[(roomIndex + ROOM_IDS.length - 1) % ROOM_IDS.length])}><Icon name="previous" /></button>
          <button className="room-step" disabled={unavailable} aria-label="Next room" onClick={() => navigate(ROOM_IDS[(roomIndex + 1) % ROOM_IDS.length])}><Icon name="next" /></button>
        </nav>
      </div>
    </div>
  );
};

export default InterfaceUI;
