import type {
  AthleteId, DeadReason, DefensePlay, MatchConfig, MatchPhase, MatchResult, MatchState,
  OffensePlay, PlayerIntent, TeamDef, TeamSide,
} from '../core/types.ts';
import { Rng } from '../core/rng.ts';
import { EventBus } from '../core/events.ts';
import {
  FIXED_DT, TICK_HZ, s, DEAD_BALL_TICKS, POST_PLAY_TICKS, SCORE_CELEBRATION_TICKS,
  QUARTER_BREAK_TICKS, PLAY_CALL_SECONDS, PLAY_CLOCK_SECONDS, PAT_MAKE_BASE, PAT_DISTANCE,
  FG_METER_PERIOD, PUNT_POWER_PERIOD, TOUCHBACK_Z, FIELD_HALF_WIDTH, OVERTIME_PERIODS,
  CLOCK_SCALE,
  DEFAULT_QUARTER_SECONDS,
} from '../core/constants.ts';
import { clamp, clamp01, dist } from '../core/math.ts';
import {
  createMatchState, applyOutcome, blankOutcome, computeFirstDown, kickoffSpot, conversionSpot,
  safetyFreeKickSpot, touchbackSpot, dirOf, goalOf, other, noteCatch, noteSack, breakStreaks,
  extinguish, tickOverdrive, matchShouldEnd, winnerOf, validateMatchState, clampSpot,
  type PlayOutcome, type Violation,
} from './rulesEngine.ts';
import {
  createWorld, assignUnits, makeConditions, carrier, OFF_START, DEF_START, type World,
} from '../sim/world.ts';
import { setupPlay, snap, stepPlay, type Controller } from '../sim/playRunner.ts';
import { giveBall, killBall, assertBallInvariant, dropLoose } from '../sim/ball.ts';
import {
  KICKOFF_OFFENSE, KICKOFF_DEFENSE, PUNT_OFFENSE, PUNT_DEFENSE, FG_OFFENSE, FG_DEFENSE,
} from '../sim/specialFormations.ts';
import {
  launchKickoff, launchPunt, launchFieldGoal, launchExtraPoint, meterValue,
  fieldGoalDistance, fieldGoalMakeChance, checkUprights, type KickPlan,
} from '../sim/kicking.ts';
import { AiController, type AiContext } from '../ai/athleteAI.ts';
import { profileFor, catchUpFactor, type AiProfile } from '../ai/difficulty.ts';
import {
  chooseOffensePlay, chooseDefensePlay, chooseFourthDown, chooseConversion, shouldOnsideKick,
  readSituation, TendencyTracker,
} from '../ai/playCaller.ts';
import { OFFENSE_PLAYS } from '../plays/offense.ts';
import { DEFENSE_PLAYS } from '../plays/defense.ts';
import { Action, has } from '../input/actions.ts';

export type SpecialCall = 'PUNT' | 'FIELD_GOAL' | null;

export interface MatchOptions {
  config: MatchConfig;
  home: TeamDef;
  away: TeamDef;
  /** Supplies live human input for a seat. Return null for "no input this tick". */
  seatIntent?: (seat: number) => PlayerIntent | null;
  /** Extra offensive plays (custom playbook). */
  customOffense?: OffensePlay[];
  bus?: EventBus;
}

const BLANK: PlayerIntent = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };

export class Match {
  readonly config: MatchConfig;
  readonly bus: EventBus;
  readonly rng: Rng;
  readonly world: World;
  readonly state: MatchState;
  readonly offensePlays: OffensePlay[];
  readonly defensePlays: DefensePlay[];

  private controllers: (Controller | null)[] = [];
  private ai: AiController;
  private aiCtx: AiContext;
  private profile: AiProfile;
  private tendency: [TendencyTracker, TendencyTracker] = [new TendencyTracker(), new TendencyTracker()];
  private seatIntent: (seat: number) => PlayerIntent | null;

  /** Play-call staging. */
  pendingOffense: OffensePlay | null = null;
  pendingDefense: DefensePlay | null = null;
  pendingSpecial: SpecialCall = null;
  pendingConversion: 'KICK' | 'TWO' | null = null;
  offenseLocked = false;
  defenseLocked = false;
  mirrorOffense = false;

  /** Kick meter state (shared by FG and punt). */
  kickMeterTicks = 0;
  kickMeterActive = false;
  kickPlan: KickPlan = { kind: 'FIELD_GOAL', aim: 0, power: 0.75, quality: 0.5 };
  private kickLaunched = false;
  private onsideRequested = false;

  private lastOffenseId = '';
  private violations: Violation[] = [];
  private watchdogFired = 0;
  private conversionTwoActive = false;
  private conversionActive = false;
  private freeKickAfterSafety = false;

  constructor(opts: MatchOptions) {
    this.config = opts.config;
    this.bus = opts.bus ?? new EventBus();
    this.rng = new Rng(opts.config.seed);
    this.seatIntent = opts.seatIntent ?? (() => null);
    const conditions = makeConditions(
      opts.config.weather,
      'GRASS',
      new Rng(opts.config.seed ^ 0x5eed),
    );
    this.world = createWorld(opts.home, opts.away, conditions, this.rng, this.bus);
    this.world.lateHits = opts.config.lateHits;
    const qSeconds = opts.config.quarterSeconds || DEFAULT_QUARTER_SECONDS;
    this.state = createMatchState(Math.round(qSeconds * TICK_HZ));
    this.offensePlays = [...OFFENSE_PLAYS, ...(opts.customOffense ?? [])];
    this.defensePlays = [...DEFENSE_PLAYS];
    this.profile = profileFor(opts.config.difficulty);
    this.aiCtx = { profile: this.profile, catchUp: [1, 1] };
    this.ai = new AiController(this.aiCtx);
    this.buildControllers();
  }

  // ── control ──────────────────────────────────────────────────────────────

