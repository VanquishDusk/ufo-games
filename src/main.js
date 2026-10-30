// SKYWATCH '97 (working title): a 90s suburban UFO photography game.
// This file wires the systems together and runs the main loop.
import './styles.css';
import * as THREE from 'three';
import { Input } from './core/Input.js';
import { PhotoStore } from './core/storage.js';
import { bus } from './core/events.js';
import { hash } from './core/rng.js';
import { RetroPipeline } from './render/RetroPipeline.js';
import { globalUniforms } from './render/materials.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { Developer } from './camera/Developer.js';
import { PhotoAnalyzer } from './camera/PhotoAnalyzer.js';
import { PhotoCamera } from './camera/PhotoCamera.js';
import { Audio } from './audio/Audio.js';
import { HUD } from './ui/HUD.js';
import { Menus } from './ui/Menus.js';
import { Touch } from './ui/Touch.js';
import { newGameState, loadState, saveState, clearState, loadSettings, saveSettings } from './game/state.js';
import { appraise, completeSale } from './game/economy.js';
import { itemById, FILM } from './game/items.js';
import { formatClock, GAME_MINUTES_PER_SECOND } from './game/clock.js';

const RES = { crunchy: 224, retro: 300, sharp: 480 };
const SURNAMES = ['Kowalski', 'Henderson', 'Petrakis', 'Nguyen', 'Delgado', "O'Brien", 'Whitfield', 'Marsh', 'Okafor', 'Lindqvist', 'Brennan', 'Haskell', 'Tanaka', 'Rourke', 'Abernathy', 'Castellano', 'Pruitt', 'Vance'];
const KNOCK_LINES = [
  "{n}: 'Not buying anything, sorry.'",
  "{n}: 'You're the new kid on Birch Lane? Welcome to the neighborhood.'",
  "{n}: 'Our TV goes fuzzy at the same time every night. 3:12 AM. Every single night.'",
  "{n}: 'Lights over the corn? That's the Hendersons' bug zapper. ...Probably.'",
  'No one answers. A small dog loses its mind behind the door.',
  "{n}: 'Our cat won't go outside after dark anymore. Started back in August.'",
  "{n}: 'You ever hear that hum some nights? Like a fridge, but up in the sky?'",
  'Through the door you hear the X-Files theme. Nobody gets up.',
  "{n}: 'Shouldn't you be doing homework?'",
  "{n}: 'Old man Petrakis says something landed in the field west of Oak St. He also says the moon landing was faked.'",
  'Nobody home. There\'s a Blockbuster bag hanging on the doorknob.',
  "{n}: 'If you see a man in a gray suit asking questions, you didn't hear it from me.'",
];
const PAYPHONE = [
  ['You dial the number scratched into the booth: 1-800-555-0147.', "A recording: 'You have reached the Midwest Anomalous Phenomena Hotline. All volunteers are currently... watching. Please hold.'", 'The line clicks dead.'],
  ['You dial home. Busy signal. You live alone.'],
  ['Static. Then, very faintly, a tone: three short, one long. Three short, one long.', 'Then nothing.'],
  ["A man picks up before it even rings. 'Did you see it too?'", 'He hangs up.'],
  ['You call the time-and-temperature line.', "'...the time is... [static] ...the temperature is fifty-one degrees. Clear skies tonight.'"],
];

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.scene.add(this.camera);
    this.pipeline = new RetroPipeline(this.renderer);
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.settings = loadSettings();
    this.debug = new URLSearchParams(location.search).has('debug');

    this.world = new World(this.scene);
    this.player = new Player(this.camera, this.world);
    this.developer = new Developer(this.renderer);
    this.analyzer = new PhotoAnalyzer(this.world);

    const saved = loadState();
    this.hasSave = !!saved;
    this.state = saved || newGameState();

    this.photoCam = new PhotoCamera({ game: this, camera: this.camera, scene: this.scene, world: this.world, player: this.player, developer: this.developer, analyzer: this.analyzer });
    this.hud = new HUD(this);
    this.photoCam.frameFrac = this.hud.frameFrac;
    this.menus = new Menus(this);
    this.touch = new Touch(this);
    this.photoStore = new PhotoStore();
    this.photos = [];

    this.mode = 'title';
    this.time = 0;
    this.last = performance.now();
    this.saveTimer = 60;
    this.needsClick = false;
    this.ignoreEscUntil = 0;
    this.timeScale = 1;
    this.debugOrbs = 0;
    this.fps = 60;

    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'play' && !this.input.dragLook && !this.input.isTouch) {
        this.ignoreEscUntil = performance.now() + 350;
        this.openMenu('pause');
      }
    };
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.mode === 'play' && !this.input.locked) this.input.requestLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.openMenu('pause');
    });
    window.addEventListener('resize', () => this.resize());
    bus.on('step', () => (this.state.stats.steps += 1));

    this.applySettings(false);
    this.resize();
  }

  async init() {
    await this.photoStore.init();
    const rows = await this.photoStore.getAll();
    for (const r of rows) {
      const b = r.blob;
      const url = b instanceof Blob ? URL.createObjectURL(b) : b;
      this.photos.push({ ...r.meta, url, _blob: b });
    }
    try {
      await document.fonts?.load('34px "VT323"');
    } catch {
      /* offline is fine */
    }
    this.world.setPackage(this.state.porch.length > 0);
    this.menus.open('title');
    this.loop();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h);
    this.hud.layout();
  }

  applySettings(persist = true) {
    const s = this.settings;
    this.player.sensitivity = s.sensitivity;
    this.player.invertY = s.invertY;
    this.pipeline.targetHeight = RES[s.resolution] || 300;
    this.pipeline.wobble = s.wobble;
    this.audio.setVolume(s.volume);
    if (this.pipeline.screenW) this.pipeline.setSize(this.pipeline.screenW, this.pipeline.screenH);
    if (persist) saveSettings(s);
  }

  // ------------------------------------------------------------ flow
  startPlaying(fresh) {
    this.audio.unlock();
    if (fresh) {
      clearState();
      this.state = newGameState();
      for (const p of this.photos) if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url);
      this.photos = [];
      this.photoStore.clear();
      this.world.setPackage(false);
    }
    const S = this.state;
    const sp = this.world.spawn;
    if (!fresh && S.pos) this.player.place(new THREE.Vector3(S.pos.x, 0, S.pos.z), S.pos.yaw);
    else this.player.place(sp.pos, sp.yaw);
    this.photoCam.reset();
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.menus.close();
    this.mode = 'play';
    this.hud.show(true);
    this.touch.show(this.input.isTouch);
    this.input.requestLock();
    this.hasSave = true;
    this.save();
    if (fresh) {
      const touch = this.input.isTouch;
      const lines = [
        'Friday, October 3rd, 1997. Cedar Hollow.',
        "People keep seeing things in the sky around here. Nobody's gotten a decent picture.",
        touch ? 'Tap CAM to raise your camera, SNAP to shoot.' : 'Hold RIGHT MOUSE (or press Q) to raise your camera. Click to shoot.',
        'Your computer is inside. Press E at your front door.',
      ];
      lines.forEach((l, i) => setTimeout(() => this.hud.toast(l, 6000), 600 + i * 2600));
    } else this.hud.toast(`Welcome back. ${formatClock(S.hour)}.`);
  }

  toTitle() {
    this.menus.close();
    this.mode = 'title';
    this.hud.show(false);
    this.touch.show(false);
    this.input.releaseLock();
    this.photoCam.reset();
    this.menus.open('title');
  }

  openMenu(name, data = {}) {
    if (this.mode === 'title') return;
    this.mode = 'menu';
    this.input.releaseLock();
    this.hud.setPrompt(null);
    this.touch.show(false);
    this.menus.open(name, data);
  }

  closeMenus() {
    this.menus.close();
    if (this.mode === 'title') return;
    this.mode = 'play';
    this.hud.show(true);
    this.touch.show(this.input.isTouch);
    this.input.requestLock();
  }

  save() {
    const S = this.state;
    S.pos = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
    saveState(S);
  }

  // ------------------------------------------------------------ actions
  onPhoto(record, blob, dataURL) {
    const url = blob ? URL.createObjectURL(blob) : dataURL;
    const photo = { ...record, url, _blob: blob || dataURL };
    this.photos.push(photo);
    this.photoStore.put({ id: record.id, blob: blob || dataURL, meta: record });
    this.hud.showPreview(url, record.report);
    if (this.state.stats.photos === 1) setTimeout(() => this.hud.toast('Saved to your album (TAB). Sell photos from the computer at home.', 6000), 1500);
    this.save();
  }

  _persistPhoto(p) {
    const { url, _blob, ...meta } = p;
    this.photoStore.put({ id: p.id, blob: _blob, meta });
  }

  deletePhoto(p) {
    this.photos = this.photos.filter((x) => x !== p);
    this.photoStore.delete(p.id);
    if (p.url?.startsWith('blob:')) URL.revokeObjectURL(p.url);
  }

  sellPhoto(p, buyerId) {
    const S = this.state;
    const res = appraise(p, buyerId, S);
    if (!res.ok) {
      this.audio.sfx('deny');
      return;
    }
    completeSale(p, buyerId, res.offer, S);
    this._persistPhoto(p);
    this.audio.sfx('cash');
    this.hud.toast(`${res.line}  +$${res.offer}`);
    if (S.stats.sold === 1) {
      S.inbox.push({ id: 'firstsale', day: S.day, from: 'LENNY <lenny@greyzone.bbs>', subject: 'u made the board', body: "ur pic is up on the grey zone. 3 ppl downloaded it already which is a record.\n\nreal talk tho, the real money is a real sighting. the Probe pays HUNDREDS for a saucer pic, and Vos pays even more if its sharp.\n\nnight film. tripod. patience.\n- L", read: false });
    }
    this.save();
  }

  applyItem(id) {
    const S = this.state;
    const it = itemById(id);
    if (!it) return;
    if (it.kind === 'film') S.rolls[id] = (S.rolls[id] || 0) + 1;
    else if (it.kind === 'camera') {
      S.camera = it.camera;
      S.flags[`own_${it.camera}`] = true;
      this.photoCam.zoomTarget = 1;
    } else if (it.kind === 'lens') {
      if (!S.lenses.includes(id)) S.lenses.push(id);
    } else if (it.kind === 'gear') S.gear[id] = true;
  }

  order(id) {
    const S = this.state;
    const it = itemById(id);
    if (!it || S.money < it.price) return;
    S.money -= it.price;
    S.deliveries.push({ itemId: id, arrive: S.day + 1 });
    this.audio.sfx('beep');
    this.hud.toast(`Ordered ${it.name}. Arrives tomorrow by 8 AM.`);
    this.save();
  }

  buy(id) {
    const S = this.state;
    const it = itemById(id);
    if (!it || S.money < it.price) return;
    S.money -= it.price;
    this.applyItem(id);
    this.audio.sfx('cash');
    this.hud.toast(`Bought ${it.name}.`);
    if (it.kind === 'film' && S.film.remaining <= 0) this.photoCam.swapRoll(false);
    this.save();
  }

  checkDeliveries() {
    const S = this.state;
    const arrived = S.deliveries.filter((d) => S.day > d.arrive || (S.day === d.arrive && S.hour >= 8));
    if (!arrived.length) return;
    S.deliveries = S.deliveries.filter((d) => !arrived.includes(d));
    S.porch.push(...arrived.map((d) => d.itemId));
    this.world.setPackage(true);
    if (this.mode === 'play') this.hud.toast('*thump* Something just landed on your porch.');
  }

  pickUpPackage() {
    const S = this.state;
    const names = S.porch.map((id) => itemById(id)?.name || id);
    for (const id of S.porch) this.applyItem(id);
    S.porch = [];
    this.world.setPackage(false);
    this.audio.sfx('package');
    this.hud.toast(`Opened the box: ${names.join(', ')}!`, 6000);
    this.save();
  }

  advanceHours(h) {
    const S = this.state;
    S.hour += h;
    while (S.hour >= 24) {
      S.hour -= 24;
      S.day += 1;
    }
    this.checkDeliveries();
  }

  sleepUntil(target) {
    const S = this.state;
    let t = target;
    if (target === 31) t = S.hour < 7 ? 7 : 31;
    else if (S.hour >= t - 0.01) t += 24;
    const hours = t - S.hour;
    const fade = document.getElementById('fade');
    fade.textContent = 'Zzz…';
    fade.classList.add('on');
    this.mode = 'sleeping';
    setTimeout(() => {
      this.advanceHours(hours);
      S.stats.nights += 1;
      this.save();
      this.menus.open('home');
      this.mode = 'menu';
      fade.classList.remove('on');
      this.hud.toast(`You slept until ${formatClock(S.hour)}.`);
    }, 1400);
  }

  leaveHome() {
    this.audio.sfx('door');
    const sp = this.world.spawn;
    this.player.place(sp.pos, sp.yaw);
    this.closeMenus();
  }

  interact(it) {
    const S = this.state;
    switch (it.type) {
      case 'home':
        this.audio.sfx('door');
        this.photoCam.reset();
        this.save();
        this.openMenu('home');
        break;
      case 'store':
        this.audio.sfx('bell');
        this.openMenu('store');
        break;
      case 'payphone': {
        if (S.money < 0.35) {
          this.hud.toast("You don't have 35 cents.");
          return;
        }
        S.money -= 0.35;
        this.audio.sfx('payphone');
        const lines = PAYPHONE[Math.floor(hash(S.day, Math.floor(S.hour)) * PAYPHONE.length)];
        this.openMenu('dialog', { title: 'PAYPHONE', lines: ['You drop in 35¢.', ...lines] });
        break;
      }
      case 'knock': {
        this.audio.sfx('knock');
        const h = it.house;
        const late = S.hour >= 22.5 || S.hour < 6.5;
        let line;
        if (late) line = hash(h.index, S.day) < 0.5 ? "No answer. It's the middle of the night." : 'A light flicks on upstairs... then off again.';
        else {
          const r = hash(h.index, S.day, 11);
          line = r < 0.3 ? "Nobody's home." : KNOCK_LINES[Math.floor(hash(h.index, S.day, 5) * KNOCK_LINES.length)];
        }
        const name = `${hash(h.index, 2) < 0.5 ? 'Mr.' : 'Mrs.'} ${SURNAMES[h.index % SURNAMES.length]}`;
        setTimeout(() => this.hud.toast(line.replace('{n}', name), 6000), 700);
        break;
      }
      case 'sign':
        this.hud.toast(it.text, 6000);
        break;
      case 'package':
        this.pickUpPackage();
        break;
      default:
        break;
    }
  }

  _findInteractable() {
    const p = this.player.pos;
    const fx = -Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    let best = null;
    let bestD = Infinity;
    for (const it of this.world.interactables) {
      if (it.disabled) continue;
      const dx = it.pos.x - p.x;
      const dz = it.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      const dot = (dx * fx + dz * fz) / Math.max(d, 0.01);
      if (d > 0.8 && dot < 0.25) continue;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ debug
  _debug(input) {
    if (!this.debug) return;
    if (input.keysPressed.has('BracketRight')) this.advanceHours(1);
    if (input.keysPressed.has('BracketLeft')) this.state.hour = (this.state.hour + 23) % 24;
    if (input.keysPressed.has('Backslash')) this.timeScale = this.timeScale > 1 ? 1 : 30;
    if (input.keysPressed.has('F10')) this.state.money += 500;
    if (input.keysPressed.has('F9')) {
      // A stand-in "anomaly" to test photo grading and selling end to end.
      const f = this.player.forward;
      const pos = this.camera.position.clone().add(new THREE.Vector3(f.x, 0, f.z).normalize().multiplyScalar(45));
      pos.y = 22;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshBasicMaterial({ color: '#a8ffe8' }));
      orb.position.copy(pos);
      this.scene.add(orb);
      const g = this.world.glows.add(pos, '#7affd8', 9);
      this.world.glows.set(g, 1.4);
      this.debugOrbs += 1;
      this.world.subjects.push({ id: `debug-orb-${this.debugOrbs}`, label: 'TEST ORB (debug)', category: 'anomaly', value: 60, sightingId: `debug-${this.state.day}-${this.debugOrbs}`, radius: 2.2, pos, selfLuminous: true });
      this.hud.toast('[debug] Test orb spawned.');
    }
  }

  // ------------------------------------------------------------ loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    globalUniforms.uTime.value = this.time;
    const input = this.input;
    const S = this.state;

    if (this.mode === 'play') {
      this.advanceHours((dt * GAME_MINUTES_PER_SECOND * this.timeScale) / 60);
      this._debug(input);
      const mods = this.photoCam.update(dt, input);
      this.player.update(dt, input, mods);

      const it = this._findInteractable();
      this.hud.setPrompt(it ? it.prompt : null);
      if (it && input.pressed('interact')) this.interact(it);

      if (input.pressed('album')) this.openMenu('album', { filter: 'all' });
      else if (input.pressed('pause') && performance.now() > this.ignoreEscUntil) this.openMenu('pause');
      if (input.pressed('help')) {
        this.settings.showHints = !this.settings.showHints;
        saveSettings(this.settings);
      }
      this.needsClick = !input.lookActive;

      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = 60;
        this.save();
      }
      this._hints();
    } else if (this.mode === 'menu') {
      if (performance.now() > this.ignoreEscUntil && input.pressed('pause')) this.menus.back();
      else if (input.pressed('album') && this.menus.screen === 'album') this.closeMenus();
    } else if (this.mode === 'title') {
      // Slow drifting shot of home from across the street, at dusk.
      const h = this.world.playerHouse;
      const c = h.door.clone();
      const dx = Math.sin(h.facing);
      const dz = Math.cos(h.facing);
      const sway = Math.sin(this.time * 0.07) * 6;
      this.camera.position.set(c.x + dx * 19 - dz * sway, 3.2 + Math.sin(this.time * 0.11) * 0.4, c.z + dz * 19 + dx * sway);
      this.camera.lookAt(c.x - dz * sway * 0.3, 4.2, c.z + dx * sway * 0.3);
      this.photoCam.viewmodel.visible = false;
      if (this.camera.fov !== 60) {
        this.camera.fov = 60;
        this.camera.updateProjectionMatrix();
      }
    }

    const hour = this.mode === 'title' ? 19.15 : S.hour;
    const day = this.mode === 'title' ? 0 : S.day;
    this.world.update(dt, this.time, hour, day, this.camera);
    this.world.glows.setScale(this.pipeline.height, this.camera.fov);
    this.pipeline.material.uniforms.fade.value = 1;
    this.pipeline.render(this.scene, this.camera);

    if (this.mode === 'play') this.hud.update(dt);
    this.touch.update();
    this.audio.update(dt, this.mode === 'title' ? 0.6 : this.world.sky.night, this.mode === 'menu' || this.mode === 'sleeping', this.player.pos);
    input.endFrame();
  }

  _hints() {
    if (!this.settings.showHints || this.input.isTouch) {
      this.hud.setHints(this.debug ? this._debugLine() : '');
      return;
    }
    const pc = this.photoCam;
    let h;
    if (pc.raised) h = `<kbd>LMB</kbd> SNAP &nbsp; <kbd>WHEEL</kbd> ZOOM &nbsp; <kbd>SHIFT</kbd> HOLD BREATH &nbsp; <kbd>C</kbd> CROUCH &nbsp; <kbd>G</kbd> FLASH`;
    else h = `<kbd>RMB</kbd>/<kbd>Q</kbd> RAISE CAMERA &nbsp; <kbd>E</kbd> INTERACT &nbsp; <kbd>TAB</kbd> ALBUM &nbsp; <kbd>R</kbd> FILM &nbsp; <kbd>H</kbd> HIDE HINTS`;
    this.hud.setHints(this.debug ? `${h}<br>${this._debugLine()}` : h);
  }

  _debugLine() {
    const p = this.player.pos;
    return `[debug] ${Math.round(this.fps)} fps &middot; ${p.x.toFixed(0)}, ${p.z.toFixed(0)} &middot; [ ] hour &middot; \\ fast &middot; F9 orb &middot; F10 $$$`;
  }
}

// Let the "loading" card paint before the town is built.
requestAnimationFrame(() =>
  setTimeout(async () => {
    const game = new Game();
    window.__game = game;
    await game.init();
    const fade = document.getElementById('fade');
    fade.classList.remove('on');
    setTimeout(() => (fade.textContent = ''), 700);
  }, 30),
);
