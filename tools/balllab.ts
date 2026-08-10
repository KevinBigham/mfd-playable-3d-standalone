#!/usr/bin/env tsx
/** Deterministic receiver/defender ball-skill evidence through simulation, events, rig and IK. */
import * as THREE from 'three';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BallPlayCue, BallPlayTechnique, GameEvent } from '../src/core/types.ts';
import { EventBus } from '../src/core/events.ts';
import { Rng } from '../src/core/rng.ts';
import { FIELD_HALF_WIDTH } from '../src/core/constants.ts';
import { getTeam, TEAM_IDS } from '../src/data/index.ts';
import { TEAMS } from '../src/data/teams.ts';
import { buildAthleteRig } from '../src/render/athleteRig.ts';
import { poseAthlete, type AnimSample } from '../src/render/athletePose.ts';
import {
  applyCatchReach, beginBallPlayPresentation, makeCatchPresentationState,
  stepCatchPresentation, type CatchReachResult,
} from '../src/render/catchPresentation.ts';
import { QUALITY_PRESETS, SceneRegistry } from '../src/render/registry.ts';
import { resolveAirBall, resolveLooseBall } from '../src/sim/catching.ts';
import { assignUnits, createWorld, type World } from '../src/sim/world.ts';
import { ensureBuild, launch, startServer, stopServer } from './browser.ts';

const OUT = 'docs/captures';
const RATES = [30, 60, 120] as const;
type Expected = BallPlayCue['outcome'] | 'NO_PLAY';
interface Drill {
  name: string;
  seed: number;
  actor: 'RECEIVER' | 'DEFENDER';
  target: readonly [number, number, number];
  technique: BallPlayTechnique;
  expected: Expected;
  setup: (world: World) => void;
}

const SAMPLE: AnimSample = {
  state: 'RUN', phase: 0.16, speed01: 0.72, lean: 0.03, fire: 0, t: 0.3,
  stride: 3.1, drift: 0, carry: 0, gaze: 0, gazePitch: 0, turn: 0,
};

function baseWorld(seed: number): World {
  const bus = new EventBus(); bus.record();
  const world = createWorld(getTeam(TEAM_IDS[0]), getTeam(TEAM_IDS[1]),
    { weather: 'CLEAR', surface: 'GRASS', windX: 0, windZ: 0, traction: 1 }, new Rng(seed), bus);
  assignUnits(world, 0);
  world.playPhase = 'LIVE'; world.possession = 0; world.passThrown = true; world.losZ = -10;
  for (const athlete of world.athletes) {
    athlete.x = 40 + athlete.id; athlete.z = 40; athlete.y = 0; athlete.facing = 0;
    athlete.vx = 0; athlete.vz = 0; athlete.move = 'NORMAL'; athlete.moveTicks = 0;
    athlete.ballPlayTechnique = athlete.side === 0 ? 'BALANCED' : 'AUTO';
    athlete.ballPlayUntilTick = 999;
    athlete.def = { ...athlete.def, ratings: { ...athlete.def.ratings, hands: 70, awareness: 70 } };
  }
  world.ball.x = 0; world.ball.y = 1.5; world.ball.z = 0;
  world.ball.prevX = 0; world.ball.prevY = 1.5; world.ball.prevZ = 0;
  world.ball.state = { kind: 'inAir', from: 0, intended: 1, passKind: 'NORMAL', t: 0.65,
    flightTime: 1, sx: 0, sy: 1.85, sz: -10, tx: 0, ty: 1.5, tz: 0, arc: 1,
    contested: false, attemptMask: 0 };
  return world;
}

function receiverAt(world: World, x = 0, z = 0): void {
  const receiver = world.athletes[1]; receiver.x = x; receiver.z = z; receiver.facing = 0;
}
function defenderAt(world: World, x = 0, z = -0.2, facing = 0): void {
  const defender = world.athletes[7]; defender.x = x; defender.z = z; defender.facing = facing;
}

const receiver = (technique: BallPlayTechnique, x = 0, z = 0) => (world: World): void => {
  receiverAt(world, x, z); world.athletes[1].ballPlayTechnique = technique;
};
const contested = (technique: BallPlayTechnique) => (world: World): void => {
  receiverAt(world); defenderAt(world, 0.35, -0.1, 0);
  world.athletes[1].ballPlayTechnique = technique; world.athletes[7].ballPlayTechnique = 'SWAT';
};