  private buildControllers(): void {
    const self = this;
    const dispatch: Controller = {
      produce(w: World, id: AthleteId, out: PlayerIntent): void {
        const a = w.athletes[id];
        if (a.controlledBySeat >= 0) {
          const src = self.seatIntent(a.controlledBySeat);
          if (src) { out.moveX = src.moveX; out.moveZ = src.moveZ; out.held = src.held; return; }
          out.moveX = 0; out.moveZ = 0; out.held = 0;
          return;
        }
        self.ai.produce(w, id, out);
      },
    };
    this.controllers = new Array(14).fill(dispatch);
  }

  seatsFor(side: TeamSide): number[] {
    const out: number[] = [];
    this.config.seats.forEach((s2, i) => { if (s2.active && s2.side === side) out.push(i); });
    return out;
  }
  isHuman(side: TeamSide): boolean { return this.seatsFor(side).length > 0; }
  anyHuman(): boolean { return this.config.seats.some((x) => x.active); }

  /** Reassign which athlete each seat drives. Called every tick while a play is live. */
  private updateControlAssignment(): void {
    const w = this.world;
    for (const a of w.athletes) a.controlledBySeat = -1;
    for (const side of [0, 1] as TeamSide[]) {
      const seats = this.seatsFor(side);
      if (seats.length === 0) continue;
      const onOffense = side === w.possession;
      if (onOffense) {
        const car = carrier(w);
        const primary = car && car.side === side ? car.id : w.athletes[OFF_START].id;
        w.athletes[primary].controlledBySeat = seats[0] as 0 | 1 | 2 | 3;
        if (seats.length > 1) {
          // Teammate drives a skill player who is not the carrier.
          let pick = -1;
          for (let i = 1; i < 7; i++) {
            const cand = w.athletes[OFF_START + i];
            if (cand.id === primary) continue;
            if (cand.role === 'LINE') continue;
            if (cand.targetButton === null) continue;
            pick = cand.id;
            if (cand.targetButton === 2) break;
          }
          if (pick >= 0) w.athletes[pick].controlledBySeat = seats[1] as 0 | 1 | 2 | 3;
        }
      } else {
        const used = new Set<number>();
        for (let k = 0; k < seats.length; k++) {
          const seat = seats[k];
          let id = this.seatDefender[seat];
          if (id < 0 || w.athletes[id].side !== side || used.has(id) || w.athletes[id].move === 'DOWN') {
            id = this.pickDefender(side, used);
            this.seatDefender[seat] = id;
          }
          if (id >= 0) { used.add(id); w.athletes[id].controlledBySeat = seat as 0 | 1 | 2 | 3; }
        }
      }
    }
  }

  private seatDefender: number[] = [-1, -1, -1, -1];

  private pickDefender(side: TeamSide, used: Set<number>): number {
    const w = this.world;
    const b = w.ball;
    let best = -1; let bestScore = 1e9;
    for (let i = 0; i < 7; i++) {
      const d = w.athletes[DEF_START + i];
      if (d.side !== side) continue;
      if (used.has(d.id)) continue;
      if (d.move === 'DOWN') continue;
      const sc = dist(d.x, d.z, b.x, b.z);
      if (sc < bestScore) { bestScore = sc; best = d.id; }
    }
    return best;
  }

  private handleSwitchRequests(): void {
    const w = this.world;
    if (w.switchRequests.length === 0) return;
    for (const seat of w.switchRequests) {
      if (seat < 0) continue;
      const side = this.config.seats[seat]?.side;
      if (side === undefined || side === w.possession) continue;
      const used = new Set<number>();
      for (let i = 0; i < this.seatDefender.length; i++) if (i !== seat && this.seatDefender[i] >= 0) used.add(this.seatDefender[i]);
      const cur = this.seatDefender[seat];
      if (cur >= 0) used.add(cur);
      const next = this.pickDefender(side, used);
      if (next >= 0) this.seatDefender[seat] = next;
    }
    w.switchRequests.length = 0;
  }

  // ── phase machine ────────────────────────────────────────────────────────

  private setPhase(p: MatchPhase): void {
    this.state.phase = p;
    this.state.phaseTicks = 0;
    this.enterPhase(p);
  }

  /** One-shot initialisation on entering a phase. Runs before any external submission. */
  private enterPhase(p: MatchPhase): void {
    const m = this.state;
    if (p === 'PLAY_CALL') {
      this.pendingOffense = null; this.pendingDefense = null; this.pendingSpecial = null;
      this.offenseLocked = false; this.defenseLocked = false;
      this.mirrorOffense = false;
      this.world.special = null;
      if (!this.isHuman(m.possession)) this.autoPickOffense();
      if (!this.isHuman(other(m.possession))) this.autoPickDefense();
    } else if (p === 'CONVERSION_CALL') {
      this.pendingConversion = null;
      if (!this.isHuman(m.possession)) {
        this.pendingConversion = chooseConversion(m, m.possession, this.rng, this.profile);
      }
    }
  }

  get phase(): MatchPhase { return this.state.phase; }
  get finished(): boolean { return this.state.finished; }

  tick(): void {
    const m = this.state;
    const w = this.world;
    if (m.finished) return;
    m.phaseTicks++;

    switch (m.phase) {
      case 'PREGAME': this.tickPregame(); break;
      case 'COIN_TOSS': this.tickCoinToss(); break;
      case 'KICKOFF_SETUP': this.tickKickoffSetup(); break;
      case 'KICKOFF_LIVE': this.tickLive(true); break;
      case 'PLAY_CALL': this.tickPlayCall(); break;
      case 'PRE_SNAP': this.tickPreSnap(); break;
      case 'LIVE': this.tickLive(false); break;
      case 'DEAD_BALL': this.tickDeadBall(); break;
      case 'POST_PLAY': this.tickPostPlay(); break;
      case 'SCORE_RESOLVE': this.tickScoreResolve(); break;
      case 'CONVERSION_CALL': this.tickConversionCall(); break;
      case 'CONVERSION_LIVE': this.tickLive(false); break;
      case 'CONVERSION_RESOLVE': this.tickConversionResolve(); break;
      case 'QUARTER_BREAK': this.tickQuarterBreak(); break;
      case 'HALFTIME': this.tickHalftime(); break;
      case 'OVERTIME_SETUP': this.tickOvertimeSetup(); break;
      case 'FINAL': break;
      default: break;
    }

    // Overdrive decay + validation.
    for (const side of tickOverdrive(m)) {
      this.applyOverdriveFlags();
      this.bus.emit({ type: 'overdrive.end', tick: w.tick, side, cause: 'expired' });
    }
    this.aiCtx.catchUp[0] = catchUpFactor(this.config.catchUpBias, m.teams[0].score, m.teams[1].score);
    this.aiCtx.catchUp[1] = catchUpFactor(this.config.catchUpBias, m.teams[1].score, m.teams[0].score);

    this.watchdog();
  }

