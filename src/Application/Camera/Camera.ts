import * as THREE from "three";
import gsap from "gsap";
import Application from "../Application";
import EventEmitter from "../Utils/Eventemitter";
import Sizes from "../Utils/Sizes";
import { ROOMS, ROOM_SIZE, RoomId, RoomView } from "../../design/rooms";

export type { RoomId, RoomView } from "../../design/rooms";
export type ReadingView = "monitor" | "resume" | "leaderboard";
export const isReadingView = (view: unknown): view is ReadingView => view === "monitor" || view === "resume" || view === "leaderboard";
export const isSeatedView = (view: unknown): view is "piano-seat" => view === "piano-seat";
type FocusView = ReadingView | "piano-seat" | "rhythm";
const isFocusView = (view: unknown): view is FocusView => isReadingView(view) || isSeatedView(view) || view === 'rhythm';
type RhythmViewport = { left: number; top: number; width: number; height: number };

type ReadingTarget = {
  anchor?: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  width: number;
  height: number;
  ownerRoom: RoomId;
};

type CameraPose = {
  target: THREE.Vector3;
  rotation: THREE.Quaternion;
  distance: number;
  span: number;
};

/** Each room shares a central origin; navigation follows the outside of its walls. */
export default class Camera extends EventEmitter {
  application: Application;
  private readonly sizes: Sizes;
  instance: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  view: RoomView = "developer";
  transitioning = false;