const DRILLS: Drill[] = [
  { name: 'chest', seed: 2, actor: 'RECEIVER', target: [0, 1.35, 0.45], technique: 'BALANCED', expected: 'CATCH', setup: receiver('BALANCED') },
  { name: 'high', seed: 2, actor: 'RECEIVER', target: [0.05, 1.93, 0.35], technique: 'AGGRESSIVE', expected: 'CATCH', setup: receiver('AGGRESSIVE') },
  { name: 'low', seed: 2, actor: 'RECEIVER', target: [-0.05, 0.76, 0.35], technique: 'BALANCED', expected: 'CATCH', setup: receiver('BALANCED') },
  { name: 'behind', seed: 2, actor: 'RECEIVER', target: [0.34, 1.34, -0.22], technique: 'POSSESSION', expected: 'CATCH', setup: receiver('POSSESSION') },
  { name: 'in-stride-rac', seed: 2, actor: 'RECEIVER', target: [0.52, 1.46, 0.62], technique: 'RAC', expected: 'CATCH', setup: receiver('RAC') },
  { name: 'contested-possession', seed: 13, actor: 'RECEIVER', target: [0.15, 1.55, 0.42], technique: 'POSSESSION', expected: 'CATCH', setup: contested('POSSESSION') },
  { name: 'diving-extension', seed: 2, actor: 'RECEIVER', target: [1.05, 1.05, 0.45], technique: 'EXTEND', expected: 'CATCH', setup: (w) => {
    receiver('EXTEND')(w); w.athletes[1].move = 'DIVE'; w.athletes[1].moveTicks = 12;
  } },
  { name: 'legal-sideline', seed: 2, actor: 'RECEIVER', target: [0.72, 1.48, 0.28], technique: 'POSSESSION', expected: 'CATCH', setup: (w) => {
    receiverAt(w, FIELD_HALF_WIDTH + 0.12, 0); w.ball.x = w.athletes[1].x;
    (w.ball.state as Extract<typeof w.ball.state, { kind: 'inAir' }>).tx = w.ball.x;
    w.athletes[1].ballPlayTechnique = 'POSSESSION';
  } },
  { name: 'illegal-sideline', seed: 1, actor: 'RECEIVER', target: [0.88, 1.48, 0.28], technique: 'POSSESSION', expected: 'DROP', setup: (w) => {
    receiverAt(w, FIELD_HALF_WIDTH + 0.42, 0); w.ball.x = w.athletes[1].x;
    (w.ball.state as Extract<typeof w.ball.state, { kind: 'inAir' }>).tx = w.ball.x;
    w.athletes[1].ballPlayTechnique = 'POSSESSION';
  } },
  { name: 'in-phase-interception', seed: 2, actor: 'DEFENDER', target: [0.1, 1.62, 0.42], technique: 'PLAY_BALL', expected: 'INTERCEPTION', setup: (w) => {
    receiverAt(w, 0, 0.25); defenderAt(w, 0.05, -0.1, 0); w.athletes[7].ballPlayTechnique = 'PLAY_BALL';
  } },
  { name: 'trail-swat', seed: 1, actor: 'DEFENDER', target: [-0.2, 1.5, 0.45], technique: 'SWAT', expected: 'SWAT', setup: (w) => {
    receiverAt(w); defenderAt(w, 0.2, -0.7, 0); w.athletes[7].ballPlayTechnique = 'SWAT';
  } },
  { name: 'underneath-high-point', seed: 2, actor: 'DEFENDER', target: [0.25, 2.05, 0.25], technique: 'PLAY_BALL', expected: 'INTERCEPTION', setup: (w) => {
    receiverAt(w, 0, 0.3); defenderAt(w, 0, 0, 0); w.athletes[7].move = 'JUMP';
    w.athletes[7].ballPlayTechnique = 'PLAY_BALL'; w.ball.y = 2.05;
  } },
  { name: 'out-of-reach-no-play', seed: 1, actor: 'DEFENDER', target: [1.9, 1.55, 0.4], technique: 'SWAT', expected: 'NO_PLAY', setup: (w) => {
    receiverAt(w, 40, 40); defenderAt(w, 2.1, 0, 0); w.athletes[7].ballPlayTechnique = 'SWAT';
  } },
  { name: 'failed-play-ball', seed: 2, actor: 'DEFENDER', target: [0.15, 1.6, 0.4], technique: 'PLAY_BALL', expected: 'CATCH', setup: (w) => {
    receiverAt(w, 0, 0.1); defenderAt(w, 0.15, -0.1, 0); w.athletes[7].ballPlayTechnique = 'PLAY_BALL';
    w.athletes[7].def = { ...w.athletes[7].def, ratings: { ...w.athletes[7].def.ratings, hands: 1, awareness: 1 } };
  } },
  { name: 'tipped-ball-recovery', seed: 4, actor: 'DEFENDER', target: [-0.1, 1.5, 0.3], technique: 'PLAY_BALL', expected: 'INTERCEPTION', setup: (w) => {
    receiverAt(w, 40, 40); defenderAt(w, 0, 0, 0);
    w.ball.state = { kind: 'loose', lastTouch: 1, ticks: 1, fromFumble: false, tipped: true, attemptMask: 0 };
    w.ball.vx = 0; w.ball.vy = 2; w.ball.vz = 1;
  } },
];

