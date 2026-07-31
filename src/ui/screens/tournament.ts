import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, clear, FocusRing, driveFocus, button, optionRow, panel, svgNode } from '../uiKit.ts';
import type { Game } from '../../app/Game.ts';
import type { Difficulty } from '../../core/types.ts';
import { TEAMS, TEAM_IDS, findTeam, findStadium, teamLogoSvg } from '../../data/index.ts';
import { QUARTER_OPTIONS } from '../../core/constants.ts';
import { Rng } from '../../core/rng.ts';
import { getSave, writeSave, type TournamentSave } from '../../persistence/save.ts';
import {
  BYE, advanceRound, bracketSeedOrder, createTournament, isHumanMatch, isHumanTeam,
  isValidTournament, matchSeed, matchWinner, matchesInRound, nextMatch, reportResult,
  roundName, seatsFor, seedOf, seriesLeader, simulateCpuMatch, tieBreakWinner, totalRounds, venueFor,
  winsNeeded, type TournamentMatchup,
} from '../../modes/tournament.ts';

type View = 'HOME' | 'SETUP' | 'PICK' | 'SEED' | 'BRACKET' | 'CHAMPION';

const DIFFS: Difficulty[] = ['ROOKIE', 'PRO', 'ALLSTAR', 'LEGEND'];
const SIZES = [4, 8] as const;

interface SetupState {
  size: 4 | 8;
  bestOf3: boolean;
  humans: number;
  quarterSeconds: number;
  difficulty: Difficulty;
  manual: boolean;
  seed: number;
}

interface SimState {
  active: boolean;
  mode: 'ONE' | 'ROUND';
  target: { round: number; index: number } | null;
  delay: number;
  fast: boolean;
}

/**
 * The knockout ladder screen: build the field, then work down the bracket one
 * match at a time. Matches with a human in them launch the real game; CPU-only
 * matches run through the same engine headlessly and report straight back into
 * the bracket. Every mount rebuilds from the save file, because finishing a
 * match resets the screen stack underneath us.
 */
export class TournamentScreen implements Screen {
  name = 'tournament';
  private node: HTMLElement | null = null;
  private ring = new FocusRing();
  private ctx!: ScreenContext;
  private nav!: ScreenContext;
  private view: View = 'SETUP';
  private t: TournamentSave | null = null;
  private setup: SetupState = TournamentScreen.freshSetup();
  private picks: string[] = [];
  private pickIndex = 0;
  private field: string[] = [];
  private sim: SimState = { active: false, mode: 'ONE', target: null, delay: 0, fast: false };
  private results: string[] = [];
  private status = '';
  private lastView: View | null = null;
  private keepFocus = false;
  /** Once a match has been launched the screen stack is reset behind us. */
  private stackReset = false;
  private returning = false;

  constructor(private game: Game) {}

  private static freshSetup(): SetupState {
    return { size: 8, bestOf3: false, humans: 1, quarterSeconds: 120, difficulty: 'PRO', manual: false, seed: 1 };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.nav = { ...ctx, back: () => this.onBack() };
    this.game.input.refreshPads();
    this.game.audio.music.start();
    this.sim = { active: false, mode: 'ONE', target: null, delay: 0, fast: false };
    this.results = [];
    this.status = '';
    this.lastView = null;

    const save = getSave();
    if (save.tournament && !isValidTournament(save.tournament)) {
      save.tournament = null;
      writeSave();
    }
    this.t = save.tournament;

    if (this.t && this.t.champion) this.view = 'CHAMPION';
    else if (this.t && this.returning) this.view = 'BRACKET';
    else if (this.t) this.view = 'HOME';
    else { this.resetSetup(); this.view = 'SETUP'; }
    this.returning = false;

    const s = el('div', 'go-screen');
    s.appendChild(el('div', 'go-dim'));
    ctx.root.appendChild(s);
    this.node = s;
    this.render();
  }

  unmount(): void {
    this.sim.active = false;
    this.node?.remove();
    this.node = null;
  }

  update(dt: number): void {
    if (this.sim.active) {
      this.sim.delay -= this.sim.fast ? dt * 6 : dt;
      if (this.sim.delay <= 0) this.simStep();
    }
    driveFocus(this.ring, this.ctx.input, this.nav);
  }

