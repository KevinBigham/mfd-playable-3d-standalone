import * as THREE from 'three';
import { TEAMS } from '../src/data/teams.ts';
const T = TEAMS[0];
// Replicate athleteRig.ts:130-234 math exactly, no DOM needed.
for (const p of [T.roster[0], T.roster[3], T.roster[6]]) {
  const build = Math.min(1,Math.max(0,p.build));
  const bulk = 0.86 + (1.32-0.86)*build;
  const height = 1.95 + (2.14-1.95)*(build*0.6 + p.ratings.power/300);
  const hipY=height*0.50, chestY=height*0.70, headY=height*0.90;
  const shoulderW=(0.52+(0.72-0.52)*build)*bulk;
  const chestW_y = chestY;                        // chest bone world y
  const headW_y  = chestY + 0.36 + (headY-chestY-0.30); // neck then head
  const pads   = {c: chestW_y+0.46, h:0.30, w: shoulderW*2.32, d:0.52*bulk};
  const trim   = {c: chestW_y+0.60, h:0.10, w: shoulderW*2.32*0.92, d:0.54*bulk};
  const torso  = {c: chestW_y+0.18, h:0.62};
  const head   = {c: headW_y+0.06, r:0.30, rx:0.30*1.06, rz:0.30*1.12};
  const mask   = {y: headW_y-0.02, z:0.24};
  console.log(`\n#${p.number} ${p.pos} build=${build.toFixed(2)} height=${height.toFixed(3)}yd shoulderW*2.32=${pads.w.toFixed(3)}yd`);
  console.log(`  head sphere   y ${(head.c-head.r).toFixed(3)} .. ${(head.c+head.r).toFixed(3)}  centre ${head.c.toFixed(3)}  halfwidth ${head.rx.toFixed(3)}`);
  console.log(`  shoulder pads y ${(pads.c-pads.h/2).toFixed(3)} .. ${(pads.c+pads.h/2).toFixed(3)}  halfwidth ${(pads.w/2).toFixed(3)} halfdepth ${(pads.d/2).toFixed(3)}`);
  console.log(`  accent trim   y ${(trim.c-trim.h/2).toFixed(3)} .. ${(trim.c+trim.h/2).toFixed(3)}  halfwidth ${(trim.w/2).toFixed(3)}`);
  console.log(`  torso top     y ${(torso.c+torso.h/2).toFixed(3)}`);
  // overlap tests
  const padOverlap = Math.min(pads.c+pads.h/2, head.c+head.r) - Math.max(pads.c-pads.h/2, head.c-head.r);
  const trimOverlap= Math.min(trim.c+trim.h/2, head.c+head.r) - Math.max(trim.c-trim.h/2, head.c-head.r);
  // head half-width at the trim's centre height
  const dy=(trim.c-head.c)/head.r; const hw = Math.abs(dy)<1 ? head.rx*Math.sqrt(1-dy*dy) : 0;
  console.log(`  >> pads intersect head over ${padOverlap.toFixed(3)}yd of head height (head is ${(2*head.r).toFixed(2)}yd tall) = ${(100*padOverlap/(2*head.r)).toFixed(0)}%`);
  console.log(`  >> accent trim passes THROUGH head: overlap ${trimOverlap.toFixed(3)}yd, head halfwidth there ${hw.toFixed(3)}yd`);
  console.log(`  >> facemask at y=${mask.y.toFixed(3)} z=${mask.z.toFixed(2)}; pads occupy z -${(pads.d/2).toFixed(2)}..+${(pads.d/2).toFixed(2)}, y ${(pads.c-pads.h/2).toFixed(3)}..${(pads.c+pads.h/2).toFixed(3)} -> mask inside pad volume: ${mask.z < pads.d/2 && mask.y > pads.c-pads.h/2 && mask.y < pads.c+pads.h/2}`);
  console.log(`  >> visible neck gap (pads bottom .. head bottom): ${((head.c-head.r)-(pads.c-pads.h/2)).toFixed(3)}yd`);
  console.log(`  >> shoulder width / height ratio: ${(pads.w/height).toFixed(2)}`);
}
