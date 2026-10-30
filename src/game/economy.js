// Who buys photos and what they pay. Prices are driven by the photo report
// from PhotoAnalyzer: subjects in frame (category 'anomaly' is where the real
// money is), sharpness, exposure and composition.
//
// The market pushes back: selling lots of one kind floods it (prices recover
// day by day), a sighting already sold elsewhere isn't exclusive any more,
// and the buyers who pay the most are the ones that attract attention.
import { matchJob, heatFor, bounceChance } from './career.js';

export const BUYERS = [
  {
    id: 'lenny',
    name: 'Lenny @ The Grey Zone BBS',
    blurb: 'Runs a dial-up board for "experiencers". Pays peanuts, buys anything spooky. 3 a day.',
    unlocked: () => true,
  },
  {
    id: 'probe',
    name: 'The Weekly Probe',
    blurb: 'Supermarket tabloid. Blurry is fine. Pays by check, and their checks sometimes bounce.',
    unlocked: () => true,
  },
  {
    id: 'vos',
    name: 'Dr. Ingrid Vos',
    blurb: 'Independent researcher. Only wants sharp, well-exposed evidence. Keeps everything quiet.',
    unlocked: () => true,
  },
  {
    id: 'kchv',
    name: 'KCHV Channel 7 News',
    blurb: 'Local news desk. Pays big for a crystal-clear shot, but everyone sees it on air.',
    unlocked: (s) => s.stats.anomalySales >= 3,
    lockedText: 'Sell 3 sightings to get their attention.',
  },
  {
    id: 'gray',
    name: 'M. Gray',
    blurb: 'No address. No phone number. Only interested in the legends, and pays like it. Other people notice.',
    unlocked: (s) => !!s.flags.legendShot,
    lockedText: '??? [ NO CARRIER ] Someone is watching your submissions.',
  },
];

// Buyers' tastes: the tabloid loves saucers, Vos wants the strange stuff,
// the news desk likes something they can see in daylight.
const KIND_MULT = {
  probe: { saucer: 1.3, cigar: 0.9, triangle: 1.0, sphere: 1.1, vee: 1.2, dots: 0.8, k1947: 1.0, phoenix: 1.2, orbs: 0.8, star: 0.7, tictac: 1.2, ring: 1.2, cloudship: 1.3, beam: 1.5, crop: 1.4, ghost: 0.9, fireball: 1.2, cube: 0.9, hunter: 1.5, egg: 1.3, diamond: 1.4 },
  vos: { saucer: 1.0, cigar: 1.2, triangle: 1.35, sphere: 1.4, vee: 1.2, dots: 0.9, k1947: 1.4, phoenix: 1.1, orbs: 0.8, star: 0.9, tictac: 1.4, ring: 1.1, cloudship: 1.3, beam: 1.1, crop: 1.2, ghost: 1.2, fireball: 1.3, cube: 1.5, hunter: 1.1, egg: 1.4, diamond: 1.2 },
  kchv: { saucer: 1.0, cigar: 1.25, triangle: 0.9, sphere: 1.3, vee: 1.0, dots: 0.6, k1947: 1.0, phoenix: 1.5, orbs: 0.9, star: 0.5, tictac: 1.3, ring: 1.0, cloudship: 1.6, beam: 1.2, crop: 1.5, ghost: 0.8, fireball: 1.1, cube: 1.0, hunter: 1.4, egg: 1.6, diamond: 1.5 },
};

const repMult = (state, id) => 1 + Math.min(10, state.rep[id] || 0) * 0.05;

// Market flooded with one kind of photo: each recent sale knocks 20% off.
export const glutMult = (state, kind) => Math.pow(0.8, state.glut?.[kind] || 0);

// Value of the anomalies in a photo, with repeat sightings discounted.
function anomalyValue(report, state, buyerId, legendsOnly = false) {
  const seen = new Set(state.bought[buyerId] || []);
  const elsewhere = new Set(state.soldSightings || []);
  let v = 0;
  for (const s of report.subjects) {
    if (s.category !== 'anomaly') continue;
    if (legendsOnly && !s.legend) continue;
    const repeat = s.sightingId && seen.has(s.sightingId);
    const scooped = !repeat && s.sightingId && elsewhere.has(s.sightingId);
    v += s.value * s.score * (repeat ? 0.35 : scooped ? 0.45 : 1) * (KIND_MULT[buyerId]?.[s.kind] ?? 1) * glutMult(state, s.kind);
  }
  return v * (state.gear?.darkroom ? 1.2 : 1);
}

// Why is this photo worth less than it could be? (Shown under the offers.)
export function marketNotes(photo, state) {
  const notes = [];
  const elsewhere = new Set(state.soldSightings || []);
  for (const s of photo.report.subjects) {
    if (s.category !== 'anomaly') continue;
    const g = glutMult(state, s.kind);
    if (g < 0.97) notes.push(`Market flooded with ${s.label.toLowerCase()} photos (-${Math.round((1 - g) * 100)}%)`);
    if (s.sightingId && elsewhere.has(s.sightingId)) notes.push('This sighting was already sold: not exclusive');
  }
  return [...new Set(notes)];
}

// Wrap a buyer's offer with job bonus and risk.
function deal(photo, buyerId, state, offer, line) {
  const job = matchJob(photo, buyerId, state);
  const total = offer + (job ? job.reward : 0);
  const heat = heatFor(buyerId, total);
  const check = buyerId === 'probe';
  return { ok: true, offer: total, base: offer, job, heat, check, bounce: check ? bounceChance(total) : 0, line };
}

