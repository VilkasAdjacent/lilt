// Recordings in IndexedDB (on this device only).
// Record: { id, created, duration, sampleRate, name, blob (audio/wav or MediaRecorder type),
//           trace: [[t, f0, dbfs, weight, f1, f2], ...], summary: {...} }

const DB_NAME = 'voice-garden';
const STORE = 'recordings';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const putRecording = (rec) => tx('readwrite', (s) => reqP(s.put(rec)));
export const getRecording = (id) => tx('readonly', (s) => reqP(s.get(id)));
export const deleteRecording = (id) => tx('readwrite', (s) => reqP(s.delete(id)));
export const clearRecordings = () => tx('readwrite', (s) => reqP(s.clear()));
export async function listRecordings() {
  const all = await tx('readonly', (s) => reqP(s.getAll()));
  return (all || []).sort((a, b) => b.created - a.created);
}

/** Ask the browser not to evict our data (best effort). */
export async function requestPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
