import { LURES } from './lures.js';

// Gear, film and the two places to buy them: the Qwik Stop (instant) and the
// Skywatcher Supply Co. mail-order catalog (arrives on the porch next morning).

export const FILM = {
  film_200: { name: 'Everyday 200', short: 'ISO 200', iso: 200, grain: 0.035, exposures: 24 },
  film_800: { name: 'Hi-Speed 800', short: 'ISO 800', iso: 800, grain: 0.06, exposures: 24 },
  film_1600: { name: 'NightOwl 1600', short: 'ISO 1600', iso: 1600, grain: 0.095, exposures: 24 },
};

// zoom: [min, max]; wind = seconds between shots; focus = seconds to lock;
// maxShutter = slowest handheld shutter; sharp = lens quality.
export const CAMERAS = {
  snappy: { name: 'Sunpak Snappy 35', short: 'SNAPPY', zoom: [1, 1], flashRange: 5, wind: 1.1, focus: 0.65, maxShutter: 1 / 30, sharp: 0.86, shake: 1.0, color: '#d8d0c0' },
  zoom90: { name: 'Optika Zoom 90', short: 'ZOOM 90', zoom: [1, 3], flashRange: 8, wind: 0.65, focus: 0.45, maxShutter: 1 / 8, sharp: 0.93, shake: 0.92, color: '#2a2a2e' },
  slr: { name: 'Kestrel K-1 SLR', short: 'K-1 SLR', zoom: [1, 2], flashRange: 10, wind: 0.35, focus: 0.28, maxShutter: 1, sharp: 1.0, shake: 0.85, color: '#1a1a1c' },
};

export const ITEMS = [
  // Film
  { id: 'film_200', name: 'Everyday 200 film', desc: '24 exposures. Fine in daylight, murky at night.', price: 6, kind: 'film', where: ['store', 'mail'] },
  { id: 'film_800', name: 'Hi-Speed 800 film', desc: '24 exposures. Grainier, but handles dusk and streetlights.', price: 12, kind: 'film', where: ['store', 'mail'] },
  { id: 'film_1600', name: 'NightOwl 1600 film', desc: '24 exposures. Pro night film. Very grainy, very fast.', price: 20, kind: 'film', where: ['mail'] },
  // Bodies
  { id: 'cam_zoom90', name: 'Optika Zoom 90', desc: '3x zoom point-and-shoot. Faster wind, stronger flash, 1/8s slow shutter.', price: 320, kind: 'camera', camera: 'zoom90', where: ['mail'] },
  { id: 'cam_slr', name: 'Kestrel K-1 SLR', desc: 'Real SLR. Takes telephoto lenses, near-instant wind, shutter down to 1s.', price: 1100, kind: 'camera', camera: 'slr', where: ['mail'] },
  // Lenses
  { id: 'lens_200', name: '200mm telephoto lens', desc: 'Up to 6x zoom on the K-1 SLR.', price: 850, kind: 'lens', zoom: 6, requires: 'slr', where: ['mail'] },
  { id: 'lens_500', name: '500mm mirror lens', desc: 'Up to 12x zoom on the K-1 SLR. Every tremor shows.', price: 2400, kind: 'lens', zoom: 12, requires: 'slr', where: ['mail'] },
  // Gear
  { id: 'flashlight', name: 'Maglite flashlight', desc: 'Light up the dark. Toggle with F.', price: 14, kind: 'gear', where: ['store', 'mail'] },
  { id: 'binoculars', name: '7x50 binoculars', desc: 'Scan the sky without wasting film. Toggle with B.', price: 75, kind: 'gear', where: ['mail'] },
  { id: 'tripod', name: 'Aluminum tripod', desc: 'Plant it with T. Zero shake, long exposures.', price: 140, kind: 'gear', where: ['mail'] },
  { id: 'stabilizer', name: 'Steady-Grip handle', desc: 'Cuts handheld shake by 40%.', price: 240, kind: 'gear', where: ['mail'] },
  { id: 'flash_pro', name: 'Pro flash unit', desc: 'Flash reaches 20m instead of a few feet.', price: 280, kind: 'gear', where: ['mail'] },
  { id: 'scanner', name: 'Police scanner', desc: 'Crackles when someone calls in a sighting, and says roughly where.', price: 450, kind: 'gear', where: ['mail'] },
  { id: 'darkroom', name: 'Home darkroom kit', desc: 'Enlarger, trays, safelight. Print your own: every sale pays 20% more.', price: 1800, kind: 'gear', where: ['mail'] },
];

// Lures (consumable, one use each) come from the lure table.
for (const [id, l] of Object.entries(LURES)) ITEMS.push({ id, name: l.name, desc: `${l.desc} (L to use)`, price: l.price, kind: 'lure', where: ['mail'] });

export const itemById = (id) => ITEMS.find((i) => i.id === id);
