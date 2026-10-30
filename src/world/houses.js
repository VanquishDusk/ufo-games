// Procedural 90s suburban houses: siding, gable/hip roofs, attached garages,
// shutters, porch lights, pumpkins, backyard junk. Everything is written into
// shared batches; dynamic bits (windows, lights) go to instanced helpers.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { mat, mul, V3 } from './geo.js';

const SIDING = ['#e6d9bc', '#c3d3dc', '#b8c6a0', '#efe8d2', '#ecdca0', '#f2f1ec', '#c8b59c', '#9fb2c2', '#d7c0b4', '#a9b996', '#d9cfae', '#b7a48e'];
const ROOF = ['#4a4a50', '#5a4a3e', '#3a3d44', '#6a5040', '#3e4a40', '#5c5c62', '#4b3a34'];
const DOOR = ['#8a2a22', '#2f4a36', '#1f2f4e', '#f0eee6', '#5a3a28', '#6b6e2f', '#7a1f3a'];
const SHUTTER = ['#2f4a36', '#1f2f4e', '#353535', '#6a2a22', '#f0eee6', '#4a3a2a'];
const BUSH = ['#3d5a2a', '#4a6a30', '#2f4a26', '#7a2a1e', '#56682e'];
const TRIM = '#f0eee6';
const DRIVE = '#b8b4aa';

export const DAY_GLASS = new THREE.Color('#5b6d84');

const P = (M, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);

function gableRoof(B, M, cx, cz, W, D, eaveY, rise, over, along, roofCol, sideCol) {
  const S = mul(M, mat(cx, 0, cz, along === 'x' ? 0 : Math.PI / 2));
  const w = along === 'x' ? W : D;
  const d = along === 'x' ? D : W;
  const X = w / 2 + over;
  const Z = d / 2 + over;
  const slope = rise / (d / 2);
  const yE = eaveY - over * slope;
  const yR = eaveY + rise;
  const L = Math.hypot(Z, yR - yE);
  const ts = 1.5;
  const uv = [
    [0, 0],
    [(2 * X) / ts, 0],
    [(2 * X) / ts, L / ts],
    [0, L / ts],
  ];
  const roof = B.get('roof');
  roof.quad(S, V3(-X, yE, Z), V3(X, yE, Z), V3(X, yR, 0), V3(-X, yR, 0), uv, roofCol);
  roof.quad(S, V3(X, yE, -Z), V3(-X, yE, -Z), V3(-X, yR, 0), V3(X, yR, 0), uv, roofCol);
  const sid = B.get('siding');
  const hw = w / 2;
  const hd = d / 2;
  const ts2 = 1.6;
  const tuv = [
    [0, eaveY / ts2],
    [d / ts2, eaveY / ts2],
    [d / 2 / ts2, yR / ts2],
  ];
  sid.tri(S, V3(hw, eaveY, hd), V3(hw, eaveY, -hd), V3(hw, yR, 0), ...tuv, sideCol);
  sid.tri(S, V3(-hw, eaveY, -hd), V3(-hw, eaveY, hd), V3(-hw, yR, 0), ...tuv, sideCol);
  return yR;
}

function hipRoof(B, M, cx, cz, W, D, eaveY, rise, over, roofCol) {
  const rotate = D > W;
  const S = mul(M, mat(cx, 0, cz, rotate ? Math.PI / 2 : 0));
  const w = rotate ? D : W;
  const d = rotate ? W : D;
  const X = w / 2 + over;
  const Z = d / 2 + over;
  const slope = rise / (d / 2);
  const yE = eaveY - over * slope;
  const yR = eaveY + rise;
  const rx = Math.max(X - Z, 0.05);
  const L = Math.hypot(Z, yR - yE);
  const ts = 1.5;
  const roof = B.get('roof');
  const uv = [
    [0, 0],
    [(2 * X) / ts, 0],
    [(X + rx) / ts, L / ts],
    [(X - rx) / ts, L / ts],
  ];
  roof.quad(S, V3(-X, yE, Z), V3(X, yE, Z), V3(rx, yR, 0), V3(-rx, yR, 0), uv, roofCol);
  roof.quad(S, V3(X, yE, -Z), V3(-X, yE, -Z), V3(-rx, yR, 0), V3(rx, yR, 0), uv, roofCol);
  const tuv = [
    [0, 0],
    [(2 * Z) / ts, 0],
    [Z / ts, L / ts],
  ];
  roof.tri(S, V3(X, yE, Z), V3(X, yE, -Z), V3(rx, yR, 0), ...tuv, roofCol);
  roof.tri(S, V3(-X, yE, -Z), V3(-X, yE, Z), V3(-rx, yR, 0), ...tuv, roofCol);
  return yR;
}

