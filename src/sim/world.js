// World state: flat typed arrays over the whole map plus per-chunk versions.
// Index of tile (x, y) is y * width + x. Every per-tile field is its own
// typed array, so memory is O(width*height) bytes per field and scales to
// 256×256 / 512×512 maps without per-tile objects.

import {
  CHUNK_SIZE,
  ZONE_DEPTH,
  MIN_MAP_SIZE,
  MAX_MAP_SIZE,
  T_GRASS,
  T_WATER,
  TERRAIN_NAMES,
  R_NONE,
  R_HIGHWAY,
  ROAD_NAMES,
  ZONE_NAMES,
  HIGHWAY_LENGTH,
  STARTING_FUNDS,
  DEFAULT_TAX,
  LV_BASE,
} from './constants.js';
import { Rng } from './rng.js';
import { ChangeTracker } from './events.js';
import { createClock } from './clock.js';

/** Allocate an empty world state (all grass, no roads). */
export function allocateState({ width, height, seed, name }) {
  if (!Number.isInteger(width) || width < MIN_MAP_SIZE || width > MAX_MAP_SIZE) {
    throw new RangeError(`width must be an integer in ${MIN_MAP_SIZE}..${MAX_MAP_SIZE}`);
  }
  if (!Number.isInteger(height) || height < MIN_MAP_SIZE || height > MAX_MAP_SIZE) {
    throw new RangeError(`height must be an integer in ${MIN_MAP_SIZE}..${MAX_MAP_SIZE}`);
  }
  const size = width * height;
  const chunksX = Math.ceil(width / CHUNK_SIZE);
  const chunksY = Math.ceil(height / CHUNK_SIZE);
  const outside = { x: 0, y: Math.floor(height / 2) };
  return {
    width,
    height,
    size,
    chunksX,
    chunksY,
    name: String(name),
    seed,
    outside,
    outsideIdx: outside.y * width + outside.x,

    // Per-tile persistent fields
    terrain: new Uint8Array(size),
    road: new Uint8Array(size),
    zone: new Uint8Array(size),
    landValue: new Uint8Array(size).fill(LV_BASE),

    // Per-tile derived fields (rebuilt on load)
    buildingAt: new Int32Array(size), // 0 = none, else building id
    ciAt: new Uint8Array(size), // zone code of a live (non-abandoned) C/I building on the tile, else 0
    accessCount: new Uint16Array(size), // road tiles within ZONE_DEPTH (Chebyshev)
    connCount: new Uint16Array(size), // connected road tiles within ZONE_DEPTH
    roadConnected: new Uint8Array(size), // road tile belongs to the outside-connected network
    visit: new Uint32Array(size), // BFS stamp scratch
    visitStamp: 0,

    chunkVersion: new Uint32Array(chunksX * chunksY),

    roadTiles: new Set(),
    upkeepCents: 0,
    network: { components: 0, connectedTiles: 0 },

    emptyZoned: [null, new Set(), new Set(), new Set()], // zone code -> set of zoned tiles without a building

    lvDirtyFlag: new Uint8Array(size),
    lvDirty: [],

    buildings: new Map(), // id -> internal building
    nextBuildingId: 1,

    clock: createClock(),
    rng: Rng.fromSeed(seed, 'growth'),
    fundsCents: STARTING_FUNDS * 100,
    taxRates: { R: DEFAULT_TAX, C: DEFAULT_TAX, I: DEFAULT_TAX },
    demand: { R: 0, C: 0, I: 0 },
    lastDaily: { incomeCents: 0, expensesCents: 0 },

    notifications: [], // oldest first
    nextNotificationId: 1,
    alerts: { lowFunds: false, inDebt: false, lastUnemploymentTick: -1e9, lastNoConnTick: -1e9 },

    changes: new ChangeTracker(width),
  };
}

export const inBounds = (s, x, y) => x >= 0 && y >= 0 && x < s.width && y < s.height;

export function isCell(c) {
  return c !== null && typeof c === 'object' && Number.isInteger(c.x) && Number.isInteger(c.y);
}

/** Deterministic terrain: grass + a few blobby lakes, highway stub mid-west. */
export function generateTerrain(s) {
  const rng = Rng.fromSeed(s.seed, 'terrain');
  const { width, height } = s;
  const midY = s.outside.y;
  // Keep a lake-free entrance around the highway stub so the player can always
  // build out from it (and zone both sides of the first street).
  const protectedTile = (x, y) => x <= HIGHWAY_LENGTH + 3 * ZONE_DEPTH && Math.abs(y - midY) <= 2 * ZONE_DEPTH;

  const area = width * height;
  const lakes = Math.max(1, Math.round((2 + rng.int(3)) * (area / (128 * 128))));
  for (let l = 0; l < lakes; l++) {
    const r = 3 + rng.next() * 6 * Math.sqrt(Math.min(width, height) / 128);
    const cx = Math.floor(r + rng.next() * (width - 2 * r));
    const cy = Math.floor(r + rng.next() * (height - 2 * r));
    // Three angular harmonics give a blobby, non-circular outline.
    const h = [0, 1, 2].map(() => ({ k: 2 + rng.int(4), a: 0.08 + rng.next() * 0.15, p: rng.next() * Math.PI * 2 }));
    const R = Math.ceil(r * 1.5);
    for (let y = Math.max(0, cy - R); y <= Math.min(height - 1, cy + R); y++) {
      for (let x = Math.max(0, cx - R); x <= Math.min(width - 1, cx + R); x++) {
        if (protectedTile(x, y)) continue;
        const dx = x - cx;
        const dy = y - cy;
        const ang = Math.atan2(dy, dx);
        let f = 1;
        for (const { k, a, p } of h) f += a * Math.sin(k * ang + p);
        if (Math.sqrt(dx * dx + dy * dy) <= r * f) s.terrain[y * width + x] = T_WATER;
      }
    }
  }
  for (let x = 0; x < HIGHWAY_LENGTH; x++) {
    const idx = midY * width + x;
    s.terrain[idx] = T_GRASS;
    s.road[idx] = R_HIGHWAY;
  }
}

export function tileSnapshot(s, idx) {
  const x = idx % s.width;
  const y = (idx - x) / s.width;
  const r = s.road[idx];
  const b = s.buildingAt[idx];
  return {
    x,
    y,
    terrain: TERRAIN_NAMES[s.terrain[idx]],
    road: r === R_NONE ? null : { type: ROAD_NAMES[r] },
    zone: ZONE_NAMES[s.zone[idx]],
    buildingId: b === 0 ? null : b,
    landValue: s.landValue[idx],
    roadAccess: s.accessCount[idx] > 0,
    connected: s.connCount[idx] > 0,
  };
}
