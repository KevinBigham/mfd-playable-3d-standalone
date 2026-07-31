import { chromium } from 'playwright';
const url = 'http://127.0.0.1:5202/probe-editor/index.html';
const R = []; const check = (n,p,d='') => { R.push(p); console.log(`${p?'PASS':'FAIL'}  ${n.padEnd(54)} ${d}`); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.GO, null, { timeout: 180000 });

// Rendering is ~0.3 fps under swiftshader here, so drive the simulation directly
// and let one animation frame run between bursts so the screen's update() fires.
await page.exposeFunction('noop', () => {});
const burst = (iters, per) => page.evaluate(async ([n, p]) => {
  const log = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) if (window.GO.match && !window.GO.paused) window.GO.match.tick();
    await new Promise(r => requestAnimationFrame(r));
    const m = window.GO.match;
    if (m) log.push({ t: m.world.tick, ph: m.state.phase, los: m.state.losZ, dn: m.state.down, pp: m.world.playPhase });
  }
  return log;
}, [iters, per]);

await page.evaluate(() => { localStorage.removeItem('go.save.v1'); window.GO.reset('practice'); });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const R2 = () => [...document.querySelectorAll('#ui-root .go-opt')];
  const hit = (l,n) => { const r = R2().find(x => x.querySelector('.go-opt-label')?.textContent === l); for (let i=0;i<n;i++) r.querySelectorAll('.go-opt-arrow')[1].click(); };
  hit('BALL ON', 3); await new Promise(r=>requestAnimationFrame(r));
  [...document.querySelectorAll('#ui-root .go-btn')].find(x=>x.textContent.trim()==='START DRILL').click();
});
await page.waitForFunction(() => !!window.GO.match, null, { timeout: 120000 });

let log = await burst(45, 40);
const phases = new Set(log.map(e => e.ph));
check('the drill actually snaps and runs live plays', phases.has('LIVE'), [...phases].join(','));
check('plays end and the drill comes back for another rep', phases.has('DEAD_BALL') || phases.has('PLAY_CALL'), [...phases].join(','));
check('REPEAT SPOT keeps every rep on the chosen spot', log.every(e => e.los === 40), `unique los = ${[...new Set(log.map(e=>e.los))].join(',')}`);
check('the down never drifts off the chosen down', log.every(e => e.dn === 1), `downs = ${[...new Set(log.map(e=>e.dn))].join(',')}`);
const reps = await page.evaluate(() => (document.body.innerText.match(/REP (\d+)/)||[])[1]);
check('the rep counter advances', Number(reps) >= 1, `reps=${reps}`);
check('no watchdog or stall: the tick count climbs', log[log.length-1].t > 1200, `tick=${log[log.length-1].t}`);
const dev = await page.evaluate(() => document.body.innerText.includes('DEV OVERLAY'));
check('dev overlay stays off when it was never enabled', dev === false);

// REPEAT SPOT off: the drive should now advance naturally.
await page.evaluate(async () => {
  [...document.querySelectorAll('#ui-root .go-btn')].find(x=>x.textContent.trim()==='REPEAT').click();
  await new Promise(r=>requestAnimationFrame(r));
});
log = await burst(45, 40);
check('REPEAT SPOT off lets the drive move down the field', new Set(log.map(e=>e.los)).size > 1,
  `los values = ${[...new Set(log.map(e=>e.los))].slice(0,6).join(',')}`);
check('the drill still never ends the match', await page.evaluate(() => !window.GO.match.state.finished));

// ROUTES ONLY
await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyH',bubbles:true}));
  await new Promise(r=>requestAnimationFrame(r));
  window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyH',bubbles:true}));
  await new Promise(r=>requestAnimationFrame(r));
});
await page.waitForTimeout(500);
await page.evaluate(async () => {
  const R2 = [...document.querySelectorAll('#ui-root .go-opt')];
  R2.find(x=>x.querySelector('.go-opt-label')?.textContent==='DRILL').querySelectorAll('.go-opt-arrow')[0].click();
  await new Promise(r=>requestAnimationFrame(r));
  [...document.querySelectorAll('#ui-root .go-btn')].find(x=>x.textContent.trim()==='START DRILL').click();
});
await page.waitForFunction(() => !!window.GO.match, null, { timeout: 120000 });
await burst(30, 40);
const frozen = await page.evaluate(() => {
  const w = window.GO.match.world;
  const d = w.athletes.slice(7);
  return { freeze: w.freezeDefense, moved: d.some(a => Math.hypot(a.x - a.homeX, a.z - a.homeZ) > 0.6), pp: w.playPhase };
});
check('ROUTES ONLY sets freezeDefense', frozen.freeze === true);
check('frozen defenders never leave their alignment', frozen.moved === false, JSON.stringify(frozen));
check('no console errors', errors.length === 0, errors.slice(0,3).join(' // '));
await b.close();
console.log(`\n${R.filter(Boolean).length}/${R.length} checks passed`);
process.exit(R.every(Boolean) ? 0 : 1);
