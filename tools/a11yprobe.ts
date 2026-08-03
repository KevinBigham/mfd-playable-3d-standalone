#!/usr/bin/env tsx
/**
 * Accessibility matrix probe — the automatable slice. `npm run a11y`
 *
 * Runs the game the way an accessibility-dependent player would have it configured, all at
 * once: 150% text, maximum control scale, minimum control opacity, left-handed mirror, reduced
 * motion, every volume at zero, haptics off. Then proves the game is still PLAYABLE — controls
 * on screen, snap by touch, carrier steering — rather than merely bootable.
 *
 * What this cannot prove (and does not claim): real screen-reader behavior, real haptic
 * hardware, a human's ability to read the field at 150% zoom. Those stay on the physical
 * matrix in TEST_AND_ACCEPTANCE_GATES.md.
 */
import { startServer, stopServer, ensureBuild } from './browser.ts';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => { try { (window as any).GO.renderer.render(); } catch { /* menu */ } });
  await page.waitForTimeout(120);
  try { await page.screenshot({ path: `${OUT}/${name}.png`, type: 'png', timeout: 20000 }); }
  catch { /* documentation only */ }
}

const HARNESS = `
window.__AP = {
  step(n) {
    const g = window.GO;
    for (let i = 0; i < n; i++) {
      g.touch.prepareContext(g.match, true);
      g.input.poll();
      if (g.match) {
        g.match.tick();
        g.renderer.sync(g.match.world, g.match.state, 1, 1 / 60, false);
      }
      g.touch.projectVisuals(g.match, g.renderer);
      g.input.clearEdges();
    }
  },
  ev(type, x, y, id) {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
  },
  rect(sel) {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  },
  visibleControlRects() {
    const out = [];
    document.querySelectorAll('.tc-root [class*="tc-"]').forEach((e) => {
      // Effective visibility, ancestors included — the idle stick is opacity:0 and its knob
      // must not count as "on screen at the wrong place" while the player cannot see it.
      if (typeof e.checkVisibility === 'function'
        && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      out.push({ cls: e.className, x: r.left, y: r.top, w: r.width, h: r.height });
    });
    return out;
  },
};
`;

