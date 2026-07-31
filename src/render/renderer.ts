import * as THREE from 'three';
import type {
  Conditions, GameEvent, MatchState, StadiumDef, TeamDef, TeamSide,
} from '../core/types.ts';
import { SceneRegistry, QUALITY_PRESETS, type QualitySettings, type QualityTier } from './registry.ts';
import { buildAthleteRig, type AthleteRig } from './athleteRig.ts';
import { poseAthlete, type AnimSample } from './athletePose.ts';
import { GameCamera } from './camera.ts';
import { Effects } from './effects.ts';
import { buildBall, buildMarkers, makeNumberSprite, type Markers } from './props.ts';
import { resolveKits } from './kits.ts';
import { buildEnvironment, type Environment } from './env/index.ts';
import type { ReplayView } from './replay.ts';
import type { World } from '../sim/world.ts';
import { carrier, dirOf } from '../sim/world.ts';
import { clamp, clamp01, lerp, angLerp } from '../core/math.ts';
import { FIXED_DT } from '../core/constants.ts';

export interface RendererOptions {
  quality: QualityTier;
  shake: number;
  reducedMotion: boolean;
  flash: number;
  resolutionScale: number;
}

const sample: AnimSample = { state: 'IDLE', phase: 0, speed01: 0, lean: 0, fire: 0, t: 0 };

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
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
  private flashOverlay: HTMLDivElement | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.opts = opts;
    this.quality = { ...QUALITY_PRESETS[opts.quality] };
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality.tier !== 'LOW', powerPreference: 'high-performance',
      alpha: false, stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(this.quality.pixelRatio * opts.resolutionScale, 2));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.scene = new THREE.Scene();
    this.registry = new SceneRegistry(this.scene);
    this.gameCamera = new GameCamera(16 / 9, { shake: opts.shake, reducedMotion: opts.reducedMotion });
    this.resize();
  }

  setQuality(tier: QualityTier, resolutionScale = 1): void {
    this.quality = { ...QUALITY_PRESETS[tier] };
    this.opts.quality = tier;
    this.opts.resolutionScale = resolutionScale;
    this.renderer.setPixelRatio(Math.min(this.quality.pixelRatio * resolutionScale, 2));
    this.renderer.shadowMap.enabled = this.quality.shadows;
  }

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
  }

  /** Build (or rebuild) the world for a match. */
  loadMatch(home: TeamDef, away: TeamDef, stadium: StadiumDef, conditions: Conditions): void {
    this.unloadMatch();
    this.env = buildEnvironment(this.registry, { home, away, stadium, conditions, quality: this.quality });
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
  }

  unloadMatch(): void {
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
        this.effects.burst(e.at.x, 0.2, e.at.z, clamp01(e.power), 'TURF');
        if (e.power > 0.55) this.effects.ring(e.at.x, 0, e.at.z, 2 + e.power * 2.4, 0xfff0b0);
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
      const x = lerp(a.prevX, a.x, alpha);
      const y = lerp(a.prevY, a.y, alpha);
      const z = lerp(a.prevZ, a.z, alpha);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = angLerp(a.prevFacing, a.facing, alpha);

      const st = a.anim.state;
      if (this.lastAnimState[i] !== st) { this.animT[i] = 0; this.lastAnimState[i] = st; }
      this.animT[i] += dt;
      sample.state = st;
      sample.phase = a.anim.phase;
      sample.speed01 = clamp01(Math.hypot(a.vx, a.vz) / 13);
      sample.lean = 0;
      sample.fire = a.onFire ? 1 : 0;
      sample.t = this.animT[i];
      poseAthlete(rig, sample);
    }
    for (const side of [0, 1] as TeamSide[]) {
      for (const rig of this.rigs[side].values()) if (!shown.has(rig)) rig.root.visible = false;
    }

    // Ball
    const b = world.ball;
    const bx = lerp(b.prevX, b.x, alpha), by = lerp(b.prevY, b.y, alpha), bz = lerp(b.prevZ, b.z, alpha);
    this.ball.position.set(bx, by, bz);
    if (b.state.kind === 'inAir' || b.state.kind === 'kicked') {
      this.ball.rotation.z += b.spin * dt * 0.35;
      this.ball.rotation.x = Math.atan2(-b.vy, Math.hypot(b.vx, b.vz)) * 0.5;
      this.ball.rotation.y = Math.atan2(b.vx, b.vz);
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
      this.env.lighting.focusOn(this.gameCamera.focusX, this.gameCamera.focusZ);
      this.env.update(dt, this.gameCamera.camera.position);
      void dir;
    }

    this.effects.update(dt);
    this.gameCamera.update(world, dt, celebrating);
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
        sp.position.set(lerp(a.prevX, a.x, alpha), 3.05 + a.y, lerp(a.prevZ, a.z, alpha));
      }
      seatIdx++;
    }
    void seatIdx;

    const car = carrier(world);
    if (car && world.playPhase === 'LIVE') {
      mk.carrierMark.visible = true;
      mk.carrierMark.position.set(car.x, 2.75 + car.y + Math.sin(world.tick * 0.14) * 0.08, car.z);
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
      sp.position.set(r.x, 2.95 + r.y, r.z);
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
      rig.root.position.set(a.x, a.y, a.z);
      rig.root.rotation.y = a.facing;
      sample.state = a.state;
      sample.phase = a.phase;
      sample.speed01 = 0.5;
      sample.lean = 0;
      sample.fire = 0;
      sample.t = this.animT[i] += dt;
      poseAthlete(rig, sample);
    }
    for (const side of [0, 1] as TeamSide[]) {
      for (const rig of this.rigs[side].values()) if (!shown.has(rig)) rig.root.visible = false;
    }
    this.ball.position.set(view.ball.x, view.ball.y, view.ball.z);
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

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.gameCamera.camera);
  }

  renderMenu(t: number): void {
    this.gameCamera.menuOrbit(t);
    this.env?.crowd.setExcitement(0.35);
    this.render();
  }

  info(): { calls: number; triangles: number; textures: number; geometries: number } {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles,
      textures: i.memory.textures, geometries: i.memory.geometries,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unloadMatch();
    this.effects?.dispose();
    this.markers?.dispose();
    this.registry.dispose();
    this.renderer.dispose();
  }
}

export { FIXED_DT, clamp };
