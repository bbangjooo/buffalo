import * as THREE from 'three';
import { ObjectId, RoomId, ROOMS } from '../../design/rooms';

export type CurtainsOptions = {
  canvas: HTMLCanvasElement;
  root: THREE.Object3D;
  camera: () => THREE.Camera;
  getRoom: () => RoomId;
  pick: (event: PointerEvent) => ObjectId | null;
  canInteract: () => boolean;
  onChange: () => void;
  onDragStart?: () => void;
};

type Panel = { object: THREE.Object3D; openWidth: number; closedWidth: number };
type Pair = { room: THREE.Object3D; left: Panel; right: Panel; closure: number };
type Drag = {
  pointerId: number;
  roomId: RoomId;
  pair: Pair;
  side: 'left' | 'right';
  startZ: number;
  startClosure: number;
  startX: number;
  startY: number;
  moved: boolean;
  previousCursor: string;
};

const MODEL_NAMES: Array<{ room: RoomId; prefix: string }> = [
  { room: 'piano', prefix: 'Piano' },
  { room: 'blog', prefix: 'Blog' },
  { room: 'ai', prefix: 'AI' },
];

/** Pull either curtain along its room's rail; both panels share one closure. */
export default class Curtains {
  private readonly pairs = new Map<RoomId, Pair>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly normal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly plane = new THREE.Plane();
  private readonly ownedPointers = new Set<number>();
  private drag?: Drag;
  private disposed = false;

