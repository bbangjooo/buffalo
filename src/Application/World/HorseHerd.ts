import * as THREE from 'three';
import type Application from '../Application';
import type { LoadedModel } from '../../types';
import type { ArtTheme } from '../../design/art-themes';
import courtyard from '../../design/courtyard-layout.json';
import { preparePenInkModel } from './PenInk';

type Point = { x: number; z: number };
type Joint = { object: THREE.Object3D; rotation: THREE.Euler; position: THREE.Vector3 };
type Leg = { fore: boolean; proximal: Joint; middle: Joint; distal: Joint; hoof: Joint;
  restFoot: THREE.Vector3; toe: number; heel: number };
type Rig = { model: THREE.Object3D; legs: Leg[]; neck: Joint; head: Joint; jaw: Joint; tail: Joint;
  muzzle: THREE.Object3D; muzzleRest: THREE.Vector3; grazeNeck: number; grazeHead: number };
type Foot = { target: THREE.Vector3; contact: THREE.Vector3; liftOff: THREE.Vector3;
  mode: 'rest' | 'stance' | 'swing'; swingStart: number; pitch: number; recovery: number; settling: number; settleDelay: number };
type Activity = 'walk' | 'settle' | 'lower' | 'graze' | 'raise' | 'turn';
type Route = { from: Point; to: Point; length: number };
type Horse = { id: string; root: THREE.Group; rigs: Record<ArtTheme, Rig>; route: Route;
  scale: number; speed: number; velocity: number; distance: number; progress: number; direction: number;
  heading: number; position: Point; phase: number; age: number; nextRest: number; restIndex: number;
  feet: Foot[]; motion: number; visitorPaused: boolean; moving: boolean; grazing: number;
  activity: Activity; activityTime: number; grazeDuration: number; settleTo: 'lower' | 'walk';
  turnFrom: number; turnTo: number; settleClock: number };

// Open, straight grazing lanes, one near and one farther out in every quadrant.
// A horse rests before reversing, so it never spends its walk circling a tiny pen.
export const HORSE_ROUTES = [
  { id: 'Maple', variant: 'HorseChestnut', room: 'developer', region: 'courtyard', x: 7, z: 14.9, from: [7, 12.8], to: [7, 17], scale: .94, speed: .64, phase: .22 },
  { id: 'Oat', variant: 'HorseCream', room: 'piano', region: 'courtyard', x: 7.1, z: -11.4, from: [7.1, -10.2], to: [7.1, -12.6], scale: .84, speed: .58, phase: .65 },
  { id: 'Sorrel', variant: 'HorseChestnut', room: 'blog', region: 'courtyard', x: -13.5, z: -8.1, from: [-11.8, -7.2], to: [-15.2, -9], scale: .9, speed: .62, phase: .18 },
  { id: 'Pebble', variant: 'HorseCharcoal', room: 'ai', region: 'courtyard', x: -8.35, z: 12.3, from: [-7.4, 10.6], to: [-9.3, 14], scale: .88, speed: .6, phase: .74 },
  { id: 'Clover', variant: 'HorseCream', room: 'developer', region: 'meadow', x: 13.5, z: 15, from: [12.5, 15], to: [14.5, 15], scale: 1, speed: .7, phase: .3 },
  { id: 'Ash', variant: 'HorseCharcoal', room: 'piano', region: 'meadow', x: 17.5, z: -7.7, from: [16, -8], to: [19, -7.4], scale: .9, speed: .65, phase: .5 },
  { id: 'Fennel', variant: 'HorseChestnut', room: 'blog', region: 'meadow', x: -8.4, z: -16.25, from: [-10, -15.5], to: [-6.8, -17], scale: .94, speed: .68, phase: .42 },
  { id: 'Bramble', variant: 'HorseCream', room: 'ai', region: 'meadow', x: -12, z: 15.9, from: [-11.5, 17], to: [-12.5, 14.8], scale: .87, speed: .61, phase: .1 },
] as const;

const STRIDE = .82;
const STANCE = .63;
const TURN_DURATION = 4.5;
const FOOT_PHASES = [.75, .25, 0, .5];
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t: number) => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const approach = (from: number, to: number, amount: number) => from + THREE.MathUtils.clamp(to - from, -amount, amount);
const fraction = (value: number) => ((value % 1) + 1) % 1;
const recoveryPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .12, -.07), new THREE.Vector3(0, .3, .16),
  new THREE.Vector3(0, .27, .57), new THREE.Vector3(0, .13, .9), new THREE.Vector3(0, 0, 1),
], false, 'catmullrom', .4);

