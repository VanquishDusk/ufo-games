// Who buys photos and what they pay. Prices are driven by the photo report
// from PhotoAnalyzer: subjects in frame (category 'anomaly' is where the real
// money is), sharpness, exposure and composition.

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
    blurb: 'Supermarket tabloid. Pays cash for proof, and blurry is fine.',
    unlocked: () => true,
  },
  {
    id: 'vos',
    name: 'Dr. Ingrid Vos',
    blurb: 'Independent researcher. Only wants sharp, well-exposed evidence. Pays well.',
    unlocked: () => true,
  },
  {
    id: 'kchv',
    name: 'KCHV Channel 7 News',
    blurb: 'Local news desk. Wants a crystal-clear shot they can put on air.',
    unlocked: (s) => s.stats.anomalySales >= 3,
    lockedText: 'Sell 3 sightings to get their attention.',
  },
  {
    id: 'gray',
    name: '???',
    blurb: '[ NO CARRIER ]',
    unlocked: () => false,
    lockedText: 'Someone is watching your submissions.',
  },
];

// Buyers' tastes: the tabloid loves saucers, Vos wants the strange stuff,
// the news desk likes something they can see in daylight.
const KIND_MULT = {
  probe: { saucer: 1.3, cigar: 0.9, triangle: 1.0 },
  vos: { saucer: 1.0, cigar: 1.2, triangle: 1.35 },
  kchv: { saucer: 1.0, cigar: 1.25, triangle: 0.9 },
};

const repMult = (state, id) => 1 + Math.min(10, state.rep[id] || 0) * 0.05;

// Value of the anomalies in a photo, with repeat sightings discounted.
function anomalyValue(report, state, buyerId) {
  const seen = new Set(state.bought[buyerId] || []);
  let v = 0;
  for (const s of report.subjects) {
    if (s.category !== 'anomaly') continue;
    const repeat = s.sightingId && seen.has(s.sightingId);
    v += s.value * s.score * (repeat ? 0.35 : 1) * (KIND_MULT[buyerId]?.[s.kind] ?? 1);
  }
  return v;
}

export function appraise(photo, buyerId, state) {
  const r = photo.report;
  const buyer = BUYERS.find((b) => b.id === buyerId);
  if (!buyer) return { ok: false, reason: 'Unknown buyer.' };
  if (!buyer.unlocked(state)) return { ok: false, reason: buyer.lockedText || 'Not interested.' };
  if (photo.sold) return { ok: false, reason: 'Already sold.' };
  const av = anomalyValue(r, state, buyerId);
  const hasAnomaly = av > 0.5;

  if (buyerId === 'lenny') {
    if (hasAnomaly) return { ok: true, offer: Math.max(5, Math.round(av * 0.5 * repMult(state, 'lenny'))), line: "Lenny: 'DUDE. Okay. Okay okay okay. I'll scrape together what I can.'" };
    const today = state.lennyToday.day === state.day ? state.lennyToday.count : 0;
    if (today >= 3) return { ok: false, reason: "Lenny: 'my hard drive is FULL man. try tomorrow.'" };
    if (r.quality < 0.2) return { ok: false, reason: "Lenny: 'i literally cannot tell what this is. and not in the good way.'" };
    const spooky = (r.night ? 1 : 0) + (r.subjects.some((s) => s.category === 'landmark') ? 1 : 0);
    const offer = Math.max(1, Math.round((1 + spooky) * (0.5 + r.quality)));
    const lines = ["Lenny: 'creepy. i dig it. ur on the front page of the board.'", "Lenny: 'not a ufo but the vibes are there.'", "Lenny: 'nice. uploading at 2.4 kb/s, see u in an hour.'"];
    return { ok: true, offer, line: lines[photo.id % lines.length] };
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
    return { ok: true, offer: Math.round(av * k * repMult(state, 'probe')), line: "Probe: 'LOVE IT. Page 6. Check's in the mail.'" };
  }
  if (buyerId === 'vos') {
    if (r.quality < 0.6) return { ok: false, reason: "Dr. Vos: 'Too blurry or too dark to be evidence. Get closer, hold still.'" };
    return { ok: true, offer: Math.round(av * 1.8 * repMult(state, 'vos')), line: "Dr. Vos: 'Remarkable. This goes in the file.'" };
  }
  if (buyerId === 'kchv') {
    if (r.quality < 0.78) return { ok: false, reason: "KCHV: 'Not broadcast quality. We need it crisp.'" };
    return { ok: true, offer: Math.round(av * 3 * repMult(state, 'kchv')), line: "KCHV: 'We're leading with this at six!'" };
  }
  return { ok: false, reason: 'No response.' };
}

export function completeSale(photo, buyerId, offer, state) {
  photo.sold = { buyer: buyerId, price: offer, day: state.day };
  state.money += offer;
  state.stats.sold += 1;
  state.stats.earned += offer;
  state.rep[buyerId] = (state.rep[buyerId] || 0) + 1;
  const sightings = photo.report.subjects.filter((s) => s.category === 'anomaly' && s.sightingId).map((s) => s.sightingId);
  if (sightings.length) {
    state.stats.anomalySales += 1;
    state.bought[buyerId] = [...new Set([...(state.bought[buyerId] || []), ...sightings])];
  }
  if (buyerId === 'lenny' && !sightings.length) {
    if (state.lennyToday.day !== state.day) state.lennyToday = { day: state.day, count: 0 };
    state.lennyToday.count += 1;
  }
}
