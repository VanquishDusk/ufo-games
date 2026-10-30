// Renders the world into a small offscreen buffer, then blows it up to the
// screen with nearest filtering, ordered dithering and a 15-bit-ish palette.
import * as THREE from 'three';
import { globalUniforms } from './materials.js';

export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

export const GLSL_SRGB = /* glsl */ `
  vec3 linearToSRGB(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
`;

const RETRO_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 lowRes;
  uniform float levels;
  uniform float dither;
  uniform float fade;
  uniform vec3 tint;
  varying vec2 vUv;
  ${GLSL_SRGB}
  float bayer4(vec2 p) {
    vec2 q = mod(p, 4.0);
    int i = int(q.x) + int(q.y) * 4;
    float m[16];
    m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
    m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
    m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
    for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
    return 0.0;
  }
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    // Soft shoulder so additive glows don't clip harshly.
    c = c / (1.0 + max(c - 0.85, 0.0) * 0.8);
    c = linearToSRGB(c) * tint;
    vec2 px = floor(vUv * lowRes);
    c += (bayer4(px) - 0.5) * dither / levels;
    c = floor(c * levels + 0.5) / levels;
    vec2 d = vUv - 0.5;
    c *= 1.0 - dot(d, d) * 0.35;
    gl_FragColor = vec4(c * fade, 1.0);
  }
`;

export function supportsHalfFloatRT(renderer) {
  const gl = renderer.getContext();
  return !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
}

export class RetroPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.targetHeight = 300;
    this.wobble = true;
    this.halfFloat = supportsHalfFloatRT(renderer);
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        lowRes: { value: new THREE.Vector2(4, 4) },
        levels: { value: 31 },
        dither: { value: 1 },
        fade: { value: 1 },
        tint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: RETRO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.width = 4;
    this.height = 4;
  }

  setSize(w, h) {
    this.screenW = w;
    this.screenH = h;
    const lh = Math.max(120, Math.min(this.targetHeight, h));
    const lw = Math.max(160, Math.round((lh * w) / h));
    this.width = lw;
    this.height = lh;
    this.target.setSize(lw, lh);
    this.material.uniforms.lowRes.value.set(lw, lh);
    this.applySnap();
  }

  applySnap() {
    globalUniforms.uSnapOn.value = this.wobble ? 1 : 0;
    globalUniforms.uSnapRes.value.set(this.width * 0.5, this.height * 0.5);
  }

  render(scene, camera) {
    const r = this.renderer;
    this.applySnap();
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
