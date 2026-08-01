#!/usr/bin/env tsx
/**
 * Repeatable visual review set. `npm run capture`
 *
 * Drives the simulation programmatically between shots: this container has no GPU, so waiting
 * for the real-time loop to reach an interesting moment would take many minutes per frame.
 * The rendering path is identical either way — only the pacing differs.
 */
import { startServer, stopServer, launch, probe, screenshot, screenshotDom } from './browser.ts';
import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

async function toPhase(page: Page, phase: string, maxTicks = 6000): Promise<string> {
  return page.evaluate(({ phase, maxTicks }) => {
    const g = (window as any).GO; const m = g.match;
    if (!m) return 'NONE';
    let t = 0;
    while (t < maxTicks && m.state.phase !== phase) { m.tick(); t++; }
    return m.state.phase;
  }, { phase, maxTicks });
}
async function advance(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => { const m = (window as any).GO.match; if (m) for (let i = 0; i < n; i++) m.tick(); }, ticks);
}
/**
 * Ease the camera and every cross-fade to rest without drawing. Software rasterisation runs at
 * well under one frame a second here, so a real-time wait catches the camera mid-transition and
 * the review set would show framings the game never actually settles on.
 */
async function settle(page: Page, seconds = 1.6): Promise<void> {
  await page.evaluate((sec) => { (window as any).GO.settle?.(sec); }, seconds);
}
async function startMatch(page: Page, weather: string, seed: number): Promise<void> {
  await page.evaluate(({ weather, seed }) => {
    (window as any).GO.reset('match', {
      config: {
        seed, quarterSeconds: 120, difficulty: 'ALLSTAR', weather,
        seats: [{ side: 0, active: false }, { side: 1, active: false },
          { side: 0, active: false }, { side: 1, active: false }],
      },
      returnScreen: 'mainMenu',
    });
  }, { weather, seed });
  await page.waitForTimeout(2600);
}

async function main(): Promise<void> {
  const url = await startServer(4175);
  const h = await launch(url, { width: 1440, height: 810 });
  const { page } = h;
  const shots: string[] = [];
  const shot = async (n: string, dom = false) => {
    if (dom) await screenshotDom(page, `${OUT}/${n}.png`);
    else await screenshot(page, `${OUT}/${n}.png`);
    shots.push(n);
    console.log(`  ${n}`);
  };

  try {
    await page.waitForTimeout(900);
    await shot('01-title', true);
    for (const [screen, name] of [['mainMenu', '02-main-menu'], ['quickPlay', '03-players'],
      ['settings', '05-settings'], ['controls', '06-controls'], ['credits', '07-credits'],
      ['tournament', '08-tournament'], ['season', '09-season'], ['practice', '10-practice'],
      ['playEditor', '11-play-editor']] as const) {
      await page.evaluate((s) => (window as any).GO.reset(s), screen);
      await page.waitForTimeout(700);
      await shot(name, true);
    }
    // Team select is a sub-step of quick play.
    await page.evaluate(() => (window as any).GO.reset('quickPlay'));
    await page.waitForTimeout(600);
    for (let i = 0; i < 4; i++) await page.keyboard.press('KeyS');
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    await shot('04-team-select', true);

    for (const [weather, tag, seed] of [['CLEAR', 'clear', 909090], ['RAIN', 'rain', 4242], ['SNOW', 'snow', 777]] as const) {
      await startMatch(page, weather, seed);
      await toPhase(page, 'KICKOFF_LIVE');
      await advance(page, 60); await settle(page); await page.waitForTimeout(400); await shot(`20-${tag}-kickoff`);
      await toPhase(page, 'PRE_SNAP');
      await settle(page); await page.waitForTimeout(400); await shot(`21-${tag}-presnap`, true);
      await toPhase(page, 'LIVE');
      for (let i = 0; i < 3; i++) {
        await advance(page, 20); await settle(page, 0.5); await page.waitForTimeout(400);
        await shot(`22-${tag}-live-${i}`);
      }
      // Run forward to a score and grab the celebration.
      await toPhase(page, 'SCORE_RESOLVE', 12000);
      await advance(page, 70);      // let the celebration get going before the shot
      await settle(page, 2.2); await page.waitForTimeout(400); await shot(`23-${tag}-score`, true);
      if (tag === 'clear') {
        await page.evaluate(() => { const m = (window as any).GO.match; let t = 0; while (m && !m.state.finished && t < 60 * 60 * 25) { m.tick(); t++; } });
        await page.waitForTimeout(3200);
        await shot('30-final-stats', true);
      }
    }
    console.log('console errors:', JSON.stringify(h.errors.slice(0, 4)));
  } finally {
    await h.close();
    stopServer();
  }
  console.log(`\n${shots.length} captures written to ${OUT}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
