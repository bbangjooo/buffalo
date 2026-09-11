import * as THREE from 'three';
import { gsap } from 'gsap';
import type Application from '../Application';
import { EventBus } from '../UI/EventBus';
import { RoomId, ROOMS } from '../../design/rooms';
import { RHYTHM_PAD_POSITIONS } from './RhythmStage';

export interface GuideMessage {
  text: string;
  actionId: 'resume' | 'pianoSeat' | 'monitor' | 'game';
  actionLabel: string;
  visible: boolean;
}

const HINTS: Record<RoomId, Omit<GuideMessage, 'visible'>> = {
  developer: { text: 'Drag to look around. My photo and a short introduction are on the wall.', actionId: 'resume', actionLabel: 'View Summary' },
  piano: { text: 'Play the piano with ASDFGHJK for white keys and WETYU for black keys.', actionId: 'pianoSeat', actionLabel: 'Take a seat' },
  blog: { text: 'Open the monitor to read my blog. Press Esc to return.', actionId: 'monitor', actionLabel: 'View monitor' },
  ai: { text: 'Four keys, one beat. Step into the rhythm game.', actionId: 'game', actionLabel: 'Play rhythm game' },
};

const DISMISS_KEY = 'bbangjo.guide.dismissed';

type Journey = { from: number; to: number; elapsed: number; duration: number };

