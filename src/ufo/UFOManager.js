// Schedules rare sightings and flies the craft. Only one craft is ever up at
// a time, and each type has its own flight plan built from timed segments,
// so the movement is deliberate rather than random wandering:
//
//  saucer   - glides in, hovers and wobbles, darts sideways in a blink,
//             sometimes drops low over a field at night, then shoots away.
//  cigar    - high, slow, straight drift, lazy tilting, sun glints;
//             stops dead for a while, then usually just winks out.
//  triangle - night only. Huge, silent, slow. Cruises over town, stops,
//             rotates in place, carries on (sometimes leaves in a hurry).
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { RNG, clamp, noise1 } from '../core/rng.js';
import { buildSaucer, buildCigar, buildTriangle, buildSphere, buildV, buildDots } from './models.js';
import { ZONES, LANDMARKS } from '../world/layout.js';

export const UFO_TYPES = {
  saucer: { label: 'Flying saucer', value: 150, radius: 7.2 },
  cigar: { label: 'Cigar-shaped craft', value: 130, radius: 11 },
  triangle: { label: 'Black triangle', value: 210, radius: 20 },
  sphere: { label: 'Metallic sphere', value: 320, radius: 2.8 },
  vee: { label: 'V-shaped craft', value: 230, radius: 26 },
  dots: { label: 'Circling lights', value: 70, radius: 30 },
};

// Per-type side effects. audio: which sound it makes; hush: wildlife goes
// quiet nearby; disturb: lamps flicker when it's low overhead.
const FX = {
  saucer: { audio: 'saucer', hush: true, disturb: true },
  cigar: { audio: null, hush: false, disturb: false },
  triangle: { audio: 'triangle', hush: true, disturb: true },
  sphere: { audio: null, hush: true, disturb: true },
  vee: { audio: null, hush: true, disturb: false },
  dots: { audio: null, hush: false, disturb: false },
};

// Relative odds by time of day. Dots are the everyday sighting, the sphere
// is the rare prize (and mostly a daylight thing).
const ODDS = {
  night: { dots: 38, saucer: 22, triangle: 18, vee: 15, sphere: 3 },
  twilight: { dots: 20, cigar: 22, saucer: 22, vee: 24, sphere: 8 },
  day: { cigar: 64, saucer: 22, sphere: 14 },
};

// Places a saucer likes to hang around.
const SITES = [
  { x: (ZONES.corn[0] + ZONES.corn[2]) / 2, z: (ZONES.corn[1] + ZONES.corn[3]) / 2 },
  { x: (ZONES.field[0] + ZONES.field[2]) / 2, z: (ZONES.field[1] + ZONES.field[3]) / 2 },
  { x: LANDMARKS.waterTower.x, z: LANDMARKS.waterTower.z },
  { x: -4, z: -53 },
  { x: 60, z: 175 },
  { x: 52, z: -150 },
];

