import type { Screen, ScreenContext, FocusItem } from '../uiKit.ts';
import { el, clear, FocusRing, button, optionRow, panel, svgNode } from '../uiKit.ts';
import { Action } from '../../input/actions.ts';
import type { Game } from '../../app/Game.ts';
import type { Difficulty, TeamDef, TeamSide, TeamStats } from '../../core/types.ts';
import { TEAMS, getTeam, findTeam, teamLogoSvg, getStadium, CONFERENCES } from '../../data/index.ts';
import { getSave, writeSave, type SeasonSave } from '../../persistence/save.ts';
import {
  createSeason, currentFixtures, nextGameFor, fixtureSeed, fixtureConditions, simulateFixture,
  playWeek, advanceSeason, recordResult, standingsFor, teamSchedule, weekFixtures, recordOf,
  formatRecord, conferenceRank, leadersFor, LEADER_LABELS, playoffBracket, weekLabel,
  inPlayoffs, REGULAR_WEEKS, ROUND_LABELS, PLAYOFF_SEEDS,
  type Fixture, type GameResult, type LeaderStat,
} from '../../modes/season.ts';

const DIFFS: Difficulty[] = ['ROOKIE', 'PRO', 'ALLSTAR', 'LEGEND'];
const LEADER_STATS: LeaderStat[] = ['passYds', 'rushYds', 'sacks', 'ints', 'tds'];
const LEAGUE_NAME = 'UNITED GRIDIRON CIRCUIT';

type View = 'SETUP' | 'HUB' | 'SCHEDULE' | 'STANDINGS' | 'STATS' | 'SIMULATING' | 'ABANDON' | 'TROPHY';

function screenShell(): HTMLElement {
  const s = el('div', 'go-screen');
  s.appendChild(el('div', 'go-dim'));
  return s;
}

function shortName(id: string): string {
  const t = findTeam(id);
  return t ? t.name.toUpperCase() : id.toUpperCase();
}

function cityName(id: string): string {
  const t = findTeam(id);
  return t ? `${t.city} ${t.name}`.toUpperCase() : id.toUpperCase();
}

function abbrOf(id: string): string {
  const t = findTeam(id);
  return t ? t.abbr : id.slice(0, 3).toUpperCase();
}

/** Procedural championship trophy — geometry only, tinted with the champion's colours. */
function trophySvg(t: TeamDef, size = 260): string {
  const uid = `tr-${t.id}`;
  const c = t.colors;
  let rays = '';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const x = 120 + Math.cos(a) * 26;
    const y = 120 + Math.sin(a) * 26;
    const x2 = 120 + Math.cos(a) * 132;
    const y2 = 120 + Math.sin(a) * 132;
    const w = i % 2 === 0 ? 12 : 5;
    const nx = Math.cos(a + Math.PI / 2) * w;
    const ny = Math.sin(a + Math.PI / 2) * w;
    rays += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${(x2 + nx).toFixed(1)} ${(y2 + ny).toFixed(1)} L${(x2 - nx).toFixed(1)} ${(y2 - ny).toFixed(1)} Z" fill="${c.secondary}" opacity="${i % 2 === 0 ? 0.16 : 0.09}"/>`;
  }
  let star = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 15 : 6.4;
    star += `${(120 + Math.cos(a) * r).toFixed(1)},${(96 + Math.sin(a) * r).toFixed(1)} `;
  }
  return `<svg viewBox="0 0 240 300" width="${size}" height="${Math.round((size * 300) / 240)}" role="img" aria-label="Championship trophy">
  <defs>
    <linearGradient id="${uid}-cup" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.accent}"/><stop offset="46%" stop-color="${c.secondary}"/><stop offset="100%" stop-color="${c.primary}"/>
    </linearGradient>
    <linearGradient id="${uid}-base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.secondary}"/><stop offset="100%" stop-color="${c.primary}"/>
    </linearGradient>
    <radialGradient id="${uid}-glow" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0%" stop-color="${c.accent}" stop-opacity="0.55"/><stop offset="100%" stop-color="${c.primary}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g>${rays}</g>
  <circle cx="120" cy="120" r="118" fill="url(#${uid}-glow)"/>
  <g stroke="#04070d" stroke-width="4" stroke-linejoin="round">
    <path d="M52 60 h-14 a12 12 0 0 0 -12 12 v18 a44 44 0 0 0 44 44 h6" fill="none" stroke-width="13"/>
    <path d="M188 60 h14 a12 12 0 0 1 12 12 v18 a44 44 0 0 1 -44 44 h-6" fill="none" stroke-width="13"/>
    <path d="M52 60 h-14 a12 12 0 0 0 -12 12 v18 a44 44 0 0 0 44 44 h6" fill="none" stroke="${c.secondary}" stroke-width="7"/>
    <path d="M188 60 h14 a12 12 0 0 1 12 12 v18 a44 44 0 0 1 -44 44 h-6" fill="none" stroke="${c.secondary}" stroke-width="7"/>
    <path d="M56 40 h128 v50 a64 64 0 0 1 -64 64 a64 64 0 0 1 -64 -64 z" fill="url(#${uid}-cup)"/>
    <rect x="48" y="30" width="144" height="16" fill="${c.secondary}"/>
    <rect x="108" y="152" width="24" height="30" fill="url(#${uid}-base)"/>
    <path d="M74 182 h92 l12 26 h-116 z" fill="url(#${uid}-base)"/>
    <rect x="50" y="208" width="140" height="26" fill="${c.primary}"/>
  </g>
  <polygon points="${star.trim()}" fill="${c.accent}" stroke="#04070d" stroke-width="3" stroke-linejoin="round"/>
  <text x="120" y="227" text-anchor="middle" font-family="Impact, 'Arial Narrow Bold', sans-serif" font-size="19" letter-spacing="4" fill="${c.ink}">${abbrOf(t.id)}</text>
</svg>`;
}

