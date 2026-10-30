// Everything in town that isn't a house: streets, lamps, power lines, trees,
// cars, the park, the Qwik Stop, the water tower, the radio mast, the corn.
import * as THREE from 'three';
import { RNG, hash } from '../core/rng.js';
import { mat, mul, V3, IDENTITY, GeoAcc } from './geo.js';
import { psx } from '../render/materials.js';
import { signTexture, canvasTexture } from '../render/textures.js';
import { STREETS, ZONES, LANDMARKS, ROAD_HALF, WALK_W, CUL_R, BOUNDS, streetRect, culCenter, sidewalkSegments } from './layout.js';

const I = IDENTITY;
const FALL = ['#c8501e', '#d8862a', '#e0b030', '#a83a22', '#7a8a2a', '#5f7a2a', '#c86a24', '#b89a2a', '#d26a2a', '#8a2a1e'];
const CAR_COLORS = ['#6a1e2a', '#1e5a5a', '#d8d0b8', '#e8e8e4', '#1e3a2a', '#1e2a4a', '#8a8a8e', '#3a2a5a', '#7a2a1a', '#2a2a2c', '#4a5a6a', '#b0a080'];

function withWhite(geo) {
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

function inRect(x, z, r, m = 0) {
  return x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;
}

function nearRoad(x, z, m) {
  for (const s of STREETS) {
    if (inRect(x, z, streetRect(s), m)) return true;
    const c = culCenter(s);
    if (c && Math.hypot(x - c.x, z - c.z) < CUL_R + m) return true;
  }
  return false;
}

// ---------------------------------------------------------------- streets
export function buildStreets(ctx) {
  const { batch: B } = ctx;
  const asph = B.get('asphalt');
  const conc = B.get('concrete');
  const paint = B.get('paint');
  const white = new THREE.Color('#e8e6dc');
  const yellow = new THREE.Color('#d8b030');
  const walkCol = new THREE.Color('#c4c0b6');

  for (const s of STREETS) {
    const r = streetRect(s);
    asph.ground(r[0], r[1], r[2], r[3], 0.07, white, 5);
    for (const side of [-1, 1]) {
      for (const seg of sidewalkSegments(s, side)) {
        if (s.axis === 'x') conc.box(I, (seg.a + seg.b) / 2, 0.08, seg.off, seg.b - seg.a, 0.24, WALK_W, walkCol, { ts: 2, skip: 'b' });
        else conc.box(I, seg.off, 0.08, (seg.a + seg.b) / 2, WALK_W, 0.24, seg.b - seg.a, walkCol, { ts: 2, skip: 'b' });
      }
    }
    const c = culCenter(s);
    if (c) {
      asph.disc(c.x, c.z, 0, CUL_R, 0.07, white, 28, 5);
      // Sidewalk ring with a gap where the street enters.
      const entry = s.axis === 'x' ? (s.cul === 'b' ? Math.PI : 0) : s.cul === 'b' ? -Math.PI / 2 : Math.PI / 2;
      const gap = Math.asin((ROAD_HALF + WALK_W) / (CUL_R + WALK_W)) + 0.05;
      const seg = 28;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        let d = Math.abs(((mid - entry + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < gap) continue;
        const p = (a, rr) => V3(c.x + Math.cos(a) * rr, 0.23, c.z + Math.sin(a) * rr);
        const u = (v) => [v.x / 2, -v.z / 2];
        const i0 = p(a0, CUL_R),
          i1 = p(a1, CUL_R),
          o0 = p(a0, CUL_R + WALK_W),
          o1 = p(a1, CUL_R + WALK_W);
        conc.quad(I, i0, i1, o1, o0, [u(i0), u(i1), u(o1), u(o0)], walkCol);
      }
    }
  }

  // Double yellow on Maple, broken at intersections.
  const maple = STREETS[0];
  const cuts = STREETS.filter((s) => s.axis === 'z').map((s) => [s.c - ROAD_HALF - 1, s.c + ROAD_HALF + 1]);
  let x = maple.a;
  const segs = [];
  for (const [a, b] of cuts.sort((p, q) => p[0] - q[0])) {
    segs.push([x, a]);
    x = b;
  }
  segs.push([x, maple.b]);
  for (const [a, b] of segs) {
    paint.ground(a, -0.2, b, -0.1, 0.12, yellow);
    paint.ground(a, 0.1, b, 0.2, 0.12, yellow);
  }
  // Stop bars where side streets meet Maple.
  for (const s of STREETS) {
    if (s.axis !== 'z') continue;
    if (s.a < -ROAD_HALF) paint.ground(s.c - ROAD_HALF, -ROAD_HALF - 1.6, s.c, -ROAD_HALF - 1.2, 0.12, white);
    if (s.b > ROAD_HALF) paint.ground(s.c, ROAD_HALF + 1.2, s.c + ROAD_HALF, ROAD_HALF + 1.6, 0.12, white);
  }
  // Zebra crossing at the park.
  for (let i = 0; i < 6; i++) {
    const z0 = -ROAD_HALF + 0.4 + i * 1.45;
    paint.ground(-6, z0, -2.5, z0 + 0.7, 0.12, white);
  }
}

// ---------------------------------------------------------------- cars
export function buildCar(B, m, seed, colliders) {
  const rng = new RNG(Math.floor(seed * 1e9) + 7);
  const type = rng.pick(['sedan', 'sedan', 'wagon', 'van', 'pickup', 'sedan']);
  const col = new THREE.Color(rng.pick(CAR_COLORS));
  const f = B.get('flat');
  const glass = '#232a33';
  const len = type === 'van' ? 4.9 : type === 'pickup' ? 5.3 : 4.7;
  const wid = 1.8;
  f.box(m, 0, 0.66, 0, wid, 0.62, len, col, { skip: 'b' });
  if (type === 'van') {
    f.box(m, 0, 1.3, -0.35, wid - 0.06, 0.66, len - 1.3, glass, { skip: 'b' });
    f.box(m, 0, 1.68, -0.35, wid - 0.02, 0.12, len - 1.35, col, { skip: 'b' });
  } else if (type === 'pickup') {
    f.box(m, 0, 1.28, 0.55, wid - 0.1, 0.62, 1.55, glass, { skip: 'b' });
    f.box(m, 0, 1.62, 0.55, wid - 0.12, 0.08, 1.45, col);
    f.box(m, -wid / 2 + 0.06, 1.1, -1.35, 0.1, 0.3, 2.4, col);
    f.box(m, wid / 2 - 0.06, 1.1, -1.35, 0.1, 0.3, 2.4, col);
    f.box(m, 0, 1.1, -2.6, wid, 0.3, 0.1, col);
  } else {
    const cl = type === 'wagon' ? 3.0 : 2.3;
    const off = type === 'wagon' ? -0.55 : -0.2;
    f.box(m, 0, 1.24, off, wid - 0.14, 0.56, cl, glass, { skip: 'b' });
    f.box(m, 0, 1.54, off, wid - 0.18, 0.07, cl - 0.25, col);
  }
  f.box(m, 0, 0.42, len / 2 + 0.04, wid + 0.04, 0.16, 0.1, '#5a5a5c');
  f.box(m, 0, 0.42, -len / 2 - 0.04, wid + 0.04, 0.16, 0.1, '#5a5a5c');
  f.box(m, -0.6, 0.72, len / 2 + 0.01, 0.34, 0.13, 0.04, '#f0eccc');
  f.box(m, 0.6, 0.72, len / 2 + 0.01, 0.34, 0.13, 0.04, '#f0eccc');
  f.box(m, -0.65, 0.74, -len / 2 - 0.01, 0.3, 0.14, 0.04, '#a01810');
  f.box(m, 0.65, 0.74, -len / 2 - 0.01, 0.3, 0.14, 0.04, '#a01810');
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8);
  const rz = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  for (const sx of [-0.84, 0.84]) for (const sz of [len / 2 - 0.9, -len / 2 + 0.9]) f.geometry(wheel, mul(m, mul(mat(sx, 0.33, sz), rz)), '#141416');
  wheel.dispose();
  if (colliders) {
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const e = m.elements;
    colliders.addBox(p.x, p.z, wid / 2, len / 2, Math.atan2(e[8], e[10]), 1.7);
  }
}

// ---------------------------------------------------------------- lamps
export function buildStreetlights(ctx) {
  const { batch: B, glows, pools, lamps, colliders } = ctx;
  const plain = B.get('plain');
  const lights = [];
  const rng = new RNG(77);
  const place = (x, z, ax, az, height = 7, poolSize = 15) => {
    const ang = Math.atan2(ax, az);
    const M = mat(x, 0, z, ang);
    plain.box(M, 0, height / 2, 0, 0.16, height, 0.16, '#6a6c70');
    plain.box(M, 0, height - 0.1, 0.85, 0.08, 0.08, 1.7, '#6a6c70');
    const head = new THREE.Vector3(0, height - 0.22, 1.7).applyMatrix4(M);
    const lamp = lamps.add(mul(M, mat(0, height - 0.2, 1.75, 0, 0.32, 0.14, 0.62)), '#ffd08a');
    const glow = glows.add(V3(head.x, head.y - 0.12, head.z), '#ffb060', 2.2);
    const pool = pools.add(mat(head.x, 0.32, head.z, 0, poolSize, 1, poolSize), '#d0802e');
    colliders.addCircle(x, z, 0.14, height);
    lights.push({ pos: head, lamp, glow, pool, phase: rng.next(), flicker: rng.next() < 0.07, kind: 'street' });
  };
  for (const s of STREETS) {
    let side = 1;
    for (let t = s.a + 12; t < s.b - 6; t += 46) {
      if (Math.abs(t) > BOUNDS + 30) continue;
      const off = s.c + side * (ROAD_HALF + 0.5);
      const x = s.axis === 'x' ? t : off;
      const z = s.axis === 'x' ? off : t;
      let blocked = false;
      for (const o of STREETS) if (o !== s && inRect(x, z, streetRect(o), 3)) blocked = true;
      if (!blocked) place(x, z, s.axis === 'x' ? 0 : -side, s.axis === 'x' ? -side : 0);
      side = -side;
    }
    const c = culCenter(s);
    if (c) {
      const dir = s.axis === 'x' ? [s.cul === 'b' ? 1 : -1, 0] : [0, s.cul === 'b' ? 1 : -1];
      place(c.x + dir[0] * (CUL_R + 0.5), c.z + dir[1] * (CUL_R + 0.5), -dir[0], -dir[1]);
    }
  }
  return { lights, place };
}

// ---------------------------------------------------------------- power lines
export function buildPowerLines(ctx) {
  const { batch: B, colliders, scene, M } = ctx;
  const plain = B.get('plain');
  const verts = [];
  const route = (poles, perp) => {
    let prev = null;
    for (const [x, z] of poles) {
      plain.box(I, x, 4.8, z, 0.26, 9.6, 0.26, '#5a4632');
      if (perp === 'z') plain.box(I, x, 9.05, z, 0.14, 0.14, 2.5, '#4a3a2a');
      else plain.box(I, x, 9.05, z, 2.5, 0.14, 0.14, '#4a3a2a');
      const att = [-1.05, 0, 1.05].map((o) => (perp === 'z' ? V3(x, o === 0 ? 9.7 : 9.2, z + o) : V3(x + o, o === 0 ? 9.7 : 9.2, z)));
      for (const a of att) plain.box(I, a.x, a.y - 0.1, a.z, 0.08, 0.2, 0.08, '#d8d4c8');
      if (Math.abs(x) < BOUNDS + 5 && Math.abs(z) < BOUNDS + 5) colliders.addCircle(x, z, 0.2, 9.6);
      if (prev) {
        for (let k = 0; k < 3; k++) {
          const a = prev[k];
          const b = att[k];
          const N = 10;
          for (let i = 0; i < N; i++) {
            const t0 = i / N;
            const t1 = (i + 1) / N;
            const p0 = a.clone().lerp(b, t0);
            const p1 = a.clone().lerp(b, t1);
            p0.y -= 0.9 * 4 * t0 * (1 - t0);
            p1.y -= 0.9 * 4 * t1 * (1 - t1);
            verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          }
        }
      }
      prev = att;
    }
  };
  const maple = [];
  for (let x = -330; x <= 330; x += 40) maple.push([x, ROAD_HALF + WALK_W + 1.2]);
  route(maple, 'z');
  const oak = [];
  for (let z = -150; z <= 90; z += 40) oak.push([-80 - ROAD_HALF - WALK_W - 1.2, z]);
  route(oak, 'x');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const lines = new THREE.LineSegments(g, M.wire);
  lines.frustumCulled = false;
  scene.add(lines);
}

// ---------------------------------------------------------------- signs
function signMesh(text, w, h, bg, fg, font) {
  const tex = signTexture(text, { w: 128, h: 32, bg, fg, font });
  const face = psx(new THREE.MeshLambertMaterial({ map: tex }));
  const edge = psx(new THREE.MeshLambertMaterial({ color: bg }));
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), [edge, edge, edge, edge, face, face]);
}

