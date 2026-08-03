import * as THREE from 'three';
import type {
  AnimState, Conditions, GameEvent, MatchState, StadiumDef, TeamDef, TeamSide,
} from '../core/types.ts';
import { carryArm } from '../sim/ball.ts';
import { SceneRegistry, coarseDisplay, devicePreset, type QualitySettings, type QualityTier } from './registry.ts';
import { buildAthleteRig, rimUniforms, type AthleteRig } from './athleteRig.ts';
import {
  poseAthlete, capturePose, blendPose, fadeTimeFor, samePoseFamily, POSE_FLOATS,
  type AnimSample,
} from './athletePose.ts';
import { GameCamera } from './camera.ts';
import { PostFX, defaultGrade, type Grade } from './post.ts';
import { Effects } from './effects.ts';
import { buildBall, buildMarkers, makeNumberSprite, type Markers } from './props.ts';
import { resolveKits } from './kits.ts';
import { buildEnvironment, type Environment } from './env/index.ts';
import type { ReplayView } from './replay.ts';
import type { World } from '../sim/world.ts';
import { carrier, dirOf } from '../sim/world.ts';
import { strideLengthFor } from '../sim/movement.ts';
import { clamp, clamp01, lerp, angLerp, angDelta, damp, smoothstep } from '../core/math.ts';
import { FIXED_DT } from '../core/constants.ts';

export interface RendererOptions {
  quality: QualityTier;
  shake: number;
  reducedMotion: boolean;
  flash: number;
  resolutionScale: number;
  /** Camera pull-in, 0..1. See `CameraOptions.dolly`; a phone runs `PHONE_DOLLY`. */
  dolly: number;
}

const sample: AnimSample = {
  state: 'IDLE', phase: 0, speed01: 0, lean: 0, fire: 0, t: 0, stride: 3, drift: 0,
  carry: 0, gaze: 0, gazePitch: 0, turn: 0,
};

/** Per-athlete presentation state: pose cross-fade, smoothed yaw, body lean and bank. */
interface RigMotion {
  fadeFrom: Float32Array;
  fadeT: number;
  fadeDur: number;      // 0 = not fading
  yaw: number;
  /** Last frame's `yaw`, so the head and hands can lag a body that is turning. */
  prevYaw: number;
  turn: number;
  bank: number;
  visible: boolean;     // was it drawn last frame? if not, snap instead of easing
  /** side*1000 + jersey. A slot can change hands between plays; that is a different body. */
  rigKey: number;
}
function makeMotion(): RigMotion {
  return {
    fadeFrom: new Float32Array(POSE_FLOATS), fadeT: 0, fadeDur: 0,
    yaw: 0, prevYaw: 0, turn: 0, bank: 0, visible: false, rigKey: -1,
  };
}

/** Body yaw chases the simulation heading; 26 is roughly a 40 ms tail. */
/** Scratch for projectToScreen. Called a few times per frame; allocating a Vector3 each time isn't. */
const PROJ = new THREE.Vector3();
const HAND = new THREE.Vector3();
const ELBOW = new THREE.Vector3();