const E = {
  outCubic: (k) => 1 - (1 - k) ** 3,
  inCubic: (k) => k * k * k,
  inOutSine: (k) => 0.5 - Math.cos(Math.PI * k) / 2,
  outSine: (k) => Math.sin((Math.PI * k) / 2),
  inSine: (k) => 1 - Math.cos((Math.PI * k) / 2),
  inOutQuint: (k) => (k < 0.5 ? 16 * k ** 5 : 1 - (-2 * k + 2) ** 5 / 2),
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

class Craft {
  constructor(mgr, type, model, rng) {
    this.mgr = mgr;
    this.type = type;
    this.model = model;
    this.rng = rng;
    this.group = model.group;
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this.t = 0;
    this.alpha = 1;
    this.done = false;
    this.segs = [];
    this.si = 0;
    this.segT = 0;
    this.cur = null;
    this.group.visible = true;
    this.group.rotation.set(0, 0, 0);
    this.model.body.rotation.set(0, 0, 0);
    this.lightIdx = model.lights.map((L, i) => {
      mgr.world.glows.restyle(mgr.glowPool[i], L.color, L.size);
      return mgr.glowPool[i];
    });
  }

  seg(dur, fn, tag) {
    this.segs.push({ dur, fn, tag });
  }

  // Hold near a point with a slow bob and drift.
  hover(p, dur, tag = 'hover', bob = 1, drift = 3) {
    const seed = this.rng.next() * 100;
    this.seg(
      dur,
      (k, t) => {
        this.pos.set(p.x + noise1(t * 0.12, seed) * drift, p.y + Math.sin(t * 1.4) * bob + noise1(t * 0.2, seed + 1) * bob * 0.5, p.z + noise1(t * 0.12, seed + 2) * drift);
      },
      tag,
    );
  }

  update(dt, ctx) {
    this._prev.copy(this.pos);
    this.t += dt;
    let s = this.segs[this.si];
    this.segT += dt;
    while (s && this.segT >= s.dur) {
      s.fn(1, this.t);
      this.segT -= s.dur;
      this.si += 1;
      s = this.segs[this.si];
    }
    if (!s) {
      this.done = true;
      return;
    }
    this.cur = s.tag;
    s.fn(this.segT / s.dur, this.t);
    if (dt > 0) this.vel.subVectors(this.pos, this._prev).divideScalar(dt);
    this.animate(dt, ctx);
    // Polished metal mirrors the sky; matte black doesn't.
    if (this.skyReflect) {
      const pal = this.mgr.world.sky.pal;
      const k = this.skyReflect * (0.15 + 0.85 * this.mgr.world.sky.daylight);
      this.model.materials[0].emissive.copy(pal.hor).lerp(pal.top, 0.4).multiplyScalar(k).addScalar(0.006);
    }
    this.group.updateMatrixWorld(true);
    this.syncLights(ctx);
  }

  animate() {}

  lightLevel() {
    return 1;
  }

  syncLights(ctx) {
    const g = this.mgr.world.glows;
    this.model.lights.forEach((L, i) => {
      const idx = this.lightIdx[i];
      L.obj.getWorldPosition(_v);
      g.move(idx, _v);
      g.set(idx, this.lightLevel(L, i, ctx) * this.alpha);
    });
  }

  dispose() {
    this.group.visible = false;
    for (const idx of this.lightIdx) this.mgr.world.glows.set(idx, 0);
  }
}

class Saucer extends Craft {
  constructor(mgr, model, rng, { night, near }) {
    super(mgr, 'saucer', model, rng);
    this.skyReflect = 0.35;
    this.night = night;
    const player = mgr.player.pos;
    const sites = SITES.filter((s) => Math.hypot(s.x - player.x, s.z - player.z) < 380);
    const site = near ? { x: player.x + rng.float(-90, 90), z: player.z - 110 } : rng.pick(sites.length ? sites : SITES);
    const hover0 = V(site.x + rng.float(-40, 40), rng.float(45, 80), site.z + rng.float(-40, 40));
    const a = rng.float(0, Math.PI * 2);
    const start = V(hover0.x + Math.cos(a) * 750, 280, hover0.z + Math.sin(a) * 750);
    this.pos.copy(start);
    this.seg(rng.float(9, 12), (k) => this.pos.lerpVectors(start, hover0, E.outCubic(k)), 'arrive');
    let cur = hover0;
    this.hover(cur, rng.float(12, 22));
    const darts = rng.int(1, 3);
    for (let i = 0; i < darts; i++) {
      const ang = rng.float(0, Math.PI * 2);
      const len = rng.float(40, 100);
      const next = V(cur.x + Math.cos(ang) * len, clamp(cur.y + rng.float(-15, 15), 28, 110), cur.z + Math.sin(ang) * len);
      const from = cur.clone();
      this.seg(rng.float(0.45, 0.7), (k) => this.pos.lerpVectors(from, next, E.inOutQuint(k)), 'dart');
      this.hover(next, rng.float(7, 16));
      cur = next;
    }
    if (night && rng.chance(0.45)) {
      const low = V(cur.x, rng.float(16, 24), cur.z);
      const from = cur.clone();
      this.seg(6, (k) => this.pos.lerpVectors(from, low, E.inOutSine(k)), 'descend');
      this.hover(low, rng.float(8, 14), 'low', 0.4, 1.2);
      const up = V(low.x, from.y + 15, low.z);
      this.seg(3, (k) => this.pos.lerpVectors(low, up, E.inOutSine(k)), 'rise');
      cur = up;
    }
    const dir = V(Math.cos(rng.float(0, 6.28)), rng.float(0.35, 0.9), Math.sin(rng.float(0, 6.28))).normalize();
    const last = cur.clone();
    this.seg(3.5, (k) => this.pos.copy(last).addScaledVector(dir, 1500 * E.inCubic(k)), 'depart');
  }

  animate(dt) {
    // Spin, wobble, and bank into the direction of travel.
    this.model.body.rotation.y += dt * 0.35;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    const bank = clamp(hv * 0.004, 0, 0.32);
    const bx = hv > 0.01 ? this.vel.z / hv : 0;
    const bz = hv > 0.01 ? -this.vel.x / hv : 0;
    const g = this.group.rotation;
    const wob = this.cur === 'dart' ? 0 : 1;
    g.x += (bx * bank + Math.sin(this.t * 1.7) * 0.05 * wob - g.x) * Math.min(1, dt * 6);
    g.z += (bz * bank + Math.cos(this.t * 1.3) * 0.045 * wob - g.z) * Math.min(1, dt * 6);
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    if (L.role === 'under') return (this.cur === 'low' || this.cur === 'descend' ? 1.6 : 0.5) * (0.15 + n * 0.85);
    const chase = Math.sin(this.t * 5 - i * (Math.PI / 4)) > 0.55 ? 1.4 : 0.35;
    return chase * (0.15 + n * 0.9);
  }
}

class Cigar extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'cigar', model, rng);
    this.skyReflect = 0.6;
    const player = mgr.player.pos;
    const r = near ? 120 : rng.float(80, 230);
    const a0 = rng.float(0, Math.PI * 2);
    const p0 = V(player.x + Math.cos(a0) * r, rng.float(160, 240), player.z + Math.sin(a0) * r);
    this.heading = rng.float(0, Math.PI * 2);
    const speed = rng.float(4, 8);
    const dirOf = (h) => V(Math.cos(h), 0, Math.sin(h));
    const d = dirOf(this.heading);
    this.alpha = 0;
    this.pos.copy(p0);
    const fadeIn = rng.float(2, 3);
    this.seg(fadeIn, (k, t) => {
      this.alpha = k;
      this.pos.copy(p0).addScaledVector(d, speed * k * fadeIn);
    });
    let cur = p0.clone().addScaledVector(d, speed * fadeIn);
    const c1 = cur.clone();
    const dur1 = rng.float(28, 45);
    this.seg(dur1, (k) => this.pos.copy(c1).addScaledVector(d, speed * dur1 * k), 'cruise');
    cur = c1.clone().addScaledVector(d, speed * dur1);
    const hang = cur.clone();
    this.seg(rng.float(10, 18), () => this.pos.copy(hang), 'hang');
    const h2 = this.heading + rng.float(-0.7, 0.7);
    const d2 = dirOf(h2);
    const dur2 = rng.float(22, 38);
    this.seg(
      dur2,
      (k) => {
        this.heading = h2;
        this.pos.copy(hang).addScaledVector(d2, speed * dur2 * k);
      },
      'cruise',
    );
    const end = hang.clone().addScaledVector(d2, speed * dur2);
    if (rng.chance(0.6)) {
      this.seg(1.3, (k) => {
        this.alpha = 1 - k;
        this.pos.copy(end).addScaledVector(d2, speed * 1.3 * k);
      }, 'vanish');
    } else {
      this.seg(7, (k) => {
        this.pos.copy(end).addScaledVector(d2, 400 * E.inCubic(k)).add(_w.set(0, 260 * E.inCubic(k), 0));
        this.alpha = clamp(1 - (this.pos.y - 300) / 80, 0, 1);
      }, 'climb');
    }
  }

  animate() {
    const g = this.group.rotation;
    g.y = -this.heading + noise1(this.t * 0.05, 3) * 0.5;
    g.z = noise1(this.t * 0.04, 7) * 0.42;
    for (const m of this.model.materials) m.opacity = this.alpha;
    this.model.group.visible = this.alpha > 0.01;
  }

  lightLevel(L) {
    // Sun glint when the tube's axis is square to the sun-to-viewer half vector.
    const sky = this.mgr.world.sky;
    if (sky.sunDir.y < -0.03) return 0;
    _v.set(1, 0, 0).applyQuaternion(this.model.body.getWorldQuaternion(new THREE.Quaternion()));
    _w.subVectors(this.mgr.camera.position, this.pos).normalize().add(sky.sunDir).normalize();
    const g = Math.pow(clamp(1 - Math.abs(_v.dot(_w)), 0, 1), 40);
    return L.role === 'glint' ? g * 2.2 : 0.35 + g * 1.5;
  }
}

