import type GuideRobot from './GuideRobot';

type Point = { x: number; z: number };
type Actor = Pick<GuideRobot, 'root' | 'setWalking' | 'walkTo'>;
type RouteSample = Point & { distance: number };

const SPEED = 0.45;
const VISITOR_STOP_DISTANCE = 2.8;
const VISITOR_RESUME_DISTANCE = 3.2;
const TURN_SPEED = 1.8;

/** The giant hamster stays west of x=7.15, over 3.7 m from coffee at (11,11). */
const CURVES: Point[][] = [
  [{ x: 7.15, z: 11.3 }, { x: 7.15, z: 12.2 }, { x: 7.15, z: 14.55 }, { x: 6.95, z: 15.1 }],
  [{ x: 6.95, z: 15.1 }, { x: 6.895, z: 15.25125 }, { x: 6.6, z: 15.3 }, { x: 6.6, z: 14.9 }],
  [{ x: 6.6, z: 14.9 }, { x: 6.6, z: 14.5 }, { x: 6.6, z: 11.85 }, { x: 6.65, z: 11.45 }],
  [{ x: 6.65, z: 11.45 }, { x: 6.68125, z: 11.2 }, { x: 7.15, z: 11.2 }, { x: 7.15, z: 11.3 }],
];

function buildRoute(): RouteSample[] {
  const route: RouteSample[] = [{ ...CURVES[0][0], distance: 0 }];
  for (const [a, b, c, d] of CURVES) {
    for (let step = 1; step <= 100; step++) {
      const t = step / 100;
      const u = 1 - t;
      const point = {
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        z: u * u * u * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t * t * t * d.z,
      };
      const previous = route[route.length - 1];
      route.push({ ...point, distance: previous.distance + Math.hypot(point.x - previous.x, point.z - previous.z) });
    }
  }
  return route;
}

const ROUTE = buildRoute();
const ROUTE_LENGTH = ROUTE[ROUTE.length - 1].distance;

function pointAt(distance: number): Point {
  const wrapped = ((distance % ROUTE_LENGTH) + ROUTE_LENGTH) % ROUTE_LENGTH;
  let low = 1;
  let high = ROUTE.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ROUTE[middle].distance < wrapped) low = middle + 1;
    else high = middle;
  }
  const before = ROUTE[low - 1];
  const after = ROUTE[low];
  const t = (wrapped - before.distance) / (after.distance - before.distance);
  return { x: before.x + (after.x - before.x) * t, z: before.z + (after.z - before.z) * t };
}

/** Owns only the hamster's outdoor route; World decides when it may advance. */
export default class HamsterRoam {
  private readonly actor: Actor;
  private readonly reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  private position: Point = { ...CURVES[0][0] };
  private heading = 0;
  private distance = 0;
  private nextRest = ROUTE_LENGTH / 2;
  private restIndex = 0;
  private restRemaining = 1.5;
  private visitorPaused = false;
  private active = false;

  constructor(actor: Actor) { this.actor = actor; }

  /** Dance poses never become route state: restore the saved point and heading. */
  resume(): void {
    this.active = true;
    this.actor.root.scale.setScalar(2.2);
    this.actor.setWalking(true);
    this.actor.walkTo(this.position.x, this.position.z, this.heading, false);
  }

  update(deltaMs: number, visitor?: Point): void {
    if (!this.active) return;
    let seconds = Number.isFinite(deltaMs) ? Math.max(0, Math.min(100, deltaMs)) / 1000 : 0;
    const validVisitor = visitor && Number.isFinite(visitor.x) && Number.isFinite(visitor.z) ? visitor : undefined;
    if (validVisitor) {
      const distance = Math.hypot(this.position.x - validVisitor.x, this.position.z - validVisitor.z);
      if (distance <= VISITOR_STOP_DISTANCE) this.visitorPaused = true;
      else if (distance >= VISITOR_RESUME_DISTANCE) this.visitorPaused = false;
    } else this.visitorPaused = false;

    if (this.reducedMotion.matches || this.visitorPaused || seconds === 0) {
      this.actor.walkTo(this.position.x, this.position.z, this.heading, false);
      return;
    }
    if (this.restRemaining > 0) {
      const resting = Math.min(seconds, this.restRemaining);
      this.restRemaining -= resting;
      seconds -= resting;
    }
    if (seconds <= 1e-9) {
      this.actor.walkTo(this.position.x, this.position.z, this.heading, false);
      return;
    }

    const travelTime = Math.min(seconds, (this.nextRest - this.distance) / SPEED);
    const nextDistance = this.distance + travelTime * SPEED;
    const next = pointAt(nextDistance);
    // Check the proposed position too, so one stride cannot step into the
    // reader's personal space before the following frame notices them.
    if (validVisitor && Math.hypot(next.x - validVisitor.x, next.z - validVisitor.z) <= VISITOR_STOP_DISTANCE) {
      this.visitorPaused = true;
      this.actor.walkTo(this.position.x, this.position.z, this.heading, false);
      return;
    }

    const ahead = pointAt(nextDistance + 0.035);
    const targetHeading = Math.atan2(ahead.x - next.x, ahead.z - next.z);
    const difference = Math.atan2(Math.sin(targetHeading - this.heading), Math.cos(targetHeading - this.heading));
    this.heading += Math.max(-TURN_SPEED * travelTime, Math.min(TURN_SPEED * travelTime, difference));
    this.position = next;
    this.distance = nextDistance;
    let moving = travelTime > 1e-9;
    if (this.distance >= this.nextRest - 1e-9) {
      this.nextRest += ROUTE_LENGTH / 2;
      this.restIndex++;
      this.restRemaining = (this.restIndex % 2 ? 1.2 : 1.8) - (seconds - travelTime);
      moving = false;
    }
    this.actor.walkTo(this.position.x, this.position.z, this.heading, moving);
  }
}
