// IndexedDB save slots (browser only). Never imported by the sim core:
// the UI imports this module directly. No dependencies.
//
// Database "cityfoundry", object store "saves", keyPath "slot".
// Each record: { slot, name, savedAt, population, funds, data } where data is
// the plain object from sim.serialize().

import { loadSimulation, SaveError } from './index.js';

const DB_NAME = 'cityfoundry';
const DB_VERSION = 1;
const STORE = 'saves';
export const AUTOSAVE_SLOT = 'autosave';

function getIDB(factory) {
  const idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!idb) throw new Error('IndexedDB is not available in this environment');
  return idb;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
let dbFactory = null;

/** Open (and upgrade) the database once per factory. */
function openDB(factory) {
  const idb = getIDB(factory);
  if (dbPromise && dbFactory === idb) return dbPromise;
  dbFactory = idb;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: close so it can proceed, reopen lazily.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open blocked by another tab'));
    };
  });
  return dbPromise;
}

async function withStore(mode, fn, factory) {
  const db = await openDB(factory);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function checkSlot(slot) {
  if (typeof slot !== 'string' || slot.length === 0 || slot.length > 100) {
    throw new TypeError('slot must be a non-empty string (max 100 chars)');
  }
}

/** Save a simulation into a slot (overwrites). Resolves to the summary record. */
export async function saveCity(slot, sim, { factory } = {}) {
  checkSlot(slot);
  const data = sim.serialize();
  const stats = sim.getStats();
  const record = {
    slot,
    name: data.name,
    savedAt: Date.now(),
    population: stats.population,
    funds: stats.funds,
    data,
  };
  await withStore('readwrite', (store) => reqToPromise(store.put(record)), factory);
  return { slot, name: record.name, savedAt: record.savedAt, population: record.population, funds: record.funds };
}

/** Load a slot into a new simulation. Rejects with SaveError if missing or corrupt. */
export async function loadCity(slot, { factory } = {}) {
  checkSlot(slot);
  const record = await withStore('readonly', (store) => reqToPromise(store.get(slot)), factory);
  if (!record) throw new SaveError(`No save in slot "${slot}"`);
  return loadSimulation(record.data);
}

/** Summaries of all saves, newest first. */
export async function listSaves({ factory } = {}) {
  const all = await withStore('readonly', (store) => reqToPromise(store.getAll()), factory);
  return all
    .map(({ slot, name, savedAt, population, funds }) => ({ slot, name, savedAt, population, funds }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot, { factory } = {}) {
  checkSlot(slot);
  await withStore('readwrite', (store) => reqToPromise(store.delete(slot)), factory);
}
