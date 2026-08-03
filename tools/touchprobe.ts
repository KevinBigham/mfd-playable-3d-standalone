#!/usr/bin/env tsx
/**
 * Can somebody play this with two thumbs and nothing else? `npm run touch`
 *
 * Chromium with touch emulation on, at the size of a phone held sideways, with no keyboard
 * touched at any point. The headline check is the last one: the same seed, the same play, the
 * same snap, and the only difference between the runs is which way a thumb dragged off the
 * receiver badge. If the ball lands in the same place all three times then placement is
 * decorative and the touch grammar is a lie, however good it looks.
 *
 * Two notes on how it drives the game:
 *
 *  - The loop is stepped by hand rather than by `requestAnimationFrame`. This container is
 *    software-rasterised, so a real-time drive would take minutes per snap; stepping calls the
 *    same four things `Game.frame` calls, in the same order, so the touch layer sees exactly the
 *    frame boundaries it would see on a phone.
 *  - Gestures are dispatched as PointerEvents from inside the page. One real `touchscreen.tap`
 *    runs first to prove the browser's own touch pipeline reaches the layer; after that,
 *    synthesised pointers are the only way to express a drag with a controlled path.
 */
import { startServer, stopServer, ensureBuild } from './browser.ts';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

/** Draw one frame, then photograph the whole page — canvas and pad together. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => { try { (window as any).GO.renderer.render(); } catch { /* menu frame */ } });
  await page.waitForTimeout(120);
  try { await page.screenshot({ path: `${OUT}/${name}.png`, type: 'png', timeout: 20000 }); }
  catch { /* a shot is documentation, never a reason to fail the run */ }
}

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
}

/** Everything the page needs, installed once. */
const HARNESS = `
window.__TP = {
  g: null,
  init() { this.g = window.GO; },
  // One frame, minus the draw. Same order as Game.frame.
  step(n) {
    const g = window.GO;
    for (let i = 0; i < n; i++) {
      // Same order as Game.frame: semantic context BEFORE the poll, projection after render.
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
  stepUntil(pred, max) {
    for (let i = 0; i < max; i++) { this.step(1); if (eval(pred)) return i; }
    return -1;
  },
  ev(type, x, y, id, target) {
    const el = target || document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1,
    }));
  },
  /** Press, drag along a path, lift. dx/dy of 0 is a tap. */
  gesture(x, y, dx, dy, id) {
    id = id || 21;
    this.ev('pointerdown', x, y, id);
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      this.ev('pointermove', x + (dx * s) / steps, y + (dy * s) / steps, id);
    }
    this.ev('pointerup', x + dx, y + dy, id);
  },
  badgeAt(slot) {
    const b = document.querySelectorAll('.tc-badge')[slot];
    if (!b || !b.classList.contains('on')) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             w: Math.round(r.width), h: Math.round(r.height) };
  },
  visibleBadges() {
    const out = [];
    document.querySelectorAll('.tc-badge').forEach((b, i) => { if (b.classList.contains('on')) out.push(i); });
    return out;
  },
};
`;

/** Fresh match on a fixed seed, stepped to the snap, with the ball in our hands. */
const TO_PRE_SNAP = `
(() => {
  const g = window.GO;
  g.settings.quality = 'LOW';
  g.reset('match', { config: { seed: SEED, quarterSeconds: 120, difficulty: 'PRO',
    seats: [{ side: 0, active: true }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }], mode: 'QUICKPLAY' },
    returnScreen: 'mainMenu' });
  window.__TP.init();
  // Ride out the kickoff, then CALL THE DEEPEST DROP IN THE BOOK. Letting the play-call clock
  // expire looked like the neutral choice and was not: it hands the down to whatever the
  // auto-picker fancies, and everything below needs one specific kind of down — a quarterback
  // still holding the ball a beat after the snap, with receivers to put badges on. Seed 90210
  // drew one of those for a while, then drew a run the moment anything upstream moved the RNG by
  // a single draw. So: no handoff in the routes, out of the gun, and the latest primary read
  // available, which is the same thing a person picks when they want a second to look.
  for (let i = 0; i < 4000; i++) {
    const m = g.match;
    if (m && m.phase === 'PLAY_CALL' && m.state.possession === 0 && !m.pendingOffense) {
      const drops = m.offensePlays.filter((p) =>
        !p.players.some((q) => q.route.some((n) => n.action === 'CARRY'))
        && /SHOTGUN/.test(p.formation));
      drops.sort((a, b) => b.timing.primary - a.timing.primary);
      if (drops[0]) m.submitOffense(drops[0]);
    }
    window.__TP.step(1);
    // Wait for the PAD, not just the phase. PRE_SNAP begins a tick or two before the quarterback
    // is actually holding the ball, and modeFor only turns the pad on once he is — so returning
    // on the phase alone handed the next caller a control layer that was still display:none, and
    // every control measured 0x0. That raced for as long as the timing happened to fall the right
    // way and then broke the moment anything upstream moved by a frame.
    // (No backticks in here: this whole block is a template literal.)
    if (m && m.phase === 'PRE_SNAP' && m.state.possession === 0 && g.touch.mode === 'SNAP') {
      return { ok: true, i, phase: m.phase, play: m.world.offensePlay ? m.world.offensePlay.id : '?' };
    }
  }
  return { ok: false, phase: g.match ? g.match.phase : 'none',
    mode: g.touch ? g.touch.mode : 'no pad' };
})()
`;

