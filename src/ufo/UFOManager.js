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
//
// The full roster (and rarity tiers) is in UFO_TYPES below; each type's
// behavior is described on its class.
import * as THREE from 'three';
import { bus } from '../core/events.js';
import { RNG, clamp, noise1 } from '../core/rng.js';
import { buildSaucer, buildCigar, buildTriangle, buildSphere, buildV, buildDots, build1947, buildPhoenix, PHOENIX_LIGHTS, buildOrbs, buildStar, buildTicTac, buildRing, buildCloudship, buildBeamCraft } from './models.js';
import { hash } from '../core/rng.js';
import { LURES } from '../game/lures.js';
import { ZONES, LANDMARKS } from '../world/layout.js';

export const UFO_TYPES = {
  // common
  dots: { label: 'Circling lights', value: 70, radius: 30, tier: 'common' },
  orbs: { label: 'Orange orbs', value: 55, radius: 25, tier: 'common' },
  star: { label: 'Moving star', value: 45, radius: 10, tier: 'common' },
  // uncommon
  saucer: { label: 'Flying saucer', value: 150, radius: 7.2, tier: 'uncommon' },
  cigar: { label: 'Cigar-shaped craft', value: 130, radius: 11, tier: 'uncommon' },
  triangle: { label: 'Black triangle', value: 210, radius: 20, tier: 'uncommon' },
  vee: { label: 'V-shaped craft', value: 230, radius: 26, tier: 'uncommon' },
  // rare
  sphere: { label: 'Metallic sphere', value: 320, radius: 2.8, tier: 'rare' },
  tictac: { label: 'Tic Tac', value: 380, radius: 7, tier: 'rare' },
  ring: { label: 'Ring of lights', value: 420, radius: 14, tier: 'rare' },
  // epic
  cloudship: { label: 'The Cloud Ship', value: 950, radius: 90, tier: 'epic' },
  beam: { label: 'The Harvester', value: 850, radius: 12, tier: 'epic' },
  // legends: almost never seen without a lure
  k1947: { label: "The '47 Visitor", value: 1200, radius: 12, legend: true, tier: 'legend' },
  phoenix: { label: 'The Phoenix Lights', value: 1500, radius: 150, legend: true, tier: 'legend' },
};

// Chance that a scheduled sighting turns out to be a legend instead.
const LEGEND_CHANCE = 0.015;
const LURE_SUCCESS = 0.6;

// Per-type side effects. audio: which sound it makes; hush: wildlife goes
// quiet nearby; disturb: lamps flicker when it's low overhead.
const FX = {
  saucer: { audio: 'saucer', hush: true, disturb: true },
  cigar: { audio: null, hush: false, disturb: false },
  triangle: { audio: 'triangle', hush: true, disturb: true },
  sphere: { audio: null, hush: true, disturb: true },
  vee: { audio: null, hush: true, disturb: false },
  dots: { audio: null, hush: false, disturb: false },
  k1947: { audio: null, hush: true, disturb: false },
  phoenix: { audio: null, hush: true, disturb: false },
  orbs: { audio: null, hush: false, disturb: false },
  star: { audio: null, hush: false, disturb: false },
  tictac: { audio: null, hush: true, disturb: false },
  ring: { audio: 'triangle', hush: true, disturb: true },
  cloudship: { audio: 'triangle', hush: true, disturb: false },
  beam: { audio: 'saucer', hush: true, disturb: true },
};

// Relative odds by time of day. Dots are the everyday sighting, the sphere
// is the rare prize (and mostly a daylight thing).
const ODDS = {
  night: { dots: 24, orbs: 21, star: 17, saucer: 12, triangle: 9, vee: 8, ring: 3, sphere: 0.8, cloudship: 0.7, beam: 0.9 },
  twilight: { orbs: 15, dots: 11, star: 6, cigar: 16, saucer: 15, vee: 13, sphere: 5, tictac: 4, ring: 1.5, cloudship: 1.2 },
  day: { cigar: 50, saucer: 18, tictac: 10, sphere: 10, cloudship: 1.2 },
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
    return twinkle * (0.2 + n * 1.7);
  }
}

