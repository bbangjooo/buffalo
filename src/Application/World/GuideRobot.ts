import * as THREE from 'three';
import { gsap } from 'gsap';
import type Application from '../Application';
import { EventBus } from '../UI/EventBus';
import { RoomId, ROOMS } from '../../design/rooms';

export interface GuideMessage {
  text: string;
  actionId: 'resume' | 'pianoSeat' | 'monitor' | 'game';
  actionLabel: string;
  visible: boolean;
}

const HINTS: Record<RoomId, Omit<GuideMessage, 'visible'>> = {
  developer: { text: '화면을 드래그해 자유롭게 둘러보세요. 벽에는 개발 방향과 학력·경력을 담아두었어요.', actionId: 'resume', actionLabel: 'Summary 보기' },
  piano: { text: '건반을 눌러 연주해 보세요. 백건은 ASDFGHJK, 흑건은 WETYU예요.', actionId: 'pianoSeat', actionLabel: '의자에 앉기' },
  blog: { text: '모니터에 가까이 가면 블로그를 읽을 수 있어요. Esc로 돌아와요.', actionId: 'monitor', actionLabel: '모니터 보기' },
  ai: { text: '네 패드가 빛나는 순서를 기억해 보세요. 같은 순서로 누르면 다음 라운드!', actionId: 'game', actionLabel: '기억 게임 시작' },
};

const DISMISS_KEY = 'bbangjo.guide.dismissed';

type Journey = { from: number; to: number; elapsed: number; duration: number };

/** The original Blender robot travels with the visitor, outside the central walls. */
export default class GuideRobot {
  readonly root = new THREE.Group();
  readonly anchor: THREE.Object3D;
  private readonly application: Application;
  private readonly head?: THREE.Object3D;
  private readonly arm?: THREE.Object3D;
  private readonly headRest?: THREE.Euler;
  private readonly armRest?: THREE.Euler;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly unsubscribe: () => void;
  private room: RoomId = 'developer';
  private angle = ROOMS.developer.angle;
  private journey?: Journey;
  private reaction?: gsap.core.Timeline;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private reading = false;
  private disposed = false;
  private hintsDismissed = false;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === DISMISS_KEY && event.newValue === '1') { this.hintsDismissed = true; this.hide(); }
  };
  private message: GuideMessage = { ...HINTS.developer, visible: false };

  constructor(application: Application, model: THREE.Object3D) {
    this.application = application;
    try { this.hintsDismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* Keep the current-tab preference if storage is unavailable. */ }
    window.addEventListener('storage', this.onStorage);
    this.root.name = 'VisitorGuide';
    this.root.userData.interactiveId = 'guide';
    this.root.userData.room = this.room;
    this.root.add(model);
    // Blender exports this object's children relative to a pivot at its feet.
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.visible = true;
    model.traverse((child) => {
      // Picking belongs to the traveling guide, including older asset extras.
      delete child.userData.interactiveId;
      delete child.userData.room;
    });
    this.head = model.getObjectByName('RobotHead');
    this.arm = model.getObjectByName('RobotArm');
    this.headRest = this.head?.rotation.clone();
    this.armRest = this.arm?.rotation.clone();
    this.anchor = model.getObjectByName('RobotGuideAnchor') || new THREE.Object3D();
    if (!this.anchor.parent) {
      this.anchor.name = 'RobotGuideAnchor';
      this.anchor.position.set(0, 1.75, 0);
      model.add(this.anchor);
    }
    application.scene.add(this.root);
    this.applyPose();
    this.unsubscribe = EventBus.on('world-request-state', () => this.publish());
  }

  setRoom(room: RoomId, instant = false) {
    if (this.disposed) return;
    const changed = room !== this.room;
    this.room = room;
    this.root.userData.room = room;
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
    if (this.disposed || this.reading) return;
    this.showHint(undefined, true);
    this.gesture('success');
  }

  dismiss() {
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
      this.showHint(result === 'success'
        ? '다섯 라운드 성공! 모든 순서를 기억했어요.'
        : '다시 도전해 볼까요? 켜지는 순서를 천천히 따라 눌러 보세요.');
    }
  }

  update(deltaMs = this.application.time.delta) {
    if (this.disposed || this.reading || !this.journey) return;
    const journey = this.journey;
    journey.elapsed += Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) : 16;
    const t = this.reducedMotion.matches ? 1 : Math.min(1, journey.elapsed / journey.duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.angle = THREE.MathUtils.lerp(journey.from, journey.to, eased);
    this.applyPose(Math.sin(t * Math.PI) * 0.24);
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
    window.removeEventListener('storage', this.onStorage);
    this.journey = undefined;
    this.root.removeFromParent();
    this.disposed = true;
  }

  private applyPose(height = 0) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    this.root.position.set(4.45 * cos + 4.3 * sin, height, 4.3 * cos - 4.45 * sin);
    this.root.rotation.set(0, this.angle + Math.PI / 4, 0);
    this.invalidateShadows();
  }

  private showHint(text?: string, requested = false) {
    if (this.disposed || this.reading || (this.hintsDismissed && !requested)) return;
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
    this.reaction = gsap.timeline({ onUpdate: () => this.invalidateShadows(), onComplete: () => this.stopReaction() });
    if (result === 'success' && this.arm && this.armRest) {
      this.reaction.to(this.arm.rotation, { z: this.armRest.z + 1.0, duration: 0.2, ease: 'power2.out' })
        .to(this.arm.rotation, { z: this.armRest.z + 0.52, duration: 0.16, repeat: 3, yoyo: true, ease: 'sine.inOut' })
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
    this.invalidateShadows();
  }

  private publish() { EventBus.dispatch('guide-message', { ...this.message }); }

  private invalidateShadows() { this.application.renderer.instance.shadowMap.needsUpdate = true; }
}