class Triangle extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'triangle', model, rng);
    const player = mgr.player.pos;
    const off = near ? 40 : rng.float(40, 150);
    const oa = rng.float(0, Math.PI * 2);
    const P = V(player.x + Math.cos(oa) * off, rng.float(75, 125), player.z + Math.sin(oa) * off);
    let h = rng.float(0, Math.PI * 2);
    const dir = V(Math.cos(h), 0, Math.sin(h));
    const hoverPt = P.clone().addScaledVector(dir, rng.float(-40, 40));
    const approach = near ? 260 : 480;
    const start = hoverPt.clone().addScaledVector(dir, -approach);
    const speed = rng.float(9, 12);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pos.copy(start);
    this.seg(approach / speed, (k) => this.pos.lerpVectors(start, hoverPt, E.outSine(k)), 'cruise');
    const rot = rng.sign() * rng.float(0.6, 1.6);
    const yaw0 = this.yaw;
    const hoverDur = rng.float(14, 24);
    this.hover(hoverPt, hoverDur, 'hover', 0.4, 1.2);
    const hs = this.segs[this.segs.length - 1];
    const baseFn = hs.fn;
    hs.fn = (k, t) => {
      baseFn(k, t);
      this.yaw = yaw0 + rot * E.inOutSine(k);
    };
    h += rot * 0.7;
    const d2 = V(Math.cos(h), 0, Math.sin(h));
    const end = hoverPt.clone().addScaledVector(d2, 650);
    const yawEnd = Math.atan2(-d2.x, -d2.z);
    const yawStart = yaw0 + rot;
    const fast = rng.chance(0.3);
    this.seg(fast ? 7 : 650 / speed, (k) => {
      this.pos.lerpVectors(hoverPt, end, fast ? E.inCubic(k) : E.inSine(k));
      this.yaw = yawStart + (yawEnd - yawStart) * Math.min(1, k * 4);
    }, 'cruise');
  }

  animate() {
    this.group.rotation.set(0, this.yaw, 0);
  }

  lightLevel(L) {
    const n = this.mgr.world.sky.night;
    if (L.role === 'center') return (0.3 + 0.9 * Math.max(0, Math.sin(this.t * 2.4)) ** 2) * (0.3 + n);
    if (L.role === 'halo') return 0.18 * (0.2 + n);
    return 1.2 * (0.3 + n * 0.8);
  }
}

