// Persistence. Save data goes to localStorage; photos (JPEG blobs) go to
// IndexedDB because they are too big for localStorage. Every access is
// guarded: private windows / sandboxed iframes can throw, in which case we
// fall back to memory so the game still runs (it just won't persist).

const memKV = new Map();

export const kv = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return memKV.has(key) ? structuredClone(memKV.get(key)) : null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      memKV.set(key, structuredClone(value));
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    memKV.delete(key);
  },
};

const DB_NAME = 'skywatch97';
const STORE = 'photos';

export class PhotoStore {
  constructor() {
    this.db = null;
    this.mem = new Map();
  }

  async init() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        setTimeout(() => reject(new Error('idb timeout')), 3000);
      });
    } catch {
      this.db = null;
    }
  }

  _tx(mode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async put(record) {
    if (!this.db) {
      this.mem.set(record.id, record);
      return;
    }
    try {
      await new Promise((resolve, reject) => {
        const req = this._tx('readwrite').put(record);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.mem.set(record.id, record);
    }
  }

  async getAll() {
    let rows = [];
    if (this.db) {
      try {
        rows = await new Promise((resolve, reject) => {
          const req = this._tx('readonly').getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      } catch {
        rows = [];
      }
    }
    for (const r of this.mem.values()) rows.push(r);
    return rows.sort((a, b) => a.id - b.id);
  }

  async delete(id) {
    this.mem.delete(id);
    if (!this.db) return;
    try {
      await new Promise((resolve) => {
        const req = this._tx('readwrite').delete(id);
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    } catch {
      /* ignore */
    }
  }

  async clear() {
    this.mem.clear();
    if (!this.db) return;
    try {
      await new Promise((resolve) => {
        const req = this._tx('readwrite').clear();
        req.onsuccess = resolve;
        req.onerror = resolve;
      });
    } catch {
      /* ignore */
    }
  }
}
