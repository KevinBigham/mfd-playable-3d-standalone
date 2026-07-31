/* Scratch harness: drives TournamentScreen against a minimal DOM stub. Not shipped. */
/* eslint-disable @typescript-eslint/no-explicit-any */

class StubStyle {
  [k: string]: unknown;
  set cssText(_v: string) { /* ignore */ }
  setProperty(): void { /* ignore */ }
}

class StubNode {
  tagName: string;
  className = '';
  ownText = '';
  children: StubNode[] = [];
  get textContent(): string { return this.ownText + this.children.map((c) => c.textContent).join(' '); }
  set textContent(v: string) { this.ownText = v; }
  parent: StubNode | null = null;
  style = new StubStyle() as unknown as CSSStyleDeclaration;
  dataset: Record<string, string> = {};
  type = '';
  listeners: Record<string, Array<() => void>> = {};
  classList = {
    add: (...c: string[]) => { for (const x of c) if (!this.hasClass(x)) this.className += ` ${x}`; },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' '); },
    toggle: (c: string, on?: boolean) => { if (on) this.classList.add(c); else this.classList.remove(c); },
    contains: (c: string) => this.hasClass(c),
  };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  hasClass(c: string): boolean { return this.className.split(/\s+/).indexOf(c) >= 0; }
  get firstChild(): StubNode | null { return this.children[0] ?? null; }
  set innerHTML(_v: string) { this.children = []; }
  get innerHTML(): string { return ''; }
  appendChild(n: StubNode): StubNode { n.parent = this; this.children.push(n); return n; }
  removeChild(n: StubNode): StubNode { this.children = this.children.filter((c) => c !== n); return n; }
  append(...nodes: StubNode[]): void { for (const n of nodes) this.appendChild(n); }
  remove(): void { this.parent?.removeChild(this); }
  addEventListener(k: string, fn: () => void): void { (this.listeners[k] ??= []).push(fn); }
  removeEventListener(): void { /* ignore */ }
  scrollIntoView(): void { /* ignore */ }
  getBoundingClientRect() { return { left: 0, width: 100, top: 0, height: 10 }; }
  querySelector(): StubNode | null { return null; }
  querySelectorAll(): StubNode[] { return []; }
  click(): void { for (const fn of this.listeners['click'] ?? []) fn(); }
  /** Depth-first text dump, for eyeballing what a screen produced. */
  dump(depth = 0): string {
    const pad = '  '.repeat(depth);
    const own = `${pad}<${this.tagName.toLowerCase()}${this.className ? ` class="${this.className.trim()}"` : ''}>${this.textContent}`;
    return [own, ...this.children.map((c) => c.dump(depth + 1))].join('\n');
  }
  countClass(c: string): number {
    return (this.hasClass(c) ? 1 : 0) + this.children.reduce((n, x) => n + x.countClass(c), 0);
  }
}

(globalThis as any).document = {
  createElement: (tag: string) => new StubNode(tag),
  documentElement: new StubNode('html'),
  fullscreenElement: null,
};

const { TournamentScreen } = await import('../src/ui/screens/tournament.ts');
const { getSave, writeSave } = await import('../src/persistence/save.ts');
const { nextMatch, isHumanMatch } = await import('../src/modes/tournament.ts');
const { TEAM_IDS } = await import('../src/data/index.ts');

const root = new StubNode('div');
const goCalls: Array<{ name: string; params: any }> = [];
const input = {
  refreshPads: () => {},
  menuPressed: () => false,
  connectedPads: () => [],
};
const game = {
  input,
  audio: { music: { start: () => {} } },
  settings: getSave().settings,
  applySettings: () => {},
} as any;

const ctx: any = {
  root,
  input,
  go: (name: string, params: any) => { goCalls.push({ name, params }); },
  replace: () => {},
  reset: (name: string) => { goCalls.push({ name, params: null }); },
  back: () => { goCalls.push({ name: '<back>', params: null }); },
  sound: () => {},
};

