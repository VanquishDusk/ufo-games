// The player's camera and gear: raising to the eye, zoom, autofocus, hand
// shake, breath-holding, flash, film rolls, tripod, binoculars, flashlight.
// Shooting hands off to Developer (render + VHS) and PhotoAnalyzer (grading).
import * as THREE from 'three';
import { clamp, damp, noise1 } from '../core/rng.js';
import { bus } from '../core/events.js';
import { CAMERAS, FILM, ITEMS } from '../game/items.js';
import { stampDate, stampTime } from '../game/clock.js';

const BASE_FOV = 72;
const PHOTO_FOV = 46; // vertical, at 1x
const BINO_FOV = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(36)) / 7));

export class PhotoCamera {
  constructor({ game, camera, scene, world, player, developer, analyzer }) {
    this.game = game;
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.developer = developer;
    this.analyzer = analyzer;

    this.raised = false;
    this.aimToggle = false;
    this.raiseT = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.focus = 0;
    this.windTimer = 0;
    this.reloadTimer = 0;
    this.flashTimer = 0;
    this.breath = 1;
    this.holdingBreath = false;
    this.gasp = 0;
    this.time = 0;
    this.binoculars = false;
    this.binoT = 0;
    this.tripod = false;
    this.flashlightOn = false;
    this.frameFrac = 0.86;
    this.swayVel = new THREE.Vector2();
    this._prevSway = new THREE.Vector2();
    this.lastShutterEstimate = 1 / 60;

    this.photoCam = new THREE.PerspectiveCamera(PHOTO_FOV, 4 / 3, 0.3, 1600);
    this.photoCam.rotation.order = 'YXZ';

    this.flash = new THREE.PointLight('#f4f6ff', 0, 20, 2);
    scene.add(this.flash);

    this.torch = new THREE.SpotLight('#fff4dc', 0, 38, 0.42, 0.55, 1.6);
    this.torch.position.set(0.2, -0.15, 0);
    this.torch.target.position.set(0.05, -0.1, -5);
    camera.add(this.torch);
    camera.add(this.torch.target);

    this.viewmodel = this._buildViewmodel();
    camera.add(this.viewmodel);
  }

  get state() {
    return this.game.state;
  }

  get spec() {
    return CAMERAS[this.state.camera];
  }

  get maxZoom() {
    let z = this.spec.zoom[1];
    if (this.state.camera === 'slr') {
      for (const id of this.state.lenses) {
        const it = ITEMS.find((i) => i.id === id);
        if (it?.zoom) z = Math.max(z, it.zoom);
      }
    }
    return z;
  }

  get flashRange() {
    return this.state.gear.flash_pro ? 20 : this.spec.flashRange;
  }

  get maxShutter() {
    const base = this.spec.maxShutter;
    if (this.tripod && this.state.camera !== 'snappy') return Math.min(2, base * 4);
    return base;
  }

