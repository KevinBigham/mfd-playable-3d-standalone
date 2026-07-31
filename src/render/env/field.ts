import * as THREE from 'three';
import type { Conditions, StadiumDef, TeamDef } from '../../core/types.ts';
import type { SceneRegistry, QualitySettings } from '../registry.ts';
import { fieldMarkingsTexture, turfTexture, SURFACE_LOOK } from './textures.ts';
import { GeoBatch, chamferBox } from './geo.ts';

/**
 * The playing surface and everything painted, planted or parked on it.
 *
 * The 120 × 53.33 yd surface is ONE mesh with ONE material: a tiling turf detail map and the
 * single field-markings colour map are combined inside the shader, so every yard line, number,
 * hash and end-zone wordmark costs zero extra draw calls.
 */

const HALF_W = 26.665;
const LENGTH = 120;          // z ∈ [-10, 110]
const CENTER_Z = 50;
const TURF_TILE = 10;        // yards per turf detail tile
/** Apron reaches the largest rectangle that fits inside the stadium bowl's inner wall. */
const APRON_OUT_X = 37;
const APRON_OUT_Z = 9;       // beyond each end line

export const GOAL_HALF_WIDTH = 9.25;
export const CROSSBAR_Y = 10 / 3;          // 10 feet
export const UPRIGHT_TOP_Y = CROSSBAR_Y + 10;

export interface GoalInfo {
  /** Crossbar centre of the goal defended at z = 0. */
  home: THREE.Vector3;
  /** Crossbar centre of the goal defended at z = 100. */
  away: THREE.Vector3;
  halfWidth: number;
  crossbarY: number;
  uprightTopY: number;
  /** Tops of all four uprights, for effects and camera framing. */
  uprightTops: THREE.Vector3[];
}

export interface FieldOptions {
  home: TeamDef;
  away: TeamDef;
  stadium: StadiumDef;
  conditions: Conditions;
  quality: QualitySettings;
}