  constructor(private readonly options: CurtainsOptions) {
    MODEL_NAMES.forEach(({ room, prefix }) => {
      const left = options.root.getObjectByName(`${prefix}CurtainLeft`);
      const right = options.root.getObjectByName(`${prefix}CurtainRight`);
      if (!left && !right) return; // Existing room assets can load without curtains.
      const group = options.root.getObjectByName(ROOMS[room].group);
      if (!left || !right || !group || !this.belongsTo(left, group) || !this.belongsTo(right, group)) {
        throw new Error(`Incomplete curtain pair in ${ROOMS[room].group}`);
      }
      this.pairs.set(room, { room: group, left: this.panel(left), right: this.panel(right), closure: -1 });
    });
    this.pairs.forEach((pair, room) => {
      pair.left.object.userData.interactiveId = 'curtainLeft';
      pair.right.object.userData.interactiveId = 'curtainRight';
      this.setClosure(room, 0);
    });

    // Window capture also catches releases outside the canvas and consumes a
    // cancelled gesture's later pointerup before the world's click handler.
    options.canvas.addEventListener('pointerdown', this.onCanvasDown, true);
    window.addEventListener('pointerdown', this.onWindowDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('lostpointercapture', this.onLostCapture, true);
    window.addEventListener('blur', this.onInterrupt);
    window.addEventListener('resize', this.onInterrupt);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isDragging(): boolean { return !!this.drag; }

  getClosure(room: RoomId): number { return this.pairs.get(room)?.closure ?? 0; }

  setClosure(room: RoomId, value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    const pair = this.pairs.get(room);
    if (!pair) return;
    const closure = THREE.MathUtils.clamp(value, 0, 1);
    if (pair.closure === closure) return;
    pair.closure = closure;
    [pair.left, pair.right].forEach((panel) => {
      panel.object.scale.z = 1 + (panel.closedWidth / panel.openWidth - 1) * closure;
      panel.object.scale.x = 1 - 0.28 * closure;
      panel.object.updateMatrix();
    });
    this.options.root.updateWorldMatrix(true, true);
    this.options.onChange();
  }

  cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    const canvas = this.options.canvas;
    if (canvas.style.cursor === 'grabbing') canvas.style.cursor = drag.previousCursor;
    try {
      if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    } catch { /* The browser may already have released capture on interruption. */ }
    // Keep pointer ownership until up/cancel: navigation must not turn the
    // release of this curtain gesture into a click in the newly selected room.
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelDrag();
    this.disposed = true;
    this.ownedPointers.clear();
    this.options.canvas.removeEventListener('pointerdown', this.onCanvasDown, true);
    window.removeEventListener('pointerdown', this.onWindowDown, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('lostpointercapture', this.onLostCapture, true);
    window.removeEventListener('blur', this.onInterrupt);
    window.removeEventListener('resize', this.onInterrupt);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  private readonly onCanvasDown = (event: PointerEvent) => {
    if (this.disposed || this.drag || event.button !== 0 || event.isPrimary === false || !this.options.canInteract()) return;
    const id: string | null = this.options.pick(event);
    if (id !== 'curtainLeft' && id !== 'curtainRight') return;
    const roomId = this.options.getRoom();
    const pair = this.pairs.get(roomId);
    if (!pair) return;
    const startZ = this.localRailZ(event, pair);
    if (startZ === null) return;
    this.consume(event);
    this.ownedPointers.add(event.pointerId);
    this.drag = {
      pointerId: event.pointerId, roomId, pair,
      side: id === 'curtainLeft' ? 'left' : 'right',
      startZ, startClosure: pair.closure, startX: event.clientX, startY: event.clientY,
      moved: false, previousCursor: this.options.canvas.style.cursor,
    };
    this.options.canvas.style.cursor = 'grabbing';
    try { this.options.canvas.setPointerCapture(event.pointerId); } catch { /* Window listeners still own this gesture. */ }
    this.options.onDragStart?.();
  };

  private readonly onWindowDown = (event: PointerEvent) => {
    if (this.disposed) return;
    // A new down means the old gesture ended even if its release was lost while
    // the window was inactive; pointer IDs may be reused by the browser.
    if (!this.drag) {
      this.ownedPointers.delete(event.pointerId);
      return;
    }
    this.ownedPointers.add(event.pointerId);
    this.consume(event);
  };

  private readonly onMove = (event: PointerEvent) => {
    if (this.disposed || !this.ownedPointers.has(event.pointerId)) return;
    // A no-buttons mouse move proves an outside release already happened,
    // even if blur/capture loss prevented delivery of its pointerup.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      if (this.drag?.pointerId === event.pointerId) this.cancelDrag();
      this.ownedPointers.delete(event.pointerId);
      return;
    }
    this.consume(event);
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.move(event);
  };

  private readonly onUp = (event: PointerEvent) => {
    if (this.disposed || !this.ownedPointers.has(event.pointerId)) return;
    this.consume(event);
    if (this.drag?.pointerId === event.pointerId) {
      this.move(event);
      this.cancelDrag();
    }
    this.ownedPointers.delete(event.pointerId);
  };

  private readonly onCancel = (event: PointerEvent) => {
    if (this.disposed || !this.ownedPointers.has(event.pointerId)) return;
    this.consume(event);
    if (this.drag?.pointerId === event.pointerId) this.cancelDrag();
    this.ownedPointers.delete(event.pointerId);
  };

  private readonly onLostCapture = (event: PointerEvent) => {
    if (this.disposed || !this.ownedPointers.has(event.pointerId)) return;
    this.consume(event);
    if (this.drag?.pointerId === event.pointerId) this.cancelDrag();
  };

  private readonly onInterrupt = () => { this.cancelDrag(); };
  private readonly onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') this.cancelDrag(); };

  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (this.options.getRoom() !== drag.roomId || !this.options.canInteract()) { this.cancelDrag(); return; }
    if (!drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (dx * dx + dy * dy < 16) return;
      drag.moved = true;
    }
    const z = this.localRailZ(event, drag.pair);
    if (z === null) return;
    const panel = drag.pair[drag.side];
    const direction = drag.side === 'left' ? 1 : -1;
    this.setClosure(drag.roomId, drag.startClosure + (z - drag.startZ) * direction / (panel.closedWidth - panel.openWidth));
  }

  private localRailZ(event: PointerEvent, pair: Pair): number | null {
    const rect = this.options.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.options.root.updateWorldMatrix(true, true);
    const camera = this.options.camera();
    camera.updateMatrixWorld(true);
    this.normalMatrix.getNormalMatrix(pair.room.matrixWorld);
    this.normal.set(1, 0, 0).applyMatrix3(this.normalMatrix).normalize();
    this.point.set(0.29, 0, 0).applyMatrix4(pair.room.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point);
    this.raycaster.setFromCamera(this.pointer, camera);
    if (Math.abs(this.raycaster.ray.direction.dot(this.plane.normal)) < 1e-6) return null;
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    const z = pair.room.worldToLocal(this.hit).z;
    return Number.isFinite(z) ? z : null;
  }

  private panel(object: THREE.Object3D): Panel {
    const openWidth = Number(object.userData.curtainOpenWidth);
    const closedWidth = Number(object.userData.curtainClosedWidth);
    const valid = Number.isFinite(openWidth) && openWidth > 0 && Number.isFinite(closedWidth) && closedWidth > openWidth;
    return {
      object,
      openWidth: valid ? openWidth : 0.48,
      closedWidth: valid ? closedWidth : 1.283,
    };
  }

  private belongsTo(object: THREE.Object3D, group: THREE.Object3D): boolean {
    let parent: THREE.Object3D | null = object;
    while (parent) { if (parent === group) return true; parent = parent.parent; }
    return false;
  }

  private consume(event: PointerEvent): void {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
}
