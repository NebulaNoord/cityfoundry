// Save format + strict validation. Typed arrays are run-length encoded as
// flat [value, count, value, count, ...] arrays: JSON-safe and compact for
// mostly-uniform maps (a fresh 128×128 save is a few KB).

import {
  SAVE_VERSION,
  MIN_MAP_SIZE,
  MAX_MAP_SIZE,
  T_WATER,
  R_NONE,
  R_HIGHWAY,
  Z_NONE,
  HIGHWAY_LENGTH,
  MAX_TAX,
  MAX_NOTIFICATIONS,
} from './constants.js';
import { Rng } from './rng.js';

export class SaveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveError';
  }
}

export const SAVE_FORMAT = 'cityfoundry-save';

export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let j = i + 1;
    while (j < arr.length && arr[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

export function rleDecode(rle, size, maxValue, field) {
  if (!Array.isArray(rle) || rle.length % 2 !== 0) throw new SaveError(`${field}: malformed run-length data`);
  const out = new Uint8Array(size);
  let pos = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k];
    const n = rle[k + 1];
    if (!Number.isInteger(v) || v < 0 || v > maxValue) throw new SaveError(`${field}: invalid value ${v}`);
    if (!Number.isInteger(n) || n <= 0 || pos + n > size) throw new SaveError(`${field}: invalid run length`);
    out.fill(v, pos, pos + n);
    pos += n;
  }
  if (pos !== size) throw new SaveError(`${field}: expected ${size} tiles, got ${pos}`);
  return out;
}

export function buildSave(s) {
  const buildings = [];
  for (const b of s.buildings.values()) {
    buildings.push([b.id, b.zone, b.level, b.x, b.y, b.w, b.h, b.state, b.daysBuilt, b.capacity, b.occupants, b.builtTick, b.troubleDays]);
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name: s.name,
    seed: s.seed,
    width: s.width,
    height: s.height,
    tick: s.clock.tick,
    speed: s.clock.speed,
    rng: s.rng.getState(),
    fundsCents: s.fundsCents,
    taxRates: { ...s.taxRates },
    demand: { ...s.demand },
    lastDaily: { ...s.lastDaily },
    alerts: { ...s.alerts },
    nextBuildingId: s.nextBuildingId,
    nextNotificationId: s.nextNotificationId,
    notifications: s.notifications.map((n) => ({ ...n })),
    terrain: rleEncode(s.terrain),
    road: rleEncode(s.road),
    zone: rleEncode(s.zone),
    landValue: rleEncode(s.landValue),
    lvDirty: s.lvDirty.slice(),
    chunkVersion: Array.from(s.chunkVersion),
    buildings,
  };
}

const isInt = Number.isInteger;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function req(cond, msg) {
  if (!cond) throw new SaveError(msg);
}

