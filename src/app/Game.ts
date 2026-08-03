import type { MatchConfig, PlayerIntent, TeamDef, StadiumDef, GameEvent } from '../core/types.ts';
import { FIXED_DT, MAX_SUBSTEPS } from '../core/constants.ts';
import { Match, defaultMatchConfig } from '../rules/match.ts';
import { configFromSnapshot, snapshotMatches, type MatchSnapshot } from '../rules/snapshot.ts';
import { GameRenderer } from '../render/renderer.ts';
import { InputManager } from '../input/manager.ts';
import { getSave, writeSave, type Settings } from '../persistence/save.ts';
import { getTeam, getStadium, TEAMS } from '../data/index.ts';
import { createAudio, type AudioSuite } from '../audio/index.ts';
import type { Screen, ScreenContext } from '../ui/uiKit.ts';
import { el } from '../ui/uiKit.ts';
import { Hud } from '../ui/hud.ts';
import { TouchControls } from '../ui/touchControls.ts';
import { clamp, clamp01 } from '../core/math.ts';
import { ReplayBuffer, ReplayPlayer, makeReplayView } from '../render/replay.ts';
import { FramePacer } from './framePacer.ts';

export interface PerfSample { p50: number; p95: number; p99: number; worst: number; frames: number }

export class Game {
  readonly input = new InputManager();
  readonly renderer: GameRenderer;
  audio: AudioSuite;
  hud: Hud;
  touch: TouchControls;
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
  private rotatePaused = false;
  onMatchEnd: ((m: Match) => void) | null = null;
  matchTeams: [TeamDef, TeamDef] | null = null;
  matchStadium: StadiumDef | null = null;
  private replayBuf = new ReplayBuffer();
  private replayPlayer = new ReplayPlayer();
  private replayView = makeReplayView();
  private replayBanner: HTMLDivElement;
  private replayPending: string | null = null;

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

    this.replayBanner = el('div');
    this.replayBanner.style.cssText = 'position:absolute;top:8%;left:50%;transform:translateX(-50%) skewX(-9deg);'
      + 'font:700 34px Impact,sans-serif;letter-spacing:.2em;color:#ffd23f;text-shadow:0 4px 0 #000;'
      + 'display:none;pointer-events:none;z-index:5';
    uiRoot.appendChild(this.replayBanner);

    this.touch = new TouchControls(uiRoot);
    this.input.touch = this.touch;
    this.touch.onPause = () => {
      if (!this.inMatch || this.paused) return;
      this.paused = true;
      this.go('pause', { returnScreen: 'match' });
    };
    // Holding the phone upright stops the clock rather than costing a down. Tracked separately
    // from `paused` so that rotating back does not resume a game the player paused on purpose.
    this.touch.onGate = (blocked) => {
      if (blocked && this.inMatch && !this.paused) { this.paused = true; this.rotatePaused = true; }
      else if (!blocked && this.rotatePaused) { this.paused = false; this.rotatePaused = false; }
    };

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
      replace: (n, p) => this.replace(n, p),
      reset: (n, p) => this.reset(n, p),
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
    // Mode screens use reset(), so the stack can legitimately be one deep. Never dead-end.
    if (this.stack.length <= 1) {
      if (this.currentScreen !== 'mainMenu' && this.currentScreen !== 'title') this.reset('mainMenu');
      return;
    }
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
    if (!s.dynamicResolution) this.dynScale = 1;
    this.renderer.setQuality(s.quality, s.resolutionScale * this.dynScale);
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
    // Every match starts at full resolution and earns its way down, so a single bad session
    // does not quietly leave the game blurry for the next one.
    this.dynScale = 1; this.dynOver = 0; this.dynUnder = 0;
    this.renderer.setResolutionScale(this.settings.resolutionScale);
    this.accumulator = 0;
    this.pacer.reset();
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
    // Write the resolved venue back before the match is built: the simulation reads the playing
    // surface off it, so leaving the id blank here silently gave the renderer a sand pitch and
    // the simulation grass traction.
    config.stadium = stadium.id;
    const seatIntent = (seat: number): PlayerIntent | null => this.input.intentFor(seat);
    const m = new Match({ config, home, away, seatIntent, customOffense: undefined });
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

  // ── suspend and resume ────────────────────────────────────────────────
  //
  // "Put the controller down" rather than a save-state library: one slot, written on the way out
  // and cleared on the way back in, so a finished game never resurrects. The snapshot itself is
  // plain data produced by the match (see `rules/snapshot.ts`); everything here is storage and
  // wiring, which is why none of it lives in the deterministic layer.

  /** Freeze the live match into the save file and tear it down. Returns false if nothing is live. */
  suspendMatch(): boolean {
    if (!this.match || !this.inMatch) return false;
    // A finished match is a result, not a game in progress. Saving one would offer to "continue"
    // into a final whistle.
    if (this.match.state.finished) return false;
    try {
      writeSave({ suspendedMatch: this.match.captureSnapshot() as unknown });
    } catch { return false; }
    this.paused = false;
    this.endMatch();
    return true;
  }

