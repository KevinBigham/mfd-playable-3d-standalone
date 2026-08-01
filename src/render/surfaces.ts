import * as THREE from 'three';

/**
 * Surface classes and the shader that makes them possible.
 *
 * Every athlete is one `SkinnedMesh` so a full 7-on-7 costs fourteen draw calls, which means one
 * material for the whole body — helmet, jersey, skin and cleats alike. Until now that material
 * was `MeshLambertMaterial`: no specular at all, so a moulded helmet shaded exactly like a cotton
 * sleeve and the athletes read as flat plastic under any light.
 *
 * The fix is to move the surface description into the geometry. Each vertex carries an `aSurf`
 * attribute — roughness, metalness, rim gain — and a small patch to the standard shader reads it
 * instead of the material's uniform values. One draw call, one material, and a helmet that
 * catches the stadium lights while the jersey next to it does not.
 *
 * The rim term is the other half. A dark athlete against dark turf, lit by a single hard key,
 * loses his own silhouette; a view-angle-dependent edge light puts him back on top of the field.
 * It is not physical and it is not trying to be — it is the arcade equivalent of a backlight on
 * a stage, and it is what stops fourteen bodies from merging into one shape in a pile.
 */

export interface Surface {
  /** 0 = mirror, 1 = chalk. */
  rough: number;
  /** 0 = dielectric, 1 = raw metal. */
  metal: number;
  /** How strongly the edge light takes hold, 0..1. */
  rim: number;
}

export const SURF = {
  /** Cloth. Kills highlights so numbers and stripes stay legible. */
  JERSEY: { rough: 0.88, metal: 0.0, rim: 0.55 },
  PANTS: { rough: 0.76, metal: 0.02, rim: 0.45 },
  /** Painted shell with a clear coat: the brightest thing on the field after the ball. */
  HELMET: { rough: 0.19, metal: 0.40, rim: 0.95 },
  VISOR: { rough: 0.06, metal: 0.72, rim: 1.0 },
  /** Facemask, buckles, cleat plates. */
  METAL: { rough: 0.33, metal: 0.85, rim: 0.8 },
  SKIN: { rough: 0.60, metal: 0.0, rim: 0.5 },
  CLEAT: { rough: 0.40, metal: 0.12, rim: 0.6 },
  /** Trim, tape, stripes — a little sheen so accents catch the eye. */
  TRIM: { rough: 0.30, metal: 0.30, rim: 0.9 },
  /** Pebbled leather. */
  LEATHER: { rough: 0.62, metal: 0.0, rim: 0.7 },
  /** Mown grass: rough, but with enough sheen to show the mowing stripes under a low sun. */
  TURF: { rough: 0.82, metal: 0.0, rim: 0.15 },
  /** Painted steel — goalposts, rails. */
  PAINTED_STEEL: { rough: 0.28, metal: 0.55, rim: 0.85 },
  /** Anything that should look completely matte. */
  MATTE: { rough: 0.95, metal: 0.0, rim: 0.3 },
} as const satisfies Record<string, Surface>;

export type SurfaceName = keyof typeof SURF;

/** Shared uniforms so one call can retune every rimmed material in the scene. */
export interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimPower: { value: number };
  uRimGain: { value: number };
}

export function makeRimUniforms(color: THREE.Color, gain = 0.5, power = 2.6): RimUniforms {
  return {
    uRimColor: { value: color.clone() },
    uRimPower: { value: power },
    uRimGain: { value: gain },
  };
}

/**
 * Patch a standard material so it reads per-vertex surface parameters and adds a rim.
 *
 * `perVertex` is off for single-surface objects (the ball, a goalpost) — they still get the rim,
 * they just take roughness and metalness from the material as usual.
 */
export function applySurfaceShader(
  mat: THREE.MeshStandardMaterial, rim: RimUniforms, perVertex: boolean,
): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = rim.uRimColor;
    shader.uniforms.uRimPower = rim.uRimPower;
    shader.uniforms.uRimGain = rim.uRimGain;

    if (perVertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSurf;\nvarying vec3 vSurf;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;');
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         ${perVertex ? 'varying vec3 vSurf;' : ''}
         uniform vec3 uRimColor;
         uniform float uRimPower;
         uniform float uRimGain;`,
      )
      // Roughness and metalness are read from the attribute AFTER the stock chunks have run,
      // so the material's own values act as a fallback when the attribute is absent.
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         ${perVertex ? 'roughnessFactor = clamp(vSurf.x, 0.02, 1.0);' : ''}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         ${perVertex ? 'metalnessFactor = clamp(vSurf.y, 0.0, 1.0);' : ''}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
           vec3 vDir = normalize(vViewPosition);
           float rimT = 1.0 - clamp(dot(normalize(normal), vDir), 0.0, 1.0);
           float rimK = pow(rimT, uRimPower) * uRimGain * ${perVertex ? 'vSurf.z' : '1.0'};
           outgoingLight += uRimColor * rimK;
         }
         #include <opaque_fragment>`,
      );
  };
  // Changing the program source requires a new cache key, or three reuses the unpatched program.
  mat.customProgramCacheKey = () => `go-surface-${perVertex ? 'v' : 's'}`;
}

/** Write a flat `aSurf` attribute over a whole geometry. */
export function tagSurface(geo: THREE.BufferGeometry, s: Surface): void {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = s.rough; a[i * 3 + 1] = s.metal; a[i * 3 + 2] = s.rim; }
  geo.setAttribute('aSurf', new THREE.BufferAttribute(a, 3));
}
