import { startServer, stopServer, launch, probe, screenshot, screenshotDom } from './browser.ts';
import type { Page } from 'playwright';

async function toPhase(page: Page, phase: string, maxTicks = 4000): Promise<string> {
  return page.evaluate(({ phase, maxTicks }) => {
    const g = (window as any).GO; const m = g.match;
    if (!m) return 'NONE';
    let t = 0;
    while (t < maxTicks && m.state.phase !== phase) { m.tick(); t++; }
    return m.state.phase;
  }, { phase, maxTicks });
}
async function advance(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => { const m = (window as any).GO.match; for (let i = 0; i < n; i++) m.tick(); }, ticks);
}

async function main(): Promise<void> {
  const url = await startServer(4180);
  const h = await launch(url, { width: 1440, height: 810 });
  const { page } = h;
  await page.waitForTimeout(600);
  const shot = async (n: string) => { await screenshot(page, `docs/captures/${n}.png`); console.log('  ' + n); };
  const shotUi = async (n: string) => { await screenshotDom(page, `docs/captures/${n}.png`); console.log('  ' + n); };
  await shotUi('r01-title');
  await page.evaluate(() => (window as any).GO.reset('mainMenu'));
  await page.waitForTimeout(500); await shotUi('r02-main-menu');
  await page.evaluate(() => {
    (window as any).GO.reset('match', { config: { seed: 20260731, quarterSeconds: 120, difficulty: 'ALLSTAR',
      seats: [{ side: 0, active: true }, { side: 1, active: false }, { side: 0, active: false }, { side: 1, active: false }] },
      returnScreen: 'mainMenu' });
  });
  await page.waitForTimeout(2500);
  console.log('kickoff:', await toPhase(page, 'KICKOFF_LIVE'));
  await advance(page, 40); await page.waitForTimeout(700); await shot('r10-kickoff');
  console.log('presnap:', await toPhase(page, 'PRE_SNAP'));
  await page.waitForTimeout(900); await shotUi('r11-presnap');
  console.log('live:', await toPhase(page, 'LIVE'));
  for (let i = 0; i < 5; i++) { await advance(page, 22); await page.waitForTimeout(650); await shot(`r12-live-${i}`); }
  await advance(page, 260); await page.waitForTimeout(700); await shot('r13-after-play');
  console.log('errors', JSON.stringify(h.errors.slice(0, 5)));
  await h.close(); stopServer();
}
main().catch((e) => { console.error('ERR', e); stopServer(); process.exit(1); });