function stopSign() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
  }
  g.closePath();
  g.fillStyle = '#f2f2f2';
  g.fill();
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
  }
  g.closePath();
  g.fillStyle = '#b81c1c';
  g.fill();
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 17px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOP', 32, 33);
  const tex = canvasTexture(c, { repeat: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), psx(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide })));
}

export function buildSigns(ctx) {
  const { batch: B, scene, colliders } = ctx;
  const plain = B.get('plain');
  const corner = (x, z, nameA, nameB) => {
    plain.box(I, x, 1.6, z, 0.08, 3.2, 0.08, '#8a8c90');
    colliders.addCircle(x, z, 0.1, 3.2);
    const a = signMesh(nameA, 1.4, 0.26, '#1f5a34', '#f4f4ec', 'bold 19px monospace');
    a.position.set(x, 3.05, z);
    scene.add(a);
    const b = signMesh(nameB, 1.4, 0.26, '#1f5a34', '#f4f4ec', 'bold 19px monospace');
    b.position.set(x, 2.75, z);
    b.rotation.y = Math.PI / 2;
    scene.add(b);
  };
  const stop = (x, z, facing) => {
    plain.box(I, x, 1.1, z, 0.07, 2.2, 0.07, '#8a8c90');
    colliders.addCircle(x, z, 0.08, 2.2);
    const s = stopSign();
    s.position.set(x, 2.2, z);
    s.rotation.y = facing;
    scene.add(s);
  };
  const o = ROAD_HALF + WALK_W + 0.5;
  corner(-80 + o, -o, 'MAPLE AVE', 'OAK ST');
  corner(44 - o, o, 'MAPLE AVE', 'BIRCH LN');
  corner(-80 + o, -140 + o, 'HEMLOCK DR', 'OAK ST');
  stop(-80 - ROAD_HALF - 0.6, -ROAD_HALF - 2, Math.PI);
  stop(-80 + ROAD_HALF + 0.6, ROAD_HALF + 2, 0);
  stop(44 + ROAD_HALF + 0.6, ROAD_HALF + 2, 0);

  // Town welcome sign at the east entrance.
  const wsx = 196;
  const wsz = 11;
  plain.box(I, wsx - 1.6, 1.0, wsz, 0.18, 2.0, 0.18, '#5a4632');
  plain.box(I, wsx + 1.6, 1.0, wsz, 0.18, 2.0, 0.18, '#5a4632');
  const welcome = signMesh('WELCOME TO CEDAR HOLLOW', 3.8, 1.0, '#3a2a1e', '#e8d8a8', 'bold 11px monospace');
  welcome.position.set(wsx, 1.7, wsz);
  welcome.rotation.y = Math.PI / 2;
  scene.add(welcome);
  colliders.addBox(wsx, wsz, 1.9, 0.2, 0, 2.2);

  // Fire hydrants.
  const hyd = new THREE.CylinderGeometry(0.14, 0.17, 0.7, 7);
  for (const [x, z] of [
    [-80 + o + 1.5, o],
    [44 + o, -o],
    [-30, -o + 0.4],
    [100, o - 0.6],
    [-80 - o, -60],
    [44 + o, 70],
  ]) {
    B.get('plain').geometry(hyd, mat(x, 0.35, z), '#c0281c');
    plain.box(I, x, 0.76, z, 0.2, 0.1, 0.2, '#d8c020');
    colliders.addCircle(x, z, 0.2, 0.8);
  }
  hyd.dispose();
}

