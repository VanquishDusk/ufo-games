// Save-game shape. Everything here is plain JSON; photos live in IndexedDB
// and are referenced by id.
import { kv } from '../core/storage.js';

export const SAVE_KEY = 'skywatch97.save.v1';
export const SETTINGS_KEY = 'skywatch97.settings.v1';

export function defaultSettings() {
  return { sensitivity: 1, invertY: false, resolution: 'retro', wobble: true, volume: 0.8, showHints: true };
}

export function newGameState() {
  return {
    version: 1,
    money: 25,
    day: 0,
    hour: 18.4,
    camera: 'snappy',
    lenses: [],
    gear: { flashlight: false, binoculars: false, tripod: false, stabilizer: false, flash_pro: false, scanner: false, darkroom: false },
    film: { type: 'film_200', remaining: 24 },
    rolls: { film_200: 1, film_800: 0, film_1600: 0 },
    lures: {},
    lure: null,
    flashMode: 'auto',
    deliveries: [], // { itemId, arrive: day }
    porch: [], // itemIds waiting on the porch
    rep: { lenny: 0, probe: 0, vos: 0, kchv: 0 },
    lennyToday: { day: -1, count: 0 },
    bought: {}, // buyerId -> [sightingId]
    soldSightings: [], // sightings sold to anyone (no longer exclusive)
    glut: {}, // kind -> recent sales (each knocks 20% off, recovers daily)
    heat: 0, // 0-100 attention from big sales; high heat brings a raid
    checks: [], // { amount, bounce, day } tabloid checks clearing tomorrow
    jobs: [], // buyer requests, see career.js
    jobSeq: 0,
    log: {}, // field log: kind -> { first, best, count }
    tickDay: 0, // last day the 8 AM morning tick ran
    stats: { photos: 0, sold: 0, earned: 0, anomalySales: 0, nights: 0, steps: 0, jobs: 0, raids: 0 },
    inbox: [
      {
        id: 'welcome',
        day: 0,
        from: 'LENNY <lenny@greyzone.bbs>',
        subject: 'welcome 2 the grey zone',
        body: "hey. glad u finally got a modem.\n\nso u know the stuff ppl keep seeing around Cedar Hollow. lights over the corn behind Birch Ln, that hum at 3am, the thing old man Petrakis swears he saw land in the field west of Oak. NOBODY has a decent picture.\n\nu live right there. get a camera out at night and SHOOT. when u get something, send it thru UFO-NET from ur PC. the tabloids pay, the researchers pay more if its sharp.\n\ni'll buy spooky night shots for my board too. not much $$ but it's something. 3 a day max, my hard drive is like 400 megs.\n\nkeep ur eyes up.\n- L",
        read: false,
      },
      {
        id: 'catalog',
        day: 0,
        from: 'SKYWATCHER SUPPLY CO.',
        subject: 'Your Fall 1997 Catalog',
        body: 'Thank you for joining the Skywatcher Supply Co. mailing list!\n\nBrowse our catalog under MAIL ORDER. Orders placed before midnight arrive on your porch by 8 AM the next morning. Film and flashlights are also sold at most convenience stores.\n\nTIPS FROM THE PROS:\n- Night shots need fast film (800+) or a long exposure.\n- Long exposures need steady hands. Hold SHIFT to steady your breathing, or use a tripod.\n- Flash only reaches a few meters. It will not light up the sky.\n- Zoom magnifies shake. Brace yourself.',
        read: false,
      },
      {
        id: 'sysop',
        day: 0,
        from: 'UFO-NET SYSOP',
        subject: 'New on UFO-NET: Job Board + Field Log',
        body: "Welcome to UFO-NET 2.1!\n\nJOB BOARD: buyers post requests for specific sightings. Sell them a matching photo before the deadline and they add a bonus.\n\nFIELD LOG: tracks every kind of object you've documented. Lenny's board pays a bounty for each new one.\n\nA reminder that your phone line and UFO-NET access are billed weekly, every Sunday.\n\nPlease be discreet. Large sales to the press attract attention, and not all of it is friendly.",
        read: false,
      },
      {
        id: 'probe',
        day: 0,
        from: 'THE WEEKLY PROBE - Photo Desk',
        subject: 'RE: Freelance submissions',
        body: "We pay CASH for genuine photographs of unexplained phenomena.\n\nWe do NOT pay for: lawns, moons, water towers, your cat, or 'a weird cloud'.\n\nIf it's out there, get it on film. Blurry is fine. Fake is not.\n\n- M. Dobbs, Photo Editor",
        read: false,
      },
    ],
    flags: {},
    photoSeq: 0,
  };
}

export function loadState() {
  const s = kv.get(SAVE_KEY);
  if (!s || s.version !== 1) return null;
  const base = newGameState();
  // Shallow-merge so saves from older builds pick up new fields.
  return { ...base, ...s, gear: { ...base.gear, ...s.gear }, rolls: { ...base.rolls, ...s.rolls }, lures: { ...base.lures, ...s.lures }, tickDay: s.tickDay ?? s.day, rep: { ...base.rep, ...s.rep }, stats: { ...base.stats, ...s.stats } };
}

export function saveState(state) {
  kv.set(SAVE_KEY, state);
}

export function clearState() {
  kv.remove(SAVE_KEY);
}

export function loadSettings() {
  return { ...defaultSettings(), ...(kv.get(SETTINGS_KEY) || {}) };
}

export function saveSettings(s) {
  kv.set(SETTINGS_KEY, s);
}