export class SeasonScreen implements Screen {
  name = 'season';

  private node: HTMLElement | null = null;
  private ctx!: ScreenContext;
  private ring = new FocusRing();
  private view: View = 'HUB';
  private season: SeasonSave | null = null;

  // new-season setup
  private pickTeam = TEAMS[0].id;
  private pickDiff: Difficulty = 'PRO';

  // sub-view state
  private leagueView = false;

  // chunked week simulation
  private simQueue: Fixture[] = [];
  private simResults: GameResult[] = [];
  private simIdx = 0;
  private simPainted = -1;
  private simTitle = '';

  constructor(private game: Game) {}

  // ── lifecycle ───────────────────────────────────────────────────────────
  mount(ctx: ScreenContext): void {
    this.ctx = ctx;
    const s = screenShell();
    ctx.root.appendChild(s);
    this.node = s;
    this.game.audio.music.start();

    // Rebuilt from the save on every mount — this screen is remounted after each match.
    const save = getSave();
    this.season = save.season;

    if (!this.season) {
      this.pickTeam = findTeam(save.lastTeams.home) ? save.lastTeams.home : TEAMS[0].id;
      this.pickDiff = save.settings.difficulty;
      this.view = 'SETUP';
      this.render();
      return;
    }

    const before = JSON.stringify(this.season);
    advanceSeason(this.season);
    if (JSON.stringify(this.season) !== before) writeSave();

    if (this.season.champion) { this.view = 'TROPHY'; this.render(); return; }

    // Returning from a played fixture: finish the rest of the week around the league.
    const fx = currentFixtures(this.season);
    const mine = fx.find((f) => f.human);
    const pending = fx.filter((f) => !f.played);
    if (mine && mine.played && pending.length > 0) {
      this.startSim(pending, 'AROUND THE LEAGUE');
      return;
    }

    this.view = 'HUB';
    this.render();
  }

  unmount(): void {
    this.node?.remove();
    this.node = null;
    this.simQueue = [];
    this.simResults = [];
  }

  update(): void {
    if (this.view === 'SIMULATING') { this.stepSim(); return; }
    const i = this.ctx.input;
    if (i.menuPressed(Action.UP)) this.ring.move(0, -1);
    if (i.menuPressed(Action.DOWN)) this.ring.move(0, 1);
    if (i.menuPressed(Action.LEFT)) { if (this.ring.items[this.ring.index]?.onLeft) this.ring.adjust(-1); else this.ring.move(-1, 0); }
    if (i.menuPressed(Action.RIGHT)) { if (this.ring.items[this.ring.index]?.onRight) this.ring.adjust(1); else this.ring.move(1, 0); }
    if (i.menuPressed(Action.ACTION)) this.ring.select();
    if (i.menuPressed(Action.BACK)) {
      this.ctx.sound('back');
      if (this.view === 'HUB' || this.view === 'SETUP' || this.view === 'TROPHY') this.exitToMenu();
      else this.show(this.homeView());
    }
  }

