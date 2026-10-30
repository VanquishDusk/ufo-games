// On-screen controls for phones/tablets: a move stick on the left, drag
// anywhere else to look, and buttons for the camera and gear.
export class Touch {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.el = document.querySelector('#touch');
    this.lookId = null;
    this.stickId = null;
    this.last = { x: 0, y: 0 };
    this.built = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const el = this.el;
    el.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <button class="tb big" data-act="shoot" style="right:18px;bottom:18px">SNAP</button>
      <button class="tb" data-toggle="aimToggle" style="right:112px;bottom:22px">CAM</button>
      <button class="tb" data-act="interact" style="right:112px;bottom:86px">USE</button>
      <button class="tb" data-act="flashMode" style="right:186px;bottom:22px">FLASH</button>
      <button class="tb" data-hold="zoomIn" style="right:18px;bottom:112px">ZM+</button>
      <button class="tb" data-hold="zoomOut" style="right:18px;bottom:170px">ZM-</button>
      <button class="tb" data-hold="sprint" style="left:28px;bottom:168px">RUN</button>
      <button class="tb" data-act="flashlight" style="left:100px;bottom:168px">TORCH</button>
      <button class="tb" data-act="lure" style="left:172px;bottom:168px">LURE</button>
      <button class="tb" data-act="album" style="right:18px;top:104px">ALBUM</button>
      <button class="tb" data-act="pause" style="right:90px;top:104px">MENU</button>
    `;
    const stick = el.querySelector('.stick');
    const knob = el.querySelector('.knob');
    const R = 52;
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      this._stickMove(t, stick, knob, R);
    });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this.stickId) this._stickMove(t, stick, knob, R);
    });
    const endStick = (e) => {
      for (const t of e.changedTouches)
        if (t.identifier === this.stickId) {
          this.stickId = null;
          this.input.stick.x = 0;
          this.input.stick.y = 0;
          knob.style.transform = '';
        }
    };
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);

    for (const b of el.querySelectorAll('.tb')) {
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.game.audio.unlock();
        if (b.dataset.act) this.input.tapVirtual(b.dataset.act);
        if (b.dataset.hold) this.input.setVirtual(b.dataset.hold, true);
        if (b.dataset.toggle) {
          this.input.tapVirtual(b.dataset.toggle);
        }
        b.classList.add('on');
      });
      const up = (e) => {
        e.preventDefault();
        if (b.dataset.hold) this.input.setVirtual(b.dataset.hold, false);
        if (!b.dataset.toggle) b.classList.remove('on');
      };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    }
    this.camBtn = el.querySelector('[data-toggle="aimToggle"]');

    // Look: any touch on the canvas.
    const canvas = this.game.renderer.domElement;
    canvas.addEventListener(
      'touchstart',
      (e) => {
        this.game.audio.unlock();
        for (const t of e.changedTouches) {
          if (this.lookId === null) {
            this.lookId = t.identifier;
            this.last = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: true },
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.lookId) {
            this.input.addLook((t.clientX - this.last.x) * 1.6, (t.clientY - this.last.y) * 1.6);
            this.last = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: true },
    );
    const endLook = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.lookId) this.lookId = null;
    };
    canvas.addEventListener('touchend', endLook, { passive: true });
    canvas.addEventListener('touchcancel', endLook, { passive: true });
  }

  _stickMove(t, stick, knob, R) {
    const r = stick.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2);
    let dy = t.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.input.stick.x = dx / R;
    this.input.stick.y = -dy / R;
  }

  show(on) {
    if (on) this.build();
    this.el.classList.toggle('on', on);
  }

  update() {
    if (this.camBtn) this.camBtn.classList.toggle('on', this.game.photoCam.aimToggle);
  }
}
