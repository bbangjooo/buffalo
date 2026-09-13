import * as THREE from 'three';
import { gsap } from 'gsap';
import { LoadedModel } from '../../types';
import { BaseObject } from './BaseObject';
import { COLORS, ObjectId, ROOM_IDS, RoomId, ROOMS } from '../../design/rooms';
import { isPenInkObject, preparePenInkModel } from './PenInk';

const TARGETS: Record<string, { name: string; anchor: string }> = {
  resume: { name: 'ResumeBoard', anchor: 'ResumeAnchor' },
  pianoSeat: { name: 'PianoBench', anchor: 'PianoSeatAnchor' },
  monitor: { name: 'Monitor', anchor: 'MonitorAnchor' },
  blogLamp: { name: 'BlogLamp', anchor: 'BlogLampAnchor' },
  game: { name: 'GameConsole', anchor: 'GameAnchor' },
  leaderboard: { name: 'LeaderboardBoard', anchor: 'LeaderboardAnchor' },
};
type Rest = { position: THREE.Vector3; quaternion: THREE.Quaternion };

export default class Room extends BaseObject {
  root: THREE.Group;
  groups = new Map<RoomId, THREE.Object3D>();
  targets = new Map<ObjectId, THREE.Object3D>();
  anchors = new Map<ObjectId, THREE.Object3D>();
  private rest = new Map<THREE.Object3D, Rest>();
  private padMaterials: THREE.MeshStandardMaterial[][] = [];
  private heldKeys = new Set<number>();