  private watchdog(): void {
    const m = this.state;
    const limits: Partial<Record<MatchPhase, number>> = {
      PREGAME: s(6), COIN_TOSS: s(4), KICKOFF_SETUP: s(8), KICKOFF_LIVE: s(26),
      PLAY_CALL: s(40), PRE_SNAP: s(30), LIVE: s(30), DEAD_BALL: s(4), POST_PLAY: s(4),
      SCORE_RESOLVE: s(8), CONVERSION_CALL: s(20), CONVERSION_LIVE: s(20),
      CONVERSION_RESOLVE: s(6), QUARTER_BREAK: s(8), HALFTIME: s(12), OVERTIME_SETUP: s(8),
    };
    const lim = limits[m.phase];
    if (lim === undefined || m.phaseTicks <= lim) return;
    this.watchdogFired++;
    this.bus.emit({ type: 'rules.watchdog', tick: this.world.tick, phase: m.phase });
    switch (m.phase) {
      case 'LIVE': case 'KICKOFF_LIVE': case 'CONVERSION_LIVE':
        this.endPlay('WATCHDOG'); break;
      case 'PLAY_CALL':
        this.forcePlayCall(); break;
      case 'PRE_SNAP':
        this.doSnap(); break;
      case 'CONVERSION_CALL':
        this.pendingConversion = 'KICK'; break;
      default:
        this.setPhase('PLAY_CALL'); break;
    }
  }

  private tickPregame(): void {
    if (this.state.phaseTicks > s(0.5)) this.setPhase('COIN_TOSS');
  }

  private tickCoinToss(): void {
    const m = this.state;
    const receiving: TeamSide = this.rng.chance(0.5) ? 0 : 1;
    m.kickoffReceiving = receiving;
    m.secondHalfReceiver = other(receiving);
    this.setPhase('KICKOFF_SETUP');
  }

  // ── kickoff ──────────────────────────────────────────────────────────────

  private tickKickoffSetup(): void {
    const m = this.state; const w = this.world;
    if (m.phaseTicks !== 1) {
      if (m.phaseTicks > s(0.8)) { this.setPhase('KICKOFF_LIVE'); this.kickLaunched = false; }
      return;
    }
    const kicking = other(m.kickoffReceiving);
    const spot = this.freeKickAfterSafety ? safetyFreeKickSpot(kicking) : kickoffSpot(kicking);
    this.freeKickAfterSafety = false;
    m.possession = kicking;
    m.down = 1;
    m.losZ = spot;
    m.firstDownZ = computeFirstDown(spot, kicking);
    assignUnits(w, kicking, true);
    this.applyOverdriveFlags();
    w.special = 'KICKOFF';
    setupPlay(w, { offense: KICKOFF_OFFENSE, defense: KICKOFF_DEFENSE, losZ: spot, spotX: 0, possession: kicking });
    // Onside decision.
    this.onsideRequested = this.isHuman(kicking)
      ? false
      : shouldOnsideKick(m, kicking, this.rng);
    w.playPhase = 'LIVE';
    this.bus.emit({ type: 'kickoff', tick: w.tick, side: kicking, onside: this.onsideRequested });
  }

  // ── play call ────────────────────────────────────────────────────────────

  private tickPlayCall(): void {
    const m = this.state;
    if (this.offenseLocked && this.defenseLocked) { this.beginPlay(); return; }
    if (m.phaseTicks > s(PLAY_CALL_SECONDS)) this.forcePlayCall();
  }

  private forcePlayCall(): void {
    if (!this.offenseLocked) this.autoPickOffense();
    if (!this.defenseLocked) this.autoPickDefense();
    this.beginPlay();
  }

  private autoPickOffense(): void {
    const m = this.state;
    const sit = readSituation(m, m.possession);
    if (m.down === 4) {
      const choice = chooseFourthDown(sit, this.profile, this.rng);
      if (choice === 'PUNT') { this.pendingSpecial = 'PUNT'; this.offenseLocked = true; return; }
      if (choice === 'FIELD_GOAL') { this.pendingSpecial = 'FIELD_GOAL'; this.offenseLocked = true; return; }
    }
    const p = chooseOffensePlay(this.offensePlays, sit, this.profile, this.rng, this.lastOffenseId);
    this.pendingOffense = p;
    this.offenseLocked = true;
  }

  private autoPickDefense(): void {
    const m = this.state;
    const sit = readSituation(m, m.possession);
    this.pendingDefense = chooseDefensePlay(this.defensePlays, sit, this.tendency[m.possession], this.profile, this.rng);
    this.defenseLocked = true;
  }

  /** UI entry point. */
  submitOffense(play: OffensePlay | null, special: SpecialCall = null, mirrored = false): void {
    if (special) { this.pendingSpecial = special; this.pendingOffense = null; }
    else { this.pendingOffense = play; this.pendingSpecial = null; }
    this.mirrorOffense = mirrored;
    this.offenseLocked = true;
  }
  submitDefense(play: DefensePlay): void { this.pendingDefense = play; this.defenseLocked = true; }
  submitConversion(c: 'KICK' | 'TWO'): void { this.pendingConversion = c; }

