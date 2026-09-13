import * as THREE from 'three';
import Application from '../Application';
import { isReadingView, ReadingView } from '../Camera/Camera';
import { EventBus } from '../UI/EventBus';
import { isRoomId, ObjectId, ROOM_IDS, RoomId, RoomView, ROOMS } from '../../design/rooms';
import Environment from './Environment';
import MonitorScreen from './MonitorScreen';
import LeaderboardScreen from './LeaderboardScreen';
import Room from './Room';
import GuideRobot from './GuideRobot';
import HamsterRoam from './HamsterRoam';
import RhythmGame from './RhythmGame';
import RhythmStage from './RhythmStage';
import type { RhythmMusicState } from './RhythmMusic';
import { RHYTHM_KEYS, TRACK } from '../../design/rhythm-game';
import PianoPerformance from './PianoPerformance';
import Curtains from './Curtains';
import Portrait from './Portrait';
import Courtyard from './Courtyard';
import MedievalVillage from './MedievalVillage';
import { pianoMidiForKeyboard } from '../../design/piano-keys';
import type { LoadedModel } from '../../types';

export default class World {
  application: Application;
  room: Room;
  monitorScreen: MonitorScreen;
  resumeScreen: MonitorScreen;
  leaderboardScreen: LeaderboardScreen;
  environment: Environment;
  guide: GuideRobot;
  hamster: GuideRobot;
  private hamsterRoam: HamsterRoam;
  game: RhythmGame;
  rhythmStage?: RhythmStage;
  private rhythmMusic: RhythmMusicState = { ready: false, playing: false, time: 0, duration: 0, playerState: 'unstarted', muted: false };
  private rhythmStarting = false;
  private rhythmFocusPaused = false;
  private rhythmTimingOffset = 0;
  private rhythmActiveOffset = 0;
  performance: PianoPerformance;
  curtains: Curtains;
  portrait?: Portrait;
  courtyard?: Courtyard;
  village?: MedievalVillage;
  ready = false;
  night = false;
  view: RoomView = 'developer';
  activeRoom: RoomId = 'developer';
  private pendingRestore: ReadingView | null = null;
  private readingOverlay: ReadingView | null = null;
  private seatedOverlay = false;
  private dragging = false;
  private dragPointer: number | null = null;
  private lastDrag = new THREE.Vector2();
  private readonly canvasListeners: Array<() => void> = [];
  private error: string | undefined;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDown = new THREE.Vector2();
  private projection = new THREE.Vector3();
  private markers = new Map<ObjectId, HTMLButtonElement>();
  private hover: ObjectId | null = null;
  private lastPick = 0;
  private noteTimer?: number;