export interface FieldHandle {
  group: THREE.Group;
  turf: THREE.Mesh;
  goal: GoalInfo;
  setLos(z: number): void;
  setFirstDown(z: number): void;
  setMarkersVisible(v: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

function markerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.34, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.46, 'rgba(255,255,255,1)');
  grad.addColorStop(0.54, 'rgba(255,255,255,1)');
  grad.addColorStop(0.66, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildField(reg: SceneRegistry, o: FieldOptions): FieldHandle {
  const group = reg.group('env.field');
  const q = o.quality;
  const surface = o.conditions.surface ?? o.stadium.surface;
  const look = SURFACE_LOOK[surface];

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const keepM = <T extends THREE.Material>(m: T): T => { mats.push(m); return m; };

  // ── turf + markings, one mesh ──────────────────────────────────────────
  const detail = turfTexture(surface, q);
  const marks = fieldMarkingsTexture({
    home: o.home.colors,
    away: o.away.colors,
    homeLabel: o.home.name,
    awayLabel: o.away.name,
    surface,
    accent: o.stadium.accent,
    quality: q,
  });

  const turfGeo = keep(new THREE.PlaneGeometry(HALF_W * 2, LENGTH, 1, 1));
  turfGeo.rotateX(-Math.PI / 2);
  turfGeo.translate(0, 0, CENTER_Z);

  const turfMat = keepM(new THREE.MeshPhongMaterial({
    map: detail,
    color: 0xffffff,
    specular: new THREE.Color(surface === 'FROZEN' ? 0x3a4650 : 0x161c14),
    shininess: surface === 'FROZEN' ? 46 : surface === 'MUD' ? 26 : 14,
  }));
  turfMat.onBeforeCompile = (shader) => {
    shader.uniforms.uMarks = { value: marks };
    shader.uniforms.uTurfRepeat = { value: new THREE.Vector2((HALF_W * 2) / TURF_TILE, LENGTH / TURF_TILE) };
    shader.uniforms.uDetailBias = { value: 0.24 };
    shader.uniforms.uDetailGain = { value: 1.52 };
    shader.fragmentShader =
      'uniform sampler2D uMarks;\nuniform vec2 uTurfRepeat;\nuniform float uDetailBias;\nuniform float uDetailGain;\n'
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      [
        'vec3 goPaint = texture2D( uMarks, vMapUv ).rgb;',
        'vec3 goNap = texture2D( map, vMapUv * uTurfRepeat ).rgb;',
        'diffuseColor.rgb *= goPaint * ( uDetailBias + uDetailGain * goNap );',
      ].join('\n'),
    );
  };
  turfMat.customProgramCacheKey = () => 'go-env-turf';

  const turf = new THREE.Mesh(turfGeo, turfMat);
  turf.name = 'turf';
  turf.receiveShadow = q.shadows;
  turf.matrixAutoUpdate = false;
  turf.updateMatrix();
  group.add(turf);

  // ── apron ──────────────────────────────────────────────────────────────
  {
    const apron = new GeoBatch();
    const col = new THREE.Color(look.blotch).multiplyScalar(1.55);
    const inset = 0.06;   // tuck under the field edge; polygonOffset keeps the field on top
    const quad = (x0: number, x1: number, z0: number, z1: number): void => {
      const u = (v: number): number => v / TURF_TILE;
      apron.addQuad(
        { x: x0, y: 0, z: z0 }, { x: x1, y: 0, z: z0 }, { x: x1, y: 0, z: z1 }, { x: x0, y: 0, z: z1 },
        col, { x: 0, y: 1, z: 0 },
        [u(x0), u(z0), u(x1), u(z0), u(x1), u(z1), u(x0), u(z1)],
      );
    };
    quad(-APRON_OUT_X, -HALF_W + inset, -10 - APRON_OUT_Z, 110 + APRON_OUT_Z);
    quad(HALF_W - inset, APRON_OUT_X, -10 - APRON_OUT_Z, 110 + APRON_OUT_Z);
    quad(-HALF_W + inset, HALF_W - inset, -10 - APRON_OUT_Z, -10 + inset);
    quad(-HALF_W + inset, HALF_W - inset, 110 - inset, 110 + APRON_OUT_Z);
    const g = keep(apron.build());
    const m = keepM(new THREE.MeshPhongMaterial({
      map: detail, vertexColors: true, shininess: 8, specular: new THREE.Color(0x0c0f0c),
      polygonOffset: true, polygonOffsetFactor: 1.4, polygonOffsetUnits: 1.4,
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = q.shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ── goalposts ──────────────────────────────────────────────────────────
  const goal: GoalInfo = {
    home: new THREE.Vector3(0, CROSSBAR_Y, 0),
    away: new THREE.Vector3(0, CROSSBAR_Y, 100),
    halfWidth: GOAL_HALF_WIDTH,
    crossbarY: CROSSBAR_Y,
    uprightTopY: UPRIGHT_TOP_Y,
    uprightTops: [
      new THREE.Vector3(-GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 0),
      new THREE.Vector3(GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 0),
      new THREE.Vector3(-GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 100),
      new THREE.Vector3(GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, 100),
    ],
  };
  {
    const batch = new GeoBatch();
    batch.uvScale = 0.5;
    const metal = new THREE.Color('#ffd21e');
    const metalDark = new THREE.Color('#c99b10');
    const pad = new THREE.Color('#1b1f26');
    const seg = q.tier === 'LOW' ? 6 : 10;

    const tube = (radius: number, from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color): void => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      if (len < 1e-5) return;
      const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1, false);
      const m = new THREE.Matrix4();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      m.compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat, new THREE.Vector3(1, 1, 1));
      batch.addGeometry(g, m, color);
    };

    for (const gz of [0, 100]) {
      const back = gz === 0 ? -1 : 1;           // away from the field of play
      const baseZ = gz + back * 1.35;
      // Padded base sleeve.
      const padGeo = new THREE.CylinderGeometry(0.34, 0.38, 1.9, seg, 1, false);
      const padM = new THREE.Matrix4().makeTranslation(0, 0.95, baseZ);
      batch.addGeometry(padGeo, padM, pad);
      // Main post.
      tube(0.17, new THREE.Vector3(0, 0.1, baseZ), new THREE.Vector3(0, CROSSBAR_Y - 0.55, baseZ), metalDark);
      // Gooseneck: quarter sweep from the post top forward to the crossbar centre.
      const pts: THREE.Vector3[] = [];
      const steps = q.tier === 'LOW' ? 5 : 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = (t * Math.PI) / 2;
        pts.push(new THREE.Vector3(
          0,
          CROSSBAR_Y - 0.55 + Math.sin(a) * 0.55,
          baseZ - back * (1 - Math.cos(a)) * 1.35,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      batch.addGeometry(new THREE.TubeGeometry(curve, steps * 2, 0.15, seg, false), null, metalDark);
      // Crossbar + uprights.
      tube(0.14, new THREE.Vector3(-GOAL_HALF_WIDTH, CROSSBAR_Y, gz), new THREE.Vector3(GOAL_HALF_WIDTH, CROSSBAR_Y, gz), metal);
      for (const sx of [-1, 1]) {
        tube(0.115, new THREE.Vector3(sx * GOAL_HALF_WIDTH, CROSSBAR_Y - 0.12, gz), new THREE.Vector3(sx * GOAL_HALF_WIDTH, UPRIGHT_TOP_Y, gz), metal);
        // Wind ribbon at the top of each upright.
        const rib = new THREE.PlaneGeometry(0.12, 1.0);
        const rm = new THREE.Matrix4().makeRotationY(Math.PI / 2);
        rm.setPosition(sx * GOAL_HALF_WIDTH, UPRIGHT_TOP_Y - 0.55, gz + 0.16);
        batch.addGeometry(rib, rm, new THREE.Color('#ff5a2a'));
      }
    }
    const g = keep(batch.build());
    const m = keepM(new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 88, specular: new THREE.Color(0x8f7a2a), side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = q.shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ── LOS + first-down markers ───────────────────────────────────────────
  const markerGroup = new THREE.Group();
  markerGroup.name = 'field.markers';
  group.add(markerGroup);
  const markTex = markerTexture();
  texs.push(markTex);
  const markGeo = keep(new THREE.PlaneGeometry(HALF_W * 2, 1.5, 1, 1));
  markGeo.rotateX(-Math.PI / 2);

  const makeMarker = (hex: number, y: number): { root: THREE.Group; mat: THREE.MeshBasicMaterial } => {
    const root = new THREE.Group();
    const mat = keepM(new THREE.MeshBasicMaterial({
      map: markTex, color: hex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const plane = new THREE.Mesh(markGeo, mat);
    plane.position.y = y;
    plane.renderOrder = 2;
    root.add(plane);
    // Chain-gang pylons on both sidelines so the line reads even side-on.
    const postGeo = keep(new THREE.BoxGeometry(0.18, 1.7, 0.18));
    const postMat = keepM(new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }));
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(sx * (HALF_W + 1.4), 0.85, 0);
      root.add(p);
    }
    markerGroup.add(root);
    return { root, mat };
  };
  const los = makeMarker(0x63d4ff, 0.035);
  const firstDown = makeMarker(0xffd23f, 0.05);

  // ── sideline dressing ──────────────────────────────────────────────────
  const propMat = keepM(new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 34, specular: new THREE.Color(0x2a2f36), flatShading: true,
  }));
  const instanced: THREE.InstancedMesh[] = [];

  const addInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, xforms: THREE.Matrix4[]): void => {
    if (xforms.length === 0) return;
    const im = new THREE.InstancedMesh(geo, mat, xforms.length);
    for (let i = 0; i < xforms.length; i++) im.setMatrixAt(i, xforms[i]);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = q.shadows;
    im.receiveShadow = false;
    im.frustumCulled = false;
    group.add(im);
    instanced.push(im);
  };
  const xf = (x: number, y: number, z: number, yaw: number): THREE.Matrix4 => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    return m;
  };

  const teamCol: [THREE.Color, THREE.Color] = [
    new THREE.Color(o.home.colors.primary),
    new THREE.Color(o.away.colors.primary),
  ];
  const frame = new THREE.Color('#2b3038');
  const frameLite = new THREE.Color('#454c56');

  // Bench (one geometry, tinted per side via two instanced meshes).
  for (const side of [0, 1] as const) {
    const b = new GeoBatch();
    b.uvScale = 0.3;
    chamferBox(b, 7.0, 0.22, 1.0, 0.06, teamCol[side], new THREE.Matrix4().makeTranslation(0, 1.02, 0));
    chamferBox(b, 7.0, 0.85, 0.16, 0.05, teamCol[side].clone().multiplyScalar(0.7), new THREE.Matrix4().makeTranslation(0, 1.52, -0.42));
    for (const lx of [-3.1, -1.0, 1.0, 3.1]) {
      chamferBox(b, 0.18, 1.0, 0.8, 0.04, frame, new THREE.Matrix4().makeTranslation(lx, 0.5, 0));
    }
    const g = keep(b.build());
    const z0 = side === 0 ? 34 : 66;
    addInstanced(g, propMat, [
      xf(-32.0, 0, z0 - 9, Math.PI / 2),
      xf(-32.0, 0, z0 + 1, Math.PI / 2),
      xf(32.0, 0, z0 - 9, -Math.PI / 2),
      xf(32.0, 0, z0 + 1, -Math.PI / 2),
    ]);
  }

  // Utility cart.
  {
    const b = new GeoBatch();
    b.uvScale = 0.35;
    chamferBox(b, 3.0, 0.9, 1.6, 0.12, frameLite, new THREE.Matrix4().makeTranslation(0, 0.95, 0));
    chamferBox(b, 2.6, 0.14, 1.5, 0.05, new THREE.Color(o.stadium.accent), new THREE.Matrix4().makeTranslation(0, 2.35, 0));
    for (const px of [-1.1, 1.1]) {
      for (const pz of [-0.62, 0.62]) {
        chamferBox(b, 0.12, 1.3, 0.12, 0.03, frame, new THREE.Matrix4().makeTranslation(px, 1.72, pz));
      }
    }
    for (const wx of [-1.05, 1.05]) {
      for (const wz of [-0.78, 0.78]) {
        const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 10);
        const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
        m.setPosition(wx, 0.36, wz);
        b.addGeometry(wheel, m, new THREE.Color('#14171c'));
      }
    }
    const g = keep(b.build());
    addInstanced(g, propMat, [
      xf(-35.5, 0, 18, Math.PI / 2),
      xf(35.5, 0, 82, -Math.PI / 2),
      xf(-35.5, 0, 88, Math.PI / 2),
    ]);
  }

  // Tripod broadcast camera.
  {
    const b = new GeoBatch();
    b.uvScale = 0.5;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationZ(Math.cos(a) * 0.30);
      m.multiply(new THREE.Matrix4().makeRotationX(Math.sin(a) * 0.30));
      m.setPosition(Math.sin(a) * 0.42, 1.05, Math.cos(a) * 0.42);
      chamferBox(b, 0.11, 2.1, 0.11, 0.03, frame, m);
    }
    chamferBox(b, 0.9, 0.62, 1.25, 0.10, new THREE.Color('#20252c'), new THREE.Matrix4().makeTranslation(0, 2.35, 0));
    const lens = new THREE.CylinderGeometry(0.20, 0.24, 0.55, 10);
    const lm = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    lm.setPosition(0, 2.35, 0.82);
    b.addGeometry(lens, lm, new THREE.Color('#0c0e12'));
    chamferBox(b, 0.30, 0.16, 0.16, 0.03, new THREE.Color('#ff3b2f'), new THREE.Matrix4().makeTranslation(0, 2.72, 0.25));
    const g = keep(b.build());
    addInstanced(g, propMat, [
      xf(-34.0, 0, 50, Math.PI / 2),
      xf(34.0, 0, 50, -Math.PI / 2),
      xf(-34.0, 0, 6, Math.PI / 2.4),
      xf(34.0, 0, 94, -Math.PI / 2.4),
    ]);
  }

