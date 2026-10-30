// Procedural low-res textures painted on canvases. Everything is small and
// nearest-filtered for that late-90s console look. Grayscale textures are
// tinted per-vertex so one texture serves every house color.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function canvasTexture(c, { repeat = true, srgb = true, smooth = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  return t;
}

// Per-pixel painter: fn(x, y) -> [r, g, b, a?] in 0..255.
function paint(w, h, fn) {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = fn(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = p[0];
      img.data[i + 1] = p[1];
      img.data[i + 2] = p[2];
      img.data[i + 3] = p.length > 3 ? p[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cl = (v) => Math.max(0, Math.min(255, v | 0));

// Tileable value noise for clouds etc.
function tileNoise(size, period, rng) {
  const grid = [];
  for (let i = 0; i < period * period; i++) grid.push(rng.next());
  const at = (x, y) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return (x, y) => {
    const fx = (x / size) * period;
    const fy = (y / size) * period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function createTextures() {
  const rng = new RNG(1997);
  const T = {};

  // Autumn lawn: patchy green with dry yellow tufts and the odd fallen leaf.
  {
    const n = tileNoise(64, 8, rng);
    T.grass = canvasTexture(
      paint(64, 64, (x, y) => {
        const v = n(x, y) * 0.5 + rng.next() * 0.5;
        let r = 78 + v * 40;
        let g = 104 + v * 42;
        let b = 46 + v * 18;
        const s = rng.next();
        if (s < 0.03) {
          r = 168;
          g = 118;
          b = 40;
        } else if (s < 0.05) {
          r = 150;
          g = 64;
          b = 34;
        } else if (s < 0.2) {
          r *= 0.82;
          g *= 0.86;
        }
        return [cl(r), cl(g), cl(b)];
      }),
    );
  }

  T.asphalt = canvasTexture(
    paint(64, 64, (x, y) => {
      const v = 58 + rng.next() * 22 + (rng.next() < 0.03 ? 40 : 0);
      return [cl(v), cl(v), cl(v + 3)];
    }),
  );

  // Concrete slab with a joint on two edges -> grid when tiled.
  T.concrete = canvasTexture(
    paint(64, 64, (x, y) => {
      let v = 168 + rng.next() * 18;
      if (x === 0 || y === 0) v -= 60;
      if (rng.next() < 0.02) v -= 30;
      return [cl(v), cl(v - 2), cl(v - 6)];
    }),
  );

  // Vinyl siding planks, grayscale (tinted per house).
  T.siding = canvasTexture(
    paint(64, 64, (x, y) => {
      const py = y % 8;
      let v = 236 - py * 3 + rng.next() * 6;
      if (py === 7) v = 150;
      if (py === 6) v -= 20;
      return [cl(v), cl(v), cl(v)];
    }),
  );

  // Asphalt shingles, grayscale.
  {
    const tabs = [];
    for (let i = 0; i < 64; i++) tabs.push(170 + rng.next() * 60);
    T.shingles = canvasTexture(
      paint(64, 64, (x, y) => {
        const row = Math.floor(y / 8);
        const off = row % 2 ? 8 : 0;
        const col = Math.floor((x + off) / 16);
        let v = tabs[(row * 5 + col) % 64] + rng.next() * 18;
        if (y % 8 === 7) v = 70;
        if ((x + off) % 16 === 0) v = 95;
        return [cl(v), cl(v), cl(v)];
      }),
    );
  }

  // Red brick.
  T.brick = canvasTexture(
    paint(64, 64, (x, y) => {
      const row = Math.floor(y / 8);
      const off = row % 2 ? 8 : 0;
      const bx = Math.floor((x + off) / 16);
      const mortar = y % 8 === 7 || (x + off) % 16 === 15;
      if (mortar) {
        const m = 170 + rng.next() * 20;
        return [cl(m), cl(m - 4), cl(m - 10)];
      }
      const tone = ((bx * 7 + row * 13) % 5) * 9;
      return [cl(140 + tone + rng.next() * 16), cl(62 + tone * 0.4 + rng.next() * 10), cl(44 + rng.next() * 10)];
    }),
  );

  // Vertical wooden boards (fences, sheds), grayscale-warm.
  T.wood = canvasTexture(
    paint(64, 64, (x, y) => {
      const bx = Math.floor(x / 8);
      let v = 200 + ((bx * 37) % 23) + Math.sin(y * 0.4 + bx) * 6 + rng.next() * 12;
      if (x % 8 === 0) v = 110;
      return [cl(v), cl(v * 0.93), cl(v * 0.85)];
    }),
  );

  // Sectional garage door (single, non-tiling).
  T.garageDoor = canvasTexture(
    paint(64, 32, (x, y) => {
      let v = 228;
      const py = y % 8;
      if (py === 0) v = 150;
      const px = x % 16;
      if (py >= 2 && py <= 6 && px >= 2 && px <= 13) v = 210;
      if ((py === 2 || py === 6) && px >= 2 && px <= 13) v = 190;
      if (x === 0 || x === 63) v = 160;
      return [cl(v), cl(v), cl(v)];
    }),
    { repeat: false },
  );

  // Six-panel front door, grayscale.
  T.door = canvasTexture(
    paint(32, 64, (x, y) => {
      let v = 220;
      const panelsX = [
        [4, 14],
        [18, 28],
      ];
      const panelsY = [
        [4, 18],
        [22, 40],
        [44, 60],
      ];
      for (const [x0, x1] of panelsX)
        for (const [y0, y1] of panelsY) {
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
            v = x === x0 || y === y0 ? 170 : x === x1 || y === y1 ? 245 : 205;
          }
        }
      if (x >= 25 && x <= 27 && y >= 33 && y <= 35) return [214, 180, 80];
      if (x === 0 || x === 31 || y === 0) v = 140;
      return [cl(v), cl(v), cl(v)];
    }),
    { repeat: false },
  );

  // Window glass mask: white panes (tinted per instance), dark mullions.
  T.window = canvasTexture(
    paint(16, 16, (x, y) => {
      const frame = x === 0 || x === 15 || y === 0 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8;
      if (frame) return [40, 40, 44];
      const shine = x + y < 9 && x > 1 && y > 1 ? 30 : 0;
      return [cl(225 + shine), cl(225 + shine), cl(230 + shine)];
    }),
    { repeat: false },
  );

  T.bark = canvasTexture(
    paint(32, 32, (x, y) => {
      const v = 70 + Math.sin(x * 1.7 + Math.sin(y * 0.3) * 2) * 12 + rng.next() * 18;
      return [cl(v * 1.05), cl(v * 0.8), cl(v * 0.6)];
    }),
  );

  T.leaves = canvasTexture(
    paint(32, 32, () => {
      const v = 165 + rng.next() * 90;
      return [cl(v), cl(v), cl(v)];
    }),
  );

  // Radial falloff for ground light pools (additive).
  T.pool = canvasTexture(
    paint(64, 64, (x, y) => {
      const dx = (x - 31.5) / 32;
      const dy = (y - 31.5) / 32;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const v = Math.pow(1 - d, 2.2) * 255;
      return [cl(v), cl(v), cl(v)];
    }),
    { repeat: false, smooth: true },
  );

  // Dry October corn stalk (alpha-tested).
  T.corn = canvasTexture(
    paint(32, 64, (x, y) => {
      const cx = 16 + Math.sin(y * 0.15) * 1.5;
      const stalk = Math.abs(x - cx) < 1.5;
      let leaf = false;
      for (let k = 0; k < 6; k++) {
        const ly = 10 + k * 9;
        const dir = k % 2 ? 1 : -1;
        const t = (x - cx) * dir;
        if (t > 0 && t < 14 && Math.abs(y - (ly + t * 0.45 - t * t * 0.04)) < 1.6 - t * 0.06) leaf = true;
      }
      const tassel = y < 7 && Math.abs(x - cx) < 3 && rng.next() < 0.6;
      if (!(stalk || leaf || tassel)) return [0, 0, 0, 0];
      const v = 0.75 + rng.next() * 0.25;
      return [cl(176 * v), cl(150 * v), cl(88 * v), 255];
    }),
  );

  // Chain-link fence (alpha-tested).
  T.chainlink = canvasTexture(
    paint(16, 16, (x, y) => {
      const a = (x + y) % 8 === 0 || (x - y + 64) % 8 === 0;
      return a ? [170, 175, 180, 255] : [0, 0, 0, 0];
    }),
  );

  // Moon disc with a few maria.
  T.moon = canvasTexture(
    paint(64, 64, (x, y) => {
      const dx = (x - 31.5) / 30;
      const dy = (y - 31.5) / 30;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) {
        const glow = Math.max(0, 1 - (d - 1) * 4);
        return [220, 225, 240, cl(glow * 40)];
      }
      let v = 235;
      const maria = [
        [-0.3, -0.2, 0.32],
        [0.25, 0.1, 0.22],
        [0.05, 0.45, 0.18],
        [-0.1, 0.25, 0.12],
      ];
      for (const [mx, my, mr] of maria) {
        if ((dx - mx) ** 2 + (dy - my) ** 2 < mr * mr) v -= 38;
      }
      v -= d * 25;
      return [cl(v), cl(v), cl(v + 6), 255];
    }),
    { repeat: false, smooth: true },
  );

  // Fractal cloud noise, tileable, stored in red.
  {
    const size = 256;
    const octs = [tileNoise(size, 4, rng), tileNoise(size, 8, rng), tileNoise(size, 16, rng), tileNoise(size, 32, rng), tileNoise(size, 64, rng)];
    T.clouds = canvasTexture(
      paint(size, size, (x, y) => {
        let v = 0;
        let amp = 0.5;
        let tot = 0;
        for (const o of octs) {
          v += o(x, y) * amp;
          tot += amp;
          amp *= 0.5;
        }
        v /= tot;
        return [cl(v * 255), cl(v * 255), cl(v * 255)];
      }),
      { srgb: false, smooth: true },
    );
    T.clouds.magFilter = THREE.LinearFilter;
  }

  return T;
}

// Text signs (street signs, store front, water tower band).
export function signTexture(text, { w = 128, h = 32, bg = '#1f5a34', fg = '#f4f4ec', font = 'bold 20px monospace', border = true } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (border) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);
  const t = canvasTexture(c, { repeat: false });
  return t;
}
