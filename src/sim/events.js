// Tiny synchronous event emitter plus a per-transaction change collector.
// All events produced while a command or tick runs are queued and emitted
// together at the end, so handlers never observe half-updated state.

import { CHUNK_SIZE } from './constants.js';

export const EVENT_NAMES = Object.freeze([
  'tick',
  'day',
  'tilesChanged',
  'buildingAdded',
  'buildingChanged',
  'buildingRemoved',
  'statsChanged',
  'notification',
]);

export class Emitter {
  constructor(onError) {
    this.handlers = new Map();
    for (const name of EVENT_NAMES) this.handlers.set(name, []);
    this.onError =
      onError ||
      ((name, err) => {
        console.error(`[sim] handler for "${name}" threw:`, err);
      });
  }

  on(name, handler) {
    const list = this.handlers.get(name);
    if (!list) throw new TypeError(`Unknown sim event "${name}". Known: ${EVENT_NAMES.join(', ')}`);
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    list.push(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const cur = this.handlers.get(name);
      const i = cur.indexOf(handler);
      if (i >= 0) cur.splice(i, 1);
    };
  }

  hasListeners(name) {
    return this.handlers.get(name).length > 0;
  }

  emit(name, payload) {
    // Copy so (un)subscribing inside a handler doesn't disturb this dispatch.
    const list = this.handlers.get(name).slice();
    for (const h of list) {
      try {
        h(payload);
      } catch (err) {
        try {
          this.onError(name, err);
        } catch {
          /* logging must never break the sim */
        }
      }
    }
  }
}

/** Collects tile and building changes during one transaction. */
export class ChangeTracker {
  constructor(width) {
    this.width = width;
    this.reset();
  }

  reset() {
    this.cells = new Set(); // tile indices
    this.added = new Set(); // building ids
    this.changed = new Set(); // building ids
    this.removed = []; // building snapshots
    this.notifications = []; // payloads
    this.statsChanged = false;
  }

  markTile(idx) {
    this.cells.add(idx);
  }

  isEmpty() {
    return (
      this.cells.size === 0 &&
      this.added.size === 0 &&
      this.changed.size === 0 &&
      this.removed.length === 0 &&
      this.notifications.length === 0 &&
      !this.statsChanged
    );
  }

  /** Detach the current batch and start a fresh one. */
  take() {
    const batch = {
      cells: this.cells,
      added: this.added,
      changed: this.changed,
      removed: this.removed,
      notifications: this.notifications,
      statsChanged: this.statsChanged,
    };
    this.reset();
    return batch;
  }
}

/** Convert a set of tile indices into the tilesChanged payload and bump chunk versions. */
export function tilesPayload(cells, width, chunksX, chunkVersion) {
  const outCells = [];
  const chunkSet = new Set();
  const sorted = Array.from(cells).sort((a, b) => a - b);
  for (const idx of sorted) {
    const x = idx % width;
    const y = (idx - x) / width;
    outCells.push({ x, y });
    chunkSet.add(((y / CHUNK_SIZE) | 0) * chunksX + ((x / CHUNK_SIZE) | 0));
  }
  const chunks = [];
  for (const ci of Array.from(chunkSet).sort((a, b) => a - b)) {
    chunkVersion[ci]++;
    chunks.push({ cx: ci % chunksX, cy: (ci / chunksX) | 0 });
  }
  return { cells: outCells, chunks };
}