function eventOutcome(events: readonly GameEvent[]): Expected {
  for (const event of events) {
    if (event.type === 'catch') return 'CATCH';
    if (event.type === 'drop') return 'DROP';
    if (event.type === 'swat') return 'SWAT';
    if (event.type === 'interception') return 'INTERCEPTION';
  }
  return 'NO_PLAY';
}

function runSimulation(drill: Drill, seed: number): { outcome: Expected; events: string[]; hash: string } {
  const world = baseWorld(seed); drill.setup(world);
  const events: GameEvent[] = []; world.bus.on('*', (event) => events.push(event));
  const loose = world.ball.state.kind === 'loose';
  if (loose) resolveLooseBall(world); else resolveAirBall(world);
  const canonical = events.map((event) => JSON.stringify(event)).join('|');
  return { outcome: eventOutcome(events), events: events.map((event) => event.type), hash: textHash(canonical) };
}

function stableSimulation(drill: Drill): { outcome: Expected; events: string[]; hash: string; seed: number } {
  const first = runSimulation(drill, drill.seed);
  if (first.outcome !== drill.expected) {
    throw new Error(`${drill.name} seed ${drill.seed} produced ${first.outcome}, expected ${drill.expected}`);
  }
  const second = runSimulation(drill, drill.seed);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(`${drill.name} simulation is nondeterministic`);
  return { ...first, seed: drill.seed };
}

function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function geometry(drill: Drill, hz: number): { before: number; after: number; reduction: number;
  clamped: boolean; maxJointDeg: number; nan: number; hash: string } {
  const scene = new THREE.Scene(); const registry = new SceneRegistry(scene);
  const rig = buildAthleteRig(registry, TEAMS[drill.actor === 'RECEIVER' ? 0 : 1].roster[1],
    TEAMS[drill.actor === 'RECEIVER' ? 0 : 1].colors, QUALITY_PRESETS.HIGH, drill.actor === 'DEFENDER');
  scene.add(rig.root);
  const state = makeCatchPresentationState();
  const cue: BallPlayCue = { tick: 1, by: drill.actor === 'RECEIVER' ? 1 : 7,
    technique: drill.technique, outcome: drill.expected === 'NO_PLAY' ? 'SWAT' : drill.expected,
    at: { x: drill.target[0], y: drill.target[1], z: drill.target[2] },
    sideline: drill.name.includes('sideline') };
  state.technique = drill.technique;
  let result: CatchReachResult = { kind: 'CHEST', beforeError: 0, afterError: Infinity, clamped: false };
  let bestAfter = Infinity; let firstBefore = 0; let clamped = false;
  let previous: THREE.Quaternion[] | null = null; let maxJoint = 0;
  const values: number[] = [];
  const actorSecures = drill.expected === 'INTERCEPTION'
    || (drill.actor === 'RECEIVER' && drill.expected === 'CATCH');
  const actorHasCue = drill.expected !== 'NO_PLAY'
    && !(drill.actor === 'DEFENDER' && drill.expected === 'CATCH');
  let frameCount = 0;
  const frame = (anticipating: boolean): void => {
    poseAthlete(rig, SAMPLE);
    stepCatchPresentation(state, { dt: 1 / hz,
      hasBall: !anticipating && actorSecures,
      caught: false, anticipating, target: cue.at });
    result = applyCatchReach(rig, state);
    if (frameCount++ === 0) firstBefore = result.beforeError;
    bestAfter = Math.min(bestAfter, result.afterError); clamped ||= result.clamped;
    const joints = [rig.bones.shoulderL, rig.bones.elbowL, rig.bones.shoulderR, rig.bones.elbowR]
      .map((bone) => bone.quaternion.clone());
    if (previous) for (let index = 0; index < joints.length; index++) {
      maxJoint = Math.max(maxJoint, previous[index].angleTo(joints[index]));
    }
    previous = joints;
  };
  // Both CPU and human actors enter the production anticipation seam before contact. This is
  // important evidence: judging only a surprise event cue would measure the bounded attack ramp,
  // not the hands that have already been tracking the current football for up to 0.30 seconds.
  for (let index = 0; index < Math.max(3, Math.round(0.30 * hz)); index++) frame(true);
  if (actorHasCue) beginBallPlayPresentation(state, cue, cue.at);
  for (let index = 0; index < Math.max(3, Math.round(0.12 * hz)); index++) frame(false);
  values.push(firstBefore, bestAfter, maxJoint);
  for (const bone of [rig.bones.chest, rig.bones.shoulderL, rig.bones.elbowL,
    rig.bones.shoulderR, rig.bones.elbowR]) values.push(...bone.quaternion.toArray());
  const nan = values.filter((value) => !Number.isFinite(value)).length;
  const output = { before: firstBefore, after: bestAfter,
    reduction: 1 - bestAfter / Math.max(1e-6, firstBefore), clamped,
    maxJointDeg: THREE.MathUtils.radToDeg(maxJoint), nan,
    hash: textHash(values.map((value) => value.toFixed(8)).join(',')) };
  rig.dispose(); registry.dispose(); return output;
}

