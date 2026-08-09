#!/usr/bin/env tsx
/** Deterministic geometry and browser evidence for receiver catch presentation. */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildAthleteRig } from '../src/render/athleteRig.ts';
import { poseAthlete, type AnimSample } from '../src/render/athletePose.ts';
import {
  applyCatchReach, makeCatchPresentationState, stepCatchPresentation,
  type CatchPresentationState, type CatchReachResult,
} from '../src/render/catchPresentation.ts';
import { SceneRegistry, QUALITY_PRESETS } from '../src/render/registry.ts';
import { TEAMS } from '../src/data/teams.ts';
import { startServer, stopServer, launch, ensureBuild } from './browser.ts';

const OUT = 'docs/captures';
const SCENARIOS = [
  { name: 'chest', target: [0, 1.35, 0.45] },
  { name: 'high', target: [0.05, 1.93, 0.35] },
  { name: 'low', target: [-0.05, 0.76, 0.35] },
  { name: 'behind', target: [0.34, 1.34, -0.22] },
  { name: 'in-stride', target: [0.52, 1.46, 0.62] },
  { name: 'sideline', target: [0.92, 1.48, 0.28] },
] as const;
const RATES = [30, 60, 120] as const;

const SAMPLE: AnimSample = {
  state: 'RUN', phase: 0.16, speed01: 0.72, lean: 0.03, fire: 0, t: 0.3,
  stride: 3.1, drift: 0, carry: 0, gaze: 0, gazePitch: 0, turn: 0,
};

