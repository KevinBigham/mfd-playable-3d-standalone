import type { MatchConfig, PlayerIntent, TeamDef, StadiumDef, GameEvent } from '../core/types.ts';
import { FIXED_DT, MAX_SUBSTEPS } from '../core/constants.ts';
import { Match, defaultMatchConfig } from '../rules/match.ts';
import { GameRenderer } from '../render/renderer.ts';
import { InputManager } from '../input/manager.ts';
import { getSave, writeSave, type Settings } from '../persistence/save.ts';
import { getTeam, getStadium, TEAMS } from '../data/index.ts';
import { createAudio, type AudioSuite } from '../audio/index.ts';
import type { Screen, ScreenContext } from '../ui/uiKit.ts';
import { el } from '../ui/uiKit.ts';
import { Hud } from '../ui/hud.ts';
import { clamp, clamp01 } from '../core/math.ts';

export interface PerfSample { p50: number; p95: number; p99: number; worst: number; frames: number }

export class Game {
  readonly input = new InputManager();
  readonly renderer: GameRenderer;
  audio: AudioSuite;
  hud: Hud;
  match: Match | null = null;
  settings: Settings;

  private screens = new Map<string, Screen>();
  private stack: Array<{ name: string; params?: unknown }> = [];
  private current: Screen | null = null;
  private uiRoot: HTMLElement;
  private hudRoot: HTMLElement;
  private flashEl: HTMLDivElement;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private menuT = 0;
  private frameTimes: number[] = [];
  private rafId = 0;
  /** Set while a match is being played (as opposed to menu background). */
  inMatch = false;
  paused = false;
  onMatchEnd: ((m: Match) => void) | null = null;
  matchTeams: [TeamDef, TeamDef] | null = null;
  matchStadium: StadiumDef | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = getSave().settings;
    this.uiRoot = uiRoot;
    this.renderer = new GameRenderer(canvas, {
      quality: this.settings.quality,
      shake: this.settings.cameraShake,
      reducedMotion: this.settings.reducedMotion,
      flash: this.settings.screenFlash,
      resolutionScale: this.settings.resolutionScale,
    });
    this.flashEl = el('div');
    this.flashEl.id = 'flash';
    uiRoot.appendChild(this.flashEl);
    this.renderer.attachFlashLayer(this.flashEl);

    this.hudRoot = el('div');
    this.hudRoot.id = 'hud';
    uiRoot.appendChild(this.hudRoot);
    this.hud = new Hud(this.hudRoot);