/** Same boot the touch probe uses: a shotgun drop-back, stepped until the pad says SNAP. */
const TO_PRE_SNAP = `
(() => {
  const g = window.GO;
  g.settings.quality = 'LOW';
  g.reset('match', { config: { seed: 31337, quarterSeconds: 120, difficulty: 'PRO',
    seats: [{ side: 0, active: true }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }], mode: 'QUICKPLAY' },
    returnScreen: 'mainMenu' });
  for (let i = 0; i < 12000; i++) {
    const m = g.match;
    // A human kicker now gets a real kickoff prompt; answer it so the drill can proceed.
    if (m && m.kickoffAwaitingChoice) m.submitKickoff('DEEP');
    if (m && m.phase === 'PLAY_CALL' && m.state.possession === 0 && !m.pendingOffense) {
      const drops = m.offensePlays.filter((p) =>
        !p.players.some((q) => q.route.some((n) => n.action === 'CARRY'))
        && /SHOTGUN/.test(p.formation));
      drops.sort((a, b) => b.timing.primary - a.timing.primary);
      if (drops[0]) m.submitOffense(drops[0]);
    }
    window.__AP.step(1);
    if (m && m.phase === 'PRE_SNAP' && m.state.possession === 0 && g.touch.mode === 'SNAP') {
      return { ok: true };
    }
  }
  return { ok: false, phase: g.match ? g.match.phase : 'none' };
})()
`;

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — accessibility matrix probe (automatable slice)'
    + '\n────────────────────────────────────────────────────────────────');
  const url = await startServer(4179);
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => (window as unknown as { GO?: unknown }).GO !== undefined,
    undefined, { timeout: 150000 });
  await page.addScriptTag({ content: HARNESS });

  try {
    // ── apply the full accessibility stack at once ───────────────────
    const applied = await page.evaluate(`(() => {
      const g = window.GO;
      g.settings.reducedMotion = true;
      g.settings.largeHud = true;
      g.settings.volumes.master = 0; g.settings.volumes.sfx = 0; g.settings.volumes.crowd = 0;
      g.settings.volumes.music = 0; g.settings.volumes.ui = 0;
      g.settings.touchProfile.haptics = 'OFF';
      g.settings.touchProfile.handedness = 'LEFT';
      g.settings.touchProfile.stickScale = 1.3;
      g.settings.touchProfile.actionScale = 1.3;
      g.settings.touchProfile.opacity = 0.25;
      g.applySettings();
      document.documentElement.style.fontSize = '150%';
      return {
        hudScale: getComputedStyle(document.documentElement).getPropertyValue('--hud-scale').trim(),
        haptics: g.settings.touchProfile.haptics,
        master: g.settings.volumes.master,
      };
    })()`) as { hudScale: string; haptics: string; master: number };
    check('a11y stack applies (large HUD var, haptics off, muted)',
      applied.hudScale === '1.34' && applied.haptics === 'OFF' && applied.master === 0,
      `--hud-scale=${applied.hudScale} haptics=${applied.haptics} master=${applied.master}`);

    // ── menus at 150% text: everything reachable, nothing clipped ────
    await page.evaluate(`window.GO.reset('mobileHome')`);
    await page.waitForTimeout(200);
    const home = await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('.go-btn')];
      const vw = innerWidth, vh = innerHeight;
      const clipped = btns.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < -1 || r.right > vw + 1 || r.width < 2;
      }).map((b) => b.textContent);
      const overflowX = document.documentElement.scrollWidth > innerWidth + 1;
      const play = btns.find((b) => /PLAY DRIVE/.test(b.textContent || ''));
      const playVisible = !!play && play.getBoundingClientRect().height > 2;
      return { count: btns.length, clipped, overflowX, playVisible, vw, vh };
    })()`) as { count: number; clipped: string[]; overflowX: boolean; playVisible: boolean };
    check('mobile home at 150% text: no horizontal overflow', !home.overflowX,
      `${home.count} buttons`);
    check('mobile home at 150% text: no button clipped off-screen', home.clipped.length === 0,
      home.clipped.length ? `clipped: ${home.clipped.join(', ')}` : 'all within viewport');
    check('primary action still visible at 150% text', home.playVisible, 'PLAY DRIVE on screen');
    await shot(page, 'a11y-home-150');

    // ── into a live snap with the whole stack on ─────────────────────
    const pre = await page.evaluate(TO_PRE_SNAP) as { ok: boolean; phase?: string };
    check('match reaches PRE_SNAP with a11y stack on', pre.ok, pre.ok ? '' : `stuck at ${pre.phase}`);

    if (pre.ok) {
      // Controls at max scale + minimum opacity: on screen, in bounds, still hittable.
      const rects = await page.evaluate(`window.__AP.visibleControlRects()`) as
        Array<{ cls: string; x: number; y: number; w: number; h: number }>;
      const out = rects.filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > 845 || r.y + r.h > 391);
      check('all visible controls within viewport at 130% control scale', out.length === 0,
        out.length ? out.map((r) => r.cls).join(', ') : `${rects.length} visible controls checked`);

      // Left-handed mirror: SNAP lives on the LEFT half.
      const snapL = await page.evaluate(`window.__AP.rect('.tc-snap')`) as { cx: number } | null;
      check('left-handed mirror puts SNAP on the left half', !!snapL && snapL.cx < 422,
        snapL ? `snap center x=${Math.round(snapL.cx)}` : 'snap button missing');
      await shot(page, 'a11y-presnap-left');

      // Flip to right-handed WHILE the snap button is on screen, prove the mirror is symmetric,
      // then flip back so the rest of the run stays on the left-handed profile.
      const snapR = await page.evaluate(`(() => {
        const g = window.GO;
        g.settings.touchProfile.handedness = 'RIGHT';
        g.applySettings();
        window.__AP.step(2);
        const r = window.__AP.rect('.tc-snap');
        g.settings.touchProfile.handedness = 'LEFT';
        g.applySettings();
        window.__AP.step(2);
        return r;
      })()`) as { cx: number } | null;
      check('right-handed flip mirrors SNAP to the right half', !!snapR && snapR.cx > 422,
        snapR ? `snap center x=${Math.round(snapR.cx)}` : 'snap button missing after flip');

      // Snap by touch with zero audio and no haptics: tap, wait out the tap-through lock first.
      const hiked = await page.evaluate(`(async () => {
        const g = window.GO;
        window.__AP.step(20); // > 150ms tap-through lock at 60Hz
        const r = window.__AP.rect('.tc-snap');
        if (!r) return { ok: false, why: 'no snap button' };
        window.__AP.ev('pointerdown', r.cx, r.cy, 31);
        window.__AP.step(2);
        window.__AP.ev('pointerup', r.cx, r.cy, 31);
        for (let i = 0; i < 240; i++) {
          window.__AP.step(1);
          if (g.match && g.match.phase === 'LIVE') return { ok: true, i };
        }
        return { ok: false, why: 'never went LIVE', phase: g.match ? g.match.phase : 'none' };
      })()`) as { ok: boolean; why?: string };
      check('snap works by touch, fully muted, haptics off', hiked.ok, hiked.why ?? '');

      // Steering still works: hold the (mirrored) stick side and see movement intent.
      if (hiked.ok) {
        const steer = await page.evaluate(`(() => {
          const g = window.GO;
          // Left-handed: movement zone mirrors to the RIGHT side of the screen.
          window.__AP.ev('pointerdown', 700, 300, 32);
          window.__AP.ev('pointermove', 740, 260, 32);
          let sum = 0;
          for (let i = 0; i < 30; i++) {
            window.__AP.step(1);
            const it = g.input.intentFor(0);
            if (it) sum += Math.hypot(it.moveX, it.moveZ);
          }
          window.__AP.ev('pointerup', 740, 260, 32);
          window.__AP.step(2);
          return { sum: Math.round(sum * 100) / 100 };
        })()`) as { sum: number };
        check('stick steers on the mirrored side during LIVE', steer.sum > 1,
          `integrated intent magnitude ${steer.sum}`);
        await shot(page, 'a11y-live-steer');
      }

    }

    check('no console or page errors across the whole run', errors.length === 0,
      errors.length ? errors[0].slice(0, 120) : '');
  } finally {
    await browser.close();
    await stopServer();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`  ${checks.length - failed.length}/${checks.length} accessibility checks passed`);
  if (failed.length) { console.log('  FAILED: ' + failed.map((f) => f.name).join(' | ')); process.exit(1); }
}

main().catch((e) => { console.error(e); void stopServer(); process.exit(1); });