function labEvidence(): void {
  console.log('\nGRIDIRON OVERDRIVE — BALL LAB');
  console.log('─'.repeat(118));
  for (const drill of DRILLS) {
    const simulation = stableSimulation(drill);
    for (const hz of RATES) {
      const first = geometry(drill, hz); const second = geometry(drill, hz);
      if (first.hash !== second.hash) throw new Error(`${drill.name}@${hz} presentation is nondeterministic`);
      if (first.nan) throw new Error(`${drill.name}@${hz} emitted NaNs`);
      const minimum = drill.actor === 'DEFENDER' ? 0.30 : 0.35;
      if (first.reduction < minimum) throw new Error(`${drill.name}@${hz} hand-error reduction below ${minimum * 100}%`);
      if (drill.actor === 'DEFENDER' && (drill.expected === 'SWAT' || drill.expected === 'INTERCEPTION')
          && first.after > 0.18) throw new Error(`${drill.name}@${hz} defender hand error ${first.after.toFixed(3)} > 0.18yd`);
      const jointBound = 60 * (30 / hz);
      if (first.maxJointDeg > jointBound + 1e-6) throw new Error(`${drill.name}@${hz} joint delta exceeds ${jointBound}°`);
      const combined = textHash(`${simulation.hash}|${first.hash}|${hz}`);
      console.log(`${drill.name.padEnd(24)} ${String(hz).padStart(3)}Hz  ${drill.technique.padEnd(10)} `
        + `${simulation.outcome.padEnd(12)} error ${first.before.toFixed(3)}→${first.after.toFixed(3)} `
        + `clamp=${first.clamped ? 'Y' : 'N'} jointΔ=${first.maxJointDeg.toFixed(2).padStart(5)}° seed=${simulation.seed} hash=${combined}`);
    }
  }
  console.log('─'.repeat(118));
}

