// Town plan for Cedar Hollow. Streets are axis-aligned; lots are generated
// along both sides of each street and rejected where they hit roads, other
// lots or reserved zones (park, store, corn field...).
import { RNG } from '../core/rng.js';

export const ROAD_HALF = 4.5;
export const WALK_W = 2;
export const LOT_FRONT = ROAD_HALF + WALK_W; // lots start at the sidewalk's outer edge
export const CUL_R = 13;
export const BOUNDS = 205; // playable half-extent

export const STREETS = [
  { id: 'maple', name: 'MAPLE AVE', axis: 'x', c: 0, a: -330, b: 330, main: true, lotsA: -185, lotsB: 112 },
  { id: 'oak', name: 'OAK ST', axis: 'z', c: -80, a: -144.5, b: 96, cul: 'b' },
  { id: 'hemlock', name: 'HEMLOCK DR', axis: 'x', c: -140, a: -84.5, b: 52, cul: 'b' },
  { id: 'birch', name: 'BIRCH LN', axis: 'z', c: 44, a: 0, b: 140, cul: 'b' },
];

// Rectangular zones where no houses go: [x0, z0, x1, z1].
export const ZONES = {
  park: [-36, -98, 28, -8],
  store: [116, -46, 172, -7],
  corn: [92, 22, 196, 150],
  waterTower: [-170, -86, -128, -40],
  field: [-200, 72, -110, 170],
};

export const LANDMARKS = {
  waterTower: { x: -150, z: -62 },
  radioTower: { x: -262, z: 132 },
  store: { x: 146, z: -30 },
};

export function streetRect(s) {
  return s.axis === 'x'
    ? [s.a, s.c - ROAD_HALF, s.b, s.c + ROAD_HALF]
    : [s.c - ROAD_HALF, s.a, s.c + ROAD_HALF, s.b];
}

export function culCenter(s) {
  if (!s.cul) return null;
  const end = s.cul === 'b' ? s.b : s.a;
  return s.axis === 'x' ? { x: end, z: s.c } : { x: s.c, z: end };
}

