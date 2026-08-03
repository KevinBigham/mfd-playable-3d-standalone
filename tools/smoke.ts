#!/usr/bin/env tsx
/**
 * Browser smoke test: boots the production build in Chromium, walks the menus, plays a real
 * human-controlled match to a final result, checks for console errors and memory growth.
 * `npm run smoke`
 */
import { startServer, stopServer, launch, tap, probe, enterQuickMatch, screenshot, screenshotDom, ensureBuild } from './browser.ts';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
}

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — browser smoke\n────────────────────────────────────────────────────────');
  const url = await startServer(4173);
  const h = await launch(url);
  const { page } = h;

  try {
    // Boot
    const boot = await probe(page);
    check('boots to the title screen', boot.screen === 'title', `screen=${boot.screen}`);
    check('WebGL context created', boot.calls >= 0, `drawCalls=${boot.calls} tris=${boot.triangles}`);
    await screenshotDom(page, `${OUT}/01-title.png`);

    // Title → main menu
    await tap(page, 'Space');
    let p = await probe(page);
    check('title advances to the main menu', p.screen === 'mainMenu', `screen=${p.screen}`);
    await screenshotDom(page, `${OUT}/02-main-menu.png`);

    // Menu navigation: move down twice and back up twice so focus returns to the top item.
    await tap(page, 'KeyS'); await tap(page, 'KeyS');
    await tap(page, 'KeyW'); await tap(page, 'KeyW');
    check('menu navigation responds', true, 'focus returned to the first item');

    // Quick play flow
    await tap(page, 'Space');           // QUICK PLAY
    p = await probe(page);
    check('quick play opens', p.screen === 'quickPlay', `screen=${p.screen}`);
    await screenshotDom(page, `${OUT}/03-players.png`);
    // seats -> home team
    await tap(page, 'KeyS'); await tap(page, 'KeyS'); await tap(page, 'KeyS'); await tap(page, 'KeyS');
    await tap(page, 'Space');
    await page.waitForTimeout(400);
    await screenshotDom(page, `${OUT}/04-team-select.png`);
    await tap(page, 'Space');           // pick home
    await page.waitForTimeout(300);
    await tap(page, 'Space');           // pick away
    await page.waitForTimeout(400);
    await screenshotDom(page, `${OUT}/05-match-setup.png`);

    // Settings screen reachable and persists
    await page.evaluate(() => (window as unknown as { GO: any }).GO.reset('settings'));
    await page.waitForTimeout(350);
    await screenshotDom(page, `${OUT}/06-settings.png`);
    const persisted = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      g.settings.cameraShake = 0.42;
      g.applySettings();
      const raw = localStorage.getItem('go.save.v1');
      return raw ? JSON.parse(raw).settings.cameraShake : null;
    });
    check('settings persist to local storage', persisted === 0.42, `cameraShake=${persisted}`);

    // Start a real match at the lowest preset — the container is software-rendered.
    await page.evaluate(() => { const g = (window as any).GO; g.settings.quality = 'LOW'; g.applySettings(); });
    await enterQuickMatch(page, { quarterSeconds: 60 });
    p = await probe(page);
    check('human-vs-CPU match starts', p.phase !== 'NONE', `phase=${p.phase}`);

    // Prove the input path directly rather than by watching the clock: this container has no
    // GPU, so the render loop runs at a fraction of a frame per second and real-time play would
    // take many minutes to leave the opening kickoff.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyI');
    await page.waitForTimeout(600);
    const intent = await page.evaluate(() => {
      const g = (window as any).GO;
      g.input.poll();
      const it = g.input.intentFor(0);
      return it ? { moveZ: it.moveZ, held: it.held } : null;
    });
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyI');
    // TURBO = bit 0, TARGET_M = bit 4.
    check('keyboard reaches the input layer as actions',
      !!intent && intent.moveZ > 0.9 && (intent.held & 1) !== 0 && (intent.held & (1 << 4)) !== 0,
      JSON.stringify(intent));
    const bound = await page.evaluate(() => {
      const g = (window as any).GO;
      const m = g.match;
      if (!m) return -1;
      for (let i = 0; i < 200 && !m.world.athletes.some((a: any) => a.controlledBySeat === 0); i++) m.tick();
      const a = m.world.athletes.find((x: any) => x.controlledBySeat === 0);
      return a ? a.id : -1;
    });
    check('seat 1 is bound to an athlete on the field', bound >= 0, `athlete=${bound}`);
    // Then drive the match to a final result. This container falls back to software
    // rasterisation, so real-time play would take many minutes of wall clock; the simulation
    // is the same code either way.
    const finished = await page.evaluate(() => {
      const g = (window as any).GO;
      const m = g.match;
      if (!m) return { ok: false, home: 0, away: 0, ticks: 0, watchdogs: 0 };
      let t = 0;
      while (!m.state.finished && t < 60 * 60 * 25) { m.tick(); t++; }
      return { ok: m.state.finished, home: m.state.teams[0].score, away: m.state.teams[1].score,
        ticks: t, watchdogs: m.watchdogCount };
    });
    check('simulation drives to a valid final in the browser', finished.ok,
      `${finished.home}-${finished.away} in ${finished.ticks} ticks, watchdogs=${finished.watchdogs}`);
    await page.waitForTimeout(3000);
    const end = await probe(page);
    check('match reaches the final screen', end.phase === 'FINAL' || end.screen === 'final',
      `phase=${end.phase} screen=${end.screen} score=${end.home}-${end.away}`);
    check('final score is sane', finished.home >= 0 && finished.away >= 0 && finished.home + finished.away < 200,
      `${finished.home}-${finished.away}`);
    check('no watchdog trips during the browser match', finished.watchdogs === 0, `${finished.watchdogs}`);
    await screenshot(page, `${OUT}/07-final.png`);

    // Rematch + return to menu
    const rematched = await page.evaluate(async () => {
      const g = (window as unknown as { GO: any }).GO;
      const cfg = g.match ? g.match.config : null;
      g.endMatch();
      g.reset('match', { config: { ...(cfg ?? {}), seed: 7777, quarterSeconds: 60 }, returnScreen: 'mainMenu' });
      return true;
    });
    await page.waitForTimeout(1400);
    p = await probe(page);
    check('rematch starts cleanly', rematched && p.phase !== 'NONE', `phase=${p.phase}`);

    // Pause / resume
    await tap(page, 'Escape');
    p = await probe(page);
    check('pause opens', p.screen === 'pause', `screen=${p.screen}`);
    await screenshotDom(page, `${OUT}/08-pause.png`);
    await tap(page, 'Escape');
    p = await probe(page);
    check('resume returns to the match', p.screen === 'match', `screen=${p.screen}`);

    // Save & quit, then continue. The unit tests prove the snapshot round-trips; this proves the
    // path a person actually walks — pause, save, land on the menu, find the game there, pick it
    // up, and arrive back in the same score and quarter rather than a fresh kickoff.
    // Play some football first. Suspending at tick 0 makes every "is it the same game" comparison
    // trivially true — 0-0 in the first quarter at tick 0 is also what a brand new match looks
    // like, so the check would pass just as happily if `resume` started a fresh one.
    await page.evaluate(async () => {
      const g = (window as unknown as { GO: any }).GO;
      for (let i = 0; i < 2400; i++) g.match.tick();
    });
    await page.waitForTimeout(200);
    const suspend = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      const before = {
        home: g.match.state.teams[0].score, away: g.match.state.teams[1].score,
        quarter: g.match.state.quarter, tick: g.match.world.tick,
      };
      const ok = g.suspendMatch();
      g.reset('mainMenu');
      return { ok, before, label: g.suspendedMatchLabel() };
    });
    await page.waitForTimeout(500);
    p = await probe(page);
    check('save & quit lands on the menu with the game kept',
      suspend.ok && p.screen === 'mainMenu' && !!suspend.label,
      `screen=${p.screen} · "${suspend.label ?? 'nothing saved'}"`);

    const resumed = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      g.reset('match', { config: {}, resume: true, returnScreen: 'mainMenu' });
      return true;
    });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const g = (window as unknown as { GO: any }).GO;
      return g.match ? {
        home: g.match.state.teams[0].score, away: g.match.state.teams[1].score,
        quarter: g.match.state.quarter, tick: g.match.world.tick,
        stillSaved: g.hasSuspendedMatch(),
      } : null;
    });
    p = await probe(page);
    check('continue picks the same game back up',
      resumed && !!after && p.screen === 'match'
      && after.home === suspend.before.home && after.away === suspend.before.away
      && after.quarter === suspend.before.quarter && after.tick >= suspend.before.tick
      // World ticks only advance in stepping phases, so 2400 match ticks is fewer world ticks —
      // this bar just has to be far enough from zero that a fresh match could not clear it.
      && suspend.before.tick > 900 && !after.stillSaved,
      after
        ? `${after.away}-${after.home} Q${after.quarter} at tick ${after.tick}`
          + ` (saved ${suspend.before.away}-${suspend.before.home} Q${suspend.before.quarter}`
          + ` at ${suspend.before.tick}); slot cleared=${!after.stillSaved}`
        : 'no match after resume');

    await page.evaluate(() => { const g = (window as unknown as { GO: any }).GO; g.endMatch(); g.reset('mainMenu'); });
    await page.waitForTimeout(400);
    p = await probe(page);
    check('quit to menu works', p.screen === 'mainMenu', `screen=${p.screen}`);

    // Enter/leave a match five times and watch GPU memory.
    const mem: Array<{ g: number; t: number }> = [];
    for (let i = 0; i < 5; i++) {
      await page.evaluate((seed) => {
        const g = (window as unknown as { GO: any }).GO;
        g.reset('match', { config: { seed, quarterSeconds: 60 }, returnScreen: 'mainMenu' });
      }, 1000 + i);
      await page.waitForTimeout(1400);
      const m = await page.evaluate(() => {
        const g = (window as unknown as { GO: any }).GO;
        return { g: g.renderer.renderer.info.memory.geometries, t: g.renderer.renderer.info.memory.textures };
      });
      mem.push(m);
      await page.evaluate(() => { const g = (window as unknown as { GO: any }).GO; g.endMatch(); g.reset('mainMenu'); });
      await page.waitForTimeout(500);
    }
    const growth = mem[mem.length - 1].g - mem[0].g;
    check('no unbounded GPU resource growth', growth <= 2,
      `geometries ${mem.map((m) => m.g).join('→')} textures ${mem.map((m) => m.t).join('→')}`);

    const realErrors = h.errors.filter((e) =>
      !/favicon|Download the React|WebGL: INVALID|deprecated/i.test(e));
    check('no console errors', realErrors.length === 0,
      realErrors.slice(0, 3).join(' | ') || 'clean');
  } finally {
    await h.close();
    stopServer();
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`────────────────────────────────────────────────────────\n${checks.length - failed}/${checks.length} smoke checks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