// LEGEND (day): streaks in, flies fast wide circles while fluttering and
// dipping "like a saucer skipped across water", flashes in the sun, then
// leaves in a straight line at absurd speed.
class K1947 extends Craft {
  constructor(mgr, model, rng, { at }) {
    super(mgr, 'k1947', model, rng);
    const p = at || mgr.player.pos;
    const C = V(p.x + rng.float(-30, 30), rng.float(95, 140), p.z + rng.float(-30, 30));
    const R = rng.float(85, 130);
    const speed = rng.float(42, 55);
    const w = (speed / R) * rng.sign();
    this.turn = Math.sign(w);
    const a0 = rng.float(0, Math.PI * 2);
    const onCircle = (a) => V(C.x + Math.cos(a) * R, C.y, C.z + Math.sin(a) * R);
    const entry = onCircle(a0);
    const inDir = V(-Math.sin(a0) * Math.sign(w), 0, Math.cos(a0) * Math.sign(w)); // tangent
    const start = entry.clone().addScaledVector(inDir, -1100).add(V(0, 260, 0));
    this.pos.copy(start);
    this.seg(4, (k) => this.pos.lerpVectors(start, entry, E.outCubic(k)), 'arrive');
    const loops = rng.float(2, 3.2);
    const dur = (loops * Math.PI * 2) / Math.abs(w);
    let endA = a0;
    this.seg(dur, (k, t) => {
      const a = a0 + w * dur * k;
      endA = a;
      this.pos.copy(onCircle(a));
      this.pos.y += Math.sin(t * 2.3) * 4 + Math.sin(t * 5.1) * 1.5; // skipping
    }, 'circle');
    this.seg(3.5, (k) => {
      if (k === 0 || !this.exitFrom) {
        this.exitFrom = this.pos.clone();
        this.exitDir = V(-Math.sin(endA) * Math.sign(w), 0.12, Math.cos(endA) * Math.sign(w)).normalize();
      }
      this.pos.copy(this.exitFrom).addScaledVector(this.exitDir, speed * k * 3.5 + 2200 * k * k * k);
    }, 'depart');
  }

  animate() {
    const v = this.vel;
    if (v.lengthSq() > 1) this.yaw = Math.atan2(v.z, -v.x);
    const g = this.group.rotation;
    g.y = this.yaw || 0;
    const banking = this.cur === 'circle' ? 0.55 : 0.1;
    g.x = -banking * this.turn + Math.sin(this.t * 9) * 0.12; // bank into the turn + flutter
    g.z = Math.sin(this.t * 7.3) * 0.08;
    const m = this.model.materials[0];
    m.opacity = this.alpha;
  }

  lightLevel() {
    // Flashes like a mirror as it rocks in the sun.
    const sky = this.mgr.world.sky;
    if (sky.sunDir.y < 0) return 0;
    return Math.pow(Math.max(0, Math.sin(this.t * 3.1)), 18) * 2.4 * sky.daylight;
  }
}

// LEGEND (night): a gigantic silent V drifts almost straight overhead, then
// moves off toward the horizon where its lights settle into a hanging row
// and go out one by one.
class Phoenix extends Craft {
  constructor(mgr, model, rng, { at }) {
    super(mgr, 'phoenix', model, rng);
    const p = at || mgr.player.pos;
    const h = rng.float(0, Math.PI * 2);
    const dir = V(Math.cos(h), 0, Math.sin(h));
    const side = V(-dir.z, 0, dir.x);
    const over = V(p.x, rng.float(220, 270), p.z).addScaledVector(side, rng.float(-50, 50));
    const start = over.clone().addScaledVector(dir, -560);
    const passEnd = over.clone().addScaledVector(dir, 240);
    const hang = V(p.x, rng.float(150, 195), p.z).addScaledVector(dir, 480).addScaledVector(side, rng.float(-80, 80));
    const yawPass = Math.atan2(-dir.x, -dir.z);
    const toViewer = V(p.x - hang.x, 0, p.z - hang.z).normalize();
    const yawHang = Math.atan2(-toViewer.x, -toViewer.z);
    this.yaw = yawPass;
    this.morph = 0;
    this.hullAlpha = 1;
    this.lit = new Array(PHOENIX_LIGHTS).fill(1);
    this.pos.copy(start);
    this.seg(800 / 9, (k) => this.pos.lerpVectors(start, passEnd, E.outSine(k)), 'pass');
    this.seg(16, (k) => {
      const e = E.inOutSine(k);
      this.pos.lerpVectors(passEnd, hang, e);
      this.morph = e;
      this.hullAlpha = 1 - Math.min(1, k * 2);
      let d = yawHang - yawPass;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw = yawPass + d * e;
    }, 'settle');
    this.hover(hang, rng.float(40, 60), 'hang', 0.3, 0.6);
    this.seg(10, (k) => {
      // Out one at a time, left to right.
      model.order.forEach((vi, slot) => (this.lit[vi] = clamp(1 - (k * 8 - slot), 0, 1)));
    }, 'fade');
  }

  animate() {
    const m = this.model;
    this.group.rotation.set(0, this.yaw, 0);
    m.hull.visible = this.hullAlpha > 0.02;
    m.materials[0].opacity = this.hullAlpha;
    for (let i = 0; i < PHOENIX_LIGHTS; i++) {
      const p = m.lights[i].obj.position.lerpVectors(m.vPos[i], m.rowPos[i], this.morph);
      m.lights[i + PHOENIX_LIGHTS].obj.position.set(p.x, p.y - 1, p.z);
    }
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    const k = i % PHOENIX_LIGHTS;
    const flick = 0.92 + 0.08 * Math.sin(this.t * 5 + k * 1.3);
    return this.lit[k] * flick * (L.role === 'halo' ? 0.2 : 1.5) * (0.3 + n * 0.8);
  }
}

