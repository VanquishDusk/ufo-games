// In-game calendar. Day 0 is Friday, October 3rd, 1997.
const START = Date.UTC(1997, 9, 3);
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// One real second = one game minute.
export const GAME_MINUTES_PER_SECOND = 1;

export function gameDate(day) {
  return new Date(START + day * 86400000);
}

export function formatDate(day) {
  const d = gameDate(day);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`;
}

export function formatClock(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

// Camcorder-style overlay text burned into photos.
export function stampDate(day) {
  const d = gameDate(day);
  return `${MONTHS[d.getUTCMonth()]}.${String(d.getUTCDate()).padStart(2, ' ')} ${d.getUTCFullYear()}`;
}

export function stampTime(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${String(h12).padStart(2, ' ')}:${String(m).padStart(2, '0')}`;
}