  // ── render dispatch ─────────────────────────────────────────────────────
  private show(v: View): void { this.view = v; this.render(); }

  /** Hub, or the trophy ceremony once the season has a champion. */
  private homeView(): View { return this.season && this.season.champion ? 'TROPHY' : 'HUB'; }

  /**
   * The final-stats screen returns here with `reset`, which leaves this screen alone on
   * the stack — `back()` would be a no-op — so leaving always restarts at the main menu.
   */
  private exitToMenu(): void { this.ctx.reset('mainMenu'); }

  private render(): void {
    const s = this.node;
    if (!s) return;
    clear(s);
    s.appendChild(el('div', 'go-dim'));
    switch (this.view) {
      case 'SETUP': this.renderSetup(s); break;
      case 'HUB': this.renderHub(s); break;
      case 'SCHEDULE': this.renderSchedule(s); break;
      case 'STANDINGS': this.renderStandings(s); break;
      case 'STATS': this.renderStats(s); break;
      case 'ABANDON': this.renderAbandon(s); break;
      case 'TROPHY': this.renderTrophy(s); break;
      case 'SIMULATING': this.renderSimulating(s); break;
      default: this.renderHub(s); break;
    }
  }

  private setRing(items: FocusItem[], index = 0): void {
    this.ring.set(items);
    if (index > 0) this.ring.focusIndex(index);
    this.ring.onNav = (e) => this.ctx.sound(e === 'select' ? 'select' : 'move');
  }

  // ── new season ──────────────────────────────────────────────────────────
  private renderSetup(s: HTMLElement): void {
    const p = panel('NEW SEASON', `Pick a club and run its ${REGULAR_WEEKS}-week ${LEAGUE_NAME} campaign.`);
    p.classList.add('wide');

    const grid = el('div', 'go-grid teams');
    const detail = el('div', 'muted');
    detail.style.cssText = 'min-height:40px;margin-top:10px';
    const items: FocusItem[] = [];

    const describe = (t: TeamDef) => {
      detail.textContent = `${t.blurb} · PASS ${t.power.passing} RUN ${t.power.running} LINE ${t.power.line} COV ${t.power.coverage} ST ${t.power.special}`;
    };

    TEAMS.forEach((t, i) => {
      const card = el('div', 'go-card');
      card.appendChild(svgNode(teamLogoSvg(t, 96), 'logo'));
      card.appendChild(el('div', 'ct', t.city.toUpperCase()));
      card.appendChild(el('div', 'nm', t.name.toUpperCase()));
      const bar = el('div', 'bar');
      bar.style.background = t.colors.primary;
      card.appendChild(bar);
      card.style.borderColor = t.colors.primary;
      const pick = () => { this.pickTeam = t.id; this.render(); };
      card.addEventListener('click', pick);
      card.addEventListener('mouseenter', () => describe(t));
      if (t.id === this.pickTeam) card.style.boxShadow = `inset 0 0 0 3px ${t.colors.secondary}`;
      grid.appendChild(card);
      items.push({ el: card, onSelect: pick, row: Math.floor(i / 5), col: i % 5 });
    });

    p.append(grid, detail);

    const chosen = getTeam(this.pickTeam);
    const chosenRow = el('div', 'row');
    chosenRow.style.marginTop = '8px';
    chosenRow.append(
      el('span', 'pill', `CLUB · ${chosen.city.toUpperCase()} ${chosen.name.toUpperCase()}`),
      el('span', 'pill', `CONFERENCE · ${(CONFERENCES.find((c) => c.teamIds.includes(this.pickTeam))?.name ?? '').toUpperCase()}`),
    );
    p.appendChild(chosenRow);

    const diff = optionRow<Difficulty>({
      label: 'DIFFICULTY', values: DIFFS,
      get: () => this.pickDiff, set: (v) => { this.pickDiff = v; },
    });
    const start = button('START SEASON', () => this.startSeason());
    const back = button('BACK', () => this.exitToMenu(), 'ghost');
    p.append(diff.el, start.el, back.el);
    items.push({ ...diff, row: 90, col: 0 }, { ...start, row: 91, col: 0 }, { ...back, row: 92, col: 0 });

    s.appendChild(p);
    const idx = TEAMS.findIndex((t) => t.id === this.pickTeam);
    this.setRing(items, Math.max(0, idx));
    describe(chosen);
  }

