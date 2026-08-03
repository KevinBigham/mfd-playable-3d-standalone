#!/usr/bin/env tsx
/**
 * Phone graphics probe. `npm run gfx`
 *
 * The phone build looked rough because LOW — every phone's starting tier — drew an 844×390
 * buffer stretched across a ~3x-density display, with no antialiasing and anisotropy 1. This
 * probe boots the game in a 3x phone context and proves the fixes hold:
 *
 *   1. the pixel-ratio floor (near-native density on coarse displays, governor floor lands
 *      back on the old fill cost),
 *   2. MSAA and the anisotropy/turf floors on phones,
 *   3. the governor's promotion ladder — sustained measured headroom climbs the tier and
 *      persists it while `autoQuality` holds, a demote after a promotion burns the fuse,
 *   4. the desktop path is untouched.
 *
 * The governor is driven synthetically (governResolution with fabricated intervals) inside
 * single evaluate calls, so real headless frame timing can neither pass nor fail it.
 */
import { startServer, stopServer, ensureBuild } from './browser.ts';
import { chromium } from 'playwright';

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

const MATCH_CONFIG = {
  seed: 4242, home: 'iron-harbor-anvils', away: 'nyx-city-nocturnes',
  ruleset: 'DRIVE_RUSH', quarterSeconds: 120, difficulty: 'PRO',
  seats: [{ side: 0, active: true }, { side: 1, active: false }], mode: 'QUICKPLAY',
};

