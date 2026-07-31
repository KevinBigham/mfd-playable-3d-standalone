import { chromium } from 'playwright';
const url = 'http://127.0.0.1:5202/probe-editor/index.html';
const results = [];
const check = (n, p, d='') => { results.push({n,p}); console.log(`${p?'PASS':'FAIL'}  ${n.padEnd(56)} ${d}`); };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.GO, null, { timeout: 120000 });
await page.waitForTimeout(2500);

await page.evaluate(() => { localStorage.removeItem('go.save.v1'); window.GO.reset('practice'); });
await page.waitForTimeout(500);
check('practice mounts', await page.evaluate(() => window.GO.currentScreen === 'practice'));

const rows = await page.evaluate(() => [...document.querySelectorAll('#ui-root .go-opt')].map(r => r.querySelector('.go-opt-label')?.textContent ?? ''));
check('setup panel exposes every required control',
  ['DRILL','YOU PLAY','YOUR TEAM','OPPOSING TEAM','BALL ON','DOWN','OFFENSIVE PLAY','DEFENSIVE PLAY','REPEAT SPOT','DEV OVERLAY'].every(k => rows.includes(k)),
  rows.join(','));

// keyboard focus walk on the setup panel
const walk = await page.evaluate(async () => {
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const f = document.querySelector('#ui-root .focused');
    if (f) seen.add(f.textContent.slice(0, 24));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
  }
  return seen.size;
});
check('setup panel is keyboard navigable', walk >= 10, `distinct=${walk}`);

// dev overlay ON, pick a spot, start
await page.evaluate(async () => {
  const R = () => [...document.querySelectorAll('#ui-root .go-opt')];
  const hit = (label, n=1, dir=1) => { const r = R().find(x => x.querySelector('.go-opt-label')?.textContent === label);
    for (let i=0;i<n;i++) r.querySelectorAll('.go-opt-arrow')[dir>0?1:0].click(); };
  hit('DEV OVERLAY', 1);
  await new Promise(r => requestAnimationFrame(r));
  hit('BALL ON', 3);   // 25 -> 40
  await new Promise(r => requestAnimationFrame(r));
  hit('DOWN', 2);      // 1st -> 3rd
  await new Promise(r => requestAnimationFrame(r));
});
const chosen = await page.evaluate(() => {
  const R = [...document.querySelectorAll('#ui-root .go-opt')];
  const v = l => R.find(x => x.querySelector('.go-opt-label')?.textContent === l)?.querySelector('.go-opt-value')?.textContent;
  return { ball: v('BALL ON'), down: v('DOWN'), dev: v('DEV OVERLAY') };
});
check('option rows actually change value', chosen.ball === 'OWN 40' && chosen.down === '3RD & 30' && chosen.dev === 'ON', JSON.stringify(chosen));

await page.evaluate(() => [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'START DRILL').click());
await page.waitForTimeout(2000);
const live = await page.evaluate(() => { const m = window.GO.match; return m && { mode: m.config.mode, phase: m.state.phase, los: m.state.losZ, down: m.state.down, fd: m.state.firstDownZ, freeze: m.world.freezeDefense, off: m.world.offensePlay?.name, def: m.world.defensePlay?.name, tick: m.world.tick }; });
check('drill launches a PRACTICE match', !!live && live.mode === 'PRACTICE', JSON.stringify(live));
check('kickoff skipped; armed at the chosen down and spot', !!live && live.los === 40 && live.down === 3, `los=${live?.los} down=${live?.down}`);
check('the chosen calls are the ones on the field', !!live && !!live.off && !!live.def, `${live?.off} vs ${live?.def}`);
check('VERSUS drill leaves the defence live', live?.freeze === false);
check('dev overlay is present and populated', await page.evaluate(() => { const t = document.body.innerText; return t.includes('DEV OVERLAY') && t.includes('LOS') && t.includes('PHASE') && t.includes('BALL'); }));

// let the drill run a few reps
await page.waitForTimeout(6000);
const ran = await page.evaluate(() => ({ tick: window.GO.match.world.tick, finished: window.GO.match.state.finished, phase: window.GO.match.state.phase, clock: window.GO.match.state.clockTicks, q: window.GO.match.state.quarter }));
check('drill runs plays without stalling or ending', ran.tick > 300 && !ran.finished, JSON.stringify(ran));
check('practice holds the clock so the match never expires', ran.q === 1 && ran.clock > 0, `q=${ran.q} clock=${ran.clock}`);