function findBtn(screen: any, text: string): any {
  const it = screen.ring.items.find((x: any) => (x.el.textContent as string).toUpperCase().includes(text.toUpperCase()));
  if (!it) {
    throw new Error(`no button matching "${text}" — have: ${screen.ring.items.map((x: any) => x.el.textContent).join(' | ')}`);
  }
  return it;
}

function press(screen: any, text: string): void {
  const it = findBtn(screen, text);
  if (it.onSelect) it.onSelect(); else if (it.onRight) it.onRight();
}

const screen: any = new TournamentScreen(game);

// ── 1. fresh mount lands on setup ────────────────────────────────────────
writeSave({ tournament: null });
screen.mount(ctx);
console.log('view after fresh mount:', screen.view);
console.log('setup items:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));

// tweak options: 4 teams, best of 3, manual draw
findBtn(screen, 'BRACKET SIZE').onLeft();       // 8 -> 4
findBtn(screen, 'SERIES').onRight();            // single -> best of 3
findBtn(screen, 'MATCHUPS').onRight();          // random -> manual
console.log('setup =>', JSON.stringify(screen.setup));

press(screen, 'CHOOSE TEAMS');
console.log('view after choose teams:', screen.view, '· focusable cards:', screen.ring.items.length);

// pick the first team for player 1
screen.ring.items[0].onSelect();
console.log('view after pick:', screen.view, '· field:', screen.field.join(','));

// manual draw: swap seeds, then start
findBtn(screen, 'SEED 1').onRight();
console.log('field after swap:', screen.field.join(','));
press(screen, 'START TOURNAMENT');
console.log('view after start:', screen.view, '· champion:', screen.t.champion);

// ── 2. bracket view renders ──────────────────────────────────────────────
const panelDump = root.dump();
console.log('bracket boxes:', root.countClass('m'), '· live:', root.countClass('live'));
console.log('bracket buttons:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));
if (!panelDump.includes('bracket')) throw new Error('no bracket rendered');

// ── 3. simulate every CPU match in the round ─────────────────────────────
const t0 = Date.now();
press(screen, 'SIMULATE REST OF ROUND');
let frames = 0;
while (screen.sim.active && frames < 400) { screen.update(1 / 30); frames++; }
console.log(`sim finished in ${frames} frames / ${Date.now() - t0} ms · results: ${screen.results.join(' | ')}`);

// ── 4. play the human match ──────────────────────────────────────────────
const t = getSave().tournament!;
const nm = nextMatch(t)!;
console.log('next match:', nm, 'human?', isHumanMatch(t, nm));
press(screen, 'PLAY NEXT MATCH');
const call = goCalls[goCalls.length - 1];
console.log('go ->', call.name, 'seats:', JSON.stringify(call.params.config.seats),
  'stadium:', call.params.config.stadium, 'weather:', call.params.config.weather,
  'return:', call.params.returnScreen);

// simulate the match screen reporting back, twice for a best-of-3
screen.unmount();
call.params.onFinish({ home: 40, away: 12 });
console.log('series after game 1:', JSON.stringify(getSave().tournament!.rounds[0]));
call.params.onFinish({ home: 99, away: 0 });   // stale repeat must be ignored
console.log('after stale repeat  :', JSON.stringify(getSave().tournament!.rounds[0]));

screen.mount(ctx);
console.log('view after returning from match:', screen.view);
press(screen, 'PLAY NEXT MATCH');
const call2 = goCalls[goCalls.length - 1];
screen.unmount();
call2.params.onFinish({ home: 3, away: 55 });
call2.params.onFinish({ home: 21, away: 7 });
screen.mount(ctx);
console.log('round now:', getSave().tournament!.round, 'view:', screen.view);
console.log('buttons:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));

// ── 5. drive the rest of the ladder by simulation ────────────────────────
let guard = 0;
while (!getSave().tournament!.champion && guard++ < 12) {
  const cur = getSave().tournament!;
  const n = nextMatch(cur);
  if (!n) break;
  if (isHumanMatch(cur, n)) {
    press(screen, 'PLAY NEXT MATCH');
    const c = goCalls[goCalls.length - 1];
    screen.unmount();
    c.params.onFinish({ home: 28, away: 14 });
    if (cur.bestOf3) c.params.onFinish({ home: 30, away: 10 });
    screen.mount(ctx);
  } else {
    press(screen, 'SIMULATE NEXT MATCH');
    let f = 0;
    while (screen.sim.active && f < 400) { screen.update(1 / 30); f++; }
  }
}
console.log('champion:', getSave().tournament!.champion, '· view:', screen.view);
console.log('champion buttons:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));

// ── 6. remount with a finished ladder, then start a new one ──────────────
screen.unmount();
screen.mount(ctx);
console.log('remount view:', screen.view);
press(screen, 'NEW TOURNAMENT');
console.log('after new tournament:', screen.view, '· saved:', getSave().tournament);

// ── 7. resume prompt for a half-finished ladder ──────────────────────────
screen.unmount();
press(screen, 'BRACKET SIZE');   // no-op guard: ring still usable after unmount
screen.mount(ctx);
console.log('fresh view (no save):', screen.view);
press(screen, 'CHOOSE TEAMS');
screen.ring.items[2].onSelect();
console.log('auto-start view:', screen.view, '· entrants:', getSave().tournament!.entrants.length);
screen.unmount();
screen.mount(ctx);
console.log('mount with saved ladder:', screen.view, '·', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));
press(screen, 'CONTINUE');
console.log('after continue:', screen.view);
press(screen, 'ABANDON');
console.log('after abandon:', screen.view, '· saved:', getSave().tournament);
console.log('teams available:', TEAM_IDS.length);
console.log('OK');

// ── 8. two humans, 4-team ladder ─────────────────────────────────────────
console.log('\n=== two humans ===');
screen.unmount();
writeSave({ tournament: null });
screen.mount(ctx);
findBtn(screen, 'BRACKET SIZE').onLeft();          // 4 teams
findBtn(screen, 'HUMAN SEATS').onRight();          // 2 players
console.log('setup:', JSON.stringify(screen.setup));
press(screen, 'CHOOSE TEAMS');
console.log('P1 cards:', screen.ring.items.length);
screen.ring.items[0].onSelect();
console.log('view:', screen.view, '· P2 cards:', screen.ring.items.length);
screen.ring.items[0].onSelect();
const t2 = getSave().tournament!;
console.log('view:', screen.view, '· entrants:', JSON.stringify(t2.entrants));
console.log('round 0:', t2.rounds[0].map((m: any) => `${m.a} v ${m.b}`).join(' | '));
const { seatsFor: sf } = await import('../src/modes/tournament.ts');
console.log('derby seats:', JSON.stringify(sf(t2, { a: t2.entrants[0].teamId, b: t2.entrants[1].teamId })));
console.log('buttons:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));

// ── 9. 8-team, human in round one, simulate the rest ─────────────────────
console.log('\n=== eight team, sim rest of round ===');
screen.unmount();
writeSave({ tournament: null });
screen.mount(ctx);
press(screen, 'CHOOSE TEAMS');
screen.ring.items[0].onSelect();
const t3 = getSave().tournament!;
console.log('view:', screen.view, '· round0:', t3.rounds[0].map((m: any) => `${m.a.slice(0, 6)} v ${m.b.slice(0, 6)}`).join(' | '));
console.log('buttons:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));
console.log('bracket boxes:', root.countClass('m'), '· live:', root.countClass('live'), '· rnd cols:', root.countClass('rnd'));
const tStart = Date.now();
press(screen, 'SIMULATE REST OF ROUND');
let f2 = 0;
while (screen.sim.active && f2 < 900) { screen.update(1 / 60); f2++; }
console.log(`round sim: ${Date.now() - tStart} ms · ${screen.results.length} games · ${screen.results.join(' | ')}`);
const t4 = getSave().tournament!;
console.log('round0 done flags:', t4.rounds[0].map((m: any) => m.done).join(','), '· round:', t4.round);
console.log('buttons now:', screen.ring.items.map((i: any) => i.el.textContent).join(' | '));
console.log('DONE');