// COMMON: a few orange orbs rise from behind the trees and drift downwind
// together in a loose line, flickering like fire, then burn out one by one.
class Orbs extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'orbs', model, rng);
    const p = mgr.player.pos;
    const a = rng.float(0, Math.PI * 2);
    const r = near ? 160 : rng.float(220, 420);
    const base = V(p.x + Math.cos(a) * r, 18, p.z + Math.sin(a) * r);
    const wind = V(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize();
    const speed = rng.float(2.5, 4.5);
    this.n = rng.int(2, model.lights.length / 2);
    this.orbs = [];
    for (let i = 0; i < this.n; i++) {
      this.orbs.push({
        off: wind.clone().multiplyScalar(-i * rng.float(8, 16)).add(V(rng.float(-5, 5), rng.float(-4, 4), rng.float(-5, 5))),
        delay: i * rng.float(2, 5),
        burnout: rng.float(50, 75) + i * rng.float(2, 6),
        seed: rng.next() * 100,
      });
    }
    const dur = Math.max(...this.orbs.map((o) => o.burnout)) + 3;
    this.pos.copy(base);
    this.seg(dur, (k, t) => {
      this.pos.copy(base).addScaledVector(wind, speed * t);
      this.pos.y = 18 + Math.min(t, 75) * 1.6;
    }, 'drift');
  }

  animate() {
    const L = this.model.lights;
    const half = L.length / 2;
    this.vis = [];
    for (let i = 0; i < half; i++) {
      const o = this.orbs[i];
      if (!o) {
        this.vis.push(0);
        continue;
      }
      const lt = this.t - o.delay;
      const rise = Math.min(0, lt) * 1.6;
      L[i].obj.position.set(o.off.x + noise1(this.t * 0.3, o.seed) * 3, o.off.y + rise + noise1(this.t * 0.5, o.seed + 1) * 1.5, o.off.z + noise1(this.t * 0.3, o.seed + 2) * 3);
      L[i + half].obj.position.copy(L[i].obj.position);
      this.vis.push(clamp(lt / 3, 0, 1) * clamp(1 - (this.t - o.burnout) / 2.5, 0, 1));
    }
  }

  lightLevel(L, i) {
    const half = this.model.lights.length / 2;
    const k = i % half;
    const n = this.mgr.world.sky.night;
    const flick = 0.75 + 0.25 * noise1(this.t * 7 + k * 13, 4) + 0.1 * Math.sin(this.t * 23 + k);
    return (this.vis?.[k] || 0) * flick * (L.role === 'halo' ? 0.3 : 1.8) * (0.45 + n * 0.8);
  }
}

// COMMON: looks like a star crossing the sky... until it stops dead, turns
// sharply, and accelerates away.
class Star extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'star', model, rng);
    const p = mgr.player.pos;
    const a = rng.float(0, Math.PI * 2);
    const alt = rng.float(380, 600);
    const start = V(p.x + Math.cos(a) * 900, alt, p.z + Math.sin(a) * 900);
    const dir = V(-Math.cos(a + rng.float(-0.4, 0.4)), 0, -Math.sin(a + rng.float(-0.4, 0.4))).normalize();
    const speed = rng.float(55, 75);
    const cruise = near ? 12 : rng.float(13, 20);
    this.alpha = 0;
    this.pos.copy(start);
    this.seg(cruise, (k, t) => {
      this.alpha = Math.min(1, t / 1.5);
      this.pos.copy(start).addScaledVector(dir, speed * cruise * k);
    }, 'cruise');
    const stopAt = start.clone().addScaledVector(dir, speed * cruise);
    const brake = stopAt.clone().addScaledVector(dir, speed * 0.12);
    this.seg(0.25, (k) => this.pos.lerpVectors(stopAt, brake, E.outCubic(k)), 'stop');
    this.seg(rng.float(3, 6), () => this.pos.copy(brake), 'hold');
    const turn = rng.sign() * rng.float(1.2, 1.9);
    const nd = V(dir.x * Math.cos(turn) - dir.z * Math.sin(turn), rng.float(0, 0.25), dir.x * Math.sin(turn) + dir.z * Math.cos(turn)).normalize();
    this.seg(5, (k) => {
      this.pos.copy(brake).addScaledVector(nd, 40 * k + 900 * k * k);
      this.alpha = clamp(1 - (k - 0.6) / 0.4, 0, 1);
    }, 'away');
  }

  lightLevel() {
    const n = this.mgr.world.sky.night;
    return (0.85 + 0.15 * Math.sin(this.t * 11)) * (0.15 + n * 1.2);
  }
}