class Sphere extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'sphere', model, rng);
    const player = mgr.player.pos;
    const a = rng.float(0, Math.PI * 2);
    const r = near ? 55 : rng.float(70, 160);
    const p0 = V(player.x + Math.cos(a) * r, rng.float(35, 70), player.z + Math.sin(a) * r);
    // Drops straight down out of the sky and stops dead.
    const start = p0.clone().add(V(0, 320, 0));
    this.pos.copy(start);
    this.seg(rng.float(5, 7), (k) => this.pos.lerpVectors(start, p0, E.outCubic(k)), 'arrive');
    let cur = p0;
    // Eerily still: no bob, barely any drift.
    this.hover(cur, rng.float(15, 25), 'hover', 0.05, 0.3);
    const arcs = rng.chance(0.5) ? 2 : 1;
    for (let i = 0; i < arcs; i++) {
      const ang = rng.float(0, Math.PI * 2);
      const next = V(cur.x + Math.cos(ang) * rng.float(60, 120), clamp(cur.y + rng.float(-15, 20), 25, 90), cur.z + Math.sin(ang) * rng.float(60, 120));
      const ctrl = cur.clone().lerp(next, 0.5).add(V(rng.float(-40, 40), rng.float(10, 30), rng.float(-40, 40)));
      const from = cur.clone();
      // Smooth curved glide along a quadratic bezier.
      this.seg(rng.float(8, 12), (k) => {
        const t = E.inOutSine(k);
        const u = 1 - t;
        this.pos.set(u * u * from.x + 2 * u * t * ctrl.x + t * t * next.x, u * u * from.y + 2 * u * t * ctrl.y + t * t * next.y, u * u * from.z + 2 * u * t * ctrl.z + t * t * next.z);
      }, 'glide');
      this.hover(next, rng.float(10, 18), 'hover', 0.05, 0.3);
      cur = next;
    }
    // Leaves straight up, fast.
    const last = cur.clone();
    const drift = V(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize().multiplyScalar(60);
    this.seg(4, (k) => {
      const e = Math.pow(k, 2.5);
      this.pos.set(last.x + drift.x * e, last.y + 1400 * e, last.z + drift.z * e);
      this.alpha = clamp(1 - (this.pos.y - 500) / 300, 0, 1);
    }, 'climb');
    this.envT = 0;
  }

  animate(dt) {
    this.model.body.rotation.y += dt * 0.5;
    this.model.body.rotation.x = Math.sin(this.t * 0.3) * 0.25;
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 1.5;
      this.mgr.captureEnv(this);
    }
    for (const m of this.model.materials) {
      m.transparent = this.alpha < 1;
      m.opacity = this.alpha;
    }
    this.model.group.visible = this.alpha > 0.01;
  }

  lightLevel(L) {
    const sky = this.mgr.world.sky;
    if (L.role === 'aura') return 0.12 * sky.night;
    // Specular point where the sun would reflect toward the viewer.
    if (sky.sunDir.y < -0.03) return 0;
    _w.subVectors(this.mgr.camera.position, this.pos).normalize().add(sky.sunDir).normalize();
    L.obj.position.copy(_w).multiplyScalar(2.65);
    L.obj.parent.worldToLocal(L.obj.position.add(this.pos));
    return 1.6 * sky.daylight;
  }
}

