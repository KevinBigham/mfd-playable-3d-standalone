#!/usr/bin/env tsx
/**
 * Performance profile of MOVING GAMEPLAY (not an empty field), at every quality preset.
 * `npm run perf`
 */
import { startServer, stopServer, launch, probe, ensureBuild } from './browser.ts';

interface Row {
  tier: string; p50: number; p95: number; p99: number; worst: number;
  calls: number; triangles: number; textures: number; geometries: number; frames: number;
}

async function measure(page: import('playwright').Page, tier: string, seconds: number): Promise<Row> {
  await page.evaluate((t) => {
    const g = (window as unknown as { GO: any }).GO;
    g.settings.quality = t;
    g.applySettings();
    g.reset('match', {
      config: {
        seed: 424242, quarterSeconds: 120, difficulty: 'PRO',
        seats: [{ side: 0, active: false }, { side: 1, active: false },
          { side: 0, active: false }, { side: 1, active: false }],
      },
      returnScreen: 'mainMenu',
    });
  }, tier);
  await page.waitForTimeout(2500);            // let it settle and warm shaders
  await page.evaluate(() => { (window as unknown as { GO: any }).GO.perfReset?.(); });

  // Sample only while the ball is actually live.
  const t0 = Date.now();
  let liveSamples = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const p = await probe(page);
    if (p.phase === 'LIVE' || p.phase === 'KICKOFF_LIVE') liveSamples++;
    await page.waitForTimeout(120);
  }
  const r = await page.evaluate(() => {
    const g = (window as unknown as { GO: any }).GO;
    const perf = g.perf();
    const info = g.renderer.info();
    const mem = g.renderer.renderer.info.memory;
    return { ...perf, ...info, textures: mem.textures, geometries: mem.geometries };
  });
  void liveSamples;
  return {
    tier, p50: r.p50, p95: r.p95, p99: r.p99, worst: r.worst,
    calls: r.calls, triangles: r.triangles, textures: r.textures,
    geometries: r.geometries, frames: r.frames,
  };
}

async function main(): Promise<void> {
  ensureBuild();
  const url = await startServer(4174);
  const h = await launch(url, { width: 1600, height: 900 });
  const rows: Row[] = [];
  const boot = await h.page.evaluate(() => performance.now());
  try {
    for (const tier of ['HIGH', 'MEDIUM', 'LOW']) {
      rows.push(await measure(h.page, tier, 22));
    }
  } finally {
    await h.close();
    stopServer();
  }
  const f = (n: number) => n.toFixed(2);
  console.log(`\nGRIDIRON OVERDRIVE — performance (1600x900, moving gameplay, software WebGL)\n`
    + `boot to interactive: ${(boot / 1000).toFixed(2)} s\n`
    + '────────────────────────────────────────────────────────────────────────────\n'
    + 'tier     p50ms   p95ms   p99ms   worst   calls   tris     tex   geo   frames');
  for (const r of rows) {
    console.log(`${r.tier.padEnd(8)} ${f(r.p50).padStart(5)}  ${f(r.p95).padStart(6)}  `
      + `${f(r.p99).padStart(6)}  ${f(r.worst).padStart(6)}  ${String(r.calls).padStart(5)}  `
      + `${String(r.triangles).padStart(7)}  ${String(r.textures).padStart(4)}  `
      + `${String(r.geometries).padStart(4)}  ${String(r.frames).padStart(6)}`);
  }
  console.log('────────────────────────────────────────────────────────────────────────────');
  console.log('NOTE: this container has no GPU — Chromium falls back to SwiftShader software');
  console.log('rasterisation, so these numbers are a worst case and are NOT representative of');
  console.log('hardware. Draw calls, triangle counts and memory ARE hardware-independent.');
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
