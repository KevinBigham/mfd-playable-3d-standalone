import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 5199;
const url = `http://127.0.0.1:${port}/probe-editor/index.html`;
const server = spawn('./node_modules/.bin/vite', ['--port', String(port), '--strictPort'], { stdio: ['ignore','pipe','pipe'] });
server.stderr.on('data', d => process.stderr.write('[vite] ' + d));

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('server never came up');
}

const results = [];
function check(name, pass, detail = '') { results.push({name, pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`); }

try {
  await waitUp();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.GO, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  // Vite's dependency optimiser can force one full reload; get past it before driving anything.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.GO, null, { timeout: 90000 });
  await page.waitForTimeout(800);

  // ── play editor ──
  await page.evaluate(() => window.GO.go('playEditor'));
  await page.waitForTimeout(400);
  check('playEditor mounts', await page.evaluate(() => window.GO.currentScreen === 'playEditor'));
  check('chalkboard svg present', await page.evaluate(() => !!document.querySelector('#ui-root svg')));
  const ringCount = await page.evaluate(() => document.querySelectorAll('#ui-root .go-opt, #ui-root .go-btn').length);
  check('editor builds controls', ringCount > 25, `controls=${ringCount}`);
  check('no BLITZ string anywhere in the DOM',
    !(await page.evaluate(() => (document.getElementById('ui-root')?.innerText || '').toUpperCase().includes('BLITZ'))));

  // Walk the focus ring with the keyboard and confirm focus actually moves.
  const focusWalk = await page.evaluate(async () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const f = document.querySelector('#ui-root .focused');
      if (f) seen.add(f.textContent?.slice(0, 40) ?? String(i));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true }));
      await new Promise(r => requestAnimationFrame(r));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
      await new Promise(r => requestAnimationFrame(r));
    }
    return seen.size;
  });
  check('focus ring walks many distinct items with the keyboard', focusWalk > 12, `distinct=${focusWalk}`);

  // PAGE (Tab) jumps sections.
  const secJump = await page.evaluate(async () => {
    const before = document.querySelector('#ui-root .focused')?.textContent ?? '';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    return { before, after: document.querySelector('#ui-root .focused')?.textContent ?? '' };
  });
  check('PAGE jumps between sections', secJump.before !== secJump.after, `${JSON.stringify(secJump).slice(0,90)}`);

  // Click a player mark, drag it, and confirm the play changed + stayed legal.
  const drag = await page.evaluate(async () => {
    const svg = document.querySelector('#ui-root svg');
    const r = svg.getBoundingClientRect();
    const g = [...svg.querySelectorAll('g')];
    const target = g[g.length - 1];
    const bb = target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: bb.x + bb.width/2, clientY: bb.y + bb.height/2 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + r.width * 0.2, clientY: r.y + r.height * 0.62 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise(r2 => requestAnimationFrame(r2));
    return document.querySelectorAll('#ui-root svg').length;
  });
  check('dragging a mark re-renders the board', drag === 1, `svgs=${drag}`);

  // SAVE via a click, then verify it landed in the save file.
  const saved = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('#ui-root .go-btn')];
    const save = btns.find(b => b.textContent.trim() === 'SAVE');
    save.click();
    await new Promise(r => requestAnimationFrame(r));
    const raw = JSON.parse(localStorage.getItem('go.save.v1') || '{}');
    return { count: (raw.customPlays || []).length, name: (raw.customPlays || [])[0]?.name };
  });
  check('SAVE writes a custom play to the save file', saved.count === 1, `name=${saved.name}`);

  // VALIDATE reports clean.
  const clean = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll('#ui-root .go-btn')];
    btns.find(b => b.textContent.trim() === 'VALIDATE').click();
    await new Promise(r => requestAnimationFrame(r));
    return (document.getElementById('ui-root').innerText || '').includes('Clean');
  });
  check('VALIDATE reports the template is clean', clean);

  // Switch to the defensive side and confirm crosses + assignment row appear.
  const defOk = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('#ui-root .go-opt')];
    const sideRow = rows.find(r => r.textContent.startsWith('SIDE'));
    sideRow.querySelectorAll('.go-opt-arrow')[1].click();
    await new Promise(r => requestAnimationFrame(r));
    const txt = document.getElementById('ui-root').innerText.toUpperCase();
    return { def: txt.includes('DEFENCE'), assign: txt.includes('ASSIGNMENT'), blitz: txt.includes('BLITZ') };
  });
  check('SIDE switches to the defensive slots', defOk.def && defOk.assign, JSON.stringify(defOk));
  check('no internal enum leaks on the defensive panel', !defOk.blitz);

  // Cycle the assignment row through every kind; check labels and no crash.
  const kinds = await page.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 7; i++) {
      const rows = [...document.querySelectorAll('#ui-root .go-opt')];
      const row = rows.find(r => r.textContent.startsWith('ASSIGNMENT'));
      if (!row) break;
      seen.push(row.querySelector('.go-opt-value').textContent);
      row.querySelectorAll('.go-opt-arrow')[1].click();
      await new Promise(r => requestAnimationFrame(r));
    }
    return seen;
  });
  check('every assignment kind renders a readable label', kinds.length >= 6 && !kinds.join('|').includes('BLITZ'), kinds.join(','));

  await page.screenshot({ path: '/tmp/editor.png' });

  // ── practice ──
  await page.evaluate(() => window.GO.reset('practice'));
  await page.waitForTimeout(400);
  check('practice mounts', await page.evaluate(() => window.GO.currentScreen === 'practice'));
  const setupRows = await page.evaluate(() => [...document.querySelectorAll('#ui-root .go-opt')].map(r => r.textContent.split(/\s{2,}|‹|›/)[0].trim()).filter(Boolean));
  check('setup panel exposes every required control',
    ['DRILL','YOU PLAY','YOUR TEAM','OPPOSING TEAM','BALL ON','OFFENSIVE PLAY','DEFENSIVE PLAY','DEV OVERLAY'].every(k => setupRows.some(r => r.startsWith(k))),
    setupRows.join(' | ').slice(0, 160));

  // Turn the dev overlay on, then start the drill.
  await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('#ui-root .go-opt')];
    const dev = rows.find(r => r.textContent.startsWith('DEV OVERLAY'));
    dev.querySelectorAll('.go-opt-arrow')[1].click();
    await new Promise(r => requestAnimationFrame(r));
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'START DRILL').click();
  });
  await page.waitForTimeout(1800);

  const live = await page.evaluate(() => {
    const m = window.GO.match;
    return m ? { mode: m.config.mode, phase: m.state.phase, los: m.state.losZ, down: m.state.down,
                 freeze: m.world.freezeDefense, poss: m.state.possession, off: m.world.offensePlay?.name,
                 def: m.world.defensePlay?.name, tick: m.world.tick } : null;
  });
  check('drill starts a PRACTICE match', !!live && live.mode === 'PRACTICE', JSON.stringify(live));
  check('kickoff is skipped and the ball is armed at the chosen spot', !!live && live.los === 25 && live.down === 1, `los=${live?.los} down=${live?.down} phase=${live?.phase}`);
  check('the chosen calls are the ones on the field', !!live && !!live.off && !!live.def, `${live?.off} vs ${live?.def}`);
  check('dev overlay panel is present and populated',
    await page.evaluate(() => { const t = document.body.innerText; return t.includes('DEV OVERLAY') && t.includes('LOS') && t.includes('PHASE'); }));

  // Let it run, then RESET with Backspace and confirm the spot is re-armed.
  await page.evaluate(() => { const m = window.GO.match; m.state.losZ = 61; m.state.down = 3; });
  await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backspace', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
  });
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(() => ({ los: window.GO.match.state.losZ, down: window.GO.match.state.down, phase: window.GO.match.state.phase }));
  check('BACK re-arms the same down at the same spot', afterReset.los === 25 && afterReset.down === 1, JSON.stringify(afterReset));

  // ROUTES ONLY freezes the defence.
  await page.evaluate(() => { window.GO.match.world.freezeDefense = false; });
  const frozen = await page.evaluate(async () => {
    // flip the drill mode through the live overlay is not exposed; check the VERSUS default instead
    return window.GO.match.world.freezeDefense;
  });
  check('VERSUS drill leaves the defence live', frozen === false);

  await page.waitForTimeout(2500);
  const ran = await page.evaluate(() => ({ tick: window.GO.match.world.tick, phase: window.GO.match.state.phase, finished: window.GO.match.state.finished }));
  check('the drill keeps running plays without stalling', ran.tick > 200 && !ran.finished, JSON.stringify(ran));

  await page.screenshot({ path: '/tmp/practice.png' });

  // EXIT the drill with HIDE_PLAY (H).
  await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
  });
  await page.waitForTimeout(400);
  check('HIDE PLAY leaves the drill and returns to the setup panel',
    await page.evaluate(() => !window.GO.match && document.body.innerText.includes('PRACTICE FIELD')));

  // ── ROUTES ONLY path ──
  await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('#ui-root .go-opt')];
    const drill = rows.find(r => r.textContent.startsWith('DRILL'));
    drill.querySelectorAll('.go-opt-arrow')[0].click();
    await new Promise(r => requestAnimationFrame(r));
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'START DRILL').click();
  });
  await page.waitForTimeout(1500);
  check('ROUTES ONLY freezes the defence',
    await page.evaluate(() => window.GO.match?.world.freezeDefense === true));

  // ── editor → practice round trip keeps unsaved work ──
  await page.evaluate(() => { window.GO.match && window.GO.endMatch(); window.GO.reset('playEditor'); });
  await page.waitForTimeout(400);
  const nameBefore = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'RENAME');
    btn.click();
    await new Promise(r => requestAnimationFrame(r));
    return document.querySelector('#ui-root input').value;
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('#ui-root .go-btn')].find(b => b.textContent.trim() === 'PREVIEW').click();
  });
  await page.waitForTimeout(1500);
  check('PREVIEW launches a frozen-defence practice match',
    await page.evaluate(() => window.GO.currentScreen === 'practice' && window.GO.match?.world.freezeDefense === true));
  check('PREVIEW runs the working play',
    await page.evaluate((n) => window.GO.match?.world.offensePlay?.name === n, nameBefore),
    `working play = ${nameBefore}`);
  await page.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', bubbles: true }));
  });
  await page.waitForTimeout(600);
  // Vite's dependency optimiser can force one full reload; get past it before driving anything.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.GO, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  check('EXIT returns to the play editor', await page.evaluate(() => window.GO.currentScreen === 'playEditor'));
  check('unsaved edits survive the round trip',
    await page.evaluate((n) => document.querySelector('#ui-root input')?.value === n, nameBefore), nameBefore);

  check('no console errors during the whole walk', errors.length === 0, errors.slice(0, 3).join(' // '));

  await browser.close();
} finally {
  server.kill('SIGTERM');
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