// ---------------------------------------------------------------- trees
export function buildTrees(list, ctx) {
  const { M, scene, colliders } = ctx;
  const dec = list.filter((t) => t.kind === 'decid');
  const pin = list.filter((t) => t.kind === 'pine');

  const decTrunk = withWhite(new THREE.CylinderGeometry(0.15, 0.26, 3.6, 5).translate(0, 1.8, 0));
  const ca = new GeoAcc();
  const ico1 = new THREE.IcosahedronGeometry(1.9, 0);
  const ico2 = new THREE.IcosahedronGeometry(1.4, 0);
  ca.geometry(ico1, mat(0, 4.5, 0, 0, 1, 0.9, 1), '#ffffff');
  ca.geometry(ico2, mat(1.0, 3.8, 0.4, 0.7), '#d8d8d8');
  ca.geometry(ico2, mat(-0.9, 4.0, -0.5, 1.9, 0.95, 0.95, 0.95), '#e2e2e2');
  ca.geometry(ico2, mat(0.1, 5.6, 0.2, 0.3, 0.8, 0.8, 0.8), '#ffffff');
  const decCanopy = ca.build();

  const pineTrunk = withWhite(new THREE.CylinderGeometry(0.13, 0.2, 1.8, 5).translate(0, 0.9, 0));
  const pa = new GeoAcc();
  const cone = (r, h, y, c) => {
    const g = new THREE.ConeGeometry(r, h, 7);
    pa.geometry(g, mat(0, y, 0, r), c);
    g.dispose();
  };
  cone(2.1, 3.2, 2.8, '#2c5230');
  cone(1.65, 2.9, 4.4, '#30583a');
  cone(1.15, 2.6, 5.9, '#355e3c');
  cone(0.6, 1.8, 7.2, '#3a6440');
  const pineCanopy = pa.build();

  const meshes = [];
  const make = (geo, mat_, arr, colorFn) => {
    const im = new THREE.InstancedMesh(geo, mat_, Math.max(1, arr.length));
    im.count = arr.length;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    arr.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.seed * 40);
      const s = t.scale;
      m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(s, s * (0.9 + hash(t.seed, 3) * 0.25), s));
      im.setMatrixAt(i, m4);
      if (colorFn) im.setColorAt(i, colorFn(t, c));
    });
    im.computeBoundingSphere();
    scene.add(im);
    meshes.push(im);
    return im;
  };
  make(decTrunk, M.bark, dec);
  const decLeaves = make(decCanopy, M.leaves, dec, (t, c) => c.set(FALL[Math.floor(hash(t.seed, 9) * FALL.length)]).multiplyScalar(0.85 + hash(t.seed, 5) * 0.3));
  make(pineTrunk, M.bark, pin);
  const pineLeaves = make(pineCanopy, M.leaves, pin, (t, c) => c.setRGB(1, 1, 1).multiplyScalar(0.8 + hash(t.seed, 4) * 0.35));

  for (const t of list) {
    if (Math.abs(t.x) < BOUNDS + 4 && Math.abs(t.z) < BOUNDS + 4) colliders.addCircle(t.x, t.z, 0.28 * t.scale, 8);
  }
  ico1.dispose();
  ico2.dispose();
  return { meshes, occluders: [decLeaves, pineLeaves] };
}

