// Turns a camera pose into a finished photo: renders the scene offscreen,
// meters exposure, then runs it through a two-pass "VHS dub" shader
// (motion blur / defocus, then chroma bleed, tracking noise, head-switch
// tearing, scanlines) and burns in a camcorder date stamp.
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle, GLSL_SRGB, supportsHalfFloatRT } from '../render/RetroPipeline.js';
import { globalUniforms } from '../render/materials.js';

export const PHOTO_W = 640;
export const PHOTO_H = 480;

const METER_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  varying vec2 vUv;
  void main() {
    vec3 acc = vec3(0.0);
    for (int x = 0; x < 4; x++) for (int y = 0; y < 4; y++) {
      acc += texture2D(tScene, vUv + (vec2(float(x), float(y)) - 1.5) / vec2(128.0, 96.0)).rgb;
    }
    float lum = dot(acc / 16.0, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(sqrt(clamp(lum, 0.0, 1.0)), 0.0, 0.0, 1.0);
  }
`;

// Pass 1: exposure, motion blur, defocus, tone curve -> sRGB.
const EXPOSE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 res;
  uniform float gain;
  uniform vec2 blurVec;
  uniform float defocus;
  varying vec2 vUv;
  ${GLSL_SRGB}
  void main() {
    vec3 acc = vec3(0.0);
    const int N = 16;
    for (int i = 0; i < N; i++) {
      float fi = float(i);
      float t = fi / float(N - 1) - 0.5;
      float a = fi * 2.39996;
      float r = sqrt((fi + 0.5) / float(N));
      vec2 o = blurVec * t + vec2(cos(a), sin(a)) * r * defocus / res;
      acc += texture2D(tScene, vUv + o).rgb;
    }
    vec3 c = acc / float(N) * gain;
    // Film-ish shoulder: highlights roll off instead of clipping.
    c = 1.0 - exp(-c * 1.15);
    gl_FragColor = vec4(linearToSRGB(c), 1.0);
  }
`;

// Pass 2: the tape.
const VHS_FRAG = /* glsl */ `
  uniform sampler2D tA;
  uniform vec2 res;
  uniform float seed;
  uniform float grain;
  uniform float tracking;
  uniform float trackY;
  uniform float wear;
  varying vec2 vUv;

  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 17.31) * 43758.5453); }
  float h11(float n) { return fract(sin(n * 91.345 + seed * 7.13) * 47453.5453); }
  vec3 toYIQ(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
  vec3 toRGB(vec3 y) { return vec3(y.x + 0.956 * y.y + 0.621 * y.z, y.x - 0.272 * y.y - 0.647 * y.z, y.x - 1.106 * y.y + 1.703 * y.z); }
  float lumaAt(vec2 uv) { return toYIQ(texture2D(tA, uv).rgb).x; }

  void main() {
    vec2 uv = vUv;
    float line = floor(uv.y * res.y);
    float px = 1.0 / res.x;

    // Per-line wobble + slow time-base error.
    float j = (h11(line) - 0.5) * 0.0012 * (0.6 + wear);
    j += sin(uv.y * 24.0 + seed * 6.0) * 0.0007 * wear;
    // Tracking band rolling through the frame.
    float bandD = abs(uv.y - trackY);
    float band = smoothstep(0.05, 0.0, bandD) * tracking;
    j += band * (h11(line + 33.0) - 0.35) * 0.035;
    // Head-switching tear at the bottom of the frame.
    float hs = smoothstep(0.035, 0.0, uv.y);
    j += hs * (0.012 + h11(line + 7.0) * 0.03);
    uv.x += j;

    // Luma: soft, with the classic edge-enhancement halo.
    float Y = lumaAt(uv) * 0.5 + (lumaAt(uv + vec2(px, 0.0)) + lumaAt(uv - vec2(px, 0.0))) * 0.25;
    float Yb = (lumaAt(uv + vec2(3.0 * px, 0.0)) + lumaAt(uv - vec2(3.0 * px, 0.0))) * 0.5;
    Y += (Y - Yb) * 0.55;

    // Chroma: smeared wide and dragged to the right.
    vec2 IQ = vec2(0.0);
    for (int i = -5; i <= 5; i++) {
      IQ += toYIQ(texture2D(tA, uv + vec2((float(i) * 1.6 - 3.5) * px, 0.0)).rgb).yz;
    }
    IQ /= 11.0;
    IQ *= 1.12;

    vec3 col = toRGB(vec3(Y, IQ));

    // Grain (luma) + faint chroma noise.
    float n = h21(vec2(floor(uv.x * res.x * 0.5), line)) - 0.5;
    col += n * grain;
    col += (vec3(h21(vec2(line, uv.x * 91.0)), 0.0, h21(vec2(uv.x * 37.0, line))) - 0.5) * grain * 0.35;
    // Dropouts: short white streaks.
    float drop = step(0.9975 - wear * 0.0015, h21(vec2(floor(uv.x * res.x / 36.0), line)));
    col = mix(col, vec3(0.92), drop * h11(line * 1.7) * 0.8);
    // Tracking band snow.
    col = mix(col, vec3(h21(uv * res)), band * 0.45 * h11(line + 2.0));
    // Head-switch noise.
    col = mix(col, vec3(h21(uv * res + 3.0)) * 0.8, hs * 0.55);

    // Scanlines, lifted blacks, warm-green tape cast.
    col *= 0.93 + 0.07 * sin(vUv.y * res.y * 3.14159);
    col = col * vec3(1.0, 1.0, 0.95) * 0.94 + vec3(0.03, 0.035, 0.04);
    vec2 d = vUv - 0.5;
    col *= 1.0 - dot(d, d) * 0.55;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class Developer {
  constructor(renderer) {
    this.renderer = renderer;
    const type = supportsHalfFloatRT(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.sceneRT = new THREE.WebGLRenderTarget(PHOTO_W, PHOTO_H, { type, depthBuffer: true });
    this.meterRT = new THREE.WebGLRenderTarget(32, 24, { type: THREE.UnsignedByteType });
    this.aRT = new THREE.WebGLRenderTarget(PHOTO_W, PHOTO_H, { type: THREE.UnsignedByteType });
    this.outRT = new THREE.WebGLRenderTarget(PHOTO_W, PHOTO_H, { type: THREE.UnsignedByteType });

    const tri = fullscreenTriangle();
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    this.meterMat = mk(METER_FRAG, { tScene: { value: this.sceneRT.texture } });
    this.exposeMat = mk(EXPOSE_FRAG, {
      tScene: { value: this.sceneRT.texture },
      res: { value: new THREE.Vector2(PHOTO_W, PHOTO_H) },
      gain: { value: 1 },
      blurVec: { value: new THREE.Vector2() },
      defocus: { value: 0 },
    });
    this.vhsMat = mk(VHS_FRAG, {
      tA: { value: this.aRT.texture },
      res: { value: new THREE.Vector2(PHOTO_W, PHOTO_H) },
      seed: { value: 0 },
      grain: { value: 0.04 },
      tracking: { value: 0 },
      trackY: { value: 0.5 },
      wear: { value: 0.5 },
    });
    this.quad = new THREE.Mesh(tri, this.meterMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.meterBuf = new Uint8Array(32 * 24 * 4);
    this.pixBuf = new Uint8Array(PHOTO_W * PHOTO_H * 4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = PHOTO_W;
    this.canvas.height = PHOTO_H;
    this.ctx = this.canvas.getContext('2d');
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  // opts: { scene, camera, glows, iso, grain, maxShutter, angVel(Vector2 rad/s),
  //         linSpeed, defocusPx, stampLines:[..], frameNo, seed }
  develop(opts) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const snapRes = globalUniforms.uSnapRes.value.clone();
    globalUniforms.uSnapRes.value.set(PHOTO_W * 0.4, PHOTO_H * 0.4);
    opts.glows?.setScale(PHOTO_H, opts.camera.fov);

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(opts.scene, opts.camera);

    // Meter.
    this._pass(this.meterMat, this.meterRT);
    r.readRenderTargetPixels(this.meterRT, 0, 0, 32, 24, this.meterBuf);
    let sum = 0;
    let logSum = 0;
    for (let i = 0; i < 32 * 24; i++) {
      const v = this.meterBuf[i * 4] / 255;
      const lum = v * v;
      sum += lum;
      logSum += Math.log(lum + 0.0005);
    }
    const mean = sum / (32 * 24);
    const geo = Math.exp(logSum / (32 * 24));
    // Center-weighted-ish blend of average and geometric mean.
    const metered = Math.max(0.0008, mean * 0.6 + geo * 0.4);

    // Exposure model: the camera lengthens the shutter until it either
    // reaches a good exposure or hits its slowest speed.
    const target = 0.16;
    const needed = target / metered; // brightness multiplier we'd like
    const isoK = opts.iso / 400;
    const baseShutter = 1 / 60;
    const wantShutter = (baseShutter * needed) / isoK;
    const shutter = Math.min(Math.max(wantShutter, 1 / 1000), opts.maxShutter);
    const achieved = (shutter / baseShutter) * isoK;
    const gain = Math.max(0.35, Math.min(needed, achieved));
    const evError = Math.log2((metered * gain) / target);

    // Motion blur in pixels from hand shake during the exposure.
    const pxPerRad = PHOTO_H / THREE.MathUtils.degToRad(opts.camera.fov);
    const bx = opts.angVel.x * shutter * pxPerRad + opts.linSpeed * shutter * 30;
    const by = opts.angVel.y * shutter * pxPerRad;
    const blurPx = Math.hypot(bx, by);

    const eu = this.exposeMat.uniforms;
    eu.gain.value = gain;
    eu.blurVec.value.set(-bx / PHOTO_W, by / PHOTO_H);
    eu.defocus.value = opts.defocusPx;
    this._pass(this.exposeMat, this.aRT);

    const vu = this.vhsMat.uniforms;
    vu.seed.value = opts.seed % 1000;
    const pushed = Math.max(0, Math.log2(Math.max(1, gain)) - 1);
    vu.grain.value = opts.grain + pushed * 0.018;
    vu.tracking.value = Math.random() < 0.35 ? 0.4 + Math.random() * 0.6 : 0;
    vu.trackY.value = 0.1 + Math.random() * 0.85;
    vu.wear.value = 0.35 + Math.random() * 0.4;
    this._pass(this.vhsMat, this.outRT);

    r.readRenderTargetPixels(this.outRT, 0, 0, PHOTO_W, PHOTO_H, this.pixBuf);
    r.setRenderTarget(prevTarget);
    globalUniforms.uSnapRes.value.copy(snapRes);

    // Flip into the 2D canvas.
    const img = this.ctx.createImageData(PHOTO_W, PHOTO_H);
    const row = PHOTO_W * 4;
    for (let y = 0; y < PHOTO_H; y++) {
      img.data.set(this.pixBuf.subarray((PHOTO_H - 1 - y) * row, (PHOTO_H - y) * row), y * row);
    }
    this.ctx.putImageData(img, 0, 0);
    this._stamp(opts.stampLines, opts.frameNo);

    // Measured brightness of the final image (for grading).
    let fsum = 0;
    for (let i = 0; i < 32 * 24; i++) {
      const v = this.meterBuf[i * 4] / 255;
      fsum += Math.min(1, v * v * gain);
    }
    return { canvas: this.canvas, metered, gain, shutter, evError, blurPx, finalMean: fsum / (32 * 24) };
  }

  // Camcorder OSD text, with a little chroma ghosting so it sits in the tape.
  _stamp(lines, frameNo) {
    const g = this.ctx;
    g.save();
    g.font = '34px "VT323", "Courier New", monospace';
    g.textBaseline = 'alphabetic';
    const draw = (text, x, y) => {
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillText(text, x + 3, y + 3);
      g.fillStyle = 'rgba(255,60,60,0.45)';
      g.fillText(text, x - 2, y);
      g.fillStyle = 'rgba(60,200,255,0.4)';
      g.fillText(text, x + 2, y);
      g.fillStyle = 'rgba(250,250,240,0.95)';
      g.fillText(text, x, y);
    };
    draw(lines[0], 34, PHOTO_H - 64);
    draw(lines[1], 34, PHOTO_H - 32);
    g.textAlign = 'right';
    draw('SP', PHOTO_W - 34, 48);
    if (frameNo != null) draw(`No.${String(frameNo).padStart(3, '0')}`, PHOTO_W - 34, PHOTO_H - 32);
    g.restore();
  }

  toBlob(quality = 0.82) {
    return new Promise((resolve) => {
      if (this.canvas.toBlob) this.canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      else resolve(null);
    });
  }

  toDataURL(quality = 0.82) {
    return this.canvas.toDataURL('image/jpeg', quality);
  }
}
