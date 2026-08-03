#!/usr/bin/env tsx
/**
 * The phone loop, end to end: Home → PLAY DRIVE → three cards → snap → result → ONE MORE DRIVE.
 * Everything by touch. `npm run driverush`
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

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — Drive Rush phone-loop probe'
    + '\n──────────────────────────────────────────────────────────────────────');
  const url = await startServer(4177);
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
      '--disable-dev-shm-usage', '--enable-webgl', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as { GO?: unknown }).GO !== undefined,
    undefined, { timeout: 150000 });

  try {
    let screen = '';
    for (let i = 0; i < 3; i++) {
      await page.touchscreen.tap(422, 300);
      await page.waitForTimeout(400);
      screen = await page.evaluate('window.GO.currentScreen') as string;
      if (screen === 'mobileHome') break;
    }
    check('a phone lands on the mobile home', screen === 'mobileHome', `screen=${screen}`);

    const played = await page.evaluate(`(new Promise((resolve) => {
      const g = window.GO;
      const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const btn = [...document.querySelectorAll('.go-btn')].find((b) => /PLAY DRIVE/.test(b.textContent || ''));
      if (!btn) { resolve({ ok: false, why: 'no PLAY DRIVE button' }); return; }
      click(btn);
      const out = { ok: true, cardsSeen: false, cardCount: 0, ruleset: '', snapped: false,
        resultScreen: '', retried: false, why: '' };
      let stage = 0;
      const timer = setInterval(() => {
        const m = g.match;
        if (stage === 0 && m) { out.ruleset = m.ruleset.id; stage = 1; }
        if (stage === 1 && m && m.phase === 'PLAY_CALL') {
          const cards = [...document.querySelectorAll('.ps-card')];
          if (cards.length) {
            out.cardsSeen = true; out.cardCount = cards.length;
            click(cards[1]);
            stage = 2;
          }
        }
        if (stage === 2 && m && g.touch.mode === 'SNAP') {
          const b = document.querySelector('.tc-snap');
          if (b) {
            const r = b.getBoundingClientRect();
            for (const [type, buttons] of [['pointerdown', 1], ['pointerup', 0]]) {
              b.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2, bubbles: true, pointerType: 'touch', isPrimary: true, buttons }));
            }
          }
        }
        if (m && m.world.playPhase === 'LIVE') out.snapped = true;
        if (stage >= 1 && m && m.phase === 'PLAY_CALL' && !out.cardsSeen) stage = 1;
        if (g.currentScreen === 'driveResults') {
          out.resultScreen = 'driveResults';
          const again = [...document.querySelectorAll('.go-btn')].find((b) => /ONE MORE DRIVE/.test(b.textContent || ''));
          if (again && !out.retried) {
            click(again);
            out.retried = true;
            setTimeout(() => { clearInterval(timer);
              resolve({ ...out, backInMatch: !!g.match && g.currentScreen === 'match' }); }, 2500);
          }
        }
      }, 120);
      setTimeout(() => { clearInterval(timer); resolve({ ...out, why: 'timeout at stage ' + stage + ' screen ' + g.currentScreen }); }, 170000);
    }))`) as Record<string, unknown>;
    check('PLAY DRIVE starts a DRIVE_RUSH match', played.ruleset === 'DRIVE_RUSH', `ruleset=${played.ruleset} ${played.why ?? ''}`);
    check('three context cards front the play call', played.cardsSeen === true && played.cardCount === 3, `cards=${played.cardCount}`);
    check('a card commits and the drive snaps', played.snapped === true, '');
    check('the drive ends on the results card', played.resultScreen === 'driveResults', `${played.why ?? ''}`);
    check('ONE MORE DRIVE restarts instantly', played.retried === true && played.backInMatch === true,
      `retried=${played.retried} backInMatch=${played.backInMatch}`);
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    await browser.close();
    await stopServer();
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`${checks.length - failed}/${checks.length} Drive Rush loop checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