    this.audio = createAudio();
    this.applySettings();
    this.input.attach(window);
    this.input.autoAssign();
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => { this.audio.engine.unlock(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  // ── screens ───────────────────────────────────────────────────────────
  register(s: Screen): void { this.screens.set(s.name, s); }

  private ctx(): ScreenContext {
    return {
      root: this.uiRoot,
      input: this.input,
      go: (n, p) => this.go(n, p),
      back: () => this.back(),
      sound: (k) => {
        if (k === 'move') this.audio.sfx.menuMove();
        else if (k === 'select') this.audio.sfx.menuSelect();
        else if (k === 'back') this.audio.sfx.menuBack();
        else this.audio.sfx.menuError();
      },
    };
  }

  go(name: string, params?: unknown): void {
    const next = this.screens.get(name);
    if (!next) { console.warn(`[GO] unknown screen: ${name}`); return; }
    if (this.current) this.current.unmount();
    this.stack.push({ name, params });
    this.current = next;
    next.mount(this.ctx(), params);
  }

  replace(name: string, params?: unknown): void {
    if (this.stack.length) this.stack.pop();
    this.go(name, params);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    if (this.current) this.current.unmount();
    this.stack.pop();
    const prev = this.stack[this.stack.length - 1];
    const s = this.screens.get(prev.name);
    this.current = s ?? null;
    s?.mount(this.ctx(), prev.params);
  }

  reset(name: string, params?: unknown): void {
    if (this.current) this.current.unmount();
    this.stack.length = 0;
    this.current = null;
    this.go(name, params);
  }

  get currentScreen(): string { return this.stack[this.stack.length - 1]?.name ?? ''; }

  // ── settings ──────────────────────────────────────────────────────────
  applySettings(): void {
    const s = this.settings;
    this.renderer.setQuality(s.quality, s.resolutionScale);
    this.renderer.setCameraOptions(s.cameraShake, s.reducedMotion);
    this.audio.engine.setVolume('master', s.volumes.master);
    this.audio.engine.setVolume('sfx', s.volumes.sfx);
    this.audio.engine.setVolume('crowd', s.volumes.crowd);
    this.audio.engine.setVolume('music', s.volumes.music);
    this.audio.engine.setVolume('ui', s.volumes.ui);
    this.input.setBinding(0, s.bindings[0]);
    this.input.setBinding(1, s.bindings[1]);
    document.documentElement.style.setProperty('--hud-scale', s.largeHud ? '1.34' : '1');
    writeSave({ settings: s });
  }

  // ── match lifecycle ───────────────────────────────────────────────────
  startMatch(cfg: Partial<MatchConfig>): Match {
    this.endMatch();
    const config = defaultMatchConfig({
      ...cfg,
      difficulty: cfg.difficulty ?? this.settings.difficulty,
      quarterSeconds: cfg.quarterSeconds ?? this.settings.quarterSeconds,
      playClock: cfg.playClock ?? this.settings.playClock,
      catchUpBias: cfg.catchUpBias ?? this.settings.catchUpBias,
      lateHits: cfg.lateHits ?? this.settings.lateHits,
    });
    if (!config.home) config.home = TEAMS[0].id;
    if (!config.away) config.away = TEAMS[1].id;
    const home = getTeam(config.home);
    const away = getTeam(config.away);
    const stadium = getStadium(config.stadium || home.stadium);
    const seatIntent = (seat: number): PlayerIntent | null => this.input.intentFor(seat);
    const m = new Match({ config, home, away, seatIntent, customPlays: undefined });
    this.match = m;
    this.matchTeams = [home, away];
    this.matchStadium = stadium;
    this.renderer.loadMatch(home, away, stadium, m.world.conditions);
    this.renderer.gameCamera.snapTo(0, m.state.losZ, 1);
    this.hud.attachMatch(m, home, away);
    this.audio.director.attach(m.bus);
    this.audio.music.stop();
    this.inMatch = true;
    this.paused = false;
    m.bus.on('*', (e: GameEvent) => this.onGameEvent(e));
    return m;
  }

  endMatch(): void {
    if (!this.match) return;
    this.audio.director.detach();
    this.match.dispose();
    this.match = null;
    this.inMatch = false;
    this.renderer.unloadMatch();
    this.hud.detach();
  }

  private onGameEvent(e: GameEvent): void {
    this.renderer.handleEvent(e);
    this.audio.director.handle(e);
    this.hud.handleEvent(e);
    if (e.type === 'match.end' && this.match) this.onMatchEnd?.(this.match);
  }

  // ── loop ──────────────────────────────────────────────────────────────
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const frameStart = now;
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 0.25);
      this.frame(dt);
      const cost = performance.now() - frameStart;
      this.frameTimes.push(cost);
      if (this.frameTimes.length > 900) this.frameTimes.shift();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.rafId); }

  private frame(dt: number): void {
    this.input.poll();

    const m = this.match;
    if (m && this.inMatch && !this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        m.tick();
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
      const alpha = clamp01(this.accumulator / FIXED_DT);
      const celebrating = m.phase === 'SCORE_RESOLVE' || m.phase === 'FINAL';
      this.renderer.sync(m.world, m.state, alpha, dt, celebrating);
      this.hud.update(dt);
      this.renderer.render();
    } else if (m && this.inMatch && this.paused) {
      this.renderer.sync(m.world, m.state, 1, 0, false);
      this.renderer.render();
    } else {
      this.menuT += dt;
      this.renderer.renderMenu(this.menuT);
    }

    this.current?.update?.(dt);
    this.input.clearEdges();
  }

  perf(): PerfSample {
    const a = [...this.frameTimes].sort((x, y) => x - y);
    if (a.length === 0) return { p50: 0, p95: 0, p99: 0, worst: 0, frames: 0 };
    const at = (p: number) => a[clamp(Math.floor(a.length * p), 0, a.length - 1)];
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: a[a.length - 1], frames: a.length };
  }

  dispose(): void {
    this.stop();
    this.endMatch();
    this.renderer.dispose();
    this.input.dispose();
    this.audio.engine.dispose();
  }
}
