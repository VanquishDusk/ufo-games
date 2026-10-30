// Sky dome, stars, moon, clouds and the time-of-day palette that drives all
// scene lighting and fog.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

// Keyframes in sRGB hex; converted to linear by THREE.Color.
const KEYS = [
  { h: 0.0, top: '#03050c', hor: '#0c1326', fog: '#0a0f1c', sun: '#000000', sunI: 0, moonI: 0.22, sky: '#2a3a64', gnd: '#0c0e14', hemi: 0.42, cloud: '#1a2232', glow: '#3a2a20' },
  { h: 4.6, top: '#04060f', hor: '#0e1428', fog: '#0b101e', sun: '#000000', sunI: 0, moonI: 0.2, sky: '#2a3a64', gnd: '#0c0e14', hemi: 0.42, cloud: '#1a2232', glow: '#3a2a20' },
  { h: 5.7, top: '#121a3a', hor: '#4a3a5c', fog: '#2c2840', sun: '#ff9a6a', sunI: 0.05, moonI: 0.1, sky: '#3a4470', gnd: '#141418', hemi: 0.5, cloud: '#4a3a50', glow: '#2a2030' },
  { h: 6.6, top: '#3a5a9a', hor: '#efa070', fog: '#bc9286', sun: '#ffb070', sunI: 1.2, moonI: 0, sky: '#8aa0c8', gnd: '#3a3028', hemi: 0.8, cloud: '#e8b0a0', glow: '#000000' },
  { h: 8.5, top: '#3d76cc', hor: '#b6d0e8', fog: '#b4c8da', sun: '#fff2dc', sunI: 2.5, moonI: 0, sky: '#a8c4e8', gnd: '#4a4636', hemi: 1.05, cloud: '#f4f4f4', glow: '#000000' },
  { h: 15.5, top: '#3a70c8', hor: '#c0d4e6', fog: '#bccfdf', sun: '#fff0d6', sunI: 2.5, moonI: 0, sky: '#a8c4e8', gnd: '#4a4636', hemi: 1.05, cloud: '#f4f4f4', glow: '#000000' },
  { h: 17.6, top: '#3a5ca4', hor: '#f0c08a', fog: '#d4b494', sun: '#ffc078', sunI: 2.0, moonI: 0, sky: '#a0b0d0', gnd: '#4a3a2a', hemi: 0.95, cloud: '#f8d8b0', glow: '#000000' },
  { h: 18.7, top: '#283276', hor: '#f08858', fog: '#b07866', sun: '#ff8a4a', sunI: 1.1, moonI: 0, sky: '#7a7aa8', gnd: '#3a2a24', hemi: 0.75, cloud: '#f09a7a', glow: '#000000' },
  { h: 19.5, top: '#151948', hor: '#a84e6a', fog: '#583850', sun: '#ff5a3a', sunI: 0.12, moonI: 0.05, sky: '#4a4a7a', gnd: '#1e1a20', hemi: 0.55, cloud: '#7a4a6a', glow: '#20141a' },
  { h: 20.4, top: '#070a22', hor: '#262246', fog: '#18172e', sun: '#000000', sunI: 0, moonI: 0.16, sky: '#2e3a66', gnd: '#0e0e14', hemi: 0.45, cloud: '#262a40', glow: '#3a2a20' },
  { h: 21.6, top: '#03050c', hor: '#0c1326', fog: '#0a0f1c', sun: '#000000', sunI: 0, moonI: 0.22, sky: '#2a3a64', gnd: '#0c0e14', hemi: 0.42, cloud: '#1a2232', glow: '#3a2a20' },
];
const COLOR_KEYS = ['top', 'hor', 'fog', 'sun', 'sky', 'gnd', 'cloud', 'glow'];
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color(k[c]);

function samplePalette(hour, out) {
  const h = ((hour % 24) + 24) % 24;
  let a = KEYS[KEYS.length - 1];
  let b = KEYS[0];
  let t = 0;
  for (let i = 0; i < KEYS.length; i++) {
    const k0 = KEYS[i];
    const k1 = KEYS[(i + 1) % KEYS.length];
    const h1 = i + 1 < KEYS.length ? k1.h : k1.h + 24;
    if (h >= k0.h && h < h1) {
      a = k0;
      b = k1;
      t = (h - k0.h) / (h1 - k0.h);
      break;
    }
  }
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], t);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.moonI = a.moonI + (b.moonI - a.moonI) * t;
  out.hemi = a.hemi + (b.hemi - a.hemi) * t;
  return out;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 top, hor, fogc, sunColor, sunDir, glow;
  uniform float sunVis;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, fogc, smoothstep(0.02, -0.12, h));
    // warm town light pollution low on the horizon at night
    col += glow * smoothstep(0.25, 0.0, abs(h)) * 0.6;
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.25 + pow(s, 4.0) * 0.12 * (1.0 - clamp(h * 2.0, 0.0, 1.0))) * sunVis;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float mag;
  attribute float phase;
  uniform float uTime;
  uniform float uOpacity;
  varying float vA;
  void main() {
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + phase * 3.0) + phase * 40.0);
    vA = uOpacity * mag * tw * smoothstep(-0.02, 0.15, normalize(position).y);
    gl_PointSize = 1.0 + step(0.82, mag) * 1.0;
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vA, 1.0); }
`;

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D tNoise;
  uniform vec3 litColor, darkColor, horColor, camPos;
  uniform vec2 wind;
  uniform float cover;
  varying vec3 vWorld;
  void main() {
    vec2 uv = (vWorld.xz + wind) / 2400.0;
    float n = texture2D(tNoise, uv).r * 0.65 + texture2D(tNoise, uv * 2.7 + 0.31).r * 0.35;
    float a = smoothstep(cover, cover + 0.22, n);
    float dist = length(vWorld.xz - camPos.xz);
    float fade = smoothstep(1400.0, 500.0, dist);
    vec3 col = mix(darkColor, litColor, smoothstep(cover, cover + 0.35, n));
    col = mix(col, horColor, smoothstep(300.0, 1300.0, dist) * 0.75);
    gl_FragColor = vec4(col, a * fade * 0.92);
  }
`;

