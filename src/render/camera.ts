import * as THREE from 'three';
import type { World } from '../sim/world.ts';
import { carrier, dirOf, OFF_START, DEF_START } from '../sim/world.ts';
import { clamp, clamp01, damp, lerp } from '../core/math.ts';
import { FIELD_HALF_WIDTH } from '../core/constants.ts';

export type CamMode = 'BROADCAST' | 'DEEP' | 'BREAKAWAY' | 'KICK' | 'CELEBRATE' | 'MENU' | 'REPLAY';

export interface CameraOptions {
  shake: number;      // 0..1 user preference
  reducedMotion: boolean;
}

/**
 * Arcade broadcast camera. Playability first:
 *  - starts behind the offense, looking the way they attack
 *  - always frames the ball, the line of scrimmage and the first-down marker
 *  - widens on deep throws, tightens on breakaways
 *  - never rolls, never flips orientation mid-play (local multiplayer stability)
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'BROADCAST';
  private posX = 0; private posY = 14; private posZ = -20;
  private lookX = 0; private lookY = 1.4; private lookZ = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  private fov = 52;
  private targetFov = 52;
  private opts: CameraOptions;
  private lastDir = 1;

  constructor(aspect: number, opts: CameraOptions) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.4, 620);
    this.opts = opts;
    this.camera.position.set(0, 14, -20);
  }

  setOptions(o: Partial<CameraOptions>): void { Object.assign(this.opts, o); }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  impulse(power: number): void {
    if (this.opts.reducedMotion) return;
    this.shakeAmp = Math.min(1.2, this.shakeAmp + power * this.opts.shake);
  }

  snapTo(x: number, z: number, dir: number): void {
    this.lastDir = dir;
    this.posX = x * 0.4; this.posZ = z - dir * 21; this.posY = 13.5;
    this.lookX = x; this.lookZ = z + dir * 8;
    this.apply(0);
  }

  /** Menu / attract camera orbiting the stadium. */
  menuOrbit(t: number): void {
    this.mode = 'MENU';
    const r = 62;
    this.posX = Math.sin(t * 0.09) * r;
    this.posZ = 50 + Math.cos(t * 0.09) * r;
    this.posY = 22 + Math.sin(t * 0.13) * 5;
    this.lookX = 0; this.lookY = 2; this.lookZ = 50;
    this.camera.position.set(this.posX, this.posY, this.posZ);
    this.camera.lookAt(this.lookX, this.lookY, this.lookZ);
    this.camera.fov = 46; this.camera.updateProjectionMatrix();
  }

  update(w: World, dt: number, celebrating: boolean): void {
    const dir = dirOf(w.possession);
    this.lastDir = dir;
    const b = w.ball;
    const car = carrier(w);

    // Focus point: ball, biased toward the carrier and the action ahead of it.
    let fx = b.x, fz = b.z;
    if (car) { fx = car.x; fz = car.z; }

    // Spread of relevant athletes decides framing width.
    let minZ = fz, maxZ = fz, spreadX = 0;
    for (const a of w.athletes) {
      if (a.move === 'DOWN' && Math.abs(a.z - fz) > 22) continue;
      minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, a.z);
      spreadX = Math.max(spreadX, Math.abs(a.x - fx));
    }
    const spreadZ = clamp(maxZ - minZ, 12, 46);

    let mode: CamMode = 'BROADCAST';
    const st = b.state;
    if (celebrating) mode = 'CELEBRATE';
    else if (st.kind === 'kicked') mode = 'KICK';
    else if (st.kind === 'inAir' && st.passKind !== 'LATERAL') mode = 'DEEP';
    else if (car) {
      let nearest = 99;
      for (const a of w.athletes) {
        if (a.side === car.side || a.move === 'DOWN') continue;
        nearest = Math.min(nearest, Math.hypot(a.x - car.x, a.z - car.z));
      }
      if (nearest > 7.5 && Math.hypot(car.vx, car.vz) > 8) mode = 'BREAKAWAY';
    }
    this.mode = mode;

    let dist = 21, height = 13.5, ahead = 9, fov = 52;
    switch (mode) {
      case 'DEEP': {
        const target = st.kind === 'inAir' ? st.tz : fz;
        fz = lerp(fz, target, 0.42);
        dist = 26 + spreadZ * 0.30; height = 17.5; ahead = 13; fov = 58;
        break;
      }
      case 'BREAKAWAY': dist = 17.5; height = 10.5; ahead = 11; fov = 50; break;
      case 'KICK': dist = 27; height = 19; ahead = 16; fov = 60; break;
      case 'CELEBRATE': dist = 13; height = 7.5; ahead = 2; fov = 46; break;
      default:
        dist = 20 + spreadZ * 0.24 + spreadX * 0.10;
        height = 12.4 + spreadZ * 0.10;
        ahead = 8 + spreadZ * 0.12;
        fov = 50 + clamp01(spreadZ / 46) * 6;
        break;
    }

    // Keep the LOS and first-down marker visible during pre-snap.
    if (w.playPhase === 'PRESNAP' || w.playPhase === 'SETUP') {
      fz = w.losZ + dir * 3.5;
      dist = 23; height = 14.5; ahead = 12; fov = 54;
    }

    const wantX = clamp(fx * 0.55, -FIELD_HALF_WIDTH * 0.6, FIELD_HALF_WIDTH * 0.6);
    const wantZ = clamp(fz - dir * dist, -32, 132);
    const wantY = height;

    const lambda = this.opts.reducedMotion ? 5.5 : 7.5;
    this.posX = damp(this.posX, wantX, lambda * 0.8, dt);
    this.posY = damp(this.posY, wantY, lambda, dt);
    this.posZ = damp(this.posZ, wantZ, lambda, dt);
    this.lookX = damp(this.lookX, fx * 0.82, lambda, dt);
    this.lookY = damp(this.lookY, 1.5, lambda, dt);
    this.lookZ = damp(this.lookZ, fz + dir * ahead, lambda, dt);
    this.targetFov = fov;
    this.fov = damp(this.fov, this.targetFov, 6, dt);

    this.apply(dt);
  }

  private apply(dt: number): void {
    let sx = 0, sy = 0;
    if (this.shakeAmp > 0.001) {
      this.shakeT += dt * 46;
      sx = Math.sin(this.shakeT * 1.7) * this.shakeAmp * 0.55;
      sy = Math.cos(this.shakeT * 2.3) * this.shakeAmp * 0.42;
      this.shakeAmp *= Math.pow(0.0006, dt);
      if (this.shakeAmp < 0.002) this.shakeAmp = 0;
    }
    this.camera.position.set(this.posX + sx, this.posY + sy, this.posZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookX + sx * 0.4, this.lookY, this.lookZ);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Low, slow, slightly orbiting angle used for replay clips. */
  replayShot(x: number, z: number, dt: number): void {
    this.mode = 'REPLAY';
    this.replayT += dt;
    const ang = this.replayT * 0.55;
    const r = 17;
    this.posX = damp(this.posX, x + Math.sin(ang) * r, 5, dt);
    this.posZ = damp(this.posZ, z + Math.cos(ang) * r * this.lastDir, 5, dt);
    this.posY = damp(this.posY, 6.5, 5, dt);
    this.lookX = damp(this.lookX, x, 7, dt);
    this.lookY = damp(this.lookY, 1.6, 7, dt);
    this.lookZ = damp(this.lookZ, z, 7, dt);
    this.fov = damp(this.fov, 44, 6, dt);
    this.apply(dt);
  }

  resetReplay(): void { this.replayT = 0; }
  private replayT = 0;

  get focusX(): number { return this.lookX; }
  get focusZ(): number { return this.lookZ; }
}

export { clamp01 };
