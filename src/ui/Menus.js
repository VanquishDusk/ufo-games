// Full-screen menus: title, pause/settings, photo album, home, the UFO-NET
// computer (inbox, selling, mail order, stats) and the Qwik Stop counter.
import { BUYERS, appraise } from '../game/economy.js';
import { ITEMS, FILM, CAMERAS, itemById } from '../game/items.js';
import { formatClock, formatDate, stampDate, stampTime } from '../game/clock.js';

// Embedded (iframe) builds can't trigger downloads, so hide "save" there.
const CAN_DOWNLOAD = (() => {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
})();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `$${n.toFixed(2)}`;
const tilt = (id) => `${(((id * 37) % 9) - 4) * 0.6}deg`;

const CONTROLS = [
  ['W A S D', 'Walk'],
  ['SHIFT', 'Sprint / hold breath while aiming'],
  ['SPACE', 'Jump'],
  ['C', 'Crouch (steadier shots)'],
  ['RIGHT MOUSE / Q', 'Raise camera (hold / toggle)'],
  ['LEFT MOUSE', 'Take photo'],
  ['WHEEL or + / -', 'Zoom'],
  ['G', 'Flash mode: auto / on / off'],
  ['R', 'Swap film roll'],
  ['F', 'Flashlight'],
  ['B', 'Binoculars'],
  ['T', 'Plant / pack tripod'],
  ['E', 'Interact'],
  ['TAB or P', 'Photo album'],
  ['L', 'Use a lure (out in the open)'],
  ['H', 'Toggle hints'],
  ['ESC', 'Pause'],
];