  constructor() {
    super();
    this.root = (this.resources.items.dioramaModel as LoadedModel).scene;
    preparePenInkModel(this.root);
    this.root.updateMatrixWorld(true);
    ROOM_IDS.forEach((id) => {
      const group = this.root.getObjectByName(ROOMS[id].group);
      if (!group) throw new Error(`Missing room: ${ROOMS[id].group}`);
      this.groups.set(id, group);
    });
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = !isPenInkObject(child);
        child.receiveShadow = !isPenInkObject(child);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            // Preserve the authored polygon planes instead of interpolated normals.
            material.flatShading = true;
            material.needsUpdate = true;
          }
        });
      }
    });
    Object.keys(TARGETS).forEach((id) => {
      const config = TARGETS[id];
      const target = this.root.getObjectByName(config.name);
      if (!target) throw new Error(`Missing interaction: ${config.name}`);
      target.userData.interactiveId = id;
      this.targets.set(id as ObjectId, target);
      this.anchors.set(id as ObjectId, this.root.getObjectByName(config.anchor) || target);
    });
    const portrait = this.root.getObjectByName('PortraitFrame');
    if (portrait) portrait.userData.interactiveId = 'resume';
    for (let midi = 60; midi <= 83; midi++) {
      const key = this.root.getObjectByName(`PianoKey${midi}`);
      if (!key) throw new Error(`Missing piano key ${midi}`);
      key.userData.interactiveId = `key${midi}`;
      this.targets.set(`key${midi}`, key);
      this.remember(key);
    }
    for (let i = 0; i < 4; i++) {
      const pad = this.root.getObjectByName(`GamePad${i}`);
      if (!pad) throw new Error(`Missing game pad ${i}`);
      pad.userData.interactiveId = `gamePad${i}`;
      this.targets.set(`gamePad${i}` as ObjectId, pad);
      this.remember(pad);
      const materials: THREE.MeshStandardMaterial[] = [];
      pad.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const clones = (Array.isArray(child.material) ? child.material : [child.material]).map((material) => {
          const clone = material.clone();
          if (clone instanceof THREE.MeshStandardMaterial) {
            clone.emissive.set(COLORS.glow).convertSRGBToLinear();
            clone.emissiveIntensity = 0;
            materials.push(clone);
          }
          return clone;
        });
        child.material = Array.isArray(child.material) ? clones : clones[0];
      });
      this.padMaterials.push(materials);
    }
    this.show();
  }

  private remember(object: THREE.Object3D) {
    this.rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone() });
  }
  add() { this.scene.add(this.root); }

  get monitorAnchor() { return this.requireObject('MonitorScreenAnchor'); }
  get resumeAnchor() { return this.requireObject('ResumeScreenAnchor'); }
  get leaderboardAnchor() { return this.requireObject('LeaderboardScreenAnchor'); }
  get pianoEyeAnchor() { return this.requireObject('PianoEyeAnchor'); }
  get pianoLookAnchor() { return this.requireObject('PianoLookAnchor'); }
  get robot() { return this.requireObject('Robot'); }
  private requireObject(name: string) {
    const object = this.root.getObjectByName(name);
    if (!object) throw new Error(`Missing ${name}`);
    return object;
  }

  show() {
    // This is one continuous house. Room selection only changes the camera.
    this.groups.forEach((group) => { group.visible = true; });
    this.invalidateShadows();
  }

  pressKey(midi: number, reduced: boolean) { this.press(this.targets.get(`key${midi}`), 0.045, reduced); }
  pressPad(index: number, reduced: boolean) { this.press(this.targets.get(`gamePad${index}` as ObjectId), 0.055, reduced); }

  holdKeys(keys: ReadonlySet<number>, reduced: boolean) {
    const changed = new Set([...this.heldKeys, ...keys]);
    changed.forEach((midi) => {
      if (this.heldKeys.has(midi) === keys.has(midi)) return;
      const key = this.targets.get(`key${midi}`);
      if (!key) return;
      const y = this.rest.get(key)!.position.y - (keys.has(midi) ? 0.045 : 0);
      gsap.killTweensOf(key.position);
      gsap.to(key.position, { y, duration: reduced ? 0 : 0.035, overwrite: true,
        onUpdate: () => this.invalidateShadows() });
    });
    this.heldKeys = new Set(keys);
  }

  restrikeKeys(keys: ReadonlyArray<number>, reduced: boolean) {
    keys.forEach((midi) => {
      const key = this.targets.get(`key${midi}`);
      if (!key || !this.heldKeys.has(midi)) return;
      const y = this.rest.get(key)!.position.y;
      gsap.killTweensOf(key.position);
      key.position.y = y;
      gsap.to(key.position, { y: y - 0.045, duration: reduced ? 0 : 0.025,
        onUpdate: () => this.invalidateShadows() });
    });
  }

  private press(object: THREE.Object3D | undefined, travel: number, reduced: boolean) {
    if (!object || reduced) return;
    const y = this.rest.get(object)!.position.y;
    gsap.killTweensOf(object.position);
    gsap.to(object.position, { y: y - travel, duration: 0.055, onUpdate: () => this.invalidateShadows(), onComplete: () => {
      gsap.to(object.position, { y, duration: 0.2, ease: 'power2.out', onUpdate: () => this.invalidateShadows() });
    } });
  }

  lightPad(index: number, on: boolean, reduced: boolean) {
    this.padMaterials[index]?.forEach((material) => {
      gsap.to(material, { emissiveIntensity: on ? 1.5 : 0, duration: reduced ? 0 : 0.08, overwrite: true });
    });
  }

  stopMotion({ preservePiano = false }: { preservePiano?: boolean } = {}) {
    if (!preservePiano) this.heldKeys.clear();
    this.rest.forEach((rest, object) => {
      if (preservePiano && object.name.startsWith('PianoKey')) return;
      gsap.killTweensOf(object.position);
      gsap.killTweensOf(object.rotation);
      object.position.copy(rest.position);
      object.quaternion.copy(rest.quaternion);
    });
    this.padMaterials.forEach((materials) => materials.forEach((material) => {
      gsap.killTweensOf(material);
      material.emissiveIntensity = 0;
    }));
    this.invalidateShadows();
  }

  private invalidateShadows() { this.application.renderer.instance.shadowMap.needsUpdate = true; }
}