function pointAt(route: Route, progress: number): Point {
  const t = THREE.MathUtils.clamp(progress / route.length, 0, 1);
  return { x: THREE.MathUtils.lerp(route.from.x, route.to.x, t), z: THREE.MathUtils.lerp(route.from.z, route.to.z, t) };
}

/** Reference-led four-beat walk, with a separate settle / browse / raise sequence. */
export default class HorseHerd {
  readonly root = new THREE.Group();
  private readonly horses: Horse[] = [];
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private theme: ArtTheme = 'ink';
  private danceAnchor: THREE.Object3D | null = null;
  private danceTime = 0;
  private dancePlaying = false;
  private danceBpm = 162;
  private danceSteps = [0, 0, 0, 0];
  private celebration = 0;
  private disposed = false;

  constructor(private application: Application) {
    this.root.name = 'CourtyardHorseHerd';
    const ink = (application.resources.items.inkHorsesModel as LoadedModel).scene;
    const classic = (application.resources.items.classicHorsesModel as LoadedModel).scene;
    preparePenInkModel(ink);
    HORSE_ROUTES.forEach((spec, index) => {
      const root = new THREE.Group(); root.name = `Horse_${spec.id}`;
      root.userData = { role: 'horse', name: spec.id, room: spec.room, region: spec.region, variant: spec.variant };
      const rigs = { ink: this.makeRig(ink, spec.variant, true), classic: this.makeRig(classic, spec.variant, false) };
      root.add(rigs.ink.model, rigs.classic.model); root.scale.setScalar(spec.scale); this.root.add(root);
      const from = { x: spec.from[0], z: spec.from[1] }, to = { x: spec.to[0], z: spec.to[1] };
      const route = { from, to, length: Math.hypot(to.x - from.x, to.z - from.z) };
      const progress = route.length * spec.phase, direction = index % 2 ? -1 : 1;
      const position = pointAt(route, progress);
      const heading = Math.atan2((to.x - from.x) * direction, (to.z - from.z) * direction);
      const horse: Horse = { id: spec.id, root, rigs, route, scale: spec.scale, speed: spec.speed,
        velocity: 0, distance: 0, progress, direction, heading, position, phase: index * .137, age: index * 2.1,
        nextRest: 2.8 + index * .35, restIndex: index, feet: [], motion: 0, visitorPaused: false,
        moving: false, grazing: 0, activity: 'walk', activityTime: 0, grazeDuration: 5.5 + (index % 3) * .5,
        settleTo: 'lower', turnFrom: heading, turnTo: heading, settleClock: 2 };
      root.position.set(position.x, courtyard.groundY, position.z); root.rotation.y = heading; root.updateMatrixWorld(true);
      horse.feet = rigs.ink.legs.map(leg => {
        const target = root.localToWorld(leg.restFoot.clone());
        return { target, contact: target.clone(), liftOff: target.clone(), mode: 'rest', swingStart: STANCE, pitch: 0, recovery: 0, settling: 1, settleDelay: 0 };
      });
      this.horses.push(horse);
      if (index === 2 || index === 5) this.startGrazing(horse);
      this.place(horse, 0);
    });
    this.setArtTheme('ink'); application.scene.add(this.root);
  }