// Forest wall + scattered trees in empty land.
export function scatterTrees(list, lots, rng) {
  const blocked = (x, z) => {
    if (nearRoad(x, z, 7)) return true;
    for (const l of lots) if (inRect(x, z, l.rect, 1)) return true;
    for (const [k, r] of Object.entries(ZONES)) {
      if (k === 'field') continue;
      if (inRect(x, z, r, 3)) return true;
    }
    if (Math.hypot(x - LANDMARKS.radioTower.x, z - LANDMARKS.radioTower.z) < 14) return true;
    return false;
  };
  // Dense band just outside the playable area.
  for (let i = 0; i < 1100; i++) {
    const side = rng.int(0, 3);
    const along = rng.float(-250, 250);
    const out = BOUNDS - 6 + Math.pow(rng.next(), 1.6) * 50;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? out : -out;
    const z = side === 0 ? out : side === 1 ? -out : along;
    if (blocked(x, z)) continue;
    list.push({ x, z, kind: rng.chance(0.55) ? 'pine' : 'decid', scale: rng.float(0.9, 1.6), seed: rng.next() });
  }
  // Sparse trees further out (silhouettes against the hills).
  for (let i = 0; i < 500; i++) {
    const x = rng.float(-380, 380);
    const z = rng.float(-380, 380);
    if (Math.abs(x) < BOUNDS + 40 && Math.abs(z) < BOUNDS + 40) continue;
    if (blocked(x, z)) continue;
    list.push({ x, z, kind: rng.chance(0.6) ? 'pine' : 'decid', scale: rng.float(1.1, 1.9), seed: rng.next() });
  }
  // Inside town, on empty land.
  for (let i = 0; i < 420; i++) {
    const x = rng.float(-BOUNDS + 4, BOUNDS - 4);
    const z = rng.float(-BOUNDS + 4, BOUNDS - 4);
    if (blocked(x, z)) continue;
    if (inRect(x, z, ZONES.field, 0) && rng.chance(0.85)) continue;
    list.push({ x, z, kind: rng.chance(0.35) ? 'pine' : 'decid', scale: rng.float(0.8, 1.4), seed: rng.next() });
  }
}

