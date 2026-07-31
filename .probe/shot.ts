import { startServer, stopServer, launch } from '../tools/browser.ts';
import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '/tmp/shots'; mkdirSync(OUT, { recursive: true });

async function toPhase(page: Page, phase: string, maxTicks = 6000) {
  return page.evaluate(({ phase, maxTicks }) => {
    const m = (window as any).GO.match; if (!m) return 'NONE';
    let t = 0; while (t < maxTicks && m.state.phase !== phase) { m.tick(); t++; }
    return m.state.phase;
  }, { phase, maxTicks });
}
async function dom(page: Page, name: string) {
  await page.evaluate(() => { const g=(window as any).GO; try{g.renderer.render();}catch{} g.stop(); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, type: 'png', timeout: 60000 });
  await page.evaluate(() => (window as any).GO.start());
  console.log('shot', name);
}

async function main() {
  const url = await startServer(4188);
  const h = await launch(url, { width: 1440, height: 810 });
  const { page } = h;
  await page.waitForTimeout(1200);
  await dom(page, '00-title');
  // Quick match with TWO human seats so turbo bars + rings show
  await page.evaluate(() => {
    (window as any).GO.reset('match', { config: {
      seed: 909090, quarterSeconds: 120, difficulty: 'ALLSTAR', weather: 'CLEAR',
      seats: [{side:0,active:true},{side:1,active:true},{side:0,active:false},{side:1,active:false}],
      mode:'QUICKPLAY' }, returnScreen: 'mainMenu' });
  });
  await page.waitForTimeout(2600);
  console.log('teams:', await page.evaluate(()=>{const g=(window as any).GO;const m=g.match;return JSON.stringify({home:m.home?.abbr??m.config?.homeId, away:m.away?.abbr??m.config?.awayId, keys:Object.keys(m).slice(0,25)})}));
  await toPhase(page, 'PLAY_CALL');
  await page.waitForTimeout(700); await dom(page, '10-playcall');
  await toPhase(page, 'PRE_SNAP');
  await page.waitForTimeout(700); await dom(page, '11-presnap-hud');
  await toPhase(page, 'LIVE');
  await page.evaluate(()=>{const m=(window as any).GO.match; for(let i=0;i<22;i++) m.tick();});
  await page.waitForTimeout(650); await dom(page, '12-live-hud');
  await page.evaluate(()=>{const m=(window as any).GO.match; for(let i=0;i<25;i++) m.tick();});
  await page.waitForTimeout(650); await dom(page, '13-live-hud2');
  // run to final
  await page.evaluate(()=>{const m=(window as any).GO.match; let t=0; while(m&&!m.state.finished&&t<60*60*25){m.tick();t++;}});
  await page.waitForTimeout(4000); await dom(page, '20-final');
  await page.waitForTimeout(4000); await dom(page, '21-final-later');
  console.log('screen now:', await page.evaluate(()=>(window as any).GO.currentScreen));
  console.log('errors:', JSON.stringify(h.errors.slice(0,6)));
  await h.close(); stopServer(); process.exit(0);
}
main().catch(e=>{console.error(e); stopServer(); process.exit(1);});