class Vee extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'vee', model, rng);
    const player = mgr.player.pos;
    const h = rng.float(0, Math.PI * 2);
    const dir = V(Math.cos(h), 0, Math.sin(h));
    const side = V(-dir.z, 0, dir.x);
    const P = V(player.x, rng.float(110, 170), player.z).addScaledVector(side, (near ? 30 : rng.float(50, 200)) * rng.sign());
    const reach = near ? 380 : 700;
    const start = P.clone().addScaledVector(dir, -reach);
    const end = P.clone().addScaledVector(dir, reach);
    const speed = rng.float(13, 17);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pos.copy(start);
    // Constant speed, dead straight, silent.
    this.offAt = rng.float(0.6, 0.85);
    this.lightsOn = [1, 1, 1, 1, 1];
    this.seg((reach * 2) / speed, (k) => {
      this.pos.lerpVectors(start, end, k);
      // Lights go out one at a time, then it's simply gone.
      for (let i = 0; i < 5; i++) this.lightsOn[i] = k > this.offAt + i * 0.025 ? 0 : 1;
      this.alpha = clamp(1 - (k - (this.offAt + 0.14)) * 20, 0, 1);
      if (this.alpha <= 0) this.done = true;
    }, 'cruise');
  }

  animate() {
    this.group.rotation.set(0, this.yaw, 0);
    this.model.group.visible = this.alpha > 0.01;
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    const on = this.lightsOn[i % 5];
    return on * (L.role === 'halo' ? 0.16 : 1.15) * (0.25 + n * 0.85);
  }
}

