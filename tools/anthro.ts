#!/usr/bin/env tsx
/**
 * Measure the athletes. `npm run anthro`
 *
 * "The players should look more athletic" is not a testable statement, but the reason they did
 * not is. Before this pass every athlete rendered between 7ft 2 and 7ft 5, carried an
 * eighteen-inch head that was byte-identical on all sixteen rosters, and stood 4.7 heads tall
 * with legs making up 31% of him against a real athlete's 47%. None of that was visible in the
 * code: `height` said 2.01 yards and nothing consumed the difference.
 *
 * So this builds real rigs — the same `buildAthleteRig` the game calls, at HIGH detail — walks
 * every vertex through the bone it is skinned to, and measures the body that actually comes out
 * the other side. It asserts proportions rather than pixels, which means it fails when somebody
 * adds a riser to a bone offset and passes when somebody restyles a helmet.
 *
 * It needs no GPU: three.js builds geometry and bone matrices perfectly well in Node, and the
 * material never has to compile.
 */
import * as THREE from 'three';
import { buildAthleteRig, PROP } from '../src/render/athleteRig.ts';
import { SceneRegistry, QUALITY_PRESETS } from '../src/render/registry.ts';
import { makeRoster, rosterRoles } from '../src/data/names.ts';
import { TEAMS } from '../src/data/teams.ts';
import { Rng } from '../src/core/rng.ts';
import type { PlayerDef } from '../src/core/types.ts';

const YD_TO_IN = 36;

interface Measured {
  pos: string;
  build: number;
  crown: number;
  sole: number;
  chin: number;
  headUnit: number;
  headsTall: number;
  hip: number;
  knee: number;
  shoulder: number;
  neck: number;
  padSpan: number;
  waist: number;
  depth: number;
  legFrac: number;
  over: number;
  tris: number;
}

let bindErr = 0;
let weightErr = 0;
const tierTris: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };

/**
 * Walk the merged buffer and measure the body that comes out.
 *
 * The GPU computes each vertex as `Σ wᵢ · (boneᵢ.matrixWorld · boneInverseᵢ) · p`. The builder
 * leaves `p` in rest space and the skeleton holds inverses captured from that same rest pose, so
 * every one of those bracketed terms is the identity at rest and the vertex renders exactly at
 * `p` whatever its weights are. `checkBind` asserts that rather than assuming it — a stale bind
 * inverse would silently double-transform the whole athlete, which is precisely what happened
 * the first time this file met the smooth-skinning rewrite.
 */
function measure(def: PlayerDef, role: string): Measured {
  const reg = new SceneRegistry(new THREE.Scene());
  const rig = buildAthleteRig(reg, def, TEAMS[0].colors, QUALITY_PRESETS.HIGH, false);
  // Per-athlete triangle cost at each tier. This is the hardware-independent half of the perf
  // budget, and unlike `npm run perf` it does not move with whatever the crowd and the particle
  // system happen to be doing in the frame that got sampled.
  for (const q of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    const r2 = buildAthleteRig(reg, def, TEAMS[0].colors, QUALITY_PRESETS[q], false);
    const g2 = r2.mesh.geometry;
    tierTris[q] = Math.max(tierTris[q], (g2.index ? g2.index.count : g2.attributes.position.count) / 3);
    r2.dispose();
  }
  rig.root.updateMatrixWorld(true);

  const geo = rig.mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute;
  const surf = geo.attributes.aSurf as THREE.BufferAttribute;
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  const boneList = rig.mesh.skeleton.bones;
  const inv = rig.mesh.skeleton.boneInverses;
  const v = new THREE.Vector3();
  const bm = new THREE.Matrix4();

  // Every bone's rest skinning matrix must be the identity, or the athlete is being transformed
  // twice and every number below is fiction.
  for (let b = 0; b < boneList.length; b++) {
    bm.multiplyMatrices(boneList[b].matrixWorld, inv[b]);
    let err = 0;
    for (let e = 0; e < 16; e++) err = Math.max(err, Math.abs(bm.elements[e] - (e % 5 === 0 ? 1 : 0)));
    if (err > 1e-5) bindErr = Math.max(bindErr, err);
  }
  // And every vertex's influences must sum to one, or the merge dropped a weight and the
  // blended vertices are being pulled toward the origin.
  let minW = Infinity;
  for (let i = 0; i < pos.count; i++) {
    minW = Math.min(minW, sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i));
  }
  weightErr = Math.max(weightErr, Math.abs(1 - minW));

  // Crown and chin are read off the painted SHELL only. The raised centre stripe rides above it
  // and the facemask cage hangs below, and neither is how tall a man is — but `over` still
  // watches the gap, so nobody can grow the athletes by bolting an ornament to the helmet.
  let crown = -Infinity, sole = Infinity, chin = Infinity, padSpan = 0, top = -Infinity;
  // Waist and chest depth, measured in a thin slice so a receiver's V and a tackle's barrel are
  // numbers rather than opinions.
  let waist = 0, depth = 0;
  const chestBone = boneList.findIndex((b) => b.name === 'chest');
  const hipY = boneList[boneList.findIndex((b) => b.name === 'hips')].matrixWorld.elements[13];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y > top) top = v.y;
    if (v.y < sole) sole = v.y;
    if (Math.abs(surf.getX(i) - 0.19) < 1e-4) {          // SURF.HELMET
      if (v.y > crown) crown = v.y;
      if (v.y < chin) chin = v.y;
    }
    if (si.getX(i) === chestBone) {
      padSpan = Math.max(padSpan, Math.abs(v.x) * 2);
      const h = v.y - hipY;
      if (h > 0.10 && h < 0.18) waist = Math.max(waist, Math.abs(v.x) * 2);
      if (h > 0.34 && h < 0.44) depth = Math.max(depth, Math.abs(v.z) * 2);
    }
  }
  const tris = (geo.index ? geo.index.count : pos.count) / 3;
  rig.dispose();

  const stature = crown - sole;
  const over = (top - crown) / stature;
  const boneY = (n: string): number => boneList[boneList.findIndex((b) => b.name === n)].matrixWorld.elements[13];
  const hip = boneY('hips'), knee = boneY('kneeR');
  const headUnit = crown - chin;
  return {
    pos: role,
    build: def.build,
    crown, sole, chin, headUnit,
    headsTall: stature / headUnit,
    hip: hip / stature,
    knee: knee / stature,
    shoulder: boneY('shoulderR') / stature,
    neck: boneY('neck') / stature,
    padSpan, waist, depth, over, tris,
    legFrac: (hip - (sole + 0.108)) / stature,
  };
}

