#!/usr/bin/env tsx
/**
 * Touch-only Classic completeness — the Wave 1 exit gate. `npm run classic`
 *
 * One rule: every football decision is made through a dispatched pointer/click on a visible DOM
 * element. No injected action bits, no direct submit calls from the driver, no keyboard. The
 * driver reads on-screen geometry (and the pad's public screen-to-world basis, the same mapping a
 * sighted player's eyes perform) to decide where to tap and steer.
 *
 * Three passes:
 *   A. kickoff prompt, onside arm  — seed where the human kicks the opener; tap ONSIDE.
 *   B. kickoff prompt, deep arm    — same seed; tap KICK DEEP.
 *   C. a full Classic match        — pages, mirror, hide, punt, field goal, go-for-it,
 *                                    conversions, snaps, throws, steering, to the final whistle.
 */
import { startServer, stopServer, ensureBuild } from './browser.ts';
import type { Page } from 'playwright';
import { chromium } from 'playwright';

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
}

/** Shared page-side driver utilities. */
const HARNESS = `
window.__CP = {
  click(el) { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); },
  tap(x, y, id, target) {
    const el = target || document.elementFromPoint(x, y) || document.body;
    for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) {
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, buttons }));
    }
  },
  down(x, y, id) {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y,
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, buttons: 1 }));
  },
  moveTo(x, y, id) {
    (document.querySelector('.tc-root') || document.body).dispatchEvent(
      new PointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, buttons: 1 }));
  },
  up(x, y, id) {
    (document.querySelector('.tc-root') || document.body).dispatchEvent(
      new PointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, buttons: 0 }));
  },
  step(n) {
    const g = window.GO;
    for (let i = 0; i < n; i++) {
      g.touch.prepareContext(g.match, g.inMatch && !g.paused);
      g.input.poll();
      if (g.match && g.inMatch && !g.paused) {
        g.match.tick();
        g.renderer.sync(g.match.world, g.match.state, 1, 1 / 60, false);
      }
      g.touch.projectVisuals(g.match, g.renderer);
      if (g.current && g.current.update) g.current.update(1 / 60);
      g.input.clearEdges();
    }
  },
  spin(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* wait */ } },
  startMatch(seed, quarterSeconds) {
    const g = window.GO;
    g.settings.quality = 'LOW';
    g.reset('match', { config: { seed, quarterSeconds, difficulty: 'PRO',
      seats: [{ side: 0, active: true }, { side: 1, active: false },
              { side: 0, active: false }, { side: 1, active: false }], mode: 'QUICKPLAY' },
      returnScreen: 'mainMenu' });
  },
};
`;

/** Run to the human's kickoff prompt, tap one of its buttons, and report what launched. */
const KICKOFF_ARM = (label: string) => `
(() => {
  const CP = window.__CP;
  const g = window.GO;
  CP.startMatch(24600, 60);
  let clicked = false; let launched = '';
  g.match.bus.on('kickoff', () => { /* setup-time event; the launch rewrites world.special */ });
  for (let t = 0; t < 6000; t++) {
    const m = g.match;
    if (!m) break;
    if (m.kickoffAwaitingChoice && !clicked) {
      const btns = [...document.querySelectorAll('.go-btn')];
      const target = btns.find((b) => new RegExp(${JSON.stringify(label)}).test(b.textContent || ''));
      if (target) { CP.click(target); clicked = true; }
    }
    CP.step(1);
    if (clicked && (m.world.special === 'ONSIDE' || (m.world.special === 'KICKOFF' && m.state.phase === 'KICKOFF_LIVE' && m.state.phaseTicks > 40))) {
      launched = m.world.special;
      break;
    }
  }
  return { clicked, launched };
})()
`;