  // ── navigation ──────────────────────────────────────────────────────────
  private onBack(): void {
    switch (this.view) {
      case 'PICK':
        if (this.pickIndex > 0) { this.pickIndex--; this.picks.pop(); this.render(); }
        else { this.view = 'SETUP'; this.render(); }
        break;
      case 'SEED':
        this.pickIndex = Math.max(0, this.setup.humans - 1);
        this.picks = this.picks.slice(0, this.pickIndex);
        this.view = 'PICK';
        this.render();
        break;
      case 'SETUP':
        if (this.t) { this.view = 'HOME'; this.render(); } else this.exit();
        break;
      default:
        this.exit();
        break;
    }
  }

  private exit(): void {
    this.sim.active = false;
    if (this.stackReset) this.ctx.reset('mainMenu');
    else this.ctx.back();
  }

  private resetSetup(): void {
    const st = this.game.settings;
    this.setup = {
      ...TournamentScreen.freshSetup(),
      quarterSeconds: st.quarterSeconds,
      difficulty: st.difficulty,
      seed: ((Date.now() & 0x7fffffff) >>> 0) || 1,
    };
    this.picks = [];
    this.pickIndex = 0;
    this.field = [];
  }

  private save(): void { writeSave({ tournament: this.t }); }

  private abbr(id: string): string {
    const t = findTeam(id);
    return t ? t.abbr : (id === BYE ? '—' : '?');
  }

  private label(id: string): string {
    const t = findTeam(id);
    return t ? `${t.city.toUpperCase()} ${t.name.toUpperCase()}` : 'TO BE DECIDED';
  }

  // ── render dispatch ─────────────────────────────────────────────────────
  private render(): void {
    const s = this.node;
    if (!s) return;
    clear(s);
    s.appendChild(el('div', 'go-dim'));
    // Re-drawing the same view keeps the cursor where it was; changing view resets it.
    this.keepFocus = this.lastView === this.view;
    this.lastView = this.view;
    switch (this.view) {
      case 'HOME': this.renderHome(); break;
      case 'SETUP': this.renderSetup(); break;
      case 'PICK': this.renderPick(); break;
      case 'SEED': this.renderSeed(); break;
      case 'CHAMPION': this.renderChampion(); break;
      default: this.renderBracket(); break;
    }
  }

