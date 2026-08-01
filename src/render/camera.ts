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
  private shakeSeq = 0;
  private shakeDirX = 1;
  private shakeDirY = 0.6;
  private fov = 52;
  private targetFov = 52;
  private opts: CameraOptions;
  private lastDir = 1;

  // Framing parameters are damped in their own right. Damping only the final camera position
  // meant a mode change moved the target three or four yards in a single frame and the camera
  // lurched after it; easing the parameters makes the same change a second-order response.
  private curDist = 17;
  private curHeight = 10.2;
  private curAhead = 8;
  private curSpread = 20;
  private curLead = 0;
  /** Mode changes need a reason and a minimum dwell, or the camera oscillates. */
  private modeHold = 0;
  private primed = false;

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
    this.shakeAmp = Math.min(1.0, this.shakeAmp + power * this.opts.shake * 0.8);
    // Give each hit its own direction so repeated impacts do not all shake the same way.
    const a = (this.shakeSeq++) * 2.399963 + power * 7.1;
    this.shakeDirX = Math.sin(a);
    this.shakeDirY = Math.cos(a * 1.7) * 0.7;
  }

  snapTo(x: number, z: number, dir: number): void {
    this.lastDir = dir;
    this.posX = x * 0.4; this.posZ = z - dir * 17; this.posY = 10.2;
    this.lookX = x; this.lookZ = z + dir * 8;
    this.curDist = 17; this.curHeight = 10.2; this.curAhead = 8;
    this.curSpread = 20; this.curLead = 0; this.modeHold = 0; this.primed = false;
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
    // The raw spread jitters every frame as fourteen bodies move; feeding it straight into the
    // distance, height and field of view made all three shimmer.
    const rawSpread = clamp(maxZ - minZ, 12, 46);
    this.curSpread = this.primed ? damp(this.curSpread, rawSpread, 3.2, dt) : rawSpread;
    const spreadZ = this.curSpread;

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
      // Asymmetric thresholds: a runner has to be clearly away to earn the tight shot and has
      // to be clearly caught to lose it. One threshold meant a carrier running alongside a
      // defender toggled the camera several times a second.
      const speed = Math.hypot(car.vx, car.vz);
      const wasBreak = this.mode === 'BREAKAWAY';
      if (wasBreak ? (nearest > 6.0 && speed > 6.5) : (nearest > 8.5 && speed > 8.5)) mode = 'BREAKAWAY';
    }
    // Minimum dwell. Modes that frame a specific event (the ball in the air, a kick, a
    // celebration) are allowed to interrupt; the discretionary ones have to wait their turn.
    if (this.modeHold > 0) this.modeHold -= dt;
    if (mode !== this.mode) {
      const forced = mode === 'DEEP' || mode === 'KICK' || mode === 'CELEBRATE'
        || this.mode === 'DEEP' || this.mode === 'KICK' || this.mode === 'CELEBRATE';
      if (forced || this.modeHold <= 0) { this.mode = mode; this.modeHold = 0.4; }
    }
    mode = this.mode;

    // Arcade framing: close enough that athletes read as characters, wide enough to see the
    // route concept. Everything below is deliberately tighter than a broadcast camera.
    let dist = 17, height = 10.2, ahead = 8, fov = 50;
    switch (mode) {
      case 'DEEP': {
        const target = st.kind === 'inAir' ? st.tz : fz;
        fz = lerp(fz, target, 0.45);
        dist = 19 + spreadZ * 0.22; height = 12.5; ahead = 11; fov = 55;
        break;
      }
      case 'BREAKAWAY': dist = 13.5; height = 7.2; ahead = 10; fov = 48; break;
      case 'KICK': dist = 23; height = 15.5; ahead = 15; fov = 58; break;
      // Close enough to read faces and jerseys, far enough that the celebration is a group of
      // people rather than a wall of shoulder pads. `ahead` is zero because the scorer is the
      // subject: leading the shot past him, as every other mode does, puts him in a corner.
      case 'CELEBRATE': dist = 13.5; height = 7; ahead = 0; fov = 46; break;
      default:
        dist = 16 + spreadZ * 0.20 + spreadX * 0.08;
        height = 9.6 + spreadZ * 0.085;
        ahead = 7 + spreadZ * 0.11;
        fov = 48 + clamp01(spreadZ / 46) * 6;
        break;
    }

    // Keep the LOS and the first-down marker visible before the snap.
    if (w.playPhase === 'PRESNAP' || w.playPhase === 'SETUP') {
      fz = w.losZ + dir * 4.5;
      dist = 19.5; height = 11.6; ahead = 12; fov = 53;
    }

    // Look a little further up the field the faster the carrier is going, so the camera is
    // already showing the space he is running into rather than reporting it afterwards.
    let lead = 0;
    if (car && w.playPhase === 'LIVE') lead = clamp(car.vz * dir * 0.30, -2.5, 6);
    this.curLead = this.primed ? damp(this.curLead, lead, 3.6, dt) : lead;

    // Ease the framing parameters, then place the camera from the eased values.
    const pLambda = this.primed ? (this.opts.reducedMotion ? 3.4 : 4.6) : 1e6;
    this.curDist = damp(this.curDist, dist, pLambda, dt);
    this.curHeight = damp(this.curHeight, height, pLambda, dt);
    this.curAhead = damp(this.curAhead, ahead + this.curLead, pLambda, dt);

    // Sideways framing normally pulls toward the middle of the field so the whole play stays
    // readable. A celebration is about one person, so it tracks him properly instead.
    const xBias = mode === 'CELEBRATE' ? 0.95 : 0.55;
    const lookBias = mode === 'CELEBRATE' ? 1 : 0.82;
    const wantX = clamp(fx * xBias, -FIELD_HALF_WIDTH * 0.85, FIELD_HALF_WIDTH * 0.85);
    const wantZ = clamp(fz - dir * this.curDist, -32, 132);
    const wantY = this.curHeight;

    const lambda = this.opts.reducedMotion ? 5.5 : 7.5;
    this.posX = damp(this.posX, wantX, lambda * 0.8, dt);
    // Vertical movement is the most obvious axis when it bounces, so it trails a little.
    this.posY = damp(this.posY, wantY, lambda * 0.72, dt);
    this.posZ = damp(this.posZ, wantZ, lambda, dt);
    this.lookX = damp(this.lookX, fx * lookBias, lambda * 0.9, dt);
    this.lookY = damp(this.lookY, 1.5, lambda, dt);
    this.lookZ = damp(this.lookZ, fz + dir * this.curAhead, lambda * 0.9, dt);
    this.targetFov = fov;
    this.fov = damp(this.fov, this.targetFov, 4.5, dt);
    this.primed = true;

    this.apply(dt);
  }

  private apply(dt: number): void {
    let sx = 0, sy = 0;
    if (this.shakeAmp > 0.001) {
      // Two frequencies on a fixed direction, with a quadratic envelope and a linear decay.
      // The old shake was a 12 Hz sine — under two samples per cycle at 60 fps, so it aliased
      // into noise rather than reading as a shake — on a decay that halved every three frames.
      this.shakeT += dt;
      const env = this.shakeAmp * this.shakeAmp;
      const osc = Math.sin(this.shakeT * 55) * 0.62 + Math.sin(this.shakeT * 33 + 1.3) * 0.38;
      sx = this.shakeDirX * osc * env * 0.55;
      sy = this.shakeDirY * osc * env * 0.42;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 4);
      if (this.shakeAmp < 0.002) this.shakeAmp = 0;
    }
    this.camera.position.set(this.posX + sx, this.posY + sy, this.posZ);
    this.camera.up.set(0, 1, 0);
    // Translate the whole shot rather than swivelling it — swivelling makes the far stands
    // swim across the screen, which reads as a broken camera rather than as an impact.
    this.camera.lookAt(this.lookX + sx, this.lookY + sy, this.lookZ);
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
