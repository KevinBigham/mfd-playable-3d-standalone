/* TEMPORARY build probe — deleted after verification. Not part of the shipped module set. */
import * as THREE from 'three';
import type { Conditions, StadiumDef, TeamDef } from '../../core/types.ts';
import { SceneRegistry, QUALITY_PRESETS, type QualityTier } from '../registry.ts';
import { buildEnvironment } from './index.ts';

declare global {
  interface Window { __probe: unknown }
}

function team(id: string, name: string, p: string, s: string, a: string, ink: string, ez: string): TeamDef {
  return {
    id, city: 'Test City', name, abbr: id.slice(0, 3).toUpperCase(),
    colors: { primary: p, secondary: s, accent: a, ink, endzone: ez },
    style: 'BALANCED',
    power: { passing: 50, running: 50, line: 50, coverage: 50, special: 50 },
    roster: [], logo: 'x', stadium: 'y', blurb: '',
  };
}

const stadium: StadiumDef = {
  id: 'probe-yard', name: 'Probe Yard', city: 'Test City',
  roof: 1, surface: 'GRASS', tier: 3,
  crowdTint: '#B4441A', skyKind: 'NIGHT', accent: '#FF7A18',
};

const conditions: Conditions = {
  weather: 'RAIN', surface: 'GRASS', windX: 1.2, windZ: -0.6, traction: 1,
};

const errors: string[] = [];
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 360;
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(640, 360, false);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const camera = new THREE.PerspectiveCamera(52, 640 / 360, 0.4, 620);

const info: Record<string, unknown>[] = [];

function run(tierName: QualityTier, roof: 0 | 1 | 2, tier: 1 | 2 | 3, weather: Conditions['weather'], sky: StadiumDef['skyKind']): void {
  const scene = new THREE.Scene();
  const reg = new SceneRegistry(scene);
  const env = buildEnvironment(reg, {
    home: team('ham', 'Hammers', '#1B4FD8', '#0A1F55', '#FFC300', '#FFFFFF', '#1B4FD8'),
    away: team('vol', 'Voltage', '#C8102E', '#3A0A12', '#34E3C8', '#FFFFFF', '#C8102E'),
    stadium: { ...stadium, roof, tier, skyKind: sky },
    conditions: { ...conditions, weather },
    quality: QUALITY_PRESETS[tierName],
    seed: 12345,
  });
  camera.position.set(0, 14, -20);
  camera.lookAt(0, 1.5, 20);
  env.field.setLos(35);
  env.field.setFirstDown(45);
  env.field.setMarkersVisible(true);
  env.lighting.focusOn(4, 35);
  env.stadium.setScore(21, 14, 3, '1:24');
  env.crowd.setExcitement(0.7);
  env.crowd.pop(1);
  for (let i = 0; i < 40; i++) {
    env.update(1 / 60, camera.position);
    renderer.render(scene, camera);
  }
  info.push({
    label: `${tierName}/roof${roof}/tier${tier}/${weather}/${sky}`,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
    crowd: env.crowd.count,
    towers: env.stadium.towers.length,
    goalHome: env.field.goal.home.toArray(),
  });
  env.dispose();
  reg.dispose();
  info.push({
    label: `${tierName} AFTER DISPOSE`,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
  });
}

try {
  run('HIGH', 1, 3, 'RAIN', 'NIGHT');
  run('HIGH', 2, 3, 'SNOW', 'STORM');
  run('MEDIUM', 0, 2, 'FOG', 'DUSK');
  run('LOW', 0, 1, 'HEAT', 'DAY');
  run('MEDIUM', 0, 2, 'WIND', 'DAY');
  run('HIGH', 0, 3, 'CLEAR', 'DAY');
  // Rebuild twice to prove teardown is clean.
  run('HIGH', 1, 3, 'RAIN', 'NIGHT');
} catch (e) {
  errors.push(String(e && (e as Error).stack ? (e as Error).stack : e));
}

window.__probe = { errors, info };
document.title = 'PROBE-DONE';