  private makeRig(source: THREE.Object3D, name: string, ink: boolean): Rig {
    const template = source.getObjectByName(name);
    if (!template) throw new Error(`Missing horse model: ${name}`);
    const model = template.clone(true); model.position.set(0, 0, 0); model.quaternion.identity();
    const joints = new Map<string, Joint>();
    model.traverse(object => {
      delete object.userData.interactiveId;
      if (object instanceof THREE.Mesh) { object.castShadow = !ink; object.receiveShadow = !ink; }
      joints.set(object.name, { object, rotation: object.rotation.clone(), position: object.position.clone() });
    });
    const required = (key: string): Joint => {
      const joint = [...joints.values()].find(item => item.object.name.endsWith(`_${key}`));
      if (!joint) throw new Error(`Missing horse joint: ${name}/${key}`);
      return joint;
    };
    model.updateWorldMatrix(true, true);
    const legs = ['LegFL', 'LegFR', 'LegBL', 'LegBR'].map((key, index): Leg => {
      const fore = index < 2, proximal = required(key);
      const middle = required(`${key}_${fore ? 'Elbow' : 'Stifle'}Pivot`);
      const distal = required(`${key}_${fore ? 'Knee' : 'Hock'}Pivot`), hoof = required(`${key}_HoofPivot`);
      const restFoot = model.worldToLocal(hoof.object.getWorldPosition(new THREE.Vector3()));
      const toe = [...joints.values()].find(item => item.object.name.endsWith(`${key}_ToeAnchor`));
      const heel = [...joints.values()].find(item => item.object.name.endsWith(`${key}_HeelAnchor`));
      return { fore, proximal, middle, distal, hoof, restFoot, toe: toe?.position.z || .13, heel: heel?.position.z || -.12 };
    });
    const neck = required('NeckPivot'), head = required('HeadPivot'), muzzle = required('MuzzleAnchor').object;
    const muzzleRest = head.object.worldToLocal(muzzle.getWorldPosition(new THREE.Vector3()));
    const rig = { model, legs, neck, head, muzzle, muzzleRest, jaw: required('JawPivot'), tail: required('TailPivot'), grazeNeck: 0, grazeHead: 0 };
    // The Blender-authored pose puts the lower lip in the grass while keeping
    // the jaw clear of the soil; positive poll flex would shorten this reach.
    rig.grazeNeck = template.userData.grazingRig?.neckX ?? 1.4909507063;
    rig.grazeHead = template.userData.grazingRig?.headX ?? -.5596915953;
    return rig;
  }

  setArtTheme(theme: ArtTheme): void {
    if (this.disposed) return; this.theme = theme;
    this.horses.forEach(horse => { horse.rigs.ink.model.visible = theme === 'ink'; horse.rigs.classic.model.visible = theme === 'classic'; horse.root.userData.artTheme = theme; });
    this.invalidateShadows();
  }

  private startGrazing(horse: Horse): void {
    horse.activity = 'settle'; horse.activityTime = 0; horse.settleTo = 'lower';
  }

  private startWalking(horse: Horse): void {
    horse.activity = 'walk'; horse.activityTime = 0; horse.grazing = 0;
    horse.nextRest = horse.distance + 3.2 + (horse.restIndex % 4) * .7;
  }

  private setActivity(horse: Horse, activity: Activity): void { horse.activity = activity; horse.activityTime = 0; }