  private readonly orthographic = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.05, 1000);
  private readonly perspective = new THREE.PerspectiveCamera(35, 1, 0.02, 1000);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly defaultElevation = THREE.MathUtils.degToRad(36);
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly readingTargets: Record<ReadingView, ReadingTarget> = {
    monitor: {
      position: new THREE.Vector3(-2.8, 2.05, -0.82),
      rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
      width: 1.4, height: 0.84, ownerRoom: "blog",
    },
    resume: {
      position: new THREE.Vector3(3, 2, 0.22), rotation: new THREE.Quaternion(),
      width: 2.3, height: 2.78, ownerRoom: "developer",
    },
    leaderboard: {
      position: new THREE.Vector3(-.22, 2, 3),
      rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 1.5),
      width: 2.3, height: 2.78, ownerRoom: "ai",
    },
  };
  private activeFocus: FocusView | null = null;
  private pianoEyeAnchor?: THREE.Object3D;
  private pianoLookAnchor?: THREE.Object3D;
  private rhythmAnchor?: THREE.Object3D;
  private rhythmViewport?: RhythmViewport;
  private readonly pianoEye = new THREE.Vector3(2.98, 1.78, -2.8);
  private readonly pianoLook = new THREE.Vector3(1.72, 1.22, -2.8);
  private headYaw = 0;
  private headPitch = 0;
  private orbitAngle = ROOMS.developer.angle;
  private orbitElevation = this.defaultElevation;
  private pose: CameraPose;
  private animation?: gsap.core.Timeline;
  private projectionBridge = false;
  private readonly courtyardTarget = new THREE.Vector3(7, 0, 7);
  private courtyardHeading = Math.PI / 4;
  private courtyardPitch = 0;
  private exhibitTarget?: { anchor: THREE.Object3D; width: number; height: number };

  constructor() {
    super();
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.instance = this.orthographic;
    this.pose = this.roomPose(this.orbitAngle);
    this.applyPose();
  }

  setReadingTarget(view: ReadingView, anchor: THREE.Object3D, width: number, height: number, ownerRoom: RoomId) {
    const target = this.readingTargets[view];
    Object.assign(target, { anchor, width, height, ownerRoom });
    this.readReadingTransform(target);
    if (this.view === view) this.navigate(view, true);
  }

  setMonitor(anchor: THREE.Object3D, width = 1.4, height = 0.84) {
    this.setReadingTarget("monitor", anchor, width, height, "blog");
  }

  setResume(anchor: THREE.Object3D, width = 2.3, height = 2.78) {
    this.setReadingTarget("resume", anchor, width, height, "developer");
  }

  setLeaderboard(anchor: THREE.Object3D, width = 2.3, height = 2.78) {
    this.setReadingTarget("leaderboard", anchor, width, height, "ai");
  }

  setPianoSeat(eyeAnchor: THREE.Object3D, lookAnchor: THREE.Object3D) {
    this.pianoEyeAnchor = eyeAnchor;
    this.pianoLookAnchor = lookAnchor;
    if (isSeatedView(this.view)) this.navigate(this.view, true);
  }

  setRhythmTarget(anchor: THREE.Object3D) {
    this.rhythmAnchor = anchor;
    if (this.view === 'rhythm') {
      this.pose = this.rhythmPose();
      this.applyPose();
    }
  }

  setRhythmViewport(viewport: RhythmViewport) {
    if (!viewport || ![viewport.left, viewport.top, viewport.width, viewport.height].every(Number.isFinite)
      || viewport.width <= 0 || viewport.height <= 0) return;
    this.rhythmViewport = { ...viewport };
    if (this.view === 'rhythm') {
      this.pose = this.rhythmPose();
      this.applyPose();
    }
  }

  lookSeated(deltaXpx: number, deltaYpx: number) {
    if (!isSeatedView(this.view) || this.transitioning) return;
    if (!Number.isFinite(deltaXpx) || !Number.isFinite(deltaYpx)) return;
    this.headYaw = THREE.MathUtils.clamp(this.headYaw - deltaXpx * 0.003, -0.6, 0.6);
    this.headPitch = THREE.MathUtils.clamp(this.headPitch - deltaYpx * 0.003, -0.28, 0.28);
    this.pose = this.seatedPose();
    this.applyPose();
  }

  lookRoom(deltaXpx: number, deltaYpx: number) {
    if (this.view === 'courtyard' || this.view === 'exhibit' || isFocusView(this.view) || this.transitioning) return;
    if (!Number.isFinite(deltaXpx) || !Number.isFinite(deltaYpx)) return;
    const angle = this.orbitAngle - deltaXpx * 0.003;
    // Wrap the stored angle while allowing repeated turns in either direction.
    this.orbitAngle = Math.atan2(Math.sin(angle), Math.cos(angle));
    this.orbitElevation = THREE.MathUtils.clamp(
      this.orbitElevation + deltaYpx * 0.003,
      THREE.MathUtils.degToRad(15),
      THREE.MathUtils.degToRad(80),
    );
    this.pose = this.roomPose(this.orbitAngle, this.orbitElevation);
    this.applyPose();
  }

  navigate(view: RoomView, instant = false) {
    if (this.view === view && !instant && view !== 'exhibit') return;
    this.animation?.kill();
    this.animation = undefined;
    const sourceProjectionBridge = this.projectionBridge;
    this.projectionBridge = false;
    const sourceFocus = this.activeFocus;
    const sourceView = this.view;
    const ownerRoom = isFocusView(view) ? this.focusOwner(view) : (view === 'courtyard' || view === 'exhibit') ? 'developer' : view;
    if (view !== this.view) { this.headYaw = 0; this.headPitch = 0; }
    this.view = view;
    this.transitioning = !instant && !this.reducedMotion.matches;
    this.trigger("viewchange", [view]);

    if (view === 'courtyard' || sourceView === 'courtyard' || view === 'exhibit' || sourceView === 'exhibit') {
      this.activeFocus = isFocusView(view) ? view : null;
      this.orbitAngle = ROOMS[ownerRoom].angle;
      this.orbitElevation = this.defaultElevation;
      const from = this.clonePose(this.pose);
      const destination = view === 'exhibit' ? this.exhibitPose()
        : view === 'courtyard' ? this.courtyardPose()
          : isFocusView(view) ? this.focusPose(view) : this.roomPose(this.orbitAngle);
      const to = this.clonePose(destination);
      const destinationPerspective = view === 'courtyard' || view === 'exhibit' || isFocusView(view);
      const bridge = sourceProjectionBridge || this.instance === this.orthographic || !destinationPerspective;
      this.projectionBridge = bridge;
      if (this.instance === this.orthographic) from.distance = 500;
      if (!destinationPerspective) to.distance = 500;
      this.instance = this.perspective;
      const finish = () => {
        this.pose = destination;
        this.instance = destinationPerspective ? this.perspective : this.orthographic;
        this.transitioning = false;
        this.projectionBridge = false;
        this.animation = undefined;
        this.applyPose();
        if (isReadingView(sourceFocus) && sourceFocus !== view) this.emitReadingReturnSafe(sourceFocus);
        this.trigger('settled', [view]);
      };
      if (!this.transitioning) finish();
      else {
        this.pose = this.clonePose(from);
        this.applyPose();
        const progress = { value: 0 };
        this.animation = gsap.timeline({ onComplete: finish }).to(progress, {
          value: 1, duration: bridge ? 1 : 0.7, ease: 'power2.inOut', onUpdate: () => {
            this.pose.target.lerpVectors(from.target, to.target, progress.value);
            this.pose.rotation.slerpQuaternions(from.rotation, to.rotation, progress.value);
            this.pose.span = THREE.MathUtils.lerp(from.span, to.span, progress.value);
            this.pose.distance = THREE.MathUtils.lerp(from.distance, to.distance, progress.value);
            this.applyPose();
          },
        });
      }
      return;
    }

    if (!this.transitioning) {
      this.orbitAngle = ROOMS[ownerRoom].angle;
      this.orbitElevation = this.defaultElevation;
      this.activeFocus = isFocusView(view) ? view : null;
      this.pose = isFocusView(view) ? this.focusPose(view) : this.roomPose(this.orbitAngle);
      this.instance = isFocusView(view) ? this.perspective : this.orthographic;
      this.applyPose();
      // Restore source geometry only after the instant/resize camera has moved.
      if (isReadingView(sourceFocus) && sourceFocus !== view) this.emitReadingReturnSafe(sourceFocus);
      this.trigger("settled", [view]);
      return;
    }

    const timeline = gsap.timeline({
      onComplete: () => {
        this.transitioning = false;
        this.animation = undefined;
        this.applyPose();
        this.trigger("settled", [view]);
      },
    });
    this.animation = timeline;

    if (isFocusView(view) && sourceFocus === view && this.instance === this.perspective) {
      // An interrupted return can move back to the same reader or piano seat.
      this.appendFocusMove(timeline, view, false);
      return;
    }

    let fromAngle = this.orbitAngle;
    if (this.instance === this.perspective && sourceFocus) {
      fromAngle = this.nearestAngle(this.orbitAngle, this.focusOwner(sourceFocus));
      this.appendFocusMove(timeline, sourceFocus, true, fromAngle);
    }
    this.appendOrbit(timeline, fromAngle, this.nearestAngle(fromAngle, ownerRoom));
    if (isFocusView(view)) this.appendFocusMove(timeline, view, false);
  }

  private emitReadingReturnSafe(view: ReadingView) {
    this.trigger("reading-return-safe", [{ view, ownerRoom: this.readingTargets[view].ownerRoom }]);
  }

  private nearestAngle(from: number, room: RoomId): number {
    const difference = ROOMS[room].angle - from;
    return from + Math.atan2(Math.sin(difference), Math.cos(difference));
  }

  private appendOrbit(timeline: gsap.core.Timeline, from: number, to: number) {
    const distance = Math.abs(to - from);
    const elevationDistance = Math.abs(this.defaultElevation - this.orbitElevation);
    if (distance < 0.00001 && elevationDistance < 0.00001) {
      timeline.call(() => {
        this.orbitAngle = to;
        this.orbitElevation = this.defaultElevation;
        this.pose = this.roomPose(to);
        this.instance = this.orthographic;
        this.applyPose();
      });
      return;
    }
    const progress = { value: 0 };
    let fromElevation = this.orbitElevation;
    timeline.to(progress, {
      value: 1,
      duration: 0.8 + Math.max(distance, elevationDistance) / Math.PI * 0.5,
      ease: "power2.inOut",
      onStart: () => { fromElevation = this.orbitElevation; },
      onUpdate: () => {
        this.orbitAngle = THREE.MathUtils.lerp(from, to, progress.value);
        this.orbitElevation = THREE.MathUtils.lerp(fromElevation, this.defaultElevation, progress.value);
        // Derive both target and rotation from the same angle: no straight chord
        // through the central walls, including after interrupted navigation.
        this.pose = this.roomPose(this.orbitAngle, this.orbitElevation);
        this.instance = this.orthographic;
        this.applyPose();
      },
    });
  }

  private appendFocusMove(timeline: gsap.core.Timeline, view: FocusView, returning: boolean, roomAngle = ROOMS[this.focusOwner(view)].angle) {
    const progress = { value: 0 };
    let from: CameraPose;
    let to: CameraPose;
    let returnSafeSent = false;
    timeline.to(progress, {
      value: 1,
      duration: 1.1,
      ease: "power3.inOut",
      onStart: () => {
        if (!returning) this.activeFocus = view;
        from = this.clonePose(this.pose);
        to = returning ? this.roomPose(roomAngle) : this.focusPose(view);
        // Match the orthographic span from a distant perspective before moving.
        // Interpolating span separately prevents a zoom-out halfway to the screen.
        if (this.instance === this.orthographic) from.distance = 500;
        if (returning) to.distance = 500;
        this.instance = this.perspective;
      },
      onUpdate: () => {
        const t = progress.value;
        this.pose.target.lerpVectors(from.target, to.target, t);
        this.pose.rotation.slerpQuaternions(from.rotation, to.rotation, t);
        this.pose.span = THREE.MathUtils.lerp(from.span, to.span, t);
        this.pose.distance = THREE.MathUtils.lerp(from.distance, to.distance, t);
        this.applyPose();
        // Only actual reader returns notify the guide/UI that it is safe to return.
        if (returning && isReadingView(view) && !returnSafeSent && this.pose.distance >= 12) {
          returnSafeSent = true;
          this.emitReadingReturnSafe(view);
        }
      },
      onComplete: () => {
        if (returning) {
          this.orbitAngle = roomAngle;
          this.orbitElevation = this.defaultElevation;
          this.pose = this.roomPose(roomAngle);
          this.instance = this.orthographic;
          this.activeFocus = null;
        } else {
          this.pose = to;
        }
        this.applyPose();
        if (returning && isReadingView(view) && !returnSafeSent) this.emitReadingReturnSafe(view);
      },
    });
  }

  private roomPose(angle: number, elevation = this.defaultElevation): CameraPose {
    const width = Math.max(this.sizes.width, 1);
    const height = Math.max(this.sizes.height, 1);
    const aspect = width / height;
    const sidebar = width >= 1000;
    const leftInset = sidebar ? 190 : 8;
    const rightInset = sidebar ? 20 : 8;
    const topInset = sidebar ? 88 : 160;
    const bottomInset = sidebar ? 118 : this.view === 'piano' ? 230 : this.view === 'ai' ? 210 : 130;
    const safeHeight = Math.max(height - topInset - bottomInset, sidebar ? height * 0.35 : 90);
    const safeWidth = Math.max(width - leftInset - rightInset, width * 0.5);
    // A lower viewing angle exposes larger furniture faces while the four
    // rooms still read as one house. Peripheral paper corners may bleed on a
    // phone; functional furniture and the document apertures stay inside.
    const buildingWidth = ROOM_SIZE * 2 * Math.SQRT2 + 0.6;
    const buildingHeight = Math.max(9.8, buildingWidth * Math.sin(elevation) + 0.3);
    const fit = Math.max(12.6, buildingWidth * height / safeWidth, buildingHeight * height / safeHeight);
    const span = fit * (width < 700 ? .88 : 1);
    const yaw = new THREE.Quaternion().setFromAxisAngle(this.up, angle);
    const horizontal = Math.cos(elevation) / Math.SQRT2;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(horizontal, Math.sin(elevation), horizontal), new THREE.Vector3(), this.up,
    ));
    rotation.premultiply(yaw);
    const target = new THREE.Vector3(0.6, 0.8, 0.6).applyQuaternion(yaw);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    target.addScaledVector(screenUp, -0.1 + span * (topInset - bottomInset) / (2 * height));
    target.addScaledVector(screenRight, -span * aspect * (leftInset - rightInset) / (2 * width));
    return { target, rotation, distance: 24, span };
  }

  setExhibit(anchor: THREE.Object3D, width: number, height: number) {
    this.exhibitTarget = { anchor, width, height };
  }

  private exhibitPose(): CameraPose {
    if (!this.exhibitTarget) return this.courtyardPose();
    const { anchor, width, height } = this.exhibitTarget;
    anchor.updateWorldMatrix(true, false);
    const target = anchor.getWorldPosition(new THREE.Vector3());
    const rotation = anchor.getWorldQuaternion(new THREE.Quaternion());
    const screenWidth = Math.max(this.sizes.width, 1), screenHeight = Math.max(this.sizes.height, 1);
    const span = Math.max(height * screenHeight / Math.max((screenHeight - 110) * .88, 90), width / (screenWidth / screenHeight * (screenWidth < 700 ? .92 : .82)));
    // The reader must stay inside its approach space. Moving farther away to fit
    // a narrow viewport can put the camera behind the opposite gallery row.
    // Fit via field of view instead; the planar reading surface remains centered.
    const distance = Math.min(2.5, span / (2 * Math.tan(THREE.MathUtils.degToRad(35) / 2)));
    return { target, rotation, span, distance };
  }

  followCourtyard(x: number, z: number, _instant = false, height = 0) {
    if (![x, z, height].every(Number.isFinite)) return;
    this.courtyardTarget.set(x, Math.max(0, height), z);
    if (this.view !== 'courtyard' || this.transitioning) return;
    // The camera is the visitor's eye: delayed following would make its
    // collision position disagree with the walker and add first-person sway.
    this.pose = this.courtyardPose();
    this.applyPose();
  }

  /** World heading: 0 faces +Z, PI/2 faces +X. Preserved while reading a display. */
  getCourtyardYaw(): number { return this.courtyardHeading; }

  /** The distant perspective lens only matches the room's orthographic framing.
   * Atmospheric depth must not mistake this virtual offset for 500m of air.
   */
  getAtmosphereDistanceOffset(): number {
    return this.transitioning && this.projectionBridge ? Math.max(0, this.pose.distance - 1) : 0;
  }

  setCourtyardHeading(heading: number, pitch = 0) {
    if (!Number.isFinite(heading) || !Number.isFinite(pitch)) return;
    this.courtyardHeading = Math.atan2(Math.sin(heading), Math.cos(heading));
    this.courtyardPitch = THREE.MathUtils.clamp(pitch, -Math.PI * 0.36, Math.PI * 0.36);
    if (this.view === 'courtyard' && !this.transitioning) {
      this.pose = this.courtyardPose();
      this.applyPose();
    }
  }

  lookCourtyard(deltaXpx: number, deltaYpx: number) {
    if (this.view !== 'courtyard' || this.transitioning) return;
    if (!Number.isFinite(deltaXpx) || !Number.isFinite(deltaYpx)) return;
    this.setCourtyardHeading(this.courtyardHeading - deltaXpx * 0.003,
      this.courtyardPitch - deltaYpx * 0.0025);
  }

  private courtyardPose(): CameraPose {
    const eye = this.courtyardTarget.clone().setY(1.49 + this.courtyardTarget.y);
    const pitchCos = Math.cos(this.courtyardPitch);
    const forward = new THREE.Vector3(
      Math.sin(this.courtyardHeading) * pitchCos,
      Math.sin(this.courtyardPitch),
      Math.cos(this.courtyardHeading) * pitchCos,
    );
    const target = eye.clone().add(forward);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      eye, target, this.up,
    ));
    const fov = this.sizes.width < 700 ? 75 : 65;
    return { target, rotation, span: 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2), distance: 1 };
  }

  private readReadingTransform(target: ReadingTarget) {
    if (!target.anchor) return;
    target.anchor.updateWorldMatrix(true, false);
    target.anchor.getWorldPosition(target.position);
    target.anchor.getWorldQuaternion(target.rotation);
  }

  private readingPose(view: ReadingView): CameraPose {
    const surface = this.readingTargets[view];
    this.readReadingTransform(surface);
    const aspect = this.sizes.width / Math.max(this.sizes.height, 1);
    const narrow = this.sizes.width < 700;
    const heightFraction = view === "resume" ? 0.78 : (narrow ? 0.68 : 0.72);
    const span = Math.max(surface.height / heightFraction, surface.width / (aspect * (narrow ? 0.92 : 0.8)));
    const target = surface.position.clone();
    // Center the monitor's reading surface in the viewport; retain the Summary framing.
    if (view === "resume") target.add(new THREE.Vector3(0, 1, 0).applyQuaternion(surface.rotation).multiplyScalar(span * 0.015));
    return {
      target,
      rotation: surface.rotation.clone(),
      distance: span / (2 * Math.tan(THREE.MathUtils.degToRad(35) / 2)),
      span,
    };
  }

  private focusOwner(view: FocusView): RoomId {
    return isReadingView(view) ? this.readingTargets[view].ownerRoom : view === 'rhythm' ? 'ai' : "piano";
  }

  private focusPose(view: FocusView): CameraPose {
    return isReadingView(view) ? this.readingPose(view) : view === 'rhythm' ? this.rhythmPose() : this.seatedPose();
  }

  private rhythmPose(): CameraPose {
    const width = Math.max(this.sizes.width, 1);
    const height = Math.max(this.sizes.height, 1);
    const aspect = width / height;
    // The React layout replaces this fallback after its first measured frame.
    const viewport = this.rhythmViewport || {
      left: 24, top: 90, width: Math.max(80, width * .38 - 36), height: Math.max(80, height * .45 - 80),
    };
    const target = new THREE.Vector3(0, .9, 0);
    const anchorRotation = new THREE.Quaternion();
    if (this.rhythmAnchor) {
      this.rhythmAnchor.updateWorldMatrix(true, false);
      this.rhythmAnchor.getWorldPosition(target);
      this.rhythmAnchor.getWorldQuaternion(anchorRotation);
    }
    const direction = new THREE.Vector3(2.9, 2.5, 4.2).normalize().applyQuaternion(anchorRotation);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      direction, new THREE.Vector3(), this.up,
    ));
    const span = Math.max(2.3 * height / viewport.height, 3.1 * height / viewport.width) * 1.08;
    const centerX = viewport.left + viewport.width / 2;
    const centerY = viewport.top + viewport.height / 2;
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    target.addScaledVector(screenRight, span * aspect * (.5 - centerX / width));
    target.addScaledVector(screenUp, span * (centerY / height - .5));
    return { target, rotation, span, distance: span / (2 * Math.tan(THREE.MathUtils.degToRad(35) / 2)) };
  }

  private seatedPose(): CameraPose {
    this.pianoEyeAnchor?.updateWorldMatrix(true, false);
    this.pianoLookAnchor?.updateWorldMatrix(true, false);
    this.pianoEyeAnchor?.getWorldPosition(this.pianoEye);
    this.pianoLookAnchor?.getWorldPosition(this.pianoLook);
    const forward = this.pianoLook.clone().sub(this.pianoEye);
    const distance = Math.max(forward.length(), 0.1);
    forward.normalize().applyAxisAngle(this.up, this.headYaw);
    const right = new THREE.Vector3().crossVectors(forward, this.up).normalize();
    forward.applyAxisAngle(right, this.headPitch);
    const target = this.pianoEye.clone().addScaledVector(forward, distance);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(this.pianoEye, target, this.up));
    const aspect = this.sizes.width / Math.max(this.sizes.height, 1);
    // The keyboard's 2.94m front edge is ~1m from the authored eye. Wider
    // desktop lenses fit its end keys without moving the visitor off the bench.
    const keyboardDepth = Math.max(0.8, distance - 0.35);
    const fitFov = THREE.MathUtils.radToDeg(2 * Math.atan(1.55 / (keyboardDepth * aspect)));
    const fov = this.sizes.width >= 1000 ? THREE.MathUtils.clamp(fitFov, 72, 90) : 72;
    return { target, rotation, distance, span: 2 * distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2) };
  }

  private clonePose(pose: CameraPose): CameraPose {
    return { target: pose.target.clone(), rotation: pose.rotation.clone(), distance: pose.distance, span: pose.span };
  }

  private applyPose() {
    const aspect = this.sizes.width / Math.max(this.sizes.height, 1);
    this.instance.quaternion.copy(this.pose.rotation);
    this.instance.position.set(0, 0, this.pose.distance).applyQuaternion(this.pose.rotation).add(this.pose.target);
    if (this.instance instanceof THREE.OrthographicCamera) {
      this.instance.left = -this.pose.span * aspect / 2;
      this.instance.right = this.pose.span * aspect / 2;
      this.instance.top = this.pose.span / 2;
      this.instance.bottom = -this.pose.span / 2;
    } else {
      this.instance.aspect = aspect;
      // The perspective bridge can be 500m away. A fixed .02m near plane loses
      // depth precision there, making walls and the aperture visibly z-fight.
      this.instance.near = Math.max(0.02, this.pose.distance - 30);
      this.instance.far = Math.max(80, this.pose.distance + 40);
      this.instance.fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.pose.span / (2 * this.pose.distance)));
    }
    this.instance.updateProjectionMatrix();
    this.instance.updateMatrixWorld();
  }

  resize() {
    if (this.view === 'courtyard' || this.view === 'exhibit') { this.navigate(this.view, true); return; }
    if (!this.transitioning && !isFocusView(this.view)) {
      this.pose = this.roomPose(this.orbitAngle, this.orbitElevation);
      this.applyPose();
      return;
    }
    // A resize settles the requested destination, never an obsolete transition.
    this.navigate(this.view, true);
  }

  update() {
    // GSAP owns transitions; pointer input updates the settled camera directly.
  }
}
