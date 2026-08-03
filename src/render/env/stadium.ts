import * as THREE from 'three';
import type { StadiumDef, TeamDef } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { concreteTexture, seatTexture, signageTexture, DISPLAY_FONT } from './textures.ts';
import { GeoBatch, chamferBox, roundedRectLoop, type Loop, type Vec3Like } from './geo.ts';
import type { SkyPalette } from './sky.ts';

/**
 * The bowl.
 *
 * A single swept profile is dragged around a rounded-rectangle loop: perimeter wall → lower rake →
 * concourse → upper rake → parapet → outer skin. Every ring lands in one of four merged batches
 * (structure / seats / signage / accent trim), so the whole stadium is roughly a dozen draw calls
 * at HIGH — scoreboards, light towers and the roof included.
 */

// Inner boundary of the bowl. Sized so the field apron, benches and camera positions all fit
// inside it with room to spare.
export const BOWL_HALF_X = 44;
export const BOWL_HALF_Z = 86;
export const BOWL_RADIUS = 28;
export const BOWL_CENTER_Z = 50;

interface TierSpec {
  lowerRun: number; lowerRise: number;
  upperRun: number; upperRise: number;
  concourse: number;
  towers: number;
}

const TIER: Record<1 | 2 | 3, TierSpec> = {
  1: { lowerRun: 13.5, lowerRise: 9.5, upperRun: 0, upperRise: 0, concourse: 2.8, towers: 4 },
  2: { lowerRun: 16.5, lowerRise: 12.0, upperRun: 13.5, upperRise: 15.5, concourse: 3.4, towers: 6 },
  3: { lowerRun: 19.5, lowerRise: 14.5, upperRun: 20.0, upperRise: 23.0, concourse: 3.9, towers: 8 },
};

type SegKind = 'GROUND' | 'SIGN' | 'STRUCT' | 'DARK' | 'ACCENT' | 'SEAT' | 'OUTER';

interface ProfileSeg { r0: number; y0: number; r1: number; y1: number; kind: SegKind }

/** A raked seating surface, in (radial offset from the loop, height) space. */
export interface SeatBand { rStart: number; rEnd: number; yStart: number; yEnd: number }

export interface BowlLayout {
  loop: Loop;
  bands: SeatBand[];
  topR: number;
  topY: number;
  /** One radial aisle every N loop segments — crowd placement skips these. */
  aisleEvery: number;
  centerZ: number;
}

/** How far inside the loop the bowl floor reaches. Must exceed the field apron's outer corner. */
const GROUND_REACH = 24;

const SEAT_TILE_U = 7.8;   // yards of loop per seat-texture tile (10 seats)
const SEAT_TILE_V = 5.1;   // yards of rake per tile (6 rows)
const SIGN_REPEATS = 9;

function buildProfile(tier: 1 | 2 | 3): { segs: ProfileSeg[]; bands: SeatBand[]; topR: number; topY: number } {
  const T = TIER[tier];
  const segs: ProfileSeg[] = [];
  const bands: SeatBand[] = [];
  // Start inside the loop: a ground apron ring that runs under the field's own apron so there is
  // never a hole between the playing surface and the bowl wall.
  let r = -GROUND_REACH, y = -0.08;
  const to = (dr: number, dy: number, kind: SegKind): void => {
    const seg = { r0: r, y0: y, r1: r + dr, y1: y + dy, kind };
    segs.push(seg);
    if (kind === 'SEAT') bands.push({ rStart: seg.r0, rEnd: seg.r1, yStart: seg.y0, yEnd: seg.y1 });
    r += dr; y += dy;
  };

  to(GROUND_REACH, 0.08, 'GROUND');         // bowl floor, tucked under the field apron
  to(0, 2.7, 'SIGN');                       // padded perimeter wall carrying signage
  to(2.2, 0, 'STRUCT');                     // photographers' walkway
  to(0, 0.75, 'ACCENT');                    // front riser
  to(T.lowerRun, T.lowerRise, 'SEAT');      // lower rake
  to(1.7, 0, 'STRUCT');                     // lower lip
  to(0, T.concourse, 'DARK');               // concourse facade
  to(0, 0.55, 'ACCENT');                    // lit band above the concourse
  to(3.2, 0, 'STRUCT');                     // upper deck floor
  if (tier > 1) {
    to(0, 1.5, 'ACCENT');                   // upper front riser
    to(T.upperRun, T.upperRise, 'SEAT');    // upper rake
  }
  to(1.8, 0, 'STRUCT');                     // top walkway
  to(0, 2.9, 'STRUCT');                     // parapet
  to(0, 0.5, 'ACCENT');                     // parapet cap
  const topR = r, topY = y;
  to(2.6, -y, 'OUTER');                     // outer skin down to grade
  return { segs, bands, topR, topY };
}