export class Sky {
  constructor(scene, textures) {
    this.scene = scene;
    this.pal = { top: new THREE.Color(), hor: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), cloud: new THREE.Color(), glow: new THREE.Color(), sunI: 0, moonI: 0, hemi: 1 };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.daylight = 1;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        hor: { value: new THREE.Color() },
        fogc: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: this.sunDir },
        glow: { value: new THREE.Color() },
        sunVis: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 16), this.skyMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Stars.
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 1100;
      pos[i * 3 + 1] = Math.abs(u) * 1100;
      pos[i * 3 + 2] = r * Math.sin(th) * 1100;
      mag[i] = Math.pow(Math.random(), 2.5);
      phase[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    sg.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Moon.
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: textures.moon, transparent: true, depthWrite: false, fog: false, color: 0xffffff }),
    );
    this.moon.renderOrder = -8;
    this.moon.scale.setScalar(36);
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    // Clouds.
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        tNoise: { value: textures.clouds },
        litColor: { value: new THREE.Color() },
        darkColor: { value: new THREE.Color() },
        horColor: { value: new THREE.Color() },
        camPos: { value: new THREE.Vector3() },
        wind: { value: new THREE.Vector2() },
        cover: { value: 0.55 },
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(4800, 4800).rotateX(Math.PI / 2), this.cloudMat);
    this.clouds.position.y = 260;
    this.clouds.renderOrder = -7;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    // Lights.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.dir);
    scene.add(this.dir.target);
    scene.fog = new THREE.Fog(0x000000, 40, 420);
    this.windOffset = new THREE.Vector2();
    this.cloudCover = 0.55;
  }

  // dayIndex lets the moon & cloud cover drift from night to night.
  update(hour, dayIndex, camera, dt, time) {
    const p = samplePalette(hour, this.pal);
    // Sun arc: rises ~6:30 in the east (+x), sets ~19:00 in the west.
    const t = (hour - 6.5) / 12.5;
    const ang = t * Math.PI;
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.82, 0.38).normalize();
    const mAng = ang + Math.PI + 0.35 + (dayIndex % 29) * 0.21;
    this.moonDir.set(Math.cos(mAng), Math.sin(mAng) * 0.75 + 0.12, -0.3).normalize();

    this.night = clamp((0.12 - this.sunDir.y) / 0.24, 0, 1);
    this.daylight = 1 - this.night;

    const u = this.skyMat.uniforms;
    u.top.value.copy(p.top);
    u.hor.value.copy(p.hor);
    u.fogc.value.copy(p.fog);
    u.sunColor.value.copy(p.sun);
    u.glow.value.copy(p.glow);
    u.sunVis.value = clamp((this.sunDir.y + 0.08) * 6, 0, 1);

    this.group.position.copy(camera.position);
    this.stars.rotation.y = time * 0.002;
    this.starMat.uniforms.uTime.value = time;
    this.starMat.uniforms.uOpacity.value = clamp(this.night * 1.1 - 0.1, 0, 1) * (1 - this.cloudCover * 0.3);

    this.moon.position.copy(camera.position).addScaledVector(this.moonDir, 900);
    this.moon.lookAt(camera.position);
    this.moon.visible = this.moonDir.y > -0.05;
    this.moon.material.opacity = 0.35 + this.night * 0.65;

    this.windOffset.x += dt * 4.0;
    this.windOffset.y += dt * 1.5;
    this.cloudCover = 0.5 + Math.sin(dayIndex * 1.7 + 0.5) * 0.12;
    const cu = this.cloudMat.uniforms;
    cu.cover.value = this.cloudCover;
    cu.litColor.value.copy(p.cloud);
    cu.darkColor.value.copy(p.cloud).multiplyScalar(0.55).lerp(p.top, 0.25);
    cu.horColor.value.copy(p.hor);
    cu.camPos.value.copy(camera.position);
    cu.wind.value.copy(this.windOffset);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;

    // Lighting.
    this.hemi.color.copy(p.sky);
    this.hemi.groundColor.copy(p.gnd);
    this.hemi.intensity = p.hemi;
    const sunUp = this.sunDir.y > -0.02;
    if (sunUp && p.sunI > 0.02) {
      this.dir.color.copy(p.sun);
      this.dir.intensity = p.sunI;
      this.dir.position.copy(this.sunDir).multiplyScalar(100);
    } else {
      this.dir.color.set('#8ea6e8');
      this.dir.intensity = p.moonI * clamp(this.moonDir.y * 4, 0, 1) + 0.04;
      this.dir.position.copy(this.moonDir).multiplyScalar(100);
    }
    this.dir.position.add(camera.position);
    this.dir.target.position.copy(camera.position);

    this.scene.fog.color.copy(p.fog);
    this.scene.fog.near = 30 - this.night * 10;
    this.scene.fog.far = 430 - this.night * 150;
  }

  // Rough scene brightness for the camera's light meter (0..1, linear).
  get lightLevel() {
    // Calibrated against the photo meter: ~0.013 at night, ~0.18 at noon.
    return clamp(this.pal.hemi * 0.03 + this.pal.sunI * 0.06 * clamp(this.sunDir.y * 3, 0, 1), 0.003, 0.3);
  }
}