  /** Whether there is a game waiting to be picked up. */
  hasSuspendedMatch(): boolean { return getSave().suspendedMatch !== null; }

  /** A one-line description for the menu, or null. Reads the slot without consuming it. */
  suspendedMatchLabel(): string | null {
    const raw = getSave().suspendedMatch as MatchSnapshot | null;
    if (!raw) return null;
    try {
      const home = getTeam(raw.homeId), away = getTeam(raw.awayId);
      const q = raw.state.quarter > 4 ? 'OT' : `Q${raw.state.quarter}`;
      const secs = Math.max(0, Math.ceil(raw.state.clockTicks / 60));
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      return `${away.abbr} ${raw.state.teams[1].score} — ${raw.state.teams[0].score} ${home.abbr}`
        + `  ·  ${q} ${clock}`;
    } catch { return null; }
  }

  /** Rebuild the suspended match and hand it back live. Clears the slot on success. */
  resumeSuspendedMatch(): Match | null {
    const raw = getSave().suspendedMatch as MatchSnapshot | null;
    if (!raw) return null;
    const cfg = configFromSnapshot(raw);
    const guard = snapshotMatches(raw, {
      seed: cfg.seed, home: cfg.home, away: cfg.away,
      stadium: cfg.stadium, quarterSeconds: cfg.quarterSeconds,
    });
    // A restore into the wrong matchup does not throw — it runs perfectly and is nonsense. The
    // slot is dropped rather than kept around to fail again on the next boot.
    if (!guard.ok) { writeSave({ suspendedMatch: null }); return null; }
    let m: Match;
    try {
      m = this.startMatch(cfg as Partial<MatchConfig>);
      m.applySnapshot(raw);
    } catch { writeSave({ suspendedMatch: null }); return null; }
    // Everything downstream of the match was set up for the pre-restore state: re-point the
    // camera and let the HUD read the restored score rather than 0-0 at the 25.
    this.renderer.gameCamera.snapTo(0, m.state.losZ, 1);
    writeSave({ suspendedMatch: null });
    return m;
  }

  /** Throw the suspended game away without loading it. */
  discardSuspendedMatch(): void { writeSave({ suspendedMatch: null }); }

  endMatch(): void {
    this.replayPlayer.stop();
    this.replayBuf.clear();
    this.replayBanner.style.display = 'none';
    this.replayPending = null;
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
    if (e.type === 'touchdown') this.replayPending = 'TOUCHDOWN';
    else if (e.type === 'interception') this.replayPending = 'INTERCEPTION';
    else if (e.type === 'fumble') this.replayPending = 'FUMBLE';
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
      let raw = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (!Number.isFinite(raw) || raw < 0) raw = 0;
      raw = Math.min(raw, 0.25);
      this.frame(this.pacer.next(raw));
      const cost = performance.now() - frameStart;
      this.frameTimes.push(cost);
      if (this.frameTimes.length > 900) this.frameTimes.shift();
      this.governResolution(raw * 1000);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private pacer = new FramePacer();

  /**
   * Adaptive resolution. Frames that arrive late get a smaller buffer to fill; a sustained run
   * of on-time frames gives it back. Deliberately slow in both directions — resolution that
   * oscillates is worse to look at than resolution that is simply a bit low.
   *
   * The trigger is the frame INTERVAL, not the time spent in this loop. WebGL submits work
   * asynchronously, so a machine can be comfortably inside its CPU budget and still be missing
   * every second frame on the GPU; the interval is the only figure that sees both.
   *
   * Both thresholds are relative to what this machine has been observed to achieve, not to a
   * hardcoded 60 Hz. Absolute thresholds make the governor a one-way ratchet on every display
   * slower than about 53 Hz: a 50 Hz panel with unlimited headroom satisfies "late" on every
   * frame and "on time" on none, and silently drops to the minimum resolution. The baseline is
   * tracked in menus too, where the load is light and the figure therefore reflects the display
   * rather than the scene.
   */
  private dynScale = 1;
  private dynOver = 0;
  private dynUnder = 0;
  private dynBaseline = 16.7;   // ms; the fastest frame this session, forgotten slowly

  private governResolution(intervalMs: number): void {
    if (intervalMs > 4 && intervalMs < 500) {
      // Min-tracking with a slow upward creep. A hitch only ever raises the interval, so it
      // cannot poison the estimate; the creep exists so moving the window to another monitor
      // is picked up within a minute or so.
      this.dynBaseline = Math.min(intervalMs, this.dynBaseline + 0.005);
      this.dynBaseline = clamp(this.dynBaseline, 4, 40);
    }
    if (!this.settings.dynamicResolution || !this.inMatch || this.paused) {
      this.dynOver = 0; this.dynUnder = 0;
      return;
    }
    const late = this.dynBaseline * 1.30;
    const onTime = this.dynBaseline * 1.12;
    if (intervalMs > late) this.dynOver++; else this.dynOver = Math.max(0, this.dynOver - 1);
    // Decayed rather than zeroed: a single long frame is normal, and resetting on one meant
    // the recovery path could never complete in the presence of ordinary jitter.
    if (intervalMs < onTime) this.dynUnder++; else this.dynUnder = Math.max(0, this.dynUnder - 3);

    if (this.dynOver >= 45 && this.dynScale > 0.6) {
      this.dynScale = Math.max(0.6, this.dynScale - 0.1);
      this.dynOver = 0; this.dynUnder = 0;
      this.renderer.setResolutionScale(this.settings.resolutionScale * this.dynScale);
    } else if (this.dynUnder >= 240 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale + 0.05);
      this.dynUnder = 0;
      this.renderer.setResolutionScale(this.settings.resolutionScale * this.dynScale);
    }
  }