async function main(): Promise<void> {
  ensureBuild();
  console.log('\nGRIDIRON OVERDRIVE — touch-only probe'
    + '\n────────────────────────────────────────────────────────────────');
  const url = await startServer(4174);

  // A phone held sideways, with a real coarse pointer. `launch()` builds a desktop page, so the
  // context is opened here instead — hasTouch is what makes `(pointer: coarse)` true, and that
  // is the switch the title screen and the artifact banner both read.
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
    // ── the device presents itself as a phone ────────────────────────
    const dev = await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      touchPoints: navigator.maxTouchPoints,
      prompt: (document.querySelector('.go-screen div, #ui-root div') as HTMLElement | null)?.textContent ?? '',
    }));
    check('browser reports a coarse pointer', dev.coarse && dev.touchPoints > 0,
      `coarse=${dev.coarse} maxTouchPoints=${dev.touchPoints}`);

    // ── the app shell ────────────────────────────────────────────────
    //
    // `viewport-fit=cover` is checked here rather than trusted because the failure is silent and
    // total: without it iOS returns 0 for every `env(safe-area-inset-*)`, and the five rules in
    // styles.css that dodge the notch and the home indicator all quietly stop working. Nothing
    // in the page looks wrong on a desktop or in an emulator when that happens.
    // Written as a string, not an arrow: tsx compiles named arrows in this file with an injected
    // `__name` helper that does not exist inside the page, and the evaluate throws on it.
    const shell = await page.evaluate(`(function () {
      var q = function (n) {
        var e = document.querySelector('meta[name="' + n + '"]');
        return e ? e.getAttribute('content') : null;
      };
      var man = document.querySelector('link[rel=manifest]');
      return {
        viewport: q('viewport') || '',
        apple: q('apple-mobile-web-app-capable'),
        web: q('mobile-web-app-capable'),
        manifest: man ? man.getAttribute('href') : '',
        envParsed: CSS.supports('padding-top', 'env(safe-area-inset-top)'),
        overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      };
    })()`) as {
      viewport: string; apple: string | null; web: string | null;
      manifest: string; envParsed: boolean; overscroll: string;
    };
    check('viewport opts into the safe-area insets', /viewport-fit=cover/.test(shell.viewport),
      shell.viewport);
    check('the engine parses env(safe-area-inset-*)', shell.envParsed,
      'inset VALUES need a notched device; this only proves the syntax is live');
    check('iOS is told it can run without browser chrome', shell.apple === 'yes' && shell.web === 'yes',
      `apple=${shell.apple} web=${shell.web}`);
    // A data URI, not a file: the artifact is one self-contained HTML file and an external
    // manifest would be the first thing to break that. Chromium resolves this form; blob: does not.
    check('a web-app manifest is attached and stays inline',
      shell.manifest.startsWith('data:application/manifest+json,'),
      shell.manifest ? `${shell.manifest.slice(0, 34)}… (${shell.manifest.length} chars)` : 'absent');
    check('pull-to-refresh cannot reload a live drive', shell.overscroll === 'none',
      `overscroll-behavior-y: ${shell.overscroll}`);

    const titleText = await page.evaluate(() => document.body.innerText);
    check('title asks for a tap, not a key press',
      /TAP TO START/i.test(titleText) && !/PRESS START/i.test(titleText),
      titleText.split('\n').map((s) => s.trim()).filter(Boolean).slice(-1)[0] ?? '');

    // ── a real browser-generated touch reaches the game ──────────────
    let afterTap = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.touchscreen.tap(422, 300);
      await page.waitForTimeout(400);
      afterTap = await page.evaluate(() => (window as unknown as { GO: any }).GO.currentScreen) as string;
      if (afterTap === 'mainMenu') break;
    }
    check('a real touch gets past the title screen', afterTap === 'mainMenu', `screen=${afterTap}`);

    // ── into a match, at the snap ────────────────────────────────────
    const arrive = await page.evaluate(TO_PRE_SNAP.replace('SEED', '90210')) as { ok: boolean; phase: string; play?: string };
    check('reaches the snap with the ball', arrive.ok, `phase=${arrive.phase} play=${arrive.play ?? '?'}`);

    const snapBtn = await page.evaluate(() => {
      const b = document.querySelector('.tc-snap') as HTMLElement;
      const r = b.getBoundingClientRect();
      return { display: getComputedStyle(b).display, w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    check('a snap control exists and is thumb-sized', snapBtn.display !== 'none' && snapBtn.w >= 44 && snapBtn.h >= 44,
      `${snapBtn.w}x${snapBtn.h} px at ${snapBtn.x},${snapBtn.y}`);
    await shot(page, '10-touch-snap');

    // The SNAP button ignores commits inside its 150 ms tap-through window after appearing —
    // that is the fix for stray screen-transition taps, and the probe must respect it too.
    await page.waitForTimeout(250);
    const snapped = await page.evaluate(`(() => {
      const g = window.GO;
      window.__TP.gesture(${snapBtn.x}, ${snapBtn.y}, 0, 0, 31);
      for (let i = 0; i < 60; i++) { window.__TP.step(1); if (g.match.world.playPhase === 'LIVE') return { ok: true, i }; }
      return { ok: false, playPhase: g.match.world.playPhase };
    })()`) as { ok: boolean; i?: number; playPhase?: string };
    check('tapping snap hikes the ball', snapped.ok, snapped.ok ? `live after ${snapped.i} frames` : `playPhase=${snapped.playPhase}`);

    // ── badges sit on the receivers ──────────────────────────────────
    const badges = await page.evaluate(`(() => {
      const g = window.GO;
      window.__TP.step(24);
      const w = g.match.world;
      const me = w.athletes.find((a) => a.controlledBySeat === 0);
      // The pad only draws badges in QB mode. When this check fails it is usually because the
      // down is not the one it thinks it is, so say which mode it actually got.
      const out = { mode: g.touch.mode, held: me ? me.id : -1, qb: w.qbId,
        hasBall: !!(me && me.hasBall), thrown: w.passThrown,
        phase: g.match.phase, playPhase: w.playPhase,
        dead: w.deadReason, playTicks: w.playTicks, rows: [] };
      const vis = window.__TP.visibleBadges();
      for (const slot of vis) {
        const id = w.passTargets[slot];
        const a = w.athletes[id];
        const b = window.__TP.badgeAt(slot);
        // Project the athlete's CHEST and his CROWN, not the height the badge happens to be
        // drawn at. This check used to re-derive the same constant the UI uses, which made it a
        // tautology: it passed because the two numbers matched, and it failed the moment the
        // athletes stopped being seven feet tall even though the badge was still on the man.
        const lo = g.renderer.projectToScreen(a.x, 1.15, a.z, { x: 0, y: 0, behind: false });
        const hi = g.renderer.projectToScreen(a.x, 2.05, a.z, { x: 0, y: 0, behind: false });
        const el = document.querySelectorAll('.tc-badge')[slot];
        out.rows.push({ slot, num: a.def.number, bx: b.x, by: b.y,
          cx: Math.round(lo.x), cy: Math.round(lo.y), hy: Math.round(hi.y), size: b.w,
          edge: el.classList.contains('edge') });
      }
      return out;
    })()`) as { mode: string; held: number; qb: number; hasBall: boolean; thrown: boolean;
      phase: string; playPhase: string; dead: string | null; playTicks: number;
      rows: Array<{ slot: number; num: number; bx: number; by: number;
        cx: number; cy: number; hy: number; size: number; edge: boolean }> };

    // On the man: horizontally over him, and vertically somewhere between his chest and one head
    // above his helmet. That is what "the badge is on the receiver" means for a thumb.
    //
    // A badge marked `edge` is exempt from the position test and gets a stricter one instead: its
    // receiver has to be genuinely outside the frame. That is not a loosened gate — it closes a
    // hole. The old test only ever looked at one frame, so a clamped badge either passed by luck
    // or failed for a reason the failure text did not name; now a clamp is either justified by
    // the receiver's real position or it is a defect, and the two cannot be confused.
    const tracked = badges.rows.length > 0 && badges.rows.every((r) => {
      if (r.edge) return r.cx < 0 || r.cx > 844 || r.cy < 0 || r.cy > 390;
      const body = r.cy - r.hy;                    // screen y grows downward
      return Math.abs(r.bx - r.cx) <= 4 && r.by <= r.cy && r.by >= r.hy - body * 0.45;
    });
    check('receiver badges are drawn on the receivers, or honestly marked off-frame', tracked,
      badges.rows.map((r) => `#${r.num}@${r.bx},${r.by}${r.edge ? '(edge→' + r.cx + ',' + r.cy + ')' : ''}`).join(' ')
      || `no badges visible — pad mode=${badges.mode} driving=${badges.held} qb=${badges.qb}`
         + ` hasBall=${badges.hasBall} thrown=${badges.thrown} phase=${badges.phase}/${badges.playPhase} dead=${badges.dead} t=${badges.playTicks}`);
    check('badges are thumb-sized', badges.rows.every((r) => r.size >= 44),
      `${badges.rows.map((r) => r.size).join('/')} px`);
    await shot(page, '11-touch-badges');
    // And with a placement drag in progress, which is the control that matters most.
    await page.evaluate(`(() => {
      const b = window.__TP.badgeAt(window.__TP.visibleBadges()[0]);
      window.__TP.ev('pointerdown', b.x, b.y, 81);
      window.__TP.ev('pointermove', b.x + 70, b.y - 34, 81);
    })()`);
    await shot(page, '12-touch-placement');
    await page.evaluate('window.__TP.ev("pointercancel", 0, 0, 81)');

    // ── the headline: does the drag actually place the ball? ─────────
    //
    // Same seed, same play, same snap, same number of frames before the throw. The ONLY thing
    // that changes between the three runs is the direction a thumb dragged.
    const RUN = (dx: number, dy: number): string => `(() => {
      const g = window.GO;
      const a = window.__TP;
      const r = ${TO_PRE_SNAP.replace('SEED', '90210')};
      if (!r.ok) return { ok: false, why: 'never reached the snap: ' + r.phase };
      // Settle a few frames before reading the button: the snap control only exists once the
      // quarterback is actually holding the ball, and that is not true on the first frame of
      // PRE_SNAP. Reading the rect too early gets 0x0 at 0,0 and the tap lands on nothing.
      for (let i = 0; i < 30 && g.touch.mode !== 'SNAP'; i++) a.step(1);
      // Wait out the SNAP tap-through lock (150 ms wall clock) — synchronous evaluate, so spin.
      const tw0 = performance.now();
      while (performance.now() - tw0 < 180) { /* spin */ }
      const sb = document.querySelector('.tc-snap').getBoundingClientRect();
      if (sb.width < 10) return { ok: false, why: 'no snap control, mode=' + g.touch.mode + ' phase=' + g.match.phase };
      a.gesture(Math.round(sb.left + sb.width / 2), Math.round(sb.top + sb.height / 2), 0, 0, 41);
      for (let i = 0; i < 60 && g.match.world.playPhase !== 'LIVE'; i++) a.step(1);
      a.step(26);
      const vis = a.visibleBadges();
      if (!vis.length) return { ok: false, why: 'no badge: mode=' + g.touch.mode
        + ' playPhase=' + g.match.world.playPhase + ' thrown=' + g.match.world.passThrown };
      const slot = vis[0];
      const b = a.badgeAt(slot);
      const w = g.match.world;
      const target = w.athletes[w.passTargets[slot]].def.number;
      a.gesture(b.x, b.y, ${dx}, ${dy}, 42);
      for (let i = 0; i < 90; i++) {
        a.step(1);
        const st = g.match.world.ball.state;
        if (st.kind === 'inAir') return { ok: true, tx: st.tx, tz: st.tz, slot, target };
      }
      return { ok: false, why: 'no throw resolved', thrown: g.match.world.passThrown };
    })()`;

    const left = await page.evaluate(RUN(-90, 0)) as any;
    const none = await page.evaluate(RUN(0, 0)) as any;
    const right = await page.evaluate(RUN(90, 0)) as any;

    const all = [left, none, right];
    const threw = all.every((r) => r.ok);
    check('a drag off a badge throws the ball', threw,
      threw ? `to #${left.target} on all three runs` : all.map((r) => r.why).join(' | '));

    if (threw) {
      const sameTarget = left.target === none.target && none.target === right.target;
      const spread = Math.hypot(right.tx - left.tx, right.tz - left.tz);
      const dl = Math.hypot(none.tx - left.tx, none.tz - left.tz);
      const dr = Math.hypot(right.tx - none.tx, right.tz - none.tz);
      check('the same receiver was targeted every run', sameTarget, `#${left.target}`);
      check('dragging left and right places the ball differently', spread > 1.0,
        `left(${left.tx.toFixed(1)},${left.tz.toFixed(1)}) `
        + `none(${none.tx.toFixed(1)},${none.tz.toFixed(1)}) `
        + `right(${right.tx.toFixed(1)},${right.tz.toFixed(1)})  spread=${spread.toFixed(2)} yd`);
      check('a plain tap sits between the two drags', dl > 0.4 && dr > 0.4,
        `tap→left ${dl.toFixed(2)} yd · tap→right ${dr.toFixed(2)} yd`);
    }

    // ── THUMB_FAN surface parity: same seed, same slot, same receiver ─
    //
    // The fan changes where the thumb lands, never what the throw means: tapping fan slot N and
    // tapping badge slot N must select the same receiver through the same semantic intent.
    const fanRun = await page.evaluate(`(() => {
      const g = window.GO;
      const a = window.__TP;
      g.settings.touchProfile.targetSurface = 'THUMB_FAN';
      g.applySettings();
      const r = ${TO_PRE_SNAP.replace('SEED', '90210')};
      if (!r.ok) return { ok: false, why: 'never reached the snap' };
      for (let i = 0; i < 30 && g.touch.mode !== 'SNAP'; i++) a.step(1);
      const tw0 = performance.now();
      while (performance.now() - tw0 < 180) { /* tap-through lock */ }
      const sb = document.querySelector('.tc-snap').getBoundingClientRect();
      a.gesture(Math.round(sb.left + sb.width / 2), Math.round(sb.top + sb.height / 2), 0, 0, 71);
      for (let i = 0; i < 60 && g.match.world.playPhase !== 'LIVE'; i++) a.step(1);
      a.step(26);
      const fans = [...document.querySelectorAll('.tc-fan')].filter((b) => b.style.display !== 'none');
      if (fans.length !== 3) return { ok: false, why: 'fan not shown: ' + fans.length };
      const geometry = fans.map((b) => { const q = b.getBoundingClientRect(); return { w: q.width, h: q.height, x: q.x, y: q.y }; });
      const w = g.match.world;
      const expected = w.athletes[w.passTargets[1]].def.number;
      const fb = fans[1].getBoundingClientRect();
      let thrownTo = -1;
      g.match.bus.on('throw', (e) => { if (e.to !== null) thrownTo = w.athletes[e.to].def.number; });
      a.gesture(Math.round(fb.left + fb.width / 2), Math.round(fb.top + fb.height / 2), 0, 0, 72);
      for (let i = 0; i < 20; i++) a.step(1);
      g.settings.touchProfile.targetSurface = 'DIRECT_FIELD';
      g.applySettings();
      return { ok: true, expected, thrownTo, geometry };
    })()`) as { ok: boolean; why?: string; expected?: number; thrownTo?: number;
      geometry?: Array<{ w: number; h: number; x: number; y: number }> };
    if (!fanRun.ok) {
      check('thumb-fan surface parity', false, fanRun.why ?? '');
    } else {
      check('fan targets are drawn, thumb-sized, and reachable',
        (fanRun.geometry ?? []).every((q) => q.w >= 48 && q.h >= 48),
        (fanRun.geometry ?? []).map((q) => `${Math.round(q.w)}px@${Math.round(q.x)},${Math.round(q.y)}`).join(' '));
      check('tapping fan slot 1 throws to the same receiver as badge slot 1',
        fanRun.thrownTo === fanRun.expected,
        `fan → #${fanRun.thrownTo}, badge slot 1 = #${fanRun.expected}`);
    }

    // ── carrier gestures produce the right verbs ─────────────────────
    const verbs = await page.evaluate(`(() => {
      const g = window.GO;
      const a = window.__TP;
      // Drive the touch layer directly in CARRY mode and read what the intent came out as.
      const seen = {};
      const grab = () => { g.input.poll(); const it = g.input.intentFor(0); return it ? it.held : 0; };
      const probe = (dx, dy, tapOnly) => {
        g.touch.mode = 'CARRY';
        if (tapOnly) a.gesture(640, 200, 0, 0, 51);
        else a.gesture(640, 200, dx, dy, 51);
        return grab();
      };
      seen.tap = probe(0, 0, true);
      seen.up = probe(0, -70, false);
      seen.down = probe(0, 70, false);
      seen.left = probe(-70, 0, false);
      return seen;
    })()`) as Record<string, number>;

    // SPECIAL 1<<7, JUMP 1<<2, DIVE 1<<6, JUKE 1<<19
    check('tap on the field spins', (verbs.tap & (1 << 7)) !== 0, `held=${verbs.tap}`);
    check('swipe up hurdles', (verbs.up & (1 << 2)) !== 0, `held=${verbs.up}`);
    check('swipe down dives', (verbs.down & (1 << 6)) !== 0, `held=${verbs.down}`);
    check('swipe sideways jukes', (verbs.left & (1 << 19)) !== 0, `held=${verbs.left}`);

    // ── the stick steers ─────────────────────────────────────────────
    const stick = await page.evaluate(`(() => {
      const g = window.GO;
      const a = window.__TP;
      a.ev('pointerdown', 150, 250, 61);
      a.ev('pointermove', 150, 160, 61);   // straight "up" the screen = downfield
      g.input.poll();
      const it = g.input.intentFor(0);
      const moving = { moveX: it.moveX, moveZ: it.moveZ };
      a.ev('pointermove', 150, 90, 61);    // full deflection, held at the edge
      g.input.poll();
      const turboEarly = (g.input.intentFor(0).held & 1) !== 0;
      // Hold-at-edge turbo: full deflection must be HELD for its dwell (~300 ms) before turbo
      // engages, and it must not flicker at the boundary. Spin the wall clock, then poll.
      const tw0 = performance.now();
      while (performance.now() - tw0 < 380) { /* hold the edge */ }
      g.input.poll();
      const turboHeld = (g.input.intentFor(0).held & 1) !== 0;
      a.ev('pointerup', 150, 90, 61);
      g.input.poll();
      const after = g.input.intentFor(0);
      const turboAfter = (after.held & 1) !== 0;
      return { moving, turboEarly, turboHeld, turboAfter, restX: after.moveX, restZ: after.moveZ };
    })()`) as { moving: { moveX: number; moveZ: number }; turboEarly: boolean; turboHeld: boolean;
      turboAfter: boolean; restX: number; restZ: number };

    const mag = Math.hypot(stick.moving.moveX, stick.moving.moveZ);
    check('the stick produces a movement vector', mag > 0.6,
      `move=(${stick.moving.moveX.toFixed(2)}, ${stick.moving.moveZ.toFixed(2)}) |v|=${mag.toFixed(2)}`);
    check('holding the edge engages turbo after the dwell, not instantly',
      !stick.turboEarly && stick.turboHeld && !stick.turboAfter,
      `instant=${stick.turboEarly} held=${stick.turboHeld} after-release=${stick.turboAfter}`);
    check('lifting the thumb stops the player', stick.restX === 0 && stick.restZ === 0,
      `move=(${stick.restX}, ${stick.restZ})`);

    // ── nothing is left welded on when the page goes away ────────────
    const cleaned = await page.evaluate(`(() => {
      const g = window.GO;
      const a = window.__TP;
      // The wall-clock waits above let the real loop advance the match; the pad may be OFF at a
      // play-call. Re-enter a state where the stick is live before measuring the blur reset.
      const r = ${TO_PRE_SNAP.replace('SEED', '90210')};
      if (!r.ok) return { during: 0, after: -1, held: -1 };
      a.ev('pointerdown', 150, 250, 71);
      a.ev('pointermove', 150, 100, 71);
      g.input.poll();
      const during = Math.hypot(g.input.intentFor(0).moveX, g.input.intentFor(0).moveZ);
      window.dispatchEvent(new Event('blur'));
      g.input.poll();
      const it = g.input.intentFor(0);
      return { during, after: Math.hypot(it.moveX, it.moveZ), held: it.held };
    })()`) as { during: number; after: number; held: number };
    check('losing the page releases every finger', cleaned.during > 0.5 && cleaned.after === 0,
      `holding=${cleaned.during.toFixed(2)} → after blur=${cleaned.after}`);

    // Since Wave 1, an interruption also pauses through a LIFECYCLE reason and returning lands
    // on the pause card — the safe path, by design. Complete the round trip the way a player
    // would: come back, then press RESUME.
    const roundTrip = await page.evaluate(`(() => {
      const g = window.GO;
      window.dispatchEvent(new Event('focus'));
      window.__TP.step(2);
      const cardShown = g.currentScreen === 'pause';
      const btns = [...document.querySelectorAll('.go-btn, button, [class*=btn]')];
      const r = btns.find((b) => /RESUME/.test(b.textContent || ''));
      if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.__TP.step(2);
      return { cardShown, paused: g.paused, screen: g.currentScreen };
    })()`) as { cardShown: boolean; paused: boolean; screen: string };
    check('an interruption returns through the pause card, and RESUME works',
      roundTrip.cardShown && !roundTrip.paused,
      `card=${roundTrip.cardShown} paused=${roundTrip.paused} screen=${roundTrip.screen}`);

    // ── upright is a gate, not a lost down ───────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const portrait = await page.evaluate(`(() => {
      const g = window.GO;
      window.__TP.step(2);
      return { gate: document.getElementById('rotate-gate').classList.contains('show'),
               paused: g.paused, mode: g.touch.mode };
    })()`) as { gate: boolean; paused: boolean; mode: string };
    check('portrait raises the rotate gate and stops the clock',
      portrait.gate && portrait.paused && portrait.mode === 'OFF',
      `gate=${portrait.gate} paused=${portrait.paused} mode=${portrait.mode}`);
    await shot(page, '13-touch-rotate');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    const back = await page.evaluate(`(() => {
      const g = window.GO;
      window.__TP.step(2);
      return { gate: document.getElementById('rotate-gate').classList.contains('show'), paused: g.paused };
    })()`) as { gate: boolean; paused: boolean };
    check('rotating back resumes play', !back.gate && !back.paused,
      `gate=${back.gate} paused=${back.paused}`);

    const real = errors.filter((e) => !/favicon|WebGL: INVALID|deprecated|Download the React/i.test(e));
    check('no console errors', real.length === 0, real.slice(0, 2).join(' | ') || 'clean');

    // ── a mouse must never see any of this ───────────────────────────
    const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: false });
    const desk = await deskCtx.newPage();
    await desk.goto(url, { waitUntil: 'load', timeout: 60000 });
    await desk.waitForFunction(() => (window as unknown as { GO?: unknown }).GO !== undefined,
      undefined, { timeout: 150000 });
    await desk.addScriptTag({ content: HARNESS });
    const deskState = await desk.evaluate(`(() => {
      const g = window.GO;
      g.settings.quality = 'LOW';
      g.reset('match', { config: { seed: 90210, quarterSeconds: 120 }, returnScreen: 'mainMenu' });
      window.__TP.init();
      for (let i = 0; i < 1500; i++) {
        window.__TP.step(1);
        if (g.match && g.match.phase === 'PRE_SNAP') break;
      }
      return { coarse: matchMedia('(pointer: coarse)').matches, mode: g.touch.mode,
        display: getComputedStyle(g.touch.root).display, phase: g.match ? g.match.phase : 'none',
        prompt: /PRESS START/.test(document.body.innerText) };
    })()`) as { coarse: boolean; mode: string; display: string; phase: string };
    check('a mouse-driven desktop gets no touch pad at all',
      !deskState.coarse && deskState.mode === 'OFF' && deskState.display === 'none',
      `coarse=${deskState.coarse} mode=${deskState.mode} display=${deskState.display} phase=${deskState.phase}`);
    await deskCtx.close();
  } finally {
    await browser.close();
    stopServer();
  }

  const failed = checks.filter((c) => !c.pass).length;
  console.log('────────────────────────────────────────────────────────────────'
    + `\n${checks.length - failed}/${checks.length} touch checks passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