  private beginPlay(): void {
    const m = this.state; const w = this.world;
    assignUnits(w, m.possession, this.pendingSpecial !== null);
    this.applyOverdriveFlags();

    if (this.pendingSpecial === 'PUNT') {
      w.special = 'PUNT';
      setupPlay(w, { offense: PUNT_OFFENSE, defense: PUNT_DEFENSE, losZ: m.losZ, spotX: 0, possession: m.possession });
      m.teams[m.possession].stats.punts++;
      this.startKickMeter('PUNT');
    } else if (this.pendingSpecial === 'FIELD_GOAL') {
      w.special = 'FIELD_GOAL';
      setupPlay(w, { offense: FG_OFFENSE, defense: FG_DEFENSE, losZ: m.losZ, spotX: 0, possession: m.possession });
      m.teams[m.possession].stats.fgAtt++;
      const d = fieldGoalDistance(w, m.possession);
      this.bus.emit({ type: 'fieldGoal.attempt', tick: w.tick, side: m.possession, distance: d });
      this.startKickMeter('FIELD_GOAL');
    } else {
      const off = this.pendingOffense ?? this.offensePlays[0];
      const def = this.pendingDefense ?? this.defensePlays[0];
      w.special = null;
      this.lastOffenseId = off.id;
      this.tendency[m.possession].note(off);
      setupPlay(w, { offense: off, defense: def, losZ: m.losZ, spotX: 0, possession: m.possession, mirrored: this.mirrorOffense });
    }
    this.applyOverdriveFlags();
    m.playClockTicks = s(PLAY_CLOCK_SECONDS);
    this.setPhase('PRE_SNAP');
  }

  private kickArmed = false;

  private startKickMeter(kind: 'FIELD_GOAL' | 'PUNT'): void {
    this.kickMeterActive = true;
    this.kickMeterTicks = 0;
    this.kickLaunched = false;
    // The snap and the kick share a button. The meter must not accept the button that is
    // already down from snapping — it has to see a release first, then a fresh press.
    this.kickArmed = false;
    this.kickPlan = { kind, aim: 0, power: 0.75, quality: 0.5 };
  }

  // ── pre-snap ─────────────────────────────────────────────────────────────

  private tickPreSnap(): void {
    const m = this.state; const w = this.world;
    // Athletes hold formation; humans may motion. Snap on ACTION or auto.
    stepPlay(this.world, this.controllers);
    this.updateControlAssignment();

    let snapNow = false;
    if (this.isHuman(m.possession)) {
      for (const seat of this.seatsFor(m.possession)) {
        const it = this.seatIntent(seat);
        if (it && has(it.held, Action.ACTION)) snapNow = true;
      }
      if (this.config.playClock && m.phaseTicks > m.playClockTicks) snapNow = true;
      if (m.phaseTicks > s(14)) snapNow = true;
    } else if (m.phaseTicks > s(0.8) + Math.round(this.rng.range(0, 12))) {
      snapNow = true;
    }
    if (snapNow && m.phaseTicks > s(0.3)) this.doSnap();
  }

  private doSnap(): void {
    const w = this.world;
    snap(w);
    // Coverage defenders need longer to diagnose a run than to react to a throw;
    // that difference is what makes designed runs viable at all.
    for (const a of w.athletes) {
      const cover = a.side !== w.possession
        && a.assign !== null && a.assign.kind !== 'RUSH' && a.assign.kind !== 'CONTAIN';
      a.reactionQueue = this.profile.reactionTicks + (cover ? s(0.50) : 0);
    }
    this.setPhase(this.conversionTwoActive ? 'CONVERSION_LIVE' : 'LIVE');
  }

  // ── live ─────────────────────────────────────────────────────────────────

  private tickLive(kickoff: boolean): void {
    const m = this.state; const w = this.world;
    this.updateControlAssignment();

    // Kick launches.
    if (this.kickMeterActive && !this.kickLaunched) this.tickKickMeter();
    if (kickoff && !this.kickLaunched && m.phaseTicks > s(0.55)) {
      const kicker = w.athletes[OFF_START];
      launchKickoff(w, kicker, this.onsideRequested);
      w.special = this.onsideRequested ? 'ONSIDE' : 'KICKOFF';
      this.kickLaunched = true;
    }

    const dead = stepPlay(w, this.controllers);
    this.handleSwitchRequests();
    this.consumeEvents();

    // Clock only runs while the ball is live.
    if (w.playPhase === 'LIVE' && !this.conversionTwoActive && m.phase !== 'CONVERSION_LIVE') {
      this.clockRemainder += CLOCK_SCALE;
      while (this.clockRemainder >= 1) { m.clockTicks = Math.max(0, m.clockTicks - 1); this.clockRemainder -= 1; }
    }
    m.teams[m.possession].stats.possessionTicks++;

    if (dead) this.endPlay(dead);
  }

  private tickKickMeter(): void {
    const w = this.world; const m = this.state;
    this.kickMeterTicks++;
    const period = this.kickPlan.kind === 'FIELD_GOAL' ? FG_METER_PERIOD : PUNT_POWER_PERIOD;
    const v = meterValue(this.kickMeterTicks, period);
    const kicker = w.athletes[OFF_START];

    let pressed = false;
    let timedOut = false;
    let aim = 0;
    if (this.isHuman(m.possession)) {
      for (const seat of this.seatsFor(m.possession)) {
        const it = this.seatIntent(seat);
        if (!it) continue;
        aim = clamp(it.moveX, -1, 1);
        if (!has(it.held, Action.ACTION)) this.kickArmed = true;
        if (this.kickArmed && has(it.pressed, Action.ACTION)) pressed = true;
      }
      if (this.kickMeterTicks > period * 2.5) { pressed = true; timedOut = true; }
    } else {
      const skill = clamp01(0.45 + kicker.def.ratings.accuracy / 160);
      const window = 0.06 + (1 - skill) * 0.30;
      if (v > 1 - window && this.kickMeterTicks > 8) pressed = true;
      if (this.kickMeterTicks > period * 2.5) { pressed = true; timedOut = true; }
      aim = 0;
    }
    if (!pressed) return;

    this.kickPlan.aim = aim;
    // A player who never presses gets a mediocre kick, not a shank off the instantaneous
    // meter position — which was landing near zero and made the timeout a guaranteed miss.
    this.kickPlan.quality = timedOut ? 0.45 : clamp01(v);
    this.kickPlan.power = clamp01(0.55 + this.kickPlan.quality * 0.45);
    this.kickMeterActive = false;
    this.kickLaunched = true;

    if (this.kickPlan.kind === 'FIELD_GOAL') {
      const chance = fieldGoalMakeChance(w, m.possession, this.kickPlan, kicker);
      const good = this.rng.chance(chance);
      launchFieldGoal(w, kicker, this.kickPlan, good);
    } else {
      const d = launchPunt(w, kicker, this.kickPlan);
      this.bus.emit({ type: 'punt', tick: w.tick, side: m.possession, distance: d });
    }
  }