// ---------------------------------------------------------------- park
export function buildPark(ctx) {
  const { batch: B, colliders, trees, interactables, scene } = ctx;
  const [x0, z0, x1, z1] = ZONES.park;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const plain = B.get('plain');
  const conc = B.get('concrete');
  const wood = B.get('wood');
  const pathCol = new THREE.Color('#c8c2b4');
  const rng = new RNG(311);

  // Paths: entrance from Maple, loop around the gazebo.
  conc.box(I, -4.25, 0.05, (-6.5 + cz + 16) / 2, 2.2, 0.24, -6.5 - (cz + 16) + 0.1, pathCol, { ts: 2, skip: 'b' });
  conc.disc(cx, cz, 15, 17, 0.23, pathCol, 32, 2);
  conc.disc(cx, cz, 0, 4.6, 0.2, new THREE.Color('#a8a296'), 12, 2);

  // Gazebo.
  const post = (px, pz) => {
    plain.box(I, px, 1.5, pz, 0.2, 3.0, 0.2, '#f0eee6');
    colliders.addCircle(px, pz, 0.15, 3);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    post(cx + Math.cos(a) * 4, cz + Math.sin(a) * 4);
  }
  const cone = new THREE.ConeGeometry(5.2, 2.0, 6);
  B.get('flat').geometry(cone, mat(cx, 4.0, cz, Math.PI / 6), '#6a3a2a');
  cone.dispose();
  plain.box(I, cx, 3.0, cz, 0.1, 0.1, 0.1, '#f0eee6');

  // Playground.
  const px = x0 + 14;
  const pz = z1 - 18;
  B.get('paint').disc(px, pz, 0, 9, 0.06, new THREE.Color('#9a7a50'), 20);
  for (const sx of [-2.4, 2.4]) {
    for (const sz of [-0.9, 0.9]) plain.box(I, px + sx, 1.3, pz + sz, 0.1, 2.6, 0.1, '#b83a2a');
    colliders.addBox(px + sx, pz, 0.1, 0.9, 0, 2.6);
  }
  plain.box(I, px, 2.6, pz, 5.0, 0.1, 0.1, '#b83a2a');
  for (const sx of [-1.4, 0, 1.4]) {
    plain.box(I, px + sx, 0.55, pz, 0.5, 0.05, 0.2, '#1a1a1a');
    plain.box(I, px + sx - 0.22, 1.6, pz, 0.02, 2.0, 0.02, '#aaa');
    plain.box(I, px + sx + 0.22, 1.6, pz, 0.02, 2.0, 0.02, '#aaa');
  }
  // Slide.
  const sx = px + 5;
  const sz = pz - 4;
  plain.box(I, sx, 1.0, sz, 1.4, 0.1, 1.4, '#3a6ab8');
  for (const [ox, oz] of [
    [-0.6, -0.6],
    [0.6, -0.6],
    [-0.6, 0.6],
    [0.6, 0.6],
  ])
    plain.box(I, sx + ox, 0.5, sz + oz, 0.08, 1.0, 0.08, '#e8c020');
  const slide = mul(mat(sx, 0.55, sz + 2.1), new THREE.Matrix4().makeRotationX(0.42));
  plain.box(slide, 0, 0, 0, 0.8, 0.06, 3.0, '#e8c020');
  colliders.addBox(sx, sz + 1, 0.8, 2.2, 0, 1.6);
  // Sandbox.
  wood.box(I, px - 5, 0.15, pz + 5, 3.2, 0.3, 0.2, '#b89a70', { ts: 1.8 });
  wood.box(I, px - 5, 0.15, pz + 6.5, 3.2, 0.3, 0.2, '#b89a70', { ts: 1.8 });
  B.get('paint').ground(px - 6.5, pz + 5, px - 3.5, pz + 6.5, 0.2, new THREE.Color('#d8c890'));

  // Ball field + backstop in the back corner.
  const bx = x1 - 16;
  const bz = z0 + 14;
  B.get('paint').disc(bx, bz, 0, 13, 0.06, new THREE.Color('#a8845a'), 24);
  for (const [ox, oz] of [
    [0, 0],
    [6, 6],
    [0, 12],
    [-6, 6],
  ])
    plain.box(I, bx + ox, 0.06, bz + oz, 0.45, 0.06, 0.45, '#f4f4f0');
  const cl = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), ctx.M.chainlink);
  cl.material.map.repeat.set(10 / 0.6, 4 / 0.6);
  cl.position.set(bx, 2, bz - 3);
  scene.add(cl);
  for (const ox of [-5, 0, 5]) plain.box(I, bx + ox, 2, bz - 3, 0.08, 4, 0.08, '#999');
  colliders.addBox(bx, bz - 3, 5, 0.1, 0, 4);

  // Benches & picnic tables.
  const bench = (x, z, rot) => {
    const m = mat(x, 0, z, rot);
    wood.box(m, 0, 0.45, 0, 1.8, 0.06, 0.45, '#8a6a48', { ts: 1.8 });
    wood.box(m, 0, 0.75, -0.2, 1.8, 0.4, 0.05, '#8a6a48', { ts: 1.8 });
    plain.box(m, -0.75, 0.22, 0, 0.06, 0.45, 0.4, '#333');
    plain.box(m, 0.75, 0.22, 0, 0.06, 0.45, 0.4, '#333');
    colliders.addBox(x, z, 0.9, 0.25, rot, 0.55);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    bench(cx + Math.cos(a) * 18.4, cz + Math.sin(a) * 18.4, Math.atan2(-Math.cos(a), -Math.sin(a)));
  }
  const table = (x, z) => {
    wood.box(I, x, 0.75, z, 2.0, 0.07, 0.8, '#8a6a48', { ts: 1.8 });
    wood.box(I, x, 0.45, z - 0.65, 2.0, 0.06, 0.3, '#8a6a48', { ts: 1.8 });
    wood.box(I, x, 0.45, z + 0.65, 2.0, 0.06, 0.3, '#8a6a48', { ts: 1.8 });
    plain.box(I, x - 0.8, 0.37, z, 0.08, 0.75, 1.5, '#6a4a30');
    plain.box(I, x + 0.8, 0.37, z, 0.08, 0.75, 1.5, '#6a4a30');
    colliders.addBox(x, z, 1.0, 0.8, 0, 0.8);
  };
  table(x1 - 10, z1 - 12);
  table(x1 - 14, z1 - 20);

  // Park sign at the entrance.
  plain.box(I, -7.5, 0.7, -8.6, 0.14, 1.4, 0.14, '#5a4632');
  plain.box(I, -10.5, 0.7, -8.6, 0.14, 1.4, 0.14, '#5a4632');
  const sign = signMesh('CEDAR HOLLOW PARK', 3.4, 0.8, '#3a2a1e', '#e8d8a8', 'bold 12px monospace');
  sign.position.set(-9, 1.25, -8.6);
  scene.add(sign);
  colliders.addBox(-9, -8.6, 1.7, 0.15, 0, 1.6);
  interactables.push({ pos: V3(-9, 1, -7.4), radius: 2.2, prompt: 'READ SIGN', type: 'sign', text: 'CEDAR HOLLOW PARK — Est. 1952. Park closes at dusk. Please keep dogs leashed.' });

  // Trees around the edge.
  for (let i = 0; i < 46; i++) {
    const t = rng.next();
    let x, z;
    const edge = rng.int(0, 3);
    if (edge === 0) {
      x = rng.float(x0 + 2, x1 - 2);
      z = z0 + rng.float(1, 6);
    } else if (edge === 1) {
      x = x0 + rng.float(1, 5);
      z = rng.float(z0 + 2, z1 - 2);
    } else if (edge === 2) {
      x = x1 - rng.float(1, 5);
      z = rng.float(z0 + 2, z1 - 2);
    } else {
      x = rng.float(x0 + 2, x1 - 2);
      z = rng.float(cz - 30, cz + 30);
    }
    if (Math.hypot(x - cx, z - cz) < 20 || Math.hypot(x - px, z - pz) < 11 || Math.hypot(x - bx, z - bz - 6) < 15 || Math.abs(x + 4.25) < 3) continue;
    trees.push({ x, z, kind: t < 0.3 ? 'pine' : 'decid', scale: rng.float(0.9, 1.4), seed: rng.next() });
  }
  return { center: V3(cx, 0, cz), playground: V3(px, 0, pz) };
}

