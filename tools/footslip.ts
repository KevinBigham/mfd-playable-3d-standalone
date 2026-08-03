#!/usr/bin/env tsx
/**
 * Measure whether planted feet actually grip the turf. `npm run footslip`
 *
 * "The feet skate" is the single most common way a procedural run cycle fails, and it is not
 * something a still frame shows. This drives a real match, and every tick takes the lowest point
 * of each running athlete's shoe. When that point is on the ground on two consecutive ticks, the
 * distance it travelled between them is slip — the foot moving against turf it is supposed to be
 * gripping. A perfect cycle reports zero; anything above a yard a second reads as skating.
 *
 * The number to compare it against is the athlete's own ground speed, printed alongside: slip as
 * a fraction of that is how wrong the cycle is.
 */
import { startServer, stopServer, launch, ensureBuild } from './browser.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const TICKS = Number(arg('ticks', '2400'));

interface Report {
  samples: number;
  meanSlip: number;
  p50Slip: number;
  p95Slip: number;
  worstSlip: number;
  meanGround: number;
  overOne: number;
  contactShare: number;
  straightN: number;
  straightMean: number;
  straightP95: number;
}

async function main(): Promise<void> {
  ensureBuild();
  const url = await startServer(4185);
  const h = await launch(url, { width: 640, height: 400 });
  const { page } = h;
  try {
    await page.evaluate(() => {
      (window as any).GO.reset('match', {
        config: {
          seed: 4242, quarterSeconds: 300, difficulty: 'PRO',
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
    });
    await page.waitForTimeout(2600);

    const rep = await page.evaluate(`(function(ticks){
      var g = window.GO, m = g.match, R = g.renderer;
      var slips = [], grounds = [], straight = [], planted = 0, floating = 0;
      var prev = {};                          // athleteId -> {m:[matrixWorld], low:[y,y]}
      // A standing athlete's sole rests here, and it is the same for every athlete: the rig
      // puts the ankle at exactly the sole thickness, so the cleat sits ON the turf and this
      // line is zero. npm run anthro asserts that, which is what lets it be a constant here.
      // A foot is only counted as planted when it is within a centimetre of the line on BOTH
      // ticks of the pair — otherwise the two frames either side of a toe-off get counted as a
      // plant, and they are the fastest-moving frames in the cycle.
      //
      // It used to read -0.028, the rest height of a rig whose ankle landed 0.08 up and whose
      // legs were 31% of him. Left alone through the proportion pass it stopped selecting
      // planted feet at all and started selecting feet digging in at push-off, which reported
      // as an 18% slip regression that had not happened.
      var REST = 0, TOL = 0.012;
      // Sole samples in foot-bone space, heel to toe, and how far the sole sits below the ankle.
      var SAMPLES = [-0.1325, -0.05, 0.06, 0.16, 0.2525];
      var DROP = -0.108;
      function xf(e, z, out) {
        out.x = e[4] * DROP + e[8] * z + e[12];
        out.y = e[5] * DROP + e[9] * z + e[13];
        out.z = e[6] * DROP + e[10] * z + e[14];
        return out;
      }
      var A = {x:0,y:0,z:0}, B = {x:0,y:0,z:0};
      for (var i = 0; i < ticks; i++) {
        m.tick();
        R.sync(m.world, m.state, 1, 1/60, false);
        var w = m.world;
        for (var a = 0; a < w.athletes.length; a++) {
          var at = w.athletes[a];
          var st = at.anim.state;
          var sp = at.anim.ground;
          if ((st !== 'RUN' && st !== 'SPRINT') || sp < 5) { delete prev[at.id]; continue; }
          var rig = R.rigs[at.side].get(at.def.number);
          if (!rig) { delete prev[at.id]; continue; }
          rig.root.updateMatrixWorld(true);
          var feet = [rig.bones.footL.matrixWorld.elements,
                      rig.bones.footR.matrixWorld.elements];
          var p = prev[at.id];
          // A runner has at most one foot planted at a time, so the question is not "is this
          // foot down" — a classifier for that mislabels the ends of the swing and swamps the
          // result — but "is SOME foot holding the turf". Take, per foot, the displacement of
          // whichever point of its own sole is lowest, and keep the smaller of the two.
          var bestSlip = Infinity, down = false, lows = [0, 0];
          for (var f = 0; f < 2; f++) {
            var low = Infinity, lowZ = 0;
            for (var k = 0; k < SAMPLES.length; k++) {
              xf(feet[f], SAMPLES[k], A);
              if (A.y < low) { low = A.y; lowZ = SAMPLES[k]; }
            }
            lows[f] = low - at.y;
            if (!p) continue;
            var onNow = lows[f] < REST + TOL;
            var onThen = p.low[f] < REST + TOL;
            if (!onNow || !onThen) continue;
            xf(feet[f], lowZ, A);
            xf(p.m[f], lowZ, B);
            var d = Math.hypot(A.x - B.x, A.z - B.z) * 60;
            if (d < bestSlip) { bestSlip = d; down = true; }
          }
          var had = !!p;
          prev[at.id] = { m: [feet[0].slice(), feet[1].slice()], low: [lows[0], lows[1]] };
          if (!had) continue;
          if (!down) { floating++; continue; }
          planted++;
          slips.push(bestSlip);
          grounds.push(sp);
          // Split out the athletes who are simply running forwards. The stride is solved in the
          // body's own frame, so a player cutting hard — travelling in one direction while facing
          // another — has feet that cannot both point where he is looking and travel where he is
          // going. That is a separate, honest limitation from whether the cycle itself holds.
          var vAng = Math.atan2(at.vx, at.vz) - at.facing;
          while (vAng > Math.PI) vAng -= 2 * Math.PI;
          while (vAng < -Math.PI) vAng += 2 * Math.PI;
          var yawLag = rig.root.rotation.y - at.facing;
          while (yawLag > Math.PI) yawLag -= 2 * Math.PI;
          while (yawLag < -Math.PI) yawLag += 2 * Math.PI;
          if (Math.abs(vAng) < 0.05 && Math.abs(yawLag) < 0.02) straight.push(bestSlip);
        }
      }
      slips.sort(function(x, y){ return x - y; });
      straight.sort(function(x, y){ return x - y; });
      var ssum = 0;
      for (var t2 = 0; t2 < straight.length; t2++) ssum += straight[t2];
      var sum = 0, over = 0;
      for (var s = 0; s < slips.length; s++) { sum += slips[s]; if (slips[s] > 1) over++; }
      var gs = 0;
      for (var q = 0; q < grounds.length; q++) gs += grounds[q];
      return {
        samples: slips.length,
        meanSlip: slips.length ? sum / slips.length : 0,
        p50Slip: slips.length ? slips[Math.floor(slips.length * 0.50)] : 0,
        p95Slip: slips.length ? slips[Math.floor(slips.length * 0.95)] : 0,
        worstSlip: slips.length ? slips[slips.length - 1] : 0,
        meanGround: grounds.length ? gs / grounds.length : 0,
        overOne: slips.length ? over / slips.length : 0,
        contactShare: (planted + floating) ? planted / (planted + floating) : 0,
        straightN: straight.length,
        straightMean: straight.length ? ssum / straight.length : 0,
        straightP95: straight.length ? straight[Math.floor(straight.length * 0.95)] : 0,
      };
    })(${TICKS})`) as Report;

    console.log('\nGRIDIRON OVERDRIVE — planted-foot slip'
      + '\n──────────────────────────────────────────────────────────────');
    console.log(`samples            ${rep.samples} tick-pairs with the same foot down`);
    console.log(`ground speed       ${rep.meanGround.toFixed(2)} yd/s mean while running`);
    console.log(`slip               ${rep.meanSlip.toFixed(3)} yd/s mean   ${rep.p50Slip.toFixed(3)} median`
      + `   ${rep.p95Slip.toFixed(3)} p95   ${rep.worstSlip.toFixed(2)} worst`);
    console.log(`                   ${(100 * rep.meanSlip / Math.max(0.01, rep.meanGround)).toFixed(1)}%`
      + ` of ground speed;  over 1 yd/s on ${(100 * rep.overOne).toFixed(1)}% of samples`);
    console.log(`running straight   ${rep.straightMean.toFixed(3)} yd/s mean   ${rep.straightP95.toFixed(3)} p95`
      + `   (${rep.straightN} samples, facing within 3° of travel)`);
    console.log(`grounded           ${(100 * rep.contactShare).toFixed(1)}% of running ticks have a foot on the turf`);
    console.log('──────────────────────────────────────────────────────────────');
    if (h.errors.length) console.log('console errors:', JSON.stringify(h.errors.slice(0, 3)));
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