const DRIVER = `
(() => {
  const CP = window.__CP;
  const g = window.GO;
  CP.startMatch(24600, 120);

  const done = {
    pageCycled: 0, mirrored: 0, hidToggled: 0, playsCalled: 0, defenseCalls: 0,
    puntClicked: 0, fgClicked: 0, wentForIt: 0,
    convPromptSeen: 0, convClicked: 0, convKickClicked: 0, convTwoClicked: 0, convBothButtons: false,
    kickPromptClicks: 0,
    snaps: 0, throws: 0, humanTds: 0,
  };
  const m0 = g.match;
  m0.bus.on('snap', () => { done.snaps++; });
  m0.bus.on('throw', () => { done.throws++; });
  m0.bus.on('touchdown', (e) => { if (e.side === 0) done.humanTds++; });

  const STICK_ID = 95;
  let stickDown = false;
  const steer = () => {
    // Push the stick toward the opponent goal line. The screen direction for world +z comes from
    // the pad's own published basis — the same mapping a player's eyes perform on the field.
    const t = g.touch;
    const dir = 1;                       // seat 0 is the home side, attacking +z
    let sx = t.bz.x * dir, sy = t.bz.y * dir;
    const mLen = Math.hypot(sx, sy) || 1;
    sx /= mLen; sy /= mLen;
    if (!stickDown) { CP.down(200, 220, STICK_ID); stickDown = true; }
    CP.moveTo(200 + sx * 85, 220 + sy * 85, STICK_ID);   // past the ring: turbo
  };
  const unsteer = () => {
    if (stickDown) { CP.up(200, 220, STICK_ID); stickDown = false; }
  };

  let lastCallTick = -1;
  for (let t = 0; t < 300000; t++) {
    const m = g.match;
    if (!m || m.state.finished) break;
    const phase = m.phase;

    const wrap = document.querySelector('.ps-wrap');
    if (phase === 'PLAY_CALL' && wrap && wrap.style.display !== 'none') {
      unsteer();
      const panels = [...document.querySelectorAll('.ps-side')];
      for (const panel of panels) {
        if (panel.style.opacity === '0.55') continue;
        const isOffense = /OFFENSE/.test(panel.querySelector('.ps-head')?.textContent || '');
        const mine = m.state.possession === 0 ? isOffense : !isOffense;
        if (!mine) continue;
        const tool = (re) => [...panel.querySelectorAll('.ps-tool')].find((b) => re.test(b.textContent || ''));
        if (isOffense) {
          if (m.world.tick !== lastCallTick) {
            lastCallTick = m.world.tick;
            if (done.pageCycled < 2) { CP.click(tool(/PAGE/)); done.pageCycled++; }
            if (done.mirrored < 1) { CP.click(tool(/FLIP/)); done.mirrored++; }
            if (done.hidToggled < 1) { CP.click(tool(/HIDE/)); done.hidToggled++; CP.click(tool(/HIDE/)); }
          }
          if (m.state.down === 4) {
            const special = panel.querySelector('.ps-special');
            const sbtns = special ? [...special.querySelectorAll('.ps-tool')] : [];
            if (done.puntClicked < 1 && sbtns.length) {
              CP.click(sbtns.find((b) => /PUNT/.test(b.textContent || ''))); done.puntClicked++; continue;
            }
            if (done.fgClicked < 1 && sbtns.length) {
              CP.click(sbtns.find((b) => /FIELD GOAL/.test(b.textContent || ''))); done.fgClicked++; continue;
            }
            done.wentForIt++;
          }
          const cells = [...panel.querySelectorAll('.ps-cell')].filter((c) => !/—/.test(c.textContent || ''));
          if (cells.length) { CP.click(cells[done.playsCalled % cells.length]); done.playsCalled++; }
        } else {
          const cells = [...panel.querySelectorAll('.ps-cell')].filter((c) => !/—/.test(c.textContent || ''));
          if (cells.length) { CP.click(cells[done.defenseCalls % cells.length]); done.defenseCalls++; }
        }
      }
    }

    if (m.kickoffAwaitingChoice) {
      const deep = [...document.querySelectorAll('.go-btn')].find((b) => /KICK DEEP/.test(b.textContent || ''));
      if (deep) { CP.click(deep); done.kickPromptClicks++; }
    }

    if (phase === 'CONVERSION_CALL') {
      unsteer();
      const btns = [...document.querySelectorAll('.go-btn')];
      const kick = btns.find((b) => /KICK · 1 PT/.test(b.textContent || ''));
      const two = btns.find((b) => /GO FOR TWO/.test(b.textContent || ''));
      if (kick || two) {
        done.convPromptSeen++;
        if (kick && two) done.convBothButtons = true;
        if (done.convTwoClicked < 1 && two) { CP.click(two); done.convTwoClicked++; done.convClicked++; }
        else if (kick) { CP.click(kick); done.convKickClicked++; done.convClicked++; }
      }
    }

    const mode = g.touch.mode;
    if (mode === 'SNAP') {
      unsteer();
      const btn = document.querySelector('.tc-snap');
      if (btn && btn.style.display !== 'none') {
        CP.spin(170);
        const r = btn.getBoundingClientRect();
        CP.tap(r.left + r.width / 2, r.top + r.height / 2, 90, btn);
      }
    } else if (mode === 'QB' && m.world.playTicks > 45) {
      const badges = [...document.querySelectorAll('.tc-badge')].filter((b) => b.classList.contains('on'));
      if (badges.length) {
        const b = badges[done.throws % badges.length];
        const r = b.getBoundingClientRect();
        CP.tap(r.left + r.width / 2, r.top + r.height / 2, 91, b);
      }
    } else if (mode === 'CARRY' || mode === 'FREE') {
      steer();
    } else if (mode === 'OFF') {
      stickDown = false;   // resets clear the pointer for us
    }

    CP.step(1);
  }

  const m = g.match;
  return {
    finished: m ? m.state.finished : true,
    phase: m ? m.phase : 'ended',
    score: m ? [m.state.teams[0].score, m.state.teams[1].score] : null,
    done,
  };
})()
`;

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — touch-only Classic completeness probe'
    + '\n──────────────────────────────────────────────────────────────────────');
  const url = await startServer(4176);
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
      '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
      '--enable-webgl', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as { GO?: unknown }).GO !== undefined,
    undefined, { timeout: 150000 });
  await page.addScriptTag({ content: HARNESS });

  try {
    let screen = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.touchscreen.tap(422, 300);
      await page.waitForTimeout(400);
      screen = await page.evaluate('window.GO.currentScreen') as string;
      if (screen === 'mainMenu') break;
    }
    check('title falls to a touch', screen === 'mainMenu', `screen=${screen}`);

    // A/B: the kickoff prompt, both arms, deterministically (seed 24600: human kicks the opener).
    const onside = await page.evaluate(KICKOFF_ARM('ONSIDE')) as { clicked: boolean; launched: string };
    check('kickoff prompt: tapping ONSIDE launches an onside kick',
      onside.clicked && onside.launched === 'ONSIDE', JSON.stringify(onside));
    const deep = await page.evaluate(KICKOFF_ARM('KICK DEEP')) as { clicked: boolean; launched: string };
    check('kickoff prompt: tapping KICK DEEP launches a deep kick',
      deep.clicked && deep.launched === 'KICKOFF', JSON.stringify(deep));

    // C: the full match.
    const r = await page.evaluate(DRIVER) as {
      finished: boolean; phase: string; score: number[] | null; done: Record<string, number | boolean>;
    };
    const d = r.done as Record<string, number> & { convBothButtons: boolean };
    check('a full Classic match finishes touch-only', r.finished,
      `phase=${r.phase} score=${r.score?.join('-')}`);
    check('offensive plays called by tapping cells', d.playsCalled >= 8, `${d.playsCalled} calls`);
    check('defensive plays called by tapping cells', d.defenseCalls >= 4, `${d.defenseCalls} calls`);
    check('playbook pages cycled by button', d.pageCycled >= 1, `${d.pageCycled}`);
    check('formation mirrored by button', d.mirrored >= 1, `${d.mirrored}`);
    check('hidden-pick toggled by button', d.hidToggled >= 1, `${d.hidToggled}`);
    check('snap by tapping SNAP', d.snaps >= 8, `${d.snaps} snaps`);
    check('throws by tapping badges', d.throws >= 3, `${d.throws} throws`);
    check('carrier steered with the stick, human offense moved',
      d.humanTds >= 1 || d.convPromptSeen >= 1 || (r.score?.[0] ?? 0) > 0,
      `human TDs=${d.humanTds} score=${r.score?.[0]}`);
    check('punt chosen from the special bar', d.puntClicked >= 1, `${d.puntClicked}`);
    check('field goal chosen from the special bar', d.fgClicked >= 1, `${d.fgClicked}`);
    check('went for it on fourth by picking a normal play', d.wentForIt >= 1, `${d.wentForIt}`);
    check('later kickoffs answered through the prompt', d.kickPromptClicks >= 1,
      `${d.kickPromptClicks} (requires a human score first)`);
    check('conversion prompt offered both choices and a tap committed one',
      d.convPromptSeen >= 1 && d.convBothButtons && d.convClicked >= 1,
      `seen=${d.convPromptSeen} both=${d.convBothButtons} clicked kick=${d.convKickClicked} two=${d.convTwoClicked}`);
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    await stopServer();
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`${checks.length - failed}/${checks.length} Classic touch checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