  // End-zone pylons: four per end zone, at the goal-line and end-line corners.
  {
    const b = new GeoBatch();
    b.uvScale = 1.0;
    chamferBox(b, 0.42, 1.5, 0.42, 0.10, new THREE.Color('#ff7a1a'), new THREE.Matrix4().makeTranslation(0, 0.75, 0));
    const g = keep(b.build());
    const m = keepM(new THREE.MeshPhongMaterial({
      vertexColors: true, emissive: new THREE.Color('#5a2200'),
      emissiveIntensity: 1, shininess: 60, specular: new THREE.Color(0x554433),
    }));
    const xs = [-HALF_W, HALF_W];
    const zs = [-10, 0, 100, 110];
    const list: THREE.Matrix4[] = [];
    for (const x of xs) for (const z of zs) list.push(xf(x, 0, z, 0));
    addInstanced(g, m, list);
  }

  let pulse = 0;
  let disposed = false;

  return {
    group,
    turf,
    goal,
    setLos(z: number): void { los.root.position.z = z; },
    setFirstDown(z: number): void { firstDown.root.position.z = z; },
    setMarkersVisible(v: boolean): void { markerGroup.visible = v; },
    update(dt: number): void {
      pulse += dt;
      const a = 0.72 + Math.sin(pulse * 3.1) * 0.14;
      los.mat.opacity = a;
      firstDown.mat.opacity = 0.80 + Math.sin(pulse * 3.1 + 1.1) * 0.16;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const im of instanced) im.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      reg.clearGroup('env.field');
    },
  };
}