  get photoFov() {
    return 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(PHOTO_FOV / 2)) / this.zoom));
  }

  get film() {
    return FILM[this.state.film.type];
  }

  _buildViewmodel() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: '#d8d0c0', emissive: '#181818' });
    this.vmMat = mat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.05), mat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.035, 10).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#1a1a1a', emissive: '#0a0a0a' }));
    lens.position.set(0.02, 0, -0.035);
    const flash = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 0.004), new THREE.MeshBasicMaterial({ color: '#cfd8e0' }));
    flash.position.set(-0.045, 0.026, -0.027);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.01), new THREE.MeshLambertMaterial({ color: '#1a1a1a' }));
    strap.position.set(-0.07, -0.08, 0.01);
    // Back of the camera faces us: viewfinder window, LCD counter, shutter.
    const vfw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.004), new THREE.MeshBasicMaterial({ color: '#0e1014' }));
    vfw.position.set(-0.04, 0.022, 0.026);
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.016, 0.004), new THREE.MeshBasicMaterial({ color: '#6a7a52' }));
    lcd.position.set(0.035, 0.018, 0.026);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 8), new THREE.MeshLambertMaterial({ color: '#8a8a8a' }));
    btn.position.set(0.05, 0.046, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.02), new THREE.MeshLambertMaterial({ color: '#202022', emissive: '#080808' }));
    grip.position.set(0.062, -0.002, 0.02);
    g.add(body, lens, flash, strap, vfw, lcd, btn, grip);
    g.scale.setScalar(0.62);
    g.position.set(0.21, -0.19, -0.4);
    g.rotation.set(0.08, -0.3, 0.04);
    return g;
  }

  // Called every frame while playing. Returns movement modifiers for Player.
  update(dt, input) {
    this.time += dt;
    const S = this.state;
    const gear = S.gear;
    this.windTimer = Math.max(0, this.windTimer - dt);
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.flashTimer <= 0) this.flash.intensity = 0;

    // Toggles.
    if (input.pressed('flashlight')) {
      if (gear.flashlight) {
        this.flashlightOn = !this.flashlightOn;
        bus.emit('sfx', 'click');
      } else bus.emit('toast', "You don't have a flashlight. The Qwik Stop sells them.");
    }
    if (input.pressed('binoculars')) {
      if (gear.binoculars) {
        this.binoculars = !this.binoculars;
        if (this.binoculars) {
          this.aimToggle = false;
        }
        bus.emit('sfx', 'cloth');
      } else bus.emit('toast', 'No binoculars yet. Skywatcher Supply sells a 7x50 pair.');
    }
    if (input.pressed('tripod')) {
      if (gear.tripod) {
        this.tripod = !this.tripod;
        this.player.anchored = this.tripod;
        bus.emit('sfx', 'tripod');
        bus.emit('toast', this.tripod ? 'Tripod planted. Rock steady. (T to pack up)' : 'Tripod packed up.');
      } else bus.emit('toast', 'No tripod yet. Order one from the Skywatcher catalog.');
    }
    if (this.tripod && input.moveAxes().y !== 0 && Math.random() < dt * 0.6) bus.emit('hint', 'Press T to pack up the tripod first.');
    if (input.pressed('flashMode')) {
      const order = ['auto', 'on', 'off'];
      S.flashMode = order[(order.indexOf(S.flashMode) + 1) % 3];
      bus.emit('sfx', 'beep');
      bus.emit('toast', `Flash: ${S.flashMode.toUpperCase()}`);
    }
    if (input.pressed('reload')) this.swapRoll(true);

    // Raise / lower.
    if (input.pressed('aimToggle')) this.aimToggle = !this.aimToggle;
    // Tapping SNAP on touch with the camera down raises it first.
    if (input.virtualPressed.has('shoot') && !this.raised && !this.binoculars) this.aimToggle = true;
    const wantRaise = !this.binoculars && (input.mouseDown(2) || this.aimToggle || input.down('aim'));
    if (wantRaise !== this.raised) {
      this.raised = wantRaise;
      bus.emit('sfx', wantRaise ? 'raise' : 'lower');
    }
    this.raiseT = damp(this.raiseT, this.raised ? 1 : 0, 14, dt);
    this.binoT = damp(this.binoT, this.binoculars ? 1 : 0, 12, dt);

    // Zoom.
    const zmax = this.maxZoom;
    const zmin = this.spec.zoom[0];
    if (this.raised && zmax > zmin) {
      let dz = 0;
      if (input.wheel) dz -= input.wheel * 0.18;
      if (input.down('zoomIn')) dz += dt * 1.6;
      if (input.down('zoomOut')) dz -= dt * 1.6;
      if (dz) {
        this.zoomTarget = clamp(this.zoomTarget * Math.exp(dz), zmin, zmax);
        this.focus *= 0.6;
        bus.emit('zoom');
      }
    }
    this.zoomTarget = clamp(this.zoomTarget, zmin, zmax);
    this.zoom = damp(this.zoom, this.zoomTarget, 9, dt);

    // Breath / steadiness.
    this.holdingBreath = this.raised && input.down('sprint') && this.breath > 0.02 && this.gasp <= 0;
    if (this.holdingBreath) {
      this.breath = Math.max(0, this.breath - dt * 0.24);
      if (this.breath <= 0.02) {
        this.gasp = 1.2;
        bus.emit('sfx', 'gasp');
      }
    } else this.breath = Math.min(1, this.breath + dt * 0.16);
    this.gasp = Math.max(0, this.gasp - dt);

    // Hand sway.
    const moving = this.player.speed > 0.4;
    let amp = 0.0017 * Math.pow(this.zoom, 0.85) * this.spec.shake;
    if (gear.stabilizer) amp *= 0.6;
    if (moving) amp *= 2.6;
    if (this.player.crouching) amp *= 0.65;
    if (this.holdingBreath) amp *= 0.22;
    if (this.gasp > 0) amp *= 2;
    if (this.tripod) amp = 0;
    amp *= this.raiseT;
    const t = this.time;
    const sy = (noise1(t * 0.8, 11) * 0.7 + noise1(t * 2.1, 12) * 0.3 + noise1(t * 9, 13) * 0.12) * amp;
    const sp = (noise1(t * 0.7, 21) * 0.7 + noise1(t * 2.4, 22) * 0.3 + noise1(t * 8.5, 23) * 0.12) * amp * 0.8;
    if (dt > 0) this.swayVel.set((sy - this._prevSway.x) / dt, (sp - this._prevSway.y) / dt);
    this._prevSway.set(sy, sp);
    this.player.swayYaw = sy;
    this.player.swayPitch = sp;

    // Autofocus: locks while the view is steady.
    const angSpeed = Math.hypot(this.player.angVel.x + this.swayVel.x, this.player.angVel.y + this.swayVel.y);
    const steadyEnough = angSpeed < 0.5 / Math.sqrt(this.zoom);
    if (this.raised && steadyEnough) this.focus = Math.min(1, this.focus + dt / this.spec.focus);
    else this.focus = Math.max(0, this.focus - dt * (this.raised ? 2.5 : 4));

    // Field of view.
    const aimFov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(this.photoFov / 2)) / this.frameFrac));
    let fov = BASE_FOV + (aimFov - BASE_FOV) * this.raiseT;
    fov = fov + (BINO_FOV - fov) * this.binoT;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Viewmodel drops out of view when raised.
    const vm = this.viewmodel;
    vm.visible = this.raiseT < 0.95 && this.binoT < 0.5;
    vm.position.y = -0.19 - this.raiseT * 0.3 + Math.sin(this.player.bob * 2) * 0.004;
    vm.position.x = 0.21 - this.raiseT * 0.15;
    this.vmMat.color.set(this.spec.color);

    // Flashlight.
    this.powerOut = !!this.game.ufos?.powerOut(this.player.pos);
    this.torch.intensity = this.flashlightOn && !this.powerOut ? 70 : 0;

    // Rough shutter estimate for the viewfinder readout.
    const light = this.world.sky.lightLevel * (this.flashlightOn && !this.powerOut ? 1.4 : 1);
    const needed = 0.16 / Math.max(light, 0.002);
    const want = ((1 / 250) * needed) / (this.film.iso / 400);
    this.lastShutterEstimate = clamp(want, 1 / 1000, this.maxShutter);
    // Expected exposure error in stops (negative = too dark).
    this.evEstimate = Math.log2(((this.lastShutterEstimate * 250) * (this.film.iso / 400)) / needed);
    this.flashWouldFire = this._flashWouldFire();

    // Shoot.
    if (this.raised && (input.mousePressed(0) || input.pressed('shoot'))) this.shoot();

    const zoomedLook = 1 / (1 + (this.zoom - 1) * 0.55 * this.raiseT);
    return {
      lookScale: (this.raised ? 0.7 * zoomedLook : 1) * (this.binoculars ? 0.25 : 1),
      moveScale: this.raised ? 0.5 : this.binoculars ? 0.35 : 1,
      canSprint: !this.raised && !this.binoculars,
    };
  }

  _flashWouldFire() {
    const m = this.state.flashMode;
    if (this.powerOut) return false;
    if (m === 'off') return false;
    if (m === 'on') return true;
    return this.world.sky.lightLevel < 0.03;
  }

  get ready() {
    return this.raiseT > 0.85 && this.windTimer <= 0 && this.reloadTimer <= 0;
  }

  shoot() {
    const S = this.state;
    if (!this.ready) return;
    if (this.powerOut && S.camera !== 'slr') {
      bus.emit('sfx', 'dryfire');
      if (!(this._deadToast > performance.now())) {
        this._deadToast = performance.now() + 4000;
        bus.emit('toast', "Your camera's dead. Not even the battery light. (Only an all-mechanical camera like the K-1 works in here.)");
      }
      return;
    }
    if (S.film.remaining <= 0) {
      bus.emit('sfx', 'dryfire');
      const total = Object.values(S.rolls).reduce((a, b) => a + b, 0);
      bus.emit('toast', total > 0 ? 'Roll finished. Press R to load a new one.' : 'Out of film! Buy more at the Qwik Stop.');
      return;
    }

    const cam = this.camera;
    const pc = this.photoCam;
    cam.updateMatrixWorld();
    pc.position.setFromMatrixPosition(cam.matrixWorld);
    pc.quaternion.setFromRotationMatrix(cam.matrixWorld);
    pc.fov = this.photoFov;
    pc.aspect = 4 / 3;
    pc.near = 0.3;
    pc.far = cam.far;
    pc.updateProjectionMatrix();
    pc.updateMatrixWorld();

    const useFlash = this._flashWouldFire();
    if (useFlash) {
      this.flash.position.copy(pc.position);
      this.flash.distance = this.flashRange * 2.2;
      this.flash.intensity = this.flashRange * this.flashRange * 2.4;
    }
    const vmVis = this.viewmodel.visible;
    this.viewmodel.visible = false;

    const angVel = new THREE.Vector2(this.player.angVel.x + this.swayVel.x, this.player.angVel.y + this.swayVel.y);
    const defocusPx = (1 - this.focus) * 5.5;
    S.photoSeq += 1;
    const frameNo = S.film.exposuresTaken = (S.film.exposuresTaken || 0) + 1;
    const dev = this.developer.develop({
      scene: this.scene,
      camera: pc,
      glows: this.world.glows,
      iso: this.film.iso,
      grain: this.film.grain,
      maxShutter: this.maxShutter,
      angVel,
      linSpeed: this.tripod ? 0 : this.player.speed,
      defocusPx,
      stampLines: [stampTime(S.hour), stampDate(S.day)],
      frameNo,
      seed: S.photoSeq * 7.31 + Math.random() * 100,
    });
    const report = this.analyzer.evaluate(pc, dev, {
      defocusPx,
      lensSharp: this.spec.sharp,
      night: this.world.sky.night > 0.5,
    });
    this.viewmodel.visible = vmVis;

    if (useFlash) this.flashTimer = 0.07;
    else this.flash.intensity = 0;

    S.film.remaining -= 1;
    S.stats.photos += 1;
    this.windTimer = this.spec.wind + (useFlash ? 0.6 : 0);
    this.focus *= 0.5;
    bus.emit('shutter', { flash: useFlash, wind: this.spec.wind });

    const record = {
      id: S.photoSeq,
      day: S.day,
      hour: S.hour,
      film: S.film.type,
      camera: S.camera,
      zoom: +this.zoom.toFixed(2),
      flash: useFlash,
      tripod: this.tripod,
      report,
      sold: null,
    };
    const dataURL = this.developer.toDataURL(0.8);
    this.developer.toBlob(0.82).then((blob) => this.game.onPhoto(record, blob, dataURL));

    if (S.film.remaining <= 0) setTimeout(() => this.swapRoll(false), 900);
  }

  // Load the next roll. manual=true cycles film types and may waste frames.
  swapRoll(manual) {
    const S = this.state;
    const owned = Object.keys(FILM).filter((k) => (S.rolls[k] || 0) > 0);
    if (!owned.length) {
      if (manual) bus.emit('toast', S.film.remaining > 0 ? 'No spare rolls on you.' : 'Out of film! Buy more at the Qwik Stop.');
      else bus.emit('toast', 'Last frame! Out of film.');
      return;
    }
    let next;
    if (manual) {
      const i = owned.indexOf(S.film.type);
      next = owned[(i + 1) % owned.length];
      if (owned.length === 1 && next === S.film.type && S.film.remaining > 0) {
        bus.emit('toast', `Already loaded with ${FILM[next].name}. Finish the roll first.`);
        return;
      }
    } else next = owned.includes(S.film.type) ? S.film.type : owned[0];
    const wasted = S.film.remaining;
    S.rolls[next] -= 1;
    S.film = { type: next, remaining: FILM[next].exposures, exposuresTaken: 0 };
    this.reloadTimer = 2.2;
    bus.emit('sfx', 'reload');
    bus.emit('toast', `Loaded ${FILM[next].name}.${wasted > 0 ? ` (${wasted} unused frames lost)` : ''}`);
  }

  // Hide gear effects (when going inside etc.)
  reset() {
    this.raised = false;
    this.aimToggle = false;
    this.binoculars = false;
    this.raiseT = 0;
    this.binoT = 0;
    if (this.tripod) {
      this.tripod = false;
      this.player.anchored = false;
    }
    this.player.swayYaw = 0;
    this.player.swayPitch = 0;
  }
}