const CLERK = [
  "Clerk: 'Gonna be a clear one tonight.'",
  "Clerk: 'You're the kid with the camera, right? My cousin saw something over the corn in '94.'",
  "Clerk: 'Coffee's from this morning. Don't.'",
  "Clerk: 'If you see the lights, don't follow 'em into the field. That's all I'm saying.'",
  "Clerk: 'We get a lot of truckers asking about the radio tower. Weird hum on the CB.'",
  "Clerk: 'Film's on the rack. Batteries are behind the counter.'",
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.el = document.querySelector('#overlay');
    this.screen = null;
    this.data = {};
    this.stack = [];
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('input', (e) => this._input(e));
  }

  get isOpen() {
    return !!this.screen;
  }

  open(screen, data = {}, push = false) {
    if (push && this.screen) this.stack.push({ screen: this.screen, data: this.data });
    else if (!push) this.stack = [];
    this.screen = screen;
    this.data = data;
    this.render();
  }

  close() {
    this.screen = null;
    this.stack = [];
    this.el.className = '';
    this.el.innerHTML = '';
  }

  back() {
    if (this.screen === 'title') return;
    if (this.screen === 'album' && this.data.sel) {
      this.data.sel = null;
      this.render();
      return;
    }
    if (this.screen === 'pc' && this.data.mail) {
      this.data.mail = null;
      this.render();
      return;
    }
    const prev = this.stack.pop();
    if (prev) {
      this.screen = prev.screen;
      this.data = prev.data;
      this.render();
    } else this.game.closeMenus();
  }

  render() {
    const fn = this[`r_${this.screen}`];
    if (!fn) return;
    const html = fn.call(this);
    this.el.className = `on${['title', 'pc'].includes(this.screen) ? ' clear' : ''}`;
    this.el.innerHTML = html;
    const first = this.el.querySelector('.menu-list button');
    if (first && !this.game.input.isTouch) first.focus({ preventScroll: true });
  }

  _click(e) {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    e.preventDefault();
    this.game.audio.unlock();
    this.game.audio.sfx(b.dataset.a === 'back' || b.dataset.a === 'close' ? 'uiBack' : 'ui');
    this.handle(b.dataset.a, b.dataset.v, b);
  }

  _input(e) {
    const t = e.target;
    const s = this.game.settings;
    if (t.dataset.set === 'sensitivity') s.sensitivity = +t.value;
    if (t.dataset.set === 'volume') s.volume = +t.value;
    this.game.applySettings();
  }

  handle(a, v) {
    const G = this.game;
    const S = G.state;
    switch (a) {
      case 'continue':
        G.startPlaying(false);
        break;
      case 'new':
        if (G.hasSave) this.open('confirmNew', {}, true);
        else G.startPlaying(true);
        break;
      case 'confirmNew':
        G.startPlaying(true);
        break;
      case 'controls':
        this.open('controls', {}, true);
        break;
      case 'settings':
        this.open('settings', {}, true);
        break;
      case 'back':
        this.back();
        break;
      case 'close':
      case 'resume':
        G.closeMenus();
        break;
      case 'toTitle':
        G.save();
        G.toTitle();
        break;
      case 'toggle': {
        const s = G.settings;
        if (v === 'invertY') s.invertY = !s.invertY;
        if (v === 'wobble') s.wobble = !s.wobble;
        if (v === 'showHints') s.showHints = !s.showHints;
        if (v === 'resolution') {
          const order = ['crunchy', 'retro', 'sharp'];
          s.resolution = order[(order.indexOf(s.resolution) + 1) % 3];
        }
        G.applySettings();
        this.render();
        break;
      }
      // Album
      case 'album':
        this.open('album', { filter: 'all' }, true);
        break;
      case 'filter':
        this.data.filter = v;
        this.render();
        break;
      case 'view':
        this.data.sel = +v;
        this.render();
        break;
      case 'unview':
        this.data.sel = null;
        this.render();
        break;
      case 'delete': {
        const p = G.photos.find((x) => x.id === +v);
        if (p && this.data.confirmDelete === p.id) {
          G.deletePhoto(p);
          this.data.sel = null;
          this.data.confirmDelete = null;
        } else this.data.confirmDelete = +v;
        this.render();
        break;
      }
      case 'download': {
        const p = G.photos.find((x) => x.id === +v);
        if (p) {
          const link = document.createElement('a');
          link.href = p.url;
          link.download = `skywatch97_no${String(p.id).padStart(3, '0')}.jpg`;
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        break;
      }
      // Home
      case 'pc':
        G.audio.sfx('modem');
        this.open('pc', { tab: 'inbox' }, true);
        break;
      case 'sleepMenu':
        this.data.sleep = !this.data.sleep;
        this.render();
        break;
      case 'sleep':
        G.sleepUntil(+v);
        break;
      case 'save':
        G.save();
        G.hud.toast('Game saved.');
        break;
      case 'leave':
        G.leaveHome();
        break;
      // PC
      case 'tab':
        this.data.tab = v;
        this.data.mail = null;
        this.data.sel = null;
        this.render();
        break;
      case 'mail': {
        this.data.mail = v;
        const m = S.inbox.find((x) => x.id === v);
        if (m) m.read = true;
        this.render();
        break;
      }
      case 'sellSel':
        this.data.sel = +v;
        this.render();
        break;
      case 'sell': {
        const p = G.photos.find((x) => x.id === this.data.sel);
        if (p) G.sellPhoto(p, v);
        this.render();
        break;
      }
      case 'order':
        G.order(v);
        this.render();
        break;
      case 'logoff':
        this.back();
        break;
      // Store
      case 'buy':
        G.buy(v);
        this.render();
        break;
      case 'ok':
        G.closeMenus();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- screens
  r_title() {
    const G = this.game;
    return `<div class="title-screen scan">
      <div class="corner-osd tl osd">PLAY ▶</div>
      <div class="logo">SKYWATCH '97</div>
      <div class="subtitle osd">CEDAR HOLLOW &middot; FALL 1997</div>
      <div class="menu-list osd">
        ${G.hasSave ? '<button data-a="continue">CONTINUE</button>' : ''}
        <button data-a="new">NEW GAME</button>
        <button data-a="controls">CONTROLS</button>
        <button data-a="settings">SETTINGS</button>
      </div>
      <div class="corner-osd br osd">SP 0:00:00</div>
      <div class="title-foot osd">Photograph what nobody else can. Sell it to whoever's buying.</div>
    </div>`;
  }

  r_confirmNew() {
    return `<div class="panel osd"><h2>START OVER?</h2>
      <p>This erases your current save, money, gear and every photo in your album.</p>
      <div class="menu-list"><button data-a="confirmNew">YES, START FRESH</button><button data-a="back">NO, GO BACK</button></div></div>`;
  }

  r_controls() {
    return `<div class="panel osd"><h2>CONTROLS</h2>
      <div class="controls-grid">${CONTROLS.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div>
      <p style="opacity:.8">Night photography: fast film, steady hands, short zoom. Hold SHIFT to steady your breathing, crouch, or plant a tripod. Flash only reaches a few meters.</p>
      <div class="menu-list"><button data-a="back">BACK</button></div></div>`;
  }

  r_settings() {
    const s = this.game.settings;
    const res = { crunchy: 'CRUNCHY (270p)', retro: 'RETRO (360p)', sharp: 'SHARP (540p)' }[s.resolution];
    return `<div class="panel osd"><h2>SETTINGS</h2>
      <div class="setting"><span>MOUSE SENSITIVITY</span><input type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}" data-set="sensitivity"></div>
      <div class="setting"><span>VOLUME</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume"></div>
      <div class="setting"><span>INVERT Y</span><button class="small-btn ghost" data-a="toggle" data-v="invertY">${s.invertY ? 'ON' : 'OFF'}</button></div>
      <div class="setting"><span>RESOLUTION</span><button class="small-btn ghost" data-a="toggle" data-v="resolution">${res}</button></div>
      <div class="setting"><span>VERTEX WOBBLE</span><button class="small-btn ghost" data-a="toggle" data-v="wobble">${s.wobble ? 'ON' : 'OFF'}</button></div>
      <div class="setting"><span>CONTROL HINTS</span><button class="small-btn ghost" data-a="toggle" data-v="showHints">${s.showHints ? 'ON' : 'OFF'}</button></div>
      <div class="menu-list"><button data-a="back">BACK</button></div></div>`;
  }

  r_pause() {
    const S = this.game.state;
    return `<div class="panel osd"><h2>PAUSE ❚❚</h2>
      <div class="sub">${formatDate(S.day)} &middot; ${formatClock(S.hour)} &middot; ${money(S.money)}</div>
      <div class="menu-list">
        <button data-a="resume">RESUME</button>
        <button data-a="album">PHOTO ALBUM</button>
        <button data-a="controls">CONTROLS</button>
        <button data-a="settings">SETTINGS</button>
        <button data-a="toTitle">SAVE &amp; QUIT TO TITLE</button>
      </div></div>`;
  }

  _photoCard(p, action) {
    return `<div class="card ${this.data.sel === p.id ? 'sel' : ''}" style="--r:${tilt(p.id)}" data-a="${action}" data-v="${p.id}">
      <img src="${p.url}" alt="Photo ${p.id}" loading="lazy">
      <div class="cap"><span>No.${String(p.id).padStart(3, '0')}</span><span class="grade g-${p.report.grade}" style="font-size:20px">${p.report.grade}</span></div>
      ${p.sold ? '<div class="stamp">SOLD</div>' : ''}
    </div>`;
  }

  _meter(label, v) {
    return `<div class="meter"><span>${label}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(v * 100)}%"></span></span></div>`;
  }

  _photoInfo(p) {
    const r = p.report;
    const subj = r.subjects.length ? r.subjects.map((s) => `${esc(s.label)}${s.legend ? ' <b style="color:#ffd84a">★ LEGEND</b>' : s.category === 'anomaly' ? ' <b style="color:var(--amber)">★</b>' : ''} <span style="opacity:.6">${Math.round(s.score * 100)}%</span>`).join('<br>') : '<span style="opacity:.6">Nothing identifiable</span>';
    const shutter = r.shutter >= 0.5 ? `${r.shutter.toFixed(1)}s` : `1/${Math.round(1 / r.shutter)}`;
    return `<div style="font-size:30px">No.${String(p.id).padStart(3, '0')} <span class="grade g-${r.grade}">${r.grade}</span></div>
      <div>${stampDate(p.day)} &middot; ${stampTime(p.hour)}</div>
      <div style="opacity:.75">${esc(CAMERAS[p.camera]?.name || p.camera)} &middot; ${esc(FILM[p.film]?.short || '')} &middot; ${shutter}${p.zoom > 1.05 ? ` &middot; ${p.zoom}x` : ''}${p.flash ? ' &middot; FLASH' : ''}${p.tripod ? ' &middot; TRIPOD' : ''}</div>
      <div style="margin:10px 0">${this._meter('SHARPNESS', r.sharpness)}${this._meter('EXPOSURE', r.exposure)}${this._meter('FRAMING', r.composition)}</div>
      <div style="opacity:.8">IN FRAME:</div><div>${subj}</div>
      ${r.notes.length ? `<div style="margin-top:8px;color:var(--amber)">${r.notes.map(esc).join(' &middot; ')}</div>` : ''}
      ${p.sold ? `<div style="margin-top:8px">SOLD to ${esc(BUYERS.find((b) => b.id === p.sold.buyer)?.name || p.sold.buyer)} for ${money(p.sold.price)}</div>` : ''}`;
  }

  r_album() {
    const G = this.game;
    const f = this.data.filter || 'all';
    const list = G.photos.filter((p) => f === 'all' || (f === 'sold' ? p.sold : !p.sold)).slice().reverse();
    const head = `<div class="album-head"><span>PHOTO ALBUM</span><span style="opacity:.6;font-size:22px">${G.photos.length} photos</span>
      <span class="tabs">${['all', 'unsold', 'sold'].map((t) => `<button class="${f === t ? 'on' : ''}" data-a="filter" data-v="${t}">${t.toUpperCase()}</button>`).join(' ')}</span>
      <span class="spacer"></span><button class="small-btn" data-a="back">CLOSE</button></div>`;
    if (this.data.sel) {
      const p = G.photos.find((x) => x.id === this.data.sel);
      if (p) {
        const confirm = this.data.confirmDelete === p.id;
        return `<div class="album">${head}<div class="viewer">
          <div class="big"><img src="${p.url}" alt="Photo ${p.id}"></div>
          <div class="info">${this._photoInfo(p)}
            <div class="btn-row"><button class="small-btn" data-a="unview">BACK</button>${CAN_DOWNLOAD ? `<button class="small-btn ghost" data-a="download" data-v="${p.id}">SAVE JPG</button>` : ''}<button class="small-btn ghost" data-a="delete" data-v="${p.id}">${confirm ? 'REALLY DELETE?' : 'DELETE'}</button></div>
            ${p.sold ? '' : '<div style="margin-top:10px;opacity:.7">Sell photos from the computer at home.</div>'}
          </div></div></div>`;
      }
    }
    const cards = list.length ? list.map((p) => this._photoCard(p, 'view')).join('') : '<div class="empty">No photos yet. Raise your camera with RIGHT MOUSE (or Q) and click to shoot.</div>';
    return `<div class="album">${head}<div class="album-grid">${cards}</div></div>`;
  }

  r_home() {
    const G = this.game;
    const S = G.state;
    const pkg = S.porch.length ? '<p style="color:var(--amber)">There\'s a package waiting on the porch.</p>' : '';
    const pending = S.deliveries.length ? `<p style="opacity:.8">Arriving tomorrow 8 AM: ${S.deliveries.map((d) => esc(itemById(d.itemId)?.name || d.itemId)).join(', ')}</p>` : '';
    const unread = S.inbox.filter((m) => !m.read).length;
    const sleep = this.data.sleep
      ? `<button data-a="sleep" data-v="19">&nbsp;&nbsp;→ UNTIL DUSK (7 PM)</button>
         <button data-a="sleep" data-v="24">&nbsp;&nbsp;→ UNTIL MIDNIGHT</button>
         <button data-a="sleep" data-v="31">&nbsp;&nbsp;→ UNTIL MORNING (7 AM)</button>`
      : '';
    return `<div class="panel osd"><h2>HOME</h2>
      <div class="sub">${G.world.playerHouse.lot.address} Birch Ln &middot; ${formatDate(S.day)} &middot; ${formatClock(S.hour)}</div>
      ${pkg}${pending}
      <div class="menu-list">
        <button data-a="pc">USE COMPUTER${unread ? ` (${unread} NEW)` : ''}</button>
        <button data-a="album">PHOTO ALBUM</button>
        <button data-a="sleepMenu">SLEEP…</button>
        ${sleep}
        <button data-a="save">SAVE GAME</button>
        <button data-a="leave">GO OUTSIDE</button>
      </div></div>`;
  }

  r_pc() {
    const G = this.game;
    const S = G.state;
    const tab = this.data.tab;
    const unread = S.inbox.filter((m) => !m.read).length;
    const nav = [
      ['inbox', `INBOX${unread ? ` (${unread})` : ''}`],
      ['sell', 'SELL PHOTOS'],
      ['shop', 'MAIL ORDER'],
      ['stats', 'MY STATS'],
    ]
      .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`)
      .join('');
    let main = '';
    if (tab === 'inbox') main = this._pcInbox();
    else if (tab === 'sell') main = this._pcSell();
    else if (tab === 'shop') main = this._pcShop();
    else main = this._pcStats();
    return `<div class="desktop"><div class="win">
      <div class="win-title"><span>UFO-NET 2.1 &mdash; Connected at 14,400 bps</span><button data-a="logoff" title="Log off">×</button></div>
      <div class="win-body"><div class="win-nav">${nav}<span style="flex:1"></span><button data-a="logoff">LOG OFF</button></div>
      <div class="win-main">${main}</div></div>
      <div class="win-status"><span>Balance: ${money(S.money)}</span><span>${formatDate(S.day)} ${formatClock(S.hour)}</span></div>
    </div></div>`;
  }

  _pcInbox() {
    const S = this.game.state;
    if (this.data.mail) {
      const m = S.inbox.find((x) => x.id === this.data.mail);
      if (m)
        return `<button class="w95" data-a="tab" data-v="inbox">← Back</button>
        <div style="margin:8px 0"><b>From:</b> ${esc(m.from)}<br><b>Subject:</b> ${esc(m.subject)}<br><b>Date:</b> ${formatDate(m.day)}</div>
        <div class="mail-body">${esc(m.body)}</div>`;
    }
    const list = S.inbox
      .slice()
      .reverse()
      .map((m) => `<div class="mail ${m.read ? '' : 'unread'}" data-a="mail" data-v="${m.id}">${m.read ? '' : '✉ '}${esc(m.from)} &mdash; ${esc(m.subject)}</div>`)
      .join('');
    return `<div style="font-size:24px;margin-bottom:6px">Inbox</div>${list || 'No messages.'}`;
  }

  _pcSell() {
    const G = this.game;
    const S = G.state;
    const unsold = G.photos.filter((p) => !p.sold).slice().reverse();
    if (!unsold.length) return '<div style="font-size:24px">No unsold photos.</div><p>Go out and shoot something. Night is when things happen around here.</p>';
    if (!this.data.sel || !unsold.find((p) => p.id === this.data.sel)) this.data.sel = unsold[0].id;
    const p = unsold.find((x) => x.id === this.data.sel);
    const grid = unsold.map((x) => this._photoCard(x, 'sellSel')).join('');
    const buyers = BUYERS.map((b) => {
      const unlocked = b.unlocked(S);
      if (!unlocked) return `<div class="buyer"><div class="bname">${esc(b.name)}</div><div class="bblurb">${esc(b.lockedText || b.blurb)}</div></div>`;
      const res = appraise(p, b.id, S);
      const right = res.ok ? `<span class="offer">OFFER ${money(res.offer)}</span><button class="w95" data-a="sell" data-v="${b.id}">SELL</button>` : `<span class="decline">${esc(res.reason)}</span>`;
      return `<div class="buyer"><div class="bname">${esc(b.name)}</div><div class="bblurb">${esc(b.blurb)}</div><div class="bres">${right}</div></div>`;
    }).join('');
    const r = p.report;
    return `<div class="sell-layout"><div class="sell-list">${grid}</div>
      <div class="sell-detail"><img src="${p.url}" alt="">
        <div>No.${String(p.id).padStart(3, '0')} &middot; Grade <b>${r.grade}</b> &middot; ${stampDate(p.day)} ${stampTime(p.hour)}</div>
        <div style="color:#555">${r.subjects.map((s) => esc(s.label)).join(', ') || 'Nothing identifiable'}${r.notes.length ? ' &middot; ' + r.notes.map(esc).join(', ') : ''}</div>
        ${buyers}</div></div>`;
  }

  _pcShop() {
    const G = this.game;
    const S = G.state;
    const pending = S.deliveries.map((d) => d.itemId);
    const rows = ITEMS.filter((i) => i.where.includes('mail'))
      .map((it) => {
        let status = '';
        let can = S.money >= it.price;
        if (it.kind === 'camera') {
          const tier = ['snappy', 'zoom90', 'slr'];
          if (tier.indexOf(S.camera) >= tier.indexOf(it.camera)) {
            status = S.camera === it.camera ? 'OWNED' : 'UPGRADED';
            can = false;
          }
        } else if (it.kind === 'lens' || it.kind === 'gear') {
          if (S.lenses.includes(it.id) || S.gear[it.id]) {
            status = 'OWNED';
            can = false;
          }
          if (it.requires && S.camera !== it.requires && !pending.includes(`cam_${it.requires}`)) status = status || 'NEEDS K-1 SLR';
        } else if (it.kind === 'film') {
          status = `HAVE ${S.rolls[it.id] || 0}`;
        } else if (it.kind === 'lure') {
          status = `HAVE ${S.lures[it.id] || 0}`;
        }
        if (pending.includes(it.id) && it.kind !== 'film') {
          status = 'ON ITS WAY';
          can = false;
        }
        return `<div class="cat-item"><div><div>${esc(it.name)} <span style="color:#1b2c6e">${money(it.price)}</span></div><div class="d">${esc(it.desc)}</div></div>
          <div style="text-align:right;white-space:nowrap"><div style="font-size:17px;color:#555">${status}</div><button class="w95" data-a="order" data-v="${it.id}" ${can ? '' : 'disabled'}>ORDER</button></div></div>`;
      })
      .join('');
    const pend = S.deliveries.length ? `<div style="background:#ffffd8;border:1px solid #c8c080;padding:4px 8px;margin-bottom:8px">Arriving tomorrow by 8 AM: ${S.deliveries.map((d) => esc(itemById(d.itemId)?.name || d.itemId)).join(', ')}</div>` : '';
    return `<div style="font-size:26px">SKYWATCHER SUPPLY CO. <span style="font-size:18px;color:#555">Fall '97 catalog &middot; Free overnight delivery</span></div>${pend}${rows}`;
  }

  _pcStats() {
    const G = this.game;
    const S = G.state;
    const best = G.photos.reduce((b, p) => (!b || p.report.quality > b.report.quality ? p : b), null);
    const rep = BUYERS.filter((b) => b.id !== 'gray')
      .map((b) => `<div class="cat-item"><span>${esc(b.name)}</span><span>${'★'.repeat(Math.min(5, Math.ceil((S.rep[b.id] || 0) / 2)))}${'☆'.repeat(5 - Math.min(5, Math.ceil((S.rep[b.id] || 0) / 2)))}</span></div>`)
      .join('');
    return `<div style="font-size:26px">MY STATS</div>
      <div class="cat-item"><span>Days in Cedar Hollow</span><span>${S.day + 1}</span></div>
      <div class="cat-item"><span>Photos taken</span><span>${S.stats.photos}</span></div>
      <div class="cat-item"><span>Photos sold</span><span>${S.stats.sold}</span></div>
      <div class="cat-item"><span>Sightings sold</span><span>${S.stats.anomalySales}</span></div>
      <div class="cat-item"><span>Total earned</span><span>${money(S.stats.earned)}</span></div>
      <div class="cat-item"><span>Best photo</span><span>${best ? `No.${String(best.id).padStart(3, '0')} (${best.report.grade})` : '-'}</span></div>
      <div style="font-size:22px;margin-top:10px">Reputation</div>${rep}`;
  }

  r_store() {
    const G = this.game;
    const S = G.state;
    const line = CLERK[(S.day * 3 + Math.floor(S.hour)) % CLERK.length];
    const rows = ITEMS.filter((i) => i.where.includes('store'))
      .map((it) => {
        const owned = it.kind === 'gear' && S.gear[it.id];
        const extra = it.kind === 'film' ? ` <span style="opacity:.6">(have ${S.rolls[it.id] || 0})</span>` : '';
        return `<div class="row"><div><div>${esc(it.name)}${extra}</div><div class="desc">${esc(it.desc)}</div></div>
          <span class="price">${money(it.price)}</span><button class="small-btn" data-a="buy" data-v="${it.id}" ${owned || S.money < it.price ? 'disabled' : ''}>${owned ? 'OWNED' : 'BUY'}</button></div>`;
      })
      .join('');
    return `<div class="panel osd"><h2>QWIK STOP</h2><div class="sub">OPEN 24 HRS &middot; You have ${money(S.money)}</div>
      <p style="opacity:.85">${esc(line)}</p>${rows}
      <div class="menu-list"><button data-a="close">LEAVE</button></div></div>`;
  }

  r_dialog() {
    return `<div class="panel osd"><h2>${esc(this.data.title || '')}</h2>${(this.data.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}
      <div class="menu-list"><button data-a="ok">OK</button></div></div>`;
  }
}
