// 2.5D collision: oriented boxes and circles on the XZ plane, each with a
// height range. Stored in a uniform grid for quick neighbor lookup.

const CELL = 12;

export class Colliders {
  constructor() {
    this.grid = new Map();
    this.all = [];
  }

  _key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  _insert(c, cx, cz, r) {
    const x0 = Math.floor((cx - r) / CELL),
      x1 = Math.floor((cx + r) / CELL);
    const z0 = Math.floor((cz - r) / CELL),
      z1 = Math.floor((cz + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    this.all.push(c);
  }

  // Oriented box: centre, half extents along its local x/z, rotation (rad).
  addBox(x, z, hw, hd, rot = 0, top = 3, bottom = -1) {
    const c = { type: 'box', x, z, hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), top, bottom };
    this._insert(c, x, z, Math.hypot(hw, hd));
    return c;
  }

  addCircle(x, z, r, top = 3, bottom = -1) {
    const c = { type: 'circle', x, z, r, top, bottom };
    this._insert(c, x, z, r);
    return c;
  }

  query(x, z, r) {
    const out = new Set();
    const x0 = Math.floor((x - r) / CELL),
      x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL),
      z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (list) for (const c of list) out.add(c);
      }
    return out;
  }

  // Push a circle (player) out of every overlapping collider. Mutates pos.
  resolve(pos, radius, feetY, headY) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.query(pos.x, pos.z, radius + 1)) {
        if (feetY >= c.top - 0.05 || headY <= c.bottom) continue;
        if (c.type === 'circle') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + radius;
          if (d < min && d > 1e-5) {
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
            hit = true;
          }
        } else {
          // Into box-local space.
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          const qx = Math.max(-c.hw, Math.min(c.hw, lx));
          const qz = Math.max(-c.hd, Math.min(c.hd, lz));
          let ex = lx - qx;
          let ez = lz - qz;
          let d = Math.hypot(ex, ez);
          if (d >= radius) continue;
          let nx, nz, push;
          if (d > 1e-5) {
            nx = ex / d;
            nz = ez / d;
            push = radius - d;
          } else {
            // Centre inside the box: exit via the nearest face.
            const px = c.hw - Math.abs(lx);
            const pz = c.hd - Math.abs(lz);
            if (px < pz) {
              nx = Math.sign(lx) || 1;
              nz = 0;
              push = px + radius;
            } else {
              nx = 0;
              nz = Math.sign(lz) || 1;
              push = pz + radius;
            }
          }
          const nlx = lx + nx * push;
          const nlz = lz + nz * push;
          // Back to world space (inverse rotation).
          pos.x = c.x + nlx * c.cos + nlz * c.sin;
          pos.z = c.z - nlx * c.sin + nlz * c.cos;
          hit = true;
        }
      }
    }
    return hit;
  }
}