class Dots extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'dots', model, rng);
    const player = mgr.player.pos;
    const a = rng.float(0, Math.PI * 2);
    const r = near ? 90 : rng.float(80, 260);
    const c0 = V(player.x + Math.cos(a) * r, rng.float(200, 300), player.z + Math.sin(a) * r);
    this.count = rng.int(3, model.lights.length);
    this.orbits = [];
    for (let i = 0; i < model.lights.length; i++) {
      this.orbits.push({ r: rng.float(10, 34), w: rng.float(0.25, 0.65) * rng.sign(), ph: rng.float(0, 6.28), y: rng.float(-6, 6), flip: rng.float(6, 20), dir: 1, zip: 0 });
    }
    const drift = V(rng.float(-2.5, 2.5), 0, rng.float(-2.5, 2.5));
    this.alpha = 0;
    this.scatter = 0;
    const dur = rng.float(55, 95);
    this.pos.copy(c0);
    this.seg(3, (k, t) => {
      this.alpha = k;
      this.pos.copy(c0).addScaledVector(drift, t);
    }, 'appear');
    this.seg(dur, (k, t) => this.pos.copy(c0).addScaledVector(drift, t), 'dance');
    const scatter = rng.chance(0.55);
    this.seg(scatter ? 4 : 2.5, (k, t) => {
      this.pos.copy(c0).addScaledVector(drift, t);
      if (scatter) this.scatter = E.inCubic(k);
      this.alpha = scatter ? 1 - E.inCubic(k) : 1 - k;
    }, scatter ? 'scatter' : 'fade');
    this.scatterDirs = this.orbits.map(() => V(rng.float(-1, 1), rng.float(-0.2, 1), rng.float(-1, 1)).normalize());
  }

  animate(dt) {
    const L = this.model.lights;
    for (let i = 0; i < L.length; i++) {
      const o = this.orbits[i];
      // Every so often a light reverses, and now and then one darts out.
      o.flip -= dt;
      if (o.flip <= 0) {
        o.flip = this.rng.float(6, 20);
        if (this.rng.chance(0.6)) o.dir = -o.dir;
        else o.zip = 1;
      }
      o.zip = Math.max(0, o.zip - dt * 0.6);
      o.ph += o.w * o.dir * dt * (1 + o.zip * 4);
      const rr = o.r * (1 + Math.sin(o.zip * Math.PI) * 1.6);
      const p = L[i].obj.position;
      p.set(Math.cos(o.ph) * rr, o.y + Math.sin(this.t * 0.7 + i) * 3, Math.sin(o.ph) * rr);
      if (this.scatter > 0) p.addScaledVector(this.scatterDirs[i], this.scatter * 600);
    }
  }

  lightLevel(L, i) {
    if (i >= this.count) return 0;
    const n = this.mgr.world.sky.night;
    const twinkle = 0.85 + 0.15 * Math.sin(this.t * 9 + i * 2.1);
    return twinkle * (0.12 + n * 1.1);
  }
}

