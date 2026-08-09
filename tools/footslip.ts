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
import { plantedFootSlip } from '../src/render/footSlip.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const TICKS = Number(arg('ticks', '2400'));

function geometryMatrix(x: number, z: number, y = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function runGeometryProbe(): void {
  const stationary = plantedFootSlip(geometryMatrix(0, 0), geometryMatrix(0, 0), 0, 0);
  const translated = plantedFootSlip(geometryMatrix(0, 0), geometryMatrix(0.02, 0), 0, 0);
  const lifted = plantedFootSlip(geometryMatrix(0, 0), geometryMatrix(0, 0, 0.2), 0, 0);
  console.log('\nGRIDIRON OVERDRIVE — foot-slip matrix sanity');
  console.log(`stationary=${stationary?.toFixed(3)} translated=${translated?.toFixed(3)} lifted=${String(lifted)}`);
}

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
  straightMax: number;
  moderateN: number;
  moderateMean: number;
  moderateP95: number;
  moderateMax: number;
  hardCutN: number;
  hardCutMean: number;
  hardCutP95: number;
  hardCutMax: number;
  hardCutAnchored: number;
  hardCutAnchoredMean: number;
  hardCutPending: number;
  hardCutReleasing: number;
  anchorErrorMean: number;
}

interface MotionReport {
  name: string;
  samples: number;
  mean: number;
  p95: number;
  max: number;
  rootError: number;
  hash: string;
}