  update(deltaMs: number, visitor?: Point, paused = false): void {
    if (this.disposed || !this.root.visible) return;
    const seconds = Number.isFinite(deltaMs) ? THREE.MathUtils.clamp(deltaMs, 0, 100) / 1000 : 0;
    if (this.danceAnchor) { this.updateDance(paused ? 0 : seconds); return; }
    if (paused || seconds === 0) return;
    const valid = visitor && Number.isFinite(visitor.x) && Number.isFinite(visitor.z) ? visitor : undefined;
    for (const horse of this.horses) {
      horse.moving = false;
      if (this.reducedMotion.matches) { horse.motion = 0; horse.grazing = 0; this.place(horse, 0); continue; }
      horse.age += seconds;
      if (valid) {
        const distance = Math.hypot(horse.position.x - valid.x, horse.position.z - valid.z);
        if (distance <= 2.6) horse.visitorPaused = true;
        else if (distance >= 3.1) horse.visitorPaused = false;
      } else horse.visitorPaused = false;
      if (horse.visitorPaused) { horse.velocity = 0; this.place(horse, seconds); continue; }
      horse.activityTime += seconds;
      if (horse.activity === 'walk' || horse.activity === 'settle') {
        const remaining = horse.direction > 0 ? horse.route.length - horse.progress : horse.progress;
        const scheduled = Math.max(0, horse.nextRest - horse.distance);
        const desired = horse.activity === 'walk' ? Math.min(horse.speed, Math.sqrt(1.1 * Math.min(remaining, scheduled))) : 0;
        horse.velocity = approach(horse.velocity, desired, seconds * .85);
        const travel = Math.min(remaining, horse.velocity * seconds);
        const proposed = pointAt(horse.route, horse.progress + travel * horse.direction);
        if (valid && Math.hypot(proposed.x - valid.x, proposed.z - valid.z) <= 2.6) { horse.visitorPaused = true; horse.velocity = 0; }
        else {
          horse.progress += travel * horse.direction; horse.distance += travel; horse.position = proposed;
          horse.phase += travel / (STRIDE * horse.scale); horse.moving = travel > 1e-6;
        }
        if (horse.activity === 'walk' && (remaining < .006 || scheduled < .006)) { horse.velocity = 0; this.startGrazing(horse); }
        if (horse.activity === 'settle' && horse.activityTime > 1.5 && horse.velocity < .001) {
          if (horse.settleTo === 'walk') this.startWalking(horse); else this.setActivity(horse, 'lower');
        }
      } else if (horse.activity === 'lower') {
        horse.grazing = smooth(horse.activityTime / 1.8);
        if (horse.activityTime >= 1.8) this.setActivity(horse, 'graze');
      } else if (horse.activity === 'graze') {
        horse.grazing = 1;
        if (horse.activityTime >= horse.grazeDuration) this.setActivity(horse, 'raise');
      } else if (horse.activity === 'raise') {
        horse.grazing = 1 - smooth(horse.activityTime / 1.5);
        if (horse.activityTime >= 1.5) {
          horse.grazing = 0; horse.restIndex++;
          if (horse.progress < .02 || horse.route.length - horse.progress < .02) {
            horse.direction *= -1; horse.turnFrom = horse.heading; horse.turnTo = horse.heading + Math.PI;
            this.setActivity(horse, 'turn');
          } else this.startWalking(horse);
        }
      } else if (horse.activity === 'turn') {
        horse.heading = THREE.MathUtils.lerp(horse.turnFrom, horse.turnTo, smooth(horse.activityTime / TURN_DURATION));
        horse.phase += seconds / 1.2;
        if (horse.activityTime >= TURN_DURATION) { horse.heading = horse.turnTo; horse.settleTo = 'walk'; this.setActivity(horse, 'settle'); }
      }
      horse.motion = THREE.MathUtils.lerp(horse.motion, horse.moving ? 1 : 0, 1 - Math.exp(-seconds * 7));
      this.place(horse, seconds);
    }
    if (this.theme === 'classic') this.invalidateShadows();
  }

  private place(horse: Horse, seconds: number): void {
    const bob = this.reducedMotion.matches ? 0 : Math.sin(horse.phase * Math.PI * 4) * horse.motion * .003 * horse.scale;
    horse.root.position.set(horse.position.x, courtyard.groundY + bob, horse.position.z); horse.root.rotation.set(0, horse.heading, 0);
    horse.root.updateMatrixWorld(true); this.updateFeet(horse, seconds); this.pose(horse);
  }

  private landing(horse: Horse, leg: Leg, remaining: number, duty: number): THREE.Vector3 {
    const turning = horse.activity === 'turn';
    const future = remaining + duty * .5;
    const point = turning ? horse.position : pointAt(horse.route, horse.progress + future * STRIDE * horse.scale * horse.direction);
    const heading = turning ? THREE.MathUtils.lerp(horse.turnFrom, horse.turnTo, smooth((horse.activityTime + future * 1.2) / TURN_DURATION)) : horse.heading;
    const target = leg.restFoot.clone().multiplyScalar(horse.scale).applyAxisAngle(UP, heading);
    target.x += point.x; target.z += point.z; target.y = courtyard.groundY + leg.restFoot.y * horse.scale;
    return target;
  }