  /** Translate sim events into rules-side bookkeeping (streaks, stats). */
  private consumeEvents(): void {
    const m = this.state; const w = this.world;
    for (const e of this.bus.queue) {
      switch (e.type) {
        case 'catch': {
          const a = w.athletes[e.by];
          if (a.side === m.possession) {
            m.teams[m.possession].stats.passComp++;
            // Track the streak by JERSEY NUMBER: athlete ids are play slots and get
            // rebound to different people every snap.
            const res = noteCatch(m, m.possession, a.def.number);
            this.applyOverdriveFlags();
            if (res.started) {
              this.bus.emit({ type: 'overdrive.start', tick: w.tick, side: m.possession, cause: 'CATCH' });
            } else if (m.teams[m.possession].catchStreak > 0) {
              this.bus.emit({ type: 'overdrive.charge', tick: w.tick, side: m.possession, progress: m.teams[m.possession].catchStreak / 3 });
            }
          }
          break;
        }
        case 'throw': m.teams[m.possession].stats.passAtt++; break;
        case 'drop': case 'interception':
          breakStreaks(m, m.possession); break;
        case 'tackle': m.teams[other(m.possession)].stats.tackles++; break;
        case 'bigHit': m.teams[other(m.possession)].stats.bigHits++; break;
        case 'fumble': m.teams[other(m.possession)].stats.forcedFumbles++; break;
        default: break;
      }
    }
    this.bus.clearQueue();
  }

  private applyOverdriveFlags(): void {
    const w = this.world; const m = this.state;
    for (const a of w.athletes) a.onFire = m.teams[a.side].overdrive;
    const off = m.teams[m.possession];
    w.hotStreak = off.catchStreak;
    w.hotReceiver = -1;
    if (off.catchStreak > 0) {
      for (let i = 0; i < 7; i++) {
        const cand = w.athletes[i];
        if (cand.side === m.possession && cand.def.number === off.catchStreakReceiver
            && cand.targetButton !== null) { w.hotReceiver = cand.id; break; }
      }
    }
  }

  // ── play resolution ──────────────────────────────────────────────────────

  private endPlay(reason: DeadReason): void {
    const w = this.world;
    w.playPhase = 'DEAD';
    w.deadReason = reason;
    this.setPhase('DEAD_BALL');
  }

  private tickDeadBall(): void {
    const w = this.world;
    stepPlay(w, this.controllers);
    if (this.state.phaseTicks < DEAD_BALL_TICKS) return;
    this.resolveOutcome();
  }

  private tickPostPlay(): void {
    const w = this.world;
    w.playPhase = 'POST';
    stepPlay(w, this.controllers);
    if (this.state.phaseTicks < POST_PLAY_TICKS) return;
    killBall(w);
    this.advanceAfterPlay();
  }

  private pendingNext: 'PLAY_CALL' | 'SCORE_RESOLVE' | 'KICKOFF_SETUP' = 'PLAY_CALL';
  private lastOutcome: PlayOutcome = blankOutcome();

