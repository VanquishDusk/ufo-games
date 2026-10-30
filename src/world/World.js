// Builds Cedar Hollow and runs its ambient life: windows lighting up as
// families get home, porch lights, flickering street lamps, tower beacons.
import * as THREE from 'three';
import { RNG, hash, clamp } from '../core/rng.js';
import { createTextures } from '../render/textures.js';
import { createMaterials } from '../render/materials.js';
import { GlowField, InstancedColors } from '../render/glows.js';
import { Batcher } from './geo.js';
import { Colliders } from './Colliders.js';
import { generateLots, surfaceAt, BOUNDS, ZONES } from './layout.js';
import { buildHouse, DAY_GLASS } from './houses.js';
import { buildStreets, buildCar, buildStreetlights, buildPowerLines, buildSigns, buildTrees, scatterTrees, buildPark, buildStore, buildWaterTower, buildRadioTower, buildCorn, buildHills } from './props.js';
import { Sky } from './Sky.js';

const WARM = [new THREE.Color('#ffc46a'), new THREE.Color('#ffb050'), new THREE.Color('#ffd890'), new THREE.Color('#e8eef0'), new THREE.Color('#ff9a50')];
const TV = new THREE.Color('#6a88ff');

export class World {
  constructor(scene) {
    this.scene = scene;
    this.T = createTextures();
    this.M = createMaterials(this.T);
    this.colliders = new Colliders();
    this.glows = new GlowField(3000);
    this.windows = new InstancedColors(new THREE.PlaneGeometry(1, 1), this.M.window, 2600);
    this.pools = new InstancedColors(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.M.pool, 500);
    this.lamps = new InstancedColors(new THREE.BoxGeometry(1, 1, 1), this.M.lamp, 300);
    this.interactables = [];
    this.subjects = [];
    this.trees = [];
    this.cars = [];
    this.bounds = BOUNDS;
    this._c = new THREE.Color();
    this._lightTimer = 0;

    const batch = new Batcher();
    const ctx = {
      batch,
      M: this.M,
      T: this.T,
      scene,
      colliders: this.colliders,
      glows: this.glows,
      pools: this.pools,
      lamps: this.lamps,
      windows: this.windows,
      interactables: this.interactables,
      subjects: this.subjects,
      trees: this.trees,
      cars: this.cars,
    };

    // Ground.
    const groundGeo = new THREE.PlaneGeometry(1900, 1900, 38, 38).rotateX(-Math.PI / 2);
    const uv = groundGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 475, uv.getY(i) * 475);
    const ground = new THREE.Mesh(groundGeo, this.M.grass);
    ground.matrixAutoUpdate = false;
    scene.add(ground);

    buildStreets(ctx);

    this.lots = generateLots(42);
    this.houses = this.lots.map((lot, i) => buildHouse(lot, i, ctx));
    this.playerHouse = this.houses.find((h) => h.isPlayer);
    for (const h of this.houses) {
      if (h.isPlayer) this.interactables.push({ pos: h.door, radius: 2.2, prompt: 'GO INSIDE', type: 'home' });
      else this.interactables.push({ pos: h.door, radius: 1.9, prompt: 'KNOCK', type: 'knock', house: h });
    }

    const lamps = buildStreetlights(ctx);
    this.streetlights = lamps.lights;
    buildPowerLines(ctx);
    buildSigns(ctx);
    this.park = buildPark(ctx);
    // Park lamps (shorter, cooler).
    for (const [x, z] of [
      [this.park.center.x + 12, this.park.center.z + 12],
      [this.park.center.x - 12, this.park.center.z - 12],
      [this.park.center.x - 1.5, this.park.center.z + 30],
    ]) {
      lamps.place(x, z, 0, 1, 4.2, 10);
    }
    this.store = buildStore(ctx);
    this.waterTower = buildWaterTower(ctx);
    this.radioTower = buildRadioTower(ctx);
    this.corn = buildCorn(ctx);

