import { COURTYARD } from '../../design/history';
import type { RoomId } from '../../design/rooms';

const ROBOT_RADIUS = 0.4;
const STATION_RADIUS = 2;
const WALK_SPEED = 8.4;
const SPRINT_SPEED = 16.8;
const JUMP_SPEED = 5.8;
const GRAVITY = 18;
const MAX_HORIZONTAL_STEP = 0.12;

export type WalkDirection = 'up' | 'down' | 'left' | 'right';
const KEY_DIRECTIONS: Record<string, WalkDirection> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
export function walkDirection(code: string): WalkDirection | undefined { return KEY_DIRECTIONS[code]; }

/** Renderer-independent first-person movement, relative to the visitor's heading. */
export class CourtyardWalk {
  x = COURTYARD.entrance[0];
  y = 0;
  z = COURTYARD.entrance[1];
  heading = Math.PI / 4;
  readonly held = new Map<string, WalkDirection>();
  private readonly sprintSources = new Set<string>();
  private verticalVelocity = 0;
  get sprinting() { return this.sprintSources.size > 0; }
  setInput(source: string, direction: WalkDirection | null) {
    if (direction) this.held.set(source, direction);
    else this.held.delete(source);
  }
  setSprint(source: string, pressed: boolean) {
    if (pressed) this.sprintSources.add(source);
    else this.sprintSources.delete(source);
  }
  jump(): boolean {
    if (this.y !== 0 || this.verticalVelocity !== 0) return false;
    this.verticalVelocity = JUMP_SPEED;
    return true;
  }
  stop() {
    this.held.clear();
    this.sprintSources.clear();
    this.y = 0;
    this.verticalVelocity = 0;
  }
  place(stationId?: string) {
    this.stop();
    const station = COURTYARD.stations.find((item) => item.id === stationId);
    this.heading = station ? station.yaw + Math.PI : Math.PI / 4;
    this.x = station ? station.x + Math.sin(station.yaw) * 2.7 : COURTYARD.entrance[0];
    this.z = station ? station.z + Math.cos(station.yaw) * 2.7 : COURTYARD.entrance[1];
  }
  placeRoom(room: RoomId) {
    this.place();
    const quadrant = COURTYARD.quadrants.find((item) => item.room === room);
    if (quadrant) {
      [this.x, this.z] = quadrant.spawn;
      this.heading = typeof quadrant.heading === 'number' ? quadrant.heading : Math.atan2(this.x, this.z);
    }
  }
  getRoom(): RoomId {
    if (this.x >= 0) return this.z >= 0 ? 'developer' : 'piano';
    return this.z >= 0 ? 'ai' : 'blog';
  }
  update(deltaMs: number, viewHeading = Math.PI / 4): boolean {
    if (!Number.isFinite(deltaMs) || !Number.isFinite(viewHeading)) return false;
    const delta = Math.min(Math.max(deltaMs, 0), 50) / 1000;
    if (!delta) return false;
    const beforeX = this.x, beforeZ = this.z;
    const airborne = this.y > 0 || this.verticalVelocity > 0;
    if (airborne) {
      // Integrate constant gravity exactly so jump height is independent of FPS.
      this.y = Math.max(0, this.y + this.verticalVelocity * delta - GRAVITY * delta * delta / 2);
      this.verticalVelocity = this.y > 0 ? this.verticalVelocity - GRAVITY * delta : 0;
    }
    const directions = new Set(this.held.values());
    const horizontal = Number(directions.has('right')) - Number(directions.has('left'));
    const vertical = Number(directions.has('up')) - Number(directions.has('down'));
    const length = Math.hypot(horizontal, vertical);
    if (!length) return airborne;
    const step = delta * (this.sprinting ? SPRINT_SPEED : WALK_SPEED) / length;
    // Forward=(sin h,cos h); camera-right=(-cos h,sin h). Pitch never
    // changes horizontal speed; jumping keeps the same obstacle collisions.
    const dx = (Math.sin(viewHeading) * vertical - Math.cos(viewHeading) * horizontal) * step;
    const dz = (Math.cos(viewHeading) * vertical + Math.sin(viewHeading) * horizontal) * step;
    // Small collision steps keep fast, grazing approaches from skipping an
    // obstacle. Resolve axes separately to retain sliding along walls.
    const steps = Math.ceil(Math.hypot(dx, dz) / MAX_HORIZONTAL_STEP);
    for (let index = 0; index < steps; index++) {
      const x = this.x + dx / steps;
      if (this.canStand(x, this.z)) this.x = x;
      const z = this.z + dz / steps;
      if (this.canStand(this.x, z)) this.z = z;
    }
    const moved = Math.hypot(this.x - beforeX, this.z - beforeZ) > 0.00001;
    if (moved) this.heading = Math.atan2(dx, dz);
    return moved || airborne;
  }
  nearest(currentId: string | null = null): string | null {
    // Keep the same screen available while walking around its reading radius.
    const current = COURTYARD.stations.find((station) => station.id === currentId);
    if (current && Math.hypot(this.x - current.x, this.z - current.z) <= 3.8 + 1e-9) return current.id;
    let closest: string | null = null, distance = 3.4 + 1e-9;
    for (const station of COURTYARD.stations) {
      const candidate = Math.hypot(this.x - station.x, this.z - station.z);
      if (candidate <= distance) { closest = station.id; distance = candidate; }
    }
    return closest;
  }
  private canStand(x: number, z: number) {
    const houseRadius = COURTYARD.houseHalfSize + ROBOT_RADIUS;
    if (Math.abs(x) < houseRadius && Math.abs(z) < houseRadius) return false;
    const obstacles = COURTYARD.obstacles as { x: number; z: number; radius: number }[];
    if (obstacles.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + ROBOT_RADIUS)) return false;
    return COURTYARD.stations.every((station) => Math.hypot(x - station.x, z - station.z) >= STATION_RADIUS);
  }
}