  private startSeason(): void {
    const save = getSave();
    const seed = ((Date.now() & 0x7fffffff) >>> 0) || 1;
    save.season = createSeason(this.pickTeam, this.pickDiff, seed);
    writeSave();
    this.season = save.season;
    this.show('HUB');
  }

  // ── hub ─────────────────────────────────────────────────────────────────
  private renderHub(s: HTMLElement): void {
    const season = this.season;
    if (!season) { this.view = 'SETUP'; this.renderSetup(s); return; }
    const me = getTeam(season.teamId);
    const rec = recordOf(season, season.teamId);
    const rank = conferenceRank(season, season.teamId);
    const conf = CONFERENCES.find((c) => c.teamIds.includes(season.teamId));

    const p = panel(`SEASON · ${weekLabel(season)}`, LEAGUE_NAME);
    p.classList.add('wide');

    const head = el('div', 'spread');
    const left = el('div', 'row');
    left.appendChild(svgNode(teamLogoSvg(me, 64), 'logo'));
    const who = el('div', 'stack');
    who.append(
      el('div', '', `${me.city.toUpperCase()} ${me.name.toUpperCase()}`),
      el('div', 'muted', `${formatRecord(rec)} · ${rank ? `${rank} OF 8` : '—'} IN THE ${(conf?.name ?? '').toUpperCase()}`),
    );
    left.appendChild(who);
    const pills = el('div', 'row');
    pills.append(
      el('span', 'pill', `PF ${rec.pf}`),
      el('span', 'pill', `PA ${rec.pa}`),
      el('span', 'pill', `${rec.diff >= 0 ? '+' : ''}${rec.diff} DIFF`),
      el('span', 'pill', season.difficulty),
    );
    head.append(left, pills);
    p.appendChild(head);

    const next = nextGameFor(season);
    if (next) {
      const seed = fixtureSeed(season, next.week, next.home, next.away);
      const cond = fixtureConditions(next, seed);
      const strip = el('div', 'vs-strip');
      strip.style.margin = '18px 0 6px';
      const side = (id: string) => {
        const t = findTeam(id);
        const d = el('div', 'side');
        if (t) d.appendChild(svgNode(teamLogoSvg(t, 132)));
        d.appendChild(el('div', 'nm', shortName(id)));
        d.appendChild(el('div', 'muted', formatRecord(recordOf(season, id))));
        if (id === season.teamId) d.appendChild(el('div', 'tag on', 'YOUR CLUB'));
        return d;
      };
      strip.append(side(next.away), el('div', 'vs', 'AT'), side(next.home));
      p.appendChild(strip);
      p.appendChild(el('p', 'muted center',
        `${next.label} · ${getStadium(cond.stadium).name.toUpperCase()} · ${cond.weather}${next.human ? '' : ' · YOUR CLUB IS NOT IN THIS GAME'}`));
    } else {
      p.appendChild(el('p', 'muted center', 'No fixtures remain.'));
    }

    const items: FocusItem[] = [];
    const playoffs = inPlayoffs(season);
    if (next && next.human) {
      items.push(button(playoffs ? `PLAY ${next.label}` : 'PLAY WEEK', () => this.playNext()));
    }
    items.push(button(playoffs ? 'SIMULATE ROUND' : 'SIMULATE WEEK', () => this.simulateRest()));
    items.push(
      button('SCHEDULE', () => this.show('SCHEDULE')),
      button('STANDINGS', () => this.show('STANDINGS')),
      button('STATISTICS', () => this.show('STATS')),
      button('MAIN MENU', () => this.exitToMenu(), 'ghost'),
      button('ABANDON SEASON', () => this.show('ABANDON'), 'danger'),
    );
    const stack = el('div', 'stack');
    for (const it of items) stack.appendChild(it.el);
    p.appendChild(stack);

    s.appendChild(p);
    this.setRing(items);
  }