// ---------------------------------------------------------------- store
export function buildStore(ctx) {
  const { batch: B, colliders, scene, glows, pools, windows, interactables, subjects } = ctx;
  const [x0, z0, x1, z1] = ZONES.store;
  const asph = B.get('asphalt');
  const plain = B.get('plain');
  const paint = B.get('paint');
  const white = new THREE.Color('#ffffff');

  asph.ground(x0, z0, x1, -6.5, 0.07, white, 5);
  asph.box(I, 124, 0.13, -5.5, 8, 0.24, 2.0, white, { ts: 5 });
  asph.box(I, 164, 0.13, -5.5, 8, 0.24, 2.0, white, { ts: 5 });
  for (let i = 0; i < 6; i++) paint.ground(150 + i * 3.2, -31.5, 150.12 + i * 3.2, -26, 0.12, new THREE.Color('#e8e6dc'));

  // Building.
  const sbx = 150;
  const sbz = -39.5;
  const W = 30;
  const D = 13;
  const H = 4.6;
  B.get('brick').box(I, sbx, 0.6, sbz, W + 0.06, 1.2, D + 0.06, '#ffffff', { ts: 1.2, skip: 'b' });
  plain.box(I, sbx, H / 2, sbz, W, H, D, '#d8ccb0', { skip: 'b' });
  plain.box(I, sbx, H + 0.25, sbz + D / 2 - 0.4, W + 0.4, 0.5, 1.2, '#b8281c');
  colliders.addBox(sbx, sbz, W / 2, D / 2, 0, H + 1);
  const front = sbz + D / 2;
  // Big front windows (lit at night).
  const storeWin = [];
  for (let i = 0; i < 5; i++) {
    const wx = sbx - 12 + i * 4.2 + (i >= 3 ? 2.6 : 0);
    storeWin.push(windows.add(mat(wx, 2.0, front + 0.04, 0, 3.6, 1.7, 1), '#5b6d84'));
  }
  const doorWin = windows.add(mat(sbx + 2.2, 1.35, front + 0.04, 0, 1.8, 2.5, 1), '#5b6d84');
  storeWin.push(doorWin);
  // Sign.
  const signTex = signTexture('QWIK STOP', { w: 128, h: 32, bg: '#b8281c', fg: '#ffd84a', font: 'bold 22px monospace', border: false });
  const signMat = psx(new THREE.MeshBasicMaterial({ map: signTex }));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), signMat);
  sign.position.set(sbx - 3, H - 0.3, front + 0.06);
  scene.add(sign);
  subjects.push({ id: 'qwik-sign', label: 'Qwik Stop sign', category: 'landmark', value: 0, pos: sign.position.clone(), radius: 4.5 });
  const opn = signTexture('OPEN 24 HRS', { w: 128, h: 32, bg: '#101010', fg: '#ff4a6a', font: 'bold 18px monospace', border: false });
  const openSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), psx(new THREE.MeshBasicMaterial({ map: opn })));
  openSign.position.set(sbx - 6, 2.4, front + 0.09);
  scene.add(openSign);

  // Ice chest, payphone, newspaper boxes.
  plain.box(I, sbx - 13.4, 0.9, front + 0.6, 1.8, 1.8, 0.9, '#e8eef4');
  plain.box(I, sbx + 13.5, 1.1, front + 0.3, 0.7, 0.9, 0.35, '#3a5aa8');
  plain.box(I, sbx + 13.5, 0.6, front + 0.3, 0.08, 1.2, 0.08, '#888');
  plain.box(I, sbx + 13.5, 1.15, front + 0.5, 0.18, 0.3, 0.06, '#1a1a1a');
  plain.box(I, sbx + 7.5, 0.55, front + 0.6, 0.5, 1.1, 0.45, '#2a5aa8');
  plain.box(I, sbx + 8.2, 0.55, front + 0.6, 0.5, 1.1, 0.45, '#e8c020');
  colliders.addBox(sbx - 13.4, front + 0.6, 0.9, 0.45, 0, 1.8);
  // Dumpster.
  plain.box(I, sbx + 17.5, 0.75, sbz, 2.0, 1.5, 3.2, '#2a5a3a');
  colliders.addBox(sbx + 17.5, sbz, 1.0, 1.6, 0, 1.5);

  interactables.push({ pos: V3(sbx + 2.2, 1, front + 1.4), radius: 2.4, prompt: 'ENTER QWIK STOP', type: 'store' });
  interactables.push({ pos: V3(sbx + 13.5, 1, front + 1.0), radius: 1.8, prompt: 'USE PAYPHONE', type: 'payphone' });

  // Gas canopy & pumps.
  const gx = 138;
  const gz = -18;
  for (const [ox, oz] of [
    [-9, -3.5],
    [9, -3.5],
    [-9, 3.5],
    [9, 3.5],
  ]) {
    plain.box(I, gx + ox, 2.4, gz + oz, 0.5, 4.8, 0.5, '#e8e8e4');
    colliders.addBox(gx + ox, gz + oz, 0.25, 0.25, 0, 4.8);
  }
  plain.box(I, gx, 5.1, gz, 22, 0.6, 11, '#f4f4f0');
  plain.box(I, gx, 5.1, gz + 5.52, 22.02, 0.3, 0.02, '#b8281c');
  plain.box(I, gx, 5.1, gz - 5.52, 22.02, 0.3, 0.02, '#b8281c');
  const panel = windows.add(mul(mat(gx, 4.74, gz), new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(mat(0, 0, 0, 0, 18, 8, 1)), '#9aa0a6');
  storeWin.push(panel);
  for (const ox of [-4.5, 4.5]) {
    plain.box(I, gx + ox, 0.12, gz, 1.2, 0.24, 6.5, '#c8c4b8');
    for (const oz of [-1.8, 1.8]) {
      plain.box(I, gx + ox, 0.95, gz + oz, 0.8, 1.6, 0.55, '#e8e8e4');
      plain.box(I, gx + ox, 1.35, gz + oz, 0.82, 0.3, 0.57, '#b8281c');
    }
    colliders.addBox(gx + ox, gz, 0.6, 3.3, 0, 1.8);
  }
  const canopyLight = { pos: V3(gx, 4.5, gz), pools: [pools.add(mat(gx, 0.32, gz, 0, 26, 1, 16), '#c8d8e8')] };

  // Price sign by the road.
  const ps = V3(124, 0, -9.5);
  plain.box(I, ps.x, 3, ps.z, 0.3, 6, 0.3, '#888');
  const price = signTexture('GAS  1.19⁹', { w: 128, h: 48, bg: '#f4f4f0', fg: '#b8281c', font: 'bold 22px monospace' });
  const pm = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 0.2), [
    psx(new THREE.MeshLambertMaterial({ color: '#ddd' })),
    psx(new THREE.MeshLambertMaterial({ color: '#ddd' })),
    psx(new THREE.MeshLambertMaterial({ color: '#ddd' })),
    psx(new THREE.MeshLambertMaterial({ color: '#ddd' })),
    psx(new THREE.MeshBasicMaterial({ map: price })),
    psx(new THREE.MeshBasicMaterial({ map: price })),
  ]);
  pm.position.set(ps.x, 5.6, ps.z);
  pm.rotation.y = Math.PI / 2;
  scene.add(pm);
  colliders.addCircle(ps.x, ps.z, 0.25, 6);

  // Parking lot lamp + the odd parked car.
  const glow = glows.add(V3(gx, 4.7, gz), '#dfeaff', 0);
  canopyLight.glow = glow;

  return { windows: storeWin, signMat, openSign: openSign.material, canopyLight, door: V3(sbx + 2.2, 0, front + 1.4) };
}

