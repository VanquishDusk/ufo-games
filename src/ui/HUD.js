// In-world HUD: clock, money, film, gear chips, prompts, toasts, the camera
// viewfinder OSD, binocular mask, flash pop and the photo preview card.
import { bus } from '../core/events.js';
import { formatClock, formatDate, stampDate, stampTime } from '../game/clock.js';
import { FILM } from '../game/items.js';

const $ = (s) => document.querySelector(s);

function shutterLabel(s) {
  if (s >= 0.5) return `${Math.round(s * 10) / 10}s`;
  return `1/${Math.round(1 / s)}`;
}

function bar(v, n = 8) {
  const k = Math.round(Math.max(0, Math.min(1, v)) * n);
  return '▮'.repeat(k) + '▯'.repeat(n - k);
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('#hud');
    this.timeEl = $('#clock .time');
    this.dateEl = $('#clock .date');
    this.moneyEl = $('#status .money');
    this.filmEl = $('#status .film');
    this.gearEl = $('#status .gear');
    this.promptEl = $('#prompt');
    this.toastsEl = $('#toasts');
    this.hintsEl = $('#hints');
    this.crossEl = $('#crosshair');
    this.resumeEl = $('#clickResume');
    this.vf = $('#viewfinder');
    this.frame = $('#viewfinder .frame');
    this.af = $('#viewfinder .af');
    this.vfTL = $('.vf-tl');
    this.vfTR = $('.vf-tr');
    this.vfBL = $('.vf-bl');
    this.vfBR = $('.vf-br');
    this.vfBC = $('.vf-bc');
    this.vfC = $('.vf-c');
    this.bino = $('#binoculars');
    this.flashEl = $('#flash');
    this.preview = $('#preview');
    this._last = {};
    this._previewTimer = 0;

    bus.on('toast', (m) => this.toast(m));
    bus.on('hint', (m) => this.toast(m, 2500));
    bus.on('shutter', ({ flash }) => this.flashPop(flash));
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  // Size the 4:3 viewfinder; the camera FOV is matched to it.
  layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let fh = H * 0.86;
    let fw = (fh * 4) / 3;
    if (fw > W * 0.94) {
      fw = W * 0.94;
      fh = (fw * 3) / 4;
    }
    this.frame.style.width = `${fw}px`;
    this.frame.style.height = `${fh}px`;
    this.frameFrac = fh / H;
    if (this.game.photoCam) this.game.photoCam.frameFrac = this.frameFrac;
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
    if (!on) {
      this.vf.classList.remove('on');
      this.bino.classList.remove('on');
    }
  }

  _set(el, key, html) {
    if (this._last[key] !== html) {
      this._last[key] = html;
      el.innerHTML = html;
    }
  }

  update(dt) {
    const g = this.game;
    const S = g.state;
    const pc = g.photoCam;
    this._set(this.timeEl, 'time', formatClock(S.hour));
    this._set(this.dateEl, 'date', formatDate(S.day));
    this._set(this.moneyEl, 'money', `$${S.money.toFixed(2)}`);
    const spare = Object.values(S.rolls).reduce((a, b) => a + b, 0);
    const film = FILM[S.film.type];
    const filmTxt = `FILM <span class="${S.film.remaining <= 3 ? 'warn' : ''}">${S.film.remaining}</span> &middot; ${film.short}${spare ? ` &middot; +${spare} ROLL${spare > 1 ? 'S' : ''}` : ''}`;
    this._set(this.filmEl, 'film', filmTxt);
    const chips = [];
    if (S.gear.flashlight) chips.push(`<span class="chip ${pc.flashlightOn ? '' : 'off'}">F TORCH</span>`);
    if (S.gear.binoculars) chips.push(`<span class="chip ${pc.binoculars ? '' : 'off'}">B BINO</span>`);
    if (S.gear.tripod) chips.push(`<span class="chip ${pc.tripod ? '' : 'off'}">T TRIPOD</span>`);
    chips.push(`<span class="chip">G FLASH ${S.flashMode.toUpperCase()}</span>`);
    const lures = (S.lures?.lure_mirror || 0) + (S.lures?.lure_flares || 0);
    if (lures || S.lure) chips.push(`<span class="chip ${S.lure ? '' : 'off'}">L LURE${S.lure ? ' ACTIVE' : ` x${lures}`}</span>`);
    this._set(this.gearEl, 'gear', chips.join(''));

    const aiming = pc.raiseT > 0.5;
    this.el.classList.toggle('aiming', aiming || pc.binoT > 0.5);
    this.vf.classList.toggle('on', pc.raiseT > 0.6);
    this.bino.classList.toggle('on', pc.binoT > 0.5);
    this.crossEl.style.display = aiming || pc.binoT > 0.5 ? 'none' : 'block';
    this.resumeEl.style.display = g.needsClick ? 'block' : 'none';

    if (pc.raiseT > 0.3) this._updateViewfinder();

    if (this._previewTimer > 0) {
      this._previewTimer -= dt;
      if (this._previewTimer <= 0) this.preview.classList.remove('on');
    }
  }

  _updateViewfinder() {
    const g = this.game;
    const S = g.state;
    const pc = g.photoCam;
    const film = FILM[S.film.type];
    const flash = pc.flashWouldFire ? `<span class="warn">⚡${S.flashMode.toUpperCase()}</span>` : `<span style="opacity:.5">⚡OFF</span>`;
    const ev = Math.max(-5, Math.min(2, Math.round(pc.evEstimate || 0)));
    const evTxt = ev <= -1 ? `<span class="${ev <= -2 ? 'warn' : ''}">EV ${ev} ${'\u25BC'.repeat(Math.min(3, -ev))}</span>` : ev >= 1 ? `<span class="warn">EV +${ev} \u25B2</span>` : 'EV 0';
    this._set(this.vfTL, 'vftl', `${flash}<br>${film.short} &nbsp;${shutterLabel(pc.lastShutterEstimate)}<br>${evTxt}`);
    const low = S.film.remaining <= 3;
    this._set(this.vfTR, 'vftr', `<span class="${low ? 'warn blink' : ''}">${String(S.film.remaining).padStart(2, '0')}</span> EXP<br>${pc.tripod ? '<span class="warn">TRIPOD</span>' : pc.spec.short}`);
    this._set(this.vfBL, 'vfbl', `${stampTime(S.hour)}<br>${stampDate(S.day)}`);
    const zmax = pc.maxZoom;
    const zoomTxt = zmax > 1 ? `W <span class="bar">${bar((pc.zoom - 1) / (zmax - 1), 10)}</span> T &nbsp;${pc.zoom.toFixed(1)}x` : '';
    this._set(this.vfBC, 'vfbc', zoomTxt);
    const steady = pc.tripod ? '' : `STEADY <span class="bar ${pc.gasp > 0 ? 'warn' : ''}">${bar(pc.breath, 6)}</span>${pc.holdingBreath ? ' <span class="warn">HOLD</span>' : ''}`;
    this._set(this.vfBR, 'vfbr', steady);
    let c = '';
    if (pc.reloadTimer > 0) c = '<span class="warn blink">LOADING FILM</span>';
    else if (S.film.remaining <= 0) c = '<span class="rec blink">NO FILM</span>';
    else if (pc.windTimer > 0) c = '<span style="opacity:.7">WINDING</span>';
    else if (pc.lastShutterEstimate > 1 / 25 && !pc.tripod) c = '<span class="warn">SLOW SHUTTER &middot; HOLD STEADY</span>';
    else if ((pc.evEstimate || 0) <= -2.5) c = '<span class="warn">TOO DARK &middot; FASTER FILM?</span>';
    this._set(this.vfC, 'vfc', c);
    const locked = pc.focus > 0.92;
    this.af.classList.toggle('locked', locked);
  }

  setPrompt(text) {
    if (text) {
      this._set(this.promptEl, 'prompt', `<b>${this.game.input.isTouch ? 'USE' : 'E'}</b>${text}`);
      this.promptEl.style.display = 'block';
    } else this.promptEl.style.display = 'none';
  }

  setHints(html) {
    this._set(this.hintsEl, 'hints', html || '');
  }

  toast(msg, ms = 4200) {
    const d = document.createElement('div');
    d.className = 'toast osd';
    d.textContent = msg;
    this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
    setTimeout(() => d.classList.add('out'), ms);
    setTimeout(() => d.remove(), ms + 700);
  }

  flashPop(flash) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.opacity = flash ? '0.95' : '0.25';
    el.style.background = flash ? '#fff' : '#000';
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${flash ? 0.35 : 0.12}s ease-out`;
      el.style.opacity = '0';
    });
  }

  showPreview(url, report) {
    this.preview.querySelector('img').src = url;
    const subj = report.subjects.find((s) => s.category === 'anomaly') || report.subjects[0];
    const txt = subj ? subj.label : report.notes[0] || 'Nothing unusual';
    this.preview.querySelector('.txt').textContent = txt;
    const gEl = this.preview.querySelector('.grade');
    gEl.textContent = report.grade;
    gEl.className = `grade g-${report.grade}`;
    this.preview.classList.add('on');
    this._previewTimer = 3.2;
  }
}