  // ── launching / recording the human fixture ─────────────────────────────
  private playNext(): void {
    const season = this.season;
    if (!season) return;
    const f = nextGameFor(season);
    if (!f || !f.human) { this.ctx.sound('error'); return; }
    const seed = fixtureSeed(season, f.week, f.home, f.away);
    const cond = fixtureConditions(f, seed);
    const mySide: TeamSide = f.home === season.teamId ? 0 : 1;
    const other: TeamSide = mySide === 0 ? 1 : 0;
    this.ctx.go('match', {
      config: {
        seed,
        home: f.home,
        away: f.away,
        stadium: cond.stadium,
        weather: cond.weather,
        difficulty: season.difficulty,
        quarterSeconds: this.game.settings.quarterSeconds,
        seats: [
          { side: mySide, active: true },
          { side: other, active: false },
          { side: mySide, active: false },
          { side: other, active: false },
        ],
        mode: 'SEASON',
      },
      returnScreen: 'season',
      onFinish: (r: { home: number; away: number }) => this.recordHumanGame(f, r),
    });
  }

  /**
   * Runs while this screen is unmounted (the final-stats screen calls it), so it works
   * entirely off the save file plus the still-live match box score.
   */
  private recordHumanGame(f: Fixture, r: { home: number; away: number }): void {
    const season = getSave().season;
    if (!season) return;
    const live = this.game.match;
    const stats: [TeamStats, TeamStats] | undefined = live
      ? [{ ...live.state.teams[0].stats }, { ...live.state.teams[1].stats }]
      : undefined;
    const fresh = currentFixtures(season).find((x) => !x.played && x.home === f.home && x.away === f.away);
    if (!fresh) return;
    recordResult(season, fresh, {
      home: f.home, away: f.away, homeScore: r.home, awayScore: r.away, stats,
    });
    writeSave();
  }

  // ── chunked simulation ──────────────────────────────────────────────────
  private simulateRest(): void {
    const season = this.season;
    if (!season) return;
    const pending = currentFixtures(season).filter((f) => !f.played);
    if (pending.length === 0) { this.ctx.sound('error'); return; }
    this.startSim(pending, inPlayoffs(season) ? ROUND_LABELS[pending[0].round] : `WEEK ${season.week}`);
  }

  private startSim(queue: Fixture[], title: string): void {
    this.simQueue = queue;
    this.simResults = [];
    this.simIdx = 0;
    this.simPainted = -1;
    this.simTitle = title;
    this.view = 'SIMULATING';
    this.render();
  }

  /** One game per frame, painting the frame before it blocks, so progress stays visible. */
  private stepSim(): void {
    const season = this.season;
    if (!season) { this.show('HUB'); return; }
    if (this.simPainted !== this.simIdx) { this.simPainted = this.simIdx; this.render(); return; }
    const f = this.simQueue[this.simIdx];
    if (f) {
      this.simResults.push(simulateFixture(season, f, { quarterSeconds: this.game.settings.quarterSeconds }));
      this.simIdx++;
    } else {
      this.simIdx = this.simQueue.length;
    }
    if (this.simIdx >= this.simQueue.length) this.finishSim();
  }

  private finishSim(): void {
    const season = this.season;
    if (!season) { this.show('HUB'); return; }
    playWeek(season, this.simResults);
    advanceSeason(season);
    writeSave();
    this.simQueue = [];
    this.simResults = [];
    this.show(season.champion ? 'TROPHY' : 'HUB');
  }

  private renderSimulating(s: HTMLElement): void {
    const season = this.season;
    const p = panel('SIMULATING', this.simTitle);
    const done = Math.min(this.simIdx, this.simQueue.length);
    const total = Math.max(1, this.simQueue.length);
    const bar = el('div', 'go-slider');
    bar.style.height = '18px';
    const fill = el('i');
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    bar.appendChild(fill);
    p.appendChild(bar);
    p.appendChild(el('p', 'muted center', `GAME ${Math.min(done + 1, this.simQueue.length)} OF ${this.simQueue.length}`));

    const cur = this.simQueue[Math.min(done, this.simQueue.length - 1)];
    if (cur) p.appendChild(el('p', 'center', `${cityName(cur.away)}  AT  ${cityName(cur.home)}`));

    if (season && this.simResults.length > 0) {
      const table = el('table', 'go-table');
      for (const r of this.simResults.slice(-6)) {
        const tr = el('tr');
        if (r.home === season.teamId || r.away === season.teamId) tr.className = 'me';
        tr.append(
          el('td', '', `${abbrOf(r.away)} ${r.awayScore}`),
          el('td', '', 'AT'),
          el('td', '', `${abbrOf(r.home)} ${r.homeScore}`),
        );
        table.appendChild(tr);
      }
      p.appendChild(table);
    }
    s.appendChild(p);
    this.ring.set([]);
  }

