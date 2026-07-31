import { startServer, stopServer, launch, probe, screenshot, screenshotDom } from './browser.ts';
async function main(): Promise<void> {
  const url = await startServer(4180);
  const h = await launch(url, { width: 1440, height: 810 });
  await h.page.waitForTimeout(800);
  await screenshotDom(h.page, 'docs/captures/01-title.png');
  await h.page.evaluate(() => (window as any).GO.reset('mainMenu'));
  await h.page.waitForTimeout(700);
  await screenshotDom(h.page, 'docs/captures/02-main-menu.png');
  await h.page.evaluate(() => {
    (window as any).GO.reset('match', { config: { seed: 909090, quarterSeconds: 120, difficulty: 'ALLSTAR',
      seats: [{ side: 0, active: false }, { side: 1, active: false }, { side: 0, active: false }, { side: 1, active: false }] },
      returnScreen: 'mainMenu' });
  });
  await h.page.waitForTimeout(3500);
  for (let i = 0; i < 9; i++) {
    const p = await probe(h.page);
    await screenshot(h.page, `docs/captures/live-${i}-${p.phase}.png`);
    console.log(i, p.phase, 'calls', p.calls, 'tris', p.triangles, 'score', `${p.home}-${p.away}`);
    await h.page.waitForTimeout(1500);
  }
  console.log('errors', JSON.stringify(h.errors.slice(0, 6)));
  await h.close(); stopServer();
}
main().catch((e) => { console.error('ERR', e); stopServer(); process.exit(1); });