// RARE: a white, featureless capsule that doesn't fly so much as glitch:
// dead still, then a 10-35 m jump in a fraction of a second, over and over.
class TicTac extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'tictac', model, rng);
    const p = mgr.player.pos;
    const sites = SITES.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 320);
    const site = near ? { x: p.x + rng.float(-60, 60), z: p.z - 120 } : rng.pick(sites.length ? sites : SITES);
    let cur = V(site.x + rng.float(-40, 40), rng.float(35, 75), site.z + rng.float(-40, 40));
    this.yaw = rng.float(0, Math.PI * 2);
    this.alpha = 0;
    const p0 = cur.clone();
    this.seg(0.8, (k) => {
      this.alpha = k;
      this.pos.copy(p0);
    }, 'appear');
    const jumps = rng.int(10, 18);
    for (let i = 0; i < jumps; i++) {
      const hold = cur.clone();
      const seed = rng.next() * 100;
      this.seg(rng.float(0.7, 2.4), (k, t) => {
        // A faint high-frequency tremble while "still".
        this.pos.set(hold.x + noise1(t * 14, seed) * 0.15, hold.y + noise1(t * 13, seed + 1) * 0.15, hold.z + noise1(t * 15, seed + 2) * 0.15);
      }, 'hold');
      const ang = rng.float(0, Math.PI * 2);
      const len = rng.float(10, 35);
      const next = V(cur.x + Math.cos(ang) * len, clamp(cur.y + rng.float(-18, 18), 15, 110), cur.z + Math.sin(ang) * len);
      if (rng.chance(0.12)) next.y = 15; // drops to just over the field
      const from = cur.clone();
      const newYaw = rng.float(0, Math.PI * 2);
      this.seg(rng.float(0.08, 0.16), (k) => {
        this.pos.lerpVectors(from, next, k);
        if (k >= 1) this.yaw = newYaw;
      }, 'jump');
      cur = next;
    }
    const last = cur.clone();
    const out = V(rng.float(-1, 1), rng.float(0, 0.3), rng.float(-1, 1)).normalize();
    this.seg(1.2, (k) => {
      this.pos.copy(last).addScaledVector(out, 3000 * k * k);
      this.alpha = clamp(1 - (k - 0.7) / 0.3, 0, 1);
    }, 'gone');
  }

  animate() {
    this.group.rotation.set(0, this.yaw, 0);
    this.model.materials[0].opacity = this.alpha;
    this.model.group.visible = this.alpha > 0.01;
  }

  lightLevel() {
    return 0.12 * this.mgr.world.sky.night;
  }
}

// RARE: a wheel of colored lights sinks out of the night sky, spins up,
// tilts toward you, flashes once, and is gone straight up.
class Ring extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'ring', model, rng);
    const p = mgr.player.pos;
    const sites = SITES.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 340);
    const site = near ? { x: p.x + rng.float(-50, 50), z: p.z - 110 } : rng.pick(sites.length ? sites : SITES);
    const low = V(site.x + rng.float(-30, 30), rng.float(55, 85), site.z + rng.float(-30, 30));
    const high = low.clone().add(V(0, 520, 0));
    this.spin = 0.6;
    this.tilt = 0;
    this.flash = 0;
    this.pos.copy(high);
    this.seg(22, (k) => this.pos.lerpVectors(high, low, E.outCubic(k)), 'descend');
    const hold = rng.float(25, 35);
    this.hover(low, hold, 'hover', 0.5, 1);
    const hs = this.segs[this.segs.length - 1];
    const base = hs.fn;
    hs.fn = (k, t) => {
      base(k, t);
      this.spin = 0.6 + 3.6 * k * k;
      this.tilt = 0.75 * E.inOutSine(Math.min(1, k * 1.6));
    };
    this.seg(0.7, (k) => (this.flash = Math.sin(k * Math.PI)), 'pulse');
    this.seg(2.2, (k) => {
      this.flash = 0;
      this.pos.copy(low).add(V(0, 1600 * k * k, 0));
      this.alpha = clamp(1 - (k - 0.5) / 0.5, 0, 1);
    }, 'gone');
  }

  animate(dt) {
    this.model.body.rotation.y += this.spin * dt;
    const c = this.mgr.camera.position;
    this.group.rotation.y = Math.atan2(c.x - this.pos.x, c.z - this.pos.z);
    this.group.rotation.x = -this.tilt; // show the lit underside to the viewer
    this.model.group.visible = this.alpha > 0.01;
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    if (this.flash > 0) return 1 + this.flash * 3;
    if (L.role === 'core') return 0.5 * (0.3 + n);
    const chase = 0.55 + 0.45 * Math.sin(this.t * this.spin * 3 - i * 1.9);
    return chase * 1.3 * (0.3 + n * 0.8);
  }
}

