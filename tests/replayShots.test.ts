import { describe, expect, it } from 'vitest';
import { FALLBACK_REPLAY_SHOTS, replayShotSetHash, validateReplayShotSet } from '../src/render/replayShots.ts';
import { ReplayDirector, ReplayEventRouter, replayTarget } from '../src/render/replay.ts';
import * as THREE from 'three';
import { GameCamera, ReplayFreeCameraController } from '../src/render/camera.ts';
import { bowlPhotoProxies, collectPhotoProxies } from '../src/render/renderer.ts';

describe('MfdReplayShotSetV1', () => {
  it('validates and canonically hashes the fallback package', () => {
    const result = validateReplayShotSet(FALLBACK_REPLAY_SHOTS);
    expect(result.ok).toBe(true);
    expect(replayShotSetHash(result.value!)).toBe(replayShotSetHash(FALLBACK_REPLAY_SHOTS));
  });
  it('fails closed on executable or unbounded fields', () => {
    const bad = JSON.parse(JSON.stringify(FALLBACK_REPLAY_SHOTS));
    bad.shots[0].url = 'https://example.invalid';
    bad.shots[0].fov = 180;
    bad.shots[0].start = 0.8;
    bad.shots[0].end = 0.2;
    expect(validateReplayShotSet(bad).ok).toBe(false);
  });
  it('plays all authored shots in deterministic normalized-time order', () => {
    const d = new ReplayDirector();
    expect(d.load(FALLBACK_REPLAY_SHOTS)).toBe(true);
    expect(d.begin('TOUCHDOWN', 41).id).toBe('wide');
    expect(d.at(0.5).id).toBe('field-level');
    expect(d.at(0.9).id).toBe('end-zone');
    expect(d.begin('TOUCHDOWN', 41).id).toBe('wide');
    expect(d.load({ version: 99 })).toBe(false);
    expect(d.choose('FIELD_GOAL', 1).id).toBe('wide');
  });
  it('routes actual event sequences without lower-priority overwrite', () => {
    const router = new ReplayEventRouter();
    router.observe({ type: 'touchdown', tick: 10, side: 0, by: 5, yards: 30 });
    router.observe({ type: 'play.end', tick: 11, reason: 'TOUCHDOWN', spotZ: 100, yards: 30 });
    expect(router.take()).toBe('TOUCHDOWN');

    router.observe({ type: 'sack', tick: 20, by: 7, on: 0, yards: -6 });
    router.observe({ type: 'play.end', tick: 21, reason: 'TACKLE', spotZ: 20, yards: -6 });
    expect(router.take()).toBe('SACK');

    router.observe({ type: 'fumble', tick: 30, by: 5, forcedBy: 8 });
    router.observe({ type: 'recover', tick: 31, by: 9, side: 1 });
    expect(router.take()).toBe('FUMBLE_RECOVERY');

    router.observe({ type: 'play.start', tick: 40, play: 'quick', side: 0 });
    router.observe({ type: 'throw', tick: 41, from: 0, to: 5, passKind: 'NORMAL' });
    router.observe({ type: 'catch', tick: 42, by: 5, contested: false, diving: false, yards: 20 });
    router.observe({ type: 'play.end', tick: 43, reason: 'TACKLE', spotZ: 60, yards: 20 });
    expect(router.take()).toBe('EXPLOSIVE_PASS');
  });
  it('promotes only a recent winning-side decisive event to game-winning', () => {
    const router = new ReplayEventRouter();
    router.observe({ type: 'fieldGoal.result', tick: 100, side: 0, good: true, distance: 42 });
    router.observe({ type: 'match.end', tick: 200, winner: 0 });
    expect(router.take()).toBe('GAME_WINNING');
    router.reset();
    router.observe({ type: 'match.end', tick: 200, winner: 1 });
    expect(router.take()).toBeNull();
  });
  it('restores the exact camera transform after free-camera exit', () => {
    const camera = new GameCamera(1, { shake: 0, reducedMotion: true, dolly: 0 });
    camera.camera.position.set(3, 8, -12);
    camera.camera.lookAt(0, 1, 4);
    const before = camera.camera.position.clone();
    const beforeQuaternion = camera.camera.quaternion.clone();
    camera.camera.fov = 47;
    const free = new ReplayFreeCameraController(camera);
    free.enter(0, 1, 4);
    free.orbit(0.2, -0.1);
    free.dolly(-0.2);
    free.update(1 / 60);
    expect(free.isActive).toBe(true);
    expect(camera.camera.position.distanceTo(before)).toBeGreaterThan(0.01);
    free.exit();
    expect(camera.camera.position.distanceTo(before)).toBeLessThan(1e-6);
    expect(1 - Math.abs(camera.camera.quaternion.dot(beforeQuaternion))).toBeLessThan(1e-9);
    expect(camera.camera.fov).toBe(47);
    expect(free.isActive).toBe(false);
  });
  it('keeps the photo camera outside static stadium proxies', () => {
    const camera = new GameCamera(1, { shake: 0, reducedMotion: true, dolly: 0 });
    const free = new ReplayFreeCameraController(camera);
    free.setColliders([{ min: new THREE.Vector3(-3, -1, -3), max: new THREE.Vector3(3, 10, 3) }]);
    free.enter(0, 1, 0);
    free.update(1);
    const p = camera.camera.position;
    expect(p.x < -3.44 || p.x > 3.44 || p.y < -1.44 || p.y > 10.44 || p.z < -3.44 || p.z > 3.44).toBe(true);
    free.clearColliders();
  });

  it('populates photo proxies from visible stadium meshes and clears them', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
    mesh.position.set(8, 2, -3);
    root.add(mesh);
    const proxies = collectPhotoProxies(root);
    expect(proxies).toHaveLength(1);
    expect(proxies[0].min.x).toBeCloseTo(5.82);
    const camera = new GameCamera(1, { shake: 0, reducedMotion: true, dolly: 0 });
    const free = new ReplayFreeCameraController(camera);
    free.setColliders(proxies);
    expect(free.colliderCount).toBe(1);
    free.clearColliders();
    expect(free.colliderCount).toBe(0);
  });

  it('rejects giant merged venue boxes and builds perimeter proxies that do not contain midfield', () => {
    const root = new THREE.Group();
    const merged = new THREE.Mesh(new THREE.BoxGeometry(120, 30, 160));
    merged.name = 'stadium.structure';
    root.add(merged);
    expect(collectPhotoProxies(root)).toHaveLength(0);
    const x = [-50, 50, 50, -50];
    const z = [-20, -20, 120, 120];
    const proxies = bowlPhotoProxies({ loop: { n: 4, x, z }, topY: 25 } as any);
    expect(proxies).toHaveLength(4);
    expect(proxies.some((box) => box.min.x < 0 && box.max.x > 0 && box.min.z < 50 && box.max.z > 50)).toBe(false);
  });

  it('resolves shot targets from recorded transforms rather than always following the ball', () => {
    const view = {
      athletes: Array.from({ length: 14 }, (_, id) => ({
        x: id, y: 0, z: id * 2, facing: 0, phase: 0, state: 'RUN', jersey: id, side: id < 7 ? 0 : 1,
        carry: id === 5 ? 1 : 0,
      })),
      ball: { x: 99, y: 1, z: 88 },
    } as any;
    expect(replayTarget(view, 'BALL')).toEqual(view.ball);
    expect(replayTarget(view, 'CARRIER')).toMatchObject({ x: 5, z: 10 });
    expect(replayTarget(view, 'DEFENDER')).toMatchObject({ x: 7, z: 14 });
  });
});
