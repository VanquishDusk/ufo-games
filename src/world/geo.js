// Geometry accumulation. The whole static town is baked into a handful of
// merged meshes (one per material), so the scene stays at a few dozen draw
// calls no matter how many houses we add.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _col = new THREE.Color();

export class GeoAcc {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }

  get empty() {
    return this.pos.length === 0;
  }

  _push(p, n, u, c) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u[0], u[1]);
    this.col.push(c.r, c.g, c.b);
  }

  // Triangle from local points, transformed by matrix m.
  tri(m, p0, p1, p2, uv0, uv1, uv2, color) {
    const c = color instanceof THREE.Color ? color : _col.set(color);
    _a.copy(p0).applyMatrix4(m);
    _b.copy(p1).applyMatrix4(m);
    _c.copy(p2).applyMatrix4(m);
    _n.subVectors(_b, _a).cross(_v.subVectors(_c, _a)).normalize();
    this._push(_a, _n, uv0, c);
    this._push(_b, _n, uv1, c);
    this._push(_c, _n, uv2, c);
  }

  // Quad p0..p3 counter-clockwise as seen from the front.
  quad(m, p0, p1, p2, p3, uvs, color) {
    const u = uvs || [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    this.tri(m, p0, p1, p2, u[0], u[1], u[2], color);
    this.tri(m, p0, p2, p3, u[0], u[2], u[3], color);
  }

  // Axis-aligned (in local space) box centred at (cx,cy,cz) with UVs scaled
  // to meters / ts so textures tile at a constant real-world size.
  box(m, cx, cy, cz, w, h, d, color, { ts = 2, skip = '', v0 = null, uvFit = false } = {}) {
    const x0 = cx - w / 2,
      x1 = cx + w / 2;
    const y0 = cy - h / 2,
      y1 = cy + h / 2;
    const z0 = cz - d / 2,
      z1 = cz + d / 2;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const vb = v0 === null ? 0 : y0 / ts;
    const uv = (uw, vh) =>
      uvFit
        ? [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ]
        : [
            [0, vb],
            [uw / ts, vb],
            [uw / ts, vb + vh / ts],
            [0, vb + vh / ts],
          ];
    if (!skip.includes('f')) this.quad(m, V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), uv(w, h), color);
    if (!skip.includes('k')) this.quad(m, V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), uv(w, h), color);
    if (!skip.includes('r')) this.quad(m, V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), uv(d, h), color);
    if (!skip.includes('l')) this.quad(m, V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), uv(d, h), color);
    if (!skip.includes('t')) {
      const tu = uvFit ? null : [
        [0, 0],
        [w / ts, 0],
        [w / ts, d / ts],
        [0, d / ts],
      ];
      this.quad(m, V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), tu, color);
    }
    if (!skip.includes('b')) this.quad(m, V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), null, color);
  }

  // Flat horizontal rectangle with world-aligned UVs (roads, lots).
  // Corners given in *world* space directly.
  ground(x0, z0, x1, z1, y, color, ts = 4) {
    const I = IDENTITY;
    const V = (x, z) => new THREE.Vector3(x, y, z);
    this.quad(
      I,
      V(x0, z1),
      V(x1, z1),
      V(x1, z0),
      V(x0, z0),
      [
        [x0 / ts, -z1 / ts],
        [x1 / ts, -z1 / ts],
        [x1 / ts, -z0 / ts],
        [x0 / ts, -z0 / ts],
      ],
      color,
    );
  }

  // Disc / ring on the ground with world UVs.
  disc(cx, cz, r0, r1, y, color, seg = 24, ts = 4) {
    const I = IDENTITY;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, r) => new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      const u = (v) => [v.x / ts, -v.z / ts];
      const o0 = p(a0, r1),
        o1 = p(a1, r1);
      if (r0 <= 0.001) {
        const c = new THREE.Vector3(cx, y, cz);
        this.tri(I, c, o1, o0, u(c), u(o1), u(o0), color);
      } else {
        const i0 = p(a0, r0),
          i1 = p(a1, r0);
        this.quad(I, i0, i1, o1, o0, [u(i0), u(i1), u(o1), u(o0)], color);
      }
    }
  }

  // Append an arbitrary three.js geometry (e.g. Cylinder/Icosahedron).
  geometry(geo, m, color, uvScale = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const U = g.attributes.uv;
    const C = g.attributes.color;
    _nm.getNormalMatrix(m);
    const base = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
    const vc = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      _a.fromBufferAttribute(P, i).applyMatrix4(m);
      if (N) _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      const u = U ? [U.getX(i) * uvScale, U.getY(i) * uvScale] : [0, 0];
      if (C) vc.setRGB(C.getX(i) * base.r, C.getY(i) * base.g, C.getZ(i) * base.b);
      else vc.copy(base);
      this._push(_a, _n, u, vc);
    }
    if (g !== geo) g.dispose();
  }

  build() {
    return makeGeometry(this.pos, this.nor, this.uv, this.col);
  }

  // Split triangles into square XZ cells so each piece can be frustum culled
  // and raycast cheaply.
  buildChunks(cell) {
    const cells = new Map();
    const P = this.pos;
    for (let t = 0; t < P.length / 9; t++) {
      const o = t * 9;
      const cx = (P[o] + P[o + 3] + P[o + 6]) / 3;
      const cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
      const k = Math.floor(cx / cell) + ',' + Math.floor(cz / cell);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(t);
    }
    const out = [];
    for (const tris of cells.values()) {
      const pos = new Float32Array(tris.length * 9);
      const nor = new Float32Array(tris.length * 9);
      const uv = new Float32Array(tris.length * 6);
      const col = new Float32Array(tris.length * 9);
      tris.forEach((t, i) => {
        for (let k = 0; k < 9; k++) {
          pos[i * 9 + k] = this.pos[t * 9 + k];
          nor[i * 9 + k] = this.nor[t * 9 + k];
          col[i * 9 + k] = this.col[t * 9 + k];
        }
        for (let k = 0; k < 6; k++) uv[i * 6 + k] = this.uv[t * 6 + k];
      });
      out.push(makeGeometry(pos, nor, uv, col));
    }
    return out;
  }
}

function makeGeometry(pos, nor, uv, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export const IDENTITY = new THREE.Matrix4();

// One GeoAcc per material key.
export class Batcher {
  constructor() {
    this.accs = new Map();
  }
  get(key) {
    if (!this.accs.has(key)) this.accs.set(key, new GeoAcc());
    return this.accs.get(key);
  }
  build(materials, parent, { occluderKeys = [], cell = 110 } = {}) {
    const occluders = [];
    for (const [key, acc] of this.accs) {
      if (acc.empty) continue;
      const mat = materials[key];
      if (!mat) throw new Error('missing material ' + key);
      for (const geo of acc.buildChunks(cell)) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'batch:' + key;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
        if (occluderKeys.includes(key)) occluders.push(mesh);
      }
    }
    return occluders;
  }
}

// Matrix helpers.
export function mat(x = 0, y = 0, z = 0, rotY = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
  return m;
}

export function mul(a, b) {
  return new THREE.Matrix4().multiplyMatrices(a, b);
}

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