export function bowlLayout(tier: 1 | 2 | 3, segments: number): BowlLayout {
  const loop = roundedRectLoop(0, BOWL_CENTER_Z, BOWL_HALF_X, BOWL_HALF_Z, BOWL_RADIUS, segments);
  const { bands, topR, topY } = buildProfile(tier);
  return { loop, bands, topR, topY, aisleEvery: 8, centerZ: BOWL_CENTER_Z };
}

// ───────────────────────────────────────────────────────────────── scoreboard

const BOARD_W = 1024;
const BOARD_H = 384;

interface BoardState { home: number; away: number; quarter: number; clock: string }

function drawBoard(
  g: CanvasRenderingContext2D, s: BoardState,
  home: TeamDef, away: TeamDef, accent: string,
): void {
  g.clearRect(0, 0, BOARD_W, BOARD_H);
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, BOARD_W, BOARD_H);

  // Dot-matrix bloom behind everything.
  g.fillStyle = 'rgba(255,255,255,0.030)';
  for (let y = 6; y < BOARD_H; y += 8) for (let x = 6; x < BOARD_W; x += 8) g.fillRect(x, y, 3, 3);

  // Frame with notched corners.
  g.strokeStyle = accent;
  g.lineWidth = 9;
  g.strokeRect(11, 11, BOARD_W - 22, BOARD_H - 22);
  g.fillStyle = accent;
  for (const [cx, cy] of [[11, 11], [BOARD_W - 11, 11], [11, BOARD_H - 11], [BOARD_W - 11, BOARD_H - 11]]) {
    g.fillRect(cx - 26, cy - 6, 52, 12);
    g.fillRect(cx - 6, cy - 26, 12, 52);
  }

  const side = (x0: number, team: TeamDef, score: number): void => {
    const w = 366;
    // Team chip.
    g.fillStyle = team.colors.primary;
    g.fillRect(x0, 44, w, 74);
    g.fillStyle = team.colors.accent;
    g.fillRect(x0, 112, w, 9);
    g.font = `900 60px ${DISPLAY_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = team.colors.ink;
    g.fillText(team.abbr.toUpperCase(), x0 + w / 2, 84, w - 24);
    // Score.
    const digits = String(Math.max(0, Math.min(199, score | 0))).padStart(2, '0');
    g.save();
    g.shadowColor = '#ffb42a';
    g.shadowBlur = 34;
    g.font = `900 176px ${DISPLAY_FONT}`;
    g.fillStyle = '#ffd45c';
    g.fillText(digits, x0 + w / 2, 244);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 3;
    g.strokeText(digits, x0 + w / 2, 244);
  };
  side(46, home, s.home);
  side(BOARD_W - 46 - 366, away, s.away);

  // Centre column: period + clock.
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(BOARD_W / 2 - 82, 44, 164, 268);
  g.font = `900 54px ${DISPLAY_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = accent;
  const qLabel = s.quarter > 4 ? `OT${s.quarter - 4}` : `Q${Math.max(1, s.quarter)}`;
  g.fillText(qLabel, BOARD_W / 2, 84);
  g.save();
  g.shadowColor = '#57e6ff';
  g.shadowBlur = 22;
  g.font = `900 76px ${DISPLAY_FONT}`;
  g.fillStyle = '#9df3ff';
  g.fillText(s.clock, BOARD_W / 2, 196, 150);
  g.restore();

  // Bottom ticker.
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(30, BOARD_H - 74, BOARD_W - 60, 44);
  g.font = `900 30px ${DISPLAY_FONT}`;
  g.fillStyle = '#e8eef6';
  g.fillText('GRIDIRON OVERDRIVE', BOARD_W / 2, BOARD_H - 51);
}

// ─────────────────────────────────────────────────────────────────── build

export interface StadiumOptions {
  home: TeamDef;
  away: TeamDef;
  stadium: StadiumDef;
  quality: QualitySettings;
  palette: SkyPalette;
}

export interface StadiumHandle {
  group: THREE.Group;
  layout: BowlLayout;
  /** Lamp-head world positions; lighting turns up to four of them into real spot lights. */
  towers: THREE.Vector3[];
  setScore(home: number, away: number, quarter: number, clock: string): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildStadium(reg: SceneRegistry, o: StadiumOptions): StadiumHandle {
  const group = reg.group('env.stadium');
  const q = o.quality;
  const tier = o.stadium.tier;
  const roof = o.stadium.roof;
  const segs = q.tier === 'HIGH' ? 128 : q.tier === 'MEDIUM' ? 96 : 64;
  const layout = bowlLayout(tier, segs);
  const { segs: profile, topR, topY } = buildProfile(tier);
  const loop = layout.loop;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const instanced: THREE.InstancedMesh[] = [];

  const accent = new THREE.Color(o.stadium.accent);
  const concreteCol = new THREE.Color('#9ba1a9').lerp(accent, 0.10);
  const concreteDeep = new THREE.Color('#6f757d').lerp(accent, 0.08);
  const darkCol = new THREE.Color('#2f353d');
  const outerCol = new THREE.Color('#848a92').lerp(accent, 0.16);
  const groundCol = new THREE.Color('#3c4a3a').lerp(accent, 0.05);

  const structure = new GeoBatch();
  const seats = new GeoBatch();
  const sign = new GeoBatch();
  const trim = new GeoBatch();
  structure.uvScale = 0.16;
  trim.uvScale = 0.2;

  const P = (i: number, r: number, y: number): Vec3Like => ({
    x: loop.x[i] + loop.nx[i] * r,
    y,
    z: loop.z[i] + loop.nz[i] * r,
  });
  const outwardOf = (i: number, dr: number, dy: number): Vec3Like => {
    const nx = loop.nx[i], nz = loop.nz[i];
    return { x: -dy * nx, y: dr, z: -dy * nz };
  };

  const seatTintA = new THREE.Color('#ffffff');
  const seatTintB = new THREE.Color('#c9cfd6');
  const tmpCol = new THREE.Color();

  // ── sweep the profile around the loop ─────────────────────────────────
  for (let i = 0; i < loop.n; i++) {
    const j = i + 1;
    const isAisle = i % layout.aisleEvery === 0;
    const s0 = loop.s[i], s1 = loop.s[j];
    for (const seg of profile) {
      const dr = seg.r1 - seg.r0, dy = seg.y1 - seg.y0;
      const out = outwardOf(i, dr, dy);
      const p0 = P(i, seg.r0, seg.y0);
      const p1 = P(j, seg.r0, seg.y0);
      const p2 = P(j, seg.r1, seg.y1);
      const p3 = P(i, seg.r1, seg.y1);

      switch (seg.kind) {
        case 'SIGN': {
          const u0 = (s0 / loop.perimeter) * SIGN_REPEATS;
          const u1 = (s1 / loop.perimeter) * SIGN_REPEATS;
          sign.addQuad(p0, p1, p2, p3, seatTintA, out, [u0, 0, u1, 0, u1, 1, u0, 1]);
          break;
        }
        case 'SEAT': {
          if (isAisle) {
            structure.addQuad(p0, p1, p2, p3, concreteCol, out);
          } else {
            const len = Math.hypot(dr, dy);
            const u0 = s0 / SEAT_TILE_U, u1 = s1 / SEAT_TILE_U;
            const v1 = len / SEAT_TILE_V;
            // Alternate section tints so the bowl reads as blocks of seating, not one slab.
            const sect = Math.floor(i / layout.aisleEvery) % 3;
            tmpCol.copy(sect === 1 ? seatTintB : seatTintA);
            if (sect === 2) tmpCol.lerp(accent, 0.18);
            seats.addQuad(p0, p1, p2, p3, tmpCol, out, [u0, 0, u1, 0, u1, v1, u0, v1]);
          }
          break;
        }
        case 'ACCENT':
          trim.addQuad(p0, p1, p2, p3, accent, out);
          break;
        case 'GROUND':
          structure.addQuad(p0, p1, p2, p3, groundCol, out);
          break;
        case 'DARK':
          structure.addQuad(p0, p1, p2, p3, darkCol, out);
          break;
        case 'OUTER':
          structure.addQuad(p0, p1, p2, p3, i % 4 === 0 ? concreteDeep : outerCol, out);
          break;
        default:
          structure.addQuad(p0, p1, p2, p3, isAisle ? concreteDeep : concreteCol, out);
          break;
      }
    }
  }

  // ── tunnel mouths ─────────────────────────────────────────────────────
  {
    const targets: Array<[number, number]> = [
      [BOWL_HALF_X, 22], [-BOWL_HALF_X, 22], [BOWL_HALF_X, 78], [-BOWL_HALF_X, 78],
    ];
    for (const [tx, tz] of targets) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < loop.n; i++) {
        const d = (loop.x[i] - tx) ** 2 + (loop.z[i] - tz) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      const nx = loop.nx[best], nz = loop.nz[best];
      const yaw = Math.atan2(-nx, -nz);
      const cx = loop.x[best] - nx * 0.10, cz = loop.z[best] - nz * 0.10;
      const m = new THREE.Matrix4().makeRotationY(yaw);
      m.setPosition(cx, 1.20, cz);
      chamferBox(structure, 5.4, 2.4, 0.24, 0.10, new THREE.Color('#0a0c10'), m);
      const fm = new THREE.Matrix4().makeRotationY(yaw);
      fm.setPosition(cx - nx * 0.02, 2.55, cz - nz * 0.02);
      chamferBox(trim, 6.0, 0.42, 0.30, 0.08, accent, fm);
    }
  }

  // ── roof / canopy ─────────────────────────────────────────────────────
  const roofCol = new THREE.Color('#4a5058').lerp(accent, 0.12);
  if (roof >= 1) {
    const innerR = 2.2 + TIER[tier].lowerRun * 0.42;
    const yOuter = topY + 6.4;
    const yInner = topY + 3.5;
    const thick = 0.65;
    for (let i = 0; i < loop.n; i++) {
      const j = i + 1;
      const covered = roof === 2 || Math.abs(loop.nx[i]) > 0.55;
      if (!covered) continue;
      const a0 = P(i, innerR, yInner), a1 = P(j, innerR, yInner);
      const b0 = P(i, topR + 1.4, yOuter), b1 = P(j, topR + 1.4, yOuter);
      const up: Vec3Like = { x: 0, y: 1, z: 0 };
      const down: Vec3Like = { x: 0, y: -1, z: 0 };
      structure.addQuad(a0, a1, b1, b0, roofCol, up);
      const c0 = { x: a0.x, y: a0.y - thick, z: a0.z };
      const c1 = { x: a1.x, y: a1.y - thick, z: a1.z };
      const d0 = { x: b0.x, y: b0.y - thick, z: b0.z };
      const d1 = { x: b1.x, y: b1.y - thick, z: b1.z };
      structure.addQuad(c0, c1, d1, d0, new THREE.Color('#22272e'), down);
      // Bright leading edge — the single strongest silhouette cue in the whole build.
      trim.addQuad(a0, a1, c1, c0, accent, { x: -loop.nx[i], y: 0, z: -loop.nz[i] });
    }
  }
  if (roof === 2) {
    // Translucent centre panel with an exposed truss grid.
    const y = topY + 7.6;
    const gx = BOWL_HALF_X - 2, gz = BOWL_HALF_Z - 2;
    const panel = new THREE.PlaneGeometry(gx * 2, gz * 2, 1, 1);
    panel.rotateX(Math.PI / 2);
    panel.translate(0, y, BOWL_CENTER_Z);
    geos.push(panel);
    const panelMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#151a22'), transparent: true, opacity: 0.88, side: THREE.DoubleSide, fog: true,
    });
    mats.push(panelMat);
    const panelMesh = new THREE.Mesh(panel, panelMat);
    panelMesh.matrixAutoUpdate = false;
    group.add(panelMesh);
    for (let k = -3; k <= 3; k++) {
      const m = new THREE.Matrix4().makeTranslation((k / 3) * gx, y - 0.9, BOWL_CENTER_Z);
      chamferBox(structure, 1.1, 1.1, gz * 2, 0.25, roofCol, m);
    }
    for (let k = -5; k <= 5; k++) {
      const m = new THREE.Matrix4().makeTranslation(0, y - 2.1, BOWL_CENTER_Z + (k / 5) * gz);
      chamferBox(structure, gx * 2, 0.9, 0.9, 0.22, new THREE.Color('#3a4048'), m);
    }
  }

  // ── light towers ──────────────────────────────────────────────────────
  const towers: THREE.Vector3[] = [];
  const towerCount = TIER[tier].towers;
  const mastH = 12 + tier * 2.5;
  {
    const mast = new GeoBatch();
    mast.uvScale = 0.3;
    const steel = new THREE.Color('#5c636c');
    const steelLite = new THREE.Color('#7d858f');
    for (const sx of [-1.5, 1.5]) {
      const m = new THREE.Matrix4().makeTranslation(sx, mastH / 2, 0);
      chamferBox(mast, 0.5, mastH, 0.5, 0.12, steel, m);
    }
    for (let k = 0; k < 6; k++) {
      const y = (k + 0.5) * (mastH / 6);
      const m = new THREE.Matrix4().makeRotationZ(k % 2 === 0 ? 0.9 : -0.9);
      m.setPosition(0, y, 0);
      chamferBox(mast, 0.30, 3.6, 0.30, 0.07, steelLite, m);
    }
    const rack = new THREE.Matrix4().makeTranslation(0, mastH + 1.1, -0.4);
    chamferBox(mast, 7.2, 2.2, 0.7, 0.18, steel, rack);
    const mastGeo = mast.build();
    geos.push(mastGeo);

    const lamp = new GeoBatch();
    lamp.uvScale = 0.5;
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 2; r++) {
        const m = new THREE.Matrix4().makeTranslation(-2.8 + c * 1.4, mastH + 0.55 + r * 1.1, -0.85);
        chamferBox(lamp, 1.15, 0.9, 0.28, 0.08, new THREE.Color('#ffffff'), m);
      }
    }
    const lampGeo = lamp.build();
    geos.push(lampGeo);

    const mastMat = new THREE.MeshPhongMaterial({
      map: concreteTexture(q), vertexColors: true, shininess: 42,
      specular: new THREE.Color(0x555b63), flatShading: true,
    });
    const lampMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#fff6d8').multiplyScalar(o.palette.towerLights ? 1.0 : 0.55),
      toneMapped: false,
    });
    mats.push(mastMat, lampMat);

    const mastMesh = new THREE.InstancedMesh(mastGeo, mastMat, towerCount);
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, towerCount);
    for (let t = 0; t < towerCount; t++) {
      const i = Math.round((t * loop.n) / towerCount) % loop.n;
      const x = loop.x[i] + loop.nx[i] * (topR - 1.0);
      const z = loop.z[i] + loop.nz[i] * (topR - 1.0);
      const yaw = Math.atan2(-loop.nx[i], -loop.nz[i]);
      const m = new THREE.Matrix4().makeRotationY(yaw);
      m.setPosition(x, topY, z);
      mastMesh.setMatrixAt(t, m);
      lampMesh.setMatrixAt(t, m);
      towers.push(new THREE.Vector3(x, topY + mastH + 1, z));
    }
    mastMesh.instanceMatrix.needsUpdate = true;
    lampMesh.instanceMatrix.needsUpdate = true;
    mastMesh.frustumCulled = false;
    lampMesh.frustumCulled = false;
    group.add(mastMesh, lampMesh);
    instanced.push(mastMesh, lampMesh);
  }

  // ── scoreboards ───────────────────────────────────────────────────────
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = BOARD_W; boardCanvas.height = BOARD_H;
  const boardCtx = boardCanvas.getContext('2d');
  if (!boardCtx) throw new Error('2D canvas context unavailable');
  const state: BoardState = { home: 0, away: 0, quarter: 1, clock: '2:00' };
  drawBoard(boardCtx, state, o.home, o.away, o.stadium.accent);
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = q.anisotropy;
  texs.push(boardTex);
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false, fog: true });
  mats.push(boardMat);

  const boardW = tier === 1 ? 24 : tier === 2 ? 30 : 36;
  const boardH = boardW * (BOARD_H / BOARD_W);
  const boardY = topY * (tier === 1 ? 0.66 : 0.60) + boardH * 0.5;
  {
    const boardGeo = new THREE.PlaneGeometry(boardW, boardH, 1, 1);
    geos.push(boardGeo);
    for (const end of [-1, 1] as const) {
      const z = BOWL_CENTER_Z + end * (BOWL_HALF_Z + 1.2);
      const mesh = new THREE.Mesh(boardGeo, boardMat);
      mesh.position.set(0, boardY, z);
      if (end > 0) mesh.rotation.y = Math.PI;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      // Housing + support legs, merged into the structure batch.
      const hm = new THREE.Matrix4().makeTranslation(0, boardY, z + end * 1.3);
      chamferBox(structure, boardW + 2.4, boardH + 2.2, 2.0, 0.5, new THREE.Color('#1b2027'), hm);
      const tm = new THREE.Matrix4().makeTranslation(0, boardY + boardH * 0.5 + 1.5, z + end * 1.3);
      chamferBox(trim, boardW + 2.6, 0.8, 2.2, 0.2, accent, tm);
      for (const sx of [-1, 1]) {
        const lm = new THREE.Matrix4().makeTranslation(sx * boardW * 0.36, boardY * 0.5, z + end * 1.9);
        chamferBox(structure, 1.4, boardY, 1.4, 0.3, concreteDeep, lm);
      }
    }
  }

  // ── bake the merged batches ───────────────────────────────────────────
  const emissive = Math.min(0.85, 0.30 * o.palette.emissiveGain);
  const structureGeo = structure.build();
  const seatsGeo = seats.build();
  const signGeo = sign.build();
  const trimGeo = trim.build();
  geos.push(structureGeo, seatsGeo, signGeo, trimGeo);

  const structureMat = new THREE.MeshPhongMaterial({
    map: concreteTexture(q), vertexColors: true, shininess: 16,
    specular: new THREE.Color(0x3a3f46), flatShading: true,
  });
  const seatsMat = new THREE.MeshPhongMaterial({
    map: seatTexture(o.stadium.crowdTint, q), vertexColors: true, shininess: 30,
    specular: new THREE.Color(0x2c3138),
  });
  const signMat = new THREE.MeshPhongMaterial({
    map: signageTexture(o.stadium.accent, q), vertexColors: true, shininess: 60,
    specular: new THREE.Color(0x565c64),
    emissive: new THREE.Color('#ffffff'), emissiveIntensity: emissive * 0.5,
    emissiveMap: signageTexture(o.stadium.accent, q),
  });
  const trimMat = new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 74, specular: new THREE.Color(0x8a919a),
    emissive: accent.clone().multiplyScalar(emissive), flatShading: true,
  });
  mats.push(structureMat, seatsMat, signMat, trimMat);

  for (const [g, m, name] of [
    [structureGeo, structureMat, 'stadium.structure'],
    [seatsGeo, seatsMat, 'stadium.seats'],
    [signGeo, signMat, 'stadium.signage'],
    [trimGeo, trimMat, 'stadium.trim'],
  ] as Array<[THREE.BufferGeometry, THREE.Material, string]>) {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ── score plumbing ────────────────────────────────────────────────────
  let dirty = false;
  let since = 0;
  let disposed = false;

  return {
    group,
    layout,
    towers,
    setScore(home: number, away: number, quarter: number, clock: string): void {
      if (state.home === home && state.away === away && state.quarter === quarter && state.clock === clock) return;
      state.home = home; state.away = away; state.quarter = quarter; state.clock = clock;
      dirty = true;
    },
    update(dt: number): void {
      since += dt;
      if (dirty && since >= 0.5) {
        since = 0;
        dirty = false;
        drawBoard(boardCtx, state, o.home, o.away, o.stadium.accent);
        boardTex.needsUpdate = true;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const im of instanced) im.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      reg.clearGroup('env.stadium');
    },
  };
}
