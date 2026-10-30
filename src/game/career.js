// The slow-burn side of the game: buyer jobs, the field log, weekly bills,
// checks in the mail, and "heat" (how much attention your sales attract).
// Everything here runs off the save state; the morning tick fires once a
// day at 8 AM (see Game.advanceHours).
import { UFO_TYPES } from '../ufo/UFOManager.js';

export const GRADE_RANK = { F: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };

// One-time bounty from Lenny's board for the first decent photo of a type.
const BOUNTY = { common: 15, uncommon: 40, rare: 100, epic: 250, legend: 500 };
const JOB_REWARD = { common: 60, uncommon: 160, rare: 380, epic: 800 };
const JOB_TIER_WEIGHT = { common: 4, uncommon: 4, rare: 2.2, epic: 0.8 };

const JOB_TEXT = {
  probe: (l, g) => `The Weekly Probe needs a photo of ${l} for next week's cover. Grade ${g} or better. Bonus on top of our usual rate.`,
  vos: (l, g) => `Dr. Vos is building a case file on ${l}. She needs a clean grade ${g}+ photograph.`,
  kchv: (l, g) => `KCHV wants footage-quality stills of ${l} for a sweeps-week special. Broadcast quality, grade ${g} or better.`,
};
const JOB_GRADE = { probe: 'D', vos: 'B', kchv: 'A' };

export const MAX_HEAT = 100;
// Heat per dollar paid. Big money is loud money.
const HEAT_PER_DOLLAR = { lenny: 0, vos: 0, probe: 0.02, kchv: 0.045, gray: 0.04 };

export function heatFor(buyerId, offer) {
  const h = Math.round(offer * (HEAT_PER_DOLLAR[buyerId] || 0));
  return buyerId === 'gray' ? Math.max(20, h) : h;
}

// Chance a tabloid check bounces grows with its size.
export const bounceChance = (amount) => Math.min(0.4, 0.04 + amount / 2500);

export const heatLabel = (h) => (h >= 70 ? 'BEING WATCHED' : h >= 45 ? 'HOT' : h >= 20 ? 'NOTICED' : 'QUIET');

const rand = (a, b) => a + Math.random() * (b - a);

export function openJobs(S) {
  return (S.jobs || []).filter((j) => j.due >= S.day);
}

// Does this photo satisfy an open job for this buyer?
export function matchJob(photo, buyerId, S) {
  const r = photo.report;
  return openJobs(S).find(
    (j) => j.buyer === buyerId && GRADE_RANK[r.grade] >= GRADE_RANK[j.minGrade] && r.subjects.some((s) => s.kind === j.kind && s.category === 'anomaly' && s.score >= 0.2),
  );
}

export function makeJob(S) {
  const buyers = ['probe', 'vos'];
  if (S.stats.anomalySales >= 3) buyers.push('kchv');
  const taken = new Set(openJobs(S).map((j) => j.kind));
  const pool = Object.entries(UFO_TYPES).filter(([k, t]) => !t.legend && JOB_REWARD[t.tier] && !taken.has(k));
  if (!pool.length) return null;
  let r = Math.random() * pool.reduce((a, [, t]) => a + JOB_TIER_WEIGHT[t.tier], 0);
  let pick = pool[pool.length - 1];
  for (const p of pool) {
    r -= JOB_TIER_WEIGHT[p[1].tier];
    if (r <= 0) {
      pick = p;
      break;
    }
  }
  const [kind, t] = pick;
  const buyer = buyers[Math.floor(Math.random() * buyers.length)];
  const minGrade = JOB_GRADE[buyer];
  const reward = Math.round((JOB_REWARD[t.tier] * rand(0.85, 1.2) * (buyer === 'kchv' ? 1.4 : buyer === 'vos' ? 1.15 : 1)) / 5) * 5;
  S.jobSeq = (S.jobSeq || 0) + 1;
  return { id: S.jobSeq, buyer, kind, label: t.label, tier: t.tier, minGrade, reward, posted: S.day, due: S.day + 3 + Math.floor(Math.random() * 3), text: JOB_TEXT[buyer](t.label.toLowerCase(), minGrade) };
}

export function refillJobs(S, max = 3) {
  S.jobs = openJobs(S);
  let added = 0;
  // One new request a day, and never fewer than two open.
  while (S.jobs.length < max && (added < 1 || S.jobs.length < 2)) {
    const j = makeJob(S);
    if (!j) break;
    S.jobs.push(j);
    added++;
  }
  return added;
}