async function main(): Promise<void> {
  if (process.argv.includes('--geometry')) { runGeometryProbe(); return; }
  ensureBuild();
  const url = await startServer(4185);
  const h = await launch(url, { width: 640, height: 400 });
  const { page } = h;
  try {
    await page.evaluate(() => {
      const g = (window as any).GO;
      // The probe owns every measured fixed tick. Leaving the normal rAF loop alive during the
      // shader/asset settle wait made the starting tick depend on host speed, changing sample
      // counts between otherwise identical runs.
      g.stop();
      g.reset('match', {
        config: {
          seed: 4242, quarterSeconds: 300, difficulty: 'PRO',
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
      g.stop();
    });
    await page.waitForTimeout(2600);

    // Acceptance evidence uses deliberate, repeatable motions through the real renderer seam.
    // The match-wide distribution below remains as a stress diagnostic, but it also contains
    // collisions and animation-state changes that are not a controlled test of planted-leg IK.
    const motions = await page.evaluate(`(function(){
      var g=window.GO,m=g.match,w=m.world,R=g.renderer,a=null;
      for(var warm=0;warm<20000;warm++){
        for(var ready=0;ready<w.athletes.length;ready++){
          var p=w.athletes[ready];
          if(R.rigs[p.side]&&R.rigs[p.side].has(p.def.number)){a=p;break;}
        }
        if(a)break;
        m.tick();
      }
      if(!a)throw new Error('controlled foot-slip drill has no loaded athlete rig');
      for(var hide=0;hide<w.athletes.length;hide++){
        var other=w.athletes[hide];
        if(other!==a){other.x=40+hide;other.z=80+hide;other.prevX=other.x;other.prevZ=other.z;
          other.y=0;other.prevY=0;other.vx=0;other.vz=0;other.anim.state='IDLE';other.anim.ground=0;}
      }
      w.passThrown=false;w.lastCatcher=-1;w.playPhase='LIVE';
      w.ball.x=50;w.ball.y=1;w.ball.z=90;w.ball.prevX=50;w.ball.prevY=1;w.ball.prevZ=90;
      w.ball.state={kind:'loose',lastTouch:-1,deadTicks:0};
      var SAMPLES=[-0.1325,-0.05,0.06,0.16,0.2525],DROP=-0.108,TOL=.012;
      function xf(e,z,out){out.x=e[4]*DROP+e[8]*z+e[12];out.y=e[5]*DROP+e[9]*z+e[13];out.z=e[6]*DROP+e[10]*z+e[14];}
      var A={x:0,y:0,z:0},B={x:0,y:0,z:0};
      function hash(values){var h=2166136261>>>0;for(var i=0;i<values.length;i++){var v=Math.round(values[i]*1e6)|0;
        h=Math.imul(h^(v&255),16777619);h=Math.imul(h^((v>>>8)&255),16777619);h=Math.imul(h^((v>>>16)&255),16777619);h=Math.imul(h^((v>>>24)&255),16777619);}return (h>>>0).toString(16).padStart(8,'0');}
      function run(name,angle){
        var mo=R.motion[a.id];mo.visible=false;mo.rigKey=-1;mo.fadeDur=0;mo.basePoseValid=false;
        mo.footLock.foot=-1;mo.footLock.holding=false;mo.footLock.weight=0;mo.footLock.pendingFoot=-1;mo.footLock.groundedFrames=0;
        mo.catch.mode='NONE';mo.catch.weight=0;mo.catch.hadBall=false;
        R.lastAnimState[a.id]='';R.animT[a.id]=0;
        var speed=6.9,dx=Math.sin(angle)*speed/60,dz=Math.cos(angle)*speed/60,phase=.07,phaseStep=speed/3.1/60;
        a.x=0;a.y=0;a.z=50;a.prevX=0;a.prevY=0;a.prevZ=50;a.facing=0;a.prevFacing=0;
        a.vx=Math.sin(angle)*speed;a.vz=Math.cos(angle)*speed;a.hasBall=false;a.move='NORMAL';
        a.anim.state='RUN';a.anim.speed01=.72;a.anim.ground=speed;a.anim.accelFwd=0;a.anim.accelLat=0;
        var prev=null,slips=[],rootError=0;
        for(var frame=0;frame<360;frame++){
          a.prevX=a.x;a.prevY=a.y;a.prevZ=a.z;a.prevFacing=a.facing;
          a.x+=dx;a.z+=dz;a.anim.prevPhase=phase;phase=(phase+phaseStep)%1;a.anim.phase=phase;
          R.sync(w,m.state,1,1/60,false);
          var rig=R.rigs[a.side].get(a.def.number);rig.root.updateMatrixWorld(true);
          rootError=Math.max(rootError,Math.hypot(rig.root.position.x-a.x,rig.root.position.z-a.z));
          var feet=[rig.bones.footL.matrixWorld.elements,rig.bones.footR.matrixWorld.elements];
          var current={m:[feet[0].slice(),feet[1].slice()],low:[0,0]};
          for(var f=0;f<2;f++){var low=Infinity,lowZ=0;for(var k=0;k<SAMPLES.length;k++){xf(feet[f],SAMPLES[k],A);if(A.y<low){low=A.y;lowZ=SAMPLES[k];}}
            current.low[f]=low-a.y;if(frame>=20&&prev&&current.low[f]<=TOL&&prev.low[f]<=TOL){xf(feet[f],lowZ,A);xf(prev.m[f],lowZ,B);slips.push(Math.hypot(A.x-B.x,A.z-B.z)*60);}}
          prev=current;
        }
        slips.sort(function(x,y){return x-y;});var sum=0;for(var i=0;i<slips.length;i++)sum+=slips[i];
        return {name:name,samples:slips.length,mean:slips.length?sum/slips.length:0,
          p95:slips.length?slips[Math.floor(slips.length*.95)]:0,max:slips.length?slips[slips.length-1]:0,
          rootError:rootError,hash:hash(slips.concat([rootError]))};
      }
      var specs=[['straight',0],['moderate',.24],['hard-cut',.55]],out=[];
      for(var s=0;s<specs.length;s++){var first=run(specs[s][0],specs[s][1]),second=run(specs[s][0],specs[s][1]);
        if(first.hash!==second.hash)throw new Error(specs[s][0]+' foot motion is nondeterministic: '+first.hash+' != '+second.hash);out.push(first);}
      return out;
    })()`) as MotionReport[];

    console.log('\nGRIDIRON OVERDRIVE — deterministic planted-foot motions');
    console.log('──────────────────────────────────────────────────────────────');
    for (const motion of motions) {
      console.log(`${motion.name.padEnd(18)} n=${String(motion.samples).padEnd(4)} mean=${motion.mean.toFixed(3)} p95=${motion.p95.toFixed(3)} max=${motion.max.toFixed(3)} rootErr=${motion.rootError.toExponential(1)} hash=${motion.hash}`);
    }
    console.log('──────────────────────────────────────────────────────────────');
    const [straightMotion, moderateMotion, hardMotion] = motions;
    if (motions.some((motion) => motion.samples < 50)
      || straightMotion.p95 > 1.55 || moderateMotion.p95 > 5.5
      || hardMotion.mean > 2.5 || hardMotion.p95 > 6 || hardMotion.max > 12
      || motions.some((motion) => motion.rootError > 1e-8)) {
      throw new Error(`controlled foot-slip gate failed: ${JSON.stringify(motions)}`);
    }

    // Restore an authoritative fixed-seed match before collecting the broad stress distribution.
    await page.evaluate(() => {
      const g = (window as any).GO;
      g.reset('match', {
        config: {
          seed: 4242, quarterSeconds: 300, difficulty: 'PRO',
          seats: [{ side: 0, active: false }, { side: 1, active: false },
            { side: 0, active: false }, { side: 1, active: false }],
        },
        returnScreen: 'mainMenu',
      });
      g.stop();
    });
    await page.waitForTimeout(500);

    const rep = await page.evaluate(`(function(ticks){
      var g = window.GO, m = g.match, R = g.renderer;
      var slips = [], grounds = [], straight = [], moderate = [], hardCut = [], hardAnchorSlip = [], planted = 0, floating = 0, hardAnchored = 0, hardPending = 0, hardReleasing = 0, anchorErr = 0, anchorErrN = 0;
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
          var motion = R.motion[at.id];
          if (motion && motion.footLock && motion.footLock.holding) {
            xf(feet[motion.footLock.foot], 0.2525 * 0.67, A);
            anchorErr += Math.hypot(A.x - motion.footLock.anchor.x, A.z - motion.footLock.anchor.z) * 60;
            anchorErrN++;
          }
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
          // Classify against the DRAWN body's yaw. That is the frame the procedural stride and
          // render-only anchor actually use; simulation facing can legitimately lead or lag it.
          var drawnDrift = Math.atan2(at.vx, at.vz) - rig.root.rotation.y;
          while (drawnDrift > Math.PI) drawnDrift -= 2 * Math.PI;
          while (drawnDrift < -Math.PI) drawnDrift += 2 * Math.PI;
          var had = !!p;
          prev[at.id] = { m: [feet[0].slice(), feet[1].slice()], low: [lows[0], lows[1]], drift: drawnDrift };
          if (!had) continue;
          if (!down) { floating++; continue; }
          planted++;
          slips.push(bestSlip);
          grounds.push(sp);
          // Split out the athletes who are simply running forwards. The stride is solved in the
          // body's own frame, so a player cutting hard — travelling in one direction while facing
          // another — has feet that cannot both point where he is looking and travel where he is
          // going. That is a separate, honest limitation from whether the cycle itself holds.
          // Slip spans two poses, so both ends of the pair must belong to the same motion class.
          var prevDrift = Math.abs(p.drift === undefined ? drawnDrift : p.drift);
          var currDrift = Math.abs(drawnDrift);
          if (prevDrift < 0.05 && currDrift < 0.05) straight.push(bestSlip);
          if (prevDrift >= 0.12 && prevDrift <= 0.34 && currDrift >= 0.12 && currDrift <= 0.34) moderate.push(bestSlip);
          if (prevDrift > 0.34 && currDrift > 0.34) {
            hardCut.push(bestSlip);
            var fl = R.motion[at.id] && R.motion[at.id].footLock;
            if (fl && fl.holding) { hardAnchored++; hardAnchorSlip.push(bestSlip); }
            else if (fl && fl.foot !== -1) hardReleasing++;
            else if (fl && fl.groundedFrames > 0) hardPending++;
          }
        }
      }
      slips.sort(function(x, y){ return x - y; });
      straight.sort(function(x, y){ return x - y; });
      moderate.sort(function(x, y){ return x - y; });
      hardCut.sort(function(x, y){ return x - y; });
      var ssum = 0;
      for (var t2 = 0; t2 < straight.length; t2++) ssum += straight[t2];
      var sum = 0, over = 0;
      for (var s = 0; s < slips.length; s++) { sum += slips[s]; if (slips[s] > 1) over++; }
      var gs = 0;
      for (var q = 0; q < grounds.length; q++) gs += grounds[q];
      var hsum = 0;
      for (var h = 0; h < hardCut.length; h++) hsum += hardCut[h];
      var msum = 0;
      for (var m1 = 0; m1 < moderate.length; m1++) msum += moderate[m1];
      var hasum = 0;
      for (var ha = 0; ha < hardAnchorSlip.length; ha++) hasum += hardAnchorSlip[ha];
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
        straightMax: straight.length ? straight[straight.length - 1] : 0,
        moderateN: moderate.length,
        moderateMean: moderate.length ? msum / moderate.length : 0,
        moderateP95: moderate.length ? moderate[Math.floor(moderate.length * 0.95)] : 0,
        moderateMax: moderate.length ? moderate[moderate.length - 1] : 0,
        hardCutN: hardCut.length,
        hardCutMean: hardCut.length ? hsum / hardCut.length : 0,
        hardCutP95: hardCut.length ? hardCut[Math.floor(hardCut.length * 0.95)] : 0,
        hardCutMax: hardCut.length ? hardCut[hardCut.length - 1] : 0,
        hardCutAnchored: hardAnchored,
        hardCutAnchoredMean: hardAnchorSlip.length ? hasum / hardAnchorSlip.length : 0,
        hardCutPending: hardPending,
        hardCutReleasing: hardReleasing,
        anchorErrorMean: anchorErrN ? anchorErr / anchorErrN : 0,
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
    console.log(`straight           n=${rep.straightN} mean=${rep.straightMean.toFixed(3)} p95=${rep.straightP95.toFixed(3)} max=${rep.straightMax.toFixed(3)}`);
    console.log(`moderate turn      n=${rep.moderateN} mean=${rep.moderateMean.toFixed(3)} p95=${rep.moderateP95.toFixed(3)} max=${rep.moderateMax.toFixed(3)}`);
    console.log(`hard cut           n=${rep.hardCutN} mean=${rep.hardCutMean.toFixed(3)} p95=${rep.hardCutP95.toFixed(3)} max=${rep.hardCutMax.toFixed(3)} anchored=${rep.hardCutAnchored} pending=${rep.hardCutPending} releasing=${rep.hardCutReleasing} anchorMean=${rep.hardCutAnchoredMean.toFixed(3)}`);
    console.log(`anchor error       ${rep.anchorErrorMean.toFixed(3)} yd/s-equivalent mean`);
    console.log(`grounded           ${(100 * rep.contactShare).toFixed(1)}% of running ticks have a foot on the turf`);
    console.log('──────────────────────────────────────────────────────────────');
    if (h.errors.length) console.log('console errors:', JSON.stringify(h.errors.slice(0, 3)));
    if (rep.straightN < 50 || rep.moderateN < 50 || rep.hardCutN < 50 || h.errors.length) {
      throw new Error(`insufficient foot-slip evidence: straight=${rep.straightN} moderate=${rep.moderateN} hard=${rep.hardCutN} errors=${h.errors.length}`);
    }
  } finally {
    await h.close();
    stopServer();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