export function appraise(photo, buyerId, state) {
  const r = photo.report;
  const buyer = BUYERS.find((b) => b.id === buyerId);
  if (!buyer) return { ok: false, reason: 'Unknown buyer.' };
  if (!buyer.unlocked(state)) return { ok: false, reason: buyer.lockedText || 'Not interested.' };
  if (photo.sold) return { ok: false, reason: 'Already sold.' };
  const av = anomalyValue(r, state, buyerId);
  const hasAnomaly = av > 0.5;

  if (buyerId === 'gray') {
    const lv = anomalyValue(r, state, 'gray', true);
    if (lv < 0.5) return { ok: false, reason: "M. Gray: 'Not that one.'" };
    return deal(photo, 'gray', state, Math.round(lv * 2.2), 'An envelope of cash appears in your mailbox. Nobody saw who left it.');
  }

  if (buyerId === 'lenny') {
    if (hasAnomaly) return { ok: true, offer: Math.max(3, Math.round(av * 0.25 * repMult(state, 'lenny'))), heat: 0, line: "Lenny: 'DUDE. Okay. Okay okay okay. I'll scrape together what I can.'" };
    const today = state.lennyToday.day === state.day ? state.lennyToday.count : 0;
    if (today >= 3) return { ok: false, reason: "Lenny: 'my hard drive is FULL man. try tomorrow.'" };
    if (r.quality < 0.2) return { ok: false, reason: "Lenny: 'i literally cannot tell what this is. and not in the good way.'" };
    const spooky = (r.night ? 1 : 0) + (r.subjects.some((s) => s.category === 'landmark') ? 1 : 0);
    const offer = Math.max(1, Math.round((1 + spooky) * (0.5 + r.quality)));
    const lines = ["Lenny: 'creepy. i dig it. ur on the front page of the board.'", "Lenny: 'not a ufo but the vibes are there.'", "Lenny: 'nice. uploading at 2.4 kb/s, see u in an hour.'"];
    return { ok: true, offer, heat: 0, line: lines[photo.id % lines.length] };
  }

  if (!hasAnomaly) {
    const no = {
      probe: "Probe photo desk: 'Where's the saucer? We don't print lawns.'",
      vos: "Dr. Vos: 'I see nothing anomalous in this image. Please don't waste my time.'",
      kchv: "KCHV: 'We can't air a picture of nothing, kid.'",
    };
    return { ok: false, reason: no[buyerId] || 'Not interested.' };
  }

  if (buyerId === 'probe') {
    const k = 0.75 + 0.25 * r.sharpness;
    return deal(photo, 'probe', state, Math.round(av * k * 0.55 * repMult(state, 'probe')), "Probe: 'LOVE IT. Page 6. Check's in the mail.'");
  }
  if (buyerId === 'vos') {
    if (r.quality < 0.6) return { ok: false, reason: "Dr. Vos: 'Too blurry or too dark to be evidence. Get closer, hold still.'" };
    return deal(photo, 'vos', state, Math.round(av * 0.9 * repMult(state, 'vos')), "Dr. Vos: 'Remarkable. This goes in the file. Nobody else will see it.'");
  }
  if (buyerId === 'kchv') {
    if (r.quality < 0.78) return { ok: false, reason: "KCHV: 'Not broadcast quality. We need it crisp.'" };
    return deal(photo, 'kchv', state, Math.round(av * 1.5 * repMult(state, 'kchv')), "KCHV: 'We're leading with this at six!'");
  }
  return { ok: false, reason: 'No response.' };
}

export function completeSale(photo, buyerId, res, state) {
  const offer = res.offer;
  photo.sold = { buyer: buyerId, price: offer, day: state.day, check: !!res.check };
  if (res.check) {
    // Tabloid pays by check: clears (or bounces) tomorrow morning.
    state.checks = [...(state.checks || []), { amount: offer, bounce: res.bounce, day: state.day + 1 }];
  } else {
    state.money += offer;
    state.stats.earned += offer;
  }
  state.stats.sold += 1;
  state.heat = Math.min(100, (state.heat || 0) + (res.heat || 0));
  state.rep[buyerId] = (state.rep[buyerId] || 0) + 1;
  if (res.job) {
    state.jobs = state.jobs.filter((j) => j !== res.job);
    state.stats.jobs = (state.stats.jobs || 0) + 1;
  }
  const anomalies = photo.report.subjects.filter((s) => s.category === 'anomaly');
  if (anomalies.length && buyerId !== 'lenny') {
    state.glut = state.glut || {};
    for (const k of new Set(anomalies.map((s) => s.kind))) state.glut[k] = (state.glut[k] || 0) + 1;
  }
  const sightings = anomalies.filter((s) => s.sightingId).map((s) => s.sightingId);
  if (sightings.length) {
    state.stats.anomalySales += 1;
    state.bought[buyerId] = [...new Set([...(state.bought[buyerId] || []), ...sightings])];
    state.soldSightings = [...new Set([...(state.soldSightings || []), ...sightings])].slice(-300);
  }
  if (buyerId === 'lenny' && !sightings.length) {
    if (state.lennyToday.day !== state.day) state.lennyToday = { day: state.day, count: 0 };
    state.lennyToday.count += 1;
  }
}
