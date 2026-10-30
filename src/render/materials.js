// Shared materials + the PS1-style vertex snap. Every lit world material is
// patched so vertices snap to a coarse screen grid, giving the gentle
// "wobble" of late-90s 3D hardware.
import * as THREE from 'three';

export const globalUniforms = {
  uSnapRes: { value: new THREE.Vector2(160, 120) },
  uSnapOn: { value: 1 },
  uTime: { value: 0 },
};

const SNAP = /* glsl */ `
  if (uSnapOn > 0.5 && gl_Position.w > 0.2) {
    vec2 snap = uSnapRes;
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * snap + 0.5) / snap * gl_Position.w;
  }
`;

const SWAY = /* glsl */ `
  {
    vec4 swayWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      swayWorld = instanceMatrix * swayWorld;
    #endif
    swayWorld = modelMatrix * swayWorld;
    float swayH = max(swayWorld.y - 1.0, 0.0);
    float ph = swayWorld.x * 0.11 + swayWorld.z * 0.17;
    transformed.x += sin(uTime * 1.3 + ph) * 0.022 * swayH;
    transformed.z += cos(uTime * 1.05 + ph * 1.3) * 0.016 * swayH;
  }
`;

function header(shader) {
  shader.uniforms.uSnapRes = globalUniforms.uSnapRes;
  shader.uniforms.uSnapOn = globalUniforms.uSnapOn;
  shader.uniforms.uTime = globalUniforms.uTime;
  shader.vertexShader = 'uniform vec2 uSnapRes;\nuniform float uSnapOn;\nuniform float uTime;\n' + shader.vertexShader;
}

function patchSnap(shader) {
  header(shader);
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + SNAP);
}

function patchSnapSway(shader) {
  header(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY)
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + SNAP);
}

export function psx(material, { sway = false } = {}) {
  material.onBeforeCompile = sway ? patchSnapSway : patchSnap;
  material.customProgramCacheKey = () => (sway ? 'psx-sway' : 'psx');
  return material;
}

export function createMaterials(T) {
  const lam = (opts, extra) => psx(new THREE.MeshLambertMaterial(opts), extra);
  const M = {
    grass: lam({ map: T.grass }),
    asphalt: lam({ map: T.asphalt, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    concrete: lam({ map: T.concrete, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    paint: lam({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    siding: lam({ map: T.siding, vertexColors: true }),
    roof: lam({ map: T.shingles, vertexColors: true, side: THREE.DoubleSide }),
    brick: lam({ map: T.brick, vertexColors: true }),
    wood: lam({ map: T.wood, vertexColors: true }),
    garageDoor: lam({ map: T.garageDoor, vertexColors: true }),
    door: lam({ map: T.door, vertexColors: true }),
    plain: lam({ vertexColors: true }),
    flat: lam({ vertexColors: true, flatShading: true }),
    bark: lam({ map: T.bark, vertexColors: true }),
    leaves: lam({ map: T.leaves, vertexColors: true, flatShading: true }, { sway: true }),
    corn: lam({ map: T.corn, alphaTest: 0.5, side: THREE.DoubleSide }, { sway: true }),
    chainlink: lam({ map: T.chainlink, alphaTest: 0.5, side: THREE.DoubleSide }),
    // Unlit / emissive
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    window: new THREE.MeshBasicMaterial({ map: T.window }),
    pool: new THREE.MeshBasicMaterial({
      map: T.pool,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -12,
    }),
    wire: new THREE.LineBasicMaterial({ color: 0x15161a }),
  };
  // Instanced glass/lamps get per-instance colors.
  psx(M.window);
  psx(M.lamp);
  psx(M.glow);
  return M;
}