    // Street-parked cars.
    const rng = new RNG(555);
    for (let i = 0; i < 9; i++) {
      const onMaple = i < 5;
      const t = onMaple ? rng.float(-170, 100) : rng.float(-130, 80);
      if (onMaple && Math.abs(t + 80) < 14) continue;
      if (onMaple && Math.abs(t - 44) < 14) continue;
      if (!onMaple && Math.abs(t) < 14) continue;
      const side = rng.sign();
      const m = onMaple ? new THREE.Matrix4().compose(new THREE.Vector3(t, 0, side * 3.3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? Math.PI / 2 : -Math.PI / 2), new THREE.Vector3(1, 1, 1)) : new THREE.Matrix4().compose(new THREE.Vector3(-80 + side * 3.3, 0, t), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? Math.PI : 0), new THREE.Vector3(1, 1, 1));
      this.cars.push({ matrix: m, seed: rng.next(), collide: true });
    }
    // A car at the pump, one in the lot.
    this.cars.push({ matrix: new THREE.Matrix4().makeTranslation(133.5, 0, -18), seed: 0.31, collide: true });
    this.cars.push({ matrix: new THREE.Matrix4().makeTranslation(156.5, 0, -28.5), seed: 0.77, collide: true });
    for (const c of this.cars) buildCar(batch, c.matrix, c.seed, c.collide ? this.colliders : null);

    scatterTrees(this.trees, this.lots, new RNG(9001));
    const treeInfo = buildTrees(this.trees, ctx);

    const occ = batch.build(this.M, scene, { occluderKeys: ['siding', 'roof', 'brick', 'wood', 'plain', 'flat'] });
    this.occluders = [...occ, ...treeInfo.occluders];

    this.windows.finalize();
    this.pools.finalize();
    this.lamps.finalize();
    scene.add(this.windows.mesh, this.pools.mesh, this.lamps.mesh, this.glows.points);

    this.hills = buildHills(scene);
    this.sky = new Sky(scene, this.T);

    // A few real point lights that follow the nearest lit lamps.
    this.lampLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb060', 0, 24, 1.6);
      scene.add(l);
      this.lampLights.push(l);
    }
    this.canopyLight = new THREE.PointLight('#dfeaff', 0, 26, 1.4);
    this.canopyLight.position.copy(this.store.canopyLight.pos);
    scene.add(this.canopyLight);

    // Moon as a photo subject (position depends on the camera).
    const sky = this.sky;
    this.subjects.push({
      id: 'moon',
      label: 'The Moon',
      category: 'landmark',
      value: 0,
      radius: 18,
      occludable: true,
      getPos: (cam, out) => out.copy(cam.position).addScaledVector(sky.moonDir, 900),
      isActive: () => sky.moonDir.y > 0.02,
    });

    // The mail-order package on the porch.
    const pkg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: '#b08a5a' }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.52), new THREE.MeshLambertMaterial({ color: '#d8c8a0' }));
    tape.position.y = 0.1;
    pkg.add(tape);
    pkg.position.copy(this.playerHouse.porch).add(new THREE.Vector3(0, 0.23, 0));
    pkg.rotation.y = this.playerHouse.facing + 0.4;
    pkg.visible = false;
    scene.add(pkg);
    this.packageMesh = pkg;
    this.packageInteract = { pos: this.playerHouse.porch.clone(), radius: 1.8, prompt: 'PICK UP PACKAGE', type: 'package', disabled: true };
    this.interactables.push(this.packageInteract);
  }

  get spawn() {
    const h = this.playerHouse;
    const dir = new THREE.Vector3(Math.sin(h.facing), 0, Math.cos(h.facing));
    return { pos: h.door.clone().addScaledVector(dir, 2.5), yaw: h.facing + Math.PI };
  }

  setPackage(visible) {
    this.packageMesh.visible = visible;
    this.packageInteract.disabled = !visible;
  }

  surfaceAt(x, z) {
    return surfaceAt(x, z);
  }

  inCorn(x, z) {
    const c = ZONES.corn;
    return x > c[0] + 1 && x < c[2] - 1 && z > c[1] + 1 && z < c[3] - 1 && Math.abs(z - 86) > 2;
  }

  update(dt, time, hour, dayIndex, camera) {
    this.sky.update(hour, dayIndex, camera, dt, time);
    const night = this.sky.night;

    // Distant hills: silhouettes tinted from the sky.
    const hor = this.sky.pal.hor;
    const top = this.sky.pal.top;
    this.hills[0].material.color.copy(hor).lerp(top, 0.35).multiplyScalar(0.62);
    this.hills[1].material.color.copy(hor).lerp(top, 0.5).multiplyScalar(0.42);

    this._lightTimer -= dt;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.25;
      this._updateHouseLights(hour, night, dayIndex);
    }
    this._updateLamps(dt, time, night, camera);
    this._updateTVs(time, hour, night, dayIndex);

    // Tower beacons blink day and night.
    const blinkW = Math.sin(time * Math.PI * 0.9) > 0.2 ? 1 : 0.05;
    this.glows.set(this.waterTower.beacon, blinkW * (0.5 + night * 0.7));
    const blinkR = (time % 1.6) < 0.8 ? 1 : 0.04;
    for (const b of this.radioTower.beacons) this.glows.set(b, blinkR * (0.6 + night * 0.8));
  }

  _awake(h, hour) {
    const t = hour < 5 ? hour + 24 : hour;
    return t >= h.wake && t < h.bed;
  }

  _updateHouseLights(hour, night, dayIndex) {
    const dark = night > 0.3;
    const glass = this._c.copy(DAY_GLASS).multiplyScalar(0.12 + 0.88 * (1 - night));
    for (const h of this.houses) {
      const awake = this._awake(h, hour);
      const home = dark && (awake || h.nightOwl);
      for (const w of h.windows) {
        if (w.tv) continue;
        const r = hash(w.idx, dayIndex);
        const lit = home && (awake ? r < (h.isPlayer ? 0.5 : 0.45) : r < 0.12);
        if (lit) {
          const warm = WARM[Math.floor(w.r * WARM.length)];
          this.windows.set(w.idx, 0, this._tmp().copy(warm).multiplyScalar(0.75 + w.r * 0.5));
        } else this.windows.set(w.idx, 0, glass);
      }
      const porchOn = dark && (awake || hash(h.index, 7) < 0.4 || h.isPlayer);
      this.glows.set(h.porchGlow, porchOn ? 1 : 0);
      this.pools.set(h.porchPool, porchOn ? 0.45 : 0);
      for (const g of h.pumpkinGlows) this.glows.set(g, dark && awake ? 0.8 + Math.random() * 0.3 : 0);
    }
    // Qwik Stop is open 24 hours.
    const sw = this.store.windows;
    for (let i = 0; i < sw.length; i++) {
      const c = this._tmp().set(i === sw.length - 1 ? '#f2f6ff' : '#e6f0ff').multiplyScalar(0.35 + night * 1.1);
      this.windows.set(sw[i], 0, c);
    }
    this.store.signMat.color.setScalar(0.75 + night * 0.5);
    this.store.openSign.color.setScalar(0.6 + night * 0.8);
    this.glows.set(this.store.canopyLight.glow, night);
    this.pools.set(this.store.canopyLight.pools[0], night * 0.6);
    this.canopyLight.intensity = night * 60;
  }

  _tmp() {
    return (this.__tmp ||= new THREE.Color());
  }

  _updateTVs(time, hour, night, dayIndex) {
    if (night < 0.3) {
      for (const h of this.houses) for (const w of h.windows) if (w.tv) this.windows.set(w.idx, 0, this._c.copy(DAY_GLASS).multiplyScalar(0.12 + 0.88 * (1 - night)));
      return;
    }
    for (const h of this.houses) {
      for (const w of h.windows) {
        if (!w.tv) continue;
        const on = this._awake(h, hour) && hash(h.index, dayIndex, 3) < 0.75;
        if (!on) {
          this.windows.set(w.idx, 0, this._c.copy(DAY_GLASS).multiplyScalar(0.12));
          continue;
        }
        const f = 0.45 + 0.35 * Math.sin(time * 7.3 + w.idx) * Math.sin(time * 3.1 + w.idx * 2.0) + (hash(Math.floor(time * 6), w.idx) > 0.85 ? 0.3 : 0);
        this.windows.set(w.idx, 0, this._c.copy(TV).multiplyScalar(clamp(f, 0.15, 1.2)));
      }
    }
  }

  _updateLamps(dt, time, night, camera) {
    const cand = [];
    for (const l of this.streetlights) {
      let on = night > 0.32 + l.phase * 0.15 ? 1 : 0;
      if (on && l.flicker) {
        const f = hash(Math.floor(time * 9), l.phase * 100);
        on = f < 0.12 ? 0.05 : f < 0.2 ? 0.5 : 1;
      }
      // Something overhead is messing with the power.
      const D = this.disturb;
      if (on && D && Math.hypot(l.pos.x - D.x, l.pos.z - D.z) < D.r) {
        const f = hash(Math.floor(time * 14), l.phase * 77);
        on = f < 0.35 ? 0.05 : f < 0.55 ? 0.4 : 1;
      }
      l.on = on;
      this.glows.set(l.glow, on);
      this.pools.set(l.pool, on * 0.55);
      this.lamps.set(l.lamp, on ? 2.2 * on : 0.35);
      if (on > 0.4) cand.push(l);
    }
    // Assign real lights to the nearest lit lamps.
    const cp = camera.position;
    cand.sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
    for (let i = 0; i < this.lampLights.length; i++) {
      const L = this.lampLights[i];
      const l = cand[i];
      if (l && l.pos.distanceTo(cp) < 90) {
        L.position.copy(l.pos);
        L.intensity = 38 * l.on;
      } else L.intensity = 0;
    }
  }
}