  private updateFeet(horse: Horse, seconds: number): void {
    const turning = horse.activity === 'turn' && !horse.visitorPaused, duty = turning ? .55 : STANCE;
    if (!horse.moving && !turning && !horse.visitorPaused && horse.feet.some(foot => foot.mode !== 'rest')) {
      const airborne = horse.feet.filter(foot => foot.mode === 'swing');
      let grounded = 0;
      for (const foot of horse.feet) {
        foot.settleDelay = airborne.includes(foot) ? 0 : (airborne.length ? .38 : 0) + grounded++ * .22;
        foot.liftOff.copy(foot.target); foot.settling = 0; foot.mode = 'rest';
      }
      horse.settleClock = 0;
    }
    if (!horse.moving && !turning) horse.settleClock += seconds;
    horse.feet.forEach((foot, index) => {
      const leg = horse.rigs.ink.legs[index], ground = courtyard.groundY + leg.restFoot.y * horse.scale;
      if (this.reducedMotion.matches) { foot.target.copy(horse.root.localToWorld(leg.restFoot.clone())); foot.contact.copy(foot.target); foot.mode = 'rest'; foot.pitch = foot.recovery = 0; return; }
      if (horse.visitorPaused) {
        // Yield in place: grounded feet keep contact, and only a hoof already in
        // the air finishes descending. Preserve the four-beat clock for restart.
        foot.target.y = Math.max(ground, foot.target.y - seconds * horse.scale * .7);
        foot.pitch = approach(foot.pitch, 0, seconds * 4);
        if (foot.mode === 'swing') { foot.liftOff.copy(foot.target); foot.swingStart = fraction(horse.phase + FOOT_PHASES[index]); }
        return;
      }
      if (!horse.moving && !turning) {
        foot.settling = THREE.MathUtils.clamp((horse.settleClock - foot.settleDelay) / .36, 0, 1);
        const target = horse.root.localToWorld(leg.restFoot.clone()); target.y = ground;
        foot.target.lerpVectors(foot.liftOff, target, smooth(foot.settling));
        const reposition = Math.hypot(target.x - foot.liftOff.x, target.z - foot.liftOff.z) > .025;
        foot.target.y = Math.max(ground, THREE.MathUtils.lerp(foot.liftOff.y, ground, smooth(foot.settling))) + (reposition ? Math.sin(foot.settling * Math.PI) * .025 * horse.scale : 0);
        foot.pitch = approach(foot.pitch, 0, seconds * 4); foot.recovery = 0; foot.contact.copy(foot.target); return;
      }
      const phase = fraction(horse.phase + FOOT_PHASES[index]);
      if (phase < duty) {
        if (foot.mode === 'swing') foot.contact.copy(this.landing(horse, leg, 0, duty));
        else if (foot.mode === 'rest') foot.contact.copy(foot.target);
        foot.mode = 'stance'; foot.contact.y = ground; foot.target.copy(foot.contact); foot.pitch = foot.recovery = 0;
      } else {
        if (foot.mode !== 'swing') { foot.liftOff.copy(foot.target); foot.swingStart = foot.mode === 'rest' ? phase : duty; foot.mode = 'swing'; }
        const progress = THREE.MathUtils.clamp((phase - foot.swingStart) / (1 - foot.swingStart), 0, 1);
        const path = recoveryPath.getPoint(progress), landing = this.landing(horse, leg, 1 - phase, duty);
        foot.target.lerpVectors(foot.liftOff, landing, turning ? smooth(progress) : path.z);
        foot.recovery = progress;
        foot.pitch = turning ? 0 : Math.sin(Math.PI * progress) * (leg.fore ? 1.05 : .72);
        const heelLift = Math.max(0, leg.restFoot.y * (Math.cos(foot.pitch) - 1) + Math.max(leg.toe * Math.sin(foot.pitch), leg.heel * Math.sin(foot.pitch)));
        const lift = turning ? Math.sin(progress * Math.PI) * .055 : Math.max(0, path.y) * (leg.fore ? 1 : .77) + heelLift;
        foot.target.y = ground + Math.max((foot.liftOff.y - ground) * (1 - smooth(progress)), lift * horse.scale);
      }
    });
  }

  /** Solve only the distal pair; proximal joints preserve each limb's anatomy. */
  private solvePair(upper: Joint, lower: Joint, first: THREE.Vector3, second: THREE.Vector3, target: THREE.Vector3, pole: number): void {
    const direction = target.clone().sub(upper.object.position), firstLength = first.length(), secondLength = second.length();
    const distance = THREE.MathUtils.clamp(direction.length(), .001, firstLength + secondLength - .00004); direction.normalize();
    const along = (firstLength ** 2 - secondLength ** 2 + distance ** 2) / (2 * distance);
    const across = Math.sqrt(Math.max(0, firstLength ** 2 - along ** 2));
    const bend = new THREE.Vector3(0, 0, pole).addScaledVector(direction, -direction.z * pole).normalize();
    const firstTarget = direction.clone().multiplyScalar(along).addScaledVector(bend, across);
    upper.object.quaternion.setFromUnitVectors(first.clone().normalize(), firstTarget.clone().normalize());
    const secondTarget = direction.multiplyScalar(distance).sub(firstTarget).applyQuaternion(upper.object.quaternion.clone().invert());
    lower.object.quaternion.setFromUnitVectors(second.clone().normalize(), secondTarget.normalize());
  }

