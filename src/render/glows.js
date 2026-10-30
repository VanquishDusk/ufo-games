// Point-sprite light glows (street lamps, porch lights, tower beacons) and a
// helper for instanced meshes whose per-instance color we animate (window
// glass, light pools on the ground, lamp heads).
import * as THREE from 'three';

const GLOW_VERT = /* glsl */ `
  attribute float size;
  attribute vec3 glowColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = max(-mv.z, 0.1);
    float ps = size * uScale / d;
    vColor = glowColor * clamp(1.5 - d * 0.0018, 0.3, 1.0);
    if (ps < 1.5) { vColor *= ps / 1.5; ps = 1.5; }
    gl_PointSize = min(ps, 110.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.32, 0.0, r);
    float halo = pow(1.0 - r, 2.2) * 0.55;
    gl_FragColor = vec4(vColor * (core * 1.4 + halo), 1.0);
  }
`;

export class GlowField {
  constructor(max = 2048) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.base = [];
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('glowColor', this.colAttr);
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 200 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  add(p, color, size) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.size[i] = size;
    const c = new THREE.Color(color);
    this.base.push(c);
    this.set(i, 0);
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    return i;
  }

  // Re-purpose a slot (pooled lights for moving craft).
  restyle(i, color, size) {
    this.base[i].set(color);
    this.size[i] = size;
    this.geometry.attributes.size.needsUpdate = true;
  }

  move(i, p) {
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.geometry.attributes.position.needsUpdate = true;
  }

  set(i, k) {
    if (i < 0) return;
    const c = this.base[i];
    this.col[i * 3] = c.r * k;
    this.col[i * 3 + 1] = c.g * k;
    this.col[i * 3 + 2] = c.b * k;
    this.colAttr.needsUpdate = true;
  }

  setScale(viewHeightPx, fovDeg) {
    this.material.uniforms.uScale.value = viewHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }
}

// Instanced mesh with animated per-instance color (base * intensity).
export class InstancedColors {
  constructor(geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.frustumCulled = false;
    this.base = [];
    this.max = max;
    this._c = new THREE.Color();
    // Force allocation of the instanceColor buffer.
    this.mesh.setColorAt(0, this._c.setRGB(0, 0, 0));
  }

  add(matrix, color) {
    const i = this.mesh.count;
    if (i >= this.max) return -1;
    this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.base.push(new THREE.Color(color));
    this.mesh.setColorAt(i, this.base[i]);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    return i;
  }

  // Either a scalar intensity on the base color, or an explicit color.
  set(i, k, color = null) {
    if (i < 0) return;
    if (color) this._c.copy(color);
    else this._c.copy(this.base[i]).multiplyScalar(k);
    this.mesh.setColorAt(i, this._c);
    this.mesh.instanceColor.needsUpdate = true;
  }

  finalize() {
    this.mesh.computeBoundingSphere();
  }
}