/** Validate a save object. Returns a normalised plain description; throws SaveError. */
export function parseSave(data) {
  req(data !== null && typeof data === 'object' && !Array.isArray(data), 'Save data must be an object');
  req(data.format === SAVE_FORMAT, 'Not a CityFoundry save (missing format marker)');
  req(isInt(data.version), 'Save has no version');
  req(data.version <= SAVE_VERSION, `Save version ${data.version} is newer than this game (${SAVE_VERSION})`);
  req(data.version === SAVE_VERSION, `Unsupported save version ${data.version}`);
  const { width, height } = data;
  req(isInt(width) && width >= MIN_MAP_SIZE && width <= MAX_MAP_SIZE, 'Invalid width');
  req(isInt(height) && height >= MIN_MAP_SIZE && height <= MAX_MAP_SIZE, 'Invalid height');
  req(typeof data.name === 'string', 'Invalid name');
  req(typeof data.seed === 'number' || typeof data.seed === 'string', 'Invalid seed');
  req(isInt(data.tick) && data.tick >= 0, 'Invalid tick');
  req(isInt(data.speed) && data.speed >= 0 && data.speed <= 3, 'Invalid speed');
  req(Rng.isValidState(data.rng), 'Invalid RNG state');
  req(isInt(data.fundsCents), 'Invalid funds');
  for (const z of ['R', 'C', 'I']) {
    req(data.taxRates && isInt(data.taxRates[z]) && data.taxRates[z] >= 0 && data.taxRates[z] <= MAX_TAX, `Invalid tax rate ${z}`);
    req(data.demand && isNum(data.demand[z]), `Invalid demand ${z}`);
  }
  req(data.lastDaily && isInt(data.lastDaily.incomeCents) && isInt(data.lastDaily.expensesCents), 'Invalid lastDaily');
  req(data.alerts && typeof data.alerts === 'object', 'Invalid alerts');
  req(isInt(data.nextBuildingId) && data.nextBuildingId >= 1, 'Invalid nextBuildingId');
  req(isInt(data.nextNotificationId) && data.nextNotificationId >= 1, 'Invalid nextNotificationId');
  req(Array.isArray(data.notifications) && data.notifications.length <= MAX_NOTIFICATIONS, 'Invalid notifications');
  for (const n of data.notifications) {
    req(n && isInt(n.id) && isInt(n.tick) && ['info', 'warn', 'alert'].includes(n.level) && typeof n.message === 'string', 'Invalid notification');
  }

  const size = width * height;
  const terrain = rleDecode(data.terrain, size, T_WATER, 'terrain');
  const road = rleDecode(data.road, size, R_HIGHWAY, 'road');
  const zone = rleDecode(data.zone, size, 3, 'zone');
  const landValue = rleDecode(data.landValue, size, 100, 'landValue');
  for (let i = 0; i < size; i++) {
    req(!(terrain[i] === T_WATER && (road[i] !== R_NONE || zone[i] !== Z_NONE)), 'Road or zone on water');
    req(!(road[i] !== R_NONE && zone[i] !== Z_NONE), 'Zone on a road tile');
  }
  const midY = Math.floor(height / 2);
  for (let x = 0; x < HIGHWAY_LENGTH; x++) req(road[midY * width + x] === R_HIGHWAY, 'Outside connection highway missing');

  req(Array.isArray(data.lvDirty) && data.lvDirty.every((i) => isInt(i) && i >= 0 && i < size), 'Invalid lvDirty');
  const chunksX = Math.ceil(width / 16);
  const chunksY = Math.ceil(height / 16);
  req(
    Array.isArray(data.chunkVersion) && data.chunkVersion.length === chunksX * chunksY && data.chunkVersion.every((v) => isInt(v) && v >= 0),
    'Invalid chunkVersion',
  );

  req(Array.isArray(data.buildings), 'Invalid buildings');
  const occupied = new Int32Array(size);
  const ids = new Set();
  const buildings = [];
  let lastId = 0;
  for (const row of data.buildings) {
    req(Array.isArray(row) && row.length === 13 && row.every(isInt), 'Invalid building record');
    const [id, z, level, x, y, w, h, state, daysBuilt, capacity, occupants, builtTick, troubleDays] = row;
    req(id > lastId && id < data.nextBuildingId && !ids.has(id), `Invalid building id ${id}`);
    lastId = id;
    ids.add(id);
    req(z >= 1 && z <= 3 && level >= 1 && level <= 5 && state >= 0 && state <= 2, `Building ${id}: bad zone/level/state`);
    req(w >= 1 && h >= 1 && x >= 0 && y >= 0 && x + w <= width && y + h <= height, `Building ${id}: out of bounds`);
    req(capacity >= 0 && occupants >= 0 && occupants <= capacity, `Building ${id}: bad occupancy`);
    req(daysBuilt >= 0 && builtTick >= 0 && builtTick <= data.tick && troubleDays >= 0, `Building ${id}: bad counters`);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = yy * width + xx;
        req(occupied[i] === 0, `Building ${id} overlaps building ${occupied[i]}`);
        req(terrain[i] !== T_WATER && road[i] === R_NONE, `Building ${id} sits on water or road`);
        occupied[i] = id;
      }
    }
    buildings.push({ id, zone: z, level, x, y, w, h, state, daysBuilt, capacity, occupants, builtTick, troubleDays });
  }

  return {
    width,
    height,
    name: data.name,
    seed: data.seed,
    tick: data.tick,
    speed: data.speed,
    rng: data.rng.slice(),
    fundsCents: data.fundsCents,
    taxRates: { R: data.taxRates.R, C: data.taxRates.C, I: data.taxRates.I },
    demand: { R: data.demand.R, C: data.demand.C, I: data.demand.I },
    lastDaily: { incomeCents: data.lastDaily.incomeCents, expensesCents: data.lastDaily.expensesCents },
    alerts: {
      lowFunds: !!data.alerts.lowFunds,
      inDebt: !!data.alerts.inDebt,
      lastUnemploymentTick: isInt(data.alerts.lastUnemploymentTick) ? data.alerts.lastUnemploymentTick : -1e9,
      lastNoConnTick: isInt(data.alerts.lastNoConnTick) ? data.alerts.lastNoConnTick : -1e9,
    },
    nextBuildingId: data.nextBuildingId,
    nextNotificationId: data.nextNotificationId,
    notifications: data.notifications.map((n) => ({ id: n.id, tick: n.tick, level: n.level, message: n.message })),
    terrain,
    road,
    zone,
    landValue,
    lvDirty: data.lvDirty.slice(),
    chunkVersion: Uint32Array.from(data.chunkVersion),
    buildings,
  };
}