// ---------------------------------------------------------------- water tower
export function buildWaterTower(ctx) {
  const { batch: B, colliders, scene, glows, subjects } = ctx;
  const { x, z } = LANDMARKS.waterTower;
  const plain = B.get('plain');
  const leg = new THREE.CylinderGeometry(0.35, 0.45, 24, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = x + Math.cos(a) * 5.5;
    const lz = z + Math.sin(a) * 5.5;
    plain.geometry(leg, mat(lx, 12, lz), '#9aa8b2');
    colliders.addCircle(lx, lz, 0.5, 24);
  }
  for (const y of [7, 15]) {
    plain.box(I, x, y, z + 3.9, 7.8, 0.2, 0.2, '#8a98a2');
    plain.box(I, x, y, z - 3.9, 7.8, 0.2, 0.2, '#8a98a2');
    plain.box(I, x + 3.9, y, z, 0.2, 0.2, 7.8, '#8a98a2');
    plain.box(I, x - 3.9, y, z, 0.2, 0.2, 7.8, '#8a98a2');
  }
  leg.dispose();
  const tank = new THREE.CylinderGeometry(7.2, 7.2, 8, 20, 1, true);
  const bandTex = signTexture('CEDAR HOLLOW', { w: 256, h: 90, bg: '#a8b8c4', fg: '#24344a', font: 'bold 34px monospace', border: false });
  bandTex.wrapS = THREE.RepeatWrapping;
  bandTex.repeat.set(2, 1);
  const tankMesh = new THREE.Mesh(tank, psx(new THREE.MeshLambertMaterial({ map: bandTex })));
  tankMesh.position.set(x, 28, z);
  scene.add(tankMesh);
  const roof = new THREE.ConeGeometry(7.6, 3.2, 20);
  plain.geometry(roof, mat(x, 33.6, z), '#a8b8c4');
  const bottom = new THREE.SphereGeometry(7.2, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  plain.geometry(bottom, mat(x, 24, z, 0, 1, 0.35, 1), '#a8b8c4');
  roof.dispose();
  bottom.dispose();
  const beacon = glows.add(V3(x, 35.6, z), '#ff2a1a', 1.6);
  subjects.push({ id: 'water-tower', label: 'Water tower', category: 'landmark', value: 0, pos: V3(x, 26, z), radius: 12 });
  return { beacon };
}

// ---------------------------------------------------------------- radio mast
export function buildRadioTower(ctx) {
  const { scene, glows, subjects, M } = ctx;
  const { x, z } = LANDMARKS.radioTower;
  const H = 95;
  const verts = [];
  const corner = (k, y) => {
    const r = 3.2 * (1 - (y / H) * 0.75);
    const a = (k / 3) * Math.PI * 2;
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  };
  const step = 5;
  for (let y = 0; y < H; y += step) {
    for (let k = 0; k < 3; k++) {
      const a = corner(k, y);
      const b = corner(k, y + step);
      const c = corner((k + 1) % 3, y + step);
      const d = corner((k + 1) % 3, y);
      verts.push(...a, ...b, ...a, ...c, ...d, ...b, ...b, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  // Unfogged so it reads as a dark silhouette against the sky.
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0c0c10, fog: false }));
  scene.add(lines);
  const beacons = [glows.add(V3(x, H + 0.5, z), '#ff2a1a', 3.2), glows.add(V3(x, H * 0.66, z), '#ff2a1a', 2.6), glows.add(V3(x, H * 0.33, z), '#ff2a1a', 2.2)];
  subjects.push({ id: 'radio-tower', label: 'Radio mast', category: 'landmark', value: 0, pos: V3(x, H * 0.6, z), radius: 30 });
  return { beacons };
}

// ---------------------------------------------------------------- corn
export function buildCorn(ctx) {
  const { scene, M } = ctx;
  const [x0, z0, x1, z1] = ZONES.corn;
  const rng = new RNG(1031);
  const g = new THREE.BufferGeometry();
  const w = 0.55;
  const h = 1;
  // Two crossed quads.
  const pos = [-w, 0, 0, w, 0, 0, w, h, 0, -w, 0, 0, w, h, 0, -w, h, 0, 0, 0, -w, 0, 0, w, 0, h, w, 0, 0, -w, 0, h, w, 0, h, -w];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const nor = [];
  for (let i = 0; i < 6; i++) nor.push(0, 0.6, 0.8);
  for (let i = 0; i < 6; i++) nor.push(0.8, 0.6, 0);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const spots = [];
  for (let z = z0 + 2; z < z1 - 2; z += 1.25) {
    if (Math.abs(z - 86) < 2.2) continue; // tractor lane
    for (let x = x0 + 2; x < x1 - 2; x += 0.95 + rng.next() * 0.2) {
      if (rng.next() < 0.04) continue;
      spots.push([x + rng.float(-0.15, 0.15), z + rng.float(-0.2, 0.2)]);
    }
  }
  const im = new THREE.InstancedMesh(g, M.corn, spots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.float(0, Math.PI));
    const s = rng.float(2.0, 2.7);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s * 0.5, s, s * 0.5));
    im.setMatrixAt(i, m4);
  });
  im.computeBoundingSphere();
  scene.add(im);
  // Dirt between rows.
  ctx.batch.get('paint').ground(x0, z0, x1, z1, 0.06, new THREE.Color('#7a6a4a'));
  // Kept so stalks can be flattened (crop circles) and stood back up.
  im.userData.spots = spots;
  im.userData.original = im.instanceMatrix.array.slice();
  return im;
}

// ---------------------------------------------------------------- hills
export function buildHills(scene) {
  const rings = [];
  const make = (radius, minH, maxH, seed) => {
    const seg = 96;
    const pos = [];
    const heights = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      let hgt = 0;
      hgt += Math.sin(a * 3 + seed) * 0.5 + 0.5;
      hgt += (Math.sin(a * 7 + seed * 2) * 0.5 + 0.5) * 0.5;
      hgt += hash(i % seg, seed) * 0.25;
      heights.push(minH + (hgt / 1.75) * (maxH - minH));
    }
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, y) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
      const b0 = p(a0, -10),
        b1 = p(a1, -10),
        t0 = p(a0, heights[i]),
        t1 = p(a1, heights[i + 1]);
      pos.push(...b0, ...t0, ...b1, ...b1, ...t0, ...t1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({ color: 0x223344, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -4;
    mesh.frustumCulled = false;
    scene.add(mesh);
    rings.push(mesh);
  };
  make(900, 30, 95, 1.3);
  make(620, 14, 48, 4.1);
  return rings;
}
