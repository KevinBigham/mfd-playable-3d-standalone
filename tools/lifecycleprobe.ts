#!/usr/bin/env tsx
/**
 * Pause, interruption, and lifecycle gate — the browser-level proof for Wave 1. `npm run lifecycle`
 *
 * Chromium with touch emulation, real rAF loop running. What this asserts:
 *
 *  1. Opening Settings from Pause leaves the hidden match FROZEN (the shipped bug let it run).
 *  2. Every interruption — blur, visibilitychange, pointer cancel, portrait rotation — leaves
 *     zero touch-derived state: no movement, no turbo, no latch, no aim, no press visuals, no
 *     captures, and the next poll manufactures no edges.
 *  3. SNAP is owned by a tracked pointer: slide-off cancels, no stuck press class, tap commits.
 *  4. 100 interruption cycles leave the input layer byte-clean every time.
 *  5. pagehide flushes a dead-ball checkpoint; returning presents the pause card, not live play.
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

const HARNESS = `
window.__LP = {
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
  ev(type, x, y, id, target) {
    const el = target || document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
  },
  /** Snapshot of every touch-derived fact the reset contract names. */
  touchState() {
    const t = window.GO.touch;
    const stick = document.querySelector('.tc-stick');
    const snap = document.querySelector('.tc-snap');
    const lob = document.querySelector('.tc-lob');
    let badgePress = false;
    document.querySelectorAll('.tc-badge').forEach((b) => { if (b.classList.contains('press')) badgePress = true; });
    return {
      touches: t.touches.size,
      moveX: t.moveX, moveZ: t.moveZ,
      latch: t.latch,
      aimX: t.aimX, aimZ: t.aimZ,
      forceMove: t.forceMove,
      lobArmed: t.lobArmed,
      stickOn: stick ? stick.classList.contains('on') : false,
      turbo: stick ? stick.classList.contains('turbo') : false,
      snapPress: snap ? snap.classList.contains('press') : false,
      lobClass: lob ? lob.classList.contains('armed') : false,
      badgePress,
    };
  },
  clean(s) {
    return s.touches === 0 && s.moveX === 0 && s.moveZ === 0 && s.latch === 0
      && s.aimX === null && s.aimZ === null && s.forceMove === null && !s.lobArmed
      && !s.stickOn && !s.turbo && !s.snapPress && !s.lobClass && !s.badgePress;
  },
  /** An interruption may have left a LIFECYCLE/USER pause; come back the way a player would. */
  recoverToLive() {
    const g = window.GO;
    for (let guard = 0; guard < 5 && g.paused; guard++) {
      window.dispatchEvent(new Event('focus'));
      this.step(2);
      const btns = [...document.querySelectorAll('.go-btn, button, [class*=btn]')];
      const r = btns.find((b) => /RESUME/.test(b.textContent || ''));
      if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      this.step(2);
    }
    return !g.paused;
  },
  /** Step until the pad is live in some mode (pre-snap, QB, carry, or free). */
  padOn(max) {
    const g = window.GO;
    for (let i = 0; i < (max || 6000); i++) {
      if (g.touch.mode !== 'OFF') return true;
      const m = g.match;
      if (m && m.phase === 'PLAY_CALL' && m.state.possession === 0 && !m.pendingOffense) {
        m.submitOffense(m.offensePlays[0]);
      }
      this.step(1);
    }
    return g.touch.mode !== 'OFF';
  },
};
`;

const TO_PRE_SNAP = `
(() => {
  const g = window.GO;
  g.settings.quality = 'LOW';
  g.reset('match', { config: { seed: 31337, quarterSeconds: 120, difficulty: 'PRO',
    seats: [{ side: 0, active: true }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }], mode: 'QUICKPLAY' },
    returnScreen: 'mainMenu' });
  for (let i = 0; i < 40000; i++) {
    const m = g.match;
    if (m && m.phase === 'PLAY_CALL' && m.state.possession === 0 && !m.pendingOffense) {
      const drops = m.offensePlays.filter((p) =>
        !p.players.some((q) => q.route.some((n) => n.action === 'CARRY')));
      if (drops[0]) m.submitOffense(drops[0]);
    }
    window.__LP.step(1);
    if (m && m.phase === 'PRE_SNAP' && m.state.possession === 0 && g.touch.mode === 'SNAP') {
      return { ok: true, i };
    }
  }
  return { ok: false, phase: g.match ? g.match.phase : 'none', paused: g.paused,
    reasons: g.pause.reasons.slice(), poss: g.match ? g.match.state.possession : -1,
    mode: g.touch.mode };
})()
`;

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — pause/lifecycle/interruption probe'
    + '\n──────────────────────────────────────────────────────────────────────');
  const url = await startServer(4175);
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
    // ── reach a live pre-snap with the pad up ─────────────────────────
    const at = await page.evaluate(TO_PRE_SNAP) as { ok: boolean };
    check('a touch match reaches pre-snap with the pad enabled', at.ok, JSON.stringify(at));

    // ── 1. pause freeze, including nested screens ─────────────────────
    const freeze = await page.evaluate(`(() => {
      const g = window.GO;
      g.go('pause', { returnScreen: 'match' });
      const t0 = g.match.world.tick;
      window.__LP.step(120);                       // manual frames — must not advance the match
      const afterPause = g.match.world.tick;
      g.go('settings');
      window.__LP.step(120);
      const afterSettings = g.match.world.tick;
      g.back();                                    // back to pause
      const stillPaused = g.paused;
      return { t0, afterPause, afterSettings, stillPaused, reasons: g.pause.reasons.slice() };
    })()`) as { t0: number; afterPause: number; afterSettings: number; stillPaused: boolean; reasons: string[] };
    check('pause freezes the match', freeze.afterPause === freeze.t0,
      `ticks ${freeze.t0} -> ${freeze.afterPause}`);
    check('settings opened from pause keeps the match frozen', freeze.afterSettings === freeze.t0,
      `ticks ${freeze.t0} -> ${freeze.afterSettings} (the shipped bug let this run)`);
    check('returning from settings is still paused', freeze.stillPaused,
      `reasons=${freeze.reasons.join(',')}`);

    // Real wall-clock proof: the live rAF loop must not advance a nested-paused match either.
    const w0 = await page.evaluate('window.GO.match.world.tick') as number;
    await page.waitForTimeout(900);
    const w1 = await page.evaluate('window.GO.match.world.tick') as number;
    check('ten real-time frames behind settings advance nothing', w1 === w0, `ticks ${w0} -> ${w1}`);

    // Resume via the actual RESUME button, like a thumb would.
    const resumed = await page.evaluate(`(() => {
      const g = window.GO;
      const btns = [...document.querySelectorAll('.go-btn, button, [class*=btn]')];
      const r = btns.find((b) => /RESUME/.test(b.textContent || ''));
      if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { found: !!r, paused: g.paused };
    })()`) as { found: boolean; paused: boolean };
    check('RESUME releases the user pause', resumed.found && !resumed.paused,
      `found=${resumed.found} paused=${resumed.paused}`);

    // ── 2. interruption matrix ────────────────────────────────────────
    const matrix = await page.evaluate(`(() => {
      const LP = window.__LP;
      const g = window.GO;
      const out = [];
      const press = () => {
        LP.ev('pointerdown', 200, 200, 40);        // stick zone
        LP.ev('pointermove', 260, 180, 40);        // deflect
        LP.step(2);
      };
      const interruptions = [
        ['blur', () => window.dispatchEvent(new Event('blur'))],
        ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
        ['pointercancel', () => {
          const root = document.querySelector('.tc-root');
          root.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 40, bubbles: true }));
        }],
        ['resetAll', () => g.touch.resetAll('probe')],
      ];
      for (const [name, fire] of interruptions) {
        const live = LP.recoverToLive();
        const pad = LP.padOn(8000);
        if (!live || !pad) { out.push({ name, moved: false, clean: false, after: 'never got live pad: live=' + live + ' pad=' + pad + ' mode=' + g.touch.mode }); continue; }
        press();
        const before = LP.touchState();
        fire();
        LP.step(2);
        const after = LP.touchState();
        out.push({ name, moved: before.moveX !== 0 || before.moveZ !== 0 || before.touches > 0,
          clean: LP.clean(after), after });
      }
      return out;
    })()`) as Array<{ name: string; moved: boolean; clean: boolean; after: unknown }>;
    for (const m of matrix) {
      check(`${m.name} leaves zero touch state`, m.moved && m.clean,
        m.clean ? '' : JSON.stringify(m.after));
    }

    // Portrait rotation: the gate must cover the screen AND reset input. Recover first so no
    // LIFECYCLE/USER pause from the matrix is still held.
    await page.evaluate('window.__LP.recoverToLive() && window.__LP.padOn(8000)');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const rot = await page.evaluate(`(() => {
      window.__LP.step(2);
      const s = window.__LP.touchState();
      const gate = document.getElementById('rotate-gate');
      return { clean: window.__LP.clean(s), gateShown: gate && gate.classList.contains('show'),
        paused: window.GO.paused, reasons: window.GO.pause.reasons.slice() };
    })()`) as { clean: boolean; gateShown: boolean; paused: boolean; reasons: string[] };
    check('portrait rotation gates, pauses, and resets input',
      rot.clean && !!rot.gateShown && rot.paused && rot.reasons.includes('ORIENTATION'),
      `gate=${rot.gateShown} paused=${rot.paused} reasons=${rot.reasons.join(',')}`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    const unrot = await page.evaluate(`(() => {
      window.__LP.step(2);
      return { paused: window.GO.paused, reasons: window.GO.pause.reasons.slice() };
    })()`) as { paused: boolean; reasons: string[] };
    check('rotating back releases only the orientation pause', !unrot.paused,
      `reasons=${unrot.reasons.join(',')}`);

    // ── 3. SNAP ownership ─────────────────────────────────────────────
    await page.evaluate(`(() => {
      const LP = window.__LP;
      const g = window.GO;
      LP.recoverToLive();
      for (let i = 0; i < 40000; i++) {
        const m = g.match;
        if (!m) break;
        if (m.phase === 'PLAY_CALL' && m.state.possession === 0 && !m.pendingOffense) {
          const drops = m.offensePlays.filter((p) =>
            !p.players.some((q) => q.route.some((n) => n.action === 'CARRY')));
          if (drops[0]) m.submitOffense(drops[0]);
        }
        LP.step(1);
        if (m.phase === 'PRE_SNAP' && m.state.possession === 0 && g.touch.mode === 'SNAP') break;
      }
      return window.GO.touch.mode;
    })()`);
    await page.waitForTimeout(250);   // clear the tap-through window after the pad re-appeared
    const snap = await page.evaluate(`(() => {
      const LP = window.__LP;
      const g = window.GO;
      const btn = document.querySelector('.tc-snap');
      if (!btn || btn.style.display === 'none' || g.touch.mode !== 'SNAP') return { skip: true, mode: g.touch.mode };
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // Slide off: press, drag away, release — must NOT snap, must not stick the class.
      const phase0 = g.match.phase;
      LP.ev('pointerdown', cx, cy, 50, btn);
      const pressedShown = btn.classList.contains('press');
      LP.ev('pointermove', cx - 80, cy - 40, 50, btn);
      LP.ev('pointerup', cx - 80, cy - 40, 50, btn);
      LP.step(4);
      const slideOff = { pressedShown, stuck: btn.classList.contains('press'), phase: g.match.phase, phase0 };
      // Clean tap: press and release in place — must snap. Retried with a spin-wait between
      // attempts so a tap-through window or a consumed-latch race cannot fail a healthy build.
      let tapped = { phase: g.match.phase, stuck: false };
      for (let attempt = 0; attempt < 3 && g.match.phase === 'PRE_SNAP'; attempt++) {
        const t0 = performance.now();
        while (performance.now() - t0 < 180) { /* clear the tap-through window */ }
        LP.ev('pointerdown', cx, cy, 51 + attempt, btn);
        LP.ev('pointerup', cx, cy, 51 + attempt, btn);
        LP.step(8);
        tapped = { phase: g.match.phase, stuck: btn.classList.contains('press') };
      }
      return { skip: false, slideOff, tapped };
    })()`) as { skip: boolean; mode?: string;
      slideOff?: { pressedShown: boolean; stuck: boolean; phase: string; phase0: string };
      tapped?: { phase: string; stuck: boolean } };
    if (snap.skip) {
      check('SNAP ownership (pad visible)', false, `pad mode=${snap.mode} — SNAP button not visible`);
    } else {
      check('SNAP press shows immediately and slide-off cancels',
        !!snap.slideOff && snap.slideOff.pressedShown && !snap.slideOff.stuck
        && snap.slideOff.phase === snap.slideOff.phase0,
        JSON.stringify(snap.slideOff));
      check('a clean SNAP tap snaps the ball, no stuck press',
        !!snap.tapped && snap.tapped.phase !== 'PRE_SNAP' && !snap.tapped.stuck,
        JSON.stringify(snap.tapped));
    }

    // ── 4. 100 interruption cycles ────────────────────────────────────
    const hundred = await page.evaluate(`(() => {
      const LP = window.__LP;
      LP.recoverToLive();
      LP.padOn(8000);
      let dirty = 0;
      for (let i = 0; i < 100; i++) {
        LP.ev('pointerdown', 200, 200, 60 + i);
        LP.ev('pointermove', 250, 170, 60 + i);
        if (i % 2 === 0) window.dispatchEvent(new Event('blur'));
        else document.dispatchEvent(new Event('visibilitychange'));
        LP.step(1);
        if (!LP.clean(LP.touchState())) dirty++;
        LP.recoverToLive();
      }
      return { dirty };
    })()`) as { dirty: number };
    check('100 interruption cycles leave no stale input', hundred.dirty === 0,
      `${100 - hundred.dirty}/100 clean`);

    // ── 5. pagehide checkpoint + resume card ──────────────────────────
    await page.evaluate(`(() => {
      const LP = window.__LP;
      const g = window.GO;
      LP.recoverToLive();
      for (let i = 0; i < 40000; i++) {
        if (!g.match || g.match.phase === 'PLAY_CALL') break;
        LP.step(1);
      }
      return g.match ? g.match.phase : 'none';
    })()`);
    await page.waitForTimeout(600);   // let the real rAF loop observe PLAY_CALL and checkpoint
    const ck = await page.evaluate(`(() => {
      const g = window.GO;
      localStorage.removeItem('go.save.v1');
      window.dispatchEvent(new Event('pagehide'));
      const raw = localStorage.getItem('go.save.v1');
      let hasCheckpoint = false;
      try { hasCheckpoint = !!(raw && JSON.parse(raw).suspendedMatch); } catch {}
      window.dispatchEvent(new Event('focus'));
      return { hasCheckpoint, screen: g.currentScreen, paused: g.paused };
    })()`) as { hasCheckpoint: boolean; screen: string; paused: boolean };
    check('return from interruption lands on the pause card, still paused',
      ck.screen === 'pause' && ck.paused, `screen=${ck.screen} paused=${ck.paused}`);
    check('pagehide flushes the prepared dead-ball checkpoint', ck.hasCheckpoint,
      ck.hasCheckpoint ? 'suspendedMatch present in storage' : 'no checkpoint written');

    // ── 6. WebGL context loss and restore ─────────────────────────────
    const loss = await page.evaluate(`(new Promise((resolve) => {
      const g = window.GO;
      window.__LP.recoverToLive();
      const gl = g.renderer.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) { resolve({ supported: false }); return; }
      ext.loseContext();
      setTimeout(() => {
        const duringLoss = {
          paused: g.paused,
          reasons: g.pause.reasons.slice(),
          overlayShown: [...document.querySelectorAll('div')].some((d) =>
            /CONTEXT LOST/.test(d.textContent || '') && d.style.display !== 'none'),
          clean: window.__LP.clean(window.__LP.touchState()),
          checkpointed: (() => { try { const r = localStorage.getItem('go.save.v1'); return !!(r && JSON.parse(r).suspendedMatch); } catch { return false; } })(),
        };
        ext.restoreContext();
        setTimeout(() => {
          resolve({ supported: true, duringLoss,
            afterRestore: { paused: g.paused, reasons: g.pause.reasons.slice(), screen: g.currentScreen } });
        }, 800);
      }, 500);
    }))`) as { supported: boolean; duringLoss?: { paused: boolean; reasons: string[]; overlayShown: boolean; clean: boolean; checkpointed: boolean };
      afterRestore?: { paused: boolean; reasons: string[]; screen: string } };
    if (!loss.supported) {
      check('context loss recovery', false, 'WEBGL_lose_context unavailable in this browser');
    } else {
      const d = loss.duringLoss!;
      check('context loss pauses, resets input, checkpoints, and explains itself',
        d.paused && d.reasons.includes('RECOVERY') && d.overlayShown && d.clean && d.checkpointed,
        JSON.stringify(d));
      const a = loss.afterRestore!;
      check('context restore lands on the pause card, recovery reason released',
        !a.reasons.includes('RECOVERY') && a.screen === 'pause' && a.paused,
        JSON.stringify(a));
    }

    check('no page errors during the whole run', errors.length === 0,
      errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    await stopServer();
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(`${checks.length - failed}/${checks.length} lifecycle checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
