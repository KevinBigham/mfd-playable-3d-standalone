#!/usr/bin/env tsx
/**
 * Repeatable visual review set. Drives a deterministic CPU-vs-CPU match and screenshots the
 * moments that matter. `npm run capture`
 */
import { startServer, stopServer, launch, probe, screenshot } from './browser.ts';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

async function main(): Promise<void> {
  const url = await startServer(4175);
  const h = await launch(url, { width: 1600, height: 900 });
  const { page } = h;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await screenshot(page, `${OUT}/${name}.png`);
    shots.push(name);
    console.log(`  captured ${name}`);
  };

  try {
    await page.waitForTimeout(900);
    await shot('r01-title');
    await page.evaluate(() => (window as unknown as { GO: any }).GO.reset('mainMenu'));
    await page.waitForTimeout(500); await shot('r02-main-menu');
    await page.evaluate(() => (window as unknown as { GO: any }).GO.reset('quickPlay'));
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyS'); await page.keyboard.press('KeyS');
    await page.keyboard.press('KeyS'); await page.keyboard.press('KeyS');
    await page.keyboard.press('Space');
    await page.waitForTimeout(700); await shot('r03-team-select');
    await page.evaluate(() => (window as unknown as { GO: any }).GO.reset('settings'));
    await page.waitForTimeout(400); await shot('r04-settings');
    await page.evaluate(() => (window as unknown as { GO: any }).GO.reset('controls'));
    await page.waitForTimeout(400); await shot('r05-controls');

    // Deterministic CPU-vs-CPU match; grab the moments as they happen.
    for (const [weather, tag] of [['CLEAR', 'clear'], ['RAIN', 'rain'], ['SNOW', 'snow']] as const) {
      await page.evaluate((w) => {
        const g = (window as unknown as { GO: any }).GO;
        g.reset('match', {
          config: {
            seed: 909090, quarterSeconds: 120, difficulty: 'ALLSTAR', weather: w,
            seats: [{ side: 0, active: false }, { side: 1, active: false },
              { side: 0, active: false }, { side: 1, active: false }],
          },
          returnScreen: 'mainMenu',
        });
      }, weather);
      await page.waitForTimeout(2200);

      const want = new Set(['PRE_SNAP', 'LIVE', 'SCORE_RESOLVE']);
      const got = new Set<string>();
      const t0 = Date.now();
      let liveShots = 0;
      while (Date.now() - t0 < 40000 && (got.size < want.size || liveShots < 4)) {
        const p = await probe(page);
        if (p.phase === 'PRE_SNAP' && !got.has('PRE_SNAP')) { got.add('PRE_SNAP'); await shot(`r10-${tag}-presnap`); }
        else if (p.phase === 'SCORE_RESOLVE' && !got.has('SCORE_RESOLVE')) { got.add('SCORE_RESOLVE'); await shot(`r13-${tag}-touchdown`); }
        else if (p.phase === 'LIVE') {
          got.add('LIVE');
          if (liveShots < 4) { await shot(`r1${2 + liveShots}-${tag}-live-${liveShots}`); liveShots++; }
        }
        await page.waitForTimeout(320);
      }
      if (tag === 'clear') {
        // Let it run to a final and capture the stats screen.
        const t1 = Date.now();
        while (Date.now() - t1 < 200000) {
          const p = await probe(page);
          if (p.screen === 'final' || p.phase === 'FINAL') break;
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(2500);
        await shot('r20-final-stats');
      }
    }
  } finally {
    await h.close();
    stopServer();
  }
  console.log(`\n${shots.length} captures written to ${OUT}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