  // ── schedule ────────────────────────────────────────────────────────────
  private renderSchedule(s: HTMLElement): void {
    const season = this.season;
    if (!season) { this.show('HUB'); return; }
    const p = panel('SCHEDULE', this.leagueView ? `ALL ${REGULAR_WEEKS} WEEKS` : cityName(season.teamId));
    p.classList.add('wide');

    const items: FocusItem[] = [];
    const toggle = button(this.leagueView ? 'VIEW · WHOLE LEAGUE' : 'VIEW · MY CLUB', () => {
      this.leagueView = !this.leagueView;
      this.render();
    });
    const back = button('BACK', () => this.show(this.homeView()), 'ghost');
    const bar = el('div', 'row');
    bar.append(toggle.el, back.el);
    p.appendChild(bar);
    items.push(toggle, back);

    const scroll = el('div', 'scroll');
    const table = el('table', 'go-table');
    const head = el('tr');
    if (this.leagueView) head.append(el('th', '', 'WEEK'), el('th', '', 'AWAY'), el('th', '', ''), el('th', '', 'HOME'), el('th', '', 'SCORE'));
    else head.append(el('th', '', 'WEEK'), el('th', '', 'OPPONENT'), el('th', '', 'VENUE'), el('th', '', 'RESULT'), el('th', '', 'SCORE'));
    table.appendChild(head);

    if (this.leagueView) {
      for (let w = 1; w <= REGULAR_WEEKS; w++) {
        for (const f of weekFixtures(season, w)) {
          const g = season.schedule[f.index];
          const tr = el('tr');
          if (f.human) tr.className = 'me';
          tr.append(
            el('td', '', `W${w}`),
            el('td', '', shortName(f.away)),
            el('td', 'muted', 'AT'),
            el('td', '', shortName(f.home)),
            el('td', 'mono', g.played ? `${g.awayScore} — ${g.homeScore}` : (w === season.week ? 'THIS WEEK' : '—')),
          );
          table.appendChild(tr);
          items.push({ el: tr as unknown as HTMLElement });
        }
      }
    } else {
      for (const f of teamSchedule(season, season.teamId)) {
        const g = season.schedule[f.index];
        const home = f.home === season.teamId;
        const opp = home ? f.away : f.home;
        const my = home ? g.homeScore : g.awayScore;
        const their = home ? g.awayScore : g.homeScore;
        const tr = el('tr');
        if (f.week === season.week && !g.played) tr.className = 'me';
        const result = el('td', '', g.played ? (my > their ? 'WIN' : my < their ? 'LOSS' : 'TIE') : '—');
        if (g.played) result.style.color = my > their ? 'var(--good)' : my < their ? 'var(--bad)' : 'var(--ink-dim)';
        tr.append(
          el('td', '', `WEEK ${f.week}`),
          el('td', '', cityName(opp)),
          el('td', 'muted', home ? 'HOME' : 'AWAY'),
          result,
          el('td', 'mono', g.played ? `${my} — ${their}` : ''),
        );
        table.appendChild(tr);
        items.push({ el: tr as unknown as HTMLElement });
      }
      for (const round of playoffBracket(season)) {
        for (const f of round) {
          if (!f.human) continue;
          const g = season.playoffs[f.index];
          const home = f.home === season.teamId;
          const opp = home ? f.away : f.home;
          const my = home ? g.homeScore : g.awayScore;
          const their = home ? g.awayScore : g.homeScore;
          const tr = el('tr');
          const result = el('td', '', g.played ? (my > their ? 'WIN' : my < their ? 'LOSS' : 'ADVANCE') : '—');
          if (g.played) result.style.color = my >= their ? 'var(--good)' : 'var(--bad)';
          tr.append(
            el('td', 'mono', f.label),
            el('td', '', cityName(opp)),
            el('td', 'muted', home ? 'HOME' : 'AWAY'),
            result,
            el('td', 'mono', g.played ? `${my} — ${their}` : ''),
          );
          table.appendChild(tr);
          items.push({ el: tr as unknown as HTMLElement });
        }
      }
    }

    scroll.appendChild(table);
    p.appendChild(scroll);
    s.appendChild(p);
    this.setRing(items);
  }