// Record a new photo in the field log. Returns bounty info for new entries.
export function logPhoto(record, S) {
  S.log = S.log || {};
  const found = [];
  for (const s of record.report.subjects) {
    if (s.category !== 'anomaly' || !s.kind || s.score < 0.3) continue;
    const e = S.log[s.kind];
    if (!e) {
      S.log[s.kind] = { first: S.day, best: record.report.grade, count: 1 };
      const bounty = BOUNTY[s.tier] || BOUNTY.rare;
      found.push({ label: s.label, bounty });
    } else {
      e.count += 1;
      if (GRADE_RANK[record.report.grade] > GRADE_RANK[e.best]) e.best = record.report.grade;
    }
  }
  return found;
}

const mail = (S, id, from, subject, body) => S.inbox.push({ id: `${id}-${S.day}-${S.inbox.length}`, day: S.day, from, subject, body, read: false });

// Runs once each morning. Returns short lines worth toasting.
export function morningTick(S, game) {
  const out = [];
  // Markets recover, attention fades.
  for (const k of Object.keys(S.glut || {})) {
    S.glut[k] *= 0.6;
    if (S.glut[k] < 0.05) delete S.glut[k];
  }
  S.heat = Math.max(0, (S.heat || 0) - 8);

  // Checks in the mail.
  const due = (S.checks || []).filter((c) => c.day <= S.day);
  S.checks = (S.checks || []).filter((c) => c.day > S.day);
  for (const c of due) {
    if (Math.random() < c.bounce) {
      mail(S, 'bounce', 'CEDAR HOLLOW SAVINGS & LOAN', 'Returned item notice', `A check from THE WEEKLY PROBE INC. for $${c.amount} was returned unpaid (insufficient funds).\n\nWe have not credited your account.\n\nThe Probe's phone line is disconnected.`);
      out.push(`The Probe's $${c.amount} check bounced.`);
    } else {
      S.money += c.amount;
      S.stats.earned += c.amount;
      out.push(`The Probe's check cleared. +$${c.amount}`);
    }
  }

  // Bills: phone line + UFO-NET, every Sunday from the first week on.
  if (S.day > 0 && S.day % 7 === 0) {
    const week = S.day / 7;
    const bill = Math.min(150, 35 + 15 * (week - 1));
    S.money -= bill;
    mail(S, 'bill', 'PACIFIC BELL / UFO-NET', `Weekly statement: $${bill}.00`, `Phone line .............. $${Math.round(bill * 0.4)}.00\nUFO-NET dial-up access .. $${bill - Math.round(bill * 0.4)}.00\n\nTOTAL DEDUCTED ......... $${bill}.00\n\nRates are reviewed weekly. Thank you for choosing Pacific Bell.`);
    out.push(`Weekly phone & UFO-NET bill: -$${bill}.`);
    if (S.money < 0) out.push("You're in the red. No mail orders until you're paid up.");
  }

  // Attention turns into trouble.
  const heat = S.heat;
  if (heat >= 45 && Math.random() < (heat - 30) / 90) {
    out.push(...raid(S, game));
  } else if (heat >= 25 && !(S.flags.warnedDay >= S.day - 3)) {
    S.flags.warnedDay = S.day;
    mail(S, 'warn', 'LENNY <lenny@greyzone.bbs>', 'uh. heads up', "some guy with a .gov email was asking about u on the board. wanted to know where u live. i said i dont know u.\n\nalso theres been a dark sedan parked on maple twice this week??\n\nmaybe lay low a few days. sell to Vos, she keeps things quiet. the big money ppl are LOUD.\n- L");
    out.push('Lenny sent you a worried email.');
  }

  // New work.
  if (refillJobs(S)) out.push('New job request on UFO-NET.');
  return out;
}

// Men in black. Unsold sightings are taken and you're "fined".
function raid(S, game) {
  const taken = game.photos.filter((p) => !p.sold && p.report.subjects.some((s) => s.category === 'anomaly'));
  for (const p of taken) game.deletePhoto(p);
  const fine = S.money > 0 ? Math.round(S.money * 0.3) : 0;
  S.money -= fine;
  S.heat = 10;
  S.stats.raids = (S.stats.raids || 0) + 1;
  mail(
    S,
    'raid',
    'OFFICE OF ATMOSPHERIC RESEARCH',
    'Notice of seizure',
    `Two representatives of this office visited your residence this morning.\n\nThe following were removed for analysis:\n  - ${taken.length} photograph(s) and negative(s) of restricted airspace\n\nAn administrative penalty of $${fine}.00 for unlicensed aerial photography has been collected.\n\nThere is no appeal. Your discretion is appreciated.`,
  );
  return [`Men in dark suits came by. They took ${taken.length} unsold photo${taken.length === 1 ? '' : 's'} and $${fine}.`];
}