async function main(): Promise<void> {
  ensureBuild();
  const url = await startServer();
  const browser = await chromium.launch();

  // ── phone: 3x display, coarse pointer ──────────────────────────────────
  const phone = await browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
    hasTouch: true, isMobile: true,
  });
  const page = await phone.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).GO, undefined, { timeout: 20000 });

  const base = await page.evaluate(() => {
    const g = (window as any).GO;
    const canvas = g.renderer.renderer.domElement as HTMLCanvasElement;
    const gl = g.renderer.renderer.getContext() as WebGLRenderingContext;
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      tier: g.renderer.quality.tier,
      autoQuality: g.settings.autoQuality,
      ratio: g.renderer.renderer.getPixelRatio(),
      bufferW: canvas.width, cssW: canvas.clientWidth,
      antialias: !!gl.getContextAttributes()?.antialias,
      anisotropy: g.renderer.quality.anisotropy,
      turfDetail: g.renderer.quality.turfDetail,
    };
  });
  check('phone context is coarse-pointer', base.coarse, String(base.coarse));
  check('fresh phone save starts LOW + autoQuality', base.tier === 'LOW' && base.autoQuality,
    `${base.tier} auto=${base.autoQuality}`);
  check('LOW pixel ratio floored at near-native', Math.abs(base.ratio - 1.75) < 0.01,
    `ratio=${base.ratio}`);
  check('drawing buffer matches floored ratio',
    Math.abs(base.bufferW - base.cssW * 1.75) <= 2, `${base.bufferW}px for ${base.cssW}css`);
  check('LOW gets MSAA on a coarse display', base.antialias, String(base.antialias));
  check('anisotropy floored to 4 on phone', base.anisotropy >= 4, String(base.anisotropy));
  check('turf detail floored to 0.5 on phone', base.turfDetail >= 0.5, String(base.turfDetail));

  // Into a match, so the governor's inMatch gate is genuinely open.
  await page.evaluate((cfg) => {
    (window as any).GO.go('match', { config: cfg, returnScreen: 'mobileHome' });
  }, MATCH_CONFIG);
  // Evaluate bodies are strings: tsx's esbuild pass injects a `__name` helper into transformed
  // closures that does not exist inside the page. Same workaround as the other probes.
  const booted = await page.evaluate(`(() => {
    const g = window.GO;
    for (let i = 0; i < 12000; i++) {
      const m = g.match;
      if (m && m.kickoffAwaitingChoice) m.submitKickoff('DEEP');
      if (m && m.phase === 'PRE_SNAP') return true;
      g.touch.prepareContext(m, true);
      g.input.poll();
      if (m) { m.tick(); g.renderer.sync(m.world, m.state, 1, 1 / 60, false); }
      g.input.clearEdges();
    }
    return false;
  })()`);
  check('match reaches PRE_SNAP', booted, '');

  // Promotion ladder, driven synthetically and atomically (one evaluate = no real RAF
  // interleaving). Real frame timing is silenced afterwards via dynamicResolution=false.
  const ladder = await page.evaluate(`(() => {
    const g = window.GO;
    g.settings.dynamicResolution = true;
    // Real headless frames ran between evaluates; start the ladder from a known state.
    g.dynScale = 1; g.dynOver = 0; g.dynUnder = 0; g.dynPromote = 0; g.dynBaseline = 16.7;
    const fast = (n) => { for (let i = 0; i < n; i++) g.governResolution(10); };
    const late = (n) => { for (let i = 0; i < n; i++) g.governResolution(50); };
    const out = {};
    fast(700);
    out.afterFirst = g.renderer.quality.tier;
    out.persisted = g.settings.quality;
    out.autoStill = g.settings.autoQuality;
    fast(700);
    out.afterSecond = g.renderer.quality.tier;
    late(46);                       // resolution drop after a promotion burns the fuse
    out.scaleDropped = g.dynamicScale < 1;
    fast(1500);                     // restores resolution, then banks headroom again
    out.afterFuse = g.renderer.quality.tier;
    out.scaleRestored = g.dynamicScale;
    g.settings.dynamicResolution = false;
    return out;
  })()`) as Record<string, unknown>;
  check('sustained headroom promotes LOW → MEDIUM', ladder.afterFirst === 'MEDIUM',
    String(ladder.afterFirst));
  check('promotion persists into settings, auto intact',
    ladder.persisted === 'MEDIUM' && ladder.autoStill === true,
    `saved=${ladder.persisted} auto=${ladder.autoStill}`);
  check('continued headroom promotes MEDIUM → HIGH', ladder.afterSecond === 'HIGH',
    String(ladder.afterSecond));
  check('late frames drop resolution first', ladder.scaleDropped === true, '');
  check('fuse: no re-promotion after a post-promotion demote',
    ladder.afterFuse === 'HIGH' && ladder.scaleRestored === 1,
    `tier=${ladder.afterFuse} scale=${ladder.scaleRestored}`);

  // Pinning: a manual GRAPHICS choice must stop the governor from persisting over it.
  const pinned = await page.evaluate(`(() => {
    const g = window.GO;
    g.settings.quality = 'LOW'; g.settings.autoQuality = false;
    g.applySettings();
    g.settings.dynamicResolution = true;
    for (let i = 0; i < 700; i++) g.governResolution(10);
    g.settings.dynamicResolution = false;
    return { tier: g.renderer.quality.tier, saved: g.settings.quality };
  })()`) as { tier: string; saved: string };
  check('pinned quality is never auto-promoted',
    pinned.tier === 'LOW' && pinned.saved === 'LOW', `tier=${pinned.tier}`);

  await phone.close();

  // ── desktop: fine pointer, nothing changes ─────────────────────────────
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dpage = await desktop.newPage();
  await dpage.goto(url);
  await dpage.waitForFunction(() => !!(window as any).GO, undefined, { timeout: 20000 });
  const desk = await dpage.evaluate(() => {
    const g = (window as any).GO;
    const gl = g.renderer.renderer.getContext() as WebGLRenderingContext;
    return {
      tier: g.renderer.quality.tier,
      ratio: g.renderer.renderer.getPixelRatio(),
      anisotropy: g.renderer.quality.anisotropy,
      antialias: !!gl.getContextAttributes()?.antialias,
    };
  });
  check('desktop default tier unchanged (HIGH)', desk.tier === 'HIGH', String(desk.tier));
  check('desktop pixel ratio unchanged', Math.abs(desk.ratio - 1.75) < 0.01, String(desk.ratio));
  check('desktop anisotropy from preset (8)', desk.anisotropy === 8, String(desk.anisotropy));
  await desktop.close();
  await browser.close();
  await stopServer();

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n  gfxprobe: ${passed}/${checks.length}${errors.length ? `  pageerrors: ${errors.length}` : ''}`);
  if (passed !== checks.length || errors.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
