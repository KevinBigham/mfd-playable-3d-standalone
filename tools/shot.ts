#!/usr/bin/env tsx
/**
 * Targeted screenshot of one match moment. `npm run shot -- --phase SCORE_RESOLVE --name x`
 *
 * The full review set (`npm run capture`) takes several minutes under software rendering;
 * this exists to check a single framing change without re-shooting all thirty images.
 */
import { startServer, stopServer, launch, screenshot, screenshotDom, ensureBuild } from './browser.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const phase = arg('phase', 'SCORE_RESOLVE');
const name = arg('name', 'shot');
const seed = Number(arg('seed', '909090'));
const settle = Number(arg('settle', '900'));
const extra = Number(arg('extra', '0'));
/** Seconds of real tick+present, for anything transient: trails, sparks, spray. */
const live = Number(arg('live', '0'));
const home = arg('home', '');
const away = arg('away', '');
const dom = process.argv.includes('--dom');

async function main(): Promise<void> {
  ensureBuild();
  const url = await startServer(4179);
  const h = await launch(url, { width: 1440, height: 810 });
  const { page } = h;
  try {
    await page.evaluate(({ s, home, away }) => {
      (window as any).GO.reset('match', {
        config: {
          seed: s, quarterSeconds: 120, difficulty: 'ALLSTAR',
          ...(home ? { home } : {}), ...(away ? { away } : {}),
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
    }, { s: seed, home, away });
    await page.waitForTimeout(2600);
    const reached = await page.evaluate((p) => {
      const m = (window as any).GO.match;
      if (!m) return 'NONE';
      let t = 0;
      while (t < 20000 && m.state.phase !== p) { m.tick(); t++; }
      return m.state.phase;
    }, phase);
    if (extra > 0) {
      await page.evaluate((n) => { const m = (window as any).GO.match; for (let i = 0; i < n; i++) m.tick(); }, extra);
    }
    if (live > 0) {
      await page.evaluate((sec) => { (window as any).GO.advance?.(sec); }, live);
    } else {
      // Let the camera and every cross-fade reach their resting state before shooting.
      await page.evaluate(() => { (window as any).GO.settle?.(1.6); });
    }
    await page.waitForTimeout(settle);
    const out = `docs/captures/${name}.png`;
    if (dom) await screenshotDom(page, out); else await screenshot(page, out);
    console.log(`${out}  (phase ${reached})`);
    console.log('console errors:', JSON.stringify(h.errors.slice(0, 4)));
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