// EPIC: a perfectly smooth cloud forms over town and refuses to move. A
// colossal hull pokes out of it, lightning flickers inside, and three
// scouts drop out to buzz the neighborhood before it all dissolves.
class Cloudship extends Craft {
  constructor(mgr, model, rng, { near }) {
    super(mgr, 'cloudship', model, rng);
    const p = mgr.player.pos;
    const a = rng.float(0, Math.PI * 2);
    const r = near ? 220 : rng.float(250, 420);
    const c0 = V(p.x + Math.cos(a) * r, rng.float(280, 330), p.z + Math.sin(a) * r);
    const drift = V(rng.float(-0.6, 0.6), 0, rng.float(-0.6, 0.6));
    this.yaw = rng.float(0, Math.PI * 2);
    this.cloud = 0;
    this.hullA = 0;
    this.pos.copy(c0);
    const at = (t) => c0.clone().addScaledVector(drift, t);
    this.seg(14, (k, t) => {
      this.pos.copy(at(t));
      this.cloud = k;
      this.hullA = clamp(k * 2 - 1, 0, 1);
    }, 'form');
    const hold = rng.float(80, 110);
    this.seg(hold, (k, t) => this.pos.copy(at(t)), 'hold');
    this.seg(14, (k, t) => {
      this.pos.copy(at(t));
      this.cloud = 1 - k;
      this.hullA = clamp(1 - k * 2, 0, 1);
    }, 'dissolve');
    // Scout flight plan (world-space waypoints around the player).
    this.scoutStart = 14 + 12;
    this.scouts = [0, 1, 2].map(() => {
      const wp = [0, 1, 2].map(() => {
        const ang = rng.float(0, Math.PI * 2);
        const rr = rng.float(40, 180);
        return V(p.x + Math.cos(ang) * rr, rng.float(40, 90), p.z + Math.sin(ang) * rr);
      });
      return { wp, delay: rng.float(0, 6) };
    });
    this.scoutLegs = [6, 5, 4, 5, 6];
  }

  _scoutPos(sc, t, out) {
    // belly -> wp0 -> wp1 (hover) -> wp2 -> belly
    const belly = _w.copy(this.pos).add(V(-40, -30, 0));
    const pts = [belly.clone(), sc.wp[0], sc.wp[1], sc.wp[1], sc.wp[2], belly.clone()];
    let tt = t;
    for (let i = 0; i < this.scoutLegs.length; i++) {
      const d = this.scoutLegs[i];
      if (tt <= d) return out.lerpVectors(pts[i], pts[i + 1], E.inOutSine(tt / d));
      tt -= d;
    }
    return null;
  }

  animate() {
    const m = this.model;
    this.group.rotation.set(0, this.yaw, 0);
    // Clouds seen from below would go black; light them with the sky instead.
    const pal = this.mgr.world.sky.pal;
    m.cloudMats.forEach((cm, i) => {
      cm.opacity = this.cloud * (0.86 - i * 0.06);
      cm.emissive.copy(pal.hor).lerp(pal.cloud, 0.5).multiplyScalar(0.55 + i * 0.06);
    });
    m.materials[0].opacity = this.hullA;
    m.hull.visible = this.hullA > 0.01;
    this.scoutVis = [];
    for (let i = 0; i < 3; i++) {
      const sc = this.scouts[i];
      const st = this.t - this.scoutStart - sc.delay;
      const marker = m.lights[2 + i].obj;
      const wp = st > 0 ? this._scoutPos(sc, st, _v) : null;
      if (wp) {
        marker.position.copy(wp).sub(this.pos).applyAxisAngle(V(0, 1, 0), -this.yaw);
        this.scoutVis.push(clamp(st / 0.8, 0, 1));
      } else {
        marker.position.set(-40, -30, 0);
        this.scoutVis.push(0);
      }
    }
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    if (L.role === 'inner') {
      const bolt = hash(Math.floor(this.t * 8), 3) > 0.93 ? 0.55 : 0;
      return (0.05 + bolt) * this.cloud * (0.3 + n);
    }
    if (L.role === 'nose') return 0.9 * this.hullA * (0.2 + n);
    return (this.scoutVis?.[i - 2] || 0) * (0.5 + n * 1.2);
  }
}

// EPIC: comes in low over the corn, lowers, and shines a beam straight down
// for a while. When it's gone, the corn underneath has been laid flat.
class Beam extends Craft {
  constructor(mgr, model, rng, { near, at }) {
    super(mgr, 'beam', model, rng);
    const corn = ZONES.corn;
    const spot = at || V((corn[0] + corn[2]) / 2 + rng.float(-25, 25), 0, (corn[1] + corn[3]) / 2 + rng.float(-25, 25));
    this.spot = spot;
    const a = rng.float(0, Math.PI * 2);
    const start = V(spot.x + Math.cos(a) * 900, 150, spot.z + Math.sin(a) * 900);
    const over = V(spot.x, 60, spot.z);
    const low = V(spot.x, 28, spot.z);
    this.beamA = 0;
    this.pos.copy(start);
    this.seg(near ? 6 : 14, (k) => this.pos.lerpVectors(start, over, E.outCubic(k)), 'arrive');
    this.seg(6, (k) => this.pos.lerpVectors(over, low, E.inOutSine(k)), 'descend');
    this.seg(3, (k) => {
      this.pos.copy(low);
      this.beamA = k;
    }, 'beamOn');
    this.hover(low, rng.float(25, 40), 'beaming', 0.3, 0.4);
    this.seg(2, (k) => {
      this.beamA = 1 - k;
      this.beamDone = true;
    }, 'beamOff');
    const up = V(spot.x, 90, spot.z);
    this.seg(5, (k) => this.pos.lerpVectors(low, up, E.inOutSine(k)), 'rise');
    const out = V(Math.cos(a + 2), 0.4, Math.sin(a + 2)).normalize();
    this.seg(4, (k) => this.pos.copy(up).addScaledVector(out, 1500 * k * k * k), 'depart');
  }

