// Minimal pub/sub used to keep systems decoupled (UI <-> game <-> audio).
export class Emitter {
  constructor() {
    this.map = new Map();
  }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    this.map.get(evt)?.delete(fn);
  }
  emit(evt, ...args) {
    const set = this.map.get(evt);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}

export const bus = new Emitter();