const YAW_LAMBDA = 26;
/** Beyond this the heading changed because the athlete was moved, not because he turned. */
const YAW_SNAP = 1.2;
const BANK_PER_ACCEL = 0.0055;
const BANK_MAX = 0.26;
const LEAN_PER_ACCEL = 0.0040;

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  /** True while the GL context is lost — the one moment drawing is forbidden. */
  get contextLost(): boolean {
    try { return this.renderer.getContext().isContextLost(); } catch { return false; }
  }
  readonly scene: THREE.Scene;
  readonly registry: SceneRegistry;
  readonly gameCamera: GameCamera;
  quality: QualitySettings;
  effects!: Effects;
  private env: Environment | null = null;
  private ball!: THREE.Mesh;
  private markers!: Markers;
  private rigs: Array<Map<number, AthleteRig>> = [new Map(), new Map()];
  private numberSprites: THREE.Sprite[] = [];
  private opts: RendererOptions;
  private animT: number[] = new Array(14).fill(0);
  private lastAnimState: string[] = new Array(14).fill('');
  private motion: RigMotion[] = Array.from({ length: 14 }, makeMotion);
  private flashOverlay: HTMLDivElement | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private post: PostFX | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.opts = opts;
    this.quality = devicePreset(opts.quality);
    // MSAA is resolved per tile on every mobile GPU, where it is close to free; the machines
    // it genuinely costs on are weak desktop GPUs, which keep the LOW exemption.
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality.tier !== 'LOW' || coarseDisplay(),
      powerPreference: 'high-performance',
      alpha: false, stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatioFor(opts.resolutionScale));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.scene = new THREE.Scene();
    this.registry = new SceneRegistry(this.scene);
    this.gameCamera = new GameCamera(16 / 9,
      { shake: opts.shake, reducedMotion: opts.reducedMotion, dolly: opts.dolly });
    if (this.quality.postProcessing) this.post = new PostFX(this.renderer, this.quality);
    this.applyToneMapping();
    this.resize();
  }

  /**
   * The preset ratios are tuned against desktop monitors, where a CSS pixel is close to a
   * device pixel. A phone packs two or three device pixels into every CSS pixel of a viewport
   * a third the size, so the ratio that reads "budget" on a desktop reads "smeared" there —
   * LOW's 1.0 was an 844×390 buffer stretched across the entire display, and it is most of why
   * the phone build looked rough. Floor at near-native density on coarse-pointer devices: even
   * the floored buffer is well under half the pixels of desktop LOW at 1080p, and the adaptive
   * governor's 0.6 multiplier lands almost exactly back on the old fill cost, so the worst
   * case on a weak phone is the look every phone used to get.
   */
  private pixelRatioFor(scale: number): number {
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const floor = coarseDisplay() ? Math.min(dpr, 1.75) : 0;
    return Math.min(Math.max(this.quality.pixelRatio, floor) * scale, 2);
  }

  setQuality(tier: QualityTier, resolutionScale = 1): void {
    this.quality = devicePreset(tier);
    this.opts.quality = tier;
    this.opts.resolutionScale = resolutionScale;
    this.renderer.setPixelRatio(this.pixelRatioFor(resolutionScale));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    if (this.quality.postProcessing) {
      if (!this.post) this.post = new PostFX(this.renderer, this.quality);
      else this.post.setQuality(this.quality);
      this.post.setGrade(this.grade);
    } else if (this.post) {
      this.post.dispose();
      this.post = null;
    }
    this.applyToneMapping();
  }

  /**
   * Tone mapping belongs to whoever writes the final pixel. With the post chain on, that is the
   * composite pass; leaving it on the renderer as well would apply the curve twice and crush
   * every highlight the bloom is supposed to be picking up.
   */
  private applyToneMapping(): void {
    if (this.post) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.06;
    }
  }

  /** Change only the resolution multiplier. Used by the adaptive-resolution governor. */
  setResolutionScale(scale: number): void {
    if (Math.abs(scale - this.opts.resolutionScale) < 0.001) return;
    this.opts.resolutionScale = scale;
    this.renderer.setPixelRatio(this.pixelRatioFor(scale));
  }

  get resolutionScale(): number { return this.opts.resolutionScale; }

  setCameraOptions(shake: number, reducedMotion: boolean): void {
    this.opts.shake = shake; this.opts.reducedMotion = reducedMotion;
    this.gameCamera.setOptions({ shake, reducedMotion });
  }

  resize(): void {
    const el = this.renderer.domElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.gameCamera.resize(w / Math.max(1, h));
    this.post?.resize();
  }

  /**
   * Where a world point currently sits on the canvas, in CSS pixels.
   *
   * Touch play needs receiver badges drawn on the receivers rather than in a fixed row of
   * buttons, and "where is this athlete on screen" is a camera question, not a UI one — the UI
   * has no business reaching into a projection matrix. `behind` is true when the point is
   * outside the frustum in depth, which the caller wants for hiding a badge rather than
   * pinning it to an edge at a mirrored position.
   */
  projectToScreen(x: number, y: number, z: number, out = { x: 0, y: 0, behind: false }): typeof out {
    // `project` reads the camera's world matrix, and `lookAt` does not write one — three only
    // refreshes it inside `render`. So this used to answer with wherever the camera was pointing
    // the last time a frame was drawn, which is fine while the shot is steady and wrong the moment
    // it is not: on a kick return the camera swings a hundred and eighty degrees, and every
    // receiver badge went to the mirrored point on the far side of the screen or vanished as
    // "behind the camera". Refreshing here costs one matrix inverse a few times a frame.
    this.gameCamera.camera.updateMatrixWorld();
    PROJ.set(x, y, z).project(this.gameCamera.camera);
    const el = this.renderer.domElement;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    out.x = (PROJ.x * 0.5 + 0.5) * w;
    out.y = (-PROJ.y * 0.5 + 0.5) * h;
    out.behind = PROJ.z > 1;
    return out;
  }

  /** Build (or rebuild) the world for a match. */
  /** What the current scene was built for. Same key on the next load = reset, not rebuild. */
  private loadedKey = '';
  /** Teardown owed but postponed: an immediate retry cancels it; entering a menu performs it. */
  private unloadDeferred = false;

  /**
   * The match is over but its scene may be wanted again in a second (ONE MORE DRIVE). Owe the
   * teardown instead of paying it: the next same-key loadMatch cancels the debt and reuses
   * everything; the first menu frame settles it for real.
   */
  deferUnload(): void { this.unloadDeferred = true; }

  loadMatch(home: TeamDef, away: TeamDef, stadium: StadiumDef, conditions: Conditions): void {
    // Same matchup, same venue, same weather, same quality: every expensive resource — the
    // environment and its PMREM capture, fourteen athlete rigs, ball, markers, effects pools —
    // is still exactly right. Reset the dynamic state and skip the rebuild; this is what makes
    // ONE MORE DRIVE feel instant instead of re-running venue construction and shader warmup.
    const key = `${home.id}|${away.id}|${stadium.id}|${conditions.weather}|${JSON.stringify(this.quality)}`;
    if (this.loadedKey === key && this.env) { this.unloadDeferred = false; this.resetMatchScene(); return; }
    this.unloadMatch();
    this.loadedKey = key;
    this.env = buildEnvironment(this.registry, { home, away, stadium, conditions, quality: this.quality });
    // Capture the finished venue into an environment map BEFORE any athlete exists, so the
    // reflections in a helmet are the sky, the stands and the turf — and not fourteen other
    // helmets. Physically-shaded materials get their whole ambient response from this.
    this.buildEnvMap();
    // The image-based light is a fill, not a second key: at full strength it flattens the hard
    // key the whole look is built on.
    this.scene.environmentIntensity = 0.55;
    // The edge light that keeps bodies off the turf takes its colour from the venue.
    const pal = this.env.palette;
    rimUniforms.uRimColor.value.copy(pal.rimColor);
    rimUniforms.uRimGain.value = clamp(pal.rimIntensity * 0.42 + 0.16, 0.12, 0.72);
    this.gradeForVenue(pal, conditions);
    this.effects = new Effects(this.registry, this.quality);
    this.ball = buildBall(this.registry);
    this.markers = buildMarkers(this.registry, [home.colors, away.colors], this.quality);

    const kits = resolveKits(home, away);
    const group = this.registry.group('athletes');
    for (const side of [0, 1] as TeamSide[]) {
      const team = side === 0 ? home : away;
      const colors = side === 0 ? kits.home : kits.away;
      for (const p of team.roster) {
        const rig = buildAthleteRig(this.registry, p, colors, this.quality, side === 1);
        // Yaw first, then bank in the yawed frame, so leaning into a cut tips the body
        // sideways rather than rolling it about the world axis.
        rig.root.rotation.order = 'YXZ';
        rig.root.visible = false;
        group.add(rig.root);
        this.rigs[side].set(p.number, rig);
      }
    }
    const seatColors = ['#3fd0ff', '#ff5a4a', '#ffd23f', '#78ff8a'];
    for (let i = 0; i < 4; i++) {
      const sp = makeNumberSprite(this.registry, String(i + 1), seatColors[i], '#0a0d14');
      sp.visible = false;
      this.registry.group('markers').add(sp);
      this.numberSprites.push(sp);
    }
    for (const m of this.motion) { m.visible = false; m.fadeDur = 0; m.bank = 0; m.rigKey = -1; }
    for (let i = 0; i < this.lastAnimState.length; i++) { this.lastAnimState[i] = ''; this.animT[i] = 0; }
    this.prewarm();
  }

  /** Same-configuration retry: hide and neutralize everything dynamic, dispose nothing. */
  private resetMatchScene(): void {
    for (const m of this.rigs) for (const r of m.values()) r.root.visible = false;
    for (const sp of this.numberSprites) sp.visible = false;
    for (const m of this.motion) { m.visible = false; m.fadeDur = 0; m.bank = 0; m.rigKey = -1; }
    for (let i = 0; i < this.lastAnimState.length; i++) { this.lastAnimState[i] = ''; this.animT[i] = 0; }
  }

  /**
   * Each venue grades differently. A floodlit night game wants deeper corners, hotter bloom and
   * a cool cast; a bright afternoon wants the opposite. Snow lifts the blacks because a field
   * full of it genuinely does bounce light back into the shadows.
   */
  private gradeForVenue(pal: { emissiveGain: number; fog: THREE.Color; ambient: number }, cond: Conditions): void {
    const night = clamp01((pal.emissiveGain - 0.6) / 1.4);
    const g = defaultGrade();
    g.bloom = lerp(0.30, 0.72, night);
    g.threshold = lerp(0.95, 0.70, night);
    g.vignette = lerp(0.32, 0.58, night);
    g.contrast = lerp(1.06, 1.13, night);
    g.saturation = lerp(1.14, 1.07, night);
    g.exposure = lerp(1.02, 1.12, night);
    if (cond.weather === 'SNOW') {
      g.lift.setRGB(0.020, 0.024, 0.034);
      g.gain.setRGB(0.98, 1.0, 1.04);
      g.saturation *= 0.88;
    } else if (cond.weather === 'RAIN') {
      g.lift.setRGB(0.010, 0.014, 0.022);
      g.gain.setRGB(0.96, 1.0, 1.05);
      g.contrast += 0.03;
    } else if (cond.weather === 'WIND') {
      g.gain.setRGB(1.03, 1.0, 0.96);
    }
    this.grade = g;
    this.post?.setGrade(g);
  }

  /**
   * Pre-filtered radiance from the venue itself. One render at match load; nothing per frame.
   * Without it every metallic and glossy surface has nothing to reflect and reads as plastic.
   */
  private buildEnvMap(): void {
    this.envRT?.dispose();
    this.envRT = null;
    this.scene.environment = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    try {
      pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pmrem.fromScene(this.scene, 0.03, 1, 600);
      this.scene.environment = this.envRT.texture;
    } catch {
      // A driver that refuses the float target is not a reason to lose the match; standard
      // materials fall back to the analytic lights alone.
      this.envRT = null;
      this.scene.environment = null;
    } finally {
      pmrem?.dispose();
    }
  }

  /**
   * Compile every material the match will use before the first frame of it is shown.
   * Without this the first snap stalls for a few hundred milliseconds while the driver links
   * the athlete, crowd and turf programs — the single worst hitch in a session.
   */
  private prewarm(): void {
    const hidden: AthleteRig[] = [];
    for (const m of this.rigs) for (const r of m.values()) { if (!r.root.visible) { r.root.visible = true; hidden.push(r); } }
    try {
      this.renderer.compile(this.scene, this.gameCamera.camera);
    } catch { /* compile is best-effort; a failure here must not stop the match */ }
    for (const r of hidden) r.root.visible = false;
  }

  unloadMatch(): void {
    this.loadedKey = '';
    this.unloadDeferred = false;
    this.scene.environment = null;
    this.envRT?.dispose();
    this.envRT = null;
    for (const m of this.motion) { m.visible = false; m.fadeDur = 0; m.rigKey = -1; }
    for (const m of this.rigs) { for (const r of m.values()) r.dispose(); m.clear(); }
    this.numberSprites.length = 0;
    if (this.env) { this.env.dispose(); this.env = null; }
    // Dispose the owners first, then the groups they registered into, so nothing is orphaned.
    this.effects?.dispose();
    this.markers?.dispose();
    this.registry.clearGroup('athletes');
    this.registry.clearGroup('markers');
    this.registry.clearGroup('effects');
    this.registry.clearGroup('ball');
  }

  handleEvent(e: GameEvent): void {
    if (!this.effects) return;
    switch (e.type) {
      case 'camera.impulse':
        this.gameCamera.impulse(e.power);
        this.post?.impulse(e.power);
        this.effects.burst(e.at.x, 0.2, e.at.z, clamp01(e.power), 'TURF');
        this.effects.ring(e.at.x, 0, e.at.z, 2 + e.power * 2.4, 0xfff0b0);
        break;
      case 'bigHit':
        this.flash(0.35);
        break;
      case 'touchdown':
        this.flash(0.5);
        break;
      case 'overdrive.start':
        this.flash(0.4);
        break;
      default: break;
    }
  }

  attachFlashLayer(el: HTMLDivElement): void { this.flashOverlay = el; }

  private flash(power: number): void {
    if (!this.flashOverlay || this.opts.flash <= 0.01) return;
    const p = clamp01(power * this.opts.flash);
    this.flashOverlay.style.opacity = String(p);
    this.flashOverlay.style.transition = 'none';
    requestAnimationFrame(() => {
      if (!this.flashOverlay) return;
      this.flashOverlay.style.transition = 'opacity 220ms ease-out';
      this.flashOverlay.style.opacity = '0';
    });
  }

  /** Push simulation state into the scene. `alpha` interpolates between prev and current ticks. */
  sync(world: World, match: MatchState, alpha: number, dt: number, celebrating: boolean): void {
    if (this.disposed) return;
    const shown = new Set<AthleteRig>();

    for (let i = 0; i < world.athletes.length; i++) {
      const a = world.athletes[i];
      const rig = this.rigs[a.side].get(a.def.number);
      if (!rig) continue;
      shown.add(rig);
      rig.root.visible = true;
      const mo = this.motion[i];
      const key = a.side * 1000 + a.def.number;
      if (mo.rigKey !== key) { mo.rigKey = key; mo.visible = false; mo.fadeDur = 0; }
      const x = lerp(a.prevX, a.x, alpha);
      const y = lerp(a.prevY, a.y, alpha);
      const z = lerp(a.prevZ, a.z, alpha);
      rig.root.position.set(x, y, z);

      // Yaw is interpolated between ticks and then eased, because the simulation heading can
      // still step when an athlete is shoved. A large step is a reposition, not a turn, so it
      // snaps rather than sweeping the body round the long way.
      const yawTarget = angLerp(a.prevFacing, a.facing, alpha);
      if (!mo.visible || Math.abs(angDelta(mo.yaw, yawTarget)) > YAW_SNAP) mo.yaw = yawTarget;
      else mo.yaw += angDelta(mo.yaw, yawTarget) * (1 - Math.exp(-YAW_LAMBDA * dt));

      // Turn rate of the DRAWN body, smoothed: a raw per-frame delta is noise at 120 Hz and a
      // step at 30, and this drives a visible lag on the head.
      const rate = dt > 1e-4 ? angDelta(mo.yaw, mo.prevYaw) / dt : 0;
      mo.turn = mo.visible ? damp(mo.turn, rate, 14, dt) : 0;
      mo.prevYaw = mo.yaw;

      const bankTarget = clamp(-a.anim.accelLat * BANK_PER_ACCEL, -BANK_MAX, BANK_MAX);
      mo.bank = mo.visible ? damp(mo.bank, bankTarget, 11, dt) : bankTarget;
      rig.root.rotation.set(0, mo.yaw, mo.bank);
      mo.visible = true;

      const st = a.anim.state;
      if (this.lastAnimState[i] !== st) {
        // Snapshot the pose being left BEFORE the new one overwrites the bones — unless the two
        // states are the same cycle at different amplitudes, which is only a stutter to blend.
        if (!samePoseFamily(this.lastAnimState[i] as AnimState, st)) {
          capturePose(rig, mo.fadeFrom);
          mo.fadeT = 0;
          mo.fadeDur = fadeTimeFor(st);
          this.animT[i] = 0;
        }
        this.lastAnimState[i] = st;
      }
      this.animT[i] += dt;

      // The stride phase advances once per simulation tick; interpolating it stops the legs
      // stepping at 60 Hz on a 120 Hz display.
      let dp = a.anim.phase - a.anim.prevPhase;
      if (dp < -0.5) dp += 1; else if (dp > 0.5) dp -= 1;
      sample.phase = (a.anim.prevPhase + dp * alpha + 1) % 1;
      sample.state = st;
      sample.speed01 = a.anim.speed01;
      sample.lean = clamp(a.anim.accelFwd * LEAN_PER_ACCEL, -0.16, 0.24);
      sample.stride = strideLengthFor(a.anim.ground);
      // Where he is going, minus where the BODY IS DRAWN pointing. Deliberately measured against
      // the smoothed render yaw rather than the simulation's `facing`: the two differ by design —
      // the rig eases into a turn so the body never snaps round — and the feet are attached to the
      // drawn body, not to the simulated heading. Using `facing` here leaves the yaw-easing lag as
      // slip, which `npm run footslip` reports separately and which is a third of the problem.
      const spd = Math.hypot(a.vx, a.vz);
      sample.drift = spd > 0.4 ? angDelta(mo.yaw, Math.atan2(a.vx, a.vz)) : 0;
      sample.fire = a.onFire ? 1 : 0;
      sample.t = this.animT[i];
      sample.carry = a.hasBall ? carryArm(a) : 0;
      sample.turn = mo.turn;

      // Eyes on the ball. A live ball is the only thing on the field worth watching, and when
      // somebody has it, everyone else watches HIM. The renderer already knows every position
      // this needs; the athletes were simply never told to look.
      const bst = world.ball.state;
      let gx = 0, gy = 0, gz = 0, look = false;
      if (bst.kind === 'inAir' || bst.kind === 'kicked' || bst.kind === 'loose') {
        gx = world.ball.x; gy = world.ball.y; gz = world.ball.z; look = true;
      } else if (bst.kind === 'held' && bst.carrier !== a.id) {
        const c = world.athletes[bst.carrier];
        gx = c.x; gy = 1.35 + c.y; gz = c.z; look = true;
      }
      if (look) {
        const dist = Math.hypot(gx - a.x, gz - a.z);
        sample.gaze = dist > 0.6 ? angDelta(mo.yaw, Math.atan2(gx - a.x, gz - a.z)) : 0;
        sample.gazePitch = -Math.atan2(gy - (1.45 + a.y), Math.max(1.0, dist));
      } else {
        sample.gaze = 0; sample.gazePitch = 0;
      }
      poseAthlete(rig, sample);

      if (mo.fadeDur > 0) {
        mo.fadeT += dt;
        const k = mo.fadeT / mo.fadeDur;
        if (k >= 1) mo.fadeDur = 0;
        else blendPose(rig, mo.fadeFrom, 1 - smoothstep(k));
      }
    }
    for (const side of [0, 1] as TeamSide[]) {
      for (const rig of this.rigs[side].values()) if (!shown.has(rig)) rig.root.visible = false;
    }

    // Ball
    const b = world.ball;
    const bx = lerp(b.prevX, b.x, alpha), by = lerp(b.prevY, b.y, alpha), bz = lerp(b.prevZ, b.z, alpha);
    this.ball.position.set(bx, by, bz);
    if (b.state.kind === 'held') {
      // In his HANDS, not at his navel.
      //
      // `syncHeldBall` parks the ball on the athlete's centreline at a fixed 1.15 because that is
      // the anchor catches, contact and fumbles are measured from — a physics position, and a
      // correct one. It was also the position it got DRAWN at, so in every frame of the game the
      // ball floated in front of somebody's belly touching nothing. The simulation is untouched
      // here; only the drawn ball moves, into the cradle the tuck pose makes between the wrist
      // and the elbow.
      const car = world.athletes[b.state.carrier];
      const rig = this.rigs[car.side].get(car.def.number);
      if (rig && rig.root.visible) this.tuckBall(rig, carryArm(car), this.motion[car.id].yaw);
    } else if (b.state.kind === 'inAir' || b.state.kind === 'kicked') {
      // Point the ball along the path it is actually travelling. A thrown ball is moved by
      // interpolating between two points rather than by integrating a velocity, so `b.v*` is
      // zero for the whole flight and the spiral used to hang at a fixed angle.
      const dx = (b.x - b.prevX) / FIXED_DT;
      const dy = (b.y - b.prevY) / FIXED_DT;
      const dz = (b.z - b.prevZ) / FIXED_DT;
      const flat = Math.hypot(dx, dz);
      this.ball.rotation.z += b.spin * dt * 0.35;
      if (flat > 0.5) {
        this.ball.rotation.x = Math.atan2(-dy, flat) * 0.5;
        this.ball.rotation.y = Math.atan2(dx, dz);
      }
    } else if (b.state.kind === 'loose') {
      this.ball.rotation.x += dt * 9; this.ball.rotation.z += dt * 6;
    }
    this.ball.visible = b.state.kind !== 'dead' || world.playPhase !== 'SETUP';

    this.syncMarkers(world, match, alpha);

    // Field markers + shadow focus.
    if (this.env) {
      const dir = dirOf(world.possession);
      this.env.field.setLos(world.losZ);
      this.env.field.setFirstDown(match.firstDownZ);
      this.env.field.setMarkersVisible(world.special === null);
      this.env.field.setGoalOcclusion(this.gameCamera.camera.position.z, this.gameCamera.focusZ, dt);
      this.env.lighting.focusOn(this.gameCamera.focusX, this.gameCamera.focusZ);
      this.env.update(dt, this.gameCamera.camera.position);
      void dir;
    }

    // Effects observe the world directly so they can react to cuts, foot-plants and turbo
    // without the renderer having to forward a dozen separate signals.
    this.effects.update(dt, world, alpha);
    this.gameCamera.update(world, dt, celebrating);
    this.lastDt = dt;
  }

  private syncMarkers(world: World, match: MatchState, alpha: number): void {
    const mk = this.markers;
    for (const r of mk.rings) r.visible = false;
    for (const s of this.numberSprites) s.visible = false;
    let seatIdx = 0;
    for (const a of world.athletes) {
      if (a.controlledBySeat < 0) continue;
      const ring = mk.rings[a.controlledBySeat];
      if (ring) {
        ring.visible = true;
        ring.position.set(lerp(a.prevX, a.x, alpha), 0.05, lerp(a.prevZ, a.z, alpha));
      }
      const sp = this.numberSprites[a.controlledBySeat];
      if (sp) {
        sp.visible = true;
        // Clear of the tallest crown in the league (2.12) plus a gap. Every height in this file
        // used to assume a seven-foot athlete; see PROP in athleteRig.ts.
        sp.position.set(lerp(a.prevX, a.x, alpha), 2.62 + a.y, lerp(a.prevZ, a.z, alpha));
      }
      seatIdx++;
    }
    void seatIdx;

    const car = carrier(world);
    if (car && world.playPhase === 'LIVE') {
      mk.carrierMark.visible = true;
      // Interpolated like the body it sits above; a marker stepping at 60 Hz over a body
      // moving at the display rate is more obvious than the body would have been on its own.
      mk.carrierMark.position.set(
        lerp(car.prevX, car.x, alpha),
        2.40 + lerp(car.prevY, car.y, alpha) + Math.sin((world.tick + alpha) * 0.14) * 0.08,
        lerp(car.prevZ, car.z, alpha),
      );
      (mk.carrierMark.material as THREE.MeshBasicMaterial).color.setHex(car.onFire ? 0xff7a2a : 0xffe14d);
    } else {
      mk.carrierMark.visible = false;
    }

    // Pass-target badges while the QB is looking.
    const showTargets = world.playPhase === 'LIVE' && !world.passThrown && car && car.id === world.qbId;
    for (let i = 0; i < 3; i++) {
      const id = world.passTargets[i];
      const sp = mk.targets[i];
      if (!showTargets || id < 0) { sp.visible = false; continue; }
      const r = world.athletes[id];
      sp.visible = true;
      sp.position.set(
        lerp(r.prevX, r.x, alpha), 2.58 + lerp(r.prevY, r.y, alpha), lerp(r.prevZ, r.z, alpha),
      );
    }

    const bs = world.ball.state;
    if (bs.kind === 'inAir' && bs.passKind !== 'LATERAL') {
      mk.reticle.visible = true;
      mk.reticle.position.set(bs.tx, 0.07, bs.tz);
      const u = clamp01(bs.t / bs.flightTime);
      mk.reticle.scale.setScalar(lerp(1.5, 0.75, u));
      (mk.reticle.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * u;
    } else {
      mk.reticle.visible = false;
    }
    void match;
  }

  /** Put the drawn ball in the cradle the tuck pose makes between that arm's wrist and elbow. */
  private tuckBall(rig: AthleteRig, arm: number, yaw: number): void {
    rig.root.updateMatrixWorld(true);
    HAND.setFromMatrixPosition((arm > 0 ? rig.bones.handR : rig.bones.handL).matrixWorld);
    ELBOW.setFromMatrixPosition((arm > 0 ? rig.bones.elbowR : rig.bones.elbowL).matrixWorld);
    this.ball.position.copy(ELBOW).lerp(HAND, 0.52);
    // …then pulled up and in against the ribs, which is the difference between carrying a ball
    // and holding one out for somebody to take.
    this.ball.position.x += Math.sin(yaw) * 0.02 - Math.cos(yaw) * arm * 0.11;
    this.ball.position.z += Math.cos(yaw) * 0.02 + Math.sin(yaw) * arm * 0.11;
    this.ball.position.y += 0.11;
    // Pointing along the forearm it is clamped against.
    HAND.sub(ELBOW);
    this.ball.rotation.set(
      Math.atan2(-HAND.y, Math.hypot(HAND.x, HAND.z)), Math.atan2(HAND.x, HAND.z), 0);
  }

  /** Pose everything from a recorded replay frame. Never touches simulation state. */
  syncReplay(view: ReplayView, dt: number): void {
    if (this.disposed || !this.effects) return;
    const shown = new Set<AthleteRig>();
    for (let i = 0; i < view.athletes.length; i++) {
      const a = view.athletes[i];
      const rig = this.rigs[a.side]?.get(a.jersey);
      if (!rig) continue;
      shown.add(rig);
      rig.root.visible = true;
      const mo = this.motion[i];
      const key = a.side * 1000 + a.jersey;
      if (mo.rigKey !== key) { mo.rigKey = key; mo.visible = false; mo.fadeDur = 0; }
      rig.root.position.set(a.x, a.y, a.z);
      if (!mo.visible || Math.abs(angDelta(mo.yaw, a.facing)) > YAW_SNAP) mo.yaw = a.facing;
      else mo.yaw += angDelta(mo.yaw, a.facing) * (1 - Math.exp(-YAW_LAMBDA * dt));
      rig.root.rotation.set(0, mo.yaw, 0);
      mo.visible = true;
      if (this.lastAnimState[i] !== a.state) {
        capturePose(rig, mo.fadeFrom);
        mo.fadeT = 0; mo.fadeDur = fadeTimeFor(a.state);
        this.animT[i] = 0;
        this.lastAnimState[i] = a.state;
      }
      sample.state = a.state;
      sample.phase = a.phase;
      sample.speed01 = 0.5;
      sample.lean = 0;
      sample.stride = 2.6;
      sample.drift = 0;             // replay frames carry no velocity; the stride runs true ahead
      sample.fire = 0;
      sample.turn = 0;
      sample.carry = a.carry;
      // Replays record the ball's position but not its state, which is all a gaze needs.
      const gd = Math.hypot(view.ball.x - a.x, view.ball.z - a.z);
      const mine = a.carry !== 0;
      sample.gaze = !mine && gd > 0.6 ? angDelta(mo.yaw, Math.atan2(view.ball.x - a.x, view.ball.z - a.z)) : 0;
      sample.gazePitch = mine ? 0 : -Math.atan2(view.ball.y - (1.45 + a.y), Math.max(1.0, gd));
      sample.t = this.animT[i] += dt;
      poseAthlete(rig, sample);
      if (mo.fadeDur > 0) {
        mo.fadeT += dt;
        const k = mo.fadeT / mo.fadeDur;
        if (k >= 1) mo.fadeDur = 0;
        else blendPose(rig, mo.fadeFrom, 1 - smoothstep(k));
      }
    }
    for (const side of [0, 1] as TeamSide[]) {
      for (const rig of this.rigs[side].values()) if (!shown.has(rig)) rig.root.visible = false;
    }
    this.ball.position.set(view.ball.x, view.ball.y, view.ball.z);
    const held = view.athletes.findIndex((a) => a.carry !== 0);
    if (held >= 0) {
      const a = view.athletes[held];
      const rig = this.rigs[a.side]?.get(a.jersey);
      if (rig && rig.root.visible) this.tuckBall(rig, a.carry, this.motion[held].yaw);
    }
    this.ball.visible = true;
    for (const r of this.markers.rings) r.visible = false;
    for (const sp of this.numberSprites) sp.visible = false;
    this.markers.carrierMark.visible = false;
    for (const t of this.markers.targets) t.visible = false;
    this.markers.reticle.visible = false;
    // Slow orbit around the action for the clip.
    this.gameCamera.replayShot(view.ball.x, view.ball.z, dt);
    this.env?.update(dt, this.gameCamera.camera.position);
    this.effects.update(dt);
  }

  setCrowdEnergy(v: number): void { this.env?.crowd.setExcitement(clamp01(v)); }
  crowdPop(power: number): void { this.env?.crowd.pop(power); }
  updateScoreboard(h: number, a: number, q: number, clock: string): void {
    this.env?.stadium.setScore(h, a, q, clock);
  }

  private grade: Grade = defaultGrade();
  private lastDt = 1 / 60;

  render(): void {
    if (this.disposed) return;
    if (this.post) this.post.render(this.scene, this.gameCamera.camera, this.lastDt);
    else this.renderer.render(this.scene, this.gameCamera.camera);
  }

  renderMenu(t: number): void {
    if (this.unloadDeferred) this.unloadMatch();
    this.gameCamera.menuOrbit(t);
    this.env?.crowd.setExcitement(0.35);
    this.render();
  }

  /**
   * Scene complexity, for the budget checks. With the post chain on, `renderer.info.render`
   * describes the last thing drawn — a single fullscreen triangle — so the figures come from the
   * snapshot the composite takes right after the scene pass instead.
   */
  info(): { calls: number; triangles: number; textures: number; geometries: number; postPasses: number } {
    const i = this.renderer.info;
    const post = this.post;
    return {
      calls: post ? post.sceneCalls : i.render.calls,
      triangles: post ? post.sceneTriangles : i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
      postPasses: post ? (this.quality.tier === 'LOW' ? 4 : 6) : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unloadMatch();
    this.effects?.dispose();
    this.markers?.dispose();
    this.post?.dispose();
    this.post = null;
    this.registry.dispose();
    this.renderer.dispose();
  }
}

export { FIXED_DT, clamp };