  private resolveOutcome(): void {
    const m = this.state; const w = this.world;
    const reason = w.deadReason ?? 'TACKLE';
    const o = blankOutcome();
    o.reason = reason;
    const dir = dirOf(m.possession);
    const car = carrier(w);
    const b = w.ball;

    // Where did it end up?
    let spotZ = b.z;
    let spotX = b.x;
    if (car) { spotZ = car.z; spotX = car.x; }
    o.possessionAfter = m.possession;

    const ballSide: TeamSide = car ? car.side : b.possession;
    const changed = ballSide !== m.possession;

    switch (reason) {
      case 'INCOMPLETE':
        o.spotZ = m.losZ; o.spotX = 0; o.yards = 0;
        break;
      case 'TOUCHDOWN': {
        o.scoringSide = ballSide;
        o.scoreKind = 'TD';
        o.spotZ = goalOf(ballSide); o.spotX = spotX;
        o.yards = changed ? 0 : (spotZ - m.losZ) * dir;
        if (car) {
          const st = m.teams[ballSide].stats;
          if (w.special !== null) { /* return TD — not a scrimmage stat */ }
          else if (w.passThrown && !changed) st.passTd++;
          else st.rushTd++;
          this.bus.emit({ type: 'touchdown', tick: w.tick, side: ballSide, by: car.id, yards: Math.round(o.yards) });
        }
        break;
      }
      case 'SAFETY':
        o.scoringSide = other(ballSide);
        o.scoreKind = 'SAFETY';
        o.spotZ = spotZ; o.spotX = spotX;
        this.bus.emit({ type: 'safety', tick: w.tick, against: ballSide });
        break;
      case 'FIELD_GOAL_GOOD':
        if (this.conversionActive) break;   // a PAT is resolved by the conversion path
        o.scoringSide = m.possession; o.scoreKind = 'FG';
        this.bus.emit({ type: 'fieldGoal.result', tick: w.tick, side: m.possession, good: true, distance: fieldGoalDistance(w, m.possession) });
        break;
      case 'FIELD_GOAL_MISS': {
        if (this.conversionActive) break;
        const back = m.losZ - dir * 7;
        const spot = dir > 0 ? Math.min(back, 100 - TOUCHBACK_Z) : Math.max(back, TOUCHBACK_Z);
        o.turnover = true; o.turnoverKind = 'MISSED_FG';
        o.possessionAfter = other(m.possession);
        o.spotZ = clampSpot(dir > 0 ? Math.max(spot, TOUCHBACK_Z) : Math.min(spot, 100 - TOUCHBACK_Z));
        this.bus.emit({ type: 'fieldGoal.result', tick: w.tick, side: m.possession, good: false, distance: fieldGoalDistance(w, m.possession) });
        break;
      }
      default: {
        o.spotZ = spotZ; o.spotX = spotX;
        o.yards = changed ? 0 : (spotZ - m.losZ) * dir;
        break;
      }
    }

    // Kick plays hand the ball to the receiving team.
    if (w.special === 'KICKOFF' || w.special === 'ONSIDE' || w.special === 'PUNT') {
      this.resolveKickPlay(o, reason, ballSide, spotZ, spotX);
    } else if (reason === 'TOUCHBACK') {
      // Either a turnover taken inside the recovering team's own end zone, or a loose ball out
      // through the end zone the offence was attacking. Either way the DEFENCE takes over on 20.
      const to: TeamSide = car ? car.side : other(m.possession);
      o.turnover = true;
      o.touchback = true;
      o.possessionAfter = to;
      o.turnoverKind = w.passThrown && !w.handedOff ? 'INT' : 'FUMBLE';
      o.spotZ = touchbackSpot(to);
      o.spotX = 0;
      this.bus.emit({ type: 'turnover', tick: w.tick, to, kind: o.turnoverKind });
      this.bus.emit({ type: 'touchback', tick: w.tick });
    } else if (changed && o.scoreKind === null) {
      o.turnover = true;
      o.possessionAfter = ballSide;
      o.turnoverKind = w.passThrown && !w.handedOff ? 'INT' : 'FUMBLE';
      o.spotZ = clampSpot(spotZ);
      // Touchback if the change happened in the recovering team's own end zone.
      const ownGoal = ballSide === 0 ? 0 : 100;
      if (ballSide === 0 ? spotZ <= 0 : spotZ >= 100) { o.touchback = true; }
      this.bus.emit({ type: 'turnover', tick: w.tick, to: ballSide, kind: o.turnoverKind });
      void ownGoal;
    }

    // Out of bounds behind the goal line on a non-scoring play → touchback.
    if (reason === 'OUT_OF_BOUNDS' && !o.turnover && o.scoreKind === null) {
      if (Math.abs(o.spotX) > FIELD_HALF_WIDTH) o.spotX = Math.sign(o.spotX) * (FIELD_HALF_WIDTH - 1.2);
    }

    // Stats: rushing vs passing yardage. A sack is not a rushing attempt.
    const wasSack = !w.passThrown && !w.handedOff && w.special === null && car !== null
      && car.id === w.qbId && (spotZ - m.losZ) * dir < -0.5
      && (reason === 'TACKLE' || reason === 'SAFETY');
    if (!o.turnover && o.scoreKind !== 'SAFETY' && reason !== 'INCOMPLETE' && !wasSack) {
      const st = m.teams[m.possession].stats;
      if (w.passThrown) st.passYds += Math.round(o.yards);
      else if (w.special === null) { st.rushAtt++; st.rushYds += Math.round(o.yards); }
    }

    // Sack bookkeeping / Overdrive.
    if (wasSack && reason === 'TACKLE' && car) {
      const def = other(m.possession);
      m.teams[def].stats.sacks++;
      this.bus.emit({ type: 'sack', tick: w.tick, by: -1, on: car.id, yards: Math.round(o.yards) });
      const res = noteSack(m, def);
      if (res.started) {
        this.applyOverdriveFlags();
        this.bus.emit({ type: 'overdrive.start', tick: w.tick, side: def, cause: 'SACK' });
      }
      if (extinguish(m, m.possession)) {
        this.applyOverdriveFlags();
        this.bus.emit({ type: 'overdrive.end', tick: w.tick, side: m.possession, cause: 'sacked' });
      }
    } else if (reason !== 'INCOMPLETE') {
      m.teams[other(m.possession)].sackStreak = 0;
    }

    if (reason === 'INCOMPLETE' || o.turnover) breakStreaks(m, m.possession);

    this.bus.emit({ type: 'play.end', tick: w.tick, reason, spotZ: o.spotZ, yards: Math.round(o.yards) });
    this.lastOutcome = o;

    // Conversion plays never touch the down/score machinery — a PAT is not a field goal.
    if (m.phase === 'DEAD_BALL' && this.conversionActive) {
      this.setPhase('CONVERSION_RESOLVE');
      return;
    }

    this.pendingNext = applyOutcome(m, o);
    if (o.firstDown) {
      this.bus.emit({ type: 'firstDown', tick: w.tick, side: m.possession });
      if (extinguish(m, other(m.possession))) {
        this.applyOverdriveFlags();
        this.bus.emit({ type: 'overdrive.end', tick: w.tick, side: other(m.possession), cause: 'first down allowed' });
      }
    }
    if (o.turnoverKind === 'DOWNS') this.bus.emit({ type: 'turnover', tick: w.tick, to: m.possession, kind: 'DOWNS' });
    this.setPhase('POST_PLAY');
  }