  /** Current adaptive-resolution multiplier, 0.6..1. Exposed for the perf harness. */
  get dynamicScale(): number { return this.dynScale; }

  stop(): void { this.running = false; cancelAnimationFrame(this.rafId); }

  private frame(dt: number): void {
    this.input.poll();

    const m = this.match;

    // Replay playback owns the frame while it runs; the simulation is paused, not touched.
    if (this.replayPlayer.active && m) {
      const idx = this.replayPlayer.advance(dt);
      if (idx >= 0 && this.replayBuf.read(idx, this.replayView)) {
        this.renderer.syncReplay(this.replayView, dt);
        this.renderer.render();
        // A replay is a cutscene. Leaving the pad up would let a thumb throw into it.
        this.touch.sync(m, this.renderer, false);
        this.current?.update?.(dt);
        this.input.clearEdges();
        return;
      }
      this.replayPlayer.stop();
      this.replayBanner.style.display = 'none';
    }

    if (m && this.inMatch && !this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        m.tick();
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) this.accumulator = 0;
      this.stepHist[Math.min(steps, this.stepHist.length - 1)]++;
      const alpha = clamp01(this.accumulator / FIXED_DT);
      const celebrating = m.phase === 'SCORE_RESOLVE' || m.phase === 'FINAL';
      this.renderer.sync(m.world, m.state, alpha, dt, celebrating);
      if (m.world.playPhase === 'LIVE') this.replayBuf.capture(m.world, dt);
      // Fire the clip once the whistle has blown, not mid-play.
      if (this.replayPending && (m.phase === 'SCORE_RESOLVE' || m.phase === 'PLAY_CALL')
          && this.replayBuf.ready) {
        this.renderer.gameCamera.resetReplay();
        this.replayPlayer.start(this.replayBuf.length, this.replayPending);
        this.replayBanner.textContent = `▶ ${this.replayPending}`;
        this.replayBanner.style.display = 'block';
        this.replayPending = null;
      }
      this.hud.update(dt);
      this.renderer.render();
    } else if (m && this.inMatch && this.paused) {
      this.renderer.sync(m.world, m.state, 1, 0, false);
      this.renderer.render();
    } else {
      this.menuT += dt;
      this.renderer.renderMenu(this.menuT);
    }

    // After renderer.sync, so the badges are projected through the same camera that was just
    // drawn rather than the one from last frame.
    this.touch.sync(m, this.renderer, this.inMatch && !this.paused);

    this.current?.update?.(dt);
    this.input.clearEdges();
  }

  /**
   * How many simulation steps each frame ran. A perfectly paced 60 Hz session is entirely in
   * bucket 1; entries in 0 and 2 are the beat that pacing exists to remove.
   */
  private stepHist = [0, 0, 0, 0, 0, 0];
  stepHistogram(): number[] { return [...this.stepHist]; }

  /**
   * Advance presentation-only state — camera easing, pose cross-fades, effects — by a fixed
   * amount of simulated wall time, without stepping the match and without drawing.
   *
   * Purely a tool hook. The capture harness drives the match forward programmatically because
   * this container has no GPU, and a still taken immediately afterwards catches the camera
   * mid-transition: at software-rasteriser frame rates a "wait 600 ms" is barely one frame. This
   * lets a screenshot show the framing the game actually settles on.
   */
  settle(seconds: number): void {
    const m = this.match;
    if (!m) return;
    const dt = 1 / 60;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      this.renderer.sync(m.world, m.state, 1, dt, m.phase === 'SCORE_RESOLVE' || m.phase === 'FINAL');
    }
  }

  /**
   * Run the match and the presentation together at a fixed step, without drawing.
   *
   * `settle` freezes the world and only eases the camera, which is right for a still of a set
   * piece and useless for anything transient: trails collapse to zero length and every spark has
   * decayed before the shutter opens. This is the capture harness's equivalent of actually
   * playing for a second, and it is the only way to photograph motion in a container with no GPU.
   */
  advance(seconds: number): void {
    const m = this.match;
    if (!m) return;
    const dt = FIXED_DT;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      m.tick();
      this.renderer.sync(m.world, m.state, 1, dt, m.phase === 'SCORE_RESOLVE' || m.phase === 'FINAL');
    }
  }

  perfReset(): void { this.frameTimes.length = 0; this.stepHist.fill(0); }

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
    this.touch.dispose();
    this.audio.engine.dispose();
  }
}