  // ── standings ───────────────────────────────────────────────────────────
  private renderStandings(s: HTMLElement): void {
    const season = this.season;
    if (!season) { this.show('HUB'); return; }
    const p = panel('STANDINGS', `TOP ${PLAYOFF_SEEDS} IN EACH CONFERENCE REACH THE PLAYOFFS`);
    p.classList.add('wide');

    const items: FocusItem[] = [];
    const back = button('BACK', () => this.show(this.homeView()), 'ghost');
    p.appendChild(back.el);
    items.push(back);

    const wrap = el('div', 'go-grid');
    wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(360px, 1fr))';

    CONFERENCES.forEach((conf, ci) => {
      const block = el('div', 'stack');
      block.appendChild(el('h3', '', conf.name.toUpperCase()));
      const table = el('table', 'go-table');
      const head = el('tr');
      head.append(
        el('th', '', '#'), el('th', '', 'CLUB'), el('th', '', 'W'), el('th', '', 'L'),
        el('th', '', 'T'), el('th', '', 'PCT'), el('th', '', 'PF'), el('th', '', 'PA'), el('th', '', 'DIFF'),
      );
      table.appendChild(head);
      for (const row of standingsFor(season, ci)) {
        const tr = el('tr');
        if (row.teamId === season.teamId) tr.className = 'me';
        const club = el('td', '', cityName(row.teamId));
        if (row.rank <= PLAYOFF_SEEDS) {
          const tag = el('span', 'tag on', 'PO');
          tag.style.marginLeft = '8px';
          club.appendChild(tag);
        }
        tr.append(
          el('td', 'mono', String(row.rank)),
          club,
          el('td', '', String(row.w)), el('td', '', String(row.l)), el('td', '', String(row.t)),
          el('td', 'mono', row.pct.toFixed(3).replace(/^0/, '')),
          el('td', '', String(row.pf)), el('td', '', String(row.pa)),
          el('td', '', `${row.diff > 0 ? '+' : ''}${row.diff}`),
        );
        table.appendChild(tr);
        items.push({ el: tr as unknown as HTMLElement });
      }
      block.appendChild(table);
      wrap.appendChild(block);
    });