const overlap = (a, b, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

function rectCircle(r, cx, cz, rad) {
  const qx = Math.max(r[0], Math.min(r[2], cx));
  const qz = Math.max(r[1], Math.min(r[3], cz));
  return (qx - cx) ** 2 + (qz - cz) ** 2 < rad * rad;
}

// Transform from lot-local (front = +z toward the street) to world.
function lotWorldRect(ox, oz, rot, F, depth) {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  const pts = [
    [-F / 2, 0],
    [F / 2, 0],
    [F / 2, -depth],
    [-F / 2, -depth],
  ].map(([x, z]) => [ox + x * c + z * s, oz - x * s + z * c]);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

// Sidewalk segments for a street side, cut where other roads cross.
export function sidewalkSegments(s, side) {
  const off = s.c + side * (ROAD_HALF + WALK_W / 2);
  const intervals = [];
  for (const o of STREETS) {
    if (o === s) continue;
    const r = streetRect(o);
    // Sidewalk band rect.
    const band = s.axis === 'x' ? [s.a, off - 1, s.b, off + 1] : [off - 1, s.a, off + 1, s.b];
    if (!overlap(band, r)) continue;
    intervals.push(s.axis === 'x' ? [r[0], r[2]] : [r[1], r[3]]);
  }
  const cc = culCenter(s);
  if (cc) {
    const along = s.axis === 'x' ? cc.x : cc.z;
    const d = Math.abs(side * (ROAD_HALF + WALK_W / 2));
    const half = Math.sqrt(Math.max(0, (CUL_R + 1) ** 2 - d * d));
    intervals.push([along - half, along + half]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = s.a;
  for (const [i0, i1] of intervals) {
    if (i0 > cur) segs.push([cur, Math.min(i0, s.b)]);
    cur = Math.max(cur, i1);
  }
  if (cur < s.b) segs.push([cur, s.b]);
  return segs.filter(([a, b]) => b - a > 0.5).map(([a, b]) => ({ a, b, off }));
}

export function generateLots(seed = 42) {
  const rng = new RNG(seed);
  const lots = [];
  const zones = Object.values(ZONES);

  // Other streets (plus their sidewalks) and cul-de-sac bulbs are off limits.
  const ok = (rect, own, radial) => {
    for (const o of STREETS) {
      if (o === own) continue;
      if (overlap(rect, streetRect(o), WALK_W + 0.5)) return false;
      const c = culCenter(o);
      if (c && rectCircle(rect, c.x, c.z, CUL_R + WALK_W + 1)) return false;
    }
    if (!radial) {
      const c = culCenter(own);
      if (c && rectCircle(rect, c.x, c.z, CUL_R + WALK_W + 1)) return false;
    }
    for (const z of zones) if (overlap(rect, z)) return false;
    for (const l of lots) if (overlap(rect, l.rect, -0.01)) return false;
    if (rect[0] < -BOUNDS || rect[2] > BOUNDS || rect[1] < -BOUNDS || rect[3] > BOUNDS) return false;
    return true;
  };

  for (const s of STREETS) {
    for (const side of [-1, 1]) {
      const a0 = Math.max(s.a, s.lotsA ?? -Infinity) + 2;
      const b0 = Math.min(s.b, s.lotsB ?? Infinity) - (s.cul === 'b' ? CUL_R + 4 : 0);
      let t = a0;
      while (t < b0 - 18) {
        const F = rng.float(21, 25);
        const depth = rng.float(26, 31);
        const along = t + F / 2;
        let ox, oz, rot;
        if (s.axis === 'x') {
          ox = along;
          oz = s.c + side * LOT_FRONT;
          rot = side < 0 ? 0 : Math.PI;
        } else {
          ox = s.c + side * LOT_FRONT;
          oz = along;
          rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        const rect = lotWorldRect(ox, oz, rot, F, depth);
        if (ok(rect, s, false)) {
          lots.push({ ox, oz, rot, F, depth, rect, street: s, side, seed: rng.int(1, 1e9) });
          t += F;
        } else {
          t += 3;
        }
      }
    }
    // Radial lots around a cul-de-sac bulb.
    const cc = culCenter(s);
    if (cc) {
      const dirAlong = s.cul === 'b' ? 1 : -1;
      const baseAng = s.axis === 'x' ? (dirAlong > 0 ? 0 : Math.PI) : dirAlong > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (const da of [-1.05, 0, 1.05]) {
        const ang = baseAng + da;
        const dx = Math.cos(ang),
          dz = Math.sin(ang);
        const ox = cc.x + dx * (CUL_R + WALK_W);
        const oz = cc.z + dz * (CUL_R + WALK_W);
        // Local +z must point back to the centre (-d).
        const rot = Math.atan2(-dx, -dz);
        const F = 22;
        const depth = 30;
        const rect = lotWorldRect(ox, oz, rot, F * 0.8, depth);
        if (ok(rect, s, true)) lots.push({ ox, oz, rot, F, depth, rect, street: s, side: 0, radial: true, seed: rng.int(1, 1e9) });
      }
    }
  }

  // Pick the player's home: east side of Birch Ln, backing onto the corn.
  let best = null;
  let bestD = Infinity;
  for (const l of lots) {
    if (l.street.id !== 'birch' || l.side !== 1) continue;
    const d = Math.abs(l.oz - 66);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  if (best) best.isPlayer = true;
  let num = 100;
  for (const l of lots) l.address = (num += 2 + rng.int(0, 6) * 2);
  if (best) best.address = 1417;
  return lots;
}

// What's underfoot (for footstep sounds).
export function surfaceAt(x, z) {
  for (const s of STREETS) {
    const r = streetRect(s);
    if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return 'road';
    const cc = culCenter(s);
    if (cc && (x - cc.x) ** 2 + (z - cc.z) ** 2 < CUL_R * CUL_R) return 'road';
    const d = s.axis === 'x' ? Math.abs(z - s.c) : Math.abs(x - s.c);
    const along = s.axis === 'x' ? x : z;
    if (d < LOT_FRONT && along > s.a && along < s.b) return 'concrete';
  }
  const c = ZONES.corn;
  if (x > c[0] && x < c[2] && z > c[1] && z < c[3]) return 'corn';
  const st = ZONES.store;
  if (x > st[0] && x < st[2] && z > st[1] && z < st[3]) return 'road';
  return 'grass';
}
