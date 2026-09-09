import * as THREE from 'three';
import Application from '../Application';
import { isReadingView, ReadingView } from '../Camera/Camera';
import { EventBus } from '../UI/EventBus';
import { isRoomId, ObjectId, ROOM_IDS, RoomId, RoomView, ROOMS } from '../../design/rooms';
import Environment from './Environment';
import MonitorScreen from './MonitorScreen';
import Room from './Room';
import GuideRobot from './GuideRobot';
import MemoryGame from './MemoryGame';
import PianoPerformance from './PianoPerformance';
import Curtains from './Curtains';
import Portrait from './Portrait';
import { pianoMidiForKeyboard } from '../../design/piano-keys';

export default class World {
  application: Application;
  room: Room;
  monitorScreen: MonitorScreen;
  resumeScreen: MonitorScreen;
  environment: Environment;
  guide: GuideRobot;
  game: MemoryGame;
  performance: PianoPerformance;
  curtains: Curtains;
  portrait?: Portrait;
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
    this.game = new MemoryGame({
      onPad: (index, on) => {
        if (!this.ready) return;
        this.room.lightPad(index, on, this.reducedMotion.matches);
        if (on && this.view === 'ai') {
          this.room.pressPad(index, this.reducedMotion.matches);
          void this.application.audioPlayer.playNote([60, 64, 67, 72][index], 0.4);
        }
      },
      onState: (game) => EventBus.dispatch('world-state', { game }),
      onResult: (result) => this.guide?.react(result === 'won' ? 'success' : 'failure'),
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
      if (!isReadingView(this.view) && this.view !== 'piano-seat') {
        this.guide.setReading(false);
        this.guide.setRoom(this.activeRoom, true);
      }
      this.publish();
    });
    EventBus.on('world-request-state', () => this.publish());
    EventBus.on('navigate', ({ view }: { view: unknown }) => { if (isRoomId(view)) this.navigate(view); });
    EventBus.on('interact', ({ id }: { id: ObjectId }) => this.interact(id));
    EventBus.on('close-monitor', () => this.closeReading());
    EventBus.on('close-reading', () => this.closeReading());
    EventBus.on('close-piano', () => { if (this.view === 'piano-seat') this.navigate('piano'); });
    EventBus.on('guide-dismiss', () => this.guide?.dismiss());
    EventBus.on('guide-help', () => this.guide?.help());
    EventBus.on('play-note', ({ midi }: { midi: number }) => this.playNote(midi));
    EventBus.on('night-toggle', () => this.toggleNight());
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
    window.addEventListener('message', (event) => {
      if (!isReadingView(this.view) || event.data?.type !== 'keydown' || event.data?.key !== 'Escape') return;
      const screen = this.view === 'resume' ? this.resumeScreen : this.monitorScreen;
      const origin = this.view === 'resume' ? window.location.origin : 'https://blog.bbangjo.kr';
      if (event.origin === origin && event.source === screen?.iframe.contentWindow) this.closeReading();
    });
    this.bindCanvas();
  }

  private initialize() {
    try {
      this.room = new Room();
      this.room.add();
      this.guide = new GuideRobot(this.application, this.room.robot);
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
        canInteract: () => this.ready && !this.error && !isReadingView(this.view) && !this.application.camera.transitioning,
        onChange: () => { this.application.renderer.instance.shadowMap.needsUpdate = true; },
        onDragStart: () => EventBus.dispatch('curtain-drag-start', {}),
      });
      const lamp = this.room.anchors.get('blogLamp');
      if (lamp) this.environment.setLampPosition(lamp.getWorldPosition(new THREE.Vector3()));
      this.monitorScreen = new MonitorScreen(this.room.monitorAnchor);
      this.monitorScreen.add();
      this.resumeScreen = new MonitorScreen(this.room.resumeAnchor, {
        id: 'resumeScreen', src: '/story.html', title: 'bbangjo · Summary', width: 2.3, height: 2.78, pixels: 720, mobilePixels: 420,
      });
      this.resumeScreen.add();
      const portraitAnchor = this.room.root.getObjectByName('PortraitScreenAnchor');
      if (portraitAnchor) {
        this.portrait = new Portrait(portraitAnchor);
        this.portrait.add();
      }
      this.application.camera.setMonitor(this.room.monitorAnchor, 1.4, 0.84);
      this.application.camera.setResume(this.room.resumeAnchor, 2.3, 2.78);
      this.application.camera.setPianoSeat(this.room.pianoEyeAnchor, this.room.pianoLookAnchor);
      this.application.camera.navigate('developer', true);
      this.environment.setRoom('developer', true);
      this.ready = true;
      this.syncScreens();
      this.guide.setRoom('developer', true);
      this.publish();
    } catch (error) {
      console.error('Guided room initialization failed', error);
      this.error = '공간을 준비하지 못했어요. 블로그로 바로 이동할 수 있어요.';
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

  private closeReading() { if (isReadingView(this.view)) this.navigate(this.view === 'resume' ? 'developer' : 'blog'); }

  navigate(view: RoomView) {
    if (!this.ready || this.view === view) return;
    if (view === 'monitor' && this.activeRoom !== 'blog') return;
    if (view === 'resume' && this.activeRoom !== 'developer') return;
    if (view === 'piano-seat' && this.activeRoom !== 'piano') return;
    const oldView = this.view;
    this.curtains?.cancelDrag();
    this.cancelCameraDrag();
    this.setHover(null);
    const pianoContext = (oldView === 'piano' || oldView === 'piano-seat') && (view === 'piano' || view === 'piano-seat');
    if (!pianoContext) this.stopRoomActivity();
    this.monitorScreen.setInteractive(false);
    this.resumeScreen.setInteractive(false);
    if (isReadingView(oldView)) this.pendingRestore = oldView;
    this.view = view;
    if (isRoomId(view)) this.activeRoom = view;
    this.room.show();
    this.syncScreens();
    if (isReadingView(view)) {
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
    this.application.camera.navigate(view);
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
    this.monitorScreen.setVisible(true);
    this.resumeScreen.setVisible(true);
  }

  interact(id: ObjectId) {
    if (!this.ready || isReadingView(this.view) || this.application.camera.transitioning) return;
    if (id === 'guide') { this.guide.help(); return; }
    if (id.startsWith('key')) { this.playNote(Number(id.slice(3))); return; }
    if (id.startsWith('gamePad')) {
      if (this.view === 'ai') this.game.press(Number(id.slice(7)));
      return;
    }
    if (!ROOMS[this.activeRoom].actions.some((action) => action.id === id)) return;
    if (id === 'pianoSeat') this.navigate('piano-seat');
    else if (id === 'monitor' || id === 'resume') this.navigate(id);
    else if (id === 'blogLamp') this.toggleNight();
    else if (id === 'game') {
      if (this.game.state.phase === 'showing' || this.game.state.phase === 'input') return;
      this.guide.hide();
      // The first light callback is synchronous, so audio is unlocked by this gesture.
      this.game.start();
    }
  }

  private toggleNight() {
    if (!this.ready) return;
    this.night = !this.night;
    this.environment.setNight(this.night, this.reducedMotion.matches);
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

  private stopRoomActivity() {
    window.clearTimeout(this.noteTimer);
    this.game.cancel();
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
    if (!this.ready || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Escape' && isReadingView(this.view)) { this.closeReading(); return; }
    if (isReadingView(this.view)) return;
    if (event.key === 'Escape' && this.view === 'piano-seat') { this.navigate('piano'); return; }
    if (this.view === 'piano' || this.view === 'piano-seat') {
      const midi = pianoMidiForKeyboard(event);
      if (midi !== undefined && !event.repeat) { event.preventDefault(); this.playNote(midi); return; }
    }
    if (this.view === 'ai' && /^[1-4]$/.test(event.key) && !event.repeat) {
      event.preventDefault(); this.game.press(Number(event.key) - 1); return;
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
      this.error = '3D 화면이 잠시 멈췄어요. 새로고침하거나 블로그로 이동해 주세요.';
      this.curtains?.cancelDrag();
      this.cancelCameraDrag();
      if (this.ready) this.stopActions();
      this.publish();
    });
    listen(canvas, 'webglcontextrestored', () => { this.error = undefined; this.application.renderer.instance.shadowMap.needsUpdate = true; this.publish(); });
  }

  private canLookAround(): boolean {
    return this.ready && !this.error && !isReadingView(this.view) && !this.application.camera.transitioning;
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
    if (!this.ready || isReadingView(this.view) || this.application.camera.transitioning) return null;
    const rect = this.application.renderer.instance.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.application.camera.instance);
    const hit = this.raycaster.intersectObjects([this.room.root, this.guide.root], true).find((item) => {
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
    this.performance.update();
    this.guide.update();
    this.monitorScreen.update();
    this.resumeScreen.update();
    this.portrait?.update();
    const settled = !this.application.camera.transitioning;
    this.monitorScreen.setInteractive(settled && this.view === 'monitor');
    this.resumeScreen.setInteractive(settled && this.view === 'resume');
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
      const visible = !isReadingView(this.view) && !this.seatedOverlay && settled
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
