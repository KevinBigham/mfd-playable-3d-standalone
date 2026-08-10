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

async function measure(
  page: import('playwright').Page, tier: string, seconds: number, stadium: string | null,
): Promise<Row> {
  await page.evaluate(({ t, stadiumId }) => {
    const g = (window as unknown as { GO: any }).GO;
    g.settings.quality = t;
    g.settings.autoQuality = false;
    g.settings.dynamicResolution = false;
    g.applySettings();
    g.reset('match', {
      config: {
        seed: 424242, quarterSeconds: 120, difficulty: 'PRO',
        ...(stadiumId ? { stadium: stadiumId } : {}),
        seats: [{ side: 0, active: false }, { side: 1, active: false },
          { side: 0, active: false }, { side: 1, active: false }],
      },
      returnScreen: 'mainMenu',
    });
  }, { t: tier, stadiumId: stadium });
  await page.waitForTimeout(2500);            // let it settle and warm shaders
  const ready = await page.evaluate(() => {
    const g = (window as unknown as { GO: any }).GO;
    // SwiftShader at 1600x900 can render setup slowly enough that a wall-clock warmup never
    // reaches moving football. Advance only the pre-live setup with the same fixed simulation
    // tick and renderer sync used by Game.frame, then return control to the normal rAF loop for
    // the actual measurement window.
    g.stop();
    let ticks = 0;
    while (ticks++ < 12000 && g.match
      && g.match.state.phase !== 'LIVE' && g.match.state.phase !== 'KICKOFF_LIVE') {
      g.match.tick();
      g.renderer.sync(g.match.world, g.match.state, 1, 1 / 60, false);
    }
    const phase = g.match?.state.phase ?? 'NONE';
    g.start();
    return { phase, ticks };
  });
  if (ready.phase !== 'LIVE' && ready.phase !== 'KICKOFF_LIVE') {
    throw new Error(`${tier} could not reach live play during deterministic warmup (${ready.phase}, ${ready.ticks} ticks)`);
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as unknown as { GO: any }).GO.perfReset?.(); });

  // Sample only while the ball is actually live.
  const t0 = Date.now();
  let liveSamples = 0;
  let measuredFrames = 0;
  const minimumMs = seconds * 1000;
  const maximumMs = Math.max(90000, minimumMs * 4);
  while (Date.now() - t0 < minimumMs || measuredFrames < 60) {
    if (Date.now() - t0 > maximumMs) {
      throw new Error(`${tier} produced only ${measuredFrames} frames in ${maximumMs / 1000}s`);
    }
    const p = await probe(page);
    if (p.phase === 'LIVE' || p.phase === 'KICKOFF_LIVE') {
      liveSamples++;
    } else {
      // A play can end well before a software-rendered sample window. Advance only staging with
      // fixed simulation ticks, then resume rAF so every timed frame still depicts moving play.
      const resumed = await page.evaluate(() => {
        const g = (window as unknown as { GO: any }).GO;
        g.stop();
        let ticks = 0;
        while (ticks++ < 12000 && g.match
          && g.match.state.phase !== 'LIVE' && g.match.state.phase !== 'KICKOFF_LIVE') {
          g.match.tick();
          g.renderer.sync(g.match.world, g.match.state, 1, 1 / 60, false);
        }
        const phase = g.match?.state.phase ?? 'NONE';
        g.start();
        return phase;
      });
      if (resumed !== 'LIVE' && resumed !== 'KICKOFF_LIVE') {
        throw new Error(`${tier} could not resume live play during measurement (${resumed})`);
      }
    }
    await page.waitForTimeout(120);
    measuredFrames = await page.evaluate(() => (window as unknown as { GO: any }).GO.perf().frames);
  }
  const r = await page.evaluate(() => {
    const g = (window as unknown as { GO: any }).GO;
    const perf = g.perf();
    const info = g.renderer.info();
    const mem = g.renderer.renderer.info.memory;
    return { ...perf, ...info, textures: mem.textures, geometries: mem.geometries };
  });
  if (liveSamples === 0) {
    throw new Error(`${tier} performance window contained no live-play samples`);
  }
  return {
    tier, p50: r.p50, p95: r.p95, p99: r.p99, worst: r.worst,
    calls: r.calls, triangles: r.triangles, textures: r.textures,
    geometries: r.geometries, frames: r.frames,
  };
}

async function main(): Promise<void> {
  const stadiumFlag = process.argv.indexOf('--stadium');
  const stadium = stadiumFlag >= 0 ? process.argv[stadiumFlag + 1] : null;
  if (stadiumFlag >= 0 && !stadium) throw new Error('--stadium requires an existing stadium id');
  ensureBuild();
  const url = await startServer(4174);
  const h = await launch(url, { width: 1600, height: 900 });
  const rows: Row[] = [];
  const boot = await h.page.evaluate(() => performance.now());
  try {
    for (const tier of ['HIGH', 'MEDIUM', 'LOW']) {
      rows.push(await measure(h.page, tier, 22, stadium));
    }
  } finally {
    await h.close();
    stopServer();
  }
  const f = (n: number) => n.toFixed(2);
  console.log(`\nGRIDIRON OVERDRIVE — performance (1600x900, moving gameplay, software WebGL${stadium ? `, ${stadium}` : ''})\n`
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
