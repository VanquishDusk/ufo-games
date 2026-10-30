// Keyboard / mouse / touch input with a small action-binding layer.
// Desktop uses pointer lock; if the browser refuses it (e.g. a sandboxed
// iframe) we fall back to click-and-drag look so the game is still playable.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['KeyC'],
  interact: ['KeyE'],
  aimToggle: ['KeyQ'],
  flashMode: ['KeyG'],
  flashlight: ['KeyF'],
  binoculars: ['KeyB'],
  tripod: ['KeyT'],
  reload: ['KeyR'],
  album: ['Tab', 'KeyP'],
  pause: ['Escape'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  help: ['KeyH'],
};

const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.keysPressed = new Set();
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.virtual = new Set();
    this.virtualPressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.stick = { x: 0, y: 0 };
    this.locked = false;
    this.dragLook = false;
    this.isTouch = false;
    this.enabled = true;
    this._drag = null;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.virtual.clear();
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (this.dragLook) {
        this._drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
        if (e.button === 2) {
          this.buttons.add(2);
          this.buttonsPressed.add(2);
        }
        return;
      }
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.dragLook && this._drag) {
        // A short click (no drag) counts as a press of that button.
        if (this._drag.moved < 6 && e.button === 0) this.buttonsPressed.add(0);
        this._drag = null;
      }
      this.buttons.delete(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        // Some browsers emit huge spikes on lock; clamp them away.
        this.dx += Math.max(-250, Math.min(250, e.movementX || 0));
        this.dy += Math.max(-250, Math.min(250, e.movementY || 0));
      } else if (this.dragLook && this._drag) {
        const mx = e.movementX || 0;
        const my = e.movementY || 0;
        this._drag.moved += Math.abs(mx) + Math.abs(my);
        this.dx += mx;
        this.dy += my;
      }
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) this.everLocked = true;
      if (!this.locked) this.buttons.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // A refusal before we ever locked means the page can't lock (sandboxed
      // iframe). Later errors are usually just the re-lock cooldown.
      if (!this.everLocked) this.dragLook = true;
    });

    window.addEventListener(
      'touchstart',
      () => {
        this.isTouch = true;
      },
      { once: true, passive: true },
    );
  }

  requestLock() {
    if (this.isTouch || this.dragLook) return;
    if (!this.el.requestPointerLock) {
      this.dragLook = true;
      return;
    }
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) {
        p.catch(() => {
          if (!this.everLocked) this.dragLook = true;
        });
      }
    } catch {
      this.dragLook = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // True when look input can be read (locked pointer, drag-look, or touch).
  get lookActive() {
    return this.locked || this.dragLook || this.isTouch;
  }

  down(action) {
    if (this.virtual.has(action)) return true;
    const codes = BINDINGS[action];
    return codes ? codes.some((c) => this.keys.has(c)) : false;
  }

  pressed(action) {
    if (this.virtualPressed.has(action)) return true;
    const codes = BINDINGS[action];
    return codes ? codes.some((c) => this.keysPressed.has(c)) : false;
  }

  mouseDown(b) {
    return this.buttons.has(b);
  }

  mousePressed(b) {
    return this.buttonsPressed.has(b);
  }

  // Touch UI hooks.
  setVirtual(action, isDown) {
    if (isDown) {
      if (!this.virtual.has(action)) this.virtualPressed.add(action);
      this.virtual.add(action);
    } else {
      this.virtual.delete(action);
    }
  }

  tapVirtual(action) {
    this.virtualPressed.add(action);
  }

  addLook(dx, dy) {
    this.dx += dx;
    this.dy += dy;
  }

  // Movement axes in [-1,1]; x = strafe right, y = forward.
  moveAxes() {
    let x = 0;
    let y = 0;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  endFrame() {
    this.keysPressed.clear();
    this.buttonsPressed.clear();
    this.virtualPressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
