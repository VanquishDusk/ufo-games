// First-person walker: mouse look, WASD, sprint, crouch, jump, head bob,
// collisions against the town. Also tracks look angular velocity, which the
// photo camera turns into motion blur.
import * as THREE from 'three';
import { clamp, damp } from '../core/rng.js';
import { bus } from '../core/events.js';

const EYE = 1.68;
const CROUCH_EYE = 1.05;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.35;
    this.eye = EYE;
    this.onGround = true;
    this.crouching = false;
    this.bob = 0;
    this.stepAcc = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.frozen = false;
    this.anchored = false; // tripod: can look, can't walk
    this.angVel = new THREE.Vector2(); // yaw/pitch rad/s (smoothed)
    this.speed = 0;
    this.edgeWarned = 0;
    this.swayYaw = 0;
    this.swayPitch = 0;
    camera.rotation.order = 'YXZ';
  }

  place(pos, yaw) {
    this.pos.copy(pos);
    this.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.syncCamera(0);
  }

  update(dt, input, { lookScale = 1, moveScale = 1, canSprint = true } = {}) {
    // Look.
    const prevYaw = this.yaw;
    const prevPitch = this.pitch;
    if (!this.frozen && input.lookActive) {
      const s = 0.0022 * this.sensitivity * lookScale;
      this.yaw -= input.dx * s;
      this.pitch -= input.dy * s * (this.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    }
    if (dt > 0) {
      const ay = (this.yaw - prevYaw) / dt;
      const ap = (this.pitch - prevPitch) / dt;
      this.angVel.x = damp(this.angVel.x, ay, 18, dt);
      this.angVel.y = damp(this.angVel.y, ap, 18, dt);
    }

    // Move.
    const ax = this.frozen ? { x: 0, y: 0 } : input.moveAxes();
    const wantCrouch = !this.frozen && input.down('crouch');
    this.crouching = wantCrouch;
    const sprint = canSprint && input.down('sprint') && !this.crouching && ax.y > 0.2;
    let speed = this.crouching ? 1.7 : sprint ? 6.4 : 3.6;
    speed *= moveScale;
    const inCorn = this.world.inCorn(this.pos.x, this.pos.z);
    if (inCorn) speed *= 0.62;
    if (this.anchored) speed = 0;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const tx = (fx * ax.y + rx * ax.x) * speed;
    const tz = (fz * ax.y + rz * ax.x) * speed;
    const accel = this.onGround ? 11 : 2.5;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);

    if (this.onGround && !this.frozen && !this.anchored && input.pressed('jump')) {
      this.vel.y = 6.3;
      this.onGround = false;
      bus.emit('jump');
    }
    this.vel.y -= 20 * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -4) bus.emit('land', this.world.surfaceAt(this.pos.x, this.pos.z));
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    this.world.colliders.resolve(this.pos, this.radius, this.pos.y, this.pos.y + this.eye + 0.1);

    // Soft world edge.
    const B = this.world.bounds;
    if (Math.abs(this.pos.x) > B || Math.abs(this.pos.z) > B) {
      this.pos.x = clamp(this.pos.x, -B, B);
      this.pos.z = clamp(this.pos.z, -B, B);
      if (performance.now() - this.edgeWarned > 6000) {
        this.edgeWarned = performance.now();
        bus.emit('toast', "The woods get too thick out here. Better head back.");
      }
    }

    // Steps & bob.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hs;
    if (this.onGround && hs > 0.5) {
      this.stepAcc += hs * dt;
      this.bob += hs * dt * 2.1;
      const stride = sprint ? 0.95 : this.crouching ? 0.6 : 0.78;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        bus.emit('step', inCorn ? 'corn' : this.world.surfaceAt(this.pos.x, this.pos.z), sprint);
      }
    } else {
      this.bob = damp(this.bob, Math.round(this.bob / Math.PI) * Math.PI, 6, dt);
    }

    this.eye = damp(this.eye, this.crouching ? CROUCH_EYE : EYE, 12, dt);
    this.syncCamera(hs);
  }

  syncCamera(hs, bobScale = 1) {
    const c = this.camera;
    const bobAmt = clamp(hs / 6, 0, 1) * 0.045 * bobScale;
    c.position.set(this.pos.x, this.pos.y + this.eye + Math.abs(Math.sin(this.bob)) * bobAmt, this.pos.z);
    c.rotation.y = this.yaw + this.swayYaw;
    c.rotation.x = this.pitch + this.swayPitch + Math.sin(this.bob * 2) * bobAmt * 0.02;
    c.rotation.z = Math.sin(this.bob) * bobAmt * 0.04;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}