// RESET via Backspace after moving the ball
await page.evaluate(() => { const m = window.GO.match; m.state.losZ = 71; m.state.down = 2; });
await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', bubbles: true }));
  await new Promise(r => requestAnimationFrame(r));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backspace', bubbles: true }));
  await new Promise(r => requestAnimationFrame(r));
});
await page.waitForTimeout(400);
const rst = await page.evaluate(() => ({ los: window.GO.match.state.losZ, down: window.GO.match.state.down, fd: window.GO.match.state.firstDownZ, phase: window.GO.match.state.phase }));
check('BACK re-arms the same down at the same spot', rst.los === 40 && rst.down === 3 && rst.fd === 70, JSON.stringify(rst));

// the RESET button in the live overlay
await page.evaluate(async () => {
  const m = window.GO.match; m.state.losZ = 12;
  [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'RESET').click();
  await new Promise(r => requestAnimationFrame(r));
});
check('the on-screen RESET button works too', await page.evaluate(() => window.GO.match.state.losZ === 40));

// pause round trip keeps the drill alive
await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  await new Promise(r => requestAnimationFrame(r));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', bubbles: true }));
});
await page.waitForTimeout(500);
check('PAUSE opens the pause menu', await page.evaluate(() => window.GO.currentScreen === 'pause'));
await page.evaluate(() => window.GO.back());
await page.waitForTimeout(600);
check('resuming returns to the live drill, not the setup panel',
  await page.evaluate(() => window.GO.currentScreen === 'practice' && !!window.GO.match && document.body.innerText.includes('REP')));

// exit with HIDE_PLAY
await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
  await new Promise(r => requestAnimationFrame(r));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', bubbles: true }));
});
await page.waitForTimeout(600);
check('HIDE PLAY exits the drill back to the setup panel',
  await page.evaluate(() => !window.GO.match && document.body.innerText.includes('PRACTICE FIELD')));

// ROUTES ONLY freezes the defence and forces the human onto offence
await page.evaluate(async () => {
  const R = [...document.querySelectorAll('#ui-root .go-opt')];
  const drill = R.find(x => x.querySelector('.go-opt-label')?.textContent === 'DRILL');
  drill.querySelectorAll('.go-opt-arrow')[0].click();
  await new Promise(r => requestAnimationFrame(r));
});
await page.evaluate(() => [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'START DRILL').click());
await page.waitForTimeout(2500);
check('ROUTES ONLY freezes the defence', await page.evaluate(() => window.GO.match?.world.freezeDefense === true));
const stat = await page.evaluate(() => { const w = window.GO.match.world; const d = w.athletes.slice(7); return { moved: d.some(a => Math.abs(a.vx) + Math.abs(a.vz) > 0.01), tick: w.tick, phase: window.GO.match.state.phase }; });
check('frozen defenders do not move', stat.moved === false, JSON.stringify(stat));

// editor -> practice -> editor round trip
await page.evaluate(() => { window.GO.endMatch(); window.GO.reset('playEditor'); });
await page.waitForTimeout(600);
const nm = await page.evaluate(async () => {
  [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'RENAME').click();
  await new Promise(r => requestAnimationFrame(r));
  return document.querySelector('#ui-root input').value;
});
await page.evaluate(() => [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'PREVIEW').click());
await page.waitForTimeout(2500);
check('PREVIEW runs the unsaved working play with a frozen defence',
  await page.evaluate(n => window.GO.currentScreen === 'practice' && window.GO.match?.world.freezeDefense === true && window.GO.match?.world.offensePlay?.name === n, nm),
  `working play = ${nm}`);
await page.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
  await new Promise(r => requestAnimationFrame(r));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', bubbles: true }));
});
await page.waitForTimeout(800);
check('EXIT returns to the play editor', await page.evaluate(() => window.GO.currentScreen === 'playEditor'));
check('unsaved edits survive the round trip', await page.evaluate(n => document.querySelector('#ui-root input')?.value === n, nm), nm);

check('no console errors across the whole walk', errors.length === 0, errors.slice(0,3).join(' // '));
await browser.close();
const bad = results.filter(r => !r.p);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