function hash(values: number[]): string {
  let h = 0x811c9dc5;
  for (const value of values) {
    const v = Math.round(value * 1e7);
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface GeometryResult {
  name: string; hz: number; before: number; after: number; reduction: number;
  clamped: boolean; maxJointDeg: number; nan: number; hash: string;
}

function geometryRun(name: string, tuple: readonly [number, number, number], hz: number): GeometryResult {
  const scene = new THREE.Scene();
  const registry = new SceneRegistry(scene);
  const def = TEAMS[0].roster[1];
  const rig = buildAthleteRig(registry, def, TEAMS[0].colors, QUALITY_PRESETS.HIGH, false);
  scene.add(rig.root);
  const state: CatchPresentationState = makeCatchPresentationState();
  const target = { x: tuple[0], y: tuple[1], z: tuple[2] };
  const frames = Math.round(0.25 * hz);
  let result: CatchReachResult = { kind: 'CHEST', beforeError: 0, afterError: 0, clamped: false };
  let maxJoint = 0;
  let previous: THREE.Quaternion[] | null = null;
  for (let frame = 0; frame < frames; frame++) {
    poseAthlete(rig, SAMPLE);
    stepCatchPresentation(state, { dt: 1 / hz, hasBall: false, caught: false, anticipating: true, target });
    result = applyCatchReach(rig, state);
    const current = [rig.bones.shoulderL, rig.bones.elbowL, rig.bones.shoulderR, rig.bones.elbowR]
      .map((bone) => bone.quaternion.clone());
    if (previous) for (let i = 0; i < current.length; i++) maxJoint = Math.max(maxJoint, previous[i].angleTo(current[i]));
    previous = current;
  }
  const values: number[] = [state.weight, result.beforeError, result.afterError, maxJoint];
  for (const bone of [rig.bones.chest, rig.bones.shoulderL, rig.bones.elbowL, rig.bones.handL,
    rig.bones.shoulderR, rig.bones.elbowR, rig.bones.handR]) values.push(...bone.quaternion.toArray());
  const nan = values.filter((value) => !Number.isFinite(value)).length;
  const reduction = 1 - result.afterError / Math.max(1e-6, result.beforeError);
  const output = {
    name, hz, before: result.beforeError, after: result.afterError, reduction,
    clamped: result.clamped, maxJointDeg: THREE.MathUtils.radToDeg(maxJoint), nan, hash: hash(values),
  };
  rig.dispose(); registry.dispose();
  return output;
}

function geometryEvidence(): void {
  console.log('\nGRIDIRON OVERDRIVE — deterministic catch geometry');
  console.log('────────────────────────────────────────────────────────────────────────────');
  for (const scenario of SCENARIOS) {
    for (const hz of RATES) {
      const a = geometryRun(scenario.name, scenario.target, hz);
      const b = geometryRun(scenario.name, scenario.target, hz);
      if (a.hash !== b.hash) throw new Error(`${scenario.name}@${hz} is nondeterministic: ${a.hash} != ${b.hash}`);
      if (a.nan > 0) throw new Error(`${scenario.name}@${hz} emitted ${a.nan} non-finite values`);
      if (a.reduction < 0.35) throw new Error(`${scenario.name}@${hz} reduced hand error only ${(a.reduction * 100).toFixed(1)}%`);
      const jointBound = 60 * (30 / hz);
      if (a.maxJointDeg > jointBound) throw new Error(`${scenario.name}@${hz} joint step ${a.maxJointDeg.toFixed(2)}° exceeds ${jointBound.toFixed(2)}°`);
      console.log(`${scenario.name.padEnd(10)} ${String(hz).padStart(3)}Hz  error ${a.before.toFixed(3)}→${a.after.toFixed(3)} yd  `
        + `reduction ${(a.reduction * 100).toFixed(1).padStart(5)}%  clamp=${a.clamped ? 'Y' : 'N'}  `
        + `jointΔ=${a.maxJointDeg.toFixed(2).padStart(6)}°  hash=${a.hash}`);
    }
  }
  console.log('────────────────────────────────────────────────────────────────────────────');
}

async function browserEvidence(): Promise<void> {
  ensureBuild();
  mkdirSync(OUT, { recursive: true });
  const url = await startServer(4186);
  const h = await launch(url, { width: 560, height: 520 });
  const shots: Array<{ file: string; label: string }> = [];
  try {
    const { page } = h;
    await page.evaluate(() => {
      const g = (window as any).GO;
      g.stop();
      g.reset('match', {
        config: { seed: 8808, quarterSeconds: 120, difficulty: 'PRO', seats: [
          { side: 0, active: false }, { side: 1, active: false },
          { side: 0, active: false }, { side: 1, active: false },
        ] },
        returnScreen: 'mainMenu',
      });
      g.stop();
    });
    await page.waitForTimeout(2200);
    for (const scenario of SCENARIOS) {
      for (const view of ['close', 'game'] as const) {
        const data = await page.evaluate(`(function(target, view){
          var g=window.GO,m=g.match,w=m.world,R=g.renderer,a=null;
          for(var warm=0;warm<20000;warm++){
            for(var ready=0;ready<w.athletes.length;ready++){
              var rp=w.athletes[ready];
              if(R.rigs[rp.side]&&R.rigs[rp.side].has(rp.def.number)){a=rp;break;}
            }
            if(a)break;
            m.tick();
          }
          for(var pick=0;pick<w.athletes.length;pick++){
            var candidate=w.athletes[pick];
            if(R.rigs[candidate.side]&&R.rigs[candidate.side].has(candidate.def.number)){a=candidate;break;}
          }
          if(!a)throw new Error('no world athlete has a loaded presentation rig: maps='+
            R.rigs.map(function(map){return Array.from(map.keys()).join(',');}).join('|')+
            ' world='+w.athletes.map(function(p){return p.side+':'+p.def.number;}).join(','));
          for(var i=0;i<w.athletes.length;i++){
            var p=w.athletes[i]; p.x=40+i; p.z=80+i; p.prevX=p.x; p.prevZ=p.z; p.y=0; p.prevY=0;
          }
          a.x=0; a.z=50; a.prevX=0; a.prevZ=50; a.facing=0; a.prevFacing=0;
          a.vx=0; a.vz=7; a.anim.state='RUN'; a.anim.phase=.16; a.anim.prevPhase=.16;
          a.anim.speed01=.72; a.anim.ground=7; a.hasBall=false; a.move='NORMAL';
          w.possession=a.side; w.passThrown=true; w.lastCatcher=-1; w.playPhase='LIVE';
          w.ball.x=target[0]; w.ball.y=target[1]; w.ball.z=50+target[2];
          w.ball.prevX=w.ball.x; w.ball.prevY=w.ball.y; w.ball.prevZ=w.ball.z;
          w.ball.state={kind:'inAir',from:0,intended:a.id,passKind:'NORMAL',t:.8,flightTime:1,
            sx:0,sy:1.85,sz:42,tx:w.ball.x,ty:w.ball.y,tz:w.ball.z,arc:1,contested:false};
          for(var f=0;f<12;f++) R.sync(w,m.state,1,1/60,false);
          var cam=R.gameCamera.camera;
          if(view==='close'){cam.fov=25;cam.position.set(4.8,1.65,51.2);cam.lookAt(0,1.2,50);}
          else{cam.fov=34;cam.position.set(11,7.5,38);cam.lookAt(0,1.1,50);}
          cam.updateProjectionMatrix();R.render();
          var rig=R.rigs[a.side].get(a.def.number),center=rig.root.position.clone();center.y+=1;
          var screen=center.project(cam);
          return {png:document.querySelector('canvas').toDataURL('image/png'),
            visible:rig.root.visible,screen:[screen.x,screen.y,screen.z],
            root:[rig.root.position.x,rig.root.position.y,rig.root.position.z]};
        })(${JSON.stringify(scenario.target)},${JSON.stringify(view)})`) as { png: string; visible: boolean; screen: number[]; root: number[] };
        if (!data.visible || Math.abs(data.screen[0]) > 0.9 || Math.abs(data.screen[1]) > 0.9 || data.screen[2] < -1 || data.screen[2] > 1) {
          throw new Error(`${scenario.name}/${view} receiver not framed: ${JSON.stringify(data)}`);
        }
        const file = `${OUT}/.catch-${scenario.name}-${view}.png`;
        writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64'));
        shots.push({ file, label: `${scenario.name} ${view}` });
      }
    }
    if (h.errors.length) throw new Error(`browser console errors: ${JSON.stringify(h.errors.slice(0, 3))}`);
  } finally {
    await h.close(); stopServer();
  }
  const manifest = `${OUT}/.catch-manifest.json`;
  const sheet = `${OUT}/catch-lab.png`;
  writeFileSync(manifest, JSON.stringify({ shots }, null, 2));
  execFileSync('python3', ['tools/tile.py', manifest, sheet, '4'], { stdio: 'inherit' });
  console.log(`Catch Lab captures: ${sheet}`);
}

async function main(): Promise<void> {
  geometryEvidence();
  if (process.argv.includes('--geometry')) return;
  await browserEvidence();
}

main().catch((error) => { console.error(error); stopServer(); process.exit(1); });
