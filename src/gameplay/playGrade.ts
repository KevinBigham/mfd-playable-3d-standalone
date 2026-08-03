/**
 * Deterministic play-grade facts: what actually happened on the throw, stated only when the
 * evidence supports it.
 *
 * The tracker derives facts from the world at the moment of release — openness, leverage,
 * timing against the play's own clock, placement direction, pressure — and closes them with the
 * outcome. It never invents blame: when the classification is ambiguous the confidence drops and
 * the UI is expected to say less, not more. The same facts feed the live chip, the drive
 * results, the policy probes, and (behind its flag) the skill-based Overdrive charge.
 *
 * Pure derivation: nothing here writes to the simulation, and identical inputs produce
 * identical facts.
 */
import type { Match } from '../rules/match.ts';
import type { GameEvent } from '../core/types.ts';
import { s } from '../core/constants.ts';

export type GradeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PlayGradeFacts {
  version: 1;
  /** Athlete id of the chosen receiver, when there was a throw. */
  targetChosen?: number;
  /** Nearest-defender distance to the receiver at release, yards. */
  opennessAtRelease?: number;
  /** Where the nearest defender stood relative to the receiver's route depth. */
  leverage?: 'SAFE_SIDE' | 'NEUTRAL' | 'DANGER_SIDE';
  releaseTiming?: 'EARLY' | 'ON_TIME' | 'LATE';
  /** Placement direction relative to the covering defender, when the passer aimed. */
  placement?: 'SAFE' | 'NEUTRAL' | 'DANGEROUS';
  pressure?: 'CLEAN' | 'HURRIED' | 'HIT';
  /** Terminal outcome of the play's throw, in ledger vocabulary. */
  result: string;
  confidence: GradeConfidence;
  /** The measurable evidence behind the labels, for receipts and tuning. */
  evidence: string[];
}

/** Short, honest chip text for a finished throw. Null when confidence is too low to assert. */
export function chipFor(f: PlayGradeFacts): string | null {
  if (f.confidence === 'LOW') return null;
  const bits: string[] = [];
  if (f.opennessAtRelease !== undefined) bits.push(f.opennessAtRelease >= 4 ? 'OPEN' : f.opennessAtRelease <= 1.8 ? 'COVERED' : '');
  if (f.releaseTiming && f.releaseTiming !== 'ON_TIME') bits.push(f.releaseTiming);
  else if (f.releaseTiming === 'ON_TIME' && bits[0] === 'OPEN') bits.push('ON TIME');
  if (f.pressure === 'HIT') bits.push('PRESSURE FORCED IT');
  if (f.placement === 'SAFE') bits.push('PLACED AWAY');
  else if (f.placement === 'DANGEROUS') bits.push('INTO COVERAGE');
  const text = bits.filter(Boolean).join(' · ');
  return text || null;
}

export class PlayGradeTracker {
  /** Completed facts, one per resolved throw, in order. */
  readonly facts: PlayGradeFacts[] = [];
  private open: PlayGradeFacts | null = null;
  private detach: Array<() => void> = [];

  constructor(private m: Match) {
    this.detach.push(m.bus.on('*', (e: GameEvent) => this.handle(e)));
  }

  dispose(): void { for (const d of this.detach) d(); this.detach.length = 0; }

  private handle(e: GameEvent): void {
    switch (e.type) {
      case 'throw': this.openThrow(e.to); break;
      case 'catch': this.close('CAUGHT'); break;
      case 'drop': this.close('DROPPED'); break;
      case 'swat': this.close('SWATTED'); break;
      case 'interception': this.close('DEFENDER_POSSESSION'); break;
      case 'sack': this.recordSack(); break;
      case 'play.end': this.close('FELL_INCOMPLETE'); break;
      default: break;
    }
  }

  private openThrow(to: number | null): void {
    const w = this.m.world;
    const f: PlayGradeFacts = { version: 1, result: 'PENDING', confidence: 'HIGH', evidence: [] };
    if (to === null) {
      f.confidence = 'LOW';
      f.evidence.push('throwaway: no target');
      this.open = f;
      return;
    }
    const r = w.athletes[to];
    f.targetChosen = to;

    // Openness and leverage at release.
    let near = 99; let defDeeper = false;
    const dir = r.side === 0 ? 1 : -1;
    for (const d of w.athletes) {
      if (d.side === r.side || d.move === 'DOWN') continue;
      const dd = Math.hypot(d.x - r.x, d.z - r.z);
      if (dd < near) { near = dd; defDeeper = (d.z - r.z) * dir > 0.5; }
    }
    f.opennessAtRelease = Math.round(near * 100) / 100;
    f.evidence.push(`nearest defender ${f.opennessAtRelease} yd at release`);
    if (near >= 4) f.leverage = 'SAFE_SIDE';
    else if (near <= 2 && defDeeper) f.leverage = 'DANGER_SIDE';
    else f.leverage = 'NEUTRAL';

    // Timing against the play's own clock.
    const primary = w.offensePlay?.timing?.primary ?? s(1.5);
    const t = w.playTicks;
    f.releaseTiming = t < primary * 0.7 ? 'EARLY' : t <= primary * 1.7 ? 'ON_TIME' : 'LATE';
    f.evidence.push(`released at tick ${t} vs primary ${primary}`);

    // Pressure at release.
    const qb = w.athletes[w.qbId];
    let rush = 99;
    for (const d of w.athletes) {
      if (d.side === qb.side || d.move === 'DOWN') continue;
      rush = Math.min(rush, Math.hypot(d.x - qb.x, d.z - qb.z));
    }
    f.pressure = rush < 1.6 ? 'HIT' : rush < 3.2 ? 'HURRIED' : 'CLEAN';
    f.evidence.push(`nearest rusher ${rush.toFixed(2)} yd`);

    // Placement, only when the passer actually aimed: direction of the aim vector vs the
    // defender-to-receiver line. No aim, no placement fact — never grade what nobody did.
    const it = w.intents[w.qbId];
    const am = Math.hypot(it.aimX, it.aimZ);
    const moving = Math.hypot(it.moveX - it.aimX, it.moveZ - it.aimZ) > 1e-6;
    if (am > 0.25 && moving && near < 90) {
      let nx = 0; let nz = 0; let nd = 99;
      for (const d of w.athletes) {
        if (d.side === r.side || d.move === 'DOWN') continue;
        const dd = Math.hypot(d.x - r.x, d.z - r.z);
        if (dd < nd) { nd = dd; nx = d.x; nz = d.z; }
      }
      const awayX = r.x - nx; const awayZ = r.z - nz;
      const alen = Math.hypot(awayX, awayZ) || 1;
      const dot = (it.aimX / am) * (awayX / alen) + (it.aimZ / am) * (awayZ / alen);
      f.placement = dot > 0.35 ? 'SAFE' : dot < -0.35 ? 'DANGEROUS' : 'NEUTRAL';
      f.evidence.push(`aim·away = ${dot.toFixed(2)}`);
    }

    if (f.leverage === 'NEUTRAL' && near > 2 && near < 4) f.confidence = 'MEDIUM';
    this.open = f;
  }

  private recordSack(): void {
    this.facts.push({
      version: 1, result: 'SACKED', pressure: 'HIT', confidence: 'HIGH',
      evidence: ['sack event'],
    });
  }

  private close(result: string): void {
    if (!this.open) return;
    this.open.result = result;
    this.facts.push(this.open);
    this.open = null;
  }
}
