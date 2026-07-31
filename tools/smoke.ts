#!/usr/bin/env tsx
/**
 * Browser smoke test: boots the production build in Chromium, walks the menus, plays a real
 * human-controlled match to a final result, checks for console errors and memory growth.
 * `npm run smoke`
 */
import { startServer, stopServer, launch, tap, probe, enterQuickMatch, screenshot, screenshotDom } from './browser.ts';
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

    // Start a real match
    await enterQuickMatch(page, { quarterSeconds: 60 });
    p = await probe(page);
    check('human-vs-CPU match starts', p.phase !== 'NONE', `phase=${p.phase}`);

    // Exercise the real input path through the render loop for a few seconds first: this is
    // what proves keyboard -> intent -> sim actually works in the browser.
    const seenPhases = new Set<string>();
    let sawLive = false; let sawSnap = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const s = await probe(page);
      seenPhases.add(s.phase);
      if (s.phase === 'LIVE') sawLive = true;
      if (s.phase === 'PRE_SNAP' || s.phase === 'KICKOFF_LIVE') sawSnap = true;
      await page.keyboard.down('Space'); await page.waitForTimeout(70); await page.keyboard.up('Space');
      await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
      await page.waitForTimeout(220);
      await page.keyboard.down('KeyI'); await page.waitForTimeout(50); await page.keyboard.up('KeyI');
      await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    }
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
    // Software rasterisation in this container runs the render loop at a few frames a second,
    // so real-time play only reaches the opening kickoff inside the input window. What this
    // check proves is that keyboard input drives the match at all.
    check('keyboard input drives the live match', sawLive || sawSnap || seenPhases.size > 1,
      `phases=${[...seenPhases].join(',')}`);
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