// Low-poly pumpkin; returns its top position (for the jack-o'-lantern glow).
function pumpkin(B, M, x, y, z, r, rng) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  B.get('flat').geometry(g, mul(M, mat(x, y + r * 0.7, z, rng.float(0, 6), 1, 0.72, 1)), rng.pick(['#d8661c', '#e07a22', '#c85a18']));
  B.get('plain').box(M, x, y + r * 1.45, z, 0.06, 0.12, 0.06, '#4a5a22');
  g.dispose();
  return P(M, x, y + r * 0.75, z);
}

export function buildHouse(lot, index, ctx) {
  const { batch: B, windows, glows, pools, colliders } = ctx;
  const rng = new RNG(lot.seed);
  const L = mat(lot.ox, 0, lot.oz, lot.rot);
  const F = lot.F;
  const depth = lot.depth;
  const isPlayer = !!lot.isPlayer;

  const hasGarage = isPlayer || rng.chance(0.85);
  const gW = 6.2;
  const gD = 7;
  const gH = 2.9;
  const gSide = rng.sign();
  let W = rng.float(9, 12.5);
  const D = rng.float(8, 10.5);
  W = Math.min(W, F - 3 - (hasGarage ? gW : 0));
  const stories = isPlayer ? 2 : rng.chance(0.5) ? 2 : 1;
  const H = 0.3 + stories * 2.8;
  const setback = lot.radial ? 5.5 : rng.float(6.5, 9.5);
  const bx = hasGarage ? -gSide * (gW / 2) * 0.9 : 0;
  const bz = -(setback + D / 2);
  const gx = bx + gSide * (W / 2 + gW / 2);
  const gFwd = rng.float(0, 1.6);
  const gz = -(setback + gD / 2) + gFwd;
  const roofType = rng.pick(['gx', 'gx', 'gz', 'hip']);
  const rise = rng.float(1.8, 2.7);
  const sidingCol = new THREE.Color(isPlayer ? '#b9cfd8' : rng.pick(SIDING));
  const roofCol = new THREE.Color(rng.pick(ROOF));
  const doorCol = new THREE.Color(isPlayer ? '#8a2a22' : rng.pick(DOOR));
  const shutters = rng.chance(0.55);
  const shutterCol = new THREE.Color(rng.pick(SHUTTER));
  const brickFront = !isPlayer && rng.chance(0.2);

  const house = {
    index,
    lot,
    isPlayer,
    windows: [],
    wake: rng.float(5.8, 7.6),
    bed: rng.float(21.8, 25.5),
    eve: rng.float(-0.6, 0.8),
    nightOwl: rng.chance(0.15),
    porchGlow: -1,
    porchPool: -1,
    pumpkinGlows: [],
  };

  const sid = B.get('siding');
  const plain = B.get('plain');
  const conc = B.get('concrete');

  // Body + foundation.
  sid.box(L, bx, H / 2, bz, W, H, D, sidingCol, { ts: 1.6, skip: 'tb', v0: true });
  conc.box(L, bx, 0.15, bz, W + 0.1, 0.3, D + 0.1, '#a9a59c', { ts: 2, skip: 'tb' });

  let ridgeY;
  if (roofType === 'hip') ridgeY = hipRoof(B, L, bx, bz, W, D, H, rise, 0.45, roofCol);
  else ridgeY = gableRoof(B, L, bx, bz, W, D, H, rise, 0.45, roofType === 'gx' ? 'x' : 'z', roofCol, sidingCol);

  colliders.addBox(...worldXZ(L, bx, bz), W / 2, D / 2, lot.rot, ridgeY);

  // Garage.
  if (hasGarage) {
    sid.box(L, gx, gH / 2, gz, gW, gH, gD, sidingCol, { ts: 1.6, skip: 'tb', v0: true });
    gableRoof(B, L, gx, gz, gW, gD, gH, 1.3, 0.35, 'x', roofCol, sidingCol);
    const zf = gz + gD / 2;
    plain.box(L, gx, 1.2, zf + 0.015, 5.3, 2.45, 0.03, TRIM, { skip: 'kb' });
    B.get('garageDoor').quad(L, V3(gx - 2.5, 0.02, zf + 0.04), V3(gx + 2.5, 0.02, zf + 0.04), V3(gx + 2.5, 2.3, zf + 0.04), V3(gx - 2.5, 2.3, zf + 0.04), null, rng.pick(['#efeee8', '#e2d8c4', '#d8d4cc']));
    colliders.addBox(...worldXZ(L, gx, gz), gW / 2, gD / 2, lot.rot, gH + 1.3);
    // Basketball hoop over the garage.
    if (!isPlayer && rng.chance(0.22)) {
      plain.box(L, gx, gH + 0.75, zf + 0.25, 1.2, 0.8, 0.05, '#f4f4f4');
      plain.box(L, gx, gH + 0.45, zf + 0.55, 0.46, 0.03, 0.46, '#d8561c', { skip: 'b' });
    }
  }

  // Front door, porch, light.
  const zfB = bz + D / 2;
  const doorX = bx + (hasGarage ? -gSide * rng.float(0.5, Math.max(0.6, W / 2 - 1.8)) : rng.float(-W / 4, W / 4));
  plain.box(L, doorX, 1.4, zfB + 0.015, 1.3, 2.3, 0.03, TRIM, { skip: 'kb' });
  B.get('door').quad(L, V3(doorX - 0.5, 0.3, zfB + 0.035), V3(doorX + 0.5, 0.3, zfB + 0.035), V3(doorX + 0.5, 2.4, zfB + 0.035), V3(doorX - 0.5, 2.4, zfB + 0.035), null, doorCol);
  conc.box(L, doorX, 0.15, zfB + 0.9, 2.6, 0.3, 1.8, '#b4b0a6', { ts: 2, skip: 'b' });
  if (brickFront) {
    // Brick wainscot, split around the door.
    for (const [a, b] of [
      [bx - W / 2, doorX - 0.7],
      [doorX + 0.7, bx + W / 2],
    ]) {
      if (b - a > 0.2) B.get('brick').box(L, (a + b) / 2, 0.62, zfB + 0.05, b - a, 0.64, 0.1, '#ffffff', { ts: 1.2, skip: 'kb' });
    }
  }
  if (rng.chance(0.4) || isPlayer) {
    // Little porch roof on posts.
    plain.box(L, doorX - 1.2, 1.5, zfB + 1.65, 0.16, 2.4, 0.16, TRIM);
    plain.box(L, doorX + 1.2, 1.5, zfB + 1.65, 0.16, 2.4, 0.16, TRIM);
    B.get('roof').box(L, doorX, 2.76, zfB + 0.95, 3.0, 0.14, 1.95, roofCol, { ts: 1.5 });
  }
  plain.box(L, doorX + 0.85, 2.05, zfB + 0.08, 0.16, 0.26, 0.12, '#2a2a2a');
  house.porchGlow = glows.add(P(L, doorX + 0.85, 2.05, zfB + 0.2), '#ffcf8a', 0.55);
  house.porchPool = pools.add(mul(L, mat(doorX, 0.31, zfB + 1.2, 0, 3.4, 1, 3.4)), '#ffb463');
  house.door = P(L, doorX, 0, zfB + 1.4);
  house.porch = P(L, doorX + 0.7, 0.3, zfB + 0.9);
  house.facing = lot.rot;

  // Walkway to the sidewalk.
  const walkStart = zfB + 1.8;
  conc.box(L, doorX, 0.08, walkStart / 2, 1.2, 0.24, -walkStart, '#bab6ac', { ts: 1.2, skip: 'b' });

  // Driveway.
  const driveX = hasGarage ? gx : bx + gSide * (W / 2 + 2.8);
  const driveFrom = hasGarage ? gz + gD / 2 : bz;
  const dLen = 2.0 - driveFrom;
  conc.box(L, driveX, 0.13, driveFrom + dLen / 2, 5.4, 0.24, dLen, DRIVE, { ts: 2.7, skip: 'b' });

  // Windows.
  const addWindow = (faceM, w, h) => {
    plain.box(faceM, 0, 0, 0.03, w + 0.24, h + 0.24, 0.06, TRIM, { skip: 'kb' });
    plain.box(faceM, 0, -h / 2 - 0.14, 0.09, w + 0.42, 0.07, 0.16, TRIM, { skip: 'b' });
    if (shutters) {
      plain.box(faceM, -(w / 2 + 0.36), 0, 0.05, 0.4, h + 0.1, 0.05, shutterCol, { skip: 'kb' });
      plain.box(faceM, w / 2 + 0.36, 0, 0.05, 0.4, h + 0.1, 0.05, shutterCol, { skip: 'kb' });
    }
    const idx = windows.add(mul(faceM, mat(0, 0, 0.065, 0, w, h, 1)), DAY_GLASS);
    house.windows.push({ idx, r: rng.next(), tv: false });
  };
  const storyY = (s) => 0.3 + 1.45 + s * 2.8;
  for (let s = 0; s < stories; s++) {
    const n = Math.max(1, Math.floor(W / 2.8));
    for (let i = 0; i < n; i++) {
      const x = bx - W / 2 + ((i + 0.5) * W) / n;
      if (s === 0 && Math.abs(x - doorX) < 1.5) continue;
      addWindow(mul(L, mat(x, storyY(s), zfB, 0)), 1.1, 1.3);
    }
    const nb = Math.max(1, Math.floor(W / 3.2));
    for (let i = 0; i < nb; i++) {
      const x = bx - W / 2 + ((i + 0.5) * W) / nb;
      addWindow(mul(L, mat(x, storyY(s), bz - D / 2, Math.PI)), 1.0, 1.2);
    }
    const ns = Math.max(1, Math.floor(D / 3.6));
    for (const side of [-1, 1]) {
      if (s === 0 && hasGarage && side === gSide) continue;
      for (let i = 0; i < ns; i++) {
        const z = bz - D / 2 + ((i + 0.5) * D) / ns;
        addWindow(mul(L, mat(bx + side * (W / 2), storyY(s), z, side * (Math.PI / 2))), 0.9, 1.2);
      }
    }
  }
  if (house.windows.length && rng.chance(0.45)) house.windows[rng.int(0, house.windows.length - 1)].tv = true;

  // Chimney.
  if (roofType !== 'gz' && rng.chance(0.45)) {
    const side = hasGarage ? -gSide : rng.sign();
    const cxl = bx + side * (W / 2 + 0.45);
    const czl = bz + rng.float(-1, 1);
    const ch = ridgeY + 0.9;
    B.get('brick').box(L, cxl, ch / 2, czl, 0.9, ch, 1.2, '#ffffff', { ts: 1.2, skip: 'b' });
  }

  // TV antenna or (for us) a satellite dish.
  if (isPlayer) {
    const dx = bx - gSide * (W / 2 + 0.25);
    plain.box(L, dx, H - 0.9, bz + 1.2, 0.08, 0.6, 0.08, '#6a6a6a');
    const dish = new THREE.CylinderGeometry(0.5, 0.42, 0.08, 10);
    const dm = mul(L, mul(mat(dx - gSide * 0.15, H - 0.45, bz + 1.2, -gSide * 0.6), new THREE.Matrix4().makeRotationX(-1.1)));
    plain.geometry(dish, dm, '#d8d8d4');
    dish.dispose();
  } else if (rng.chance(0.3)) {
    const ax = bx + rng.float(-W / 4, W / 4);
    plain.box(L, ax, ridgeY + 0.9, bz, 0.05, 1.8, 0.05, '#777');
    for (let k = 0; k < 3; k++) plain.box(L, ax, ridgeY + 0.9 + k * 0.4, bz, 1.6 - k * 0.35, 0.03, 0.03, '#777');
  }

  // Shrubs along the front.
  const ico = new THREE.IcosahedronGeometry(0.55, 0);
  for (let x = bx - W / 2 + 0.7; x < bx + W / 2 - 0.5; x += rng.float(1.3, 1.9)) {
    if (Math.abs(x - doorX) < 1.6) continue;
    const s = rng.float(0.8, 1.2);
    B.get('leaves').geometry(ico, mul(L, mat(x, 0.35 * s, zfB + 0.7, rng.float(0, 6), s, 0.8 * s, s)), rng.pick(BUSH));
  }

  // Mailbox at the curb.
  const mbx = Math.max(-F / 2 + 0.6, Math.min(F / 2 - 0.6, driveX - gSide * 3.4));
  plain.box(L, mbx, 0.55, -0.45, 0.1, 1.1, 0.1, '#5a4632');
  plain.box(L, mbx, 1.2, -0.45, 0.24, 0.26, 0.5, rng.pick(['#222428', '#e8e6e0', '#2a3a5a', '#5a2a22']));
  plain.box(L, mbx + 0.13, 1.3, -0.5, 0.02, 0.16, 0.08, '#c22a1e');
  colliders.addCircle(...worldXZ(L, mbx, -0.45), 0.18, 1.35);
  house.mailbox = P(L, mbx, 1.2, -0.45);

  if (rng.chance(0.3)) {
    const cyl = new THREE.CylinderGeometry(0.3, 0.27, 0.95, 8);
    for (const k of [0, 1]) plain.geometry(cyl, mul(L, mat(mbx + (k ? 0.8 : 1.45) * -Math.sign(mbx - driveX || 1), 0.48, -0.9, 0)), rng.pick(['#2e4a32', '#3a3c40']));
    cyl.dispose();
  }

  // Front yard tree(s).
  const yardTree = (zMin, zMax) => {
    for (let k = 0; k < 8; k++) {
      const x = rng.float(-F / 2 + 2, F / 2 - 2);
      const z = rng.float(zMin, zMax);
      if (Math.abs(x - driveX) < 4.2 || Math.abs(x - doorX) < 2) continue;
      if (z < -setback + 1 && Math.abs(x - bx) < W / 2 + 2) continue;
      const [wx, wz] = worldXZ(L, x, z);
      ctx.trees.push({ x: wx, z: wz, kind: rng.chance(0.25) ? 'pine' : 'decid', scale: rng.float(0.85, 1.3), seed: rng.next() });
      return;
    }
  };
  if (rng.chance(0.75)) yardTree(-setback + 2, -2);
  const backZ0 = -depth + 2.5;
  const backZ1 = bz - D / 2 - 2.5;
  if (backZ1 - backZ0 > 3 && rng.chance(0.6)) yardTree(backZ0, backZ1);

  // Backyard privacy fence.
  if (rng.chance(0.45) && backZ1 - backZ0 > 2) {
    const wood = B.get('wood');
    const fz = -depth + 0.2;
    wood.box(L, 0, 0.9, fz, F, 1.8, 0.08, '#c8b090', { ts: 1.8, skip: 'b' });
    colliders.addBox(...worldXZ(L, 0, fz), F / 2, 0.1, lot.rot, 1.8);
    const sLen = bz - fz;
    for (const sx of [-F / 2 + 0.1, F / 2 - 0.1]) {
      wood.box(L, sx, 0.9, fz + sLen / 2, 0.08, 1.8, sLen, '#c8b090', { ts: 1.8, skip: 'b' });
      colliders.addBox(...worldXZ(L, sx, fz + sLen / 2), 0.1, sLen / 2, lot.rot, 1.8);
    }
  }

  // White picket fence out front.
  if (!isPlayer && rng.chance(0.22)) {
    const fz = -0.9;
    const gaps = [
      [driveX - 3, driveX + 3],
      [doorX - 0.9, doorX + 0.9],
      [mbx - 0.5, mbx + 0.5],
    ];
    let segStart = null;
    const flush = (a, b) => {
      if (b - a < 0.4) return;
      plain.box(L, (a + b) / 2, 0.45, fz, b - a, 0.06, 0.04, TRIM);
      plain.box(L, (a + b) / 2, 0.75, fz, b - a, 0.06, 0.04, TRIM);
      colliders.addBox(...worldXZ(L, (a + b) / 2, fz), (b - a) / 2, 0.08, lot.rot, 0.95);
    };
    for (let x = -F / 2 + 0.2; x <= F / 2 - 0.2; x += 0.2) {
      const inGap = gaps.some(([a, b]) => x > a && x < b);
      if (inGap) {
        if (segStart !== null) flush(segStart, x - 0.2);
        segStart = null;
        continue;
      }
      if (segStart === null) segStart = x;
      plain.box(L, x, 0.47, fz + 0.03, 0.08, 0.94, 0.03, TRIM, { skip: 'b' });
    }
    if (segStart !== null) flush(segStart, F / 2 - 0.2);
  }

  // Backyard stuff.
  if (backZ1 - backZ0 > 4) {
    const spot = () => [rng.float(-F / 2 + 3, F / 2 - 3), rng.float(backZ0 + 1, backZ1 - 1)];
    if (rng.chance(0.2)) {
      const [x, z] = spot();
      B.get('wood').box(L, x, 1.1, z, 2.4, 2.2, 2.0, '#b89a78', { ts: 1.8, skip: 'b' });
      gableRoof(B, L, x, z, 2.4, 2.0, 2.2, 0.7, 0.15, 'x', roofCol, new THREE.Color('#b89a78'));
      colliders.addBox(...worldXZ(L, x, z), 1.2, 1.0, lot.rot, 2.9);
    }
    if (rng.chance(0.18)) {
      const [x, z] = spot();
      const col = rng.pick(['#3a6aa8', '#2f7a4a', '#b8442a']);
      for (const sx of [-1.4, 1.4]) {
        plain.box(L, x + sx, 1.1, z - 0.6, 0.08, 2.3, 0.08, col);
        plain.box(L, x + sx, 1.1, z + 0.6, 0.08, 2.3, 0.08, col);
      }
      plain.box(L, x, 2.2, z, 3.0, 0.08, 0.08, col);
      for (const sx of [-0.5, 0.5]) {
        plain.box(L, x + sx, 0.5, z, 0.45, 0.04, 0.2, '#222');
        plain.box(L, x + sx - 0.2, 1.35, z, 0.02, 1.7, 0.02, '#999');
        plain.box(L, x + sx + 0.2, 1.35, z, 0.02, 1.7, 0.02, '#999');
      }
    }
    if (rng.chance(0.12)) {
      const [x, z] = spot();
      const cyl = new THREE.CylinderGeometry(2.2, 2.2, 1.1, 16, 1, true);
      plain.geometry(cyl, mul(L, mat(x, 0.55, z)), '#7aa8c8');
      cyl.dispose();
      B.get('paint').disc(...worldXZ(L, x, z), 0, 2.15, 1.0, new THREE.Color('#2f78a8'), 16);
      colliders.addCircle(...worldXZ(L, x, z), 2.25, 1.1);
    }
    if (rng.chance(0.25)) {
      const [x, z] = spot();
      plain.box(L, x, 0.85, z, 0.7, 0.35, 0.45, '#1e1e20');
      plain.box(L, x, 0.4, z, 0.06, 0.8, 0.06, '#333');
    }
    if (rng.chance(0.1)) {
      const [x, z] = spot();
      B.get('paint').disc(...worldXZ(L, x, z), 1.5, 1.8, 0.85, new THREE.Color('#2a5aa8'), 16);
      B.get('paint').disc(...worldXZ(L, x, z), 0, 1.5, 0.84, new THREE.Color('#1a1a1c'), 16);
      colliders.addCircle(...worldXZ(L, x, z), 1.8, 0.85);
    }
  }

  // Halloween is coming.
  if (isPlayer || rng.chance(0.35)) {
    const n = isPlayer ? 1 : rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      const top = pumpkin(B, L, doorX + side * rng.float(0.75, 1.1), 0.3, zfB + rng.float(1.1, 1.6), rng.float(0.2, 0.3), rng);
      if (rng.chance(0.7)) house.pumpkinGlows.push(glows.add(top, '#ff8a2a', 0.5));
    }
  }
  if (!isPlayer && rng.chance(0.08)) {
    const x = rng.float(-F / 2 + 2, F / 2 - 2);
    if (Math.abs(x - driveX) > 4) {
      plain.box(L, x, 0.4, -setback / 2, 0.6, 0.8, 0.12, '#8a8a86');
      plain.box(L, x + 1.1, 0.33, -setback / 2 - 0.4, 0.55, 0.66, 0.12, '#8a8a86');
    }
  }

  // Car in the driveway.
  if (isPlayer || rng.chance(0.65)) {
    const cz = Math.min(-2.6, driveFrom + 2.8);
    ctx.cars.push({ matrix: mul(L, mat(driveX, 0, cz, rng.chance(0.7) ? 0 : Math.PI)), seed: rng.next(), collide: true });
  }

  ico.dispose();
  return house;
}

export function worldXZ(M, x, z) {
  const v = new THREE.Vector3(x, 0, z).applyMatrix4(M);
  return [v.x, v.z];
}