    const scroll = el('div', 'scroll');
    scroll.appendChild(wrap);
    p.appendChild(scroll);
    p.appendChild(el('p', 'muted', 'PO = playoff position. Ties break on win percentage, then point differential, then points for.'));
    s.appendChild(p);
    this.setRing(items);
  }

  // ── statistics ──────────────────────────────────────────────────────────
  private renderStats(s: HTMLElement): void {
    const season = this.season;
    if (!season) { this.show('HUB'); return; }
    const p = panel('STATISTICS', 'CLUB LEADERS · SEASON TO DATE');
    p.classList.add('wide');

    const items: FocusItem[] = [];
    const back = button('BACK', () => this.show(this.homeView()), 'ghost');
    p.appendChild(back.el);
    items.push(back);

    const wrap = el('div', 'go-grid');
    wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';

    for (const stat of LEADER_STATS) {
      const block = el('div', 'stack');
      block.appendChild(el('h3', '', LEADER_LABELS[stat]));
      const table = el('table', 'go-table');
      const head = el('tr');
      head.append(el('th', '', '#'), el('th', '', 'CLUB'), el('th', '', 'TOTAL'));
      table.appendChild(head);
      for (const row of leadersFor(season, stat, 8)) {
        const tr = el('tr');
        if (row.teamId === season.teamId) tr.className = 'me';
        tr.append(
          el('td', 'mono', String(row.rank)),
          el('td', '', shortName(row.teamId)),
          el('td', 'mono', String(row.value)),
        );
        table.appendChild(tr);
        items.push({ el: tr as unknown as HTMLElement });
      }
      block.appendChild(table);
      wrap.appendChild(block);
    }

    const scroll = el('div', 'scroll');
    scroll.appendChild(wrap);
    p.appendChild(scroll);
    p.appendChild(el('p', 'muted', 'Totals are club aggregates from every completed fixture, including the playoffs.'));
    s.appendChild(p);
    this.setRing(items);
  }

  // ── abandon ─────────────────────────────────────────────────────────────
  private renderAbandon(s: HTMLElement): void {
    const season = this.season;
    const p = panel('ABANDON SEASON?', season
      ? `${cityName(season.teamId)} · ${weekLabel(season)} · ${formatRecord(recordOf(season, season.teamId))}`
      : '');
    p.appendChild(el('p', 'muted', 'The schedule, standings and statistics for this season are deleted. This cannot be undone.'));
    const items: FocusItem[] = [
      button('KEEP PLAYING', () => this.show(this.homeView())),
      button('ABANDON SEASON', () => {
        const save = getSave();
        save.season = null;
        writeSave();
        this.season = null;
        this.pickDiff = save.settings.difficulty;
        this.show('SETUP');
      }, 'danger'),
    ];
    for (const it of items) p.appendChild(it.el);
    s.appendChild(p);
    this.setRing(items);
  }

  // ── trophy ──────────────────────────────────────────────────────────────
  private renderTrophy(s: HTMLElement): void {
    const season = this.season;
    if (!season || !season.champion) { this.show('HUB'); return; }
    const champ = findTeam(season.champion);
    if (!champ) { this.show('HUB'); return; }
    const mine = season.champion === season.teamId;

    const p = panel(mine ? 'CHAMPIONS' : 'SEASON COMPLETE', LEAGUE_NAME);
    p.classList.add('wide');

    const stage = el('div', 'row');
    stage.style.cssText = 'justify-content:center;align-items:center;gap:34px';
    stage.appendChild(svgNode(trophySvg(champ, 260)));

    const side = el('div', 'stack');
    side.style.textAlign = 'center';
    side.appendChild(svgNode(teamLogoSvg(champ, 132)));
    const nameEl = el('div', '', `${champ.city.toUpperCase()} ${champ.name.toUpperCase()}`);
    nameEl.style.cssText = 'font-size:34px;letter-spacing:.05em;color:var(--hot-2)';
    side.appendChild(nameEl);
    const crown = el('div', '', ROUND_LABELS[2]);
    crown.style.cssText = 'letter-spacing:.28em;font-size:15px';
    side.appendChild(crown);

    const title = season.playoffs.find((g) => g.round === 2);
    if (title) {
      const won = title.homeScore >= title.awayScore ? title.home : title.away;
      const lost = won === title.home ? title.away : title.home;
      const ws = won === title.home ? title.homeScore : title.awayScore;
      const ls = won === title.home ? title.awayScore : title.homeScore;
      side.appendChild(el('div', 'muted', `${abbrOf(won)} ${ws} — ${ls} ${abbrOf(lost)}`));
    }

    const rec = recordOf(season, season.teamId);
    const banner = el('div', 'tag on', mine ? 'YOUR CLUB TOOK THE TITLE' : `${abbrOf(season.teamId)} FINISHED ${formatRecord(rec)}`);
    banner.style.cssText = 'font-size:15px;letter-spacing:.16em;padding:6px 14px';
    if (mine && !this.game.settings.reducedMotion) banner.style.animation = 'pulse .9s ease-in-out infinite alternate';
    side.appendChild(banner);

    stage.appendChild(side);
    p.appendChild(stage);

    const items: FocusItem[] = [
      button('NEW SEASON', () => {
        const save = getSave();
        save.season = null;
        writeSave();
        this.season = null;
        this.pickDiff = save.settings.difficulty;
        this.show('SETUP');
      }),
      button('STANDINGS', () => this.show('STANDINGS')),
      button('STATISTICS', () => this.show('STATS')),
      button('MAIN MENU', () => this.exitToMenu(), 'ghost'),
    ];
    const stack = el('div', 'stack');
    for (const it of items) stack.appendChild(it.el);
    p.appendChild(stack);
    s.appendChild(p);
    this.setRing(items);
  }
}