export class UFOManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.player = game.player;
    this.camera = game.camera;
    this.current = null;
    this.lastAbs = null;
    this.models = { saucer: buildSaucer(), cigar: buildCigar(), triangle: buildTriangle(), sphere: buildSphere(), vee: buildV(), dots: buildDots(5) };
    // Live reflections for the chrome sphere.
    this.cubeRT = new THREE.WebGLCubeRenderTarget(96);
    this.cubeCam = new THREE.CubeCamera(1, 1500, this.cubeRT);
    this.models.sphere.materials[0].envMap = this.cubeRT.texture;
    for (const m of Object.values(this.models)) {
      m.group.visible = false;
      game.scene.add(m.group);
    }
    const g = this.world.glows;
    this.glowPool = [];
    for (let i = 0; i < 16; i++) this.glowPool.push(g.add(V(0, -500, 0), '#ffffff', 1));

    // Register each type as a photo subject. They only count while flying.
    for (const [type, info] of Object.entries(UFO_TYPES)) {
      const mgr = this;
      this.world.subjects.push({
        id: `ufo-${type}`,
        kind: type,
        label: info.label,
        category: 'anomaly',
        value: info.value,
        radius: info.radius,
        get sightingId() {
          return mgr.current?.sightingId || null;
        },
        get selfLuminous() {
          return mgr.world.sky.night > 0.5;
        },
        getPos: (cam, out) => out.copy(mgr.current.pos),
        getVel: () => mgr.current.vel,
        isActive: () => mgr.current?.type === type && mgr.current.alpha > 0.35,
      });
    }
  }

  get state() {
    return this.game.state;
  }

  _pickType(hour, rng) {
    const night = hour >= 20.6 || hour < 5;
    const twilight = !night && (hour >= 18 || hour < 7);
    const odds = ODDS[night ? 'night' : twilight ? 'twilight' : 'day'];
    const total = Object.values(odds).reduce((a, b) => a + b, 0);
    let r = rng.float(0, total);
    for (const [type, w] of Object.entries(odds)) {
      r -= w;
      if (r <= 0) return type;
    }
    return 'saucer';
  }

  // Re-render the sphere's surroundings into its reflection cube map.
  captureEnv(craft) {
    const g = craft.model.group;
    const vis = g.visible;
    g.visible = false;
    this.cubeCam.position.copy(craft.pos);
    this.cubeCam.update(this.game.renderer, this.game.scene);
    g.visible = vis;
  }

  _schedule(abs, min, max) {
    this.state.ufo.next = abs + min + Math.random() * (max - min);
  }

  _ensureState() {
    const S = this.state;
    if (S.ufo) return;
    const abs = S.day * 24 + S.hour;
    // First night always gets a saucer, a few minutes after dark.
    S.ufo = { next: S.day === 0 && S.hour < 20 ? 20.6 + Math.random() * 1.2 : abs + 1 + Math.random() * 2, n: 0 };
  }

  spawn(type, near = false) {
    this._ensureState();
    const S = this.state;
    if (this.current) this.current.dispose();
    const rng = new RNG(Math.floor(Math.random() * 1e9));
    const night = this.world.sky.night > 0.5;
    const model = this.models[type];
    const C = { saucer: Saucer, cigar: Cigar, triangle: Triangle, sphere: Sphere, vee: Vee, dots: Dots }[type];
    this.current = new C(this, model, rng, { night, near });
    S.ufo.n += 1;
    this.current.sightingId = `${type}-d${S.day}-${S.ufo.n}`;
    this.cueTimer = rng.float(2, 5);
  }

  _cue() {
    const c = this.current;
    const night = this.world.sky.night > 0.5;
    let msg;
    if (c.type === 'saucer') {
      msg = night ? 'Every dog on the block starts barking at once.' : 'The birds go quiet. Your ears pop.';
      if (night) bus.emit('sfx', 'dogs');
    } else if (c.type === 'cigar') msg = 'Something high up catches the sun.';
    else if (c.type === 'triangle') msg = 'A low hum, more felt than heard. The crickets have stopped.';
    else if (c.type === 'sphere') msg = night ? 'The crickets stop. All of them, at once.' : 'Something is hanging perfectly still in the sky.';
    else if (c.type === 'vee') msg = 'A row of lights is moving across the sky. Not a sound.';
    else {
      // Dots are easy to mistake for stars; only sometimes does anyone notice.
      if (Math.random() < 0.5) return;
      msg = 'A few of the stars seem to be... moving?';
    }
    bus.emit('toast', msg);
  }

  // Called every frame while playing.
  update(dt) {
    const S = this.state;
    const abs = S.day * 24 + S.hour;
    this._ensureState();
    // Time jumped (sleep): drop whatever was up and reschedule soon.
    if (this.lastAbs !== null && abs - this.lastAbs > 0.5) {
      if (this.current) this.end();
      if (abs > S.ufo.next) this._schedule(abs, 0.4, 2.5);
    }
    this.lastAbs = abs;

    if (this.current) {
      const c = this.current;
      c.update(dt, this);
      if (this.cueTimer > 0) {
        this.cueTimer -= dt;
        if (this.cueTimer <= 0) this._cue();
      }
      this._effects(c);
      if (c.done) this.end();
      return;
    }
    if (abs >= S.ufo.next) {
      if (abs - S.ufo.next > 1) {
        this._schedule(abs, 0.5, 3);
        return;
      }
      const day = S.hour >= 8 && S.hour < 17;
      if (day && Math.random() < 0.5) {
        // Daylight sightings are rarer.
        this._schedule(abs, 1.5, 3);
        return;
      }
      this.spawn(this._pickType(S.hour, new RNG(Math.floor(Math.random() * 1e9))));
    }
  }

  end() {
    this.current.dispose();
    this.current = null;
    this.world.disturb = null;
    bus.emit('ufoAudio', { kind: null, level: 0 });
    this._schedule(this.state.day * 24 + this.state.hour, 3.5, 8);
  }

  // Lamps flicker under it; saucers warble, triangles hum.
  _effects(c) {
    const d = c.pos.distanceTo(this.camera.position);
    const fx = FX[c.type];
    this.world.disturb = fx.disturb && c.pos.y < 140 ? { x: c.pos.x, z: c.pos.z, r: 70 } : null;
    const near = clamp(1 - d / (c.type === 'triangle' ? 420 : 320), 0, 1) * c.alpha;
    bus.emit('ufoAudio', { kind: fx.audio, level: fx.audio ? near : 0, hush: fx.hush && near > 0.05 });
  }
}