  animate(dt) {
    const m = this.model;
    m.body.rotation.y += dt * 0.25;
    const h = Math.max(1, this.pos.y - 1.6 - 0.3);
    m.beam.scale.set(h * 0.3, h, h * 0.3);
    m.beam.rotation.z = Math.sin(this.t * 0.7) * 0.07;
    m.beam.rotation.x = Math.cos(this.t * 0.5) * 0.06;
    m.beam.visible = this.beamA > 0.01;
    m.beamMat.opacity = this.beamA * (0.22 + 0.04 * Math.sin(this.t * 13));
  }

  lightLevel(L, i) {
    const n = this.mgr.world.sky.night;
    if (L.role === 'lamp') return (0.3 + this.beamA * 1.6) * (0.3 + n);
    return (Math.sin(this.t * 3 + i * 0.8) > 0.2 ? 1.1 : 0.2) * (0.3 + n * 0.8);
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
    this.models = { saucer: buildSaucer(), cigar: buildCigar(), triangle: buildTriangle(), sphere: buildSphere(), vee: buildV(), dots: buildDots(5), k1947: build1947(), phoenix: buildPhoenix(), orbs: buildOrbs(4), star: buildStar(), tictac: buildTicTac(), ring: buildRing(), cloudship: buildCloudship(), beam: buildBeamCraft() };
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
    // Three flares for the flare lure.
    this.flareGlows = [0, 1, 2].map(() => g.add(V(0, -500, 0), '#ff3a1a', 1.6));

    // The crop circle left behind by the Harvester is evidence too.
    const mgr0 = this;
    this.world.subjects.push({
      id: 'crop-circle',
      kind: 'crop',
      label: 'Crop circle',
      category: 'anomaly',
      value: 160,
      radius: 22,
      tier: 'epic',
      get sightingId() {
        return mgr0.state.crop ? `crop-d${mgr0.state.crop.day}` : null;
      },
      getPos: (cam, out) => out.set(mgr0.crop.C.x, 0.5, mgr0.crop.C.z),
      isActive: () => !!mgr0.crop,
    });

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
        legend: !!info.legend,
        tier: info.tier,
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
    if (this.state.day >= 1 && rng.chance(LEGEND_CHANCE)) return night ? 'phoenix' : 'k1947';
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

  spawn(type, near = false, at = null) {
    this._ensureState();
    const S = this.state;
    if (this.current) this.current.dispose();
    const rng = new RNG(Math.floor(Math.random() * 1e9));
    const night = this.world.sky.night > 0.5;
    const model = this.models[type];
    const C = { saucer: Saucer, cigar: Cigar, triangle: Triangle, sphere: Sphere, vee: Vee, dots: Dots, k1947: K1947, phoenix: Phoenix, orbs: Orbs, star: Star, tictac: TicTac, ring: Ring, cloudship: Cloudship, beam: Beam }[type];
    this.current = new C(this, model, rng, { night, near, at });
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
    else if (c.type === 'orbs') {
      if (Math.random() < 0.4) return;
      msg = "Orange lights are rising over the trees. Lanterns? They're not drifting like lanterns.";
    } else if (c.type === 'star') {
      if (Math.random() < 0.6) return;
      msg = 'One of the stars is moving.';
    } else if (c.type === 'tictac') msg = 'Something white is darting over the field. It moves like a skipping tape.';
    else if (c.type === 'ring') msg = 'A wheel of colored lights is coming down out of the sky.';
    else if (c.type === 'cloudship') msg = "A strange, perfectly smooth cloud has formed over town. It isn't moving with the others.";
    else if (c.type === 'beam') msg = 'A beam of light is touching down somewhere past the houses. Toward the corn.';
    else if (c.type === 'k1947') msg = 'Something flashes in the sky, like sun off a mirror. Then again. Then again.';
    else if (c.type === 'phoenix') msg = 'The whole block has gone silent. Up and down the street, people are stepping out onto their lawns.';
    else {
      // Dots are easy to mistake for stars; only sometimes does anyone notice.
      if (Math.random() < 0.5) return;
      msg = 'A few of the stars seem to be... moving?';
    }
    bus.emit('toast', msg);
  }

  // Lenny explains the legends (and the lures) once you've settled in.
  _legendMail() {
    const S = this.state;
    if (S.day < 2 || S.flags.legendMail) return;
    S.flags.legendMail = true;
    S.inbox.push({
      id: 'legends',
      day: S.day,
      from: 'LENNY <lenny@greyzone.bbs>',
      subject: 'the LEGENDS (read this)',
      body: "ok so beyond the usual stuff there are two things everybody on the board wants and NOBODY has.\n\n1) THE '47 VISITOR. heel shaped, flat, little fin hanging off the bottom. same thing a guy photographed over Phoenix in 1947. flies big fast circles, wobbles like a skipped rock, then just GONE. daytime only. the pilot who saw them in '47 said they flashed like mirrors in the sun.\n\n2) THE PHOENIX LIGHTS. you saw the news in March. a V a mile wide, dead silent, lights hanging over the mountains, then they go out one by one. night only.\n\nyou could wait your whole life for either one. OR. old timers swear the '47 ones come if you flash a mirror at the sky on a sunny day. and the phoenix ones... ppl say flares. lots of flares. (yeah i know thats what the air force said lol)\n\nskywatcher sells signal mirrors and road flares now. go somewhere OPEN, the corn, the field past Oak, the park. press L.\n\nand if you ever get one on film... dont sell it cheap.\n- L",
      read: false,
    });
    bus.emit('toast', 'New mail on UFO-NET.');
  }

  _isOpen(x, z) {
    for (const key of ['corn', 'field', 'park']) {
      const r = ZONES[key];
      if (x > r[0] - 4 && x < r[2] + 4 && z > r[1] - 4 && z < r[3] + 4) return true;
    }
    return false;
  }

  // Can this lure be used right now, right here? Returns a reason if not.
  lureBlocker(id) {
    const S = this.state;
    const L = LURES[id];
    if (!L || !(S.lures[id] > 0)) return "You don't have one.";
    if (S.lure) return 'A lure is already out. Wait and watch.';
    const sky = this.world.sky;
    if (L.when === 'night' && sky.night < 0.5) return 'Needs full dark.';
    if (L.when === 'day' && sky.sunDir.y < 0.08) return 'Needs the sun up.';
    const p = this.player.pos;
    if (L.place === 'corn' && !this._inCorn(p.x, p.z)) return 'Has to be done inside the corn field.';
    if (L.place === 'open' && !this._isOpen(p.x, p.z)) return 'Find somewhere open: the corn, the field west of Oak St, or the park.';
    return null;
  }

  _inCorn(x, z) {
    const r = ZONES.corn;
    return x > r[0] && x < r[2] && z > r[1] && z < r[3];
  }

  useLure(id) {
    const S = this.state;
    this._ensureState();
    const why = this.lureBlocker(id);
    if (why) {
      bus.emit('toast', why);
      return false;
    }
    const L = LURES[id];
    S.lures[id] -= 1;
    const p = this.player.pos;
    const abs = S.day * 24 + S.hour;
    S.lure = { kind: id, x: p.x, z: p.z, t0: abs, rollAt: abs + 0.15 + Math.random() * 0.75, until: abs + 1.5, rolled: false, success: false };
    bus.emit('sfx', L.visual === 'flares' ? 'flare' : L.visual === 'tape' ? 'modem' : 'click');
    bus.emit('toast', `${L.use} Now you wait.`);
    return true;
  }

  // What the lure looks like while you wait (uses three reserved glows).
  _lureVisual(L, abs) {
    const g = this.world.glows;
    const vis = LURES[L.kind]?.visual;
    const t = (abs - L.t0) * 60; // real seconds since use
    const set = (k, x, y, z, color, size, level) => {
      const i = this.flareGlows[k];
      g.restyle(i, color, size);
      g.move(i, _v.set(x, y, z));
      g.set(i, level);
    };
    for (let k = 0; k < 3; k++) g.set(this.flareGlows[k], 0);
    if (vis === 'flares') {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        set(k, L.x + Math.cos(a) * 2.5, 0.35, L.z + Math.sin(a) * 2.5, '#ff3a1a', 1.6, 0.9 + Math.random() * 0.5);
      }
    } else if (vis === 'strobe') {
      set(0, L.x, 0.4, L.z, '#ffffff', 3, t % 1 < 0.08 ? 3 : 0);
    } else if (vis === 'lantern') {
      set(0, L.x + t * 0.3, 2 + Math.min(t, 80) * 1.4, L.z + t * 0.2, '#ffa040', 1.4, (0.9 + Math.random() * 0.3) * (t < 80 ? 1 : 0));
    } else if (vis === 'glint') {
      set(0, L.x + 1, 0.3, L.z, '#ffffff', 1.2, this.world.sky.daylight * (0.6 + 0.6 * Math.max(0, Math.sin(t * 4))));
    } else if (vis === 'kite') {
      set(0, L.x + Math.sin(t * 0.4) * 4, 32 + Math.sin(t * 0.7) * 3, L.z + 10, '#ffffff', 1.4, this.world.sky.daylight * (0.4 + 0.8 * Math.max(0, Math.sin(t * 2.3)) ** 6));
    } else if (vis === 'stakes') {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        set(k, L.x + Math.cos(a) * 6, 0.6, L.z + Math.sin(a) * 6, '#f0f4ff', 0.6, 0.6);
      }
    } else if (vis === 'balloon') {
      set(0, L.x, 2 + Math.min(t, 120) * 3, L.z, '#ffffff', 2.5, (0.3 + this.world.sky.daylight * 0.8) * (t < 120 ? 1 : 0));
    }
  }

  _updateLure(abs) {
    const S = this.state;
    const L = S.lure;
    if (!L) {
      for (const i of this.flareGlows) this.world.glows.set(i, 0);
      return;
    }
    const def = LURES[L.kind];
    this._lureVisual(L, abs);
    if (!L.rolled && abs >= L.rollAt) {
      L.rolled = true;
      L.success = Math.random() < (def?.odds ?? LURE_SUCCESS);
      if (L.success) {
        if (this.current) this.end();
        this.spawn(def.target, true, V(L.x, 0, L.z));
      }
    }
    if (abs >= L.until) {
      if (!L.success && def) bus.emit('toast', def.fail);
      S.lure = null;
    }
  }

  // Lay the corn flat in a pattern (and stand it back up when it expires).
  _makeCrop(C) {
    const corn = this.world.corn;
    const { spots, original } = corn.userData;
    const rng = new RNG(C.seed);
    const R = rng.float(11, 15);
    const sats = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + rng.float(0, 2);
      return { x: C.x + Math.cos(a) * (R + 11), z: C.z + Math.sin(a) * (R + 11), r: rng.float(3, 5) };
    });
    const inside = (x, z) => {
      const d = Math.hypot(x - C.x, z - C.z);
      if (d < R || (d > R + 3 && d < R + 5)) return true;
      return sats.some((s) => Math.hypot(x - s.x, z - s.z) < s.r);
    };
    const m4 = new THREE.Matrix4();
    corn.instanceMatrix.array.set(original);
    spots.forEach(([x, z], i) => {
      if (inside(x, z)) corn.setMatrixAt(i, m4.makeScale(0.001, 0.001, 0.001).setPosition(x, -1, z));
    });
    corn.instanceMatrix.needsUpdate = true;
    // Flattened straw, swirled.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#c8ac6c';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#a08848';
    g.lineWidth = 2;
    for (let k = 0; k < 40; k++) {
      g.beginPath();
      for (let a = 0; a < 12; a += 0.2) {
        const rr = 2 + a * 5 + k * 0.3;
        g.lineTo(64 + Math.cos(a + k * 0.157) * rr, 64 + Math.sin(a + k * 0.157) * rr);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const grp = new THREE.Group();
    const flat = (geo, x, z) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), mat);
      m.position.set(x, 0.12, z);
      grp.add(m);
    };
    flat(new THREE.CircleGeometry(R, 40), C.x, C.z);
    flat(new THREE.RingGeometry(R + 3, R + 5, 48), C.x, C.z);
    for (const sa of sats) flat(new THREE.CircleGeometry(sa.r, 20), sa.x, sa.z);
    this.game.scene.add(grp);
    this.crop = { grp, C };
  }

  _clearCrop() {
    const corn = this.world.corn;
    corn.instanceMatrix.array.set(corn.userData.original);
    corn.instanceMatrix.needsUpdate = true;
    this.game.scene.remove(this.crop.grp);
    this.crop.grp.traverse((o) => o.geometry?.dispose());
    this.crop = null;
  }

  _updateCrop() {
    const S = this.state;
    if (S.crop && S.day > S.crop.day + 3) S.crop = null;
    if (this.crop && (!S.crop || this.crop.C !== S.crop)) this._clearCrop();
    if (S.crop && !this.crop) this._makeCrop(S.crop);
  }

  // Called every frame while playing.
  update(dt) {
    const S = this.state;
    const abs = S.day * 24 + S.hour;
    this._ensureState();
    // Time jumped (sleep): drop whatever was up and reschedule soon.
    if (this.lastAbs !== null && abs - this.lastAbs > 0.5) {
      if (this.current) this.end();
      S.lure = null; // you weren't out there to see it
      if (abs > S.ufo.next) this._schedule(abs, 0.4, 2.5);
    }
    this.lastAbs = abs;
    this._legendMail();
    this._updateLure(abs);
    this._updateCrop();

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
    const c = this.current;
    if (c.type === 'beam' && c.beamDone) {
      const S = this.state;
      S.crop = { x: c.spot.x, z: c.spot.z, day: S.day, seed: Math.floor(Math.random() * 1e6) };
    }
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