  private resolveKickPlay(o: PlayOutcome, reason: DeadReason, ballSide: TeamSide, spotZ: number, spotX: number): void {
    const m = this.state; const w = this.world;
    const kicking = m.possession;
    const receiving = other(kicking);
    o.scoreKind = o.scoreKind === 'TD' ? 'TD' : null;
    o.turnover = false;
    o.turnoverKind = null;

    if (reason === 'TOUCHDOWN') {
      o.scoringSide = ballSide; o.scoreKind = 'TD';
      return;
    }
    if (reason === 'SAFETY') { o.scoringSide = other(ballSide); o.scoreKind = 'SAFETY'; return; }
    if (reason === 'TOUCHBACK') {
      o.possessionAfter = receiving;
      o.touchback = true;
      o.spotZ = touchbackSpot(receiving);
      o.spotX = 0;
      o.turnover = true;
      o.turnoverKind = w.special === 'PUNT' ? 'PUNT' : null;
      this.bus.emit({ type: 'touchback', tick: w.tick });
      return;
    }

    // Only an actual carrier can claim a kicked ball. An untouched ball belongs to the
    // receiving team wherever it stopped — otherwise a punt that nobody fields would
    // silently stay with the kicking team.
    const car = carrier(w);
    const recovered: TeamSide = car ? car.side : receiving;
    const isOnside = w.special === 'ONSIDE';
    const isPunt = w.special === 'PUNT';

    let spot = car ? car.z : w.ball.z;
    // Ball dead in the receiving team's own end zone (or through it) → touchback.
    const inRecvEndzone = recovered === 0 ? spot <= 0.01 : spot >= 99.99;
    if (inRecvEndzone && !isOnside) {
      o.touchback = true;
      spot = touchbackSpot(recovered);
      this.bus.emit({ type: 'touchback', tick: w.tick });
    }

    o.possessionAfter = recovered;
    o.spotZ = clampSpot(spot);
    o.spotX = clamp(car ? car.x : w.ball.x, -FIELD_HALF_WIDTH + 2, FIELD_HALF_WIDTH - 2);
    o.turnover = true;                 // forces the possession-assignment path
    o.turnoverKind = isPunt ? 'PUNT' : null;
    if (recovered === kicking) {
      // Onside recovery, or the kicking team fell on a muffed return.
      this.bus.emit({ type: 'turnover', tick: w.tick, to: kicking, kind: 'FUMBLE' });
    }
    void spotX; void ballSide;
  }

  private advanceAfterPlay(): void {
    const m = this.state;
    // Quarter boundary check happens after the play completes.
    if (m.clockTicks <= 0 && this.pendingNext !== 'SCORE_RESOLVE') {
      this.endQuarter();
      return;
    }
    switch (this.pendingNext) {
      case 'SCORE_RESOLVE': this.setPhase('SCORE_RESOLVE'); break;
      case 'KICKOFF_SETUP': this.setPhase('KICKOFF_SETUP'); break;
      default: this.setPhase('PLAY_CALL'); break;
    }
  }

  private tickScoreResolve(): void {
    const m = this.state;
    if (m.phaseTicks < SCORE_CELEBRATION_TICKS) return;
    const ps = m.pendingScore;
    m.pendingScore = null;
    if (!ps) { this.setPhase('PLAY_CALL'); return; }
    if (ps.kind === 'TD') {
      m.possession = ps.side;
      m.down = 1;
      m.losZ = conversionSpot(ps.side, false);
      m.firstDownZ = computeFirstDown(m.losZ, ps.side);
      this.pendingConversion = null;
      this.setPhase('CONVERSION_CALL');
      return;
    }
    if (ps.kind === 'SAFETY') {
      // Team scored upon free-kicks from their own 20.
      const conceding = other(ps.side);
      m.kickoffReceiving = ps.side;
      this.freeKickAfterSafety = true;
      void conceding;
      if (this.checkEndAfterScore()) return;
      this.setPhase('KICKOFF_SETUP');
      return;
    }
    m.kickoffReceiving = other(ps.side);
    if (this.checkEndAfterScore()) return;
    this.setPhase('KICKOFF_SETUP');
  }

  private checkEndAfterScore(): boolean {
    const m = this.state;
    if (m.clockTicks > 0) return false;
    this.endQuarter();
    return true;
  }

  // ── conversions ──────────────────────────────────────────────────────────

  private tickConversionCall(): void {
    const m = this.state;
    if (m.phaseTicks > s(6) && !this.pendingConversion) this.pendingConversion = 'KICK';
    if (!this.pendingConversion) return;

    const w = this.world;
    m.conversionChoice = this.pendingConversion;
    if (this.pendingConversion === 'KICK') {
      const good = this.rng.chance(PAT_MAKE_BASE);
      assignUnits(w, m.possession, true);
      const spot = conversionSpot(m.possession, false);
      m.losZ = spot;
      m.firstDownZ = computeFirstDown(spot, m.possession);
      w.special = 'FIELD_GOAL';
      setupPlay(w, { offense: FG_OFFENSE, defense: FG_DEFENSE, losZ: spot, spotX: 0, possession: m.possession });
      const kicker = w.athletes[OFF_START];
      w.playPhase = 'LIVE';
      launchExtraPoint(w, kicker, good);
      this.conversionTwoActive = false;
      this.conversionActive = true;
      this.patGood = good;
      this.setPhase('CONVERSION_LIVE');
      void PAT_DISTANCE;
    } else {
      assignUnits(w, m.possession, false);
      const sit = readSituation(m, m.possession);
      const off = chooseOffensePlay(this.offensePlays.filter((p) => p.shortYardage > 0.35), sit, this.profile, this.rng);
      const def = chooseDefensePlay(this.defensePlays, sit, this.tendency[m.possession], this.profile, this.rng);
      const spot = conversionSpot(m.possession, true);
      m.losZ = spot;
      m.firstDownZ = computeFirstDown(spot, m.possession);
      w.special = null;
      setupPlay(w, { offense: off ?? this.offensePlays[0], defense: def, losZ: spot, spotX: 0, possession: m.possession });
      this.conversionTwoActive = true;
      this.conversionActive = true;
      m.down = 1;
      this.setPhase('PRE_SNAP');
    }
    this.applyOverdriveFlags();
  }

  private patGood = false;
  private clockRemainder = 0;