async function browserEvidence(): Promise<void> {
  ensureBuild(); mkdirSync(OUT, { recursive: true });
  const url = await startServer(4187); const handle = await launch(url, { width: 620, height: 540 });
  const shots: Array<{ file: string; label: string }> = [];
  try {
    await handle.page.evaluate(() => {
      const game = (window as any).GO; game.stop();
      game.reset('match', { config: { seed: 8877, quarterSeconds: 120, difficulty: 'PRO', seats: [
        { side: 0, active: false }, { side: 1, active: false },
        { side: 0, active: false }, { side: 1, active: false },
      ] }, returnScreen: 'mainMenu' }); game.stop();
    });
    await handle.page.waitForTimeout(1800);
    for (const drill of DRILLS) for (const view of ['close', 'game'] as const) {
      const data = await handle.page.evaluate(`(function(drill,view){
        var g=window.GO,m=g.match,w=m.world,R=g.renderer,a=null,id=drill.actor==='RECEIVER'?1:7;
        for(var warm=0;warm<20000;warm++){a=w.athletes[id];if(a&&R.rigs[a.side]&&R.rigs[a.side].has(a.def.number))break;m.tick();}
        if(!a||!R.rigs[a.side]||!R.rigs[a.side].has(a.def.number))throw new Error('no ball-lab rig');
        for(var i=0;i<w.athletes.length;i++){var p=w.athletes[i];p.x=40+i;p.z=80+i;p.prevX=p.x;p.prevZ=p.z;p.y=0;p.prevY=0;p.hasBall=false;}
        a.x=0;a.z=50;a.prevX=0;a.prevZ=50;a.facing=0;a.prevFacing=0;a.vx=0;a.vz=7;
        a.anim.state='RUN';a.anim.phase=.16;a.anim.prevPhase=.16;a.anim.speed01=.72;a.anim.ground=7;a.move=drill.technique==='EXTEND'?'DIVE':'NORMAL';
        a.ballPlayTechnique=drill.technique;a.ballPlayUntilTick=w.tick+40;w.possession=drill.actor==='RECEIVER'?a.side:1-a.side;
        w.passThrown=true;w.playPhase='LIVE';var at={x:drill.target[0],y:drill.target[1],z:50+drill.target[2]};
        w.ball.x=at.x;w.ball.y=at.y;w.ball.z=at.z;w.ball.prevX=at.x;w.ball.prevY=at.y;w.ball.prevZ=at.z;
        var success=drill.expected==='INTERCEPTION'||(drill.actor==='RECEIVER'&&drill.expected==='CATCH');a.hasBall=success;
        var hasEvent=drill.expected!=='NO_PLAY'&&!(drill.actor==='DEFENDER'&&drill.expected==='CATCH');
        w.ball.state=success?{kind:'held',carrier:a.id}:{kind:'inAir',from:0,intended:drill.actor==='RECEIVER'?a.id:1,passKind:'NORMAL',t:.8,flightTime:1,sx:0,sy:1.85,sz:42,tx:at.x,ty:at.y,tz:at.z,arc:1,contested:false,attemptMask:0};
        var type=drill.expected==='NO_PLAY'?'swat':drill.expected.toLowerCase();
        var event={type:type,tick:w.tick,by:a.id,at:at,technique:drill.technique,sideline:drill.name.indexOf('sideline')>=0};
        if(type==='catch'){event.contested=drill.name.indexOf('contested')>=0;event.diving=drill.technique==='EXTEND';event.yards=5;}
        if(hasEvent)R.handleEvent(event);for(var f=0;f<4;f++)R.sync(w,m.state,1,1/60,false);
        var cam=R.gameCamera.camera;if(view==='close'){cam.fov=27;cam.position.set(0,2.15,55.6);cam.lookAt(0,1.35,50);}
        else{cam.fov=34;cam.position.set(11,7.5,38);cam.lookAt(0,1.1,50);}cam.updateProjectionMatrix();R.render();
        var rig=R.rigs[a.side].get(a.def.number),root=[rig.root.position.x,rig.root.position.y,rig.root.position.z];
        return {png:document.querySelector('canvas').toDataURL('image/png'),root:root};
      })(${JSON.stringify({ actor: drill.actor, target: drill.target, technique: drill.technique,
        expected: drill.expected, name: drill.name })},${JSON.stringify(view)})`) as { png: string; root: number[] };
      if (Math.abs(data.root[0]) > 1e-6 || Math.abs(data.root[2] - 50) > 1e-6) {
        throw new Error(`${drill.name}/${view} displaced authoritative root: ${data.root.join(',')}`);
      }
      const file = `${OUT}/.ball-${drill.name}-${view}.png`;
      writeFileSync(file, Buffer.from(data.png.split(',')[1], 'base64')); shots.push({ file, label: `${drill.name} ${view}` });
    }
    if (handle.errors.length) throw new Error(`browser console errors: ${JSON.stringify(handle.errors.slice(0, 3))}`);
  } finally { await handle.close(); stopServer(); }
  const manifest = `${OUT}/.ball-manifest.json`; const sheet = `${OUT}/ball-lab.png`;
  writeFileSync(manifest, JSON.stringify({ shots }, null, 2));
  execFileSync('python3', ['tools/tile.py', manifest, sheet, '5'], { stdio: 'inherit' });
  console.log(`Ball Lab captures: ${sheet}`);
}

async function main(): Promise<void> {
  labEvidence(); if (process.argv.includes('--geometry')) return; await browserEvidence();
}
main().catch((error) => { console.error(error); stopServer(); process.exit(1); });
