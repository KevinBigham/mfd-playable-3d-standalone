#!/usr/bin/env tsx
/**
 * Contact sheet of one athlete's stride. `npm run gait`
 *
 * A run cycle cannot be judged from a wide gameplay shot — the athlete is forty pixels tall and
 * every frame looks the same. This parks a camera beside a sprinting athlete, steps the match one
 * tick at a time, and writes a strip of frames across a full stride so the cycle can actually be
 * looked at: where the feet are, whether they plant, whether the knees fold, whether the arms
 * oppose the legs.
 */
import { startServer, stopServer, launch, ensureBuild } from './browser.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const FRAMES = Number(arg('frames', '10'));
const STEP = Number(arg('step', '3'));        // ticks between frames
const NAME = arg('name', 'gait');
const SIDE = arg('view', 'side');             // side | front | threequarter
const OUT = 'docs/captures';

async function main(): Promise<void> {
  ensureBuild();
  mkdirSync(OUT, { recursive: true });
  const url = await startServer(4183);
  const h = await launch(url, { width: 520, height: 640 });
  const { page } = h;
  try {
    await page.evaluate(() => {
      (window as any).GO.reset('match', {
        config: {
          seed: 20260101, quarterSeconds: 120, difficulty: 'ALLSTAR',
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
    });
    await page.waitForTimeout(2600);

    const shots: string[] = [];
    for (let i = 0; i < FRAMES; i++) {
      // Evaluated as source text: the bundler's keep-names transform rewrites named function
      // bindings into calls to a helper that does not exist inside the page.
      const data = await page.evaluate(`(function(step, first, view){
        var g = window.GO, m = g.match;
        function pick() {
          var best = -1, bestSpeed = 0;
          for (var i = 0; i < m.world.athletes.length; i++) {
            var a = m.world.athletes[i];
            if (a.anim.state !== 'RUN' && a.anim.state !== 'SPRINT') continue;
            var sp = Math.hypot(a.vx, a.vz);
            if (sp > 7 && sp > bestSpeed) { bestSpeed = sp; best = a.id; }
          }
          return best;
        }
        if (first) {
          var t = 0;
          while (t < 20000 && (m.state.phase !== 'LIVE' || pick() < 0)) { m.tick(); t++; }
          window.__gaitId = pick();
        } else {
          for (var k = 0; k < step; k++) m.tick();
        }
        var a = m.world.athletes[window.__gaitId];
        g.renderer.sync(m.world, m.state, 1, 1/60, false);
        var cam = g.renderer.gameCamera.camera;
        var fx = Math.sin(a.facing), fz = Math.cos(a.facing);
        var rx = Math.cos(a.facing), rz = -Math.sin(a.facing);
        var d = 7.6, px, pz;
        if (view === 'front') { px = a.x + fx * d; pz = a.z + fz * d; }
        else if (view === 'threequarter') { px = a.x + (fx*0.7 + rx*0.7) * d; pz = a.z + (fz*0.7 + rz*0.7) * d; }
        else { px = a.x + rx * d; pz = a.z + rz * d; }
        cam.fov = 24;
        cam.position.set(px, 1.30, pz);
        cam.lookAt(a.x, 0.95, a.z);
        cam.updateProjectionMatrix();
        g.renderer.render();
        var c = document.querySelector('canvas');
        return { png: c.toDataURL('image/png'),
          info: a.def.pos + ' spd=' + Math.hypot(a.vx, a.vz).toFixed(1)
            + ' state=' + a.anim.state + ' phase=' + a.anim.phase.toFixed(2) };
      })(${STEP}, ${i === 0}, ${JSON.stringify(SIDE)})`) as { png: string; info: string };
      const file = `${OUT}/.gait-${i}.png`;
      writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64'));
      shots.push(file);
      if (i === 0 || i === FRAMES - 1) console.log(`  frame ${i}: ${data.info}`);
    }
    console.log(`${shots.length} frames captured; tiling…`);
    writeFileSync(`${OUT}/.gait-manifest.json`, JSON.stringify({ shots, name: NAME, view: SIDE }));
    console.log('console errors:', JSON.stringify(h.errors.slice(0, 3)));
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