  constructor() {
    this.application = new Application();
    this.game = new RhythmGame({
      onPad: (index, on) => {
        if (!this.ready) return;
        this.rhythmStage?.setPad(index, on);
        if (on && this.view === 'rhythm') this.hamster.danceStep(index);
      },
      onState: (game) => EventBus.dispatch('rhythm-state', game),
      onJudgement: (hit) => EventBus.dispatch('rhythm-hit', hit),
      onResult: () => this.hamster?.react('success'),
    });
    this.application.resources.on('ready', () => this.initialize());
    this.application.resources.on('error', (error: string) => { this.error = error; this.publish(); });
    this.application.camera.on('reading-return-safe', () => this.restoreRoom());
    this.application.camera.on('settled', () => {
      if (!this.ready) return;
      if (!isReadingView(this.view)) this.restoreRoom();
      this.room.show();
      this.syncScreens();
      this.readingOverlay = isReadingView(this.view) ? this.view : null;
      this.seatedOverlay = this.view === 'piano-seat';
      if (!isReadingView(this.view) && this.view !== 'piano-seat' && this.view !== 'courtyard' && this.view !== 'exhibit' && this.view !== 'rhythm') {
        this.guide.setReading(false);
        this.guide.setRoom(this.activeRoom, true);
      }
      this.publish();
    });
    EventBus.on('world-request-state', () => this.publish());
    EventBus.on('navigate', ({ view }: { view: unknown }) => { if (isRoomId(view)) this.navigate(view); });
    EventBus.on('enter-courtyard', ({ id }: { id?: string }) => {
      if (!this.ready || this.error || this.application.camera.transitioning || !isRoomId(this.view)) return;
      this.navigate('courtyard', id);
    });
    EventBus.on('leave-courtyard', () => { if (this.view === 'courtyard') this.navigate(this.activeRoom); });
    EventBus.on('interact', ({ id }: { id: ObjectId }) => this.interact(id));
    EventBus.on('close-monitor', () => this.closeReading());
    EventBus.on('close-reading', () => this.closeReading());
    EventBus.on('leaderboard-open', () => {
      if (this.ready && !this.error && !this.application.camera.transitioning && this.activeRoom === 'ai' && (this.view === 'ai' || this.view === 'rhythm')) this.navigate('leaderboard');
    });
    EventBus.on('close-piano', () => { if (this.view === 'piano-seat') this.navigate('piano'); });
    EventBus.on('guide-dismiss', () => this.guide?.dismiss());
    EventBus.on('guide-help', () => this.guide?.help());
    EventBus.on('play-note', ({ midi }: { midi: number }) => this.playNote(midi));
    EventBus.on('night-toggle', () => this.toggleNight());
    EventBus.on('rhythm-request-state', () => EventBus.dispatch('rhythm-state', this.game.getSnapshot()));
    EventBus.on('rhythm-music-state', (state: RhythmMusicState) => this.onRhythmMusic(state));
    EventBus.on('rhythm-viewport', (rect: { left: number; top: number; width: number; height: number }) => this.application.camera.setRhythmViewport(rect));
    EventBus.on('rhythm-action', ({ action }: { action: string }) => this.rhythmAction(action));
    EventBus.on('rhythm-timing', ({ offsetMs }: { offsetMs: number }) => {
      if (typeof offsetMs === 'number' && Number.isFinite(offsetMs)) this.rhythmTimingOffset = THREE.MathUtils.clamp(offsetMs, -250, 250) / 1000;
    });
    EventBus.on('rhythm-input', ({ lane, down, source }: { lane: number; down: boolean; source: string }) => {
      if (!down) { this.game.release(source); return; }
      if (this.view !== 'rhythm' || this.rhythmFocusPaused || !this.rhythmMusic.playing) return;
      this.game.update(this.rhythmMusic.time + this.rhythmActiveOffset, true); this.game.press(lane, source);
    });
    EventBus.on('world-state', ({ muted }: { muted?: boolean }) => {
      if (typeof muted === 'boolean' && this.view === 'rhythm') EventBus.dispatch('rhythm-music-action', { action: 'mute', muted });
    });
    EventBus.on('piano-performance', ({ action }: { action: 'play' | 'pause' | 'stop' }) => {
      if (!this.ready || this.application.camera.transitioning || (this.view !== 'piano' && this.view !== 'piano-seat')) return;
      if (action === 'play') {
        window.clearTimeout(this.noteTimer);
        EventBus.dispatch('world-state', { note: null });
        this.guide.hide();
        void this.performance.play();
      } else if (action === 'pause') this.performance.pause();
      else if (action === 'stop') this.performance.stop();
    });
    document.addEventListener('keydown', (event) => this.keydown(event));
    window.addEventListener('keyup', (event) => this.game.release('key-' + event.code));
    window.addEventListener('blur', () => this.pauseRhythmForFocus());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pauseRhythmForFocus(); });
    window.addEventListener('message', (event) => {
      if (!isReadingView(this.view) || event.data?.type !== 'keydown' || event.data?.key !== 'Escape') return;
      const screen = this.view === 'resume' ? this.resumeScreen : this.view === 'leaderboard' ? this.leaderboardScreen : this.monitorScreen;
      const origin = this.view === 'monitor' ? 'https://blog.bbangjo.kr' : window.location.origin;
      if (event.origin === origin && event.source === screen?.iframe.contentWindow) this.closeReading();
    });
    this.bindCanvas();
  }

  private initialize() {
    try {
      this.room = new Room();
      this.room.add();
      this.rhythmStage = new RhythmStage(this.application.scene);
      const playRoom = this.room.groups.get('ai')!;
      this.rhythmStage.root.position.copy(playRoom.localToWorld(new THREE.Vector3(2.8, 0, 2.3)));
      playRoom.getWorldQuaternion(this.rhythmStage.root.quaternion);
      this.rhythmStage.root.userData.interactiveId = 'game';
      this.room.targets.get('game')!.visible = false;
      this.room.targets.set('game', this.rhythmStage.root);
      this.room.anchors.set('game', this.rhythmStage.focusAnchor);
      this.application.camera.setRhythmTarget(this.rhythmStage.focusAnchor);
      this.guide = new GuideRobot(this.application, this.room.robot);
      this.hamster = new GuideRobot(this.application, (this.application.resources.items.guideCharacterModel as LoadedModel).scene, { role: 'companion' });
      this.hamsterRoam = new HamsterRoam(this.hamster);
      this.hamsterRoam.resume();
      this.courtyard = new Courtyard(this.application, this.guide, {
        canInteract: () => this.ready && !this.error,
        open: (anchor) => {
          this.curtains?.cancelDrag(); this.cancelCameraDrag();
          this.view = 'exhibit';
          this.application.camera.setExhibit(anchor, 2.6, 1.7);
          this.application.camera.navigate('exhibit');
          this.publish();
        },
        close: () => {
          if (this.view !== 'exhibit') return;
          this.view = 'courtyard';
          this.application.camera.navigate('courtyard');
          this.publish();
        },
      });
      this.performance = new PianoPerformance(this.application.audioPlayer, {
        onKeys: (keys) => this.room.holdKeys(keys, this.reducedMotion.matches),
        onRepeatedAttack: (keys) => this.room.restrikeKeys(keys, this.reducedMotion.matches),
        onState: (performance) => EventBus.dispatch('world-state', { performance }),
      });
      this.environment = new Environment();
      this.environment.add();
      this.curtains = new Curtains({
        canvas: this.application.renderer.instance.domElement,
        root: this.room.root,
        camera: () => this.application.camera.instance,
        getRoom: () => this.activeRoom,
        pick: (event) => this.pick(event),
        canInteract: () => this.ready && !this.error && this.view !== 'courtyard' && this.view !== 'exhibit' && !isReadingView(this.view) && !this.application.camera.transitioning,
        onChange: () => { this.application.renderer.instance.shadowMap.needsUpdate = true; },
        onDragStart: () => EventBus.dispatch('curtain-drag-start', {}),
      });
      const lamp = this.room.anchors.get('blogLamp');
      if (lamp) this.environment.setLampPosition(lamp.getWorldPosition(new THREE.Vector3()));
      this.village = new MedievalVillage(this.application, this.room.root);
      this.monitorScreen = new MonitorScreen(this.room.monitorAnchor);
      this.monitorScreen.add();
      this.resumeScreen = new MonitorScreen(this.room.resumeAnchor, {
        id: 'resumeScreen', src: '/story.html', title: 'bbangjo · Summary', width: 2.3, height: 2.78, pixels: 720, mobilePixels: 420,
      });
      this.resumeScreen.add();
      this.leaderboardScreen = new LeaderboardScreen(this.room.leaderboardAnchor);
      this.leaderboardScreen.add();
      const portraitAnchor = this.room.root.getObjectByName('PortraitScreenAnchor');
      if (portraitAnchor) {
        this.portrait = new Portrait(portraitAnchor);
        this.portrait.add();
      }
      this.application.camera.setMonitor(this.room.monitorAnchor, 1.4, 0.84);
      this.application.camera.setResume(this.room.resumeAnchor, 2.3, 2.78);
      this.application.camera.setLeaderboard(this.room.leaderboardAnchor, 2.3, 2.78);
      this.application.camera.setPianoSeat(this.room.pianoEyeAnchor, this.room.pianoLookAnchor);
      this.application.camera.navigate('developer', true);
      this.environment.setRoom('developer', true);
      this.ready = true;
      this.syncScreens();
      this.guide.setRoom('developer', true);
      this.publish();
    } catch (error) {
      console.error('Guided room initialization failed', error);
      this.error = 'Could not load this space. You can still visit the blog.';
      this.publish();
    }
  }

  private publish() {
    document.body.dataset.view = this.view;
    document.body.dataset.room = this.activeRoom;
    document.body.dataset.seated = String(this.seatedOverlay);
    const night = this.night;
    document.body.dataset.night = String(night);
    EventBus.dispatch('world-state', { ready: this.ready, transitioning: this.application.camera.transitioning, view: this.view, room: this.activeRoom, readingView: this.readingOverlay, seated: this.view === 'piano-seat', seatedTransition: this.seatedOverlay, night, activity: null, error: this.error, game: this.game.getSnapshot() });
    if (this.performance) EventBus.dispatch('world-state', { performance: this.performance.getSnapshot() });
  }

  private closeReading() { if (isReadingView(this.view)) this.navigate(this.view === 'resume' ? 'developer' : this.view === 'leaderboard' ? 'ai' : 'blog'); }

  navigate(view: RoomView, stationId?: string) {
    if (!this.ready || this.view === view) return;
    if (view === 'monitor' && this.activeRoom !== 'blog') return;
    if (view === 'resume' && this.activeRoom !== 'developer') return;
    if (view === 'leaderboard' && this.activeRoom !== 'ai') return;
    if (view === 'piano-seat' && this.activeRoom !== 'piano') return;
    if (view === 'rhythm' && this.activeRoom !== 'ai') return;
    const oldView = this.view;
    if ((oldView === 'courtyard' || oldView === 'exhibit') && view !== 'courtyard') this.courtyard?.leave();
    this.curtains?.cancelDrag();
    this.cancelCameraDrag();
    this.setHover(null);
    const pianoContext = (oldView === 'piano' || oldView === 'piano-seat') && (view === 'piano' || view === 'piano-seat');
    if (!pianoContext) this.stopRoomActivity();
    if (view === 'rhythm') this.performance.stop();
    if (oldView === 'rhythm') {
      this.hamster.setDancing(null);
      this.hamsterRoam.resume();
      this.guide.setReading(false);
      this.courtyard?.meadow.setOutdoor(false);
    }
    this.monitorScreen.setInteractive(false);
    this.resumeScreen.setInteractive(false);
    this.leaderboardScreen.setInteractive(false);
    if (isReadingView(oldView)) this.pendingRestore = oldView;
    this.view = view;
    if (isRoomId(view)) this.activeRoom = view;
    this.room.show();
    this.syncScreens();
    if (view === 'courtyard') {
      this.readingOverlay = null;
      this.seatedOverlay = false;
      this.courtyard?.enter(stationId, this.activeRoom);
    } else if (view === 'rhythm') {
      this.readingOverlay = null; this.seatedOverlay = false;
      this.guide.setReading(true);
      this.hamster.root.scale.setScalar(1);
      this.hamster.setDancing(this.rhythmStage!.dancerAnchor);
      this.application.scene.fog = null;
    } else if (isReadingView(view)) {
      // A quick re-entry cancels the pending reveal and preserves only the reader.
      this.pendingRestore = null;
      this.readingOverlay = view;
      this.guide.setReading(true);
    } else if (view === 'piano-seat') {
      this.seatedOverlay = true;
      this.guide.setReading(true);
    } else {
      this.guide.setRoom(this.activeRoom, this.reducedMotion.matches);
    }
    this.environment.setRoom(this.activeRoom, this.reducedMotion.matches);
    this.environment.setCourtyard?.(view === 'courtyard' || view === 'exhibit');
    this.application.camera.navigate(view, view === 'rhythm' || oldView === 'rhythm');
    if (view === 'piano-seat') void this.application.audioPlayer.preload();
    this.publish();
  }

  private restoreRoom() {
    if (!this.ready || !this.pendingRestore || isReadingView(this.view)) return;
    this.pendingRestore = null;
    if (!this.application.camera.transitioning) this.guide.setReading(false);
    this.guide.setRoom(this.activeRoom, true);
  }

  private syncScreens() {
    // Both documents remain in the house, depth-occluded naturally by its walls.
    const rhythm = this.view === 'rhythm';
    this.room.root.visible = !rhythm;
    this.monitorScreen.setVisible(!rhythm);
    this.resumeScreen.setVisible(!rhythm);
    this.leaderboardScreen.setVisible(!rhythm);
    this.rhythmStage?.setVisible(true);
    if (this.courtyard) {
      this.courtyard.root.visible = this.view === 'courtyard' || this.view === 'exhibit';
      this.courtyard.meadow.root.visible = !rhythm;
    }
    if (this.portrait) this.portrait.object.visible = this.portrait.mesh.visible = !rhythm && this.portrait.image.naturalWidth > 0;
  }

  interact(id: ObjectId) {
    if (!this.ready || this.error || this.view === 'courtyard' || this.view === 'exhibit' || this.view === 'rhythm' || isReadingView(this.view) || this.application.camera.transitioning) return;
    if (id === 'guide') { this.guide.help(); return; }
    if (id.startsWith('key')) { this.playNote(Number(id.slice(3))); return; }
    if (id.startsWith('gamePad')) {
      if (this.view === 'ai') this.navigate('rhythm');
      return;
    }
    if (!ROOMS[this.activeRoom].actions.some((action) => action.id === id)) return;
    if (id === 'pianoSeat') this.navigate('piano-seat');
    else if (id === 'monitor' || id === 'resume' || id === 'leaderboard') this.navigate(id);
    else if (id === 'blogLamp') this.toggleNight();
    else if (id === 'game') this.navigate('rhythm');
  }

  private toggleNight() {
    if (!this.ready) return;
    this.night = !this.night;
    this.environment.setNight(this.night, this.reducedMotion.matches);
    this.village?.setNight(this.night);
    this.publish();
  }

  private playNote(midi: number) {
    if (!this.ready || (this.view !== 'piano' && this.view !== 'piano-seat') || this.application.camera.transitioning || !Number.isInteger(midi) || midi < 60 || midi > 83) return;
    this.performance.stop();
    void this.application.audioPlayer.playNote(midi);
    this.room.pressKey(midi, this.reducedMotion.matches);
    window.clearTimeout(this.noteTimer);
    EventBus.dispatch('world-state', { note: midi });
    this.noteTimer = window.setTimeout(() => EventBus.dispatch('world-state', { note: null }), 350);
  }

  private rhythmAction(action: string) {
    if (this.view !== 'rhythm' || !this.ready) return;
    if (action === 'exit') { this.navigate('ai'); return; }
    if (action === 'pause') {
      this.rhythmStarting = false; this.game.pause();
      EventBus.dispatch('rhythm-music-action', { action: 'pause' });
      return;
    }
    if (!this.rhythmMusic.ready) return;
    this.rhythmFocusPaused = false;
    if (action === 'start' || action === 'restart') {
      this.rhythmStarting = true;
      this.rhythmActiveOffset = this.rhythmTimingOffset;
      this.game.cancel();
      // Dispatch synchronously to preserve the browser's playback gesture.
      EventBus.dispatch('rhythm-music-action', { action: 'restart' });
    } else if (action === 'resume') EventBus.dispatch('rhythm-music-action', { action: 'play' });
  }

  private onRhythmMusic(state: RhythmMusicState) {
    if (this.view !== 'rhythm') return;
    this.rhythmMusic = state;
    if (this.rhythmFocusPaused) {
      if (state.playing) EventBus.dispatch('rhythm-music-action', { action: 'pause' });
      this.hamster?.setDanceBeat(state.time, false, TRACK.bpm);
      return;
    }
    if (state.error) { this.rhythmStarting = false; this.game.pause(); }
    if (this.rhythmStarting) {
      // A seek is asynchronous. Old timestamps must not instantly miss a new run.
      if (state.time > .5 || !state.ready) return;
      this.rhythmStarting = false; this.game.start();
    }
    if (state.playerState === 'ended') this.game.update(TRACK.duration, true);
    else if (state.playing) this.game.update(state.time + this.rhythmActiveOffset, true);
    else if (state.playerState === 'paused' || state.playerState === 'buffering') this.game.pause();
    this.hamster?.setDanceBeat(state.time, state.playing && this.game.state.phase !== 'finished', TRACK.bpm);
  }

  private pauseRhythmForFocus() {
    if (this.view !== 'rhythm') return;
    this.rhythmFocusPaused = true; this.rhythmStarting = false;
    this.game.pause();
    EventBus.dispatch('rhythm-music-action', { action: 'pause' });
    this.hamster?.setDanceBeat(this.rhythmMusic.time, false, TRACK.bpm);
  }

  private stopRoomActivity() {
    window.clearTimeout(this.noteTimer);
    this.game.cancel();
    this.rhythmStarting = false; this.rhythmFocusPaused = false;
    if (this.view === 'rhythm') EventBus.dispatch('rhythm-music-action', { action: 'stop' });
    this.application.audioPlayer.stopInteractiveNotes();
    this.room.stopMotion({ preservePiano: this.performance?.getSnapshot().status === 'playing' });
    EventBus.dispatch('world-state', { note: null });
  }

  private stopActions() {
    this.performance?.stop();
    this.application.audioPlayer.stopNotes();
    this.stopRoomActivity();
  }

  private keydown(event: KeyboardEvent) {
    if (!this.ready || this.error || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (this.view === 'exhibit') {
      if (event.key === 'Escape' && !event.repeat) { event.preventDefault(); this.courtyard?.close(); }
      return;
    }
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (this.view === 'rhythm') {
      if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) this.navigate('ai'); return; }
      const key = RHYTHM_KEYS.find(item => item.code === event.code);
      if (key) {
        event.preventDefault();
        if (!event.repeat && !this.rhythmFocusPaused && this.rhythmMusic.playing) {
          this.game.update(this.rhythmMusic.time + this.rhythmActiveOffset, true); this.game.press(key.lane, 'key-' + event.code);
        }
      }
      return;
    }
    if (this.view === 'courtyard') {
      if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) this.navigate(this.activeRoom); }
      else this.courtyard?.keydown(event);
      return;
    }
    if (event.key === 'Escape' && isReadingView(this.view)) { this.closeReading(); return; }
    if (isReadingView(this.view)) return;
    if (event.key === 'Escape' && this.view === 'piano-seat') { this.navigate('piano'); return; }
    if (this.view === 'piano' || this.view === 'piano-seat') {
      const midi = pianoMidiForKeyboard(event);
      if (midi !== undefined && !event.repeat) { event.preventDefault(); this.playNote(midi); return; }
    }
    if (this.view === 'piano-seat') return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.repeat) {
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      this.navigate(ROOM_IDS[(ROOM_IDS.indexOf(this.activeRoom) + offset + ROOM_IDS.length) % ROOM_IDS.length]);
    }
  }

  private bindCanvas() {
    const canvas = this.application.renderer.instance.domElement;
    const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void) => {
      target.addEventListener(type, handler as EventListener);
      this.canvasListeners.push(() => target.removeEventListener(type, handler as EventListener));
    };
    listen(canvas, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || this.dragPointer !== null || !this.canLookAround()) return;
      this.dragPointer = event.pointerId;
      this.pointerDown.set(event.clientX, event.clientY);
      this.lastDrag.copy(this.pointerDown);
      this.dragging = false;
      // Curtain capture listeners claim their gestures before this handler.
      try { canvas.setPointerCapture(event.pointerId); } catch { /* Window listeners cover outside releases. */ }
    });
    listen(window, 'pointerup', (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointer) return;
      const dragged = this.dragging;
      this.cancelCameraDrag();
      if (event.button !== 0 || dragged || !this.canLookAround() || this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 8) return;
      const id = this.pick(event);
      if (id) this.interact(id);
    });
    listen(window, 'pointermove', (event: PointerEvent) => {
      if (this.dragPointer !== null) {
        if (event.pointerId !== this.dragPointer) return;
        if (!this.canLookAround() || (event.pointerType === 'mouse' && !(event.buttons & 1))) {
          this.cancelCameraDrag();
          return;
        }
        if (this.dragging || this.pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 8) {
          if (!this.dragging) EventBus.dispatch('camera-drag-start', {});
          this.dragging = true;
          const dx = event.clientX - this.lastDrag.x;
          const dy = event.clientY - this.lastDrag.y;
          if (this.view === 'piano-seat') this.application.camera.lookSeated(dx, dy);
          else if (this.view === 'courtyard') this.application.camera.lookCourtyard(dx, dy);
          else this.application.camera.lookRoom(dx, dy);
          this.lastDrag.set(event.clientX, event.clientY);
          this.setHover(null);
          canvas.style.cursor = 'grabbing';
        }
        if (this.dragging) return;
      }
      if (event.target !== canvas || event.isPrimary === false || performance.now() - this.lastPick < 50 || event.pointerType === 'touch') return;
      this.lastPick = performance.now();
      this.setHover(this.pick(event));
    });
    listen(canvas, 'pointerleave', () => { if (!this.dragging && !this.curtains?.isDragging) this.setHover(null); });
    const cancelPointer = (event: PointerEvent) => { if (event.pointerId === this.dragPointer) this.cancelCameraDrag(); };
    listen(window, 'pointercancel', cancelPointer);
    listen(canvas, 'lostpointercapture', cancelPointer);
    listen(window, 'blur', () => this.cancelCameraDrag());
    listen(window, 'resize', () => this.cancelCameraDrag());
    listen(window, 'keydown', (event: KeyboardEvent) => { if (event.key === 'Escape') this.cancelCameraDrag(); });
    listen(canvas, 'webglcontextlost', (event) => {
      event.preventDefault();
      this.error = 'The 3D view has paused. Please reload or visit the blog.';
      this.courtyard?.walk.stop();
      this.curtains?.cancelDrag();
      this.cancelCameraDrag();
      if (this.ready) this.stopActions();
      this.publish();
    });
    listen(canvas, 'webglcontextrestored', () => { this.error = undefined; this.application.renderer.instance.shadowMap.needsUpdate = true; this.publish(); });
  }

  private canLookAround(): boolean {
    return this.ready && !this.error && this.view !== 'rhythm' && this.view !== 'exhibit' && !isReadingView(this.view) && !this.application.camera.transitioning;
  }

  private cancelCameraDrag() {
    const pointerId = this.dragPointer;
    this.dragPointer = null;
    this.dragging = false;
    const canvas = this.application.renderer.instance.domElement;
    try {
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch { /* Capture may already have been released by the browser. */ }
    if (!this.curtains?.isDragging) this.setHover(null);
  }

  disposeInput() {
    this.cancelCameraDrag();
    this.canvasListeners.splice(0).forEach((off) => off());
  }

  private pick(event: PointerEvent): ObjectId | null {
    if (!this.ready || this.view === 'courtyard' || this.view === 'exhibit' || this.view === 'rhythm' || isReadingView(this.view) || this.application.camera.transitioning) return null;
    const rect = this.application.renderer.instance.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.application.camera.instance);
    const hit = this.raycaster.intersectObjects([this.room.root, this.guide.root, ...(this.rhythmStage ? [this.rhythmStage.root] : [])], true).find((item) => {
      let ancestor: THREE.Object3D | null = item.object;
      while (ancestor) { if (!ancestor.visible) return false; ancestor = ancestor.parent; }
      return true;
    });
    let object: THREE.Object3D | null = hit?.object || null;
    let id: ObjectId | null = null;
    let active = false;
    while (object) {
      if (!id && object.userData.interactiveId) id = object.userData.interactiveId as ObjectId;
      if (object === this.room.groups.get(this.activeRoom) || object === this.guide.root) active = true;
      if (object === this.rhythmStage?.root && this.activeRoom === 'ai') { id = 'game'; active = true; }
      object = object.parent;
    }
    return active ? id : null;
  }

  private setHover(id: ObjectId | null) {
    const curtain = id === 'curtainLeft' || id === 'curtainRight';
    this.application.renderer.instance.domElement.style.cursor = curtain || (!id && this.canLookAround()) ? 'grab' : id ? 'pointer' : 'default';
    if (this.hover === id) return;
    if (this.hover) this.markers.get(this.hover)?.classList.remove('is-hovered');
    this.hover = id;
    if (id) this.markers.get(id)?.classList.add('is-hovered');
  }

  update() {
    if (!this.ready) return;
    this.village?.update(this.application.time.delta, isReadingView(this.view) || this.view === 'piano-seat');
    this.performance.update();
    this.guide.update();
    if (!this.error) this.courtyard?.update();
    this.hamster.root.visible = this.view === 'rhythm' || this.view === 'courtyard' || isRoomId(this.view);
    if (this.view === 'rhythm') this.hamster.update();
    else if (this.hamster.root.visible && !this.error && !this.application.camera.transitioning) {
      this.hamsterRoam.update(this.application.time.delta, this.view === 'courtyard' ? this.courtyard?.walk : undefined);
    }
    if (this.view === 'rhythm') {
      this.application.scene.fog = null;
      if (this.portrait) this.portrait.mesh.visible = this.portrait.object.visible = false;
    }
    this.monitorScreen.update();
    this.resumeScreen.update();
    this.resumeScreen.setNightTheme(this.night);
    this.leaderboardScreen.update();
    this.leaderboardScreen.setDisplay(this.activeRoom === 'ai' && (this.view === 'ai' || this.view === 'leaderboard'), this.night);
    this.portrait?.update();
    const settled = !this.application.camera.transitioning;
    this.monitorScreen.setInteractive(settled && this.view === 'monitor');
    this.resumeScreen.setInteractive(settled && this.view === 'resume');
    this.leaderboardScreen.setInteractive(settled && this.view === 'leaderboard');
    this.room.anchors.forEach((anchor, id) => {
      let marker = this.markers.get(id);
      if (!marker || !marker.isConnected) {
        marker = document.querySelector<HTMLButtonElement>(`[data-hotspot="${id}"]`) || undefined;
        if (!marker) return;
        this.markers.set(id, marker);
      }
      anchor.getWorldPosition(this.projection).project(this.application.camera.instance);
      const x = (this.projection.x * 0.5 + 0.5) * innerWidth;
      const y = (-this.projection.y * 0.5 + 0.5) * innerHeight;
      const visible = this.view !== 'courtyard' && this.view !== 'exhibit' && this.view !== 'rhythm' && !isReadingView(this.view) && !this.seatedOverlay && settled
        && ROOMS[this.activeRoom].actions.some((action) => action.id === id)
        && x > 24 && x < innerWidth - 24 && y > 80 && y < innerHeight - 110 && Math.abs(this.projection.z) < 1;
      marker.style.transform = `translate(${x}px, ${y}px)`;
      marker.style.visibility = visible ? 'visible' : 'hidden';
      marker.disabled = !visible;
    });
    const bubble = document.querySelector<HTMLElement>('[data-guide-bubble]');
    if (bubble) {
      this.guide.anchor.getWorldPosition(this.projection).project(this.application.camera.instance);
      const width = bubble.offsetWidth || 240;
      const rawX = (this.projection.x * 0.5 + 0.5) * innerWidth;
      const rawY = (-this.projection.y * 0.5 + 0.5) * innerHeight - 16;
      const dock = document.querySelector<HTMLElement>('.gallery-dock');
      const bio = document.querySelector<HTMLElement>('.personal-bio');
      const top = innerWidth < 1000 ? Math.max(88, (bio?.getBoundingClientRect().bottom || 156) + 8) : 88;
      const bottom = Math.min(innerHeight - 16, (dock?.getBoundingClientRect().top || innerHeight - 100) - 12);
      bubble.style.maxHeight = `${Math.max(80, Math.min(192, bottom - top))}px`;
      const height = bubble.offsetHeight || 130;
      const left = innerWidth >= 1000 ? 296 : 12;
      const x = Math.max(left, Math.min(innerWidth - width - 12, rawX - width / 2));
      const y = Math.max(top, Math.min(bottom - height, rawY - height));
      bubble.style.transform = `translate(${x}px, ${y}px)`;
      bubble.style.visibility = !isReadingView(this.view) && !this.seatedOverlay && settled && !this.pendingRestore ? 'visible' : 'hidden';
    }
  }
}
