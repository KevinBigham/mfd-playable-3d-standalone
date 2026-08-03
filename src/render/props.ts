import * as THREE from 'three';
import type { SceneRegistry, QualitySettings } from './registry.ts';
import type { TeamColors } from '../core/types.ts';

/** The football: a lathed prolate spheroid with laces and stripes. */
export function buildBall(reg: SceneRegistry): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  // 16in by 10in — about half again life size, which is the smallest a ball stays readable at
  // twenty yards. It used to be 24in by 14in: sized against athletes who were seven feet tall,
  // and once they became six foot three it was a watermelon.
  const L = 0.225, R = 0.135;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = (t - 0.5) * 2 * L;
    const r = R * Math.pow(Math.max(0, 1 - (y / L) * (y / L)), 0.62);
    pts.push(new THREE.Vector2(Math.max(0.004, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a4520 });
  reg.trackAll(geo, mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;

  const laceGeo = new THREE.BoxGeometry(0.024, 0.014, 0.132);
  const laceMat = new THREE.MeshBasicMaterial({ color: 0xf2ede2 });
  reg.trackAll(laceGeo, laceMat);
  const lace = new THREE.Mesh(laceGeo, laceMat);
  lace.position.set(0, 0.133, 0);
  mesh.add(lace);

  const stripeGeo = new THREE.TorusGeometry(0.113, 0.011, 4, 14);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf2ede2 });
  reg.trackAll(stripeGeo, stripeMat);
  for (const z of [-0.095, 0.095]) {
    const s = new THREE.Mesh(stripeGeo, stripeMat);
    s.position.set(0, 0, z);
    mesh.add(s);
  }
  reg.group('ball').add(mesh);
  return mesh;
}

export interface Markers {
  group: THREE.Group;
  /** Ring under each human-controlled athlete. */
  rings: THREE.Mesh[];
  /** Floating chevron over the ball carrier. */
  carrierMark: THREE.Mesh;
  /** Receiver target badges (3). */
  targets: THREE.Sprite[];
  /** Ball landing spot reticle. */
  reticle: THREE.Mesh;
  dispose(): void;
}

function badgeTexture(label: string, fill: string, ink: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(64, 68, 50, 0, Math.PI * 2); g.fill();
  g.fillStyle = fill;
  g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.fill();
  g.lineWidth = 7; g.strokeStyle = ink;
  g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ink;
  g.font = 'bold 74px Impact, "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMarkers(reg: SceneRegistry, colors: [TeamColors, TeamColors], quality: QualitySettings): Markers {
  const group = reg.group('markers');
  const rings: THREE.Mesh[] = [];
  const ringGeo = new THREE.RingGeometry(0.62, 0.86, 20);
  ringGeo.rotateX(-Math.PI / 2);
  reg.track(ringGeo);
  const seatColors = ['#3fd0ff', '#ff5a4a', '#ffd23f', '#78ff8a'];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.MeshBasicMaterial({ color: seatColors[i], transparent: true, opacity: 0.9, depthWrite: false });
    reg.track(m);
    const mesh = new THREE.Mesh(ringGeo, m);
    mesh.visible = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    rings.push(mesh);
  }

  const chevGeo = new THREE.ConeGeometry(0.34, 0.5, 4);
  chevGeo.rotateX(Math.PI);
  const chevMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, depthWrite: false, transparent: true });
  reg.trackAll(chevGeo, chevMat);
  const carrierMark = new THREE.Mesh(chevGeo, chevMat);
  carrierMark.renderOrder = 4;
  carrierMark.visible = false;
  group.add(carrierMark);

  const targets: THREE.Sprite[] = [];
  const labels = ['◀', '▲', '▶'];
  for (let i = 0; i < 3; i++) {
    const tex = badgeTexture(labels[i], colors[0].accent, colors[0].ink);
    reg.track(tex);
    const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    reg.track(m);
    const sp = new THREE.Sprite(m);
    sp.scale.set(1.25, 1.25, 1);
    sp.visible = false;
    sp.renderOrder = 6;
    group.add(sp);
    targets.push(sp);
  }

  const retGeo = new THREE.RingGeometry(0.75, 1.05, 22);
  retGeo.rotateX(-Math.PI / 2);
  const retMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  reg.trackAll(retGeo, retMat);
  const reticle = new THREE.Mesh(retGeo, retMat);
  reticle.visible = false;
  reticle.renderOrder = 3;
  group.add(reticle);

  void quality;
  return {
    group, rings, carrierMark, targets, reticle,
    dispose(): void {
      ringGeo.dispose(); chevGeo.dispose(); chevMat.dispose(); retGeo.dispose(); retMat.dispose();
      for (const r of rings) (r.material as THREE.Material).dispose();
      for (const t of targets) { const m = t.material as THREE.SpriteMaterial; m.map?.dispose(); m.dispose(); }
    },
  };
}

/** Jersey-number sprite floating above a human-controlled athlete. */
export function makeNumberSprite(reg: SceneRegistry, text: string, fill: string, ink: string): THREE.Sprite {
  const tex = badgeTexture(text, fill, ink);
  reg.track(tex);
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  reg.track(m);
  const sp = new THREE.Sprite(m);
  sp.scale.set(1.0, 1.0, 1);
  sp.renderOrder = 7;
  return sp;
}