function feet(yd: number): string {
  const inches = yd * YD_TO_IN;
  return `${Math.floor(inches / 12)}ft ${Math.round(inches % 12)}`;
}

function main(): void {
  // One athlete per position off a real roster, so the numbers describe the athletes the game
  // actually fields rather than a synthetic best case.
  const roles = rosterRoles('BALANCED');
  const roster = makeRoster(TEAMS[0].id, 'BALANCED', new Rng(20260101), TEAMS[0].power);
  const want = ['WR', 'QB', 'RB', 'TE', 'LB', 'DL', 'OL'];
  const rows: Measured[] = [];
  for (const w of want) {
    const i = roles.indexOf(w as never);
    if (i >= 0) rows.push(measure(roster[i], w));
  }

  console.log('\nGRIDIRON OVERDRIVE — athlete anthropometry'
    + '\n──────────────────────────────────────────────────────────────────────────────');
  console.log('pos   build   stature        head    heads  hip/S  sho/S  leg/S   pads  waist  depth   tris');
  for (const r of rows) {
    const stature = r.crown - r.sole;
    console.log(
      `${r.pos.padEnd(5)} ${r.build.toFixed(2)}   ${stature.toFixed(3)} yd ${feet(stature).padStart(7)}`
      + `  ${(r.headUnit * YD_TO_IN).toFixed(1)}in  ${r.headsTall.toFixed(2)}`
      + `   ${r.hip.toFixed(3)}  ${r.shoulder.toFixed(3)}  ${r.legFrac.toFixed(3)}`
      + `  ${(r.padSpan * YD_TO_IN).toFixed(1)}  ${(r.waist * YD_TO_IN).toFixed(1)}   `
      + `${(r.depth * YD_TO_IN).toFixed(1)}  ${String(r.tris).padStart(5)}`);
  }
  console.log('\nreal athlete, helmeted                12.0in   6.40   0.520  0.800  0.480  24.0');
  console.log('before this pass       7ft 2–7ft 5   18.0in   4.69   0.385  0.759  0.310  44.0                 7450');
  console.log(`\ntriangles per athlete   HIGH ${tierTris.HIGH}   MEDIUM ${tierTris.MEDIUM}`
    + `   LOW ${tierTris.LOW}      (was 7450 / — / 835)`);
  console.log(`rest bind error ${bindErr.toExponential(1)}   min influence sum error ${weightErr.toExponential(1)}`);

  // Assertions. Ranges rather than exact values: `build` legitimately moves stature and breadth,
  // and a helmet restyle legitimately moves the head by a few per cent. What must not move is
  // the athlete stopping being a person shaped like a person.
  const fails: string[] = [];
  const check = (name: string, got: number, lo: number, hi: number): void => {
    if (!(got >= lo && got <= hi)) fails.push(`${name}: ${got.toFixed(3)} outside ${lo}..${hi}`);
  };
  for (const r of rows) {
    const stature = r.crown - r.sole;
    check(`${r.pos} stature`, stature, 2.00, 2.16);
    check(`${r.pos} heads tall`, r.headsTall, 5.85, 6.15);
    // Position-dependent now: a receiver is long in the leg and short in the trunk at the same
    // stature, a tackle the reverse. The band is what a real athlete's hip height spans.
    check(`${r.pos} hip/stature`, r.hip, 0.490, 0.555);
    check(`${r.pos} shoulder/stature`, r.shoulder, 0.788, 0.812);
    check(`${r.pos} leg/stature`, r.legFrac, 0.435, 0.505);
    check(`${r.pos} head/stature`, r.headUnit / stature, 0.160, 0.174);
    check(`${r.pos} pad span`, r.padSpan * YD_TO_IN, 19, 30);
    check(`${r.pos} nothing above the crown`, r.over, 0, 0.020);
    // A standing athlete's sole sits ON the turf. This is not cosmetic: `athletePose` drops the
    // pelvis onto exactly this height, so a rig whose sole is not at zero at rest makes every
    // pose in the game hover or sink by the same error.
    check(`${r.pos} sole at turf`, r.sole, -0.004, 0.004);
  }
  // The stature spread has to survive too: one number for everybody is how the old rig looked
  // like one toy at several scales.
  const spread = Math.max(...rows.map((r) => r.crown - r.sole)) - Math.min(...rows.map((r) => r.crown - r.sole));
  check('stature spread', spread, 0.05, 0.16);
  // Silhouette differentiation, asserted rather than eyeballed. A wide receiver and an offensive
  // tackle must not be the same figure at two scales — which is precisely what one uniform
  // `bulk` produced, and what these three ratios exist to prevent regressing to.
  const wr = rows.find((r) => r.pos === 'WR');
  const ol = rows.find((r) => r.pos === 'OL');
  if (wr && ol) {
    console.log(`\nV-taper  WR pads/waist ${(wr.padSpan / wr.waist).toFixed(2)}`
      + `   OL ${(ol.padSpan / ol.waist).toFixed(2)}`
      + `      leg/stature  WR ${wr.legFrac.toFixed(3)}   OL ${ol.legFrac.toFixed(3)}`
      + `      chest depth/stature  WR ${(wr.depth / (wr.crown - wr.sole)).toFixed(3)}`
      + `   OL ${(ol.depth / (ol.crown - ol.sole)).toFixed(3)}`);
    check('receiver is more V than a tackle', wr.padSpan / wr.waist - ol.padSpan / ol.waist, 0.10, 1.0);
    check('receiver is longer in the leg', wr.legFrac - ol.legFrac, 0.020, 0.10);
    // Against STATURE, not against the waist: a tackle's waist is wider too, so depth over
    // breadth would net the two axes out and report that nothing had changed.
    check('tackle is deeper through the chest',
      ol.depth / (ol.crown - ol.sole) - wr.depth / (wr.crown - wr.sole), 0.04, 0.20);
  }
  check('PROP head unit', PROP.crown - PROP.chin, 0.1666, 0.1667);
  check('rest bind is identity', bindErr, 0, 1e-5);
  check('influences sum to 1', weightErr, 0, 1e-5);
  // The loft is meant to be cheaper than the boxes it replaced. At HIGH it is, by a lot: a
  // rounded box is 192 triangles of no profile at all against 80 for a loft with a full one.
  check('triangles at HIGH', tierTris.HIGH, 0, 7450);
  // At LOW a box costs 12 triangles, so a loft costs MORE, and this ceiling was deliberately
  // raised from the 835 the boxes used to cost. Three reasons, in order of weight: the scene
  // budget is 420k triangles and fourteen LOW athletes are 15k of it; the extra is 3k on a whole
  // frame; and a 56-pixel athlete on a phone is ALL silhouette, so limb profile is worth more at
  // this tier than at any other. Raising a budget quietly would be the wrong move — raising it
  // with the arithmetic written down is the right one.
  check('triangles at LOW', tierTris.LOW, 0, 1100);

  if (fails.length) {
    console.log(`\nFAIL (${fails.length})`);
    for (const f of fails) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(`\nPASS — ${rows.length} positions, six heads tall, soles on the turf.`);
}

main();