  private solveLeg(leg: Leg, target: THREE.Vector3, foot: Foot): void {
    for (const joint of [leg.proximal, leg.middle, leg.distal, leg.hoof]) { joint.object.position.copy(joint.position); joint.object.rotation.copy(joint.rotation); }
    const swing = foot.mode === 'swing', flex = swing ? Math.sin(foot.recovery * Math.PI) : 0;
    if (leg.fore) {
      // Shoulder→elbow carries a straight radius/cannon virtual link in support.
      // Shortening that virtual link during recovery folds only the carpus;
      // the elbow keeps its opposite, rear-facing anatomical bend.
      const radius = leg.distal.position.length(), cannon = leg.hoof.position.length();
      const humerus = leg.middle.position.length(), full = humerus + radius + cannon - .0002;
      const horizontal = (target.x - leg.proximal.position.x) ** 2 + (target.z - leg.proximal.position.z) ** 2;
      leg.proximal.object.position.y = Math.min(leg.proximal.position.y, target.y + Math.sqrt(Math.max(0, full * full - horizontal)));
      const desiredFlex = swing ? Math.sin(foot.recovery * Math.PI) * 1.4 : .025;
      const desiredLength = Math.sqrt(radius * radius + cannon * cannon + 2 * radius * cannon * Math.cos(desiredFlex));
      const virtualLength = Math.min(radius + cannon - .0001,
        Math.max(desiredLength, target.distanceTo(leg.proximal.object.position) - humerus + .0001));
      const virtual = leg.distal.position.clone().add(leg.hoof.position).normalize().multiplyScalar(virtualLength);
      const elbowHelper: Joint = { object: new THREE.Object3D(), position: virtual, rotation: new THREE.Euler() };
      this.solvePair(leg.proximal, elbowHelper, leg.middle.position, virtual, target, -1);
      const localTarget = target.clone().sub(leg.proximal.object.position).applyQuaternion(leg.proximal.object.quaternion.clone().invert());
      this.solvePair(leg.middle, leg.distal, leg.distal.position, leg.hoof.position, localTarget, 1);
    } else {
      // A separate stifle and hock retain the natural hind-leg zigzag. Recovery
      // flexes the stifle; the support pose keeps its authored anatomical shape.
      let stifle = flex * .42;
      {
        // During push-off the stifle opens as the supporting hoof passes behind
        // the hip. Holding the resting stifle angle would shorten the limb.
        const required = target.distanceTo(leg.proximal.position) - leg.hoof.position.length() + .016;
        for (let angle = stifle; angle >= -.75; angle -= .025) {
          stifle = angle;
          const span = leg.distal.position.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle).add(leg.middle.position).length();
          if (span >= required) break;
        }
      }
      leg.middle.object.rotation.x = stifle;
      const compound = leg.distal.position.clone().applyQuaternion(leg.middle.object.quaternion).add(leg.middle.position);
      const helper: Joint = { object: new THREE.Object3D(), position: compound, rotation: new THREE.Euler() };
      this.solvePair(leg.proximal, helper, compound, leg.hoof.position, target, -1);
      leg.distal.object.quaternion.copy(leg.middle.object.quaternion).invert().multiply(helper.object.quaternion);
    }
    const parentRotation = leg.proximal.object.quaternion.clone().multiply(leg.middle.object.quaternion).multiply(leg.distal.object.quaternion);
    leg.hoof.object.quaternion.copy(parentRotation.invert()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), foot.pitch));
  }

  private pose(horse: Horse, dance = false, phase = horse.phase): void {
    const animated = !this.reducedMotion.matches;
    for (const rig of [horse.rigs.ink, horse.rigs.classic]) {
      rig.legs.forEach((leg, index) => {
        let foot = horse.feet[index], target = horse.root.worldToLocal(foot.target.clone());
        if (dance) {
          const lift = animated && this.dancePlaying ? Math.max(0, Math.sin((phase + FOOT_PHASES[index]) * Math.PI * 2)) * .16 : 0;
          target = leg.restFoot.clone(); target.y += lift + Math.sin(this.danceSteps[index] / .26 * Math.PI) * .12;
          foot = { ...foot, mode: lift ? 'swing' : 'rest', recovery: .5, pitch: 0 };
        }
        this.solveLeg(leg, target, foot);
      });
      const graze = animated && !dance ? horse.grazing : 0;
      const chewing = horse.activity === 'graze' && graze > .99;
      rig.neck.object.rotation.copy(rig.neck.rotation); rig.head.object.rotation.copy(rig.head.rotation);
      rig.neck.object.rotation.x += rig.grazeNeck * graze + (animated ? Math.sin(horse.phase * Math.PI * 2) * horse.motion * .018 * (1 - graze) : 0);
      rig.head.object.rotation.x += rig.grazeHead * graze + (chewing ? Math.sin(horse.activityTime * 3.2) * .012 : 0);
      rig.jaw.object.rotation.copy(rig.jaw.rotation);
      if (chewing) rig.jaw.object.rotation.x += Math.pow(Math.max(0, Math.sin(horse.activityTime * 7)), 2) * .12;
      rig.tail.object.rotation.copy(rig.tail.rotation);
      if (animated) rig.tail.object.rotation.z += Math.sin(horse.age * 1.25) * .1 + Math.pow(Math.max(0, Math.sin(horse.age * .4)), 10) * Math.sin(horse.age * 8) * .16;
    }
  }

  setDancing(anchor: THREE.Object3D | null): void {
    if (this.disposed) return; this.danceAnchor = anchor; this.dancePlaying = false; this.danceSteps.fill(0); this.celebration = 0;
    const horse = this.horses[0]; horse.root.scale.setScalar(anchor ? .56 : horse.scale);
    if (anchor) this.updateDance(0); else this.place(horse, 0);
    this.horses.forEach((item, index) => { item.root.visible = !anchor || index === 0; }); this.invalidateShadows();
  }
  setDanceBeat(time: number, playing: boolean, bpm: number): void { this.danceTime = Number.isFinite(time) ? time : 0; this.dancePlaying = playing; this.danceBpm = bpm > 0 ? bpm : 162; if (!playing) this.danceSteps.fill(0); }
  danceStep(lane: number): void { if (this.danceAnchor && this.dancePlaying && !this.reducedMotion.matches && Number.isInteger(lane) && lane >= 0 && lane < 4) this.danceSteps[lane] = .26; }
  react(): void { if (this.danceAnchor && !this.reducedMotion.matches) this.celebration = .85; }
  private updateDance(seconds: number): void {
    const horse = this.horses[0], anchor = this.danceAnchor!; horse.age += seconds;
    this.danceSteps = this.danceSteps.map(step => Math.max(0, step - seconds)); this.celebration = Math.max(0, this.celebration - seconds);
    anchor.getWorldPosition(horse.root.position); anchor.getWorldQuaternion(horse.root.quaternion);
    if (!this.reducedMotion.matches && this.celebration) horse.root.position.y += Math.sin(this.celebration / .85 * Math.PI) * .09;
    this.pose(horse, true, this.danceTime * this.danceBpm / 60); this.invalidateShadows();
  }
  get state() {
    return { theme: this.theme, dancing: Boolean(this.danceAnchor), horses: this.horses.map(horse => ({
      id: horse.id, room: horse.root.userData.room, quadrant: horse.root.userData.room, region: horse.root.userData.region, variant: horse.root.userData.variant,
      x: horse.root.position.x, y: horse.root.position.y, z: horse.root.position.z, heading: horse.root.rotation.y,
      moving: horse.moving, grazing: horse.activity === 'graze', activity: horse.activity, grazeProgress: horse.grazing, visitorPaused: horse.visitorPaused,
      visible: this.root.visible && horse.root.visible, scale: horse.root.scale.x,
    })) };
  }
  private invalidateShadows(): void { this.application.renderer.instance.shadowMap.needsUpdate = true; }
  dispose(): void { if (!this.disposed) { this.root.removeFromParent(); this.horses.length = 0; this.disposed = true; } }
}
