import type { GameEvent, TeamDef, TeamSide } from '../core/types.ts';
import type { Match } from '../rules/match.ts';
import { el, clear, fmtClock, ordinal } from './uiKit.ts';
import { distanceToGo, isAndGoal, goalOf, dirOf } from '../rules/rulesEngine.ts';
import { clamp01 } from '../core/math.ts';

interface TurboRow { wrap: HTMLElement; fill: HTMLElement; bar: HTMLElement; tag: HTMLElement }

export class Hud {
  private root: HTMLElement;
  private top!: HTMLElement;
  private teamEls: HTMLElement[] = [];
  private scoreEls: HTMLElement[] = [];
  private clockEl!: HTMLElement;
  private qtrEl!: HTMLElement;
  private downEl!: HTMLElement;
  private msgEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private odEl!: HTMLElement;
  private turboLeft!: HTMLElement;
  private turboRight!: HTMLElement;
  private turboRows: TurboRow[] = [];
  private match: Match | null = null;
  private teams: [TeamDef, TeamDef] | null = null;
  private msgTimer = 0;
  private helpTimer = 0;
  showHelp = true;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.setVisible(false);
  }

  private build(): void {
    clear(this.root);
    this.top = el('div', 'hud-top');
    for (let i = 0; i < 2; i++) {
      const t = el('div', 'hud-team');
      const abbr = el('span', 'abbr', '---');
      const pts = el('span', 'pts', '0');
      t.append(abbr, pts);
      this.teamEls.push(t); this.scoreEls.push(pts);
      (t as HTMLElement).dataset.side = String(i);
    }
    const mid = el('div', 'hud-mid');
    this.clockEl = el('div', 'clock', '2:00');
    this.qtrEl = el('div', 'qtr', '1ST');
    mid.append(this.clockEl, this.qtrEl);
    this.top.append(this.teamEls[0], mid, this.teamEls[1]);

    this.downEl = el('div', 'hud-down', '1ST & 30');
    this.odEl = el('div', 'hud-od', '');
    this.msgEl = el('div', 'hud-msg', '');
    this.helpEl = el('div', 'hud-help', '');
    this.turboLeft = el('div', 'hud-turbo p-left');
    this.turboRight = el('div', 'hud-turbo p-right');

    this.root.append(this.top, this.downEl, this.odEl, this.msgEl, this.helpEl, this.turboLeft, this.turboRight);
  }

  attachMatch(m: Match, home: TeamDef, away: TeamDef): void {
    this.match = m;
    this.teams = [home, away];
    for (let i = 0; i < 2; i++) {
      const t = this.teams[i];
      const abbr = this.teamEls[i].querySelector('.abbr') as HTMLElement;
      abbr.textContent = t.abbr;
      this.teamEls[i].style.borderColor = t.colors.primary;
      this.teamEls[i].style.background = `linear-gradient(180deg, ${t.colors.primary}cc, #0c1322)`;
      abbr.style.color = t.colors.ink;
    }
    this.buildTurbo();
    this.setVisible(true);
  }

  detach(): void { this.match = null; this.setVisible(false); }

  setVisible(v: boolean): void { this.root.style.display = v ? 'block' : 'none'; }

  private buildTurbo(): void {
    clear(this.turboLeft); clear(this.turboRight);
    this.turboRows = [];
    const m = this.match;
    if (!m) return;
    const seatColors = ['#3fd0ff', '#ff5a4a', '#ffd23f', '#78ff8a'];
    m.config.seats.forEach((seat, i) => {
      if (!seat.active) { this.turboRows.push(null as unknown as TurboRow); return; }
      const row = el('div', 'turbo-row');
      const tag = el('span', 'turbo-tag', `P${i + 1}`);
      tag.style.color = seatColors[i];
      const bar = el('div', 'turbo-bar');
      const fill = el('i');
      bar.appendChild(fill);
      row.append(tag, bar);
      (seat.side === 0 ? this.turboLeft : this.turboRight).appendChild(row);
      this.turboRows.push({ wrap: row, fill, bar, tag });
    });
  }

  message(text: string, holdSeconds = 1.6): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.remove('show');
    void this.msgEl.offsetWidth;
    this.msgEl.classList.add('show');
    this.msgTimer = holdSeconds;
  }

  help(text: string, seconds = 4): void {
    if (!this.showHelp) return;
    this.helpEl.textContent = text;
    this.helpEl.style.opacity = '1';
    this.helpTimer = seconds;
  }

  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'touchdown': this.message('TOUCHDOWN!', 2.4); break;
      case 'interception': this.message('INTERCEPTED!', 2.0); break;
      case 'fumble': this.message('FUMBLE!', 1.8); break;
      case 'sack': this.message('SACK!', 1.4); break;
      case 'firstDown': this.message('FIRST DOWN', 1.1); break;
      case 'safety': this.message('SAFETY!', 2.0); break;
      case 'bigHit': if (e.power > 1.7) this.message('BIG HIT!', 0.9); break;
      case 'overdrive.start': this.message('OVERDRIVE!', 1.8); break;
      case 'fieldGoal.result': this.message(e.good ? 'IT’S GOOD!' : 'NO GOOD', 1.6); break;
      case 'extraPoint': this.message(e.good ? 'EXTRA POINT' : 'MISSED PAT', 1.2); break;
      case 'twoPoint': this.message(e.good ? 'TWO POINTS!' : 'NO GOOD', 1.4); break;
      case 'turnover': if (e.kind === 'DOWNS') this.message('TURNOVER ON DOWNS', 1.6); break;
      case 'quarter.end': this.message(`END OF ${ordinal(e.quarter)}`, 1.6); break;
      case 'half': this.message('HALFTIME', 2.0); break;
      case 'overtime': this.message(`OVERTIME ${e.period}`, 2.2); break;
      case 'match.end': this.message('FINAL', 2.4); break;
      default: break;
    }
  }

  update(dt: number): void {
    const m = this.match;
    if (!m || !this.teams) return;
    const st = m.state;

    for (let i = 0; i < 2; i++) {
      this.scoreEls[i].textContent = String(st.teams[i].score);
      this.teamEls[i].classList.toggle('poss', st.possession === i);
    }
    this.clockEl.textContent = fmtClock(st.clockTicks);
    this.qtrEl.textContent = ordinal(st.quarter);

    const andGoal = isAndGoal(st);
    const dist = Math.max(1, Math.round(distanceToGo(st)));
    const downName = ['1ST', '2ND', '3RD', '4TH'][Math.min(3, Math.max(0, st.down - 1))];
    const phase = st.phase;
    if (phase === 'KICKOFF_SETUP' || phase === 'KICKOFF_LIVE') this.downEl.textContent = 'KICKOFF';
    else if (phase === 'CONVERSION_CALL' || phase === 'CONVERSION_LIVE') this.downEl.textContent = 'CONVERSION';
    else this.downEl.textContent = andGoal ? `${downName} & GOAL` : `${downName} & ${dist}`;

    // Overdrive readout.
    let od = '';
    for (const side of [0, 1] as TeamSide[]) {
      const t = st.teams[side];
      if (t.overdrive) od += `${this.teams[side].abbr} OVERDRIVE  `;
      else if (t.catchStreak > 0) od += `${this.teams[side].abbr} ${t.catchStreak}/3  `;
      else if (t.sackStreak > 0) od += `${this.teams[side].abbr} SACK ${t.sackStreak}/2  `;
    }
    this.odEl.textContent = od.trim();

    // Turbo bars.
    const w = m.world;
    m.config.seats.forEach((seat, i) => {
      const row = this.turboRows[i];
      if (!row || !seat.active) return;
      let athlete = null;
      for (const a of w.athletes) if (a.controlledBySeat === i) { athlete = a; break; }
      const v = athlete ? clamp01(athlete.turbo / 100) : 0;
      row.fill.style.width = `${v * 100}%`;
      row.bar.classList.toggle('fire', !!athlete?.onFire);
      row.tag.textContent = athlete ? `P${i + 1} #${athlete.def.number}` : `P${i + 1}`;
    });

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msgEl.classList.remove('show');
    }
    if (this.helpTimer > 0) {
      this.helpTimer -= dt;
      if (this.helpTimer <= 0) this.helpEl.style.opacity = '0';
    }
    void goalOf; void dirOf;
  }
}
