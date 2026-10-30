// Grades a photo and figures out what's in it.
//
// SUBJECTS are how anything becomes "photographable". The world registers
// landmarks (moon, water tower...). UFOs will register themselves the same
// way with category 'anomaly' and a dollar value:
//
//   world.subjects.push({
//     id: 'ufo-17',             // unique
//     label: 'Saucer',          // shown in the photo report
//     category: 'anomaly',      // 'anomaly' = buyers pay for it
//     value: 120,               // base $ for a perfect shot
//     sightingId: 'night4-a',   // repeat shots of one sighting are worth less
//     radius: 6,                // world-space size (m) for framing math
//     pos: Vector3,             // or getPos(camera, out) for moving things
//     isActive: () => true,     // optional: only counts while visible/active
//     selfLuminous: true,       // optional: exposure matters less
//   });
import * as THREE from 'three';
import { clamp } from '../core/rng.js';
import { PHOTO_H } from './Developer.js';

const _p = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _off = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class PhotoAnalyzer {
  constructor(world) {
    this.world = world;
    this.ray = new THREE.Raycaster();
  }

  _visibility(camera, pos, radius) {
    const origin = camera.position;
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const pts = [
      [0, 0],
      [0.6, 0],
      [-0.6, 0],
      [0, 0.6],
      [0, -0.6],
    ];
    let clear = 0;
    for (const [ox, oy] of pts) {
      _off.copy(pos).addScaledVector(_right, ox * radius).addScaledVector(_up, oy * radius);
      _dir.subVectors(_off, origin);
      const dist = _dir.length();
      _dir.divideScalar(dist);
      this.ray.set(origin, _dir);
      this.ray.far = Math.max(0.1, dist - radius * 0.3);
      const hit = this.ray.intersectObjects(this.world.occluders, false);
      if (!hit.length) clear++;
    }
    return clear / pts.length;
  }

  // camera: the photo camera (pose + fov). dev: result from Developer.
  evaluate(camera, dev, { defocusPx, lensSharp, night }) {
    camera.updateMatrixWorld();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const subjects = [];
    for (const s of this.world.subjects) {
      if (s.isActive && !s.isActive()) continue;
      if (s.getPos) s.getPos(camera, _p);
      else _p.copy(s.pos);
      const dist = _p.distanceTo(camera.position);
      if (dist < 0.5) continue;
      _ndc.copy(_p).project(camera);
      if (_ndc.z > 1 || _ndc.z < -1) continue;
      const sizeFrac = s.radius / (dist * tanHalf); // diameter / frame height
      const margin = Math.min(0.5, sizeFrac);
      if (Math.abs(_ndc.x) > 1 + margin || Math.abs(_ndc.y) > 1 + margin) continue;
      const vis = s.occludable === false ? 1 : this._visibility(camera, _p, s.radius);
      if (vis < 0.2) continue;
      const offCenter = Math.hypot(_ndc.x * 0.75, _ndc.y);
      const center = clamp(1 - offCenter / 1.1, 0, 1);
      // Ideal: subject fills 15-60% of the frame height.
      const size = sizeFrac < 0.15 ? clamp(sizeFrac / 0.15, 0, 1) ** 0.7 : sizeFrac > 0.9 ? clamp(1.6 - sizeFrac, 0.3, 1) : 1;
      const inFrame = Math.abs(_ndc.x) < 1 && Math.abs(_ndc.y) < 1 ? 1 : 0.5;
      // A moving subject smears across the frame during the exposure.
      let motionPx = 0;
      if (s.getVel) {
        const v = s.getVel();
        _dir.subVectors(_p, camera.position).normalize();
        const perp = _off.copy(v).addScaledVector(_dir, -v.dot(_dir)).length();
        motionPx = (perp / dist) * dev.shutter * (PHOTO_H / THREE.MathUtils.degToRad(camera.fov));
      }
      subjects.push({
        id: s.id,
        kind: s.kind || null,
        label: s.label,
        category: s.category,
        value: s.value || 0,
        sightingId: s.sightingId || null,
        selfLuminous: !!s.selfLuminous,
        dist: Math.round(dist),
        size: +sizeFrac.toFixed(3),
        center: +center.toFixed(2),
        visibility: +vis.toFixed(2),
        motionPx: +motionPx.toFixed(1),
        _base: size * vis * inFrame * (0.65 + 0.35 * center) * (0.3 + 0.7 * clamp(1 - (motionPx - 1) / 12, 0, 1)),
      });
    }

    // Technical quality.
    const blur = dev.blurPx + defocusPx * 0.8;
    const sharpness = clamp((1 - clamp((blur - 0.6) / 9, 0, 1)) * (0.75 + 0.25 * lensSharp), 0, 1);
    const ev = dev.evError;
    const exposure = clamp(1 - (Math.abs(ev) - 0.8) / 3, 0, 1);

    for (const s of subjects) {
      const expo = s.selfLuminous ? 0.6 + 0.4 * exposure : exposure;
      s.score = +clamp(s._base * (0.35 + 0.65 * sharpness) * (0.4 + 0.6 * expo), 0, 1).toFixed(3);
      delete s._base;
    }
    subjects.sort((a, b) => b.score * (b.value + 1) - a.score * (a.value + 1));
    const best = subjects[0];
    const composition = best ? clamp(best.center * 0.5 + Math.min(1, best.size / 0.15) * 0.5, 0, 1) : 0.45;
    const quality = clamp(sharpness * 0.5 + exposure * 0.32 + composition * 0.18, 0, 1);
    const grade = quality >= 0.9 ? 'S' : quality >= 0.78 ? 'A' : quality >= 0.62 ? 'B' : quality >= 0.45 ? 'C' : quality >= 0.3 ? 'D' : 'F';

    const notes = [];
    if (dev.blurPx > 3) notes.push(dev.blurPx > 9 ? 'Heavy motion blur' : 'Some motion blur');
    if (defocusPx > 1.5) notes.push('Out of focus');
    if (ev < -1.5) notes.push(ev < -3 ? 'Badly underexposed' : 'Underexposed');
    if (ev > 1.5) notes.push('Overexposed');
    if (subjects.some((s) => s.category === 'anomaly' && s.motionPx > 4)) notes.push('Subject moving');
    if (!subjects.some((s) => s.category === 'anomaly')) notes.push('No anomalies');

    return {
      subjects,
      sharpness: +sharpness.toFixed(3),
      exposure: +exposure.toFixed(3),
      composition: +composition.toFixed(3),
      quality: +quality.toFixed(3),
      grade,
      night: !!night,
      blurPx: +dev.blurPx.toFixed(1),
      shutter: dev.shutter,
      ev: +ev.toFixed(2),
      notes,
    };
  }
}