  private tickConversionResolve(): void {
    const m = this.state; const w = this.world;
    if (m.phaseTicks === 1) {
      if (m.conversionChoice === 'KICK') {
        if (this.patGood) m.teams[m.possession].score += 1;
        this.bus.emit({ type: 'extraPoint', tick: w.tick, side: m.possession, good: this.patGood });
      } else {
        const o = this.lastOutcome;
        const scored = o.reason === 'TOUCHDOWN';
        const scorer = scored ? (carrier(w)?.side ?? m.possession) : null;
        if (scored && scorer !== null) m.teams[scorer].score += 2;
        this.bus.emit({ type: 'twoPoint', tick: w.tick, side: m.possession, good: !!scored });
      }
      this.conversionTwoActive = false;
      this.conversionActive = false;
      m.conversionChoice = null;
      killBall(w);
    }
    if (m.phaseTicks < s(1.2)) return;
    m.kickoffReceiving = other(m.possession);
    if (this.checkEndAfterScore()) return;
    this.setPhase('KICKOFF_SETUP');
  }

  // ── quarters ─────────────────────────────────────────────────────────────

  private endQuarter(): void {
    const m = this.state;
    this.bus.emit({ type: 'quarter.end', tick: this.world.tick, quarter: m.quarter });
    if (m.quarter === 2) { this.setPhase('HALFTIME'); return; }
    if (m.quarter >= 4) {
      if (matchShouldEnd(m)) { this.finish(); return; }
      this.setPhase('OVERTIME_SETUP');
      return;
    }
    this.setPhase('QUARTER_BREAK');
  }

  private tickQuarterBreak(): void {
    const m = this.state;
    if (m.phaseTicks < QUARTER_BREAK_TICKS) return;
    m.quarter++;
    m.clockTicks = m.quarterTicks;
    this.setPhase('PLAY_CALL');
  }

  private tickHalftime(): void {
    const m = this.state;
    if (m.phaseTicks === 1) this.bus.emit({ type: 'half', tick: this.world.tick });
    if (m.phaseTicks < QUARTER_BREAK_TICKS * 1.6) return;
    m.quarter = 3;
    m.clockTicks = m.quarterTicks;
    m.kickoffReceiving = m.secondHalfReceiver;
    this.setPhase('KICKOFF_SETUP');
  }

  private tickOvertimeSetup(): void {
    const m = this.state;
    if (m.phaseTicks === 1) {
      m.quarter++;
      m.overtimePeriod++;
      m.clockTicks = Math.max(s(45), Math.round(m.quarterTicks * 0.75));
      m.kickoffReceiving = m.overtimePeriod % 2 === 1 ? other(m.secondHalfReceiver) : m.secondHalfReceiver;
      this.bus.emit({ type: 'overtime', tick: this.world.tick, period: m.overtimePeriod });
    }
    if (m.phaseTicks < QUARTER_BREAK_TICKS) return;
    // Beyond the timed periods we switch to sudden death so a winner always emerges.
    this.setPhase('KICKOFF_SETUP');
  }

  private finish(): void {
    const m = this.state;
    m.finished = true;
    m.winner = winnerOf(m);
    this.setPhase('FINAL');
    this.bus.emit({ type: 'match.end', tick: this.world.tick, winner: m.winner });
  }

  /** In sudden death (past OT3) any score ends the match immediately. */
  private get suddenDeath(): boolean { return this.state.overtimePeriod >= OVERTIME_PERIODS; }

  // ── helpers for UI/tests ─────────────────────────────────────────────────

  /** Test hook: re-run the CPU play-call for the state the harness just installed. */
  forcePlayCallForTest(): void {
    this.pendingOffense = null; this.pendingDefense = null; this.pendingSpecial = null;
    this.offenseLocked = false; this.defenseLocked = false;
    this.world.special = null;
    if (!this.isHuman(this.state.possession)) this.autoPickOffense();
    if (!this.isHuman(other(this.state.possession))) this.autoPickDefense();
  }

  checkInvariants(): Violation[] {
    const v = validateMatchState(this.state);
    try { assertBallInvariant(this.world); } catch (e) { v.push({ code: 'BALL', detail: String(e) }); }
    for (const a of this.world.athletes) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) v.push({ code: 'ATHLETE_NAN', detail: `#${a.id}` });
      if (Math.abs(a.x) > 60 || a.z < -30 || a.z > 130) v.push({ code: 'ATHLETE_OOB', detail: `#${a.id} ${a.x.toFixed(1)},${a.z.toFixed(1)}` });
    }
    if (this.state.phase === 'LIVE' && this.world.ball.state.kind === 'dead') {
      v.push({ code: 'LIVE_DEAD_BALL', detail: 'live play with a dead ball' });
    }
    this.violations.push(...v);
    return v;
  }

  get watchdogCount(): number { return this.watchdogFired; }

  result(): MatchResult {
    const m = this.state;
    return {
      homeScore: m.teams[0].score,
      awayScore: m.teams[1].score,
      winner: m.winner ?? winnerOf(m),
      quarters: m.quarter,
      overtime: m.overtimePeriod,
      stats: [m.teams[0].stats, m.teams[1].stats],
      ticks: this.world.tick,
      eventCounts: this.bus.counts(),
      seed: this.config.seed,
    };
  }

  dispose(): void { this.bus.dispose(); }
}

export function defaultSeats(): MatchConfig['seats'] {
  return [
    { side: 0, active: true },
    { side: 1, active: false },
    { side: 0, active: false },
    { side: 1, active: false },
  ];
}

export function defaultMatchConfig(partial: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 12345, home: '', away: '', stadium: '', weather: 'CLEAR',
    quarterSeconds: DEFAULT_QUARTER_SECONDS, difficulty: 'PRO', playClock: false,
    seats: defaultSeats(), catchUpBias: true, lateHits: false, mode: 'QUICKPLAY',
    ...partial,
  };
}

export { clamp01, dist, FIXED_DT, giveBall, dropLoose, computeFirstDown, BLANK };
