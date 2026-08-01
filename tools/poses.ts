#!/usr/bin/env tsx
/**
 * Contact sheet of every animation state. `npm run poses`
 *
 * The run cycle was not the only broken pose — it was the one visible from the broadcast camera.
 * A player spends the rest of the game watching athletes set, block, throw, dive and get up, and
 * at forty pixels tall a wrong sign in any of those reads as "the animation is awkward" without
 * ever pointing at which one. This parks a camera on a single athlete, forces each state in turn
 * and writes one frame per state so all nineteen can be looked at side by side.
 */
import { startServer, stopServer, launch, ensureBuild } from './browser.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const VIEW = arg('view', 'threequarter');    // side | front | threequarter
const OUT = 'docs/captures';

/** state, stride phase, seconds into a one-shot, gait speed. */
const STATES: [string, number, number, number][] = [
  ['IDLE', 0.25, 0.4, 0.02],
  ['SET', 0.25, 0.4, 0.0],
  ['RUN', 0.10, 0.4, 0.45],
  ['SPRINT', 0.10, 0.4, 0.95],
  ['BACKPEDAL', 0.20, 0.4, 0.45],
  ['THROW', 0.0, 0.16, 0.20],
  ['CATCH', 0.0, 0.10, 0.30],
  ['JUMP', 0.0, 0.30, 0.30],
  ['HURDLE', 0.0, 0.40, 0.70],
  ['DIVE', 0.0, 0.35, 0.70],
  ['SPIN', 0.30, 0.20, 0.55],
  ['STIFFARM', 0.0, 0.20, 0.60],
  ['TACKLE', 0.0, 0.22, 0.60],
  ['TACKLED', 0.0, 0.45, 0.10],
  ['GETUP', 0.0, 0.35, 0.05],
  ['STUMBLE', 0.20, 0.30, 0.25],
  ['BLOCK', 0.30, 0.30, 0.10],
  ['KICK', 0.0, 0.28, 0.20],
  ['CELEBRATE', 0.25, 0.40, 0.05],
];

async function main(): Promise<void> {
  ensureBuild();
  mkdirSync(OUT, { recursive: true });
  const url = await startServer(4184);
  const h = await launch(url, { width: 300, height: 430 });
  const { page } = h;
  const shots: { file: string; label: string }[] = [];
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

    // One tick into a live play, then everybody but the subject is parked off the field so the
    // frame contains exactly one athlete.
    await page.evaluate(`(function(){
      var m = window.GO.match;
      var t = 0;
      while (t < 20000 && m.state.phase !== 'LIVE') { m.tick(); t++; }
      var w = m.world;
      window.__subj = w.athletes[0].id;
      for (var i = 0; i < w.athletes.length; i++) {
        var a = w.athletes[i];
        if (a.id === window.__subj) { a.x = 0; a.z = 50; a.y = 0; a.facing = 0; }
        else { a.x = 300; a.z = 300; }
      }
    })()`);

    for (const [state, phase, t, speed] of STATES) {
      const data = await page.evaluate(`(function(state, phase, tSec, speed, view){
        var g = window.GO, m = g.match, w = m.world;
        var a = w.athletes[window.__subj];
        a.x = 0; a.z = 50; a.y = 0; a.facing = 0; a.vx = 0; a.vz = 0;
        a.anim.state = state; a.anim.phase = phase; a.anim.prevPhase = phase;
        a.anim.speed01 = speed; a.anim.accelFwd = speed > 0.5 ? 3 : 0;
        a.anim.ground = speed * 11;
        a.onFire = false;
        // First sync registers the state change and zeroes the pose clock; the second advances
        // it to the requested instant and finishes the cross-fade.
        g.renderer.sync(w, m.state, 1, 0, false);
        g.renderer.sync(w, m.state, 1, tSec, false);
        var cam = g.renderer.gameCamera.camera;
        var d = 8.0;
        var px, pz;
        if (view === 'front') { px = 0; pz = 50 + d; }
        else if (view === 'side') { px = d; pz = 50; }
        else { px = d * 0.72; pz = 50 + d * 0.72; }
        cam.fov = 22;
        cam.position.set(px, 1.55, pz);
        cam.lookAt(0, 1.00, 50);
        cam.updateProjectionMatrix();
        g.renderer.render();
        return document.querySelector('canvas').toDataURL('image/png');
      })(${JSON.stringify(state)}, ${phase}, ${t}, ${speed}, ${JSON.stringify(VIEW)})`) as string;
      const file = `${OUT}/.pose-${state}.png`;
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      shots.push({ file, label: state });
    }
    console.log(`${shots.length} poses captured`);
    writeFileSync(`${OUT}/.pose-manifest.json`, JSON.stringify({ shots, view: VIEW }));
    if (h.errors.length) console.log('console errors:', JSON.stringify(h.errors.slice(0, 3)));
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
