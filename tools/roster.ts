#!/usr/bin/env tsx
/**
 * Contact sheet of one athlete per position. `npm run roster`
 *
 * `npm run anthro` asserts that a receiver and a tackle are different shapes; this is how you
 * check that the difference is one a person can see. Same camera, same pose, same distance,
 * seven positions in a row — if they are not telling apart by silhouette alone, the physique
 * axes are not doing their job whatever the ratios say.
 */
import { startServer, stopServer, launch, ensureBuild } from './browser.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'docs/captures';
const POSITIONS = ['WR', 'CB', 'QB', 'RB', 'LB', 'TE', 'DL', 'OL'];

async function main(): Promise<void> {
  ensureBuild();
  mkdirSync(OUT, { recursive: true });
  const url = await startServer(4186);
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
    await page.evaluate(`(function(){
      var m = window.GO.match, t = 0;
      while (t < 20000 && m.state.phase !== 'LIVE') { m.tick(); t++; }
    })()`);

    for (const pos of POSITIONS) {
      const data = await page.evaluate(`(function(pos){
        var g = window.GO, m = g.match, w = m.world;
        // Only seven a side are on the field, so the offence supplies QB/WR/RB/TE/OL and the
        // defence supplies CB/S/LB/DL. Search both.
        var subj = -1;
        for (var i = 0; i < w.athletes.length; i++) {
          if (w.athletes[i].def.pos === pos) { subj = i; break; }
        }
        if (subj < 0) return null;
        for (var j = 0; j < w.athletes.length; j++) {
          var a = w.athletes[j];
          if (j === subj) { a.x = 0; a.z = 50; a.y = 0; a.facing = 2.44; a.vx = 0; a.vz = 0; }
          else { a.x = 300; a.z = 300; }
        }
        var s = w.athletes[subj];
        s.hasBall = false;
        s.anim.state = 'IDLE'; s.anim.phase = 0.25; s.anim.prevPhase = 0.25;
        s.anim.speed01 = 0.02; s.anim.accelFwd = 0; s.anim.ground = 0;
        s.onFire = false;
        g.renderer.sync(w, m.state, 1, 0, false);
        g.renderer.sync(w, m.state, 1, 0.4, false);
        var cam = g.renderer.gameCamera.camera;
        cam.fov = 22;
        cam.position.set(0, 1.10, 57.8);
        cam.lookAt(0, 1.04, 50);
        cam.updateProjectionMatrix();
        g.renderer.render();
        return { png: document.querySelector('canvas').toDataURL('image/png'),
          info: pos + ' #' + s.def.number + ' build=' + s.def.build.toFixed(2) };
      })(${JSON.stringify(pos)})`) as { png: string; info: string } | null;
      if (!data) { console.log(`  ${pos}: not on this roster`); continue; }
      const file = `${OUT}/.roster-${pos}.png`;
      writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64'));
      shots.push({ file, label: pos });
      console.log(`  ${data.info}`);
    }
    writeFileSync(`${OUT}/.roster-manifest.json`, JSON.stringify({ shots }));
    console.log(`${shots.length} positions captured`);
    if (h.errors.length) console.log('console errors:', JSON.stringify(h.errors.slice(0, 3)));
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