/** Shared articulated motion; only the guide role owns visitor hints and camera greetings. */
export default class GuideRobot {
  readonly root = new THREE.Group();
  readonly anchor: THREE.Object3D;
  private readonly application: Application;
  private readonly head?: THREE.Object3D;
  private readonly arm?: THREE.Object3D;
  private readonly headRest?: THREE.Euler;
  private readonly armRest?: THREE.Euler;
  private readonly character: boolean;
  private readonly isGuide: boolean;
  private readonly feet: { joint: THREE.Object3D; rest: THREE.Euler; position: THREE.Vector3 }[] = [];
  private danceAnchor: THREE.Object3D | null = null;
  private danceTime = 0;
  private dancePlaying = false;
  private danceBpm = 162;
  private danceSteps = [0, 0];
  private danceLanes = [0, 3];
  private readonly cameraPosition = new THREE.Vector3();
  private readonly lastCameraPosition = new THREE.Vector3();
  private readonly lastCameraRotation = new THREE.Quaternion();
  private readonly temporaryPosition = new THREE.Vector3();
  private gazeInitialized = false;
  private greetingElapsed = 6;
  private cameraMotionAge = Infinity;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly unsubscribe: () => void;
  private room: RoomId = 'developer';
  private angle = ROOMS.developer.angle;
  private journey?: Journey;
  private reaction?: gsap.core.Timeline;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private reading = false;
  private walking = false;
  private disposed = false;
  private hintsDismissed = false;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === DISMISS_KEY && event.newValue === '1') { this.hintsDismissed = true; this.hide(); }
  };
  private message: GuideMessage = { ...HINTS.developer, visible: false };

  constructor(application: Application, model: THREE.Object3D, options: { role?: 'guide' | 'companion' } = {}) {
    this.application = application;
    this.isGuide = options.role !== 'companion';
    if (this.isGuide) {
      try { this.hintsDismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* Keep the current-tab preference if storage is unavailable. */ }
      window.addEventListener('storage', this.onStorage);
      this.root.userData.interactiveId = 'guide';
      this.root.userData.room = this.room;
    }
    this.root.name = this.isGuide ? 'VisitorGuide' : 'MeadowHamster';
    this.root.userData.role = this.isGuide ? 'guide' : 'companion';
    this.root.add(model);
    // Blender exports this object's children relative to a pivot at its feet.
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.visible = true;
    model.traverse((child) => {
      // Picking belongs to the traveling guide, including older asset extras.
      delete child.userData.interactiveId;
      delete child.userData.room;
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.character = Boolean(model.getObjectByName('GuideHead'));
    this.root.userData.guideVariant = this.character ? 'character' : 'robot';
    const style = model.getObjectByName('GuideCharacter')?.userData.style;
    this.root.userData.guideStyle = this.character ? (style === 'faceted' || style === 'smooth' ? style : 'balanced') : 'robot';
    this.head = model.getObjectByName('GuideHead') || model.getObjectByName('RobotHead');
    this.arm = model.getObjectByName('GuideArm') || model.getObjectByName('RobotArm');
    this.headRest = this.head?.rotation.clone();
    this.armRest = this.arm?.rotation.clone();
    this.anchor = model.getObjectByName('GuideAnchor') || model.getObjectByName('RobotGuideAnchor') || new THREE.Object3D();
    for (const name of ['GuideFootLeft', 'GuideFootRight']) {
      const joint = model.getObjectByName(name);
      if (joint) this.feet.push({ joint, rest: joint.rotation.clone(), position: joint.position.clone() });
    }
    if (!this.anchor.parent) {
      this.anchor.name = 'GuideAnchor';
      this.anchor.position.set(0, 1.75, 0);
      model.add(this.anchor);
    }
    application.scene.add(this.root);
    this.applyPose();
    this.unsubscribe = this.isGuide ? EventBus.on('world-request-state', () => this.publish()) : () => {};
  }

  setRoom(room: RoomId, instant = false) {
    if (this.disposed) return;
    this.walking = false;
    if (this.danceAnchor) { this.reading = false; this.root.visible = true; }
    this.danceAnchor = null;
    this.dancePlaying = false;
    this.gazeInitialized = false;
    const changed = room !== this.room;
    this.room = room;
    if (this.isGuide) this.root.userData.room = room;
    this.hide();
    this.stopReaction();
    const difference = ROOMS[room].angle - this.angle;
    const target = this.angle + Math.atan2(Math.sin(difference), Math.cos(difference));
    const distance = Math.abs(target - this.angle);
    if (instant || this.reducedMotion.matches || distance < 0.00001) {
      this.angle = target;
      this.journey = undefined;
      this.applyPose();
      if (!this.reading) this.showHint();
      return;
    }
    this.journey = { from: this.angle, to: target, elapsed: 0, duration: (0.8 + distance / Math.PI * 0.5) * 1000 };
    if (!changed) this.showHint();
  }

  setReading(reading: boolean) {
    if (this.disposed || this.reading === reading) return;
    this.reading = reading;
    this.root.visible = !reading;
    this.hide();
    this.stopReaction();
    if (reading && this.journey) {
      this.angle = this.journey.to;
      this.journey = undefined;
      this.applyPose();
    }
    this.invalidateShadows();
  }

  help() {
    if (!this.isGuide || this.disposed || this.reading || this.walking || this.danceAnchor) return;
    this.showHint(undefined, true);
    this.gesture('success');
  }

  dismiss() {
    if (!this.isGuide) return;
    this.hintsDismissed = true;
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* The preference still holds for this tab. */ }
    this.hide();
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.message = { ...this.message, visible: false };
    this.publish();
  }

  react(result: 'success' | 'failure') {
    if (this.disposed || this.reading) return;
    this.gesture(result);
    if (this.room === 'ai') {
      this.showHint(result === 'success' ? 'Nice rhythm!' : 'Another round?');
    }
  }

  update(deltaMs = this.application.time.delta) {
    if (this.disposed || this.walking || this.reading) return;
    const delta = Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) : 16;
    if (this.danceAnchor) { this.updateDance(delta); return; }
    if (!this.journey) { if (this.isGuide) this.followCamera(delta); return; }
    const journey = this.journey;
    journey.elapsed += Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) : 16;
    const t = this.reducedMotion.matches ? 1 : Math.min(1, journey.elapsed / journey.duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.angle = THREE.MathUtils.lerp(journey.from, journey.to, eased);
    this.applyPose(this.character ? Math.abs(Math.sin(t * Math.PI * 4)) * .07 : Math.sin(t * Math.PI) * 0.24);
    this.stride(t * Math.PI * 8, t < 1);
    if (t === 1) {
      this.journey = undefined;
      this.applyPose();
      this.showHint();
      this.gesture('success');
    }
  }

  dispose() {
    if (this.disposed) return;
    this.hide();
    this.stopReaction();
    this.unsubscribe();
    if (this.isGuide) window.removeEventListener('storage', this.onStorage);
    this.journey = undefined;
    this.root.removeFromParent();
    this.disposed = true;
  }

  setWalking(walking: boolean) {
    if (this.disposed) return;
    this.walking = walking;
    this.danceAnchor = null;
    this.journey = undefined;
    this.reading = false;
    this.root.visible = true;
    this.hide();
    this.stopReaction();
  }

  walkTo(x: number, z: number, heading: number, moving: boolean) {
    if (this.disposed || !this.walking || this.reading) return;
    const bounce = moving && !this.reducedMotion.matches ? Math.abs(Math.sin(performance.now() * .014)) * .065 : 0;
    const changed = this.root.position.x !== x || this.root.position.z !== z || this.root.position.y !== bounce - .15;
    this.root.position.set(x, bounce - .15, z);
    this.root.rotation.set(0, heading, 0);
    if (this.arm && this.armRest) this.arm.rotation.z = this.armRest.z + (moving && !this.reducedMotion.matches ? Math.sin(performance.now() * .012) * .16 : 0);
    this.stride(performance.now() * .014, moving);
    if (changed) this.invalidateShadows();
  }

  private applyPose(height = 0) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    this.root.position.set(4.45 * cos + 4.3 * sin, height, 4.3 * cos - 4.45 * sin);
    this.root.rotation.set(0, this.angle + Math.PI / 4, 0);
    this.invalidateShadows();
  }

  private showHint(text?: string, requested = false) {
    if (!this.isGuide || this.disposed || this.walking || this.reading || this.danceAnchor || (this.hintsDismissed && !requested)) return;
    clearTimeout(this.hideTimer);
    this.message = { ...HINTS[this.room], text: text || HINTS[this.room].text, visible: true };
    this.publish();
    this.hideTimer = setTimeout(() => this.hideWhenInactive(), 6000);
  }

  private hideWhenInactive() {
    const bubble = document.querySelector('[data-guide-bubble]');
    // Keep a focused action available until the visitor chooses it or leaves it.
    if (bubble && (bubble.contains(document.activeElement) || bubble.matches(':hover'))) {
      this.hideTimer = setTimeout(() => this.hideWhenInactive(), 1000);
      return;
    }
    this.hide();
  }

  private gesture(result: 'success' | 'failure') {
    this.stopReaction();
    if (this.reducedMotion.matches) return;
    this.greetingElapsed = 0;
    this.reaction = gsap.timeline({ onUpdate: () => this.invalidateShadows(), onComplete: () => this.stopReaction() });
    if (result === 'success' && this.arm && this.armRest) {
      const direction = this.character && this.arm.position.x < 0 ? -1 : 1;
      const raised = (this.character ? .34 : 1) * direction;
      const wave = (this.character ? .16 : .52) * direction;
      this.reaction.to(this.arm.rotation, { z: this.armRest.z + raised, duration: 0.2, ease: 'power2.out' })
        .to(this.arm.rotation, { z: this.armRest.z + wave, duration: 0.16, repeat: 3, yoyo: true, ease: 'sine.inOut' })
        .to(this.arm.rotation, { z: this.armRest.z, duration: 0.22, ease: 'power2.inOut' });
    }
    if (this.head && this.headRest) {
      this.reaction.to(this.head.rotation, {
        z: this.headRest.z + (result === 'failure' ? -0.2 : 0.1),
        y: this.headRest.y + (result === 'failure' ? -0.14 : 0.08), duration: 0.22, ease: 'sine.inOut',
      }, 0).to(this.head.rotation, { z: this.headRest.z, y: this.headRest.y, duration: 0.3, ease: 'sine.inOut' }, 0.65);
    }
  }

  private stopReaction() {
    this.reaction?.kill();
    this.reaction = undefined;
    if (this.head && this.headRest) this.head.rotation.copy(this.headRest);
    if (this.arm && this.armRest) this.arm.rotation.copy(this.armRest);
    this.stride(0, false);
    this.invalidateShadows();
  }

  private stride(phase: number, moving: boolean) {
    this.feet.forEach(({ joint, rest, position }, index) => {
      joint.position.copy(position);
      joint.rotation.x = rest.x + (moving && !this.reducedMotion.matches ? Math.sin(phase + index * Math.PI) * .16 : 0);
    });
  }

  /** A movement-triggered greeting, limited to one wave every six seconds. */
  private followCamera(deltaMs: number) {
    const camera = this.application.camera;
    if (!camera?.instance || camera.transitioning || !['developer','piano','blog','ai'].includes(camera.view)) return;
    camera.instance.getWorldPosition(this.cameraPosition);
    if (this.gazeInitialized && (this.cameraPosition.distanceToSquared(this.lastCameraPosition) > .0001
      || camera.instance.quaternion.angleTo(this.lastCameraRotation) > .002)) this.cameraMotionAge = 0;
    this.lastCameraPosition.copy(this.cameraPosition);
    this.lastCameraRotation.copy(camera.instance.quaternion);
    this.gazeInitialized = true;
    this.cameraMotionAge += deltaMs / 1000;
    this.greetingElapsed += deltaMs / 1000;
    this.temporaryPosition.copy(this.cameraPosition).sub(this.root.position);
    const yaw = Math.atan2(this.temporaryPosition.x, this.temporaryPosition.z);
    const difference = Math.atan2(Math.sin(yaw - this.root.rotation.y), Math.cos(yaw - this.root.rotation.y));
    const blend = this.reducedMotion.matches ? 1 : 1 - Math.exp(-deltaMs / 150);
    if (Math.abs(difference) > .0001) { this.root.rotation.y += difference * blend; this.invalidateShadows(); }
    if (this.head && this.headRest) {
      const pitch = -Math.min(.30, Math.max(-.18, Math.atan2(this.temporaryPosition.y - 1.0, Math.hypot(this.temporaryPosition.x,this.temporaryPosition.z))));
      const desired = this.headRest.x + pitch;
      if (Math.abs(desired - this.head.rotation.x) > .0001) { this.head.rotation.x += (desired - this.head.rotation.x) * blend; this.invalidateShadows(); }
    }
    if (this.cameraMotionAge < 2 && this.greetingElapsed >= 6 && !this.reaction && !this.reducedMotion.matches) this.gesture('success');
  }

  setDancing(anchor: THREE.Object3D | null) {
    if (this.disposed) return;
    this.stopReaction(); this.hide(); this.journey = undefined; this.walking = false; this.reading = false;
    this.danceAnchor = anchor; this.dancePlaying = false; this.danceSteps = [0,0]; this.root.visible = true;
    if (anchor) this.updateDance(0); else this.applyPose();
  }

  setDanceBeat(time: number, playing: boolean, bpm: number) {
    this.danceTime = Number.isFinite(time) ? time : 0;
    this.dancePlaying = playing; this.danceBpm = bpm;
    if (!playing) this.danceSteps = [0,0];
  }

  danceStep(lane: number) {
    if (!this.danceAnchor || !this.dancePlaying || !Number.isInteger(lane) || lane < 0 || lane >= RHYTHM_PAD_POSITIONS.length || this.reducedMotion.matches) return;
    const side = lane < 2 ? 0 : 1;
    this.danceSteps[side] = .22; this.danceLanes[side] = lane;
  }

  private updateDance(deltaMs: number) {
    const anchor = this.danceAnchor!;
    anchor.getWorldPosition(this.root.position); anchor.getWorldQuaternion(this.root.quaternion);
    const animated = this.dancePlaying && !this.reducedMotion.matches;
    const beat = this.danceTime * this.danceBpm / 60 * Math.PI;
    this.root.position.y += animated ? Math.abs(Math.sin(beat)) * .04 : 0;
    this.danceSteps = this.danceSteps.map(remaining => Math.max(0, remaining - deltaMs / 1000));
    const weights = this.danceSteps.map(remaining => animated ? Math.sin(remaining / .22 * Math.PI) : 0);
    const chord = Math.min(weights[0], weights[1]);
    let shiftX = 0, shiftZ = 0;
    weights.forEach((weight, side) => {
      const [x, z] = RHYTHM_PAD_POSITIONS[this.danceLanes[side]];
      shiftX += Math.sign(x) * .575 * weight;
      shiftZ += (z > 0 ? .16 : -.24) * weight;
    });
    const weightSum = Math.max(1, weights[0] + weights[1]);
    this.temporaryPosition.set(shiftX / weightSum, chord * .08, shiftZ / weightSum).applyQuaternion(this.root.quaternion);
    this.root.position.add(this.temporaryPosition);
    let lean = 0;
    this.feet.forEach(({ joint, rest, position }) => {
      const side = position.x < 0 ? 0 : 1;
      const weight = weights[side];
      const [x, z] = RHYTHM_PAD_POSITIONS[this.danceLanes[side]];
      joint.position.copy(position); joint.rotation.copy(rest);
      joint.position.x += (x - position.x - shiftX / weightSum) * weight;
      joint.position.z += (z - position.z - shiftZ / weightSum) * weight;
      joint.position.y += weight * .075;
      joint.rotation.x += (z > 0 ? -.15 : .15) * weight;
      lean += (side === 0 ? -1 : 1) * weight;
    });
    this.root.rotateZ(-lean * .06);
    if (this.arm && this.armRest) this.arm.rotation.z = this.armRest.z + (animated ? Math.sin(beat) * .12 : 0);
    this.invalidateShadows();
  }

  private publish() { if (this.isGuide) EventBus.dispatch('guide-message', { ...this.message }); }

  private invalidateShadows() { this.application.renderer.instance.shadowMap.needsUpdate = true; }
}