  private mountPanel(p: HTMLElement, items: FocusItem[]): void {
    this.node?.appendChild(p);
    this.ring.set(items, this.keepFocus);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  // ── continue / new ──────────────────────────────────────────────────────
  private renderHome(): void {
    const t = this.t;
    if (!t) { this.view = 'SETUP'; this.render(); return; }
    const p = panel('TOURNAMENT', 'A ladder is already in progress.');
    const line = el('div', 'row');
    line.append(
      el('span', 'pill', `${t.size}-TEAM`),
      el('span', 'pill', t.bestOf3 ? 'BEST OF 3' : 'SINGLE GAME'),
      el('span', 'pill', roundName(t, t.round)),
    );
    p.appendChild(line);
    const nm = nextMatch(t);
    p.appendChild(el('p', 'muted', nm
      ? `Next up — ${this.label(nm.a)} vs ${this.label(nm.b)}`
      : 'The bracket is ready to advance.'));
    const items: FocusItem[] = [
      button('CONTINUE', () => { this.view = 'BRACKET'; this.render(); }),
      button('NEW TOURNAMENT', () => { this.resetSetup(); this.view = 'SETUP'; this.render(); }),
      button('MAIN MENU', () => this.exit(), 'ghost'),
    ];
    for (const it of items) p.appendChild(it.el);
    this.mountPanel(p, items);
  }

  // ── setup ───────────────────────────────────────────────────────────────
  private renderSetup(): void {
    const st = this.setup;
    const p = panel('TOURNAMENT SETUP', 'Single elimination. Win it or go home.');
    const items: FocusItem[] = [
      optionRow<number>({
        label: 'BRACKET SIZE', values: SIZES, format: (v) => `${v} TEAMS`,
        get: () => st.size,
        set: (v) => { st.size = v === 4 ? 4 : 8; st.humans = Math.min(st.humans, Math.min(4, st.size)); },
      }, () => this.render()),
      optionRow<boolean>({
        label: 'SERIES', values: [false, true], format: (v) => (v ? 'BEST OF 3' : 'SINGLE GAME'),
        get: () => st.bestOf3, set: (v) => { st.bestOf3 = v; },
      }),
      optionRow<number>({
        label: 'HUMAN SEATS', values: [1, 2, 3, 4].filter((n) => n <= Math.min(4, st.size)),
        format: (v) => `${v} PLAYER${v > 1 ? 'S' : ''}`,
        get: () => st.humans, set: (v) => { st.humans = v; },
      }),
      optionRow<boolean>({
        label: 'MATCHUPS', values: [false, true], format: (v) => (v ? 'MANUAL' : 'RANDOM DRAW'),
        get: () => st.manual, set: (v) => { st.manual = v; },
      }),
      optionRow<Difficulty>({
        label: 'DIFFICULTY', values: DIFFS, get: () => st.difficulty, set: (v) => { st.difficulty = v; },
      }),
      optionRow<number>({
        label: 'QUARTER LENGTH', values: QUARTER_OPTIONS, format: (v) => `${v / 60}:00`,
        get: () => st.quarterSeconds, set: (v) => { st.quarterSeconds = v; },
      }),
    ];
    for (const it of items) p.appendChild(it.el);
    p.appendChild(el('p', 'muted',
      'Comeback assist is off on the ladder. Simulated matches use the same engine, teams and settings as the ones you play.'));
    const go = button('CHOOSE TEAMS →', () => {
      this.picks = [];
      this.pickIndex = 0;
      this.applySetupSettings();
      this.view = 'PICK';
      this.render();
    });
    const back = button(this.t ? 'BACK' : 'MAIN MENU', () => this.onBack(), 'ghost');
    items.push(go, back);
    p.append(go.el, back.el);
    this.mountPanel(p, items);
  }

  private applySetupSettings(): void {
    const save = getSave();
    save.settings.difficulty = this.setup.difficulty;
    save.settings.quarterSeconds = this.setup.quarterSeconds;
    this.game.settings = save.settings;
    this.game.applySettings();
  }

  // ── team picking ────────────────────────────────────────────────────────
  private renderPick(): void {
    const p = panel(`PLAYER ${this.pickIndex + 1} — PICK YOUR TEAM`,
      `Seat ${this.pickIndex + 1} of ${this.setup.humans}. The rest of the field is drawn from the circuit.`);
    p.classList.add('wide');
    const grid = el('div', 'go-grid teams');
    const detail = el('div', 'muted');
    detail.style.cssText = 'min-height:44px;margin-top:10px';
    const items: FocusItem[] = [];
    TEAMS.forEach((team, i) => {
      const taken = this.picks.indexOf(team.id) >= 0;
      const card = el('div', 'go-card');
      card.dataset.id = team.id;
      card.appendChild(svgNode(teamLogoSvg(team, 96), 'logo'));
      card.appendChild(el('div', 'ct', team.city.toUpperCase()));
      card.appendChild(el('div', 'nm', team.name.toUpperCase()));
      const bar = el('div', 'bar');
      bar.style.background = team.colors.primary;
      card.appendChild(bar);
      card.style.borderColor = team.colors.primary;
      if (taken) {
        card.style.opacity = '0.32';
        card.appendChild(el('div', 'tag on', 'TAKEN'));
      }
      const pick = (): void => {
        if (taken) { this.ctx.sound('error'); return; }
        this.picks.push(team.id);
        this.pickIndex++;
        if (this.pickIndex < this.setup.humans) { this.render(); return; }
        this.buildField();
        if (this.setup.manual) this.view = 'SEED';
        else this.start();
        this.render();
      };
      card.addEventListener('click', pick);
      card.addEventListener('mouseenter', () => { detail.textContent = this.teamLine(team.id); });
      grid.appendChild(card);
      items.push({ el: card, onSelect: pick, row: Math.floor(i / 5), col: i % 5, disabled: taken });
    });
    p.append(grid, detail);
    const back = button('BACK', () => this.onBack(), 'ghost');
    p.appendChild(back.el);
    items.push({ ...back, row: 99, col: 0 });
    this.mountPanel(p, items);
    const paintDetail = (): void => {
      const cur = this.ring.items[this.ring.index];
      detail.textContent = cur ? this.teamLine((cur.el as HTMLElement).dataset.id ?? '') : '';
    };
    this.ring.onNav = (e) => { this.ctx.sound(e === 'select' ? 'select' : 'move'); paintDetail(); };
    paintDetail();
  }

  private teamLine(id: string): string {
    const t = findTeam(id);
    if (!t) return '';
    return `${t.blurb} · PASS ${t.power.passing} RUN ${t.power.running} LINE ${t.power.line} COV ${t.power.coverage} ST ${t.power.special}`;
  }

  private buildField(): void {
    const rng = new Rng(this.setup.seed);
    const pool = TEAM_IDS.filter((id) => this.picks.indexOf(id) < 0);
    rng.shuffle(pool);
    const cpu = pool.slice(0, Math.max(0, this.setup.size - this.picks.length));
    this.field = [...this.picks, ...cpu];
    if (!this.setup.manual) rng.shuffle(this.field);
  }

  // ── manual draw ─────────────────────────────────────────────────────────
  private renderSeed(): void {
    const p = panel('SET THE DRAW', 'Change a seed to swap two teams. Round one pairs 1 v last, 2 v second-last.');
    p.classList.add('wide');
    const items: FocusItem[] = [];
    const rows = el('div', 'scroll');
    for (let slot = 0; slot < this.field.length; slot++) {
      const row = optionRow<string>({
        label: `SEED ${slot + 1}`,
        values: this.field,
        format: (v) => {
          const team = findTeam(v);
          if (!team) return '—';
          const human = this.picks.indexOf(v);
          return `${human >= 0 ? `P${human + 1} · ` : ''}${team.abbr} ${team.name.toUpperCase()}`;
        },
        get: () => this.field[slot],
        set: (v) => {
          const from = this.field.indexOf(v);
          if (from < 0 || from === slot) return;
          const held = this.field[slot];
          this.field[slot] = v;
          this.field[from] = held;
        },
      }, () => this.render());
      items.push(row);
      rows.appendChild(row.el);
    }
    p.appendChild(rows);

    const order = bracketSeedOrder(this.setup.size);
    const preview = el('div', 'row');
    preview.style.marginTop = '10px';
    for (let i = 0; i < order.length; i += 2) {
      const a = this.field[order[i] - 1] ?? BYE;
      const b = this.field[order[i + 1] - 1] ?? BYE;
      preview.appendChild(el('span', 'pill', `${order[i]} ${this.abbr(a)}  v  ${this.abbr(b)} ${order[i + 1]}`));
    }
    p.appendChild(preview);

    const shuffle = button('RANDOMISE THE DRAW', () => {
      this.setup.seed = ((Math.imul(this.setup.seed, 1103515245) + 12345) >>> 0) || 1;
      new Rng(this.setup.seed).shuffle(this.field);
      this.render();
    }, 'ghost');
    const go = button('START TOURNAMENT', () => { this.start(); this.render(); });
    const back = button('BACK', () => this.onBack(), 'ghost');
    items.push(shuffle, go, back);
    p.append(shuffle.el, go.el, back.el);
    this.mountPanel(p, items);
  }

  private start(): void {
    const t = createTournament({
      size: this.setup.size,
      bestOf3: this.setup.bestOf3,
      seed: this.setup.seed,
      entrants: this.field.map((teamId) => {
        const seat = this.picks.indexOf(teamId);
        return { teamId, human: seat >= 0, seat: seat >= 0 ? seat : -1 };
      }),
    });
    this.t = t;
    this.save();
    this.results = [];
    this.status = '';
    this.view = t.champion ? 'CHAMPION' : 'BRACKET';
  }

  // ── bracket ─────────────────────────────────────────────────────────────
  private renderBracket(): void {
    const t = this.t;
    if (!t) { this.view = 'SETUP'; this.render(); return; }
    if (advanceRound(t)) this.save();
    if (t.champion) { this.view = 'CHAMPION'; this.render(); return; }

    const nm = nextMatch(t);
    const p = panel('TOURNAMENT',
      `${roundName(t, t.round)} · ${t.bestOf3 ? 'BEST OF 3' : 'SINGLE GAME'} · ${t.size}-TEAM LADDER`);
    p.classList.add('wide');
    if (nm) p.appendChild(this.matchupStrip(t, nm));
    p.appendChild(this.bracketNode(t));

    if (this.status) {
      const line = el('p', 'muted', this.status);
      line.style.color = 'var(--hot-2)';
      p.appendChild(line);
    }
    if (this.results.length) {
      const log = el('div', 'row');
      for (const r of this.results.slice(-4)) log.appendChild(el('span', 'pill', r));
      p.appendChild(log);
    }

    const items: FocusItem[] = [];
    if (this.sim.active) {
      items.push(button('SKIP AHEAD', () => { this.sim.fast = true; }));
    } else if (nm) {
      const human = isHumanMatch(t, nm);
      const title = `${this.abbr(nm.a)} V ${this.abbr(nm.b)}`;
      items.push(button(
        human ? `PLAY NEXT MATCH — ${title}` : `SIMULATE NEXT MATCH — ${title}`,
        () => { if (human) this.playHumanMatch(nm); else this.beginSim('ONE', nm); },
      ));
      const cpu = this.nextCpuMatch(t);
      if (cpu) items.push(button('SIMULATE REST OF ROUND', () => this.beginSim('ROUND', cpu), 'ghost'));
    }
    const quit = button('ABANDON TOURNAMENT', () => {
      this.t = null;
      writeSave({ tournament: null });
      this.resetSetup();
      this.view = 'SETUP';
      this.render();
    }, 'danger');
    const menu = button('MAIN MENU', () => this.exit(), 'ghost');
    items.push(quit, menu);
    for (const it of items) p.appendChild(it.el);
    this.mountPanel(p, items);
  }

  private matchupStrip(t: TournamentSave, nm: TournamentMatchup): HTMLElement {
    const m = t.rounds[nm.round][nm.index];
    const wrap = el('div', 'stack');
    const strip = el('div', 'vs-strip');
    const side = (id: string, wins: number): HTMLElement => {
      const d = el('div', 'side');
      const team = findTeam(id);
      if (team) d.appendChild(svgNode(teamLogoSvg(team, 118)));
      d.appendChild(el('div', 'nm', this.label(id)));
      const tags = el('div', 'row');
      tags.style.justifyContent = 'center';
      const isHuman = isHumanTeam(t, id);
      tags.append(
        el('span', 'pill', `SEED ${seedOf(t, id) || '—'}`),
        el('span', isHuman ? 'tag on' : 'tag', isHuman ? 'YOU' : 'CPU'),
      );
      d.appendChild(tags);
      if (t.bestOf3) d.appendChild(el('div', 'big-num', String(wins)));
      return d;
    };
    strip.append(side(nm.a, m.winsA), el('div', 'vs', 'VS'), side(nm.b, m.winsB));
    wrap.appendChild(strip);

    const venue = venueFor(t, nm.round, nm.index, nm.a);
    const stadium = findStadium(venue.stadium);
    const bits = [
      t.bestOf3 ? `GAME ${m.winsA + m.winsB + 1} OF UP TO ${winsNeeded(t) * 2 - 1}` : 'ONE GAME · WINNER ADVANCES',
      stadium ? stadium.name.toUpperCase() : 'NEUTRAL SITE',
      venue.weather,
    ];
    const leader = seriesLeader(m);
    if (t.bestOf3 && leader) bits.push(`${this.abbr(leader)} LEADS THE SERIES`);
    const line = el('p', 'muted', bits.join(' · '));
    line.style.textAlign = 'center';
    wrap.appendChild(line);
    return wrap;
  }

  private bracketNode(t: TournamentSave): HTMLElement {
    const wrap = el('div', 'bracket');
    const nm = nextMatch(t);
    const rounds = totalRounds(t);
    for (let r = 0; r < rounds; r++) {
      const col = el('div', 'stack');
      const head = el('div', 'muted', roundName(t, r));
      head.style.textAlign = 'center';
      col.appendChild(head);
      const rnd = el('div', 'rnd');
      const built = t.rounds[r];
      const count = matchesInRound(t, r);
      for (let i = 0; i < count; i++) {
        const m = built ? built[i] : undefined;
        const box = el('div', 'm');
        if (nm && nm.round === r && nm.index === i) box.classList.add('live');
        const winner = m ? matchWinner(m) : BYE;
        const line = (id: string | undefined, wins: number): HTMLElement => {
          const d = el('div');
          const name = id === undefined ? '—' : this.abbr(id);
          const human = !!id && isHumanTeam(t, id);
          d.append(
            el('span', '', human ? `▸ ${name}` : name),
            el('span', '', m && id !== undefined && id !== BYE ? String(wins) : ''),
          );
          if (id && id !== BYE && winner === id) d.classList.add('win');
          return d;
        };
        box.append(line(m?.a, m?.winsA ?? 0), line(m?.b, m?.winsB ?? 0));
        rnd.appendChild(box);
      }
      col.appendChild(rnd);
      wrap.appendChild(col);
    }

    const champCol = el('div', 'stack');
    const champHead = el('div', 'muted', 'CHAMPION');
    champHead.style.textAlign = 'center';
    champCol.appendChild(champHead);
    const champBox = el('div', 'm');
    const champLine = el('div');
    champLine.append(
      el('span', '', t.champion ? this.abbr(t.champion) : '—'),
      el('span', '', t.champion ? '★' : ''),
    );
    if (t.champion) { champLine.classList.add('win'); champBox.classList.add('live'); }
    champBox.appendChild(champLine);
    champCol.appendChild(champBox);
    wrap.appendChild(champCol);
    return wrap;
  }

  // ── playing ─────────────────────────────────────────────────────────────
  private playHumanMatch(nm: TournamentMatchup): void {
    const t = this.t;
    if (!t) return;
    const m = t.rounds[nm.round][nm.index];
    const stamp = { round: nm.round, index: nm.index, game: m.winsA + m.winsB };
    const venue = venueFor(t, nm.round, nm.index, nm.a);
    this.stackReset = true;
    this.returning = true;
    this.ctx.go('match', {
      config: {
        seed: matchSeed(t, nm.round, nm.index, stamp.game),
        home: nm.a,
        away: nm.b,
        stadium: venue.stadium,
        weather: venue.weather,
        difficulty: this.game.settings.difficulty,
        quarterSeconds: this.game.settings.quarterSeconds,
        seats: seatsFor(t, nm),
        catchUpBias: false,
        mode: 'TOURNAMENT',
      },
      returnScreen: 'tournament',
      onFinish: (r: { home: number; away: number }) => {
        // Re-read the bracket: this screen was torn down while the match ran.
        const cur = getSave().tournament;
        if (!cur || cur.round !== stamp.round) return;
        const target = cur.rounds[stamp.round]?.[stamp.index];
        if (!target || target.done) return;
        // Only the game we launched may be credited — a replay is an exhibition.
        if (target.winsA + target.winsB !== stamp.game) return;
        let aWin = r.home > r.away ? 1 : 0;
        let bWin = r.away > r.home ? 1 : 0;
        if (!aWin && !bWin) {
          if (tieBreakWinner(cur, target.a, target.b) === target.a) aWin = 1; else bWin = 1;
        }
        reportResult(cur, stamp.index, aWin, bWin);
        advanceRound(cur);
        writeSave({ tournament: cur });
      },
    });
  }

  /** First unplayed match in the current round with no human in it. */
  private nextCpuMatch(t: TournamentSave): TournamentMatchup | null {
    const round = t.rounds[t.round];
    if (!round) return null;
    for (let i = 0; i < round.length; i++) {
      const m = round[i];
      if (m.done || m.a === BYE || m.b === BYE) continue;
      if (isHumanMatch(t, m)) continue;
      return { round: t.round, index: i, a: m.a, b: m.b };
    }
    return null;
  }

  private beginSim(mode: 'ONE' | 'ROUND', target: TournamentMatchup): void {
    this.sim = { active: true, mode, target: { round: target.round, index: target.index }, delay: 0, fast: false };
    this.status = `SIMULATING ${this.abbr(target.a)} V ${this.abbr(target.b)}…`;
    this.render();
  }

  private endSim(): void {
    this.sim.active = false;
    this.sim.target = null;
    this.status = '';
    this.render();
  }

  /** One simulated game per frame, so the bracket updates as the round plays out. */
  private simStep(): void {
    const t = this.t;
    if (!t) { this.endSim(); return; }
    advanceRound(t);

    let target: TournamentMatchup | null = null;
    if (this.sim.mode === 'ONE' && this.sim.target) {
      const pending = t.rounds[this.sim.target.round]?.[this.sim.target.index];
      if (pending && !pending.done && t.round === this.sim.target.round) {
        target = { round: this.sim.target.round, index: this.sim.target.index, a: pending.a, b: pending.b };
      }
    } else if (this.sim.mode === 'ROUND') {
      target = this.nextCpuMatch(t);
    }
    if (!target) { this.save(); this.endSim(); return; }

    const m = t.rounds[target.round][target.index];
    const venue = venueFor(t, target.round, target.index, target.a);
    const r = simulateCpuMatch(t, target.a, target.b, matchSeed(t, target.round, target.index, m.winsA + m.winsB), {
      difficulty: this.game.settings.difficulty,
      quarterSeconds: this.game.settings.quarterSeconds,
      stadium: venue.stadium,
      weather: venue.weather,
    });
    let aWin = r.a > r.b ? 1 : 0;
    let bWin = r.b > r.a ? 1 : 0;
    if (!aWin && !bWin) { if (tieBreakWinner(t, target.a, target.b) === target.a) aWin = 1; else bWin = 1; }
    reportResult(t, target.index, aWin, bWin);
    advanceRound(t);
    this.results.push(`${this.abbr(target.a)} ${r.a} — ${r.b} ${this.abbr(target.b)}`);
    this.save();

    if (t.champion || (this.sim.mode === 'ONE' && t.rounds[target.round][target.index].done)) { this.endSim(); return; }
    this.sim.delay = this.sim.mode === 'ROUND' ? 0.34 : 0.85;
    this.status = `${this.abbr(target.a)} ${r.a} — ${r.b} ${this.abbr(target.b)}`;
    this.render();
  }

  // ── champion ────────────────────────────────────────────────────────────
  private renderChampion(): void {
    const t = this.t;
    if (!t || !t.champion) { this.view = 'SETUP'; this.render(); return; }
    const team = findTeam(t.champion);
    const p = panel('CHAMPION', `${t.size}-team ladder · ${t.bestOf3 ? 'best of three' : 'single game'}`);
    p.classList.add('wide');

    const strip = el('div', 'vs-strip');
    const side = el('div', 'side');
    if (team) {
      side.appendChild(svgNode(teamLogoSvg(team, 176)));
      side.appendChild(el('div', 'nm', `${team.city.toUpperCase()} ${team.name.toUpperCase()}`));
      const crown = el('div', 'big-num', '★');
      crown.style.color = 'var(--hot-2)';
      side.appendChild(crown);
      side.appendChild(el('p', 'muted', team.blurb));
    }
    strip.appendChild(side);
    p.appendChild(strip);

    const table = el('table', 'go-table');
    const head = el('tr');
    head.append(el('th', '', 'ROUND'), el('th', '', 'BEAT'), el('th', '', 'SERIES'));
    table.appendChild(head);
    for (let r = 0; r < t.rounds.length; r++) {
      for (const m of t.rounds[r]) {
        if (matchWinner(m) !== t.champion) continue;
        const beaten = m.a === t.champion ? m.b : m.a;
        const score = m.a === t.champion ? `${m.winsA}–${m.winsB}` : `${m.winsB}–${m.winsA}`;
        const tr = el('tr');
        tr.append(
          el('td', '', roundName(t, r)),
          el('td', '', beaten === BYE ? 'BYE' : this.label(beaten)),
          el('td', '', beaten === BYE ? '—' : score),
        );
        table.appendChild(tr);
      }
    }
    p.appendChild(table);

    const items: FocusItem[] = [
      button('NEW TOURNAMENT', () => {
        this.t = null;
        writeSave({ tournament: null });
        this.resetSetup();
        this.view = 'SETUP';
        this.render();
      }),
      button('MAIN MENU', () => this.exit(), 'ghost'),
    ];
    for (const it of items) p.appendChild(it.el);
    this.mountPanel(p, items);
  }
}
