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
import { buildSaucer, buildCigar, buildTriangle } from './models.js';
import { ZONES, LANDMARKS } from '../world/layout.js';

export const UFO_TYPES = {
  saucer: { label: 'Flying saucer', value: 150, radius: 7.2 },
  cigar: { label: 'Cigar-shaped craft', value: 130, radius: 11 },
  triangle: { label: 'Black triangle', value: 210, radius: 20 },
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
    this.lightIdx = model.lights.map((_, i) => mgr.glowPool[i]);
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

export class UFOManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.player = game.player;
    this.camera = game.camera;
    this.current = null;
    this.lastAbs = null;
    this.models = { saucer: buildSaucer(), cigar: buildCigar(), triangle: buildTriangle() };
    for (const m of Object.values(this.models)) {
      m.group.visible = false;
      game.scene.add(m.group);
    }
    const g = this.world.glows;
    this.glowPool = [];
    for (let i = 0; i < 12; i++) this.glowPool.push(g.add(V(0, -500, 0), '#ffffff', 1));

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
    if (night) return rng.chance(0.42) ? 'triangle' : 'saucer';
    if (twilight) return rng.chance(0.5) ? 'cigar' : 'saucer';
    return rng.chance(0.75) ? 'cigar' : 'saucer';
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
    const C = { saucer: Saucer, cigar: Cigar, triangle: Triangle }[type];
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
    else msg = 'A low hum, more felt than heard. The crickets have stopped.';
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
    const loud = c.type !== 'cigar';
    this.world.disturb = loud && c.pos.y < 140 ? { x: c.pos.x, z: c.pos.z, r: 70 } : null;
    const level = loud ? clamp(1 - d / (c.type === 'triangle' ? 420 : 320), 0, 1) * c.alpha : 0;
    bus.emit('ufoAudio', { kind: c.type, level, hush: c.type !== 'cigar' });
  }
}
